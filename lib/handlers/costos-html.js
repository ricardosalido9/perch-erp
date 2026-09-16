// El comparativo de costos como tablero.
//
// La pantalla sirve para perseguir folio por folio. Esto sirve para ver si el
// negocio está dejando lo que debería: qué tan lejos está el costo real del que
// dice el catálogo, en qué folios se está perdiendo margen, y cuánto del número
// es confiable —porque un costo que salió de un promedio no vale lo mismo que
// uno que salió de su pedido—.
//
//   ?action=costos-html
const costos = require('./costos');
const CFG = require('../config');
const T = require('../tablero');

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await costos({ _body: { token: q.token } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d) {
    return res.status(200).send(T.tableroError('No se pudo armar el comparativo',
      (err && err.error) || '', (err && err.pista) || ''));
  }

  const filas = (d.filas || []).filter(f => f.venta);
  const conReal = filas.filter(f => f.costoReal !== null && f.costoReal !== undefined);
  const venta = filas.reduce((s, f) => s + (f.venta || 0), 0);
  const costoR = conReal.reduce((s, f) => s + (f.costoReal || 0), 0);
  const ventaR = conReal.reduce((s, f) => s + (f.venta || 0), 0);
  const margen = ventaR ? (ventaR - costoR) / ventaR : null;

  const kpis = [
    { k: 'Vendido', v: T.dinero(venta), f: T.numero(filas.length) + ' folios' },
    { k: 'Con costo real', v: T.numero(conReal.length),
      f: filas.length ? T.pct(conReal.length / filas.length, 0) + ' de los folios' : '',
      mal: conReal.length < filas.length * 0.7 },
    { k: 'Costo real', v: T.dinero(costoR), f: 'de los folios que sí lo tienen' },
    { k: 'Margen real', v: margen === null ? '—' : T.pct(margen),
      hi: margen !== null && margen > 0, mal: margen !== null && margen <= 0,
      f: T.dinero(ventaR - costoR) + ' de utilidad' }
  ];

  const bloques = [];

  // De dónde salió cada costo: es lo que dice cuánto se puede confiar en el número
  const fuentes = {};
  conReal.forEach(f => {
    (f.detalle || []).forEach(x => {
      const k = x.deDonde || 'sin identificar';
      fuentes[k] = (fuentes[k] || 0) + (x.costoTotal || 0);
    });
  });
  const listaF = Object.keys(fuentes).map(k => ({ nombre: k, valor: fuentes[k] }))
    .sort((a, b) => b.valor - a.valor);
  if (listaF.length) {
    bloques.push({ tipo: 'seccion', titulo: 'De dónde salió el costo',
      nota: 'un costo que viene de su pedido vale más que uno de un promedio',
      filas: listaF });
  }

  // Los folios donde el margen se va: de menor a mayor
  const flojos = conReal.filter(f => f.margenReal !== null && f.margenReal !== undefined)
    .sort((a, b) => a.margenReal - b.margenReal).slice(0, 15)
    .map(f => ({
      nombre: f.folio + (f.cliente ? ' · ' + f.cliente : ''),
      valor: f.venta,
      detalle: T.pct(f.margenReal) + ' de margen',
      extra: 'costo ' + T.dinero(f.costoReal),
      extraClase: f.margenReal < 0.2 ? 'down' : ''
    }));
  if (flojos.length) {
    bloques.push({ tipo: 'seccion', titulo: 'Dónde se está yendo el margen',
      nota: 'los folios con menos margen', filas: flojos });
  }

  // Lo que no se puede evaluar todavía
  const sinReal = filas.filter(f => f.costoReal === null || f.costoReal === undefined);
  if (sinReal.length) {
    bloques.push({ tipo: 'avisos', titulo: 'Folios sin costo real',
      grave: sinReal.length > filas.length * 0.3,
      puntos: [
        T.numero(sinReal.length) + ' de ' + T.numero(filas.length) + ' folios no tienen ' +
        'costo real: les faltan salidas registradas, así que su margen no se puede saber.',
        'Suman ' + T.dinero(sinReal.reduce((s, f) => s + (f.venta || 0), 0)) + ' de venta.'
      ].concat(sinReal.slice(0, 10).map(f =>
        f.folio + (f.cliente ? ' · ' + f.cliente : '') + ' · ' + T.dinero(f.venta))) });
  }

  // Cuando el catálogo y la realidad no coinciden
  const desviados = conReal.filter(f => f.costoCatalogo &&
      Math.abs(f.costoReal - f.costoCatalogo) / f.costoCatalogo > 0.15)
    .sort((a, b) => Math.abs(b.costoReal - b.costoCatalogo) - Math.abs(a.costoReal - a.costoCatalogo))
    .slice(0, 12)
    .map(f => ({
      nombre: f.folio + (f.cliente ? ' · ' + f.cliente : ''),
      valor: Math.abs(f.costoReal - f.costoCatalogo),
      detalle: 'catálogo ' + T.dinero(f.costoCatalogo) + ' · real ' + T.dinero(f.costoReal),
      extra: (f.costoReal > f.costoCatalogo ? 'costó más' : 'costó menos'),
      extraClase: f.costoReal > f.costoCatalogo ? 'down' : 'up'
    }));
  if (desviados.length) {
    bloques.push({ tipo: 'seccion', titulo: 'El catálogo se quedó atrás',
      nota: 'más de 15% de diferencia contra el costo real', filas: desviados });
  }

  return res.status(200).send(T.tablero({
    eyebrow: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
    titulo: 'Comparativo de costos',
    subtitulo: 'Lo que costó de verdad contra lo que dice el catálogo',
    kpis, bloques,
    pie: 'El costo real sale de las salidas registradas y sus pedidos. Los folios sin ' +
         'salidas no se pueden evaluar.'
  }));
};
