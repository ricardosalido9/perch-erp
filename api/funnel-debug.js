// Diagnóstico de la hoja del Funnel. Abrir en el navegador:
//   /api/funnel-debug                      -> área "funnel" (Montse 2026)
//   /api/funnel-debug?area=fin_cxc         -> cualquier otra área de SHEETS
//   /api/funnel-debug?id=...&tab=Nombre    -> archivo/pestaña sueltos
// Sirve para ver encabezados y los valores reales de cada columna. Se puede borrar
// cuando el embudo ya esté afinado.
const core = require('../lib/core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function colLetter(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const area = q.area || 'funnel';
    const cfg = core.SHEETS[area] || {};
    const id = q.id || cfg.id;
    const tab = q.tab || cfg.sheetName;
    if (!id || !tab) {
      return res.status(400).json({
        ok: false,
        error: 'El servidor no conoce el área "' + area + '".',
        areas_configuradas: Object.keys(core.SHEETS || {}),
        pista: 'Si el área que buscas no aparece en la lista, lib/core.js no está actualizado en Vercel.'
      });
    }

    let values;
    try { values = await core.readRange(id, tab); }
    catch (e) {
      let pestanas = null;
      try { pestanas = await core.listTabs(id); } catch (e2) { pestanas = null; }
      return res.status(500).json({
        ok: false, area: area, id: id, pestana_buscada: tab,
        pestanas_del_archivo: pestanas,
        error: e.message || String(e),
        pista: 'Revisa que la pestaña exista con ese nombre y que el archivo esté compartido con la cuenta de servicio.'
      });
    }
    if (!values.length) return res.status(200).json({ ok: true, area: area, pestana: tab, aviso: 'La pestaña está vacía.' });

    // Fila de encabezados: la de las primeras 4 con más celdas de texto
    let hr = 0, best = -1;
    for (let i = 0; i < Math.min(4, values.length); i++) {
      const cells = (values[i] || []).filter(c => txt(c) !== '');
      const textos = cells.filter(c => isNaN(Number(txt(c).replace(/[$,%\s]/g, '')))).length;
      if (cells.length + textos > best) { best = cells.length + textos; hr = i; }
    }
    if (q.headerRow) hr = parseInt(q.headerRow, 10) - 1;

    const headers = (values[hr] || []).map(h => txt(h));
    const filas = values.slice(hr + 1).filter(r => (r || []).some(c => txt(c) !== ''));

    const columnas = headers.map((name, i) => {
      const vals = filas.map(r => txt((r || [])[i])).filter(v => v !== '');
      const cuenta = {};
      vals.forEach(v => { cuenta[v] = (cuenta[v] || 0) + 1; });
      const uniq = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
      const out = {
        letra: colLetter(i), nombre: name || '(sin encabezado)',
        llenas: vals.length, distintos: uniq.length, ejemplos: vals.slice(0, 3)
      };
      if (uniq.length && uniq.length <= 30) {
        out.catalogo = uniq.map(v => ({ valor: v, n: cuenta[v] }));
      }
      return out;
    });

    return res.status(200).json({
      ok: true, area: area, archivo_id: id, pestana: tab,
      fila_de_encabezados: hr + 1, filas_con_datos: filas.length,
      columnas: columnas, primeras_filas: filas.slice(0, 5)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
