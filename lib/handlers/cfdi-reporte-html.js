// Los CFDIs del mes como tablero.
//
// El PDF es el documento que se le manda al contador. Esto es para decidir: si el
// IVA del mes va a salir a cargo o a favor, de qué depende ese número, y qué
// falta capturar antes de declarar.
//
//   ?action=cfdi-reporte-html&mes=8&anio=2026
const reporte = require('./cfdi-reporte');
const CFG = require('../config');
const T = require('../tablero');

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await reporte({ _body: { token: q.token, mes: +q.mes || undefined,
                           anio: +q.anio || undefined, soloDatos: true } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d || !d.datos) {
    return res.status(200).send(T.tableroError('No se pudo armar el reporte de CFDIs',
      (err && err.error) || '', (err && err.pista) || ''));
  }
  const x = d.datos;
  const emi = x.emitidos, rec = x.recibidos, nom = x.nomina;

  // ---- las cifras ----
  const kpis = [];
  if (x.iva) {
    const dif = x.iva.diferencia;
    kpis.push({ k: 'IVA trasladado', v: T.dinero(x.iva.trasladado), f: 'de lo que facturamos' });
    kpis.push({ k: 'IVA acreditable', v: T.dinero(x.iva.acreditable), f: 'de lo que nos facturaron' });
    kpis.push({ k: dif >= 0 ? 'IVA a cargo' : 'IVA a favor', v: T.dinero(Math.abs(dif)),
      hi: dif < 0, mal: dif > 0,
      f: dif >= 0 ? 'se paga este mes' : 'queda a favor' });
  }
  kpis.push({ k: 'Comprobantes', v: T.numero((emi ? emi.n : 0) + (rec ? rec.n : 0)),
    f: (emi ? T.numero(emi.n) : '0') + ' emitidos · ' + (rec ? T.numero(rec.n) : '0') + ' recibidos' });

  const bloques = [];

  // Lo que falta antes de declarar. Va primero: es lo accionable.
  if ((x.advertencias || []).length) {
    bloques.push({ tipo: 'avisos', titulo: 'Antes de declarar', grave: true,
      puntos: x.advertencias.map(a => typeof a === 'string' ? a : (a.texto || a.mensaje || '')) });
  }

  // De qué se compone el IVA a pagar
  if (x.iva && (x.iva.trasladado || x.iva.acreditable)) {
    bloques.push({ tipo: 'split', titulo: 'De qué se compone el IVA del mes',
      nota: (x.iva.diferencia >= 0 ? 'a cargo ' : 'a favor ') + T.dinero(Math.abs(x.iva.diferencia)),
      tramos: [
        { n: 'Acreditable (lo que nos facturaron)', v: x.iva.acreditable, color: '#8a7f6a' },
        { n: x.iva.diferencia >= 0 ? 'A cargo' : 'A favor',
          v: Math.abs(x.iva.diferencia), color: '#2f4f3e', texto: '#fff' }
      ] });
  }

  const comoFilas = (lista, campo) => (lista || []).map(b => ({
    nombre: b.etiqueta, valor: b[campo || 'total'] || 0,
    detalle: T.numero(b.n || 0) + (b.n === 1 ? ' comprobante' : ' comprobantes'),
    extra: b.iva != null ? 'IVA ' + T.dinero(b.iva) : ''
  }));

  [['Emitidos', emi], ['Recibidos', rec], ['Nómina', nom]].forEach(([nombre, b]) => {
    if (!b) return;
    const sub = [];
    if ((b.porTipo || []).length) {
      const conDatos = b.porTipo.filter(t => t.n);
      if (conDatos.length > 1) {
        sub.push({ tipo: 'seccion', titulo: nombre + ' · por tipo',
          nota: T.numero(b.n) + ' comprobantes', filas: comoFilas(conDatos) });
      }
    }
    if ((b.porMetodo || []).length > 1) {
      sub.push({ tipo: 'seccion', titulo: nombre + ' · cómo se pagan',
        nota: 'PUE se paga de una, PPD necesita complemento', filas: comoFilas(b.porMetodo) });
    }
    if (!sub.length && b.totales) {
      sub.push({ tipo: 'seccion', titulo: nombre, nota: T.numero(b.n) + ' comprobantes',
        filas: [
          { nombre: 'Subtotal', valor: b.totales.subtotal },
          { nombre: 'IVA', valor: b.totales.iva },
          { nombre: 'Total', valor: b.totales.total }
        ] });
    }
    sub.forEach(s2 => bloques.push(s2));
  });

  return res.status(200).send(T.tablero({
    eyebrow: (x.empresa || '') + (x.rfc ? ' · ' + x.rfc : ''),
    titulo: 'CFDIs de ' + String(x.mes).toLowerCase(),
    subtitulo: x.mes + ' de ' + x.anio + ' · lo que el SAT tiene registrado',
    kpis, bloques,
    pie: 'Sale de la descarga del SAT. Las canceladas no cuentan.'
  }));
};
