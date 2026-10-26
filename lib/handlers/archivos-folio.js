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
function queEs(nombre, folio) {
  const n = String(nombre || '').toLowerCase();
  if (/csf|constancia/.test(n)) return 'Constancia de situación fiscal';
  if (/factura|cfdi/.test(n)) return 'Factura';
  // La prueba de la entrega: el papel que firmó el cliente y las fotos de cómo
  // llegó el mueble. Se revisan antes que "remision" a secas, que es el PDF en
  // blanco que se imprime para salir a repartir.
  if (/remisi[óo]n firmada|firmada/.test(n)) return 'Remisión firmada';
  if (/foto de entrega|fotos? de entrega/.test(n)) return 'Foto de entrega';
  if (/comprobante|pago|transferencia|deposito|depósito/.test(n)) return 'Comprobante de pago';
  if (/cotiza/.test(n)) return 'Cotización';
  if (/orden de compra/.test(n)) return 'Orden de compra';
  if (/remision|remisión|nota/.test(n)) return 'Nota de remisión';
  // El PDF que genera el ERP se llama "{folio} {cliente}.pdf", sin la palabra
  // "cotización" en ningún lado. Por eso caía en "Otro" y el panel seguía
  // pidiendo una cotización que ya estaba en la carpeta.
  const f = String(folio || '').trim().toLowerCase();
  if (f && n.indexOf(f) === 0 && /\.pdf$/.test(n)) return 'Cotización';
  if (/venta|pedido/.test(n)) return 'Venta';
  return 'Otro';
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    // La MISMA carpeta que usan las cotizaciones: así todo lo de un folio —la
    // cotización, la CSF, los comprobantes— queda junto.
    // Las carpetas candidatas, en orden: si la primera no deja escribir —porque
    // vive en "Mi unidad"— se intenta con la siguiente.
    const carpetas = require('../drive').carpetasEnUso();
    const parentId = carpetas[0];
    if (!parentId) {
      return res.status(400).json({
        error: 'Drive todavía no está configurado.',
        pista: 'Falta la variable DRIVE_VENTAS con el id de la carpeta, ' +
               'y que esa carpeta viva en una Unidad Compartida y esté compartida como ' +
               'editor con la cuenta de servicio.'
      });
    }

    const nombreCarpeta = limpiaNombre(folio + ' ' + (body.cliente || '')) || folio;
    const drive = core.getDrive();

    // Se busca la carpeta del folio. Si el cliente cambió de nombre, la carpeta
    // puede llamarse distinto, así que se busca también solo por el folio.
    let carpeta = null;
    // La carpeta del folio EMPIEZA con el folio.
    //
    // Buscar con "contains" trae de más: para O6-26 Drive devuelve también
    // "COT-O6-26 MARIA MORALES", y quedarse con la primera le daba a Camila la
    // constancia de otro cliente —APX INMUEBLES— en la ficha de Pastora
    // Camarena. Un folio de venta y el de su cotización son carpetas distintas
    // y no se pueden confundir.
    const empiezaConElFolio = (nombre) => {
      const n = String(nombre || '').trim().toLowerCase();
      const f = String(folio || '').trim().toLowerCase();
      if (!f || n.indexOf(f) !== 0) return false;
      const sig = n.charAt(f.length);
      return sig === '' || sig === ' ' || sig === '-' || sig === '_';
    };
    const buscar = async (q, soloDelFolio) => {
      const r = await drive.files.list({
        q, fields: 'files(id, name, webViewLink)', pageSize: 20,
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      let fs = r.data.files || [];
      if (soloDelFolio) fs = fs.filter(f => empiezaConElFolio(f.name));
      return fs[0] || null;
    };
    try {
      const esc = nombreCarpeta.replace(/'/g, "\\'");
      carpeta = await buscar("name = '" + esc + "' and mimeType = 'application/vnd.google-apps.folder' " +
                             "and trashed = false");
      if (!carpeta) {
        const escF = folio.replace(/'/g, "\\'");
        carpeta = await buscar("name contains '" + escF + "' and mimeType = " +
                               "'application/vnd.google-apps.folder' and trashed = false", true);
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
        id: f.id,                       // para poder bajarlo, p. ej. la CSF
        que: queEs(f.name, folio),
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
