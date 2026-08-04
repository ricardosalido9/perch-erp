const core = require('../lib/core');
module.exports = async (req, res) => {
  try {
    const { token, key } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const cfg = await core.areaCfg(key);   // resuelve la pestaña del año en curso si aplica
    if (!cfg) return res.status(200).json({ connected: false, headers: [], rows: [] });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(200).json({ connected: true, headers: [], rows: [] });
    // Algunas pestañas traen un título en la fila 1 (ej. Funnel): cfg.headerRow indica la fila real.
    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    if (values.length <= hr) return res.status(200).json({ connected: true, headers: [], rows: [] });
    const headers = (values[hr] || []).map(String);

    // Columnas calculadas por fórmula: no cuentan para decidir si una fila tiene datos
    const formulaCols = new Set();
    (core.FORMULA_FIELDS[key] || []).forEach(f => {
      const i = headers.findIndex(h => String(h).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        === String(f).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      if (i !== -1) formulaCols.add(i);
    });
    const dataCols = headers.map((_, i) => i).filter(i => !formulaCols.has(i));

    const rows = [];
    for (let i = hr + 1; i < values.length; i++) {
      // Salta filas sin ningún dato real (aunque tengan fórmulas)
      const hasData = dataCols.some(c => values[i][c] != null && String(values[i][c]).trim() !== '');
      if (!hasData) continue;
      const o = { _row: i + 1 };
      headers.forEach((h, j) => { o[h] = (values[i][j] != null) ? values[i][j] : ''; });
      rows.push(o);
    }
    // Filtro de fila del área (p. ej., Cuentas por Cobrar solo muestra pendientes)
    const rf = core.AREA_ROW_FILTERS && core.AREA_ROW_FILTERS[key];
    let outRows = rows;
    if (rf) {
      const fCol = headers.find(h => String(h).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        === String(rf.field).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      if (fCol) {
        outRows = rows.filter(r => {
          const s = String(r[fCol] == null ? '' : r[fCol]).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
          const n = parseFloat(s);
          return !isNaN(n) && n > 0;
        });
      }
    }
    return res.status(200).json({ connected: true, headers, rows: outRows });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
