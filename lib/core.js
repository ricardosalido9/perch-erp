const crypto = require('crypto');
const { google } = require('googleapis');

const SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto';
const SESSION_MS = 6 * 60 * 60 * 1000; // 6 horas

// ===== Archivo de Google Sheets (Lista de Pendientes 2026 en vivo) =====
const ARCHIVO = process.env.SHEET_ID || '1fmTDfL2Nm4OE4njkDsK5KvPY7D_MmvlqEdWbN0tfF90';
const PESTANA = 'Pendientes';
const CATEGORIAS_SHEET = 'Categorías';

function _colLetter(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function _norm(s) { return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// ===== Menú =====
const MENU = [
  { key:'inicio',      label:'Inicio',    icon:'home' },
  { key:'dashboard',   label:'Análisis',  icon:'grid' },
  { key:'bitacora',    label:'Bitácora',  icon:'clock' },
  { key:'recurrentes', label:'Recurrentes', icon:'flag', adminOnly:true },
  { key:'pendientes',  label:'Pendientes', icon:'check', children:[
      { key:'pend_abiertos', label:'Abiertos' },
      { key:'pend_norev',    label:'No revisados' },
      { key:'pend_todos',    label:'Todos' },
      { key:'pend_cerrados', label:'Terminados' }
  ] }
];

// ===== Hojas conectadas (todas leen la misma pestaña, con distinto filtro) =====
const SHEETS = {
  pend_abiertos: { id: ARCHIVO, sheetName: PESTANA },
  pend_norev:    { id: ARCHIVO, sheetName: PESTANA },
  pend_todos:    { id: ARCHIVO, sheetName: PESTANA },
  pend_cerrados: { id: ARCHIVO, sheetName: PESTANA },
  recurrentes:   { id: ARCHIVO, sheetName: 'Recurrentes' }
};
const AREA_PENDIENTES = 'pend_todos';

// Estatus que cuentan como cerrado (además, cualquier "TERMINADO..." cuenta)
const ESTATUS_CERRADOS = ['cancelado'];
function esCerrado(status) {
  const s = _norm(status);
  return s.indexOf('terminado') === 0 || ESTATUS_CERRADOS.indexOf(s) !== -1;
}
function esRevisado(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'verdadero' || s === 'si' || s === 'sí' || s === '1' || s === 'x';
}

// Filtros de fila por área
const AREA_ROW_FILTERS = {
  pend_abiertos: { op: 'abiertos' },
  pend_norev:    { op: 'norev' },
  pend_cerrados: { op: 'cerrados' }
};

// ===== Columnas calculadas por fórmula: el panel NO las escribe =====
const _DERIV = ['Mes', 'Semana', 'Días háb. ciclo (solicitud→entrega)',
  'Desviación días háb. (vs. supuesta)', 'Estado / ¿A tiempo?'];
const FORMULA_FIELDS = {
  pend_abiertos: _DERIV, pend_norev: _DERIV, pend_todos: _DERIV, pend_cerrados: _DERIV
};

// ===== Categorías → qué campo del formulario llena cada lista =====
const CAT_A_CAMPOS = {
  'Colaboradores': ['Responsable', 'Co-Responsable'],
  'Clientes': ['Cliente'],
  'Área': ['Área'],
  'Prioridad': ['Prioridad'],
  'Revisión por:': ['Revisión por:'],
  'Status': ['Status']
};
const CAMPO_A_CAT = {};
Object.keys(CAT_A_CAMPOS).forEach(cat => CAT_A_CAMPOS[cat].forEach(c => { CAMPO_A_CAT[_norm(c)] = cat; }));

// Hoja de usuarios (archivo aparte). Encabezados: Usuario | Contraseña | Nombre | Correo | Rol
const USERS_ARCHIVO = process.env.USERS_SHEET_ID || '1bSN2p3blGHv65X3Avmd67zZTO86Hhn6MwPePacgljvw';
const USERS_SHEET = { id: USERS_ARCHIVO, sheetName: 'Usuarios ERP' };

// ===== Google Sheets (cuenta de servicio) =====
function getCredentials() {
  if (process.env.GOOGLE_CREDENTIALS) {
    const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return { email: c.client_email, key: c.private_key };
  }
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  if (key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') key = key.slice(1, -1);
  key = key.replace(/\\n/g, '\n');
  return { email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: key };
}
function getSheets() {
  const c = getCredentials();
  const auth = new google.auth.JWT(c.email, null, c.key, ['https://www.googleapis.com/auth/spreadsheets']);
  return google.sheets({ version: 'v4', auth });
}
async function readRange(spreadsheetId, sheetName) {
  const sheets = getSheets();
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'" + sheetName + "'" });
  return r.data.values || [];
}
async function appendRow(spreadsheetId, sheetName, row) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: "'" + sheetName + "'",
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}
async function writeRowSkipping(spreadsheetId, sheetName, rowNumber, rowArr, skipCols) {
  const sheets = getSheets();
  const data = [];
  let i = 0;
  while (i < rowArr.length) {
    if (skipCols.has(i)) { i++; continue; }
    let j = i;
    while (j < rowArr.length && !skipCols.has(j)) j++;
    data.push({
      range: "'" + sheetName + "'!" + _colLetter(i) + rowNumber + ":" + _colLetter(j - 1) + rowNumber,
      values: [rowArr.slice(i, j)]
    });
    i = j;
  }
  if (!data.length) return { ok: true };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  return { ok: true };
}

// ===== Categorías (listas para desplegables), remapeadas a los campos =====
async function getCategories(key) {
  if (!SHEETS[key]) return {};
  let values;
  try { values = await readRange(SHEETS[key].id, CATEGORIAS_SHEET); }
  catch (e) { return {}; }
  if (!values.length) return {};
  const headers = values[0].map(h => String(h).trim());
  const out = {};
  headers.forEach((h, col) => {
    if (!h) return;
    const list = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i][col];
      if (v != null && String(v).trim() !== '') list.push(String(v).trim());
    }
    const campos = CAT_A_CAMPOS[h] || [h];
    campos.forEach(c => { out[c] = list; });
  });
  return out;
}
async function addCategory(key, campo, valor) {
  if (!SHEETS[key]) throw new Error('Área no conectada.');
  const categoria = CAMPO_A_CAT[_norm(campo)] || campo;
  const sheets = getSheets();
  const values = await readRange(SHEETS[key].id, CATEGORIAS_SHEET);
  const headers = (values[0] || []).map(h => String(h).trim());
  let col = -1;
  for (let i = 0; i < headers.length; i++) if (_norm(headers[i]) === _norm(categoria)) { col = i; break; }
  if (col === -1) throw new Error('No existe la lista "' + categoria + '" en Categorías.');
  let row = 1;
  while (row < values.length && values[row][col] != null && String(values[row][col]).trim() !== '') row++;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEETS[key].id, range: "'" + CATEGORIAS_SHEET + "'!" + _colLetter(col) + (row + 1),
    valueInputOption: 'USER_ENTERED', requestBody: { values: [[valor]] }
  });
  return { ok: true };
}

