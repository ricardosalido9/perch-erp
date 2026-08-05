const core = require('./core');
const ZONA = 'America/Mexico_City';

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function txt(v) { return String(v == null ? '' : v).trim(); }
function num(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
const MESES = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,
  septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12 };
function fechaNum(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]);
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return (+m[3]) * 10000 + MESES[m[2]] * 100 + (+m[1]);
  return null;
}
function hoyNum() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  return parseInt(String(f).replace(/-/g, ''), 10);
}
function aFecha(n) { return new Date(Date.UTC(Math.floor(n/10000), Math.floor(n/100)%100-1, n%100)); }
function dias(a, b) { if (a === null || b === null) return null; return Math.round((aFecha(b)-aFecha(a))/86400000); }

async function leer(key) {
  const cfg = core.SHEETS[key];
  if (!cfg) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map(h => String(h));
  const formulaCols = new Set();
  (core.FORMULA_FIELDS[key] || []).forEach(f => {
    headers.forEach((h, i) => { if (norm(h) === norm(f)) formulaCols.add(i); });
  });
  const dataCols = headers.map((_, i) => i).filter(i => !formulaCols.has(i));
  const anchor = headers.findIndex(h => norm(h) === 'pendiente');
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    // Solo cuenta como pendiente real si la columna "Pendiente" tiene texto.
    // (Las fórmulas siguen corriendo hacia abajo aunque no haya pendiente todavía.)
    let ok;
    if (anchor !== -1) ok = values[i][anchor] != null && String(values[i][anchor]).trim() !== '';
    else ok = dataCols.some(c => values[i][c] != null && String(values[i][c]).trim() !== '');
    if (!ok) continue;
    const o = { _row: i + 1 };
    headers.forEach((h, j) => { if (o[h] === undefined) o[h] = (values[i][j] != null) ? values[i][j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}
function col(headers, ...nombres) {
  for (const n of nombres) { const h = headers.find(x => norm(x) === norm(n)); if (h) return h; }
  return null;
}

// Convierte filas de Pendientes en objetos uniformes
function mapear(headers, rows) {
  const cTit = col(headers, 'Pendiente', 'Tarea', 'Asunto');
  const cDesc = col(headers, 'Descripción', 'Descripcion', 'Detalle');
  const cCli = col(headers, 'Cliente');
  const cArea = col(headers, 'Área', 'Area');
  const cResp = col(headers, 'Responsable', 'Asignado a');
  const cCo = col(headers, 'Co-Responsable', 'Co-responsable');
  const cSol = col(headers, 'Responsable de solicitud', 'Solicitante', 'Solicitado por');
  const cRev = col(headers, 'Revisión por:', 'Revision por:', 'Revisión por', 'Revisa');
  const cPri = col(headers, 'Prioridad');
  const cEst = col(headers, 'Status', 'Estatus', 'Estado');
  const cRevd = col(headers, 'Revisado');
  const cFSol = col(headers, 'Fecha de Solicitud', 'Fecha de solicitud');
  const cFComp = col(headers, 'Fecha de Entrega Estimada', 'Fecha de Entrega', 'Fecha de entrega',
    'Fecha límite', 'Fecha objetivo');
  const cFReal = col(headers, 'Fecha de Entrega Real', 'Fecha de Terminación', 'Fecha de terminacion', 'Fecha real');
  const cSem = col(headers, 'Semana');
  const cCom = col(headers, 'Comentario', 'Comentarios', 'Notas');

  return rows.map(r => {
    const est = cEst ? txt(r[cEst]) : '';
    return {
      _row: r._row,
      titulo: cTit ? txt(r[cTit]) : '',
      desc: cDesc ? txt(r[cDesc]) : '',
      cliente: cCli ? txt(r[cCli]) : '',
      area: cArea ? txt(r[cArea]) : '',
      resp: cResp ? txt(r[cResp]) : '',
      coresp: cCo ? txt(r[cCo]) : '',
      sol: cSol ? txt(r[cSol]) : '',
      rev: cRev ? txt(r[cRev]) : '',
      pri: cPri ? txt(r[cPri]) : '',
      estatus: est,
      cerrado: core.esCerrado(est),
      cancelado: norm(est) === 'cancelado',
      revisado: cRevd ? core.esRevisado(r[cRevd]) : false,
      semana: cSem ? num(r[cSem]) : null,
      fSol: cFSol ? txt(r[cFSol]) : '',  dSol: cFSol ? fechaNum(r[cFSol]) : null,
      fComp: cFComp ? txt(r[cFComp]) : '', dComp: cFComp ? fechaNum(r[cFComp]) : null,
      fReal: cFReal ? txt(r[cFReal]) : '', dReal: cFReal ? fechaNum(r[cFReal]) : null,
      com: cCom ? txt(r[cCom]) : ''
    };
  });
}
function contarPor(lista, campo) {
  const out = {};
  lista.forEach(x => { const v = txt(x[campo]); if (!v) return; out[v] = (out[v] || 0) + 1; });
  return out;
}

// Un pendiente puede tener varios responsables (separados por coma, ; o salto).
// Se suma Co-Responsable. Devuelve la lista de nombres tal cual (para mostrar).
function personas(p) {
  const out = [];
  const push = s => String(s || '').split(/[;,\n]/).forEach(x => {
    x = x.trim(); if (x && out.every(y => norm(y) !== norm(x))) out.push(x);
  });
  push(p.resp); push(p.coresp);
  return out;
}
function perteneceA(p, nombre) {
  const t = norm(nombre);
  return personas(p).some(x => norm(x) === t);
}

module.exports = { norm, txt, num, fechaNum, hoyNum, dias, leer, col, mapear, contarPor, personas, perteneceA };
