// Cruza el flujo de efectivo contra INGRESOS y EGRESOS, concepto por concepto.
//
// Los dos deberían decir lo mismo: el flujo se captura a mano desde el banco, y
// INGRESOS y EGRESOS también salen del banco. Si no coinciden, o falta capturar
// de un lado, o un concepto está escrito distinto, o algo se contó dos veces.
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

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();
    const desde = Math.min(12, Math.max(1, +body.desde || 1));
    const hasta = Math.min(12, Math.max(desde, +body.hasta || 12));

    const [ing, egr, flu] = await Promise.all([
      leer('fin_ingresos'), leer('fin_egresos'), leer('fin_flujo')
    ]);
    if (!ing.headers.length && !egr.headers.length) {
      return res.status(400).json({ error: 'No se pudieron leer INGRESOS ni EGRESOS.' });
    }

    // ---- lo que dicen INGRESOS y EGRESOS, por concepto ----
    const banco = {};        // concepto -> { entrada, salida, n }
    let sinFecha = 0, fueraDeRango = 0;
    const juntar = (hoja, lado) => {
      if (!hoja.headers.length) return;
      const H = hoja.headers;
      const cF = col(H, 'Fecha'), cT = col(H, 'Total', 'Monto', 'Importe');
      const cC = col(H, 'Concepto'), cCat = col(H, 'Categoría', 'Categoria');
      if (!cF || !cT) return;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[cF]);
        if (d === null) { sinFecha++; return; }
        if (Math.floor(d / 10000) !== anio) return;
        const m = Math.floor(d / 100) % 100;
        if (m < desde || m > hasta) { fueraDeRango++; return; }
        const t = num(r[cT]);
        if (!t) return;
        const k = txt(cC ? r[cC] : '') || txt(cCat ? r[cCat] : '') || 'Sin concepto';
        banco[k] = banco[k] || { concepto: k, entrada: 0, salida: 0, n: 0 };
        banco[k][lado] += t; banco[k].n++;
      });
    };
    juntar(ing, 'entrada');
    juntar(egr, 'salida');

    // ---- lo que dice el flujo, por concepto ----
    const enFlujo = {};
    if (flu.headers.length) {
      const H = flu.headers;
      const cA = col(H, 'Año','Anio','Ano'), cM = col(H, 'Mes');
      const cC = col(H, 'Concepto'), cV = col(H, 'Monto','Importe','Total');
      if (cA && cM && cC && cV) {
        flu.rows.forEach(r => {
          if (num(r[cA]) !== anio) return;
          const m = num(r[cM]);
          if (m < desde || m > hasta) return;     // el mes 0 es saldo inicial, no movimiento
          const k = txt(r[cC]);
          if (!k) return;
          enFlujo[k] = (enFlujo[k] || 0) + num(r[cV]);
        });
      }
    }

    // ---- se emparejan por nombre ----
    // Dos nombres iguales sin acentos y sin mayúsculas se consideran el mismo
    // concepto. Lo que no empareje sale en su lista, que es lo que hay que revisar.
    const idxFlujo = {};
    Object.keys(enFlujo).forEach(k => { idxFlujo[norm(k)] = k; });
    const idxBanco = {};
    Object.keys(banco).forEach(k => { idxBanco[norm(k)] = k; });

    const red = (x) => Math.round(x * 100) / 100;
    const emparejados = [], soloBanco = [], soloFlujo = [];
    Object.keys(banco).forEach(k => {
      const b = banco[k];
      const monto = b.entrada - b.salida;
      const kf = idxFlujo[norm(k)];
      if (kf) {
        const f = enFlujo[kf];
        // El flujo guarda los montos en positivo; el signo lo pone la estructura.
        const dif = Math.abs(f) - Math.abs(monto);
        emparejados.push({
          concepto: k, banco: red(monto), flujo: red(f), diferencia: red(dif),
          movimientos: b.n, cuadra: Math.abs(dif) < 1
        });
      } else {
        soloBanco.push({ concepto: k, monto: red(monto), movimientos: b.n,
                         entrada: red(b.entrada), salida: red(b.salida) });
      }
    });
    Object.keys(enFlujo).forEach(k => {
      if (!idxBanco[norm(k)]) soloFlujo.push({ concepto: k, monto: red(enFlujo[k]) });
    });

    emparejados.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
    soloBanco.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));
    soloFlujo.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));

    const suma = (a, f) => a.reduce((s, x) => s + f(x), 0);
    return res.status(200).json({
      ok: true, anio, desde, hasta,
      emparejados, soloBanco, soloFlujo,
      totales: {
        banco: red(suma(Object.keys(banco).map(k => banco[k]), b => b.entrada - b.salida)),
        flujo: red(suma(Object.keys(enFlujo).map(k => enFlujo[k]), x => x)),
        cuadran: emparejados.filter(x => x.cuadra).length,
        noCuadran: emparejados.filter(x => !x.cuadra).length,
        montoSoloBanco: red(suma(soloBanco, x => Math.abs(x.monto))),
        montoSoloFlujo: red(suma(soloFlujo, x => Math.abs(x.monto)))
      },
      sinFecha,
      nota: 'Se comparan por nombre de concepto, sin distinguir acentos ni mayúsculas. ' +
            'Un concepto que solo aparece de un lado no es necesariamente un error: ' +
            'el flujo agrupa varios conceptos del banco en un renglón, y esos van a ' +
            'salir como "solo en el banco".'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