// Lista de colaboradores (para el selector "Ver como" de los admin)
async function getColaboradores() {
  let values;
  try { values = await readRange(ARCHIVO, CATEGORIAS_SHEET); }
  catch (e) { return []; }
  if (!values.length) return [];
  const headers = values[0].map(h => String(h).trim());
  const col = headers.findIndex(h => _norm(h) === 'colaboradores');
  if (col === -1) return [];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i][col];
    if (v != null && String(v).trim() !== '' && out.indexOf(String(v).trim()) === -1) out.push(String(v).trim());
  }
  out.sort((a, b) => a.localeCompare(b, 'es'));
  return out;
}

// ===== Tokens de sesión =====
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(Object.assign({}, payload, { exp: Date.now() + SESSION_MS }))).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  try {
    if (!token) return null;
    const parts = String(token).split('.');
    const body = parts[0], sig = parts[1] || '';
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() > data.exp) return null;
    return data;
  } catch (e) { return null; }
}
function esAdmin(sesion) {
  const rol = String((sesion && sesion.rol) || '').trim().toLowerCase();
  return rol === 'admin' || rol === 'administrador';
}
function verifyWriter(token) {
  const s = verifyToken(token);
  if (!s) return null;
  const rol = String(s.rol || '').trim().toLowerCase();
  if (rol === 'lector' || rol === 'viewer' || rol === 'lectura') return null;
  return s;
}

