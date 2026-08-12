const core = require('../core');
module.exports = async (req, res) => {
  try {
    const { token, key } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });
    // resuelve la pestaña del año en curso si aplica (con respaldo si core.js quedara viejo)
    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg) return res.status(200).json({ connected: false, headers: [], rows: [] });
    // Área creada pero todavía sin archivo: se avisa qué falta, sin dar error
    if (!cfg.id) {
      return res.status(200).json({
        connected: false, sinArchivo: true, headers: [], rows: [],
        sheetName: cfg.sheetName,
        columnasSugeridas: (core.COLUMNAS_SUGERIDAS || {})[key] || []
      });
    }
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
    // Celdas con error de fórmula. Se separan por gravedad:
    //  · graves  (#REF!, #N/A, #NAME?)  -> el dato está roto, hay que corregirlo
    //  · leves   (#DIV/0!, #VALUE!)     -> casi siempre una fórmula arrastrada sobre una
    //    fila vacía; es ruido normal de la hoja y no vale la pena alarmar por eso.
    const ES_ERROR = /^#(REF|N\/A|VALUE|NAME|DIV\/0|NUM|NULL|ERROR)/i;
    const ES_GRAVE = /^#(REF|N\/A|NAME)/i;
    let graves = 0, leves = 0;
    const tipos = {};
    const filasErr = [];
    outRows.forEach(r => {
      // ¿La fila tiene algún dato de verdad, o es solo fórmulas sobre el vacío?
      let conDato = false, errs = 0;
      headers.forEach(h => {
        const v = String(r[h] == null ? '' : r[h]).trim();
        if (!v) return;
        if (ES_ERROR.test(v)) { errs++; return; }
        conDato = true;
      });
      if (!errs) return;
      headers.forEach(h => {
        const v = String(r[h] == null ? '' : r[h]).trim();
        if (!ES_ERROR.test(v)) return;
        const grave = ES_GRAVE.test(v);
        // Un error leve en una fila sin datos es ruido: no se cuenta
        if (!grave && !conDato) return;
        if (!grave) { leves++; return; }
        graves++;
        const t = v.split('!')[0].split('?')[0];
        tipos[t] = (tipos[t] || 0) + 1;
        if (r._row && filasErr.indexOf(r._row) === -1 && filasErr.length < 30) filasErr.push(r._row);
      });
    });

    return res.status(200).json({
      connected: true, headers, rows: outRows,
      fileId: cfg.id, sheetName: cfg.sheetName,
      archivoUrl: 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit',
      errores: graves,
      erroresLeves: leves,
      tiposError: Object.keys(tipos).map(k => k + ' (' + tipos[k] + ')').join(' · '),
      filasError: filasErr
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
