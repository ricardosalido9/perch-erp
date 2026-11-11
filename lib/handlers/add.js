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

    // No se le agregan conceptos a un pedido que ya se cerró (ver surtir.js).
    // Un pedido ENTREGADO ya se recibió, se pagó y casi siempre se facturó.
    if (key === 'prov_pedidos') {
      const nuevos = Array.isArray(records) && records.length ? records : [record || {}];
      const cerrado = await core.pedidoCerrado(
        nuevos.map(r => (r || {})['Pedido Proveedor'] || (r || {})['Pedido'] || ''));
      if (cerrado) {
        return res.status(409).json({
          error: 'El pedido ' + cerrado.pedido + ' ya está ' + cerrado.status.toLowerCase() +
                 ': no se le puede agregar otro concepto.',
          pista: 'Ya se recibió y lo más seguro es que ya esté facturado. Dale su propio ' +
                 'número de pedido al concepto nuevo.',
          codigo: 'pedido-cerrado', pedido: cerrado.pedido, status: cerrado.status
        });
      }
    }

    if (Array.isArray(records) && records.length) {           // varios productos en un pedido
      const out = await core.addRecordsBatch(key, records, folio, quien);
      return res.status(200).json(out);
    }
    const out = await core.addRecord(key, record || {}, quien);
    return res.status(200).json(out || { ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
