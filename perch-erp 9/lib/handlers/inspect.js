// Recorre TODAS las pestañas de un archivo de Google Sheets y describe su estructura.
// Sirve para conectar archivos nuevos sin tener que pedir capturas de pantalla.
//
//   /api/erp?action=inspect&id=ID_DEL_ARCHIVO
//   /api/erp?action=inspect&id=ID&tab=Nombre        (una sola pestaña, con más filas)
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function colLetter(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// La fila de encabezados no siempre es la 1: se elige la de las primeras 6 con más texto
function filaEncabezados(values) {
  let hr = 0, best = -1;
  for (let i = 0; i < Math.min(6, values.length); i++) {
    const celdas = (values[i] || []).filter(c => txt(c) !== '');
    const textos = celdas.filter(c => isNaN(Number(txt(c).replace(/[$,%\s]/g, '')))).length;
    const score = celdas.length + textos;
    if (score > best) { best = score; hr = i; }
  }
  return hr;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const body = (req._body || {});
    const id = q.id || body.id;
    if (!id) return res.status(400).json({ error: 'Falta ?id= del archivo.' });

    let pestanas;
    try {
      pestanas = await core.listTabs(id);
    } catch (e) {
      return res.status(403).json({
        error: 'No se pudo abrir el archivo.',
        detalle: (e && e.message) || String(e),
        pista: 'Compártelo con ' + (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'la cuenta de servicio') + '.'
      });
    }

    const soloUna = q.tab || body.tab;
    const objetivo = soloUna ? pestanas.filter(t => t.toLowerCase() === String(soloUna).toLowerCase()) : pestanas;
    const muestras = soloUna ? 8 : 2;

    const salida = [];
    for (const tab of objetivo.slice(0, 40)) {
      let values;
      try { values = await core.readRange(id, tab); }
      catch (e) { salida.push({ pestana: tab, error: (e && e.message) || String(e) }); continue; }
      if (!values.length) { salida.push({ pestana: tab, filas: 0, aviso: 'vacía' }); continue; }

      const hr = filaEncabezados(values);
      const headers = (values[hr] || []).map((h, i) => colLetter(i) + ': ' + (txt(h) || '(sin nombre)'));
      const filas = values.slice(hr + 1).filter(r => (r || []).some(c => txt(c) !== ''));
      salida.push({
        pestana: tab,
        fila_de_encabezados: hr + 1,
        columnas: headers.length,
        filas_con_datos: filas.length,
        encabezados: headers,
        ejemplos: filas.slice(0, muestras).map(r => r.map(c => txt(c).slice(0, 40)))
      });
    }

    return res.status(200).json({
      ok: true,
      archivo: id,
      total_pestanas: pestanas.length,
      pestanas: pestanas,
      detalle: salida
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
