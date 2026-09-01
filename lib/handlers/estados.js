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
    const conceptos = con.rows.map((r, i) => ({
      orden: cOrd ? num(r[cOrd]) : i,
      concepto: txt(r[cCon]),
      nivel: cNiv ? num(r[cNiv]) : 1,
      padre: cPad ? txt(r[cPad]) : '',
      tipo: norm(cTip ? r[cTip] : 'dato') || 'dato',
      formula: cFor ? txt(r[cFor]) : '',
      signo: cSig && num(r[cSig]) ? num(r[cSig]) : 1
    })).filter(x => x.concepto).sort((a, b) => a.orden - b.orden);

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
    const capturado = {}, huerfanos = {};
    let sumaCapturada = 0, renglones = 0;
    const vivos = {}; conceptos.forEach(c => { vivos[norm(c.concepto)] = c.concepto; });
    dat.rows.forEach(r => {
      const a = num(r[dAnio]);
      if (a !== anio && a !== anio - 1) return;
      const m = num(r[dMes]), v = num(r[dMon]), nc = norm(r[dCon]);
      if (!nc || m < 0 || m > 12) return;
      if (a === anio && m >= desde && m <= hasta) { sumaCapturada += v; renglones++; }
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
    conceptos.forEach(c => { if (c.padre) (hijos[c.padre] = hijos[c.padre] || []).push(c.concepto); });

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
          const n = c.concepto;
          const linea = V[n] || new Array(13).fill(0);
          if (c.tipo === 'dato') {
            for (let m = 0; m <= 12; m++) linea[m] = (cap[n] || [])[m] || 0;
          } else if (c.tipo === 'subtotal') {
            // El Signo de un hijo dice cómo entra al estado, no al subtotal. Si va
            // en el mismo sentido que su padre, suma; si va al revés, resta. Así
            // "Gasto Financiero, neto" resta los intereses ganados sin regla aparte.
            for (let m = 1; m <= 12; m++) {
              linea[m] = (hijos[n] || []).reduce((s, h) => {
                const hc = conceptos.filter(x => x.concepto === h)[0];
                const sg = (hc && hc.signo !== c.signo) ? -1 : 1;
                return s + sg * ((V[h] || [])[m] || 0);
              }, 0);
            }
          } else if (c.tipo === 'acumulado') {
            // La fórmula nombra el concepto que se va acumulando. Se busca por
            // nombre para tolerar que venga con una etiqueta delante.
            const de = (conceptos.filter(x => x.concepto !== n &&
                        norm(c.formula).indexOf(norm(x.concepto)) !== -1)
                        .sort((a, b) => b.concepto.length - a.concepto.length)[0] || {}).concepto;
            const fuente = V[de] || new Array(13).fill(0);
            let saldo = (cap[n] || [])[0] || 0;
            for (let m = 1; m <= 12; m++) { saldo += fuente[m] || 0; linea[m] = saldo; }
          } else if (c.tipo === 'margen') {
            const p = c.formula.split(/÷|\//);
            const arriba = txt(p[0]), abajo = txt(p[1]);
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
                partes.push({ nombre: s, signo: signo });
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
      const meses = V[c.concepto].slice(1).map((x, i) =>
        (i + 1 < desde || i + 1 > hasta) ? null : x);
      const t = esMargen
        ? null
        : (esSaldo ? (V[c.concepto][hasta] || 0) : total(V[c.concepto]));
      const tp = esMargen
        ? null
        : (esSaldo ? (Vp[c.concepto][hasta] || 0) : total(Vp[c.concepto]));
      const vacio = c.tipo !== 'margen' && !meses.some(x => x) && !t && !tp;
      return {
        concepto: c.concepto, nivel: c.nivel, tipo: c.tipo, signo: c.signo,
        vacio: vacio,
        anteriorMeses: Vp[c.concepto].slice(1).map((x, i) =>
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
      const arr = txt(p[0]), ab = txt(p[1]);
      const f = (M) => {
        const b = total(M[ab] || []);
        return b ? total(M[arr] || []) / b : null;
      };
      filas[i].total = f(V); filas[i].anterior = f(Vp);
    });

    // ---- Lo que hay que leer: se saca de los propios números ----
    // No son frases fijas. Cada una se calcula y solo sale si de verdad aplica.
    const buscar = (n) => filas.filter(f => norm(f.concepto) === norm(n))[0];
    const lectura = [];
    const nMeses = hasta - desde + 1;
    const MESN = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
    const dinero = (v) => '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
    const cambio = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null;
    if (cual === ESTADOS.resultados) {
      const vn = buscar('Ventas Netas'), ub = buscar('Utilidad bruta');
      const uo = buscar('Utilidad operativa'), gga = buscar('Gastos Generales y Administrativos');
      const gv = buscar('Gastos de Venta');
      if (vn && vn.anterior) {
        const c = cambio(vn.total, vn.anterior);
        lectura.push('Las ventas netas del periodo son ' + dinero(vn.total) + ', ' +
          (c >= 0 ? 'un ' + c.toFixed(0) + '% arriba' : 'un ' + Math.abs(c).toFixed(0) + '% abajo') +
          ' del mismo periodo del año pasado.');
      }
      if (vn && ub && vn.total) {
        const m = ub.total / vn.total * 100;
        const ma = (vn.anterior && ub.anterior) ? ub.anterior / vn.anterior * 100 : null;
        lectura.push('El margen bruto es ' + m.toFixed(1) + '%' +
          (ma === null ? '.' : ', contra ' + ma.toFixed(1) + '% del año pasado: ' +
            (m > ma ? 'se está vendiendo con mejor margen.' : 'se está vendiendo con peor margen.')));
      }
      if (vn && gga && gv && vn.total) {
        const fijo = gga.total + gv.total;
        const pesoAhora = fijo / vn.total * 100;
        const pesoAntes = (vn.anterior) ? (gga.anterior + gv.anterior) / vn.anterior * 100 : null;
        lectura.push('Los gastos del periodo son ' + dinero(fijo) + ', el ' +
          pesoAhora.toFixed(1) + '% de la venta neta' +
          (pesoAntes === null ? '.' : ', contra ' + pesoAntes.toFixed(1) + '% del año pasado.'));
        if (gga.anterior) {
          const cg = cambio(gga.total, gga.anterior), cv = cambio(vn.total, vn.anterior);
          if (cv !== null && cv < -5 && cg > cv + 10) {
            lectura.push('La venta cayó ' + Math.abs(cv).toFixed(0) + '% y los gastos generales ' +
              (cg >= 0 ? 'subieron ' + cg.toFixed(0) + '%' : 'solo bajaron ' + Math.abs(cg).toFixed(0) + '%') +
              '. La estructura no se movió al ritmo de la venta: ahí está la caída de la utilidad.');
          }
        }
        // Punto de equilibrio con el margen del periodo
        if (ub && vn.total && ub.total > 0) {
          const mb = ub.total / vn.total;
          const equilibrio = fijo / mb;
          const porMes = equilibrio / nMeses;
          lectura.push('Con este margen y este nivel de gasto, el punto de equilibrio es ' +
            dinero(porMes) + ' de venta neta al mes. El promedio del periodo fue ' +
            dinero(vn.total / nMeses) + '.');
        }
      }
      if (uo) {
        const malos = [];
        uo.meses.forEach((v, i) => { if (v !== null && v < 0) malos.push(MESN[i]); });
        if (malos.length) {
          lectura.push((malos.length === 1 ? 'Un mes cerró' : malos.length + ' meses cerraron') +
            ' con utilidad operativa negativa: ' + malos.join(', ') + '.');
        }
      }
      const imp = buscar('Impuestos'), un = buscar('Utilidad Neta');
      if (imp && imp.total && uo && uo.total > 0) {
        const tasa = imp.total / uo.total * 100;
        if (tasa > 32) {
          lectura.push('El ISR registrado es ' + dinero(imp.total) + ', el ' + tasa.toFixed(0) +
            '% de la utilidad operativa. Como la tasa es 30%, la diferencia son pagos ' +
            'provisionales calculados con el coeficiente del año pasado: es un saldo a favor, ' +
            'no un gasto.');
        }
      }
    } else if (cual === ESTADOS.flujo) {
      const en = buscar('Entradas de efectivo'), sa = buscar('Salidas de efectivo');
      const ca = buscar('Cambio en efectivo y bancos');
      const sal = filas.filter(f => f.tipo === 'acumulado')[0];
      if (en && sa) {
        lectura.push('Entraron ' + dinero(en.total) + ' y salieron ' + dinero(sa.total) +
          ' en el periodo.');
      }
      if (ca) {
        lectura.push('El efectivo ' + (ca.total >= 0 ? 'creció ' : 'se redujo ') +
          dinero(ca.total) + ' en el periodo' +
          (sal ? ', y cierra en ' + dinero(sal.total) + '.' : '.'));
        const malos = [];
        ca.meses.forEach((v, i) => { if (v !== null && v < 0) malos.push(MESN[i]); });
        if (malos.length) {
          lectura.push((malos.length === 1 ? 'Un mes quemó' : malos.length + ' meses quemaron') +
            ' efectivo: ' + malos.join(', ') + '.');
        }
      }
      // Los traspasos inflan los dos lados sin ser flujo de verdad
      const tr = filas.filter(f => /traspaso/i.test(f.concepto));
      if (tr.length >= 2 && en && en.total) {
        const monto = Math.min.apply(null, tr.map(x => Math.abs(x.total)));
        if (monto / en.total > 0.05) {
          lectura.push('Los traspasos entre cuentas propias suman ' + dinero(monto) +
            ' de cada lado, el ' + (monto / en.total * 100).toFixed(0) + '% de las entradas. ' +
            'No cambian el efectivo: solo inflan entradas y salidas por igual.');
        }
      }
    }

    return res.status(200).json({
      ok: true,
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
