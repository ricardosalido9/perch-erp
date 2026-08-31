// Corrige el nombre del cliente de un folio, en la venta y en la cotización.
//
// Se equivocaron de cliente al capturar (Luis Mejía en vez de Luis Mijares) y no
// había forma de arreglarlo: el cliente es la llave de Cuentas por Cobrar, del
// expediente y del estado de cuenta, así que un nombre mal escrito rompe los tres.
//
// Nunca cambia las dos hojas sin preguntar: primero devuelve qué encontró y en
// cuántos renglones, y solo escribe cuando le mandan confirmar.
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

// Dónde buscar el folio: en ventas, en cotizaciones y en cuentas por cobrar
const DONDE = [
  { key: 'ventas_registro', que: 'la venta' },
  { key: 'cotizaciones', que: 'la cotización' },
  { key: 'fin_cxc', que: 'cuentas por cobrar' }
];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = txt(body.folio);
    const nuevo = txt(body.cliente);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    const hallazgos = [];
    for (const d of DONDE) {
      const cfg = core.areaCfg ? await core.areaCfg(d.key) : core.SHEETS[d.key];
      if (!cfg || !cfg.id) continue;
      let values;
      try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { continue; }
      if (!values.length) continue;
      const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
      const H = (values[hr] || []).map(h => String(h).trim());
      const cRef = col(H, 'No. de Referencia', 'Folio');
      const cCli = col(H, 'Cliente');
      // En cotizaciones el folio de la venta puede estar en otra columna
      const cRefAlt = col(H, 'Folio de venta', 'Venta');
      if (!cCli || (!cRef && !cRefAlt)) continue;

      const filas = [];
      let actual = '';
      for (let i = hr + 1; i < values.length; i++) {
        const f = values[i] || [];
        const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
        const ref = txt(cRef ? o[cRef] : '') || txt(cRefAlt ? o[cRefAlt] : '');
        if (norm(ref) !== norm(folio)) continue;
        filas.push(i + 1);
        if (!actual) actual = txt(o[cCli]);
      }
      if (filas.length) {
        hallazgos.push({ key: d.key, que: d.que, sheetName: cfg.sheetName, id: cfg.id,
                         columna: cCli, indice: H.indexOf(cCli),
                         filas: filas, clienteActual: actual });
      }
    }

    if (!hallazgos.length) {
      return res.status(404).json({ error: 'No se encontró el folio ' + folio + '.' });
    }

    // Primera llamada: se dice qué se encontró y no se escribe nada
    if (!body.confirmar) {
      return res.status(200).json({
        ok: true, confirmado: false,
        folio: folio,
        clienteActual: hallazgos[0].clienteActual,
        clienteNuevo: nuevo,
        donde: hallazgos.map(h => ({
          que: h.que, renglones: h.filas.length, clienteActual: h.clienteActual
        })),
        pregunta: nuevo
          ? '¿Cambiar el cliente a "' + nuevo + '" en ' +
            hallazgos.map(h => h.que + ' (' + h.filas.length +
              (h.filas.length === 1 ? ' renglón' : ' renglones') + ')').join(', ') + '?'
          : 'Escribe el nombre correcto.',
        nota: 'El cliente es la llave de cuentas por cobrar y del expediente. ' +
              'Si se cambia en un lado y no en el otro, dejan de cuadrar.'
      });
    }

    if (!nuevo) return res.status(400).json({ error: 'Falta el nombre nuevo.' });

    // Solo las hojas que pidieron. Si no dicen cuáles, todas las que se encontraron.
    const pedidas = Array.isArray(body.hojas) && body.hojas.length ? body.hojas : null;
    let cambiados = 0;
    const detalle = [];
    for (const h of hallazgos) {
      if (pedidas && pedidas.indexOf(h.key) === -1) continue;
      const celdas = h.filas.map(f => ({
        range: "'" + h.sheetName + "'!" + letra(h.indice) + f,
        values: [[nuevo]]
      }));
      await core.writeCells(h.id, celdas);
      cambiados += celdas.length;
      detalle.push({ que: h.que, renglones: celdas.length,
                     antes: h.clienteActual, ahora: nuevo });
    }

    return res.status(200).json({
      ok: true, confirmado: true,
      cambiados: cambiados,
      detalle: detalle,
      mensaje: 'Se cambió el cliente en ' + cambiados +
               (cambiados === 1 ? ' renglón.' : ' renglones.')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