// ===== Usuarios (lee por nombre de encabezado) =====
function _colIndex(headers, ...alias) {
  for (const a of alias) {
    const i = headers.findIndex(h => _norm(h) === _norm(a));
    if (i !== -1) return i;
  }
  return -1;
}
async function findUser(usuario) {
  const rows = await readRange(USERS_SHEET.id, USERS_SHEET.sheetName);
  if (!rows.length) return null;
  const headers = (rows[0] || []).map(h => String(h));
  const iU = _colIndex(headers, 'Usuario', 'User', 'Correo', 'Email');
  const iP = _colIndex(headers, 'Contraseña', 'Contrasena', 'Clave', 'Password');
  const iN = _colIndex(headers, 'Nombre', 'Name');
  const iR = _colIndex(headers, 'Rol', 'Role', 'Perfil');
  const cU = iU !== -1 ? iU : 0, cP = iP !== -1 ? iP : 1, cN = iN !== -1 ? iN : 2, cR = iR;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (String(r[cU] || '').toLowerCase() === String(usuario || '').toLowerCase()) {
      return { usuario: r[cU], contrasena: r[cP], nombre: r[cN], rol: cR !== -1 ? r[cR] : '' };
    }
  }
  return null;
}

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
    return req.body;
  }
  return await new Promise((resolve) => {
    let d = ''; req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
  });
}

