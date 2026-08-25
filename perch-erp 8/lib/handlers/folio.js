// Radiografía de un folio: los renglones crudos de las tres hojas, tal cual están.
// Abrir en el navegador:  /api/erp?action=folio&f=MY29-26
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], donde: '(no configurado)' };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], donde: cfg.sheetName, error: e.message }; }
  if (!values.length) return { headers: [], rows: [], donde: cfg.sheetName };
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
  return { headers, rows, donde: cfg.sheetName, archivo: cfg.id };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const body = req._body || {};
    const folio = String(q.f || q.folio || body.folio || '').trim().toUpperCase();
    if (!folio) return res.status(400).json({ error: 'Falta ?f=FOLIO' });

    const [ven, sal, ped] = await Promise.all([
      leer('ventas_registro'), leer('prov_salidas'), leer('prov_pedidos')
    ]);

    const filtra = (t, nombres, campos) => {
      const c = col(t.headers, ...nombres);
      if (!c) return { columnaFolio: '(no encontrada)', renglones: [] };
      const cols = campos.map(n => col(t.headers, ...n)).filter(Boolean);
      return {
        columnaFolio: c,
        pestana: t.donde,
        renglones: t.rows.filter(r => txt(r[c]).toUpperCase() === folio).map(r => {
          const o = { fila: r._fila };
          cols.forEach(x => { o[x] = r[x]; });
          return o;
        })
      };
    };

    return res.status(200).json({
      ok: true, folio: folio,
      ventas: filtra(ven, ['No. de Referencia', 'Referencia', 'Folio'],
        [['Producto', 'Productos'], ['Material'], ['Cantidad'], ['Precio Unitario'],
         ['Costo Unitario'], ['Costo total', 'Costo Total'], ['Total con envio sin impuestos']]),
      pedidos: filtra(ped, ['Folio cliente', 'Folio Cliente'],
        [['Pedido Proveedor'], ['Proveedor'], ['Productos', 'Producto', 'Item'], ['Material'],
         ['Cantidad'], ['Costo Unitario'], ['Entradas']]),
      salidas: filtra(sal, ['Folio cliente', 'Folio'],
        [['Pedido Proveedor', 'Pedido'], ['Proveedor'], ['Productos', 'Producto', 'Item'],
         ['Material'], ['Cantidad'], ['Costo Unitario'], ['Costo']])
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
