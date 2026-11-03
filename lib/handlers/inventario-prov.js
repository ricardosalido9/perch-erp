// Inventario por proveedor y por mueble.
// Responde: ¿qué tiene TANDEM guardado de Silla Uma en Nogal? ¿cuánto le pedí,
// cuánto entregó, cuánto ya salió a clientes y cuánto le queda disponible?
const core = require('../core');

// Los renglones que el corte dejó para cargar la deuda de un pedido ya entregado
// no son un mueble: no tienen cantidad ni material, y si se cuentan aparecen como
// un producto fantasma en el inventario y en lo que tiene cada proveedor.
function esSoloSaldo(nombre) {
  return /^\s*saldo inicial del corte/i.test(String(nombre || ''));
}

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normPedido(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ped, ent, sal] = await Promise.all([
      leer('prov_pedidos'), leer('prov_entradas'), leer('prov_salidas')
    ]);
    if (!ped.headers.length) return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });

    const pPr = col(ped.headers, 'Proveedor');
    const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
    const pM = col(ped.headers, 'Material');
    const pC = col(ped.headers, 'Cantidad');
    const pP = col(ped.headers, 'Pedido Proveedor');
    const pF = col(ped.headers, 'Folio cliente', 'Folio Cliente', 'Folio');
    const pD = col(ped.headers, 'Destino');
    const pU = col(ped.headers, 'Costo Unitario');
    const pSt = col(ped.headers, 'Status');
    const pF2 = col(ped.headers, 'Fecha');
    const pEst = col(ped.headers, 'Fecha Estimada de Entrega');
    if (!pPr || !pI) return res.status(400).json({ error: 'Faltan las columnas Proveedor y Producto.' });

    // Llave: proveedor + producto + material
    const inv = {};
    const provDePedido = {};
    const clave = (pr, i, m) => norm(pr) + '||' + norm(i) + '||' + norm(m);
    const get = (pr, i, m) => {
      const k = clave(pr, i, m);
      if (!inv[k]) inv[k] = {
        proveedor: txt(pr), producto: txt(i), material: txt(m),
        pedidas: 0, entregadas: 0, salidas: 0, comprometidas: 0,
        costoUnitario: null, pedidos: {}, destinos: {}
      };
      return inv[k];
    };

    ped.rows.forEach(r => {
      if (esSoloSaldo(r[pI])) return;   // deuda, no mueble
      const it = txt(r[pI]);
      if (!it) return;
      const d = get(r[pPr], it, pM ? r[pM] : '');
      const c = pC ? num(r[pC]) : 0;
      d.pedidas += c;
      if (d.costoUnitario === null && pU && num(r[pU])) d.costoUnitario = num(r[pU]);
      const kp = txt(pP ? r[pP] : '') || '(sin pedido)';
      if (!d.pedidos[kp]) d.pedidos[kp] = {
        pedido: kp, pedidas: 0, entregadas: 0, salidas: 0, status: '', costo: null,
        fecha: '', estimada: '', filas: []
      };
      d.pedidos[kp].pedidas += c;
      // Qué proveedor es cada pedido: la hoja de Entradas no trae proveedor,
      // solo el número de pedido.
      provDePedido[normPedido(kp)] = txt(r[pPr]);
      if (!d.pedidos[kp].status && pSt) d.pedidos[kp].status = txt(r[pSt]);
      if (d.pedidos[kp].costo === null && pU) d.pedidos[kp].costo = num(r[pU]) || null;
      if (!d.pedidos[kp].fecha && pF2) d.pedidos[kp].fecha = txt(r[pF2]);
      if (!d.pedidos[kp].estimada && pEst) d.pedidos[kp].estimada = txt(r[pEst]);
      if (d.pedidos[kp].filas.length < 20) d.pedidos[kp].filas.push(r._fila);
      // Piezas que el pedido ya reservó para un cliente.
      //
      // Un pedido hecho para STOCK no está apartado para nadie aunque su "Folio
      // cliente" traiga folios: ahí esa columna es la nota de a qué ventas se le
      // fue surtiendo —la escriben tanto Surtir ventas como Mandar a venta—. Si
      // se contara, un renglón de 20 piezas para Stock con un folio anotado
      // aparecería comprometido entero. Misma regla que en Surtir: Stock no
      // aparta, y un renglón con varios folios no dice cuánto es de cada uno.
      const fol = txt(pF ? r[pF] : '');
      const dest = txt(pD ? r[pD] : '');
      const esDeStock = /^(stock|bodega|showroom|exhibici)/i.test(dest || fol);
      const folios = fol.split(/[,;/]+/).map(txt).filter(Boolean)
        .filter(x => norm(x) !== 'sin asignar');
      // Las ventas que salieron de este renglón se siguen viendo, cuente o no
      folios.forEach(f => { d.destinos[f] = (d.destinos[f] || 0) + (esDeStock ? 0 : c); });
      if (!esDeStock && folios.length === 1) d.comprometidas += c;
    });

    // Lo que ya llegó.
    //
    // Antes salía en CERO para todos los proveedores: se leía una columna
    // "Entradas" dentro de la hoja de Pedidos, y esa columna no existe. Lo que
    // llegó está en su propia pestaña, *Entradas*, y ahí el producto se llama
    // **Item** y no hay columna de proveedor: el proveedor sale del número de
    // pedido.
    let entradasSinPedido = 0;
    if (ent.headers.length) {
      const eP = col(ent.headers, 'Pedido Proveedor', 'Pedido');
      const eI = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eC = col(ent.headers, 'Cantidad');
      if (eI) ent.rows.forEach(r => {
        const it = txt(r[eI]);
        if (!it || esSoloSaldo(it)) return;
        const c = eC ? num(r[eC]) : 0;
        if (!c) return;
        const kped = txt(eP ? r[eP] : '');
        const prov = provDePedido[normPedido(kped)] || '';
        // Sin pedido conocido no se le puede colgar a nadie: se cuenta aparte
        // en vez de inventarle un proveedor.
        if (!prov) { entradasSinPedido += c; return; }
        const d = get(prov, it, eM ? r[eM] : '');
        d.entregadas += c;
        if (d.pedidos[kped]) d.pedidos[kped].entregadas += c;
      });
    }

    // Lo que ya salió
    if (sal.headers.length) {
      const sPr = col(sal.headers, 'Proveedor');
      const sI = col(sal.headers, 'Productos', 'Producto', 'Item');
      const sM = col(sal.headers, 'Material');
      const sC = col(sal.headers, 'Cantidad');
      const sF = col(sal.headers, 'Folio cliente', 'Folio');
      const sP2 = col(sal.headers, 'Numero de pedido', 'Número de pedido', 'No. de pedido', 'Pedido Proveedor', 'Pedido');
      if (sI) sal.rows.forEach(r => {
        const it = txt(r[sI]);
        if (!it) return;
        const d = get(sPr ? r[sPr] : '', it, sM ? r[sM] : '');
        const c = sC ? num(r[sC]) : 0;
        d.salidas += c;
        // Si la salida dice de qué pedido vino, se le descuenta a ese
        const kped = txt(sP2 ? r[sP2] : '');
        if (kped && d.pedidos[kped]) d.pedidos[kped].salidas += c;
        else d.sinPedido = (d.sinPedido || 0) + c;
        const fol = txt(sF ? r[sF] : '');
        if (fol) d.destinos[fol] = (d.destinos[fol] || 0) + 0;   // registra el destino
      });
    }

    const filas = Object.keys(inv).map(k => {
      const d = inv[k];
      // Lo que el proveedor tiene terminado y todavía no sale
      const enProveedor = Math.max(0, d.entregadas - d.salidas);
      return {
        proveedor: d.proveedor, producto: d.producto, material: d.material,
        pedidas: d.pedidas, entregadas: d.entregadas, salidas: d.salidas,
        porFabricar: Math.max(0, d.pedidas - d.entregadas),
        disponible: enProveedor,
        comprometidas: d.comprometidas,
        libres: Math.max(0, enProveedor - 0),
        costoUnitario: d.costoUnitario,
        pedidos: Object.keys(d.pedidos).map(x => {
          const q = d.pedidos[x];
          return {
            pedido: q.pedido, status: q.status, fecha: q.fecha, estimada: q.estimada,
            pedidas: q.pedidas, entregadas: q.entregadas, salidas: q.salidas,
            porFabricar: Math.max(0, q.pedidas - q.entregadas),
            disponibles: Math.max(0, q.entregadas - q.salidas),
            costo: q.costo, filas: q.filas
          };
        }).sort((a, b) => b.disponibles - a.disponibles || b.porFabricar - a.porFabricar),
        salidasSinPedido: d.sinPedido || 0,
        destinos: Object.keys(d.destinos)
      };
    }).filter(x => x.pedidas || x.entregadas || x.salidas);

    const porProveedor = {};
    filas.forEach(f => {
      const k = f.proveedor || 'Sin proveedor';
      if (!porProveedor[k]) porProveedor[k] = { proveedor: k, lineas: [], disponible: 0, porFabricar: 0 };
      porProveedor[k].lineas.push(f);
      porProveedor[k].disponible += f.disponible;
      porProveedor[k].porFabricar += f.porFabricar;
    });

    return res.status(200).json({
      ok: true,
      proveedores: Object.keys(porProveedor).map(k => {
        const p = porProveedor[k];
        p.lineas.sort((a, b) => b.disponible - a.disponible);
        return p;
      }).sort((a, b) => b.disponible - a.disponible),
      totales: {
        disponible: filas.reduce((a, x) => a + x.disponible, 0),
        porFabricar: filas.reduce((a, x) => a + x.porFabricar, 0),
        combinaciones: filas.length,
        // Entradas capturadas con un número de pedido que no está en la hoja de
        // Pedidos: no se le pueden cargar a ningún proveedor.
        entradasSinPedido
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
