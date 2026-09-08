// El estado financiero como tablero, armado con el molde compartido.
//
//   ?action=estado-html&cual=resultados&anio=2026&desde=1&hasta=7
const armar = require('./estados');
const CFG = require('../config');
const T = require('../tablero');

const MESL = ['enero','febrero','marzo','abril','mayo','junio','julio',
              'agosto','septiembre','octubre','noviembre','diciembre'];
const sinAcentos = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

module.exports = async (req, res) => {
  const q = req.query || {};
  // Se le pide al mismo motor que dibuja la pantalla: el tablero y la tabla no
  // pueden decir cosas distintas porque salen del mismo cálculo.
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await armar({ _body: {
    token: q.token, estado: q.cual || 'resultados',
    anio: +q.anio || new Date().getFullYear(),
    desde: +q.desde || 1, hasta: +q.hasta || 12
  } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d) {
    return res.status(200).send(T.tableroError('No se pudo armar el estado',
      (err && err.error) || '', (err && err.pista) || ''));
  }

  const busca = (n) => (d.filas || []).filter(f => sinAcentos(f.concepto) === sinAcentos(n))[0];
  const esFlujo = (q.cual || '') === 'flujo';
  const base = esFlujo ? busca('Entradas de efectivo') : busca('Ventas Netas');
  const periodo = (d.desde === d.hasta ? MESL[d.desde - 1]
                   : MESL[d.desde - 1] + ' a ' + MESL[d.hasta - 1]) + ' de ' + d.anio;

  // ---- las cifras de arriba ----
  const kpis = [];
  if (esFlujo) {
    const en = busca('Entradas de efectivo'), sa = busca('Salidas de efectivo');
    const ca = busca('Cambio en efectivo y bancos');
    const sal = (d.filas || []).filter(f => f.tipo === 'acumulado')[0];
    if (en) kpis.push({ k: 'Entradas', v: T.dinero(en.total) });
    if (sa) kpis.push({ k: 'Salidas', v: T.dinero(sa.total) });
    if (ca) kpis.push({ k: 'Cambio en efectivo', v: T.dinero(ca.total), hi: ca.total >= 0,
      mal: ca.total < 0, f: ca.total >= 0 ? 'creció en el periodo' : 'se redujo en el periodo' });
    if (sal) kpis.push({ k: 'Saldo al cierre', v: T.dinero(sal.total),
      f: 'al ' + MESL[d.hasta - 1] });
  } else {
    const vn = busca('Ventas Netas'), ub = busca('Utilidad bruta');
    const uo = busca('Utilidad operativa'), un = busca('Utilidad Neta');
    if (vn) {
      const c = vn.anterior ? (vn.total - vn.anterior) / Math.abs(vn.anterior) * 100 : null;
      kpis.push({ k: 'Ventas netas', v: T.dinero(vn.total),
        f: c === null ? '' : (c >= 0 ? '+' : '') + c.toFixed(0) + '% vs el año pasado' });
    }
    if (ub && vn && vn.total) kpis.push({ k: 'Margen bruto', v: T.pct(ub.total / vn.total),
      f: 'utilidad bruta ' + T.dinero(ub.total) });
    if (uo && vn && vn.total) kpis.push({ k: 'Margen operativo', v: T.pct(uo.total / vn.total),
      hi: uo.total > 0, mal: uo.total <= 0, f: 'utilidad operativa ' + T.dinero(uo.total) });
    if (un) kpis.push({ k: 'Utilidad neta', v: T.dinero(un.total),
      f: vn && vn.total ? T.pct(un.total / vn.total) + ' de la venta' : '' });
  }

  const bloques = [];

  // En qué se convierte cada peso de venta
  if (!esFlujo && base && base.total) {
    const cv = busca('Costo de Ventas'), gga = busca('Gastos Generales y Administrativos');
    const gv = busca('Gastos de Venta'), uo = busca('Utilidad operativa');
    bloques.push({ tipo: 'split', titulo: 'De dónde sale la utilidad',
      nota: T.dinero(base.total) + ' de venta neta',
      tramos: [
        { n: 'Costo de ventas', v: cv ? cv.total : 0, color: '#8a7f6a' },
        { n: 'Gastos generales', v: gga ? gga.total : 0, color: '#b9ad93' },
        { n: 'Gastos de venta', v: gv ? gv.total : 0, color: '#d8cfb8' },
        { n: 'Utilidad', v: uo ? uo.total : 0, color: '#2f4f3e', texto: '#fff' }
      ] });
  }

  // El mes a mes de la cifra que manda
  const principal = esFlujo ? busca('Cambio en efectivo y bancos') : busca('Ventas Netas');
  if (principal) {
    bloques.push({ tipo: 'seccion', titulo: principal.concepto + ' mes a mes',
      nota: T.dinero(principal.total) + ' en el periodo', filas: [],
      barrasMes: { valores: principal.meses, desde: d.desde, hasta: d.hasta } });
  }

  if ((d.avisos || []).length) {
    bloques.push({ tipo: 'avisos', titulo: 'Ojo con esto',
      grave: d.avisos.some(a => a.grave), puntos: d.avisos.map(a => a.texto) });
  }
  if ((d.lectura || []).length) {
    bloques.push({ tipo: 'avisos', titulo: 'Lo que hay que revisar', puntos: d.lectura });
  }

  const conValor = (d.filas || []).filter(f => f.total);
  const fila = (f) => {
    const peso = (base && base.total) ? (f.total / base.total * 100) : null;
    const cam = f.anterior ? (f.total - f.anterior) / Math.abs(f.anterior) * 100 : null;
    return {
      nombre: f.concepto, valor: f.total,
      detalle: peso === null ? '' : peso.toFixed(1) + '% del total',
      extra: cam === null ? '' : (cam >= 0 ? '+' : '') + cam.toFixed(0) + '% vs ' +
             T.dinero(f.anterior),
      extraClase: cam === null ? '' : (cam >= 0 ? 'up' : 'down')
    };
  };
  const subt = conValor.filter(f => f.tipo === 'subtotal').map(fila);
  if (subt.length) bloques.push({ tipo: 'seccion', titulo: 'Los bloques',
    nota: 'peso sobre ' + (base ? base.concepto.toLowerCase() : 'el total'), filas: subt });

  const datos = conValor.filter(f => f.tipo === 'dato');
  const gastos = datos.filter(f => f.signo < 0).sort((a, b) => b.total - a.total).slice(0, 12).map(fila);
  if (gastos.length) bloques.push({ tipo: 'seccion',
    titulo: esFlujo ? 'A dónde se fue el dinero' : 'En qué se gasta',
    nota: 'de mayor a menor', filas: gastos });

  const entradas = datos.filter(f => f.signo > 0).sort((a, b) => b.total - a.total).slice(0, 8).map(fila);
  if (entradas.length) bloques.push({ tipo: 'seccion',
    titulo: esFlujo ? 'De dónde entró' : 'De dónde viene el ingreso',
    nota: 'de mayor a menor', filas: entradas });

  return res.status(200).send(T.tablero({
    eyebrow: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
    titulo: d.titulo,
    subtitulo: periodo + ' · comparado contra el mismo periodo de ' + (d.anio - 1),
    kpis, bloques,
    pie: 'Sale de ' + (d.pestanas ? d.pestanas.datos : '') + ', con la estructura de ' +
         (d.pestanas ? d.pestanas.conceptos : '') + '.'
  }));
};
