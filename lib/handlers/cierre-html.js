// El cierre del mes como tablero.
//
// El PDF de cierre es un documento: se manda, se archiva, se firma. Esto es para
// leerlo en pantalla, así que muestra otra cosa —pesos relativos, cómo se movió
// contra el mes pasado, de dónde vino cada peso— y deja el detalle largo para el
// PDF. Los dos salen del mismo cálculo.
//
//   ?action=cierre-html&mes=8&anio=2026
const cierre = require('./cierre');
const CFG = require('../config');
const T = require('../tablero');

const MESL = ['enero','febrero','marzo','abril','mayo','junio','julio',
              'agosto','septiembre','octubre','noviembre','diciembre'];

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  // soloDatos: se pide el cálculo sin armar el PDF, que es lo caro
  await cierre({ _body: { token: q.token, mes: +q.mes || undefined,
                          anio: +q.anio || undefined, soloDatos: true } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d || !d.datos) {
    return res.status(200).send(T.tableroError('No se pudo armar el cierre',
      (err && err.error) || '', (err && err.pista) || ''));
  }
  const x = d.datos;
  const v = x.ventas || {};
  const cmp = x.comparacion || {};
  const emb = x.embudo || {};

  // ---- las cuatro cifras ----
  const kpis = [];
  kpis.push({ k: 'Vendido en el mes', v: T.dinero(v.total),
    f: cmp.ventasPct === null || cmp.ventasPct === undefined ? ''
       : (cmp.ventasPct >= 0 ? '+' : '') + cmp.ventasPct.toFixed(0) + '% vs el mes pasado (' +
         T.dinero(cmp.ventasPrev) + ')' });
  kpis.push({ k: 'Operaciones', v: T.numero(v.operaciones),
    f: 'ticket promedio ' + T.dinero(v.ticket) });
  if (v.utilidad != null) {
    kpis.push({ k: 'Utilidad', v: T.dinero(v.utilidad), hi: v.utilidad > 0, mal: v.utilidad <= 0,
      f: v.margenPct != null ? v.margenPct.toFixed(1) + '% de margen' : '' });
  } else {
    kpis.push({ k: 'Piezas', v: T.numero(v.piezas), f: 'entregadas o por entregar' });
  }
  kpis.push({ k: 'Acumulado del año', v: T.dinero(x.acumulado),
    f: 'a ' + MESL[(x.mesNumero || 1) - 1] });

  const bloques = [];

  // De dónde vino la venta del mes
  if (v.total) {
    const tramos = [];
    if (v.costo) tramos.push({ n: 'Costo', v: v.costo, color: '#8a7f6a' });
    if (v.utilidad != null && v.utilidad > 0)
      tramos.push({ n: 'Utilidad', v: v.utilidad, color: '#2f4f3e', texto: '#fff' });
    if (v.envios) tramos.push({ n: 'Envíos', v: v.envios, color: '#d8cfb8' });
    if (tramos.length > 1) {
      bloques.push({ tipo: 'split', titulo: 'En qué se convierte la venta',
        nota: T.dinero(v.total) + ' vendidos', tramos });
    }
  }

  // El año mes a mes, con el mes del cierre marcado por el tamaño de su barra
  if ((x.historico || []).length) {
    const vals = new Array(12).fill(0);
    x.historico.forEach(h => { vals[h.mes - 1] = h.total; });
    bloques.push({ tipo: 'seccion', titulo: 'El año mes a mes',
      nota: T.dinero(x.acumulado) + ' acumulados', filas: [],
      barrasMes: { valores: vals, desde: 1, hasta: 12 } });
  }

  // El embudo: de dónde salieron las ventas del mes
  if (emb.leads || emb.cotizaciones) {
    bloques.push({ tipo: 'seccion', titulo: 'El embudo del mes',
      nota: emb.conversion != null ? emb.conversion.toFixed(0) + '% de las cotizaciones cerraron' : '',
      formato: 'numero',
      filas: [
        { nombre: 'Leads nuevos', valor: emb.leads || 0 },
        { nombre: 'Visitas al showroom', valor: emb.visitas || 0 },
        { nombre: 'Cotizaciones', valor: emb.cotizaciones || 0 },
        { nombre: 'Ventas cerradas', valor: emb.ventas || 0 }
      ].filter(f => f.valor) });
  }

  const conPeso = (lista, campo) => lista.map(p => ({
    nombre: p.nombre || p.canal, valor: p[campo],
    detalle: v.total ? ((p[campo] / v.total) * 100).toFixed(1) + '% de la venta' : '',
    extra: p.piezas ? T.numero(p.piezas) + ' pzs'
           : (p.n ? T.numero(p.n) + (p.n === 1 ? ' venta' : ' ventas') : '')
  }));

  if ((x.productos || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Qué se vendió',
      nota: T.numero(x.productos.length) + ' productos distintos',
      filas: conPeso(x.productos.slice(0, 12), 'total') });
  }
  if ((x.clientes || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Quién compró',
      nota: T.numero(x.clientes.length) + ' clientes' +
            ((x.clientesNuevos || []).length ? ' · ' + x.clientesNuevos.length + ' nuevos' : ''),
      filas: conPeso(x.clientes.slice(0, 12), 'total') });
  }
  if ((x.marketing || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'De dónde llegaron',
      nota: 'por canal', filas: conPeso(x.marketing, 'total') });
  }
  if ((x.clientesNuevos || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Clientes nuevos del mes',
      nota: T.numero(x.clientesNuevos.length), sinBarra: true,
      filas: x.clientesNuevos.slice(0, 20).map(c => ({
        nombre: typeof c === 'string' ? c : (c.nombre || ''),
        valor: 0, texto: '' })) });
  }

  return res.status(200).send(T.tablero({
    eyebrow: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
    titulo: 'Cierre de ' + MESL[(x.mesNumero || 1) - 1],
    subtitulo: MESL[(x.mesNumero || 1) - 1] + ' de ' + x.anio +
               ' · comparado contra el mes anterior',
    kpis, bloques,
    pie: 'Sale de las ventas del mes con su fecha de cierre. El PDF del cierre trae ' +
         'el mismo cálculo con el detalle completo.'
  }));
};
