const core = require('../core');
// Áreas que el ERP calcula: no se editan a mano
const CALCULADAS = ['op_stock', 'op_revisar'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { token, key, row, record } = await core.readBody(req);
    if (!core.verifyWriter(token)) return res.status(401).json({ error: 'Tu usuario es de solo lectura.' });
    if (!core.SHEETS[key]) return res.status(400).json({ error: 'Esta área no está conectada.' });
    if (!row || Number(row) < 2) return res.status(400).json({ error: 'Fila inválida.' });
    const r = await core.updateRecord(key, Number(row), record || {});
    const tb = r && r.tambien;
    return res.status(200).json({
      ok: true, area: key, fila: Number(row),
      tambien: tb || null,
      // Se dice en voz alta: un cambio que tocó más renglones de los que se ven
      // en pantalla tiene que avisarse, no descubrirse después.
      aviso: tb ? ('Se actualizó ' + tb.campos.join(', ').toLowerCase() + ' en ' +
                   tb.filas + (tb.filas === 1 ? ' renglón más' : ' renglones más') +
                   ' del mismo folio.') : ''
    });
  } catch (e) {
    // Con el área y la fila puestas, un error deja de ser "no se pudo guardar" y
    // dice dónde falló, que es lo que hace falta para arreglarlo sin adivinar.
    const cfg = core.SHEETS[key] || {};
    return res.status(500).json({
      error: (e && e.message) || String(e),
      pista: 'Al guardar en el área "' + key + '", fila ' + row +
             (cfg.sheetName ? ', pestaña "' + cfg.sheetName + '"' : '') + '.'
    });
  }
};
