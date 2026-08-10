// Comparativo de costos por folio de venta.
// Cruza cuatro fuentes:
//   VENTAS   -> cuánto se vendió y qué costo trae hoy la hoja
//   Salidas  -> qué piezas salieron a ese folio
//   Pedidos  -> cuánto costó realmente cada pieza (por pedido de proveedor)
//   Catálogo -> cuánto dice la lista de precios que cuesta
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES_N = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  m = s.match(/^([a-z]+)[-\s](\d{4})$/);            // "noviembre-2025"
  if (m && MESES_N[m[1]]) return +m[2] * 10000 + MESES_N[m[1]] * 100;
  return null;
}
function col(headers, ...nombres) {
  for (const n of nombres) {
    const h = headers.filter(x => norm(x) === norm(n))[0];
    if (h) return h;
  }
  return null;
}
// Quita filas idénticas (misma salida cargada desde dos archivos distintos)
function sinRepetidos(rows, campos) {
  const vistos = {}, out = [];
  rows.forEach(r => {
    const k = campos.map(c => norm(r[c])).join('|');
    if (vistos[k]) return;
    vistos[k] = 1; out.push(r);
  });
  return out;
}

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

// A partir de este año se calcula el costo real desde producción.
// Lo anterior se congela con lo que dice VENTAS: no vale la pena reconstruirlo.
const ANIO_REAL_DESDE = 2026;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ven, sal, ped, cat] = await Promise.all([
      leer('ventas_registro'), leer('prov_salidas'), leer('prov_pedidos'), leer('inventario')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });
    if (!sal.headers.length) return res.status(400).json({ error: 'No se pudo leer la hoja Salidas del archivo de Operación.' });

    // --- Costo unitario real ---
    // Orden de búsqueda: 1) el pedido exacto  2) el mismo proveedor para ese producto
    // 3) promedio del producto. El paso 2 es el que salva las salidas viejas, donde
    // el número de pedido se perdió pero sí quedó registrado el proveedor.
    const exacto = {}, porProv = {}, porProd = {};
    if (ped.headers.length) {
      const pP = col(ped.headers, 'Pedido Proveedor');
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item'), pM = col(ped.headers, 'Material');
      const pC = col(ped.headers, 'Costo Unitario');
      const pPr = col(ped.headers, 'Proveedor');
      const pF = col(ped.headers, 'Fecha');
      if (pC) ped.rows.forEach(r => {
        const cu = num(r[pC]);
        if (!cu) return;
        const prod = norm(pI ? r[pI] : '') + '|' + norm(pM ? r[pM] : '');
        const k = norm(pP ? r[pP] : '') + '|' + prod;
        if (exacto[k] === undefined) exacto[k] = cu;
        const kv = norm(pPr ? r[pPr] : '') + '|' + prod;
        (porProv[kv] = porProv[kv] || []).push({
          cu: cu, d: pF ? (fechaNum(r[pF]) || 0) : 0, pedido: txt(pP ? r[pP] : ''),
          cant: num(r[col(ped.headers, 'Cantidad')]) || 1
        });
        (porProd[prod] = porProd[prod] || []).push(cu);
      });
    }
    // El inventario rota por antigüedad: lo que entró primero, sale primero.
    // Se consumen los pedidos de ese proveedor del más viejo al más nuevo.
    Object.keys(porProv).forEach(k => {
      porProv[k].sort((a, b) => (a.d || 0) - (b.d || 0));
      porProv[k].forEach(x => { x.queda = x.cant; });
    });
    function costoDeProveedor(prov, prod, piezas) {
      const l = porProv[norm(prov) + '|' + prod];
      if (!l || !l.length) return null;
      const lote = l.filter(x => x.queda > 0)[0] || l[0];
      lote.queda = Math.max(0, (lote.queda || 0) - (piezas || 1));
      const precios = l.map(x => x.cu).filter((v, i, a) => a.indexOf(v) === i);
      return { cu: lote.cu, pedido: lote.pedido, unico: precios.length === 1 };
    }
    // --- Costo del catálogo ---
    const costoCat = {};
    if (cat.headers.length) {
      const cI = col(cat.headers, 'Productos', 'Producto');
      const cM = col(cat.headers, 'Material');
      const cC = col(cat.headers, 'Costos Total', 'Costo Unitario', 'Costo Total');
      if (cI && cC) cat.rows.forEach(r => {
        const k = norm(r[cI]) + '|' + norm(cM ? r[cM] : '');
        if (costoCat[k] === undefined) costoCat[k] = num(r[cC]);
      });
    }

    // --- Piezas que el pedido ya asignó a un folio de venta ---
    // Cuando Nico pide algo directo para un cliente, el propio pedido trae el folio.
    // Ese es el costo exacto: no hace falta esperar la salida.
    const salidas = {};
    const yaContado = {};
    if (ped.headers.length) {
      const qF = col(ped.headers, 'Folio cliente', 'Folio Cliente');
      const qP = col(ped.headers, 'Pedido Proveedor');
      const qI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const qM = col(ped.headers, 'Material');
      const qC = col(ped.headers, 'Cantidad');
      const qU = col(ped.headers, 'Costo Unitario');
      const qPr = col(ped.headers, 'Proveedor');
      if (qF && qU) ped.rows.forEach(r => {
        const f = txt(r[qF]).toUpperCase();
        if (!f || ['STOCK', 'EXHIBICION', 'EXHIBICIÓN', ''].indexOf(f) !== -1) return;
        const c = qC ? num(r[qC]) : 0;
        const cu = num(r[qU]);
        if (!c || !cu) return;
        const d = salidas[f] = salidas[f] || { piezas: 0, real: 0, cat: 0, sinCosto: 0, prov: {}, aprox: 0, det: [] };
        d.piezas += c; d.real += cu * c;
        const kp = norm(qI ? r[qI] : '') + '|' + norm(qM ? r[qM] : '');
        const cc = costoCat[kp];
        if (cc !== undefined) d.cat += cc * c;
        if (qPr && txt(r[qPr])) d.prov[txt(r[qPr])] = 1;
        const ky = f + '|' + kp;
        yaContado[ky] = (yaContado[ky] || 0) + c;
        if (d.det.length < 40) {
          d.det.push({
            producto: txt(qI ? r[qI] : ''), material: txt(qM ? r[qM] : ''),
            proveedor: txt(qPr ? r[qPr] : ''), pedido: txt(qP ? r[qP] : ''),
            cantidad: c, costoUnitario: Math.round(cu * 100) / 100,
            fuente: 'pedido directo', opciones: [],
            catalogo: (cc === undefined) ? null : Math.round(cc * 100) / 100
          });
        }
      });
    }

    // --- Lo que salió a cada folio ---
    const sF = col(sal.headers, 'Folio cliente', 'Folio');
    const sI = col(sal.headers, 'Productos', 'Producto', 'Item'), sM = col(sal.headers, 'Material');
    const sC = col(sal.headers, 'Cantidad'), sP = col(sal.headers, 'Pedido Proveedor', 'Pedido');
    const sPr = col(sal.headers, 'Proveedor');
    const sCU = col(sal.headers, 'Costo Unitario');   // la salida puede traer su propio costo
    // Una misma salida puede venir duplicada si se consolidaron dos archivos
    let salRows = (sF && sI) ? sinRepetidos(sal.rows, [sF, sI, sM, sC, sP].filter(Boolean)) : sal.rows;
    const sFe = col(sal.headers, 'Fecha');
    if (sFe) salRows = salRows.slice().sort((a, b) => (fechaNum(a[sFe]) || 99999999) - (fechaNum(b[sFe]) || 99999999));
    if (sF) salRows.forEach(r => {
      const f = txt(r[sF]).toUpperCase();
      if (!f) return;
      const kx = norm(sP ? r[sP] : '') + '|' + norm(sI ? r[sI] : '') + '|' + norm(sM ? r[sM] : '');
      const kp = norm(sI ? r[sI] : '') + '|' + norm(sM ? r[sM] : '');
      // Si el pedido ya asignó estas piezas a este folio, no se cuentan dos veces.
      // Se descuenta por cantidad: si el pedido cubrió 2 y la salida trae 3, solo cuenta 1.
      const ky = f + '|' + kp;
      let c = sC ? num(r[sC]) : 0;
      if (!c) return;
      if (yaContado[ky]) {
        const usar = Math.min(yaContado[ky], c);
        yaContado[ky] -= usar;
        c -= usar;
        if (c <= 0) return;
      }
      let cu, fuente, pedidoUsado = txt(sP ? r[sP] : '');
      const cuPropio = sCU ? num(r[sCU]) : 0;
      if (cuPropio) { cu = cuPropio; fuente = 'costo de la salida'; }
      if (cu === undefined) { cu = exacto[kx]; if (cu !== undefined) fuente = 'pedido'; }
      if (cu === undefined && sPr && txt(r[sPr])) {
        const p2 = costoDeProveedor(txt(r[sPr]), kp, c);
        if (p2) { cu = p2.cu; fuente = p2.unico ? 'proveedor' : 'lote más antiguo'; pedidoUsado = p2.pedido; }
      }
      if (cu === undefined && porProd[kp]) {
        cu = porProd[kp].reduce((a, b) => a + b, 0) / porProd[kp].length;
        fuente = 'promedio';
      }
      const d = salidas[f] = salidas[f] || { piezas: 0, real: 0, cat: 0, sinCosto: 0, prov: {}, aprox: 0, det: [] };
      d.piezas += c;
      if (cu === undefined) d.sinCosto++;
      else { d.real += cu * c; if (fuente === 'promedio') d.aprox++; }
      const cc = costoCat[kp];
      if (cc !== undefined) d.cat += cc * c;
      if (sPr && txt(r[sPr])) d.prov[txt(r[sPr])] = 1;
      if (d.det.length < 30) {
        d.det.push({
          producto: txt(sI ? r[sI] : ''), material: txt(sM ? r[sM] : ''),
          proveedor: txt(sPr ? r[sPr] : ''), pedido: pedidoUsado,
          cantidad: c,
          costoUnitario: (cu === undefined) ? null : Math.round(cu * 100) / 100,
          fuente: (cu === undefined) ? 'sin costo' : fuente,
          opciones: (fuente === 'promedio' && porProd[kp])
            ? porProd[kp].filter((v, i2, a) => a.indexOf(v) === i2).sort((a2, b2) => a2 - b2).slice(0, 6)
            : [],
          catalogo: (cc === undefined) ? null : Math.round(cc * 100) / 100
        });
      }
    });

    // --- Ventas por folio ---
    const vF = col(ven.headers, 'No. de Referencia', 'Referencia', 'Folio');
    const vC = col(ven.headers, 'Cliente');
    const vT = col(ven.headers, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
    const vCo = col(ven.headers, 'Costo total', 'Costo Total');
    const vFe = col(ven.headers, 'Fecha del Cierre');
    if (!vF || !vT) return res.status(400).json({ error: 'VENTAS no tiene folio o total sin impuestos.' });

    const vPr = col(ven.headers, 'Producto', 'Productos');
    const vMa = col(ven.headers, 'Material');
    const vCa = col(ven.headers, 'Cantidad');
    const folios = {};
    ven.rows.forEach(r => {
      const f = txt(r[vF]).toUpperCase();
      if (!f) return;
      const t = num(r[vT]);
      const co = vCo ? num(r[vCo]) : 0;
      if (!t && !co) return;                       // fila de fórmula arrastrada
      const d = folios[f] = folios[f] || { folio: f, cliente: '', fecha: '', venta: 0, costoVentas: 0, lineas: [] };
      d.venta += t; d.costoVentas += co;
      d.lineas.push({
        producto: vPr ? txt(r[vPr]) : '', material: vMa ? txt(r[vMa]) : '',
        cantidad: vCa ? num(r[vCa]) : 0, costo: co, venta: t
      });
      if (!d.cliente && vC) d.cliente = txt(r[vC]);
      if (!d.fecha && vFe) {
        d.fecha = txt(r[vFe]);
        const m = d.fecha.match(/(20\d{2})/);
        d.anio = m ? +m[1] : null;
      }
    });

    const filas = Object.keys(folios).map(f => {
      const d = folios[f];
      // Histórico: se toma el costo de la hoja de Ventas tal cual y no se recalcula
      if (d.anio && d.anio < ANIO_REAL_DESDE) {
        const cv = Math.round(d.costoVentas * 100) / 100;
        const mgh = d.venta ? Math.round(((d.venta - cv) / d.venta) * 1000) / 10 : null;
        return {
          folio: f, cliente: d.cliente, fecha: d.fecha, anio: d.anio,
          venta: Math.round(d.venta * 100) / 100,
          piezas: (salidas[f] ? salidas[f].piezas : 0),
          proveedores: salidas[f] ? Object.keys(salidas[f].prov).join(' / ') : '',
          costoReal: cv, margenReal: mgh,
          costoVentas: cv, margenVentas: mgh,
          costoCatalogo: null, margenCatalogo: null,
          sinCostear: 0, aproximados: 0, historico: true,
          detalle: [], lineasVenta: d.lineas || []
        };
      }
      const s = salidas[f] || null;
      const real = s ? Math.round(s.real * 100) / 100 : null;
      const cta = (s && s.cat) ? Math.round(s.cat * 100) / 100 : null;
      const mg = (c) => (c === null || !d.venta) ? null : Math.round(((d.venta - c) / d.venta) * 1000) / 10;
      return {
        folio: f, cliente: d.cliente, fecha: d.fecha, anio: d.anio,
        venta: Math.round(d.venta * 100) / 100,
        piezas: s ? s.piezas : 0,
        proveedores: s ? Object.keys(s.prov).join(' / ') : '',
        costoReal: real, margenReal: mg(real),
        costoVentas: Math.round(d.costoVentas * 100) / 100, margenVentas: mg(d.costoVentas),
        costoCatalogo: cta, margenCatalogo: mg(cta),
        sinCostear: s ? s.sinCosto : 0,
        aproximados: s ? s.aprox : 0,
        detalle: s ? s.det : [],
        lineasVenta: d.lineas || []
      };
    }).filter(x => x.venta > 0)
      .sort((a, b) => (a.folio < b.folio ? 1 : -1));

    return res.status(200).json({
      ok: true,
      folios: filas,
      conSalidas: filas.filter(x => x.costoReal !== null).length,
      catalogoOk: !!Object.keys(costoCat).length,
      pedidosOk: !!Object.keys(exacto).length
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
