// Cuadra el flujo contra INGRESOS y EGRESOS.
//
// La pregunta primero es la grande: si el flujo dice que entró un millón, ¿los
// INGRESOS del mismo periodo suman ese millón? Si sí, se acabó. Si no, entonces
// sí importa por concepto, y solo para explicar la diferencia.
//
// Antes esto salía al revés —una lista larga de conceptos que nadie iba a leer—
// y había que sumar de cabeza para saber si el problema era grande o chico.
//
//   ?action=cruce-flujo  { anio, desde, hasta }
const core = require('../core');

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
const MES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9,
              oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
              junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear()*10000 + (v.getMonth()+1)*100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.replace(/,/g,' ').replace(/\s+/g,' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MES[m[2]]) return +m[3]*10000 + MES[m[2]]*100 + +m[1];
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows };
}
const red = (x) => Math.round(x * 100) / 100;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();
    const desde = Math.min(12, Math.max(1, +body.desde || 1));
    const hasta = Math.min(12, Math.max(desde, +body.hasta || 12));

    const [ing, egr, flu, con] = await Promise.all([
      leer('fin_ingresos'), leer('fin_egresos'), leer('fin_flujo'), leer('fin_ef_conceptos')
    ]);
    if (!ing.headers.length && !egr.headers.length) {
      return res.status(400).json({
        error: 'No se pudieron leer INGRESOS ni EGRESOS.',
        pista: 'Revisa con ?action=conexiones&probar=1 que las dos pestañas se abran.'
      });
    }

    // De qué lado del flujo está cada concepto. Sale del Signo de la estructura:
    // +1 suma al estado (entrada), -1 resta (salida). Así no hay que listar
    // conceptos a mano y sigue funcionando si mañana agregan uno nuevo.
    const lado = {};
    if (con.headers.length) {
      const cC = col(con.headers, 'Concepto'), cS = col(con.headers, 'Signo');
      const cT = col(con.headers, 'Tipo');
      con.rows.forEach(r => {
        const t = norm(cT ? r[cT] : 'dato');
        if (t && t !== 'dato') return;
        const k = txt(r[cC]);
        if (k) lado[norm(k)] = num(cS ? r[cS] : 1) < 0 ? 'salida' : 'entrada';
      });
    }

    // ---- lo que dice el flujo ----
    let flujoEntradas = 0, flujoSalidas = 0;
    const porConceptoFlujo = {};
    const sinLado = {};
    if (flu.headers.length) {
      const H = flu.headers;
      const cA = col(H, 'Año','Anio','Ano'), cM = col(H, 'Mes');
      const cC = col(H, 'Concepto'), cV = col(H, 'Monto','Importe','Total');
      if (cA && cM && cC && cV) {
        flu.rows.forEach(r => {
          if (num(r[cA]) !== anio) return;
          const m = num(r[cM]);
          if (m < desde || m > hasta) return;    // el mes 0 es el saldo inicial
          const k = txt(r[cC]);
          if (!k) return;
          const v = Math.abs(num(r[cV]));
          const l = lado[norm(k)];
          if (l === 'salida') flujoSalidas += v;
          else if (l === 'entrada') flujoEntradas += v;
          else sinLado[k] = (sinLado[k] || 0) + v;
          porConceptoFlujo[k] = (porConceptoFlujo[k] || 0) + v;
        });
      }
    }

    // ---- lo que dicen INGRESOS y EGRESOS ----
    const porConceptoBanco = { entrada: {}, salida: {} };
    let sinFecha = 0, nIng = 0, nEgr = 0;
    const juntar = (hoja, l) => {
      if (!hoja.headers.length) return 0;
      const H = hoja.headers;
      const cF = col(H, 'Fecha'), cT = col(H, 'Total', 'Monto', 'Importe');
      const cC = col(H, 'Concepto'), cCat = col(H, 'Categoría', 'Categoria');
      if (!cF || !cT) return 0;
      let suma = 0;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[cF]);
        if (d === null) { sinFecha++; return; }
        if (Math.floor(d / 10000) !== anio) return;
        const m = Math.floor(d / 100) % 100;
        if (m < desde || m > hasta) return;
        const t = Math.abs(num(r[cT]));
        if (!t) return;
        suma += t;
        if (l === 'entrada') nIng++; else nEgr++;
        const k = txt(cC ? r[cC] : '') || txt(cCat ? r[cCat] : '') || 'Sin concepto';
        porConceptoBanco[l][k] = (porConceptoBanco[l][k] || 0) + t;
      });
      return suma;
    };
    const bancoIngresos = juntar(ing, 'entrada');
    const bancoEgresos = juntar(egr, 'salida');

    // ---- la pregunta grande ----
    const cuadra = (a, b) => Math.abs(a - b) < 1;
    const lados = [
      { lado: 'Entradas', hoja: 'INGRESOS', flujo: red(flujoEntradas), banco: red(bancoIngresos),
        diferencia: red(flujoEntradas - bancoIngresos), movimientos: nIng,
        cuadra: cuadra(flujoEntradas, bancoIngresos) },
      { lado: 'Salidas', hoja: 'EGRESOS', flujo: red(flujoSalidas), banco: red(bancoEgresos),
        diferencia: red(flujoSalidas - bancoEgresos), movimientos: nEgr,
        cuadra: cuadra(flujoSalidas, bancoEgresos) }
    ];
    lados.forEach(x => {
      x.porcentaje = x.banco ? red(Math.abs(x.diferencia) / x.banco * 100) : null;
      x.resumen = x.cuadra
        ? 'Cuadra: el flujo y ' + x.hoja + ' dicen lo mismo en este periodo.'
        : 'El flujo dice ' + (x.diferencia > 0 ? 'más' : 'menos') + ' que ' + x.hoja +
          ' por ' + Math.abs(x.diferencia).toLocaleString('en-US',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
          (x.porcentaje !== null ? ', el ' + x.porcentaje.toFixed(1) + '% de la hoja.' : '.');
    });

    // ---- solo si no cuadra: qué conceptos revisar ----
    // Ordenados por cuánto explican de la diferencia, no alfabéticamente. Los
    // primeros suelen explicarla casi toda, y con eso basta para saber a dónde ir.
    const revisar = { Entradas: [], Salidas: [] };
    lados.forEach(x => {
      if (x.cuadra) return;
      const l = x.lado === 'Entradas' ? 'entrada' : 'salida';
      const banco = porConceptoBanco[l];
      const idxFlujo = {};
      Object.keys(porConceptoFlujo).forEach(k => {
        if ((lado[norm(k)] || 'entrada') === l) idxFlujo[norm(k)] = k;
      });
      const vistos = {}, lista = [];
      Object.keys(banco).forEach(k => {
        vistos[norm(k)] = 1;
        const kf = idxFlujo[norm(k)];
        const enFlujo = kf ? porConceptoFlujo[kf] : 0;
        const dif = enFlujo - banco[k];
        if (Math.abs(dif) < 1) return;
        lista.push({
          concepto: k, banco: red(banco[k]), flujo: red(enFlujo), diferencia: red(dif),
          porQue: !kf
            ? 'Está en ' + x.hoja + ' y no hay un concepto con ese nombre en el flujo.'
            : (enFlujo > banco[k] ? 'El flujo trae más que ' + x.hoja + '.'
                                  : 'El flujo trae menos que ' + x.hoja + '.')
        });
      });
      Object.keys(idxFlujo).forEach(nk => {
        if (vistos[nk]) return;
        const k = idxFlujo[nk];
        if (Math.abs(porConceptoFlujo[k]) < 1) return;
        lista.push({
          concepto: k, banco: 0, flujo: red(porConceptoFlujo[k]),
          diferencia: red(porConceptoFlujo[k]),
          porQue: 'Está en el flujo y no aparece con ese nombre en ' + x.hoja + '.'
        });
      });
      lista.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
      let acum = 0;
      lista.forEach(y => {
        acum += y.diferencia;
        y.acumulado = red(acum);
        y.explicado = x.diferencia ? red(acum / x.diferencia * 100) : null;
      });
      revisar[x.lado] = lista.slice(0, 40);
    });

    return res.status(200).json({
      ok: true, anio, desde, hasta,
      lados,
      todoCuadra: lados.every(x => x.cuadra),
      revisar,
      sinLado: Object.keys(sinLado).map(k => ({ concepto: k, monto: red(sinLado[k]) })),
      sinEstructura: !con.headers.length,
      sinFecha,
      nota: 'Los montos se comparan en valor absoluto: el flujo guarda todo en positivo y ' +
            'el signo lo pone la estructura. Un concepto del flujo puede juntar varios de la ' +
            'hoja —"Impuestos y otras obligaciones" junta SAT, IMSS e Infonavit— y en ese caso ' +
            'la diferencia sale repartida entre los dos nombres sin que haya un error.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
