const core = require('../core');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { token, key, record, records, folio } = await core.readBody(req);
    const ses = core.verifyWriter(token);
    if (!ses) return res.status(401).json({ error: 'Tu usuario es de solo lectura.' });
    if (!core.SHEETS[key]) return res.status(400).json({ error: 'Esta área no está conectada.' });
    // El permiso se revisa AQUÍ, no escondiendo el botón: el panel es del que
    // escribe, y el servidor es el que manda.
    if (core.puedeEditarArea && !core.puedeEditarArea(ses.rol, key)) {
      return res.status(403).json({ error: 'Tu usuario no captura en esta pantalla.' });
    }
    // Quién lo hizo sale de la sesión firmada, no de lo que mande el navegador
    const quien = ses.nombre || ses.usuario || ses.u || '';
    if (Array.isArray(records) && records.length) {           // varios productos en un pedido
      const out = await core.addRecordsBatch(key, records, folio, quien);
      return res.status(200).json(out);
    }
    const out = await core.addRecord(key, record || {}, quien);
    return res.status(200).json(out || { ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
