// Convierte una cotización en venta: copia sus renglones a VENTAS con folio nuevo
// y marca la cotización como Vendida.
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
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function hoyLargo() {
  const d = new Date();
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio de la cotización.' });

    const cfgC = core.areaCfg ? await core.areaCfg('cotizaciones') : core.SHEETS.cotizaciones;
    if (!cfgC) return res.status(400).json({ error: 'El área de cotizaciones no está conectada.' });

    const values = await core.readRange(cfgC.id, cfgC.sheetName);
    const hr = (cfgC.headerRow && cfgC.headerRow > 1) ? (cfgC.headerRow - 1) : 0;
    const headers = (values[hr] || []).map(h => String(h).trim());
    const iRef = headers.findIndex(h => /referencia|folio/i.test(h));
    if (iRef === -1) return res.status(400).json({ error: 'La hoja de cotizaciones no tiene columna de folio.' });

    // Renglones de esa cotización (y en qué fila están, para marcarlos después)
    const filas = [], numsFila = [];
    for (let r = hr + 1; r < values.length; r++) {
      if (norm((values[r] || [])[iRef]) !== norm(folio)) continue;
      const o = {};
      headers.forEach((h, j) => { o[h] = (values[r][j] != null) ? values[r][j] : ''; });
      filas.push(o);
      numsFila.push(r + 1);
    }
    if (!filas.length) return res.status(404).json({ error: 'No se encontró la cotización ' + folio + '.' });

    // Se copia todo MENOS lo que la venta genera de nuevo
    const fuera = ['no. de referencia', 'no de referencia', 'referencia', 'folio', 'status', 'estatus',
                   'trimestre', 'ano', 'año', 'mes'];
    const registros = filas.map(f => {
      const rec = {};
      Object.keys(f).forEach(k => {
        if (fuera.indexOf(norm(k)) !== -1) return;
        if (norm(k) === 'fecha del cierre') return;                 // la venta se cierra hoy
        if (norm(k) === 'fecha de entrega acordada') return;        // la manda el formulario
        rec[k] = f[k];
      });
      rec['Fecha del Cierre'] = body.fechaCierre || hoyLargo();
      if (body.fechaEntrega) rec['Fecha de entrega acordada'] = body.fechaEntrega;
      return rec;
    });

    const out = await core.addRecordsBatch('ventas_registro', registros);

    // La cotización queda marcada como Vendida (si la hoja tiene columna de status)
    let marcada = false;
    const iSt = headers.findIndex(h => /^(status|estatus)$/i.test(String(h).trim()));
    if (iSt !== -1) {
      const L = colLetter(iSt);
      const data = numsFila.map(n => ({
        range: "'" + cfgC.sheetName + "'!" + L + n + ':' + L + n,
        values: [['Vendida ' + (out.folio || '')]]
      }));
      try { await core.writeCells(cfgC.id, data); marcada = true; } catch (e) { marcada = false; }
    }

    return res.status(200).json({
      ok: true,
      folio: out.folio || '',
      filas: registros.length,
      cotizacion: folio,
      marcada: marcada
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
