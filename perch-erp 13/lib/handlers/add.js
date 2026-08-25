const core = require('../core');
// Áreas que el ERP calcula: no se escriben a mano ni por error
const CALCULADAS = ['op_stock', 'op_revisar'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { token, key, record, records } = await core.readBody(req);
    if (!core.verifyWriter(token)) return res.status(401).json({ error: 'Tu usuario es de solo lectura.' });
    if (!core.SHEETS[key]) return res.status(400).json({ error: 'Esta área no está conectada.' });
    if (Array.isArray(records) && records.length) {           // varios productos en un pedido
      const out = await core.addRecordsBatch(key, records);
      return res.status(200).json(out);
    }
    const out = await core.addRecord(key, record || {});
    return res.status(200).json(out || { ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
