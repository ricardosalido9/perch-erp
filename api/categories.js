const core = require('../lib/core');
module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    if (!body.key) return res.status(400).json({ error: 'Falta el área.' });

    // Agregar una opción nueva a una categoría del área (requiere permisos de escritura)
    if (body.add) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Tu usuario es de solo lectura.' });
      if (!body.categoria || body.valor == null || String(body.valor).trim() === '')
        return res.status(400).json({ error: 'Faltan datos.' });
      await core.addCategory(body.key, body.categoria, String(body.valor).trim());
      return res.status(200).json({ ok: true });
    }

    // Devolver el mapa de categorías del área { "Categoría": [...], ... }
    const cats = await core.getCategories(body.key);
    return res.status(200).json(cats);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
