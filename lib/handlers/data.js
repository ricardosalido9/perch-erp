const core = require('../core');
module.exports = async (req, res) => {
  try {
    const { token, key } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });
    // resuelve la pestaña del año en curso si aplica (con respaldo si core.js quedara viejo)
    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
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
    // Celdas con error de fórmula (#REF!, #N/A...): se avisan en vez de mostrarlas como dato
    let errores = 0;
    const tipos = {};
    outRows.forEach(r => headers.forEach(h => {
      const v = String(r[h] == null ? '' : r[h]).trim();
      if (/^#(REF|N\/A|VALUE|NAME|DIV\/0|NUM|NULL|ERROR)/i.test(v)) {
        errores++;
        const t = v.split('!')[0].split('?')[0];
        tipos[t] = (tipos[t] || 0) + 1;
      }
    }));
    return res.status(200).json({
      connected: true, headers, rows: outRows,
      fileId: cfg.id, sheetName: cfg.sheetName,
      errores: errores,
      tiposError: Object.keys(tipos).map(k => k + ' (' + tipos[k] + ')').join(' · ')
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
