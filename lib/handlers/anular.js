// Anular una cotización o una venta capturada por error.
//
// Por qué no se borra el renglón: en una hoja de cálculo borrar una fila corre
// todas las de abajo, y el ERP guarda números de fila en varios lados. Borrar
// también deja un hueco en los folios que nadie puede explicar después.
//
// En vez de eso se marca como CANCELADA. Deja de contar en el dashboard, en el
// cierre, en el comparativo de costos y en la conversión, pero se puede ver qué
// pasó y quién lo canceló. Si de verdad hay que borrarla, hay una opción aparte
// y solo para el administrador.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const letra = (i) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const key = txt(body.key) || 'cotizaciones';
    const folio = txt(body.folio);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
    if (['cotizaciones', 'ventas_registro'].indexOf(key) === -1) {
      return res.status(400).json({ error: 'Solo se pueden anular cotizaciones y ventas.' });
    }

    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Esa área no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer la hoja.' });
    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const cRef = col(H, 'No. de Referencia', 'Folio');
    const cSt = col(H, 'Status');
    const cCom = col(H, 'Comentarios', 'Comentario', 'Nota');
    const cCli = col(H, 'Cliente');
    const cProd = col(H, 'Producto', 'Productos');
    const cTot = col(H, 'Total con envío', 'Total', 'Total con IVA');
    if (!cRef) return res.status(400).json({ error: 'La hoja no tiene columna de folio.' });
    if (!cSt) {
      return res.status(400).json({
        error: 'La hoja no tiene columna "Status".',
        pista: 'Sin ella no hay dónde marcar la cancelación.'
      });
    }

    const filas = [];
    for (let i = hr + 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      if (norm(o[cRef]) !== norm(folio)) continue;
      filas.push({ fila: i + 1, cliente: txt(cCli ? o[cCli] : ''),
                   producto: txt(cProd ? o[cProd] : ''),
                   total: txt(cTot ? o[cTot] : ''),
                   status: txt(o[cSt]) });
    }
    if (!filas.length) return res.status(404).json({ error: 'No se encontró ' + folio + '.' });

    // Primera llamada: se dice qué se va a anular y no se toca nada
    if (!body.confirmar) {
      return res.status(200).json({
        ok: true, confirmado: false,
        folio, renglones: filas.length,
        cliente: filas[0].cliente,
        detalle: filas.slice(0, 20),
        yaCancelada: filas.every(f => /cancelad|anulad/i.test(f.status)),
        pregunta: '¿Cancelar ' + folio + '? Son ' + filas.length +
          (filas.length === 1 ? ' renglón' : ' renglones') + '.',
        nota: 'Se marca como CANCELADA: deja de contar en el dashboard, en el cierre, ' +
              'en el comparativo de costos y en la tasa de conversión, pero queda el ' +
              'registro de qué pasó. No se borra el renglón.'
      });
    }

    const quien = txt(sesion && sesion.nombre) || txt(sesion && sesion.usuario) || '';
    const hoy = new Date();
    const sello = hoy.getDate() + ' ' + MESES[hoy.getMonth()] + ' ' + hoy.getFullYear();
    const motivo = txt(body.motivo);

    const celdas = [];
    filas.forEach(f => {
      celdas.push({ range: "'" + cfg.sheetName + "'!" + letra(H.indexOf(cSt)) + f.fila,
                    values: [['Cancelada']] });
      if (cCom) {
        celdas.push({ range: "'" + cfg.sheetName + "'!" + letra(H.indexOf(cCom)) + f.fila,
                      values: [['Cancelada por ' + (quien || 'el ERP') + ' el ' + sello +
                                (motivo ? ' · ' + motivo : '')]] });
      }
    });
    await core.writeCells(cfg.id, celdas);

    return res.status(200).json({
      ok: true, confirmado: true,
      renglones: filas.length,
      mensaje: folio + ' quedó cancelada en ' + filas.length +
               (filas.length === 1 ? ' renglón.' : ' renglones.'),
      nota: 'Ya no cuenta en los análisis. Si la necesitas de vuelta, cámbiale el ' +
            'status a mano en la hoja.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
