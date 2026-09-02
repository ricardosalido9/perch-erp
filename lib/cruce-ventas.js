// Cruza el estado de resultados contra lo que el ERP ya sabe de VENTAS.
//
// Para qué: el estado se captura a mano desde una hoja con fórmulas. Si una
// fórmula toma un rango de más, se come una cancelada o se salta un mes, el
// número queda mal y no hay nada que lo delate: un total es un total. Esto lo
// delata, porque VENTAS sí trae folio por folio y sabe cuál está cancelado.
//
//   ?action=cruce-ventas  { anio: 2026 }
const core = require('../core');
const armarEstado = require('./estados');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...ns) {
  for (const n of ns) { const c = H.filter(x => norm(x) === norm(n))[0]; if (c) return c; }
  return null;
}
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8,
                sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3,
                abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9,
                octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth()+1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.replace(/,/g,' ').replace(/\s+/g,' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return +m[3]*10000 + MESES[m[2]]*100 + +m[1];
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], sinArchivo: true };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 }; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();

    const [ven, er] = await Promise.all([leer('ventas_registro'), leer('fin_estados')]);
    if (!ven.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer VENTAS.' });
    }
    const H = ven.headers;
    const cFec = col(H, 'Fecha del Cierre', 'Fecha');
    const cTot = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos',
                     'Total', 'Total Pedido');
    const cSta = col(H, 'Status');
    const cRef = col(H, 'No. de Referencia', 'Folio');
    if (!cFec || !cTot) {
      return res.status(400).json({
        error: 'VENTAS no tiene las columnas que se esperan.',
        pista: 'Faltan: ' + [[cFec,'Fecha'],[cTot,'Total']].filter(x=>!x[0]).map(x=>x[1]).join(', ') + '.'
      });
    }

    // Lo que dice VENTAS, separando lo cancelado de lo vivo
    const vivo = new Array(13).fill(0), cancelado = new Array(13).fill(0);
    const nVivo = new Array(13).fill(0), nCanc = new Array(13).fill(0);
    const foliosCancelados = [];
    let sinFecha = 0;
    ven.rows.forEach(r => {
      const d = fechaNum(r[cFec]);
      if (d === null) { sinFecha++; return; }
      if (Math.floor(d / 10000) !== anio) return;
      const m = Math.floor(d / 100) % 100;
      if (m < 1 || m > 12) return;
      const t = num(r[cTot]);
      const esCanc = cSta && /cancelad|anulad/i.test(txt(r[cSta]));
      if (esCanc) {
        cancelado[m] += t; nCanc[m]++;
        if (t) foliosCancelados.push({ folio: cRef ? txt(r[cRef]) : '', mes: m, monto: Math.round(t*100)/100 });
      } else { vivo[m] += t; nVivo[m]++; }
    });

    // Lo que dice el estado de resultados.
    //
    // Va contra VENTAS NETAS, no brutas. VENTAS trae el pedido como se vendió, ya
    // con su descuento aplicado; las brutas son antes de descontar, así que
    // compararlas contra VENTAS daba una diferencia igual al descuento del mes y
    // parecía un error de captura cuando no lo era.
    //
    // Y el número no se vuelve a sumar aquí: se le pide al mismo handler que arma
    // la pantalla del estado, para que el cuadre y el estado no puedan discrepar.
    const capturado = new Array(13).fill(0);
    let hayER = false, deDonde = 'Ventas Netas';
    try {
      let est = null;
      const captura = { status: () => ({ json: (o) => { if (o && o.ok) est = o; return o; } }) };
      await armarEstado({ _body: { token: body.token, estado: 'resultados', anio: anio,
                                   desde: 1, hasta: 12 } }, captura);
      const fila = est && (est.filas || []).filter(f => norm(f.concepto) === 'ventas netas')[0];
      if (fila) {
        hayER = true;
        fila.meses.forEach((v, i) => { capturado[i + 1] = v || 0; });
      }
    } catch (e) { hayER = false; }
    // Si el estado no se pudo armar, se suma a mano y se avisa de qué se sumó
    if (!hayER && er.headers.length) {
      const dA = col(er.headers, 'Año','Anio','Ano'), dM = col(er.headers, 'Mes');
      const dC = col(er.headers, 'Concepto'), dV = col(er.headers, 'Monto','Importe','Total');
      if (dA && dM && dC && dV) {
        hayER = true;
        deDonde = 'Ventas brutas menos descuentos, sumado a mano';
        const SUMAN = { 'ingresos por venta de productos': 1,
                        'ingresos por prestacion de servicios': 1,
                        'descuentos y/o devoluciones': -1 };
        er.rows.forEach(r => {
          if (num(r[dA]) !== anio) return;
          const m = num(r[dM]);
          if (m < 1 || m > 12) return;
          const sg = SUMAN[norm(r[dC])];
          if (sg) capturado[m] += sg * num(r[dV]);
        });
      }
    }

    const meses = [];
    for (let m = 1; m <= 12; m++) {
      if (!vivo[m] && !cancelado[m] && !capturado[m]) continue;
      const dif = capturado[m] - vivo[m];
      meses.push({
        mes: m,
        ventas: Math.round(vivo[m]*100)/100,
        canceladas: Math.round(cancelado[m]*100)/100,
        nCanceladas: nCanc[m],
        estado: Math.round(capturado[m]*100)/100,
        diferencia: Math.round(dif*100)/100,
        // La pista más útil: si la diferencia es justo lo cancelado, la fórmula
        // del Excel no está descontando las canceladas.
        porQue: !hayER ? ''
          : (Math.abs(dif) < 1 ? 'Cuadra'
            : (Math.abs(dif - cancelado[m]) < 1
               ? 'La diferencia es exactamente lo cancelado del mes: la fórmula no las descuenta.'
               : (Math.abs(dif + cancelado[m]) < 1
                  ? 'La diferencia es lo cancelado con signo al revés.'
                  : (!capturado[m] ? 'El estado no tiene nada capturado en este mes.'
                     : (!vivo[m] ? 'VENTAS no tiene nada en este mes.' : 'Diferencia sin explicación obvia.')))))
      });
    }
    const suma = (a) => a.reduce((s,x)=>s+x,0);
    return res.status(200).json({
      ok: true, anio,
      hayEstado: hayER,
      deDonde: deDonde,
      meses,
      totales: {
        ventas: Math.round(suma(vivo)*100)/100,
        canceladas: Math.round(suma(cancelado)*100)/100,
        estado: Math.round(suma(capturado)*100)/100,
        diferencia: Math.round((suma(capturado) - suma(vivo))*100)/100
      },
      canceladas: foliosCancelados.sort((a,b)=>b.monto-a.monto).slice(0, 25),
      sinFecha,
      nota: 'VENTAS se compara contra las Ventas Netas del estado, o sea productos más ' +
            'servicios menos descuentos, que es como VENTAS guarda el pedido. Si tu hoja de ' +
            'VENTAS lleva el total con envío y el estado no, la diferencia va a ser el envío ' +
            'y no un error.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
