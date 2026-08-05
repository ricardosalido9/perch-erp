const core = require('../lib/core');
module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyWriter(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida o sin permiso.' });
    const fecha = body.fecha || new Intl.DateTimeFormat('es-MX',
      { timeZone: 'America/Mexico_City', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
    const colaborador = body.colaborador || ses.nombre;
    const cliente = body.cliente || '';
    const pendiente = body.pendiente || '';
    const registradoPor = ses.nombre;
    const acts = Array.isArray(body.actividades) ? body.actividades : [];
    const rows = acts
      .filter(a => a && (String(a.actividad || '').trim() || String(a.horas || '').trim()))
      .map(a => [fecha, colaborador, cliente, pendiente, String(a.actividad || ''), String(a.horas || ''), registradoPor]);
    if (!rows.length) return res.status(200).json({ error: 'No hay actividades para registrar.' });
    await core.appendBitacora(rows);
    return res.status(200).json({ ok: true, n: rows.length });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
