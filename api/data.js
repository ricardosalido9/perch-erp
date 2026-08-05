const core = require('../lib/core');

function nm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });
    const key = body.key;
    const cfg = core.SHEETS[key];
    if (!cfg) return res.status(200).json({ connected: false, headers: [], rows: [] });

    if (key === 'recurrentes') { try { await core.ensureRecurrentes(); } catch (e) {} }

    let values;
    try { values = await core.readRange(cfg.id, cfg.sheetName); }
    catch (e) { return res.status(200).json({ connected: false, headers: [], rows: [] }); }
    if (!values.length) return res.status(200).json({ connected: true, headers: [], rows: [] });
    const headers = values[0].map(String);

    // columnas de fórmula no cuentan para decidir si una fila tiene datos
    const formulaCols = new Set();
    (core.FORMULA_FIELDS[key] || []).forEach(f => {
      headers.forEach((h, i) => { if (nm(h) === nm(f)) formulaCols.add(i); });
    });
    const dataCols = headers.map((_, i) => i).filter(i => !formulaCols.has(i));
    const anchor = headers.findIndex(h => nm(h) === 'pendiente');

    const rows = [];
    for (let i = 1; i < values.length; i++) {
      let ok;
      if (anchor !== -1) ok = values[i][anchor] != null && String(values[i][anchor]).trim() !== '';
      else ok = dataCols.some(c => values[i][c] != null && String(values[i][c]).trim() !== '');
      if (!ok) continue;
      const o = { _row: i + 1 };
      headers.forEach((h, j) => { if (o[h] === undefined) o[h] = (values[i][j] != null) ? values[i][j] : ''; });
      rows.push(o);
    }

    const hCli = headers.find(h => nm(h) === nm('Cliente'));
    const hResp = headers.find(h => nm(h) === nm('Responsable'));
    const hCo = headers.find(h => nm(h) === nm('Co-Responsable') || nm(h) === nm('Co-responsable'));
    const hEst = headers.find(h => ['status', 'estatus', 'estado'].indexOf(nm(h)) !== -1);
    const hRev = headers.find(h => nm(h) === nm('Revisado'));

    // Filtro por área (abiertos / no revisados / terminados)
    const rf = core.AREA_ROW_FILTERS[key];
    let out = rows;
    if (rf) {
      out = out.filter(r => {
        const cerr = core.esCerrado(hEst ? r[hEst] : '');
        if (rf.op === 'abiertos') return !cerr;
        if (rf.op === 'cerrados') return cerr;
        if (rf.op === 'norev') return !cerr && !core.esRevisado(hRev ? r[hRev] : '');
        return true;
      });
    }

    // Alcance por rol: solo aplica a las áreas de pendientes
    const admin = core.esAdmin(ses);
    let verComo = body.verComo;
    if (!admin) verComo = ses.nombre;            // forzado para colaboradores
    if (!/^pend_/.test(key)) verComo = '__todos__';   // recurrentes y demás: sin recorte
    if (verComo && verComo !== '__todos__' && hResp) {
      const meta = nm(verComo);
      const gente = r => {
        const o = [];
        String(r[hResp] || '').split(/[;,\n]/).forEach(x => { x = x.trim(); if (x) o.push(nm(x)); });
        if (hCo) String(r[hCo] || '').split(/[;,\n]/).forEach(x => { x = x.trim(); if (x) o.push(nm(x)); });
        return o;
      };
      out = out.filter(r => gente(r).indexOf(meta) !== -1);
    }

    // IDs no aplican (la hoja no tiene columna ID); devolvemos vacío
    return res.status(200).json({ connected: true, headers, rows: out, idsUsados: [] });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
