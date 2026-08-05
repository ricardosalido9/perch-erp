const core = require('../lib/core');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { usuario, contrasena } = await core.readBody(req);
    const u = await core.findUser(usuario);
    if (u && u.contrasena != null && String(u.contrasena) === String(contrasena)) {
      const nombre = u.nombre || u.usuario;
      const token = core.signToken({ u: u.usuario, rol: u.rol || 'colaborador', nombre });
      return res.status(200).json({ ok: true, token, nombre, rol: u.rol || 'colaborador' });
    }
    await new Promise(r => setTimeout(r, 500));
    return res.status(200).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
