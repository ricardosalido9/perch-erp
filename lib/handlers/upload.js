// Sube un archivo (la CSF) a Drive, dentro de la carpeta del pedido "{folio} {cliente}".
// La carpeta madre se configura en la variable de entorno GOOGLE_DRIVE_PARENT_ID
// y debe estar compartida como Editor con la cuenta de servicio.
//
// IMPORTANTE: si la carpeta madre está en "Mi unidad" de una persona, Google rechaza la
// subida porque las cuentas de servicio no tienen cuota de almacenamiento propia. La carpeta
// tiene que vivir en una UNIDAD COMPARTIDA (Shared Drive). El error se explica al usuario.
const core = require('../core');
const { Readable } = require('stream');

const MAX_BYTES = 4 * 1024 * 1024;   // 4 MB (límite práctico de la función serverless)

function limpiaNombre(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

async function buscarOCrearCarpeta(drive, parentId, nombre) {
  const seguro = nombre.replace(/'/g, "\\'");
  const q = "name = '" + seguro + "' and mimeType = 'application/vnd.google-apps.folder' and '" +
            parentId + "' in parents and trashed = false";
  const encontrada = await drive.files.list({
    q, fields: 'files(id, name, webViewLink)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  if (encontrada.data.files && encontrada.data.files.length) return encontrada.data.files[0];
  const creada = await drive.files.create({
    requestBody: { name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id, name, webViewLink', supportsAllDrives: true
  });
  return creada.data;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const parentId = process.env.GOOGLE_DRIVE_PARENT_ID;
    if (!parentId) {
      return res.status(400).json({
        error: 'Drive todavía no está configurado.',
        detalle: 'Falta la variable GOOGLE_DRIVE_PARENT_ID en Vercel con el id de la carpeta madre, ' +
                 'y compartir esa carpeta como Editor con la cuenta de servicio.'
      });
    }

    const nombre = limpiaNombre(body.nombre || 'CSF.pdf');
    const mime = body.mime || 'application/octet-stream';
    const b64 = String(body.data || '');
    if (!b64) return res.status(400).json({ error: 'No llegó el archivo.' });

    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'El archivo llegó vacío.' });
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'El archivo pesa más de 4 MB. Comprímelo o súbelo a mano.' });
    }

    const carpetaNombre = limpiaNombre((body.folio || '') + ' ' + (body.cliente || '')) || 'Sin folio';
    const drive = core.getDrive();

    let carpeta;
    try {
      carpeta = await buscarOCrearCarpeta(drive, parentId, carpetaNombre);
    } catch (e) {
      return res.status(500).json({
        error: 'No se pudo abrir o crear la carpeta del pedido.',
        detalle: (e && e.message) || String(e),
        pista: 'Verifica que la carpeta madre exista y esté compartida como Editor con la cuenta de servicio.'
      });
    }

    let archivo;
    try {
      const subida = await drive.files.create({
        requestBody: { name: nombre, parents: [carpeta.id] },
        media: { mimeType: mime, body: Readable.from(buf) },
        fields: 'id, name, webViewLink', supportsAllDrives: true
      });
      archivo = subida.data;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const sinCuota = /storage quota|quotaExceeded/i.test(msg);
      return res.status(500).json({
        error: sinCuota
          ? 'La carpeta está en "Mi unidad" y las cuentas de servicio no tienen cuota de almacenamiento.'
          : 'No se pudo subir el archivo.',
        detalle: msg,
        pista: sinCuota
          ? 'Mueve la carpeta a una Unidad Compartida (Shared Drive) y agrega ahí a la cuenta de servicio como Administrador de contenido.'
          : undefined
      });
    }

    return res.status(200).json({
      ok: true,
      carpeta: carpeta.webViewLink || ('https://drive.google.com/drive/folders/' + carpeta.id),
      archivo: archivo.webViewLink || '',
      nombre: archivo.name || nombre
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
