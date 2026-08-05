const core = require('../lib/core');
const DEFAULT_AREA = 'inicio';
module.exports = async (req, res) => {
  try {
    const { token } = await core.readBody(req);
    const ses = core.verifyToken(token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });

    const admin = core.esAdmin(ses);
    function mark(items) {
      return items.filter(it => !it.adminOnly || admin).map(it => {
        const o = { key: it.key, label: it.label, icon: it.icon, isArea: !!core.SHEETS[it.key] };
        if (it.children) o.children = mark(it.children);
        return o;
      });
    }
    const items = mark(core.MENU);
    let colaboradores = [];
    if (admin) { try { colaboradores = await core.getColaboradores(); } catch (e) {} }

    return res.status(200).json({
      items, defaultKey: DEFAULT_AREA, defaultLabel: 'Inicio',
      nombre: ses.nombre || ses.u, esAdmin: admin, colaboradores
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
