// Llena una o varias columnas en TODAS las filas que coincidan con un valor.
// Se usa para escribir la Descripción y las Medidas de un producto del catálogo
// en sus ~10 variantes de una sola vez, con una sola escritura.
//
// Body: { token, key, match: { col, value }, set: { 'Descripción': '...', 'Medidas': '...' } }
const core = require('../core');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function colLetter(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const key = body.key;
    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg) return res.status(400).json({ error: 'Esta área no está conectada.' });

    const match = body.match || {};
    const set = body.set || {};
    if (!match.col || !String(match.value || '').trim()) {
      return res.status(400).json({ error: 'Falta indicar qué filas actualizar.' });
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'No hay nada que guardar.' });

    const values = await core.readRange(cfg.id, cfg.sheetName);
    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const headers = (values[hr] || []).map(h => String(h));

    const iMatch = headers.findIndex(h => norm(h) === norm(match.col));
    if (iMatch === -1) return res.status(400).json({ error: 'No se encontró la columna "' + match.col + '".' });

    // Columnas a escribir (deben existir en la hoja)
    const destinos = [];
    Object.keys(set).forEach(nombre => {
      const i = headers.findIndex(h => norm(h) === norm(nombre));
      if (i !== -1) destinos.push({ i, valor: set[nombre] });
    });
    if (!destinos.length) {
      return res.status(400).json({
        error: 'La hoja no tiene esas columnas.',
        columnas_de_la_hoja: headers.filter(Boolean)
      });
    }

    // Filas que coinciden (número de fila real de la hoja)
    const filas = [];
    for (let r = hr + 1; r < values.length; r++) {
      if (norm((values[r] || [])[iMatch]) === norm(match.value)) filas.push(r + 1);
    }
    if (!filas.length) return res.status(200).json({ ok: true, filas: 0 });

    const data = [];
    filas.forEach(fila => {
      destinos.forEach(d => {
        const L = colLetter(d.i);
        data.push({ range: "'" + cfg.sheetName + "'!" + L + fila + ':' + L + fila, values: [[d.valor]] });
      });
    });

    await core.writeCells(cfg.id, data);
    return res.status(200).json({ ok: true, filas: filas.length, columnas: destinos.length });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