// ===== Alta y edición (respeta columnas calculadas y encabezados repetidos) =====
function _skipCols(key, headers) {
  const skip = new Set();
  (FORMULA_FIELDS[key] || []).forEach(f => {
    headers.forEach((h, i) => { if (_norm(h) === _norm(f)) skip.add(i); });
  });
  return skip;
}
// Detecta columnas con fórmula leyendo la fila 2 con las fórmulas crudas.
// Así el panel nunca pisa una columna calculada aunque su encabezado tenga
// símbolos raros (→, ¿, acentos) que no coincidan con la lista configurada.
async function _formulaColsDinamico(spreadsheetId, sheetName) {
  const sheets = getSheets();
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "'" + sheetName + "'!2:2", valueRenderOption: 'FORMULA'
    });
    const row = (r.data.values && r.data.values[0]) || [];
    const set = new Set();
    row.forEach((v, i) => { if (typeof v === 'string' && v.trim().charAt(0) === '=') set.add(i); });
    return set;
  } catch (e) { return new Set(); }
}
async function _propsHoja(spreadsheetId, sheetName) {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId, fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });
  return (meta.data.sheets || []).map(s => s.properties).filter(p => p.title === sheetName)[0] || null;
}
// Asegura que la hoja tenga al menos `necesita` filas (expande la cuadrícula si hace falta)
async function _asegurarFilas(spreadsheetId, sheetName, necesita) {
  const props = await _propsHoja(spreadsheetId, sheetName);
  if (!props) return;
  const rc = (props.gridProperties && props.gridProperties.rowCount) || 0;
  if (necesita <= rc) return;
  const sheets = getSheets();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId, requestBody: { requests: [
      { appendDimension: { sheetId: props.sheetId, dimension: 'ROWS', length: (necesita - rc) + 50 } }
    ] }
  });
}
async function addRecord(key, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Área no conectada.');
  const values = await readRange(cfg.id, cfg.sheetName);
  const headers = (values[0] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  (await _formulaColsDinamico(cfg.id, cfg.sheetName)).forEach(i => skip.add(i));
  const rowArr = headers.map(h => (record && record[h] != null) ? record[h] : '');

  // Escribe en la PRIMERA fila cuya columna ancla (Pendiente) esté vacía.
  // Esas filas ya traen las fórmulas arrastradas, así que se calculan solas.
  let anchor = headers.findIndex(h => _norm(h) === 'pendiente');
  if (anchor === -1) anchor = headers.findIndex((_, i) => !skip.has(i));
  if (anchor === -1) anchor = 0;
  let target = values.length + 1;
  for (let r = 1; r < values.length; r++) {
    const cell = values[r][anchor];
    if (cell == null || String(cell).trim() === '') { target = r + 1; break; }
  }
  await _asegurarFilas(cfg.id, cfg.sheetName, target);
  await writeRowSkipping(cfg.id, cfg.sheetName, target, rowArr, skip);
  return { ok: true };
}
async function updateRecord(key, rowNumber, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Área no conectada.');
  const values = await readRange(cfg.id, cfg.sheetName);
  const headers = (values[0] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  (await _formulaColsDinamico(cfg.id, cfg.sheetName)).forEach(i => skip.add(i));
  const rowArr = headers.map(h => (record && record[h] != null) ? record[h] : '');
  await writeRowSkipping(cfg.id, cfg.sheetName, Number(rowNumber), rowArr, skip);
  return { ok: true };
}

async function getLookup() { return null; }

// ===== Bitácora de tiempo =====
const BITACORA_SHEET = 'Bitácora';
const BITACORA_HEADERS = ['Fecha', 'Colaborador', 'Cliente', 'Pendiente', 'Actividad', 'Horas', 'Registrado por'];
async function ensureBitacora() {
  const props = await _propsHoja(ARCHIVO, BITACORA_SHEET);
  if (props) return;
  const sheets = getSheets();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ARCHIVO, requestBody: { requests: [{ addSheet: { properties: { title: BITACORA_SHEET } } }] }
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: ARCHIVO, range: "'" + BITACORA_SHEET + "'!A1",
    valueInputOption: 'RAW', requestBody: { values: [BITACORA_HEADERS] }
  });
}
async function appendBitacora(rows) {
  await ensureBitacora();
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: ARCHIVO, range: "'" + BITACORA_SHEET + "'",
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', requestBody: { values: rows }
  });
  return { ok: true };
}
async function readBitacora() {
  await ensureBitacora();
  return await readRange(ARCHIVO, BITACORA_SHEET);
}

