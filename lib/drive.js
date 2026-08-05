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

// Traduce los errores típicos de Drive a algo accionable
function explicar(msg) {
  const m = String(msg || '');
  if (/has not been used in project|accessNotConfigured|API has not been used|is disabled/i.test(m)) {
    const url = (m.match(/https:\/\/console\.developers\.google\.com\S*/) || [])[0] || '';
    return {
      causa: 'La API de Google Drive no está habilitada en el proyecto de Google Cloud.',
      arreglo: 'Entra a Google Cloud Console > APIs y servicios > Biblioteca, busca "Google Drive API" y dale Habilitar. ' +
               'Tarda un par de minutos en surtir efecto.' + (url ? ' Enlace directo: ' + url : '')
    };
  }
  if (esCuota(m)) {
    return {
      causa: 'La carpeta está en "Mi unidad" y las cuentas de servicio no tienen cuota de almacenamiento propia.',
      arreglo: 'Mueve la carpeta a una Unidad Compartida (Shared Drive) y agrega ahí a la cuenta de servicio como Administrador de contenido.'
    };
  }
  if (/File not found|notFound|404/i.test(m)) {
    return {
      causa: 'Drive no encuentra la carpeta madre.',
      arreglo: 'Revisa el id de la carpeta y que esté compartida con perch-panel@perch-erp.iam.gserviceaccount.com.'
    };
  }
  if (/insufficient|permission|forbidden|403/i.test(m)) {
    return {
      causa: 'La cuenta de servicio no tiene permiso de escritura en la carpeta.',
      arreglo: 'Comparte la carpeta como Editor con perch-panel@perch-erp.iam.gserviceaccount.com.'
    };
  }
  return { causa: 'Drive devolvió un error.', arreglo: '' };
}

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

module.exports = { CARPETA_MADRE, carpeta, carpetaDestino, subir, limpia, esCuota, explicar };
