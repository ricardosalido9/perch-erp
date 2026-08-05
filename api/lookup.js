const core = require('../lib/core');
module.exports = async (req, res) => {
  try {
    const { token, key } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });
    if (!key) return res.status(400).json({ error: 'Falta el área.' });
    const lk = await core.getLookup(key);
    return res.status(200).json(lk || {});
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
