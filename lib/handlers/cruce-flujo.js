// Cuadra el flujo contra INGRESOS y EGRESOS.
//
// Emparejar por nombre no alcanza, por dos razones que aparecieron usándolo:
//
//   1. "Traspaso entre cuentas" existe en INGRESOS y en EGRESOS con el mismo
//      nombre, y en el flujo son dos renglones distintos. Buscar por nombre
//      encuentra uno y pierde el otro.
//   2. En las hojas se captura por SUBCATEGORÍA, no por concepto. Comparar el
//      concepto del flujo contra el concepto de la hoja es comparar dos niveles
//      distintos del mismo árbol.
//
// Se resuelven igual: con una columna "Sale de" en la estructura del estado, que
// dice de qué subcategorías de la hoja se alimenta cada renglón. Como esa columna
// vive en el renglón del flujo, y ese renglón ya sabe si es entrada o salida, el
// mismo nombre puede aparecer de los dos lados sin confundirse.
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
const armarEstado = require('./estados');
// El Signo se puede escribir de dos formas: como número (1 / -1) o con la palabra
// que ya usas al capturar (INGRESO / EGRESO, ENTRADA / SALIDA). Se aceptan las dos
// porque "-1" no dice nada al leerlo y la palabra sí, y porque así la columna del
// estado y la nota de la captura se escriben igual.
function signoDe(v, porDefecto) {
  const s = norm(v);
  if (!s) return porDefecto === undefined ? 1 : porDefecto;
  if (/^(egreso|egresos|salida|salidas|resta|negativo|-)$/.test(s)) return -1;
  if (/^(ingreso|ingresos|entrada|entradas|suma|positivo|\+)$/.test(s)) return 1;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) || n === 0 ? (porDefecto === undefined ? 1 : porDefecto) : (n < 0 ? -1 : 1);
}


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
    // alias[lado][nombre de la hoja] = concepto del flujo
    const alias = { entrada: {}, salida: {} };
    let conAlias = 0;
    if (con.headers.length) {
      const cC = col(con.headers, 'Concepto'), cS = col(con.headers, 'Signo');
      const cT = col(con.headers, 'Tipo');
      const cSale = col(con.headers, 'Sale de', 'Sale De', 'Subcategorías', 'Subcategorias',
                        'De dónde sale', 'De donde sale');
      con.rows.forEach(r => {
        const t = norm(cT ? r[cT] : 'dato');
        if (t && t !== 'dato') return;
        const k = txt(r[cC]);
        if (!k) return;
        const l = signoDe(cS ? r[cS] : '', 1) < 0 ? 'salida' : 'entrada';
        lado[norm(k)] = l;
        // El propio nombre siempre vale como alias
        alias[l][norm(k)] = k;
        // Y los que se listen en "Sale de", separados por punto y coma o por
        // punto medio. No se usa la coma porque hay conceptos que la llevan
        // dentro, como "Gasto Financiero, neto".
        txt(cSale ? r[cSale] : '').split(/[;·|]/).forEach(x => {
          const a = txt(x);
          if (a) { alias[l][norm(a)] = k; conAlias++; }
        });
      });
    }

    // ---- lo que dice el flujo ----
    // El total NO se vuelve a sumar aquí: se le pide al mismo handler que arma la
    // pantalla del flujo. Si se sumara por separado, este cuadre y el estado
    // podrían decir cosas distintas del mismo dato, que es exactamente el error
    // que ya costó tiempo con INGRESOS y EGRESOS. Una sola fuente por número.
    let delEstado = null;
    try {
      const captura = { status: () => ({ json: (o) => { if (o && o.ok) delEstado = o; return o; } }) };
      await armarEstado({ _body: { token: body.token, estado: 'flujo', anio, desde, hasta } }, captura);
    } catch (e) { delEstado = null; }
    const filaEstado = (n) => (delEstado && delEstado.filas || [])
      .filter(f => norm(f.concepto) === norm(n))[0];

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
    const agrupadoPor = {}, negativos = {};
    let sinFecha = 0, nIng = 0, nEgr = 0;
    const juntar = (hoja, l) => {
      if (!hoja.headers.length) return 0;
      const H = hoja.headers;
      const cF = col(H, 'Fecha'), cT = col(H, 'Total', 'Monto', 'Importe');
      const cCon = col(H, 'Concepto');
      const cCat = col(H, 'Categoría', 'Categoria');
      const cSub = col(H, 'Subcategoría', 'Subcategoria', 'Sub categoría', 'Sub Categoria');
      if (!cF || !cT) return 0;
      // Por qué columna se agrupa. Por defecto la subcategoría si existe, porque
      // es el nivel al que de verdad se captura; se puede forzar desde la pantalla.
      const pedido = norm(body.agrupar || 'auto');
      const cGrupo = pedido === 'concepto' ? cCon
                   : pedido === 'categoria' ? cCat
                   : pedido === 'subcategoria' ? cSub
                   : (cSub || cCon || cCat);
      agrupadoPor[l] = cGrupo || '(sin columna)';
      const neg = negativos[l] = { n: 0, monto: 0, ejemplos: [], volteado: false };
      let suma = 0;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[cF]);
        if (d === null) { sinFecha++; return; }
        if (Math.floor(d / 10000) !== anio) return;
        const m = Math.floor(d / 100) % 100;
        if (m < desde || m > hasta) return;
        // Con signo, no en valor absoluto. Un renglón negativo en INGRESOS es una
        // devolución o una corrección: la hoja lo resta y aquí también tiene que
        // restar. Tomarlo en positivo hacía que la diferencia fuera el doble de
        // esos negativos y aparecía un descuadre que no existía.
        const t = num(r[cT]);
        if (!t) return;
        if (t < 0) {
          neg.n++; neg.monto += t;
          if (neg.ejemplos.length < 5) {
            neg.ejemplos.push({
              fecha: txt(r[cF]),
              concepto: txt(cGrupo ? r[cGrupo] : '') || txt(cCon ? r[cCon] : ''),
              monto: red(t)
            });
          }
        }
        suma += t;
        if (l === 'entrada') nIng++; else nEgr++;
        const k = txt(cGrupo ? r[cGrupo] : '') || txt(cCon ? r[cCon] : '') ||
                  txt(cCat ? r[cCat] : '') || 'Sin clasificar';
        porConceptoBanco[l][k] = (porConceptoBanco[l][k] || 0) + t;
      });
      // Hay hojas que guardan los egresos en negativo y otras en positivo. Si el
      // total salió negativo, se voltea todo el lado para poder compararlo en
      // magnitud contra el flujo, que siempre guarda en positivo.
      if (suma < 0) {
        suma = -suma;
        Object.keys(porConceptoBanco[l]).forEach(k => {
          porConceptoBanco[l][k] = -porConceptoBanco[l][k];
        });
        neg.volteado = true;
      }
      return suma;
    };
    const bancoIngresos = juntar(ing, 'entrada');
    const bancoEgresos = juntar(egr, 'salida');

    // Si el estado se pudo armar, sus totales mandan. Lo sumado renglón por
    // renglón sirve para detectar si algo se quedó fuera de la estructura.
    const fEnt = filaEstado('Entradas de efectivo'), fSal = filaEstado('Salidas de efectivo');
    const sueltoEnt = fEnt ? red(fEnt.total - flujoEntradas) : 0;
    const sueltoSal = fSal ? red(Math.abs(fSal.total) - flujoSalidas) : 0;
    if (fEnt) flujoEntradas = Math.abs(fEnt.total);
    if (fSal) flujoSalidas = Math.abs(fSal.total);

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
    const porMapear = { Entradas: [], Salidas: [] };
    lados.forEach(x => {
      if (x.cuadra) return;
      const l = x.lado === 'Entradas' ? 'entrada' : 'salida';
      const banco = porConceptoBanco[l];
      // Se suma la hoja hacia el renglón del flujo al que pertenece cada
      // subcategoría. Varias subcategorías pueden caer en el mismo renglón: por
      // eso se acumula en vez de asignar.
      const haciaFlujo = {}, quienAporta = {};
      const sueltos = [];
      Object.keys(banco).forEach(k => {
        const destino = alias[l][norm(k)];
        if (destino) {
          haciaFlujo[destino] = (haciaFlujo[destino] || 0) + banco[k];
          (quienAporta[destino] = quienAporta[destino] || []).push(k);
        } else {
          sueltos.push(k);
        }
      });
      // Dos cosas distintas que antes salían revueltas:
      //   mapear      — nadie las reclama de un lado ni del otro. No son una
      //                 diferencia, es que falta decir a dónde van. Y si se
      //                 mezclan con las diferencias reales, el acumulado se
      //                 dispara: el renglón del flujo y su subcategoría huérfana
      //                 se cancelan entre sí y el porcentaje pierde sentido.
      //   diferencias — sí están emparejadas y aun así no coinciden. Estas son
      //                 las que hay que revisar de verdad.
      const lista = [], mapear = [];
      Object.keys(porConceptoFlujo).forEach(k => {
        if ((lado[norm(k)] || 'entrada') !== l) return;
        const deHoja = haciaFlujo[k] || 0;
        if (!deHoja) {
          if (Math.abs(porConceptoFlujo[k]) < 1) return;
          mapear.push({
            donde: 'flujo', concepto: k, monto: red(porConceptoFlujo[k]),
            porQue: 'Ninguna subcategoría de ' + x.hoja + ' apunta a este renglón.'
          });
          return;
        }
        const dif = porConceptoFlujo[k] - deHoja;
        if (Math.abs(dif) < 1) return;
        lista.push({
          concepto: k, banco: red(deHoja), flujo: red(porConceptoFlujo[k]), diferencia: red(dif),
          sale: (quienAporta[k] || []).join(' · '),
          porQue: porConceptoFlujo[k] > deHoja ? 'El flujo trae más que ' + x.hoja + '.'
                                               : 'El flujo trae menos que ' + x.hoja + '.'
        });
      });
      sueltos.forEach(k => {
        if (Math.abs(banco[k]) < 1) return;
        mapear.push({
          donde: 'hoja', concepto: k, monto: red(banco[k]),
          porQue: 'Está en ' + x.hoja + ' y ningún renglón del flujo la reclama.'
        });
      });
      mapear.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));
      porMapear[x.lado] = mapear.slice(0, 50);
      lista.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
      let acum = 0;
      lista.forEach(y => {
        acum += y.diferencia;
        y.acumulado = red(acum);
        y.explicado = x.diferencia ? red(acum / x.diferencia * 100) : null;
      });
      revisar[x.lado] = lista.slice(0, 50);
    });

    return res.status(200).json({
      ok: true, anio, desde, hasta,
      lados,
      todoCuadra: lados.every(x => x.cuadra),
      revisar,
      porMapear,
      sinLado: Object.keys(sinLado).map(k => ({ concepto: k, monto: red(sinLado[k]) })),
      agrupadoPor: agrupadoPor,
      hayMapeo: conAlias > 0,
      negativos: Object.keys(negativos).map(l => ({
        lado: l === 'entrada' ? 'Entradas' : 'Salidas',
        hoja: l === 'entrada' ? 'INGRESOS' : 'EGRESOS',
        n: negativos[l].n, monto: red(negativos[l].monto),
        volteado: negativos[l].volteado,
        ejemplos: negativos[l].ejemplos
      })).filter(x => x.n),
      sinEstructura: !con.headers.length,
      // Diferencia entre el total del estado y lo que se pudo repartir por
      // concepto. Si no es cero, hay renglones capturados que la estructura no
      // recoge y el detalle de abajo no va a cuadrar aunque el total sí.
      noRepartido: [
        { lado: 'Entradas', monto: sueltoEnt },
        { lado: 'Salidas', monto: sueltoSal }
      ].filter(x => Math.abs(x.monto) > 1),
      totalDelEstado: !!delEstado,
      sinFecha,
      nota: 'Los montos se comparan en valor absoluto: el flujo guarda todo en positivo y el ' +
            'signo lo pone la estructura. Cada renglón del flujo junta las subcategorías que ' +
            'estén listadas en su columna "Sale de", separadas por punto y coma. Mientras esa ' +
            'columna esté vacía, solo empareja lo que se llame exactamente igual.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
