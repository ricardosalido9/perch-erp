const core = require('../core');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { token, key, row, record } = await core.readBody(req);
    if (!core.verifyWriter(token)) return res.status(401).json({ error: 'Tu usuario es de solo lectura.' });
    if (!core.SHEETS[key]) return res.status(400).json({ error: 'Esta área no está conectada.' });
    if (!row || Number(row) < 2) return res.status(400).json({ error: 'Fila inválida.' });
    await core.updateRecord(key, Number(row), record || {});
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
