// Arma un estado financiero a partir de sus dos pestañas: los datos (un renglón
// por año, mes y concepto) y la estructura (qué renglón se captura, cuál es suma
// de sus hijos y cuál sale de una fórmula).
//
// El handler no sabe nada del estado de resultados ni del flujo: lee la estructura
// y la obedece. Por eso el mismo código sirve para los dos, y para el balance
// cuando exista, sin tocar una línea.
//
//   ?action=estados  { estado: 'resultados' | 'flujo', anio: 2026 }
//
// Los tipos que entiende la columna "Tipo":
//   dato        se captura. Suma lo que haya en la hoja para ese año, mes y concepto.
//   subtotal    suma de los conceptos que lo tienen como Padre.
//   calculado   la columna "Cómo se calcula" trae los nombres separados por − y +.
//   margen      "A ÷ B".
//   acumulado   saldo que corre: el del mes pasado más el concepto que se nombre.
//               El saldo de arranque se captura con Mes = 0.
const core = require('../core');
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
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...nombres) {
  for (const n of nombres) { const c = H.filter(x => norm(x) === norm(n))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], sinArchivo: true, cfg: cfg || null };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message, cfg }; }
  if (!values.length) return { headers: [], rows: [], cfg };
  const H = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows, cfg };
}

const ESTADOS = {
  resultados: { datos: 'fin_estados', conceptos: 'fin_er_conceptos', titulo: 'Estado de resultados' },
  flujo:      { datos: 'fin_flujo',   conceptos: 'fin_ef_conceptos', titulo: 'Flujo de efectivo' },
  balance:    { datos: 'fin_balance', conceptos: 'fin_bg_conceptos', titulo: 'Balance general' }
};

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const cual = ESTADOS[txt(body.estado)] || ESTADOS.resultados;
    const anio = +body.anio || new Date().getFullYear();
    // El rango de meses. Sirve para comparar peras con peras: si el año va a la
    // mitad, el total de doce meses contra el del año pasado completo no dice nada.
    const desde = Math.min(12, Math.max(1, +body.desde || 1));
    const hasta = Math.min(12, Math.max(desde, +body.hasta || 12));

    const [dat, con] = await Promise.all([leer(cual.datos), leer(cual.conceptos)]);
    if (dat.sinArchivo || con.sinArchivo) {
      return res.status(400).json({
        error: cual.titulo + ' no está conectado.',
        pista: 'Falta la variable SHEET_ESTADOS con el id del archivo de estados financieros.'
      });
    }
    if (!con.rows.length) {
      return res.status(400).json({
        error: 'Todavía no existe la estructura del ' + cual.titulo.toLowerCase() + '.',
        pista: 'Hacen falta dos pestañas en el archivo de estados financieros: "' +
               (con.cfg ? con.cfg.sheetName : '') + '" con las columnas Orden, Estado, Concepto, ' +
               'Nivel, Padre, Tipo, Cómo se calcula y Signo; y "' +
               (dat.cfg ? dat.cfg.sheetName : '') + '" con Año, Mes, Estado, Concepto, Monto, ' +
               'Origen y Notas. Con eso el estado se arma solo.'
      });
    }

    // ---- la estructura ----
    const Hc = con.headers;
    const cOrd = col(Hc, 'Orden'), cCon = col(Hc, 'Concepto'), cNiv = col(Hc, 'Nivel');
    const cPad = col(Hc, 'Padre'), cTip = col(Hc, 'Tipo');
    const cFor = col(Hc, 'Cómo se calcula', 'Como se calcula', 'Fórmula', 'Formula');
    const cSig = col(Hc, 'Signo');
    if (!cCon) {
      return res.status(400).json({ error: 'La estructura no tiene columna "Concepto".' });
    }
    // Un nombre repetido en la estructura rompe todo en silencio: los datos se
    // guardan por (año, mes, concepto), así que dos renglones con el mismo nombre
    // comparten celda y el segundo se lleva el valor del primero. Pasó de verdad
    // con "Traspaso entre cuentas", que existe de los dos lados del flujo.
    const avisos = [];
    let repetidos = [];
    (() => {
      const cuenta = {};
      con.rows.forEach(r => {
        const k = norm(r[cCon]);
        if (k) cuenta[k] = (cuenta[k] || 0) + 1;
      });
      repetidos = Object.keys(cuenta).filter(k => cuenta[k] > 1);
    })();
    const conceptos = con.rows.map((r, i) => ({
      orden: cOrd ? num(r[cOrd]) : i,
      concepto: txt(r[cCon]),
      nivel: cNiv ? num(r[cNiv]) : 1,
      padre: cPad ? txt(r[cPad]) : '',
      tipo: norm(cTip ? r[cTip] : 'dato') || 'dato',
      formula: cFor ? txt(r[cFor]) : '',
      signo: signoDe(cSig ? r[cSig] : '', 1)
    })).filter(x => x.concepto).sort((a, b) => a.orden - b.orden);

    // Un mismo nombre puede aparecer dos veces cuando el estado lo tiene de los
    // dos lados —"Traspaso entre cuentas" sale y entra—. Adentro se les da una
    // clave distinta según el lado, para que no compartan celda. Hacia afuera
    // siguen llamándose igual: el nombre es lo que se lee en pantalla.
    const cuantos = {};
    conceptos.forEach(c => { cuantos[norm(c.concepto)] = (cuantos[norm(c.concepto)] || 0) + 1; });
    conceptos.forEach(c => {
      c.repetido = cuantos[norm(c.concepto)] > 1;
      c.lado = c.signo < 0 ? 'salida' : 'entrada';
      c.clave = c.repetido ? c.concepto + ' \u00b7 ' + c.lado : c.concepto;
    });
    const claveDe = {};
    conceptos.forEach(c => { claveDe[norm(c.concepto) + '|' + c.lado] = c.clave; });

    // ---- los datos del año y del anterior ----
    const Hd = dat.headers;
    const dAnio = col(Hd, 'Año', 'Anio', 'Ano'), dMes = col(Hd, 'Mes');
    const dCon = col(Hd, 'Concepto'), dMon = col(Hd, 'Monto', 'Importe', 'Total');
    if (!dAnio || !dMes || !dCon || !dMon) {
      return res.status(400).json({
        error: 'La hoja de datos no tiene las columnas que se esperan.',
        pista: 'Faltan: ' + [[dAnio, 'Año'], [dMes, 'Mes'], [dCon, 'Concepto'], [dMon, 'Monto']]
               .filter(x => !x[0]).map(x => x[1]).join(', ') + '.'
      });
    }
    // capturado[año][concepto][mes] — el mes 0 es el saldo de arranque
    // La columna que dice de qué lado va cada renglón capturado. Solo hace falta
    // para los nombres repetidos; para los demás sobra y se ignora.
    const dLado = col(Hd, 'Lado', 'Ingreso/Egreso', 'Tipo', 'Notas', 'Nota');
    const capturado = {}, huerfanos = {};
    let sumaCapturada = 0, renglones = 0, sinDesempate = 0;
    const vivos = {}; conceptos.forEach(c => { vivos[norm(c.concepto)] = c.clave; });
    dat.rows.forEach(r => {
      const a = num(r[dAnio]);
      if (a !== anio && a !== anio - 1) return;
      const m = num(r[dMes]), v = num(r[dMon]), nc = norm(r[dCon]);
      if (!nc || m < 0 || m > 12) return;
      if (a === anio && m >= desde && m <= hasta) { sumaCapturada += v; renglones++; }
      if (cuantos[nc] > 1) {
        // Nombre repetido: se decide con lo que diga la columna de lado. Si no
        // dice nada reconocible, no se adivina: se cuenta como sin desempatar y
        // el aviso lo señala. Un dato en blanco se nota; uno mal repartido no.
        const marca = norm(dLado ? r[dLado] : '');
        const l = /egres|salid|pagad|resta/.test(marca) ? 'salida'
                : (/ingres|entrad|recibid|suma/.test(marca) ? 'entrada' : null);
        if (!l) { if (a === anio && m >= desde && m <= hasta) sinDesempate++; return; }
        const k2 = claveDe[nc + '|' + l];
        if (!k2) return;
        capturado[a] = capturado[a] || {};
        capturado[a][k2] = capturado[a][k2] || new Array(13).fill(0);
        capturado[a][k2][m] += v;
        return;
      }
      if (!vivos[nc]) {
        if (a === anio && v && m >= desde && m <= hasta) {
          huerfanos[txt(r[dCon])] = (huerfanos[txt(r[dCon])] || 0) + v;
        }
        return;
      }
      const k = vivos[nc];
      capturado[a] = capturado[a] || {};
      capturado[a][k] = capturado[a][k] || new Array(13).fill(0);
      capturado[a][k][m] += v;
    });

    // ---- se resuelve cada renglón ----
    // Se recorre en orden; los subtotales y las fórmulas solo miran hacia arriba,
    // así que basta una pasada mientras la estructura esté ordenada de arriba abajo.
    const hijos = {};
    const porNombre = {};
    conceptos.forEach(c => { porNombre[norm(c.concepto)] = c.clave; });
    conceptos.forEach(c => {
      if (!c.padre) return;
      const pk = porNombre[norm(c.padre)] || c.padre;
      (hijos[pk] = hijos[pk] || []).push(c.clave);
    });

    const armar = (a) => {
      const V = {};
      const cap = capturado[a] || {};
      // Se repite hasta que deje de moverse. El flujo anida tres niveles —Salidas
      // contiene Costo de Ventas que contiene Mano de obra directa— y un subtotal
      // que va antes que sus hijos necesita otra vuelta para verlos ya resueltos.
      // Con dos pasadas fijas el nivel de más se quedaba en cero.
      for (let pasada = 0; pasada < 8; pasada++) {
        const antes = JSON.stringify(V);
        conceptos.forEach(c => {
          const n = c.clave;
          const linea = V[n] || new Array(13).fill(0);
          if (c.tipo === 'dato') {
            for (let m = 0; m <= 12; m++) linea[m] = (cap[n] || [])[m] || 0;
          } else if (c.tipo === 'subtotal') {
            // El Signo de un hijo dice cómo entra al estado, no al subtotal. Si va
            // en el mismo sentido que su padre, suma; si va al revés, resta. Así
            // "Gasto Financiero, neto" resta los intereses ganados sin regla aparte.
            for (let m = 1; m <= 12; m++) {
              linea[m] = (hijos[n] || []).reduce((s, h) => {
                const hc = conceptos.filter(x => x.clave === h)[0];
                const sg = (hc && hc.signo !== c.signo) ? -1 : 1;
                return s + sg * ((V[h] || [])[m] || 0);
              }, 0);
            }
          } else if (c.tipo === 'acumulado') {
            // La fórmula nombra el concepto que se va acumulando. Se busca por
            // nombre para tolerar que venga con una etiqueta delante.
            const de = (conceptos.filter(x => x.clave !== n &&
                        norm(c.formula).indexOf(norm(x.concepto)) !== -1)
                        .sort((a, b) => b.concepto.length - a.concepto.length)[0] || {}).clave;
            const fuente = V[de] || new Array(13).fill(0);
            let saldo = (cap[n] || [])[0] || 0;
            for (let m = 1; m <= 12; m++) { saldo += fuente[m] || 0; linea[m] = saldo; }
          } else if (c.tipo === 'margen') {
            const p = c.formula.split(/÷|\//);
            const arriba = porNombre[norm(txt(p[0]))] || txt(p[0]);
            const abajo = porNombre[norm(txt(p[1]))] || txt(p[1]);
            for (let m = 1; m <= 12; m++) {
              const b = (V[abajo] || [])[m] || 0;
              linea[m] = b ? ((V[arriba] || [])[m] || 0) / b : null;
            }
          } else {   // calculado
            const partes = [];
            c.formula.replace(/\s*([−+-])\s*/g, '\u0000$1\u0000').split('\u0000')
              .reduce((signo, t) => {
                const s = txt(t);
                if (!s) return signo;
                if (s === '−' || s === '-') return -1;
                if (s === '+') return 1;
                partes.push({ nombre: porNombre[norm(s)] || s, signo: signo });
                return 1;
              }, 1);
            for (let m = 1; m <= 12; m++) {
              linea[m] = partes.reduce((s, p) => s + p.signo * ((V[p.nombre] || [])[m] || 0), 0);
            }
          }
          V[n] = linea;
        });
        if (JSON.stringify(V) === antes) break;
      }
      return V;
    };

    const V = armar(anio), Vp = armar(anio - 1);
    // El total solo suma los meses del rango, y el del año anterior suma EL MISMO
    // rango. Comparar enero-julio contra un año completo era la cuenta equivocada.
    const total = (linea) => {
      let s = 0;
      for (let m = desde; m <= hasta; m++) s += (linea || [])[m] || 0;
      return s;
    };

    const filas = conceptos.map(c => {
      const esMargen = c.tipo === 'margen', esSaldo = c.tipo === 'acumulado';
      const meses = V[c.clave].slice(1).map((x, i) =>
        (i + 1 < desde || i + 1 > hasta) ? null : x);
      const t = esMargen
        ? null
        : (esSaldo ? (V[c.clave][hasta] || 0) : total(V[c.clave]));
      const tp = esMargen
        ? null
        : (esSaldo ? (Vp[c.clave][hasta] || 0) : total(Vp[c.clave]));
      const vacio = c.tipo !== 'margen' && !meses.some(x => x) && !t && !tp;
      return {
        concepto: c.concepto, nivel: c.nivel, tipo: c.tipo, signo: c.signo,
        vacio: vacio,
        anteriorMeses: Vp[c.clave].slice(1).map((x, i) =>
          (i + 1 < desde || i + 1 > hasta) ? null : (x === null ? null : Math.round(x * 100) / 100)),
        meses: meses.map(x => (x === null ? null : Math.round(x * 100) / 100)),
        total: t === null ? null : Math.round(t * 100) / 100,
        anterior: tp === null ? null : Math.round(tp * 100) / 100
      };
    });
    // Los márgenes se recalculan sobre los totales, no se promedian
    conceptos.forEach((c, i) => {
      if (c.tipo !== 'margen') return;
      const p = c.formula.split(/÷|\//);
      const arr = porNombre[norm(txt(p[0]))] || txt(p[0]);
      const ab = porNombre[norm(txt(p[1]))] || txt(p[1]);
      const f = (M) => {
        const b = total(M[ab] || []);
        return b ? total(M[arr] || []) / b : null;
      };
      filas[i].total = f(V); filas[i].anterior = f(Vp);
    });

    // ---- Lo que hay que revisar ----
    //
    // Antes esto describía el estado: "las ventas son X", "el margen es Y". Eso ya
    // está en la tabla, y leerlo dos veces no aporta. Aquí solo entra lo que no
    // cuadra: números fuera de rango, renglones que se movieron sin explicación,
    // meses que se salen del patrón. Si el periodo está sano, la lista sale vacía
    // y eso también es información.
    const buscar = (n) => filas.filter(f => norm(f.concepto) === norm(n))[0];
    const lectura = [];
    const nMeses = hasta - desde + 1;
    const MESN = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
    const dinero = (v) => '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
    const cambio = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;

    // 1. Un mes que se sale del patrón de su propio renglón. Es el caso de los
    //    $82,213 de comisiones bancarias en enero contra $4,800 de promedio: no
    //    se ve en el total del año y salta a la vista al compararlo con sus pares.
    filas.filter(f => f.tipo === 'dato').forEach(f => {
      const vs = f.meses.filter(x => x !== null && x !== 0).map(Math.abs);
      if (vs.length < 4) return;
      const orden = vs.slice().sort((a, b) => a - b);
      const mediana = orden[Math.floor(orden.length / 2)];
      if (!mediana) return;
      f.meses.forEach((v, i) => {
        if (v === null || !v) return;
        const r = Math.abs(v) / mediana;
        if (r < 4) return;
        lectura.push(f.concepto + ' de ' + MESN[i] + ' es ' +
          (v < 0 ? 'negativo, ' + dinero(v) + ',' : dinero(v) + ',') + ' ' +
          r.toFixed(0) + ' veces la mediana del resto del año (' + dinero(mediana) + ').');
      });
    });

    // 2. Renglones que traían dinero el año pasado y ahora están en cero, o al
    //    revés. Casi siempre es un concepto que se dejó de capturar o que se
    //    empezó a registrar con otro nombre.
    //
    //    Solo tiene sentido si el año anterior existe. Si no hay nada cargado de
    //    ese año, TODOS los renglones dirían "el año pasado no existía" y la
    //    lista se llenaría de ruido que no dice nada.
    const hayAnterior = filas.some(f => f.tipo === 'dato' && f.anterior);
    if (hayAnterior) filas.filter(f => f.tipo === 'dato').forEach(f => {
      if (f.anterior && Math.abs(f.anterior) > 20000 && !f.total) {
        lectura.push(f.concepto + ' tenía ' + dinero(f.anterior) + ' el año pasado y este ' +
          'año está en cero. O se dejó de gastar, o se está capturando con otro nombre.');
      } else if (f.total && Math.abs(f.total) > 20000 && !f.anterior) {
        lectura.push(f.concepto + ' trae ' + dinero(f.total) + ' y el año pasado no existía.');
      }
    });

    // 3. Renglones que se movieron mucho más que la venta
    const vn = buscar('Ventas Netas') || buscar('Entradas de efectivo');
    const cVenta = (vn && vn.anterior) ? cambio(vn.total, vn.anterior) : null;
    filas.filter(f => f.tipo === 'dato' && f.anterior && Math.abs(f.anterior) > 50000 && f.total)
      .forEach(f => {
        // Un porcentaje entre un número positivo y uno negativo no significa
        // nada: "bajó 187%" no se puede leer. Se dice el cambio de signo, que es
        // lo que de verdad hay que revisar.
        if ((f.total < 0) !== (f.anterior < 0)) {
          lectura.push(f.concepto + ' pasó de ' + dinero(f.anterior) +
            (f.anterior < 0 ? ' negativo' : '') + ' a ' + dinero(f.total) +
            (f.total < 0 ? ' negativo' : '') + ': cambió de signo.');
          return;
        }
        const c = cambio(f.total, f.anterior);
        if (c === null || Math.abs(c) < 60) return;
        if (cVenta !== null && Math.abs(c - cVenta) < 40) return;   // se movió con la venta
        lectura.push(f.concepto + (c >= 0 ? ' subió ' : ' bajó ') + Math.abs(c).toFixed(0) +
          '%, de ' + dinero(f.anterior) + ' a ' + dinero(f.total) +
          (cVenta !== null ? ', mientras la venta ' +
            (cVenta >= 0 ? 'subió ' : 'bajó ') + Math.abs(cVenta).toFixed(0) + '%.' : '.'));
      });

    if (cual === ESTADOS.resultados) {
      const ub = buscar('Utilidad bruta'), uo = buscar('Utilidad operativa');
      const gga = buscar('Gastos Generales y Administrativos'), gv = buscar('Gastos de Venta');

      // 4. La estructura no siguió a la venta
      if (vn && gga && gga.anterior && cVenta !== null && cVenta < -10) {
        const cg = cambio(gga.total, gga.anterior);
        if (cg !== null && cg > cVenta + 20) {
          lectura.push('La venta bajó ' + Math.abs(cVenta).toFixed(0) + '% y los gastos generales ' +
            (cg >= 0 ? 'subieron ' : 'solo bajaron ') + Math.abs(cg).toFixed(0) +
            '%. La estructura no se movió al ritmo de la venta.');
        }
      }

      // 5. Qué tan cerca está del punto de equilibrio
      if (vn && ub && gga && gv && vn.total && ub.total > 0) {
        const fijo = gga.total + gv.total;
        const equilibrio = fijo / (ub.total / vn.total) / nMeses;
        const promedio = vn.total / nMeses;
        const holgura = (promedio - equilibrio) / equilibrio * 100;
        if (holgura < 25) {
          lectura.push('El punto de equilibrio es ' + dinero(equilibrio) + ' de venta neta al mes ' +
            'y el promedio del periodo fue ' + dinero(promedio) + ': ' +
            (holgura < 0 ? 'se está vendiendo por debajo del equilibrio.'
                         : 'solo ' + holgura.toFixed(0) + '% de holgura, un mes flojo cierra en rojo.'));
        }
      }

      // 6. Meses en rojo
      if (uo) {
        const malos = [];
        uo.meses.forEach((v, i) => { if (v !== null && v < 0) malos.push(MESN[i]); });
        if (malos.length) {
          lectura.push((malos.length === 1 ? 'Un mes cerró' : malos.length + ' meses cerraron') +
            ' con utilidad operativa negativa: ' + malos.join(', ') + '.');
        }
      }

      // 7. ISR por encima de la tasa
      const imp = buscar('Impuestos');
      if (imp && imp.total && uo && uo.total > 0) {
        const tasa = imp.total / uo.total * 100;
        if (tasa > 32) {
          lectura.push('El ISR registrado es ' + dinero(imp.total) + ', el ' + tasa.toFixed(0) +
            '% de la utilidad operativa cuando la tasa es 30%. La diferencia son pagos ' +
            'provisionales con el coeficiente del año pasado: es saldo a favor, no gasto.');
        }
      }
    } else if (cual === ESTADOS.flujo) {
      const ca = buscar('Cambio en efectivo y bancos');
      if (ca) {
        const malos = [];
        ca.meses.forEach((v, i) => { if (v !== null && v < 0) malos.push(MESN[i]); });
        if (malos.length) {
          lectura.push((malos.length === 1 ? 'Un mes quemó' : malos.length + ' meses quemaron') +
            ' efectivo: ' + malos.join(', ') + '.');
        }
      }
      // Los dos lados de un traspaso deberían ser iguales
      const tr = filas.filter(f => /traspaso/i.test(f.concepto) && f.total);
      if (tr.length === 2 && Math.abs(tr[0].total - tr[1].total) > 1) {
        lectura.push('Los traspasos no cuadran entre sí: ' + dinero(tr[0].total) + ' de un lado y ' +
          dinero(tr[1].total) + ' del otro, ' + dinero(tr[0].total - tr[1].total) +
          ' de diferencia. Lo que sale de una cuenta debería llegar a otra.');
      }
      const en = buscar('Entradas de efectivo');
      if (tr.length && en && en.total) {
        const monto = Math.min.apply(null, tr.map(x => Math.abs(x.total)));
        if (monto / en.total > 0.05) {
          lectura.push('Los traspasos entre cuentas propias son el ' +
            (monto / en.total * 100).toFixed(0) + '% de las entradas (' + dinero(monto) +
            '). No cambian el efectivo: inflan entradas y salidas por igual.');
        }
      }
    }

    return res.status(200).json({
      ok: true,
      avisos: avisos,
      lectura: lectura,
      estado: txt(body.estado) || 'resultados',
      titulo: cual.titulo,
      anio: anio, desde: desde, hasta: hasta,
      // Sobre qué se calcula el análisis vertical de este estado
      base: conceptos.filter(x => norm(x.concepto) === 'ventas netas').length
            ? 'Ventas Netas'
            : (conceptos.filter(x => norm(x.concepto) === 'entradas de efectivo').length
               ? 'Entradas de efectivo' : (conceptos[0] || {}).concepto),
      filas: filas,
      hoja: dat.cfg ? dat.cfg.sheetName : '',
      estructura: con.cfg ? con.cfg.sheetName : '',
      cuadre: {
        renglones: renglones,
        capturado: Math.round(sumaCapturada * 100) / 100,
        huerfanos: Object.keys(huerfanos).map(k => ({ concepto: k, monto: Math.round(huerfanos[k] * 100) / 100 }))
                   .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto))
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
