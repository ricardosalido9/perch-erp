const core = require('../lib/core');

// Área que se abre al iniciar sesión
const DEFAULT_AREA = 'inicio';

module.exports = async (req, res) => {
  try {
    const { token } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // Marca qué ítems están conectados a una hoja (son áreas abribles)
    function mark(items) {
      return items.map(it => {
        const o = { key: it.key, label: it.label, icon: it.icon, isArea: !!core.SHEETS[it.key] };
        if (it.children) o.children = mark(it.children);
        return o;
      });
    }
    const items = mark(core.MENU);

    // Busca el área por defecto en el menú (a cualquier profundidad)
    let def = null, defLabel = '';
    (function find(list) {
      for (const it of list) {
        if (def) return;
        if (it.key === DEFAULT_AREA) { def = it.key; defLabel = it.label; return; }
        if (it.children) find(it.children);
      }
    })(items);

    // Si no existe, cae en la primera área conectada
    if (!def) {
      (function walk(list) {
        for (const it of list) {
          if (def) return;
          if (it.isArea) { def = it.key; defLabel = it.label; return; }
          if (it.children) walk(it.children);
        }
      })(items);
    }
    if (!def && items.length) { def = items[0].key; defLabel = items[0].label; }

    return res.status(200).json({ items, defaultKey: def, defaultLabel: defLabel });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
