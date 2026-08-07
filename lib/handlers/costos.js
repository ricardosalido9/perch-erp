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

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ven, sal, ped, cat] = await Promise.all([
      leer('ventas_registro'), leer('prov_salidas'), leer('prov_pedidos'), leer('inventario')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });
    if (!sal.headers.length) return res.status(400).json({ error: 'No se pudo leer la hoja Salidas del archivo de Operación.' });

    // --- Costo unitario real, por pedido de proveedor + producto, y respaldo por producto ---
    const exacto = {}, porProd = {};
    if (ped.headers.length) {
      const pP = col(ped.headers, 'Pedido Proveedor');
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item'), pM = col(ped.headers, 'Material');
      const pC = col(ped.headers, 'Costo Unitario');
      if (pC) ped.rows.forEach(r => {
        const cu = num(r[pC]);
        if (!cu) return;
        const k = norm(pP ? r[pP] : '') + '|' + norm(pI ? r[pI] : '') + '|' + norm(pM ? r[pM] : '');
        if (exacto[k] === undefined) exacto[k] = cu;
        const k2 = norm(pI ? r[pI] : '') + '|' + norm(pM ? r[pM] : '');
        (porProd[k2] = porProd[k2] || []).push(cu);
      });
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

    // --- Lo que salió a cada folio ---
    const sF = col(sal.headers, 'Folio cliente', 'Folio');
    const sI = col(sal.headers, 'Productos', 'Producto', 'Item'), sM = col(sal.headers, 'Material');
    const sC = col(sal.headers, 'Cantidad'), sP = col(sal.headers, 'Pedido Proveedor', 'Pedido');
    const sPr = col(sal.headers, 'Proveedor');
    const salidas = {};
    // Una misma salida puede venir duplicada si se consolidaron dos archivos
    const salRows = (sF && sI) ? sinRepetidos(sal.rows, [sF, sI, sM, sC, sP].filter(Boolean)) : sal.rows;
    if (sF) salRows.forEach(r => {
      const f = txt(r[sF]).toUpperCase();
      if (!f) return;
      const c = sC ? num(r[sC]) : 0;
      if (!c) return;
      const kx = norm(sP ? r[sP] : '') + '|' + norm(sI ? r[sI] : '') + '|' + norm(sM ? r[sM] : '');
      const kp = norm(sI ? r[sI] : '') + '|' + norm(sM ? r[sM] : '');
      let cu = exacto[kx];
      let fuente = 'pedido';
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
          proveedor: txt(sPr ? r[sPr] : ''), pedido: txt(sP ? r[sP] : ''),
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

    const folios = {};
    ven.rows.forEach(r => {
      const f = txt(r[vF]).toUpperCase();
      if (!f) return;
      const t = num(r[vT]);
      const co = vCo ? num(r[vCo]) : 0;
      if (!t && !co) return;                       // fila de fórmula arrastrada
      const d = folios[f] = folios[f] || { folio: f, cliente: '', fecha: '', venta: 0, costoVentas: 0 };
      d.venta += t; d.costoVentas += co;
      if (!d.cliente && vC) d.cliente = txt(r[vC]);
      if (!d.fecha && vFe) {
        d.fecha = txt(r[vFe]);
        const m = d.fecha.match(/(20\d{2})/);
        d.anio = m ? +m[1] : null;
      }
    });

    const filas = Object.keys(folios).map(f => {
      const d = folios[f], s = salidas[f] || null;
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
        detalle: s ? s.det : []
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
