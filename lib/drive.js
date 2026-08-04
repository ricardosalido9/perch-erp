// Carpetas y archivos en Drive.
// Estructura:  CARPETA MADRE / Cotizaciones / COT-E1-26 Cliente.pdf
//              CARPETA MADRE / Ventas / E1-26 Cliente / (cotización, CSF, pagos, facturas)
const core = require('./core');
const { Readable } = require('stream');

// Carpeta madre de Perch. Se puede sobreescribir con la variable de entorno.
const CARPETA_MADRE = process.env.GOOGLE_DRIVE_PARENT_ID || '1Lh5ax1l8PeofUGJkc24WslcUOiqiOb-j';

function limpia(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
function esCuota(msg) { return /storage quota|quotaExceeded/i.test(String(msg || '')); }

async function buscarCarpeta(drive, padre, nombre) {
  const seguro = String(nombre).replace(/'/g, "\\'");
  const r = await drive.files.list({
    q: "name = '" + seguro + "' and mimeType = 'application/vnd.google-apps.folder' and '" +
       padre + "' in parents and trashed = false",
    fields: 'files(id, name, webViewLink)', pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  return (r.data.files && r.data.files[0]) || null;
}
async function carpeta(drive, padre, nombre) {
  const n = limpia(nombre);
  const ya = await buscarCarpeta(drive, padre, n);
  if (ya) return ya;
  const nueva = await drive.files.create({
    requestBody: { name: n, mimeType: 'application/vnd.google-apps.folder', parents: [padre] },
    fields: 'id, name, webViewLink', supportsAllDrives: true
  });
  return nueva.data;
}

// Sube (o reemplaza si ya existe uno con el mismo nombre) dentro de una carpeta
async function subir(drive, carpetaId, nombre, mime, buffer) {
  const n = limpia(nombre);
  const seguro = n.replace(/'/g, "\\'");
  const previos = await drive.files.list({
    q: "name = '" + seguro + "' and '" + carpetaId + "' in parents and trashed = false",
    fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  const media = { mimeType: mime, body: Readable.from(buffer) };
  if (previos.data.files && previos.data.files.length) {
    const up = await drive.files.update({
      fileId: previos.data.files[0].id, media,
      fields: 'id, name, webViewLink', supportsAllDrives: true
    });
    return up.data;
  }
  const nuevo = await drive.files.create({
    requestBody: { name: n, parents: [carpetaId] }, media,
    fields: 'id, name, webViewLink', supportsAllDrives: true
  });
  return nuevo.data;
}

/**
 * Devuelve la carpeta donde va un pedido/cotización.
 *  - cotización: CARPETA MADRE / Cotizaciones   (todas juntas)
 *  - venta:      CARPETA MADRE / Ventas / "{folio} {cliente}"
 */
async function carpetaDestino(esVenta, folio, cliente) {
  const drive = core.getDrive();
  const raiz = await carpeta(drive, CARPETA_MADRE, esVenta ? 'Ventas' : 'Cotizaciones');
  if (!esVenta) return { drive, carpeta: raiz };
  const propia = await carpeta(drive, raiz.id, (folio || '') + ' ' + (cliente || ''));
  return { drive, carpeta: propia };
}

module.exports = { CARPETA_MADRE, carpeta, carpetaDestino, subir, limpia, esCuota };
