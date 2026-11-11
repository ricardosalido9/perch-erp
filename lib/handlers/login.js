const core = require('../core');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { usuario, contrasena } = await core.readBody(req);
    const u = await core.findUser(usuario);
    if (u && u.contrasena != null && String(u.contrasena) === String(contrasena)) {
      // El nombre va en el token, no solo en la respuesta: el rastro de "quién
      // hizo esto" se escribe desde el servidor con lo que trae la sesión, y
      // hasta ahora ahí solo había el usuario.
      const token = core.signToken({ u: u.usuario, nombre: u.nombre || u.usuario,
                                     rol: u.rol || 'staff' });
      return res.status(200).json({ ok: true, token, nombre: u.nombre || u.usuario, rol: u.rol || 'staff' });
    }
    await new Promise(r => setTimeout(r, 500)); // desalienta fuerza bruta
    return res.status(200).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
