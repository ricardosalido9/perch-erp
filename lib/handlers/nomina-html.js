// La nómina del mes como tablero.
//
// El PDF es el documento que se archiva. Esto es para ver cómo se está moviendo
// el costo de la gente: contra el mes pasado, contra el año pasado, en qué área
// se concentra y quién entró y salió.
//
//   ?action=nomina-html&mes=8&anio=2026
const nomina = require('./nomina-pdf');
const CFG = require('../config');
const T = require('../tablero');
const { notasDe } = require('./notas');

const cambio = (hoy, antes) => (antes ? (hoy - antes) / Math.abs(antes) * 100 : null);
const comoCambio = (c) => c === null ? ''
  : (c >= 0 ? '+' : '') + c.toFixed(0) + '%';

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await nomina({ _body: { token: q.token, mes: +q.mes || undefined,
                          anio: +q.anio || undefined, soloDatos: true } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d || !d.datos) {
    return res.status(200).send(T.tableroError('No se pudo armar el reporte de nómina',
      (err && err.error) || '', (err && err.pista) || ''));
  }
  const x = d.datos;
  const r = x.resumen || {};
  const prev = x.mesAnterior || {};
  const anioAnt = x.mismoMesAnioAnterior || {};

  const cMes = cambio(r.neto || 0, prev.neto || 0);
  const cAnio = cambio(r.neto || 0, anioAnt.neto || 0);

  const kpis = [
    { k: 'Pagado en el mes', v: T.dinero(r.neto),
      f: cMes === null ? '' : comoCambio(cMes) + ' vs ' + (x.mesAnteriorNombre || 'el mes pasado') },
    { k: 'Colaboradores', v: T.numero(x.plantilla || r.colaboradores),
      f: 'promedio ' + T.dinero(x.promedio) + ' cada uno' },
    { k: 'Altas y bajas', v: T.numero((x.altas || []).length) + ' / ' + T.numero((x.bajas || []).length),
      mal: (x.bajas || []).length > (x.altas || []).length,
      f: 'rotación ' + (x.rotacion || 0).toFixed(1) + '%' },
    { k: 'Acumulado del año', v: T.dinero((x.anioAcumulado || {}).neto),
      f: x.anioAnterior && x.anioAnterior.neto
         ? comoCambio(cambio((x.anioAcumulado || {}).neto, x.anioAnterior.neto)) + ' vs el año pasado'
         : '' }
  ];

  const bloques = [];

  // Dónde se concentra el costo
  if ((x.porArea || []).length) {
    const total = x.porArea.reduce((s, a) => s + (a.neto || a.total || 0), 0) || 1;
    bloques.push({ tipo: 'seccion', titulo: 'Por área',
      nota: 'peso sobre la nómina del mes',
      filas: x.porArea.slice().sort((a, b) => (b.neto || b.total || 0) - (a.neto || a.total || 0))
        .map(a => ({
          nombre: a.area || a.etiqueta || 'Sin área',
          valor: a.neto || a.total || 0,
          detalle: (((a.neto || a.total || 0) / total) * 100).toFixed(1) + '% de la nómina',
          extra: a.colaboradores ? T.numero(a.colaboradores) +
                 (a.colaboradores === 1 ? ' persona' : ' personas') : ''
        })) });
  }

  if ((x.porTipoPago || []).length > 1) {
    bloques.push({ tipo: 'seccion', titulo: 'Cómo se paga',
      nota: 'nómina timbrada contra lo demás',
      filas: x.porTipoPago.map(t => ({
        nombre: t.tipo || t.etiqueta || '', valor: t.neto || t.total || 0,
        detalle: t.n ? T.numero(t.n) + ' pagos' : ''
      })) });
  }

  // Quién entró y quién salió: es lo que explica el movimiento del mes
  const gente = [];
  (x.altas || []).forEach(a => gente.push({
    nombre: (typeof a === 'string' ? a : (a.nombre || '')), valor: 0, texto: 'alta',
    detalle: typeof a === 'object' ? (a.puesto || a.area || '') : '' }));
  (x.bajas || []).forEach(b => gente.push({
    nombre: (typeof b === 'string' ? b : (b.nombre || '')), valor: 0, texto: 'baja',
    detalle: typeof b === 'object' ? (b.puesto || b.area || '') : '' }));
  if (gente.length) {
    bloques.push({ tipo: 'seccion', titulo: 'Quién entró y quién salió',
      nota: T.numero((x.altas || []).length) + ' altas · ' + T.numero((x.bajas || []).length) + ' bajas',
      sinBarra: true, filas: gente });
  }

  // Y por qué se movió el total
  const puntos = [];
  if (cMes !== null && Math.abs(cMes) > 5) {
    puntos.push('La nómina ' + (cMes > 0 ? 'subió ' : 'bajó ') + Math.abs(cMes).toFixed(0) +
      '% contra ' + (x.mesAnteriorNombre || 'el mes pasado') + ': de ' + T.dinero(prev.neto) +
      ' a ' + T.dinero(r.neto) + '.');
  }
  if ((x.bajas || []).length > (x.altas || []).length) {
    puntos.push('Salieron más personas de las que entraron: ' + (x.bajas || []).length +
      ' bajas contra ' + (x.altas || []).length + ' altas.');
  }
  if (x.rotacion > 10) {
    puntos.push('La rotación del mes fue ' + x.rotacion.toFixed(1) + '%, que es alta para una ' +
      'plantilla de ' + T.numero(x.plantilla || r.colaboradores) + '.');
  }
  if (puntos.length) {
    bloques.push({ tipo: 'avisos', titulo: 'Lo que explica el mes', puntos });
  }

  // Las notas que alguien escribió sobre este reporte
  let notas = {};
  try {
    notas = await notasDe('nomina', x.anio, (+q.mes || 0));
  } catch (e) { notas = {}; }

  return res.status(200).send(T.tablero({
    notas,
    eyebrow: x.empresa || '',
    titulo: 'Nómina de ' + String(x.mes).toLowerCase(),
    subtitulo: x.mes + ' de ' + x.anio + ' · comparada contra el mes anterior y el año pasado',
    kpis, bloques,
    pie: 'Sale de la nómina timbrada del mes.'
  }));
};
