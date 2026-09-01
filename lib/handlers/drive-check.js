// Revisa si Drive está bien conectado y por qué no.
//
// Abrir en el navegador:  /api/erp?action=drive-check
//
// La confusión típica: compartir la carpeta NO basta si está en "Mi unidad".
// Una cuenta de servicio no tiene almacenamiento propio, así que el archivo que
// crea tendría que quedar a su nombre y Google lo rechaza, aunque los permisos
// estén perfectos. Este endpoint distingue los dos casos y dice cuál es.
const core = require('../core');
const CFG = require('../config');
const drive = require('../drive');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const carpeta = drive.carpetaEnUso();
    const cuenta = drive.correoCuenta();
    const out = {
      ok: true,
      cuentaDeServicio: cuenta,
      carpetaConfigurada: carpeta,
      variables: {
        DRIVE_VENTAS: CFG.ARCHIVOS.DRIVE_VENTAS || '(sin definir)',
        DRIVE_FOTOS: CFG.ARCHIVOS.DRIVE_FOTOS || '(sin definir)',
        GOOGLE_DRIVE_PARENT_ID: process.env.GOOGLE_DRIVE_PARENT_ID || '(sin definir)'
      }
    };
    if (!carpeta) {
      out.problema = 'No hay ninguna carpeta configurada.';
      out.arreglo = 'Pon la variable DRIVE_VENTAS con el id de la carpeta.';
      return res.status(200).json(out);
    }

    let d;
    try { d = core.getDrive(); }
    catch (e) {
      out.problema = 'No se pudo conectar a Drive.';
      out.detalle = e.message;
      return res.status(200).json(out);
    }

    // ¿Existe y qué es?
    try {
      const r = await d.files.get({
        fileId: carpeta,
        fields: 'id, name, mimeType, driveId, parents, capabilities(canAddChildren)',
        supportsAllDrives: true
      });
      const f = r.data;
      out.carpeta = { nombre: f.name, esCarpeta: f.mimeType === 'application/vnd.google-apps.folder' };
      out.enUnidadCompartida = !!f.driveId;
      out.puedeCrearAhi = !!(f.capabilities && f.capabilities.canAddChildren);

      if (!out.enUnidadCompartida) {
        out.problema = 'La carpeta "' + f.name + '" está en Mi unidad, no en una Unidad Compartida.';
        out.arreglo = 'Compartirla no alcanza. Crea una Unidad Compartida en Drive, ' +
          'arrastra la carpeta ahí, y agrega a ' + cuenta + ' como Administrador de contenido. ' +
          'Mientras esté en Mi unidad, el ERP puede leerla pero no puede crear archivos.';
        out.porQue = 'Una cuenta de servicio no tiene espacio de almacenamiento propio. ' +
          'Al crear un archivo, ese archivo quedaría a su nombre y no tiene dónde guardarlo.';
        return res.status(200).json(out);
      }
      if (!out.puedeCrearAhi) {
        out.problema = 'La carpeta sí está en una Unidad Compartida, pero la cuenta no puede crear ahí.';
        out.arreglo = 'Agrega a ' + cuenta + ' en esa Unidad Compartida con el rol ' +
          '"Administrador de contenido" o "Colaborador". Con Lector no basta.';
        return res.status(200).json(out);
      }
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const exp = drive.explicar(msg);
      out.problema = exp.causa;
      out.arreglo = exp.arreglo;
      out.detalle = msg;
      return res.status(200).json(out);
    }

    // Prueba de verdad: crear un archivo chiquito y borrarlo
    try {
      const prueba = await drive.subir(d, carpeta, 'prueba-erp.txt', 'text/plain',
        Buffer.from('Prueba del ERP. Si ves este archivo, se puede borrar.'));
      out.pruebaDeEscritura = 'ok';
      try { await d.files.delete({ fileId: prueba.id, supportsAllDrives: true }); }
      catch (e) { out.pruebaDeEscritura = 'ok, pero no se pudo borrar el archivo de prueba'; }
      out.resumen = 'Drive está bien conectado. Se puede crear y borrar en la carpeta.';
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const exp = drive.explicar(msg);
      out.pruebaDeEscritura = 'falló';
      out.problema = exp.causa;
      out.arreglo = exp.arreglo;
      out.detalle = msg;
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
