// Inventario por proveedor y por mueble.
// Responde: ¿qué tiene TANDEM guardado de Silla Uma en Nogal? ¿cuánto le pedí,
// cuánto entregó, cuánto ya salió a clientes y cuánto le queda disponible?
const core = require('../core');

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
    const pE = col(ped.headers, 'Entradas');
    const pP = col(ped.headers, 'Pedido Proveedor');
    const pF = col(ped.headers, 'Folio cliente', 'Folio Cliente', 'Folio');
    const pU = col(ped.headers, 'Costo Unitario');
    const pSt = col(ped.headers, 'Status');
    const pF2 = col(ped.headers, 'Fecha');
    const pEst = col(ped.headers, 'Fecha Estimada de Entrega');
    if (!pPr || !pI) return res.status(400).json({ error: 'Faltan las columnas Proveedor y Producto.' });

    // Llave: proveedor + producto + material
    const inv = {};
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
      const it = txt(r[pI]);
      if (!it) return;
      const d = get(r[pPr], it, pM ? r[pM] : '');
      const c = pC ? num(r[pC]) : 0;
      const e = pE ? num(r[pE]) : 0;
      d.pedidas += c;
      d.entregadas += e;
      if (d.costoUnitario === null && pU && num(r[pU])) d.costoUnitario = num(r[pU]);
      const kp = txt(pP ? r[pP] : '') || '(sin pedido)';
      if (!d.pedidos[kp]) d.pedidos[kp] = {
        pedido: kp, pedidas: 0, entregadas: 0, salidas: 0, status: '', costo: null,
        fecha: '', estimada: '', filas: []
      };
      d.pedidos[kp].pedidas += c;
      d.pedidos[kp].entregadas += e;
      if (!d.pedidos[kp].status && pSt) d.pedidos[kp].status = txt(r[pSt]);
      if (d.pedidos[kp].costo === null && pU) d.pedidos[kp].costo = num(r[pU]) || null;
      if (!d.pedidos[kp].fecha && pF2) d.pedidos[kp].fecha = txt(r[pF2]);
      if (!d.pedidos[kp].estimada && pEst) d.pedidos[kp].estimada = txt(r[pEst]);
      if (d.pedidos[kp].filas.length < 20) d.pedidos[kp].filas.push(r._fila);
      // Piezas que el pedido ya reservó para un cliente
      const fol = txt(pF ? r[pF] : '');
      if (fol && ['stock', 'exhibicion', 'exhibición'].indexOf(norm(fol)) === -1) {
        d.comprometidas += c;
        d.destinos[fol] = (d.destinos[fol] || 0) + c;
      }
    });

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
        combinaciones: filas.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
