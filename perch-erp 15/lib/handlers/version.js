// Abrir en el navegador:  /api/erp?action=version
// Dice qué versión está corriendo en el servidor, sin necesidad de iniciar sesión.
const v = require('../version');
module.exports = async (req, res) => {
  // Sin esto, el navegador y la red de Vercel podían cachear la respuesta y seguir
  // reportando una versión vieja aunque el servidor ya estuviera actualizado.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  return res.status(200).json({
    ok: true,
    version: v.version,
    desplegado: new Date().toISOString(),
    nota: 'Compara esto con la versión que aparece abajo en la barra lateral del ERP. ' +
          'Si el servidor dice una más nueva, tu navegador tiene el index.html viejo en ' +
          'caché: recarga con Cmd+Shift+R.'
  });
};