// ===== Recurrentes =====
const RECURRENTES_SHEET = 'Recurrentes';
const _rec = require('./recurrentes');
async function ensureRecurrentes() {
  const props = await _propsHoja(ARCHIVO, RECURRENTES_SHEET);
  const sheets = getSheets();
  if (!props) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ARCHIVO, requestBody: { requests: [{ addSheet: { properties: { title: RECURRENTES_SHEET } } }] }
    });
  }
  // ¿Está vacía (sin encabezados en la fila 1)? Entonces la precargamos.
  let values = [];
  try { values = await readRange(ARCHIVO, RECURRENTES_SHEET); } catch (e) { values = []; }
  const vacia = !values.length || !(values[0] || []).some(c => String(c).trim() !== '');
  if (vacia) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: ARCHIVO, range: "'" + RECURRENTES_SHEET + "'!A1",
      valueInputOption: 'RAW', requestBody: { values: [_rec.COLUMNAS].concat(_rec.PRECARGA) }
    });
  }
}
async function readRecurrentes() {
  await ensureRecurrentes();
  const values = await readRange(ARCHIVO, RECURRENTES_SHEET);
  const headers = (values[0] || []).map(String);
  const idx = n => headers.findIndex(h => _norm(h) === _norm(n));
  const iAct=idx('Activo'), iP=idx('Pendiente'), iCl=idx('Cliente'), iAr=idx('Área'),
        iR=idx('Responsable'), iCo=idx('Co-Responsable'), iRev=idx('Revisión por:'),
        iPri=idx('Prioridad'), iF=idx('Frecuencia'), iRg=idx('Regla'), iM=idx('Meses'), iD=idx('Descripción');
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    const pend = iP!==-1 ? String(r[iP]||'').trim() : '';
    if (!pend) continue;
    const act = String(iAct!==-1?r[iAct]:'').trim().toLowerCase();
    out.push({
      row: i+1, activo: (act==='true'||act==='verdadero'||act==='si'||act==='sí'||act==='x'||act==='1'),
      pendiente: pend, cliente: iCl!==-1?String(r[iCl]||'').trim():'', area: iAr!==-1?String(r[iAr]||'').trim():'',
      responsable: iR!==-1?String(r[iR]||'').trim():'', coresp: iCo!==-1?String(r[iCo]||'').trim():'',
      revision: iRev!==-1?String(r[iRev]||'').trim():'', prioridad: iPri!==-1?String(r[iPri]||'').trim():'',
      frecuencia: iF!==-1?String(r[iF]||'').trim():'', regla: iRg!==-1?String(r[iRg]||'').trim():'',
      meses: iM!==-1?String(r[iM]||'').trim():'', descripcion: iD!==-1?String(r[iD]||'').trim():''
    });
  }
  return out;
}
async function getClientes() {
  let values;
  try { values = await readRange(ARCHIVO, CATEGORIAS_SHEET); } catch (e) { return []; }
  if (!values.length) return [];
  const headers = values[0].map(h => String(h).trim());
  const col = headers.findIndex(h => _norm(h) === 'clientes' || _norm(h) === 'cliente');
  if (col === -1) return [];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i][col];
    if (v != null && String(v).trim() !== '' && out.indexOf(String(v).trim()) === -1) out.push(String(v).trim());
  }
  return out;
}
async function getFeriados() {
  const set = new Set();
  const props = await _propsHoja(ARCHIVO, 'Feriados');
  if (!props) return set;
  let values;
  try { values = await readRange(ARCHIVO, 'Feriados'); } catch (e) { return set; }
  const u = require('./util');
  for (let i = 1; i < (values.length||0); i++) {
    const f = u.fechaNum((values[i]||[])[0]);
    if (f) set.add(f);
  }
  return set;
}
// Marcador de última generación (celda oculta, columna O fila 1)
async function recurMarker() {
  try {
    const sheets = getSheets();
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: ARCHIVO, range: "'" + RECURRENTES_SHEET + "'!O1" });
    return ((r.data.values || [])[0] || [])[0] || '';
  } catch (e) { return ''; }
}
async function setRecurMarker(v) {
  try {
    const sheets = getSheets();
    await sheets.spreadsheets.values.update({ spreadsheetId: ARCHIVO, range: "'" + RECURRENTES_SHEET + "'!O1",
      valueInputOption: 'RAW', requestBody: { values: [[v]] } });
  } catch (e) {}
}

module.exports = { MENU, SHEETS, USERS_SHEET, FORMULA_FIELDS, AREA_ROW_FILTERS,
  AREA_PENDIENTES, ESTATUS_CERRADOS, PESTANA, ARCHIVO,
  esCerrado, esRevisado, esAdmin, getColaboradores,
  BITACORA_HEADERS, ensureBitacora, appendBitacora, readBitacora,
  RECURRENTES_SHEET, ensureRecurrentes, readRecurrentes, getClientes, getFeriados, recurMarker, setRecurMarker,
  readRange, appendRow, addRecord, updateRecord, getCategories, addCategory, getLookup,
  getSheets, signToken, verifyToken, verifyWriter, findUser, readBody };
