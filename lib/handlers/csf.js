// Lee una Constancia de Situación Fiscal y devuelve los datos fiscales del cliente.
const core = require('../core');
const { leerCSF } = require('../csf');

const archivosFolio = require('./archivos-folio');

// La CSF que YA está en el expediente del folio.
//
// Hasta ahora solo se leía la que alguien subía en ese momento. Pero la
// constancia casi siempre ya está en la carpeta del pedido —Camila la ve ahí—,
// y el panel seguía diciendo "falta RFC, razón social, régimen fiscal".
// Se busca en la carpeta del folio y se baja para leerla.
async function csfDelExpediente(req, token, folio) {
  const datos = await new Promise((resolve, reject) => {
    const fake = { status() { return fake; }, json(o) { resolve(o); return fake; } };
    const r2 = { query: { token, folio }, _body: { token, folio } };
    archivosFolio(r2, fake).catch(reject);
  });
  if (datos && datos.error && !datos.existe) return { error: datos.error, pista: datos.pista };
  const lista = (datos && datos.archivos) || [];
  const csf = lista.filter(a => a.que === 'Constancia de situación fiscal' &&
                                /\.pdf$/i.test(a.nombre || '') && a.id)[0];
  if (!csf) {
    return { error: 'En la carpeta de ' + folio + ' no hay una constancia en PDF.',
             pista: lista.length ? 'Lo que hay es: ' +
                    lista.map(a => a.nombre).slice(0, 8).join(' · ')
                  : 'La carpeta está vacía.' };
  }
  const drive = core.getDrive();
  const r = await drive.files.get({ fileId: csf.id, alt: 'media', supportsAllDrives: true },
                                   { responseType: 'arraybuffer' });
  return { buf: Buffer.from(r.data), nombre: csf.nombre };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // Sin archivo adjunto, se busca la constancia en el expediente del folio
    if (!body.data && body.folio) {
      let x;
      try { x = await csfDelExpediente(req, body.token, String(body.folio).trim()); }
      catch (e) { return res.status(400).json({ error: 'No se pudo abrir la constancia.',
                                                pista: (e && e.message) || String(e) }); }
      if (x.error) return res.status(404).json(x);
      if (x.buf.slice(0, 4).toString('latin1') !== '%PDF') {
        return res.status(400).json({ error: 'La constancia de la carpeta no es un PDF legible.' });
      }
      const r2 = leerCSF(x.buf);
      return res.status(200).json({ ok: r2.ok, motivo: r2.motivo || '',
                                    datos: r2.datos || {}, archivo: x.nombre, deExpediente: true });
    }
    if (!body.data) return res.status(400).json({ error: 'No llegó el archivo.' });

    let buf;
    try { buf = Buffer.from(body.data, 'base64'); }
    catch (e) { return res.status(400).json({ error: 'El archivo no se pudo leer.' }); }
    if (!buf.length) return res.status(400).json({ error: 'El archivo llegó vacío.' });
    if (buf.slice(0, 4).toString('latin1') !== '%PDF') {
      return res.status(400).json({ error: 'Solo se puede leer la CSF en PDF.' });
    }

    const r = leerCSF(buf);
    return res.status(200).json({
      ok: r.ok, motivo: r.motivo || '', datos: r.datos || {}
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
