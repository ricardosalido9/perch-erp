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
  flujo:      { datos: 'fin_flujo',   conceptos: 'fin_ef_conceptos', titulo: 'Flujo de efectivo' }
};

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const cual = ESTADOS[txt(body.estado)] || ESTADOS.resultados;
    const anio = +body.anio || new Date().getFullYear();

    const [dat, con] = await Promise.all([leer(cual.datos), leer(cual.conceptos)]);
    if (dat.sinArchivo || con.sinArchivo) {
      return res.status(400).json({
        error: cual.titulo + ' no está conectado.',
        pista: 'Falta la variable SHEET_ESTADOS con el id del archivo de estados financieros.'
      });
    }
    if (!con.rows.length) {
      return res.status(400).json({
        error: 'No se pudo leer la estructura del ' + cual.titulo.toLowerCase() + '.',
        pista: 'Revisa que la pestaña "' + (con.cfg ? con.cfg.sheetName : '') + '" exista y ' +
               'tenga los encabezados Orden, Concepto, Nivel, Padre, Tipo, Cómo se calcula y Signo.'
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
      if (a === anio) { sumaCapturada += v; renglones++; }
      if (!vivos[nc]) {
        if (a === anio && v) huerfanos[txt(r[dCon])] = (huerfanos[txt(r[dCon])] || 0) + v;
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
      // Dos pasadas: la segunda alcanza a los subtotales que nombran a un hermano
      // que todavía no se había resuelto. Con dos basta para cualquier estructura
      // de dos niveles, que es la que tienen estos estados.
      for (let pasada = 0; pasada < 2; pasada++) {
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
      }
      return V;
    };

    const V = armar(anio), Vp = armar(anio - 1);
    const total = (linea) => linea.slice(1).reduce((s, x) => s + (x || 0), 0);

    const filas = conceptos.map(c => {
      const esMargen = c.tipo === 'margen', esSaldo = c.tipo === 'acumulado';
      const meses = V[c.concepto].slice(1);
      const t = esMargen
        ? null
        : (esSaldo ? meses.filter(x => x).slice(-1)[0] || 0 : total(V[c.concepto]));
      const tp = esMargen
        ? null
        : (esSaldo ? Vp[c.concepto].slice(1).filter(x => x).slice(-1)[0] || 0 : total(Vp[c.concepto]));
      return {
        concepto: c.concepto, nivel: c.nivel, tipo: c.tipo, signo: c.signo,
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

    return res.status(200).json({
      ok: true,
      estado: txt(body.estado) || 'resultados',
      titulo: cual.titulo,
      anio: anio,
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
