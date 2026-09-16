// Las notas de un reporte: lo que alguien escribe encima de los números.
//
// El ERP calcula, pero el criterio lo pone quien cierra el mes. "La venta bajó
// 38%" lo saca el sistema; "lo que falta no es rentabilidad por pieza sino piezas
// vendidas" lo pone una persona. Sin un lugar donde escribir eso, el reporte se
// rehace a mano cada mes aunque los números salgan solos.
//
// Se guardan en una pestaña, por reporte, año, mes y sección. Así el reporte del
// mes pasado conserva las suyas y no se pisan entre meses.
//
//   ?action=notas               leer     { reporte, anio, mes }
//   POST action=notas-guardar   escribir { reporte, anio, mes, seccion, texto }
const core = require('../core');

const PESTANA = process.env.TAB_NOTAS || 'Notas de reportes';
const COLS = ['Reporte', 'Año', 'Mes', 'Sección', 'Nota', 'Quién', 'Cuándo'];

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(H, ...ns) {
  for (const n of ns) { const c = H.filter(x => norm(x) === norm(n))[0]; if (c) return c; }
  return null;
}

// Las notas viven en el archivo de estados financieros, junto a lo que comentan.
async function cfgNotas() {
  const base = core.areaCfg ? await core.areaCfg('fin_estados') : core.SHEETS.fin_estados;
  if (!base || !base.id) {
    const e = new Error('No hay dónde guardar las notas.');
    e.pista = 'Se guardan en el archivo de estados financieros, en una pestaña llamada "' +
              PESTANA + '". Falta conectar ese archivo.';
    throw e;
  }
  return { id: base.id, sheetName: PESTANA };
}

async function leerNotas() {
  const cfg = await cfgNotas();
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) {
    // La pestaña puede no existir todavía: no es un error, es que nadie ha escrito
    return { existe: false, headers: [], rows: [], cfg };
  }
  if (!values.length) return { existe: true, headers: [], rows: [], cfg };
  const H = (values[0] || []).map(h => txt(h));
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { existe: true, headers: H, rows, cfg };
}

// Devuelve las notas de un reporte y mes, como { seccion: texto }
async function notasDe(reporte, anio, mes) {
  const d = await leerNotas();
  const out = {};
  if (!d.headers.length) return out;
  const cR = col(d.headers, 'Reporte'), cA = col(d.headers, 'Año', 'Anio');
  const cM = col(d.headers, 'Mes'), cS = col(d.headers, 'Sección', 'Seccion');
  const cN = col(d.headers, 'Nota', 'Texto', 'Comentario');
  if (!cR || !cS || !cN) return out;
  d.rows.forEach(r => {
    if (norm(r[cR]) !== norm(reporte)) return;
    if (anio && cA && Number(r[cA]) !== Number(anio)) return;
    // Un reporte sin mes —el estado de resultados del año— deja el mes vacío
    if (mes && cM && txt(r[cM]) && Number(r[cM]) !== Number(mes)) return;
    const s = txt(r[cS]) || 'general';
    if (txt(r[cN])) out[s] = txt(r[cN]);
  });
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const reporte = txt(body.reporte) || 'general';
    const anio = +body.anio || new Date().getFullYear();
    const mes = +body.mes || 0;

    if (!body.guardar) {
      const notas = await notasDe(reporte, anio, mes);
      return res.status(200).json({ ok: true, reporte, anio, mes, notas,
        pestana: PESTANA, columnas: COLS });
    }

    // ---- guardar ----
    const seccion = txt(body.seccion) || 'general';
    const texto = txt(body.texto);
    const d = await leerNotas();
    const cfg = d.cfg;

    if (!d.headers.length) {
      return res.status(400).json({
        error: 'No existe la pestaña donde se guardan las notas.',
        pista: 'Crea una pestaña llamada "' + PESTANA + '" en el archivo de estados ' +
               'financieros, con estas columnas en el primer renglón: ' + COLS.join(' · ')
      });
    }
    const cR = col(d.headers, 'Reporte'), cA = col(d.headers, 'Año', 'Anio');
    const cM = col(d.headers, 'Mes'), cS = col(d.headers, 'Sección', 'Seccion');
    const cN = col(d.headers, 'Nota', 'Texto', 'Comentario');
    const cQ = col(d.headers, 'Quién', 'Quien', 'Usuario');
    const cC = col(d.headers, 'Cuándo', 'Cuando', 'Fecha');
    if (!cR || !cS || !cN) {
      return res.status(400).json({
        error: 'A la pestaña "' + PESTANA + '" le faltan columnas.',
        pista: 'Se necesitan al menos Reporte, Sección y Nota. Tiene: ' + d.headers.join(' · ')
      });
    }

    // Si ya hay una nota de esa sección y ese mes, se reemplaza. Guardar dos
    // versiones de la misma nota deja al que lee sin saber cuál vale.
    const ya = d.rows.filter(r =>
      norm(r[cR]) === norm(reporte) &&
      norm(r[cS]) === norm(seccion) &&
      (!cA || !anio || Number(r[cA]) === Number(anio)) &&
      (!cM || !mes || !txt(r[cM]) || Number(r[cM]) === Number(mes)))[0];

    const quien = (core.verifyToken(body.token) || {}).u || '';
    const hoy = new Date();
    const cuando = hoy.getDate() + '/' + (hoy.getMonth() + 1) + '/' + hoy.getFullYear();

    if (ya) {
      const rec = {};
      d.headers.forEach(h => { rec[h] = ya[h]; });
      rec[cN] = texto;
      if (cQ) rec[cQ] = quien;
      if (cC) rec[cC] = cuando;
      // Se escribe el renglón completo, respetando el orden de los encabezados
      const fila = d.headers.map(h => (rec[h] != null ? rec[h] : ''));
      await core.writeRowSkipping(cfg.id, cfg.sheetName, ya._fila, fila, new Set());
      return res.status(200).json({ ok: true, accion: 'actualizada', fila: ya._fila });
    }
    if (!texto) return res.status(200).json({ ok: true, accion: 'vacía, no se guardó' });

    const rec = {};
    rec[cR] = reporte;
    if (cA) rec[cA] = anio;
    if (cM) rec[cM] = mes || '';
    rec[cS] = seccion;
    rec[cN] = texto;
    if (cQ) rec[cQ] = quien;
    if (cC) rec[cC] = cuando;
    await core.appendRows(cfg.id, cfg.sheetName, [rec], d.headers);
    return res.status(200).json({ ok: true, accion: 'guardada' });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e), pista: e && e.pista });
  }
};

module.exports.notasDe = notasDe;
module.exports.PESTANA = PESTANA;
module.exports.COLS = COLS;
