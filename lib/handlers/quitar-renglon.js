// Quitar un producto de una cotización o de un pedido.
//
// No borra el renglón de la hoja: lo deja vacío. Borrarlo de verdad recorrería
// todas las filas de abajo, y los números de fila están guardados en media
// aplicación —en los botones de editar, en los avisos, en lo que el navegador ya
// cargó—. Un renglón vacío desaparece de todas las vistas, que es lo que se
// quiere, y no mueve nada de lugar.
//
// Antes de vaciarlo se deja un rastro en Comentarios: quién lo quitó y cuándo.
// Un renglón que se esfuma sin explicación es peor que uno que no se puede quitar.
//
//   ?action=quitar-renglon  { key, row }
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

// Solo estas áreas: son las que tienen varios renglones por folio y donde quitar
// uno es una corrección normal. En las demás hay que pensarlo distinto.
const PERMITIDAS = ['cotizaciones', 'ventas_registro', 'prov_pedidos'];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    if (core.verifyWriter && !core.verifyWriter(body.token)) {
      return res.status(403).json({ error: 'Tu usuario no puede modificar registros.' });
    }
    const key = txt(body.key);
    const fila = Number(body.row);
    if (PERMITIDAS.indexOf(key) === -1) {
      return res.status(400).json({
        error: 'De esta pantalla no se pueden quitar renglones.',
        pista: 'Se puede en Cotizaciones, Ventas y Pedidos a proveedores.'
      });
    }
    if (!fila || fila < 2) return res.status(400).json({ error: 'Falta el renglón a quitar.' });

    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Esta área no está conectada.' });
    const pestana = await core.resolveSheetName(cfg);
    const values = await core.readRange(cfg.id, pestana);
    const headers = (values[0] || []).map(h => String(h).trim());
    const actual = values[fila - 1] || [];

    // Se comprueba que el renglón sea el que se cree: si alguien movió la hoja
    // entre que se cargó la pantalla y este clic, se estaría vaciando otro.
    if (body.producto) {
      const iProd = headers.findIndex(h => ['producto', 'productos', 'item']
        .indexOf(norm(h)) !== -1);
      if (iProd !== -1 && norm(actual[iProd]) !== norm(body.producto)) {
        return res.status(409).json({
          error: 'Ese renglón ya no tiene el producto que se iba a quitar.',
          pista: 'La hoja cambió desde que abriste la pantalla. Recarga y vuelve a ' +
                 'intentarlo, para no vaciar el renglón equivocado.'
        });
      }
    }

    // Qué se está quitando, para poder decirlo y para dejarlo escrito
    const dime = (nombres) => {
      const i = headers.findIndex(h => nombres.indexOf(norm(h)) !== -1);
      return i === -1 ? '' : txt(actual[i]);
    };
    const producto = dime(['producto', 'productos', 'item']);
    const material = dime(['material']);
    const folio = dime(['no. de referencia', 'no de referencia', 'referencia', 'folio',
                        'pedido proveedor']);

    const hoy = new Date();
    const cuando = hoy.getDate() + '/' + (hoy.getMonth() + 1) + '/' + hoy.getFullYear();
    const rastro = 'Quitado por ' + (sesion.u || 'alguien') + ' el ' + cuando +
                   (producto ? ' · era ' + producto + (material ? ' ' + material : '') : '');

    // El renglón se vacía: todas las columnas en blanco salvo el comentario
    const rec = {};
    headers.forEach(h => { if (h) rec[h] = ''; });
    const cCom = headers.filter(h => ['comentarios', 'comentario', 'notas', 'nota']
      .indexOf(norm(h)) !== -1)[0];
    if (cCom) rec[cCom] = rastro;

    const filaArr = headers.map(h => (rec[h] != null ? rec[h] : ''));
    await core.writeRowSkipping(cfg.id, pestana, fila, filaArr, new Set());

    return res.status(200).json({
      ok: true, fila, folio, producto, material,
      mensaje: producto
        ? ('Se quitó ' + producto + (material ? ' · ' + material : '') +
           (folio ? ' de ' + folio : '') + '.')
        : 'Renglón quitado.',
      // Para que quien lea sepa que el renglón sigue ahí, vacío
      nota: cCom ? 'El renglón queda en blanco, con una nota de quién lo quitó.'
                 : 'El renglón queda en blanco. Esta hoja no tiene columna de ' +
                   'Comentarios, así que no se pudo dejar la nota de quién lo quitó.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
