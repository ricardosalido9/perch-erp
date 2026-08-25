// Abrir en el navegador:  /api/erp?action=version
// Dice qué versión está corriendo en el servidor, sin necesidad de iniciar sesión.
const v = require('../version');
module.exports = async (req, res) => {
  return res.status(200).json({
    ok: true,
    version: v.version,
    nota: 'Compara esto con la versión que aparece abajo en la barra lateral del ERP. ' +
          'Si el servidor dice una más nueva, tu navegador tiene el index.html viejo en caché: recarga con Cmd+Shift+R.'
  });
};
