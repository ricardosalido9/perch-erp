// El comparativo de costos en PDF, para el paquete del cierre.
// Sale del mismo cálculo que la pantalla y que el tablero.
//
//   ?action=costos-pdf
const core = require('../core');
const CFG = require('../config');
const costos = require('./costos');
const { reporteSecciones, dinero } = require('../pdf-secciones');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    let d = null, err = null;
    const captura = { status: (c) => ({ json: (o) => {
      if (c === 200 && o && o.ok) d = o; else err = o; return o;
    } }) };
    await costos({ _body: { token: body.token } }, captura);
    if (!d) return res.status(400).json({ error: (err && err.error) || 'No se pudo armar.' });

    const filas = (d.filas || []).filter(f => f.venta);
    const conReal = filas.filter(f => f.costoReal !== null && f.costoReal !== undefined);
    const venta = filas.reduce((s, f) => s + (f.venta || 0), 0);
    const costoR = conReal.reduce((s, f) => s + (f.costoReal || 0), 0);
    const ventaR = conReal.reduce((s, f) => s + (f.venta || 0), 0);
    const margen = ventaR ? (ventaR - costoR) / ventaR : null;

    const secciones = [];
    // De dónde salió cada costo: dice cuánto se puede confiar en el número
    const fuentes = {};
    conReal.forEach(f => (f.detalle || []).forEach(x => {
      const k = x.deDonde || 'sin identificar';
      fuentes[k] = (fuentes[k] || 0) + (x.costoTotal || 0);
    }));
    const lf = Object.keys(fuentes).map(k => ({ nombre: k, valor: fuentes[k] }))
      .sort((a, b) => b.valor - a.valor);
    if (lf.length) secciones.push({ titulo: 'De dónde salió el costo',
      nota: 'un costo de su pedido vale más que uno de un promedio', filas: lf });

    const flojos = conReal.filter(f => f.margenReal != null)
      .sort((a, b) => a.margenReal - b.margenReal).slice(0, 20)
      .map(f => ({ nombre: f.folio + (f.cliente ? ' · ' + f.cliente : ''),
        valor: f.venta,
        detalle: (f.margenReal * 100).toFixed(1) + '% de margen · costo ' + dinero(f.costoReal) }));
    if (flojos.length) secciones.push({ titulo: 'Dónde se está yendo el margen',
      nota: 'de menor a mayor margen', filas: flojos });

    const sinReal = filas.filter(f => f.costoReal == null);
    const notas = [];
    if (sinReal.length) {
      notas.push(sinReal.length + ' de ' + filas.length + ' folios no tienen costo real: les ' +
        'faltan salidas registradas, así que su margen no se puede saber. Suman ' +
        dinero(sinReal.reduce((s, f) => s + (f.venta || 0), 0)) + ' de venta.');
    }
    (d.avisos || []).forEach(a => notas.push(typeof a === 'string' ? a : (a.texto || '')));

    const buf = await reporteSecciones({
      titulo: 'Comparativo de costos',
      subtitulo: 'Lo que costó de verdad contra lo que dice el catálogo',
      cifras: [
        { k: 'Vendido', v: dinero(venta), f: filas.length + ' folios' },
        { k: 'Con costo real', v: String(conReal.length), f: 'de ' + filas.length },
        { k: 'Costo real', v: dinero(costoR) },
        { k: 'Margen real', v: margen === null ? '—' : (margen * 100).toFixed(1) + '%' }
      ],
      secciones, notas
    }, { empresa: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
         pie: 'El costo real sale de las salidas registradas y sus pedidos.' });

    return res.status(200).json({ ok: true, pdf: buf.toString('base64'),
      nombre: 'Comparativo de costos.pdf' });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
