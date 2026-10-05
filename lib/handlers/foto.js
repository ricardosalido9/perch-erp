// Sirve una foto del catálogo que vive en Drive.
//
// En el catálogo las fotos se guardan como ligas de "compartir", que terminan en
// /view. Eso no es una imagen: es una página de Drive, y por eso el navegador
// muestra el ícono de imagen rota. Tampoco se pueden pedir directo porque muchas
// no son públicas.
//
// Aquí se bajan con la cuenta de servicio —la misma que ya lee las hojas— y se
// devuelven como imagen. El navegador las guarda un día para no volver a pedirlas.
//
//   /api/erp?action=foto&id=<id de Drive>&token=<sesión>
const core = require('../core');

function idDeDrive(v) {
  const u = String(v || '').trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(u)) return u;        // ya es el id
  let m = u.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = u.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return null;
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (!core.verifyToken(q.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const id = idDeDrive(q.id);
    if (!id) return res.status(400).json({ error: 'Falta el id de la foto.' });

    const drive = core.getDrive();
    const meta = await drive.files.get({ fileId: id, fields: 'mimeType', supportsAllDrives: true });
    const tipo = String((meta.data && meta.data.mimeType) || 'image/jpeg');
    if (!/^image\//.test(tipo)) return res.status(415).json({ error: 'Ese archivo no es una imagen.' });

    const r = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true },
                                     { responseType: 'arraybuffer' });
    const buf = Buffer.from(r.data);
    res.setHeader('Content-Type', tipo);
    // Un día en el navegador: el catálogo cambia poco y así no se pide en cada carga
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(buf);
  } catch (e) {
    // Sin foto no se rompe la pantalla: se contesta que no está
    return res.status(404).json({ error: (e && e.message) || 'No se pudo leer la foto.' });
  }
};
