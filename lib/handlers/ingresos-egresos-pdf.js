// El reporte de ingresos y egresos del mes, como el que ya se mandaba a mano:
// saldo al inicio, entradas, salidas, saldo al final, y las categorías de cada
// lado. Sale del mismo cálculo que el flujo de efectivo, así que no puede
// discrepar del estado.
//
//   ?action=ingresos-egresos-pdf  { mes, anio }
const core = require('../core');
const CFG = require('../config');
const armar = require('./estados');
const { reporteSecciones, dinero } = require('../pdf-secciones');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const sinAcentos = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const hoy = new Date();
    const mes = +body.mes || (hoy.getMonth() === 0 ? 12 : hoy.getMonth());
    const anio = +body.anio || (hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear());

    // El mes solo: este reporte es del mes, no del acumulado
    let d = null, err = null;
    const captura = { status: (c) => ({ json: (o) => {
      if (c === 200 && o && o.ok) d = o; else err = o; return o;
    } }) };
    await armar({ _body: { token: body.token, estado: 'flujo', anio, desde: mes, hasta: mes } },
                captura);
    if (!d) {
      return res.status(400).json({ error: (err && err.error) || 'No se pudo armar el flujo.',
                                    pista: err && err.pista });
    }

    const busca = (n) => (d.filas || []).filter(f => sinAcentos(f.concepto) === sinAcentos(n))[0];
    const entradas = busca('Entradas de efectivo');
    const salidas = busca('Salidas de efectivo');
    const cambio = busca('Cambio en efectivo y bancos');
    const saldo = (d.filas || []).filter(f => f.tipo === 'acumulado')[0];
    const saldoFin = saldo ? saldo.total : null;
    const saldoIni = (saldoFin !== null && cambio) ? saldoFin - cambio.total : null;

    // Los renglones de cada lado, que es lo que se viene a ver
    const hijosDe = (padre) => (d.filas || [])
      .filter(f => f.tipo === 'dato' && f.total &&
                   (f.signo > 0) === (padre === 'entradas'))
      .sort((a, b) => b.total - a.total)
      .map(f => ({ nombre: f.concepto, valor: f.total }));

    const ing = hijosDe('entradas');
    const egr = hijosDe('salidas');
    if (entradas) ing.push({ nombre: 'Total ingresos', valor: entradas.total, total: true });
    if (salidas) egr.push({ nombre: 'Total egresos', valor: salidas.total, total: true });

    const secciones = [];
    if (saldoIni !== null) {
      secciones.push({ titulo: 'Saldos', filas: [
        { nombre: 'Saldo al inicio del periodo', valor: saldoIni },
        { nombre: 'Entradas', valor: entradas ? entradas.total : 0 },
        { nombre: 'Salidas', valor: salidas ? salidas.total : 0 },
        { nombre: 'Cambio en efectivo y bancos', valor: cambio ? cambio.total : 0 },
        { nombre: 'Saldo al final del periodo', valor: saldoFin, total: true }
      ] });
    }
    if (ing.length) secciones.push({ titulo: 'Ingresos', nota: 'por categoría', filas: ing });
    if (egr.length) secciones.push({ titulo: 'Egresos', nota: 'por categoría', filas: egr });

    const notas = [];
    (d.avisos || []).forEach(a => notas.push(typeof a === 'string' ? a : (a.texto || '')));
    notas.push('Los traspasos entre cuentas propias aparecen de los dos lados: mueven dinero ' +
      'de un bolsillo a otro y no cambian el saldo.');

    const buf = await reporteSecciones({
      titulo: 'Reporte Ingresos - Egresos',
      subtitulo: cap(MESES[mes - 1]) + ' de ' + anio,
      cifras: [
        { k: 'Entradas', v: dinero(entradas ? entradas.total : 0) },
        { k: 'Salidas', v: dinero(salidas ? salidas.total : 0) },
        { k: 'Cambio', v: dinero(cambio ? cambio.total : 0) },
        { k: 'Saldo al cierre', v: saldoFin === null ? '—' : dinero(saldoFin) }
      ],
      secciones, notas
    }, { empresa: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
         pie: 'Sale del mismo cálculo que el flujo de efectivo.' });

    return res.status(200).json({ ok: true, pdf: buf.toString('base64'),
      nombre: 'Ingresos - Egresos ' + cap(MESES[mes - 1]) + ' ' + anio + '.pdf' });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
