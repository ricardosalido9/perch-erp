// Surtir ventas: de dónde sale cada pieza que todavía se debe.
//
// Es "Mandar a venta" al revés. Hoy se empieza por el pedido —llegó esto, ¿a
// quién se lo doy?— y así se piensa en producción. Pero quien vende lo piensa al
// contrario: tengo esta venta, ¿de dónde la surto?
//
// Para cada pieza pendiente dice si hay en bodega —y deja asignarla de un clic— o
// qué proveedores ya la han hecho, con su costo y sus días de entrega, para
// mandarles el pedido sin salir de aquí.
//
//   ?action=surtir                      lista lo pendiente
//   ?action=surtir  { hacer:'stock' }   asigna de bodega
//   ?action=surtir  { hacer:'pedido' }  manda pedido al proveedor
const core = require('../core');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
function hoyLargo() {
  const d = new Date();
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers: H, rows };
}
const pieza = (prod, mat) => norm(prod) + '|' + norm(mat);
const esSoloSaldo = (n) => /^\s*saldo inicial del corte/i.test(String(n || ''));

module.exports = async (req, res) => {
  try {
    const body = Object.assign({}, req.query || {}, await core.readBody(req));
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    // ---- Acciones ----
    if (body.hacer === 'stock' || body.hacer === 'pedido') {
      if (core.verifyWriter && !core.verifyWriter(body.token)) {
        return res.status(403).json({ error: 'Tu usuario no puede registrar movimientos.' });
      }
      const cant = Math.round(num(body.cantidad));
      if (!txt(body.folio) || !txt(body.producto) || cant <= 0) {
        return res.status(400).json({ error: 'Falta el folio, el producto o la cantidad.' });
      }

      if (body.hacer === 'stock') {
        // Sale de bodega hacia esa venta: es una salida de inventario normal
        const r = await core.addRecord('prov_salidas', {
          'Fecha de cierre de venta': hoyLargo(), 'Fecha': hoyLargo(),
          'Folio': txt(body.folio), 'Folio cliente': txt(body.folio),
          'Cliente': txt(body.cliente),
          'Pedido Proveedor': txt(body.pedido), 'Proveedor': txt(body.proveedor),
          'Producto': txt(body.producto), 'Productos': txt(body.producto),
          'Item': txt(body.producto), 'Material': txt(body.material),
          'Cantidad': cant,
          'Costo Unitario': num(body.costo),
          'Costo Total': Math.round(num(body.costo) * cant * 100) / 100,
          'Comentarios': 'Surtido desde bodega por ' + (sesion.u || '')
        });
        return res.status(200).json({ ok: true, hecho: 'stock', filas: 1,
          mensaje: cant + (cant === 1 ? ' pieza asignada' : ' piezas asignadas') +
                   ' a ' + txt(body.folio) + ' desde bodega.', detalle: r });
      }

      // Pedido al proveedor para esa venta
      if (!txt(body.proveedor)) return res.status(400).json({ error: 'Falta el proveedor.' });
      const costo = num(body.costo);
      const rec = {
        'Fecha': hoyLargo(), 'Mes': new Date().getMonth() + 1, 'Año': new Date().getFullYear(),
        'Status': 'PENDIENTE COMPLETO',
        'Pedido Proveedor': txt(body.pedidoNuevo) || '',
        'Folio cliente': txt(body.folio), 'Cliente': txt(body.cliente),
        'Proveedor': txt(body.proveedor),
        'Productos': txt(body.producto), 'Producto': txt(body.producto),
        'Material': txt(body.material), 'Cantidad': cant,
        'Costo Unitario': costo,
        'Costo Total': Math.round(costo * cant * 100) / 100,
        'Costo Total + IVA': Math.round(costo * cant * 1.16 * 100) / 100,
        'Destino': txt(body.folio),
        'Especificaciones': txt(body.especificaciones)
      };
      const r2 = await core.addRecord('prov_pedidos', rec);
      return res.status(200).json({ ok: true, hecho: 'pedido', filas: 1,
        mensaje: 'Pedido a ' + txt(body.proveedor) + ' por ' + cant +
                 (cant === 1 ? ' pieza' : ' piezas') + ' para ' + txt(body.folio) + '.',
        detalle: r2 });
    }

    // ---- Lo pendiente ----
    const [ven, ped, ent, sal, provs] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('prov_entradas'),
      leer('prov_salidas'), leer('compras_proveedores')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer las ventas.' });

    const vF = col(ven.headers, 'No. de Referencia', 'Folio');
    const vC = col(ven.headers, 'Cliente');
    const vP = col(ven.headers, 'Producto', 'Productos');
    const vM = col(ven.headers, 'Material');
    const vQ = col(ven.headers, 'Cantidad');
    const vS = col(ven.headers, 'Status');
    const vE = col(ven.headers, 'Especificaciones');
    const vFe = col(ven.headers, 'Fecha del Cierre', 'Fecha');
    if (!vF || !vP) return res.status(400).json({ error: 'La hoja de ventas no tiene folio o producto.' });

    // Lo que ya salió de bodega hacia cada venta
    const surtido = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio', 'Folio cliente');
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      if (sF && sP) sal.rows.forEach(r => {
        const k = norm(r[sF]) + '||' + pieza(r[sP], sM ? r[sM] : '');
        surtido[k] = (surtido[k] || 0) + (sQ ? num(r[sQ]) : 0);
      });
    }

    // Lo que hay en bodega: entradas menos salidas, por pieza
    const bodega = {};
    if (ent.headers.length) {
      const eI = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eQ = col(ent.headers, 'Cantidad');
      if (eI) ent.rows.forEach(r => {
        const k = pieza(r[eI], eM ? r[eM] : '');
        bodega[k] = (bodega[k] || 0) + (eQ ? num(r[eQ]) : 0);
      });
    }
    if (sal.headers.length) {
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      if (sP) sal.rows.forEach(r => {
        const k = pieza(r[sP], sM ? r[sM] : '');
        bodega[k] = (bodega[k] || 0) - (sQ ? num(r[sQ]) : 0);
      });
    }

    // Quién ha hecho cada pieza, con su último costo. Es mejor lista que la de
    // todos los proveedores: el que ya la hizo sabe cómo se hace.
    const quienLoHace = {};
    if (ped.headers.length) {
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pM = col(ped.headers, 'Material');
      const pPr = col(ped.headers, 'Proveedor');
      const pCU = col(ped.headers, 'Costo Unitario');
      const pFe = col(ped.headers, 'Fecha');
      if (pI && pPr) ped.rows.forEach(r => {
        const prod = txt(r[pI]);
        if (!prod || esSoloSaldo(prod)) return;
        const prov = txt(r[pPr]);
        if (!prov) return;
        const k = pieza(prod, pM ? r[pM] : '');
        quienLoHace[k] = quienLoHace[k] || {};
        const a = quienLoHace[k][prov] = quienLoHace[k][prov] || { proveedor: prov, veces: 0, costo: 0 };
        a.veces++;
        const c = pCU ? num(r[pCU]) : 0;
        if (c) a.costo = c;                       // el último costo conocido
        if (pFe) a.ultimaVez = txt(r[pFe]);
      });
    }
    // Los días de entrega que cada proveedor declara
    const dias = {};
    if (provs.headers.length) {
      const nP = col(provs.headers, 'Proveedor', 'Nombre/Razón Social', 'Razón Social');
      const nD = col(provs.headers, 'Días de Entrega', 'Dias de Entrega', 'Días de entrega');
      if (nP && nD) provs.rows.forEach(r => {
        const d = txt(r[nD]);
        if (d) dias[norm(r[nP])] = d;
      });
    }

    const pendientes = [];
    ven.rows.forEach(r => {
      const status = txt(vS ? r[vS] : '');
      if (/cancelad/i.test(status)) return;
      const folio = txt(r[vF]);
      const prod = txt(r[vP]);
      if (!folio || !prod) return;
      const mat = txt(vM ? r[vM] : '');
      const vendidas = vQ ? num(r[vQ]) : 0;
      if (vendidas <= 0) return;
      const k = pieza(prod, mat);
      const ya = surtido[norm(folio) + '||' + k] || 0;
      const falta = Math.round(vendidas - ya);
      if (falta <= 0) return;

      const hay = Math.max(0, Math.round(bodega[k] || 0));
      const lista = Object.keys(quienLoHace[k] || {})
        .map(p => Object.assign({}, quienLoHace[k][p], { dias: dias[norm(p)] || '' }))
        .sort((a, b) => b.veces - a.veces);
      pendientes.push({
        folio, cliente: txt(vC ? r[vC] : ''), fecha: txt(vFe ? r[vFe] : ''),
        producto: prod, material: mat,
        especificaciones: txt(vE ? r[vE] : ''),
        vendidas, surtidas: ya, falta,
        enBodega: hay,
        puedeDeStock: Math.min(hay, falta),
        proveedores: lista.slice(0, 6)
      });
    });

    // Agrupadas por venta, que es como se trabajan
    const porFolio = {};
    pendientes.forEach(p => {
      (porFolio[p.folio] = porFolio[p.folio] ||
        { folio: p.folio, cliente: p.cliente, fecha: p.fecha, piezas: [] }).piezas.push(p);
    });

    return res.status(200).json({
      ok: true,
      ventas: Object.keys(porFolio).map(k => porFolio[k]),
      totales: {
        ventas: Object.keys(porFolio).length,
        piezas: pendientes.reduce((a, x) => a + x.falta, 0),
        deStock: pendientes.reduce((a, x) => a + x.puedeDeStock, 0),
        porPedir: pendientes.reduce((a, x) => a + (x.falta - x.puedeDeStock), 0),
        sinProveedor: pendientes.filter(x => !x.proveedores.length && !x.puedeDeStock).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
