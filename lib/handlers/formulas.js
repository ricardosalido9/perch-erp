// Bajarle las fórmulas a los renglones que se quedaron sin ellas.
//
// Cuando Google no copia las fórmulas al renglón nuevo, la venta se guarda con
// el precio pero sin Total Pedido. Entonces suma cero en el dashboard y la
// pantalla de facturación dice "no encontré el total de esa venta", que fue lo
// que le salió a Camila con la O10-26.
//
// Hasta ahora el aviso decía "ábrela y arrastra las fórmulas del renglón de
// arriba", o sea: trabajo a mano en la hoja del cliente. Esto lo hace solo.
//
//   ?action=formulas  { key, folio }   ó   { key, filas: [5955, 5956] }
const core = require('../core');

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
const normFolio = (v) => norm(String(v == null ? '' : v).trim().replace(/\.0+$/, ''));

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const key = txt(body.key) || 'ventas_registro';
    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Esa área no está conectada.' });
    const sheetName = core.resolveSheetName ? await core.resolveSheetName(cfg) : cfg.sheetName;

    const values = await core.readRange(cfg.id, sheetName);
    if (!values.length) return res.status(400).json({ error: 'La hoja llegó vacía.' });
    const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
    const headers = (values[hr] || []).map(h => txt(h));

    // Las columnas calculadas de esta área: son las que hay que rellenar
    const skip = new Set();
    (core.FORMULA_FIELDS[key] || []).forEach(f => {
      headers.forEach((h, i) => { if (norm(h) === norm(f)) skip.add(i); });
    });
    if (!skip.size) {
      return res.status(400).json({ error: 'Esta área no tiene columnas de fórmula.' });
    }

    // Qué renglones arreglar: los del folio que se pide, o los que digan
    let filas = (body.filas || []).map(n => Math.round(Number(n))).filter(n => n > hr + 1);
    const folio = txt(body.folio);
    if (!filas.length && folio) {
      const iRef = headers.findIndex(h => /^(no\. de referencia|folio)$/i.test(h));
      if (iRef === -1) return res.status(400).json({ error: 'La hoja no tiene columna de folio.' });
      for (let i = hr + 1; i < values.length; i++) {
        if (normFolio((values[i] || [])[iRef]) === normFolio(folio)) filas.push(i + 1);
      }
      if (!filas.length) {
        return res.status(404).json({ error: 'No se encontró el folio ' + folio + '.' });
      }
    }
    if (!filas.length) return res.status(400).json({ error: 'Falta decir qué renglón arreglar.' });

    // Solo los que de verdad están sin fórmulas: no se pisa lo que ya calculó
    const cols = Array.from(skip);
    const vacias = filas.filter(f => {
      const fila = values[f - 1] || [];
      return !cols.some(c => txt(fila[c]) !== '');
    });
    if (!vacias.length) {
      return res.status(200).json({ ok: true, arregladas: [], yaEstaban: filas,
        mensaje: 'Esos renglones ya tienen sus fórmulas.' });
    }

    const fuente = await core._filaFuenteFormulas(cfg.id, sheetName, skip, Math.min(...vacias), hr + 1);
    if (!fuente) {
      return res.status(400).json({
        error: 'No encontré ningún renglón de dónde copiar las fórmulas.',
        pista: 'Tiene que haber al menos una venta anterior con su Total Pedido calculado.'
      });
    }
    const errores = [];
    for (const f of vacias) {
      try { await core.copiarFormulas(cfg.id, sheetName, fuente, f, skip); }
      catch (e) { errores.push(f + ': ' + ((e && e.message) || String(e))); }
    }

    // Comprobar de verdad: se relee y se mira si ya tienen algo
    const dentro = await core.readRange(cfg.id, sheetName);
    const siguenVacias = vacias.filter(f => {
      const fila = dentro[f - 1] || [];
      return !cols.some(c => txt(fila[c]) !== '');
    });
    if (siguenVacias.length) {
      return res.status(400).json({
        error: 'La hoja no aceptó las fórmulas en ' +
               (siguenVacias.length === 1 ? 'el renglón ' : 'los renglones ') +
               siguenVacias.join(', ') + '.',
        pista: errores.join(' · ') || 'Puede que esas celdas estén protegidas.'
      });
    }
    return res.status(200).json({
      ok: true, arregladas: vacias, copiadasDe: fuente,
      mensaje: vacias.length === 1
        ? 'Listo: el renglón ' + vacias[0] + ' ya tiene su total.'
        : 'Listos: ' + vacias.length + ' renglones ya tienen su total.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
