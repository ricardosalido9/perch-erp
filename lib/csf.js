// Lee una Constancia de Situación Fiscal y devuelve los datos fiscales del cliente.
const core = require('../core');
const { leerCSF } = require('../csf');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
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
