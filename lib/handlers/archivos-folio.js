// Los archivos de un folio: la cotización, la CSF, los comprobantes de pago y lo
// que se le haya subido. Todo vive en una carpeta de Drive que se llama
// "{folio} {cliente}", la misma donde el ERP ya guarda la cotización en PDF.
//
// Hasta ahora esa carpeta existía pero no había forma de verla desde el ERP: el
// link solo aparecía un momento al generar el PDF y se perdía.
//
//   ?action=archivos-folio  { folio, cliente }
const core = require('../core');

function limpiaNombre(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
// Qué es cada archivo, para poder agruparlos y no dejar una lista suelta
function queEs(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/csf|constancia/.test(n)) return 'Constancia de situación fiscal';
  if (/comprobante|pago|transferencia|deposito|depósito/.test(n)) return 'Comprobante de pago';
  if (/cotiza/.test(n)) return 'Cotización';
  if (/venta|pedido/.test(n)) return 'Venta';
  if (/remision|remisión|nota/.test(n)) return 'Nota de remisión';
  if (/factura|cfdi/.test(n)) return 'Factura';
  return 'Otro';
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    const parentId = process.env.GOOGLE_DRIVE_PARENT_ID;
    if (!parentId) {
      return res.status(400).json({
        error: 'Drive todavía no está configurado.',
        pista: 'Falta la variable GOOGLE_DRIVE_PARENT_ID con el id de la carpeta madre, ' +
               'y que esa carpeta viva en una Unidad Compartida y esté compartida como ' +
               'editor con la cuenta de servicio.'
      });
    }

    const nombreCarpeta = limpiaNombre(folio + ' ' + (body.cliente || '')) || folio;
    const drive = core.getDrive();

    // Se busca la carpeta del folio. Si el cliente cambió de nombre, la carpeta
    // puede llamarse distinto, así que se busca también solo por el folio.
    let carpeta = null;
    const buscar = async (q) => {
      const r = await drive.files.list({
        q, fields: 'files(id, name, webViewLink)', pageSize: 5,
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      return (r.data.files || [])[0] || null;
    };
    try {
      const esc = nombreCarpeta.replace(/'/g, "\\'");
      carpeta = await buscar("name = '" + esc + "' and mimeType = 'application/vnd.google-apps.folder' " +
                             "and trashed = false");
      if (!carpeta) {
        const escF = folio.replace(/'/g, "\\'");
        carpeta = await buscar("name contains '" + escF + "' and mimeType = " +
                               "'application/vnd.google-apps.folder' and trashed = false");
      }
    } catch (e) {
      return res.status(500).json({
        error: 'No se pudo buscar la carpeta en Drive.',
        pista: (e && e.message) || String(e)
      });
    }

    if (!carpeta) {
      return res.status(200).json({
        ok: true, folio, existe: false, archivos: [],
        nombreEsperado: nombreCarpeta,
        nota: 'Todavía no hay carpeta para este folio. Se crea sola la primera vez que se ' +
              'guarda un archivo: la cotización en PDF, la CSF o un comprobante de pago.'
      });
    }

    let archivos = [];
    try {
      const r = await drive.files.list({
        q: "'" + carpeta.id + "' in parents and trashed = false",
        fields: 'files(id, name, mimeType, webViewLink, modifiedTime, size)',
        orderBy: 'modifiedTime desc', pageSize: 100,
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      archivos = (r.data.files || []).map(f => ({
        nombre: f.name,
        que: queEs(f.name),
        liga: f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view'),
        fecha: f.modifiedTime || '',
        kb: f.size ? Math.round(Number(f.size) / 1024) : null
      }));
    } catch (e) {
      return res.status(200).json({
        ok: true, folio, existe: true, archivos: [],
        carpeta: carpeta.webViewLink || ('https://drive.google.com/drive/folders/' + carpeta.id),
        error: 'La carpeta existe pero no se pudo leer su contenido.',
        pista: (e && e.message) || String(e)
      });
    }

    return res.status(200).json({
      ok: true, folio, existe: true,
      nombreCarpeta: carpeta.name,
      carpeta: carpeta.webViewLink || ('https://drive.google.com/drive/folders/' + carpeta.id),
      archivos,
      // Lo que falta, dicho por su nombre: es lo que se viene a ver
      falta: ['Cotización', 'Constancia de situación fiscal', 'Comprobante de pago']
        .filter(t => !archivos.some(a => a.que === t))
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
