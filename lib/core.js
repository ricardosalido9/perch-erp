const crypto = require('crypto');
const { google } = require('googleapis');

const SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto';
const SESSION_MS = 6 * 60 * 60 * 1000; // 6 horas

// ===== Menú de áreas (barra lateral) =====
const MENU = [
  { key:'inicio',      label:'Inicio',      icon:'home' },
  { key:'dashboard',   label:'Dashboard',   icon:'grid' },
  { key:'ventas',      label:'Ventas',      icon:'tag', children:[
      { key:'ventas_registro', label:'Ventas' },
      { key:'ventas_clientes', label:'Clientes' }
  ] },
  { key:'proyectos',   label:'Proyectos',   icon:'layers', children:[
      { key:'proyectos_registro', label:'Proyectos' },
      { key:'proyectos_partidas', label:'Partidas' }
  ] },
  { key:'produccion',  label:'Producción',  icon:'tool', children:[
      { key:'prod_ordenes',  label:'Órdenes de Taller' },
      { key:'prod_materiales', label:'Materiales' }
  ] },
  { key:'compras',     label:'Compras',     icon:'cart', children:[
      { key:'compras_registro',     label:'Compras' },
      { key:'compras_proveedores',  label:'Proveedores' }
  ] },
  { key:'inventario',  label:'Catálogo',    icon:'box' },
  { key:'finanzas',    label:'Finanzas',    icon:'dollar', children:[
      { key:'fin_bancos',   label:'Bancos y Cajas' },
      { key:'fin_cxc',      label:'Cuentas por Cobrar' },
      { key:'fin_cxp',      label:'Cuentas por Pagar' },
      { key:'fin_ingresos', label:'Ingresos' },
      { key:'fin_egresos',  label:'Egresos' }
  ] }
];

// ===== Hojas conectadas (key del menú -> archivo y pestaña) =====
// Completá `id` (lo que va entre /d/ y /edit de la URL del archivo de Google Sheets)
// y `sheetName` (nombre EXACTO de la pestaña). Compartí ese archivo como Editor con
// la cuenta de servicio. Las áreas sin `id` aparecen como "por conectar".
const SHEETS = {
  // --- Ventas (submenú: Ventas + Clientes) ---
  ventas_registro: { id: '', sheetName: 'Ventas' },
  ventas_clientes: { id: '', sheetName: 'Lista de Clientes' },
  // --- Proyectos (diseño de interiores / mobiliario a medida) ---
  proyectos_registro: { id: '', sheetName: 'Proyectos' },
  proyectos_partidas: { id: '', sheetName: 'Partidas' },
  // --- Producción / Taller ---
  prod_ordenes:    { id: '', sheetName: 'Ordenes de Taller' },
  prod_materiales: { id: '', sheetName: 'Materiales' },
  // --- Compras (submenú: Compras + Proveedores) ---
  compras_registro:    { id: '', sheetName: 'Compras' },
  compras_proveedores: { id: '', sheetName: 'Lista de Proveedores' },
  // --- Catálogo de mobiliario (inventario) ---
  inventario: { id: '', sheetName: 'Catalogo' },
  // --- Finanzas (conectar cuando estén las hojas) ---
  // fin_bancos:   { id: '', sheetName: 'Bancos y Cajas' },
  // fin_cxc:      { id: '', sheetName: 'Cuentas por Cobrar' },
  // fin_cxp:      { id: '', sheetName: 'Cuentas por Pagar' },
  // fin_ingresos: { id: '', sheetName: 'Ingresos' },
  // fin_egresos:  { id: '', sheetName: 'Egresos' },
};

// Filtros de fila por área: el área solo muestra los registros que cumplen la condición.
// gt0 = el valor numérico de la columna debe ser mayor a cero.
const AREA_ROW_FILTERS = {
  // Ej: fin_cxc: { field: 'Por Cobrar', op: 'gt0' }
  // Ej: proyectos_registro: { field: 'Saldo', op: 'gt0' }
};

// Los menús desplegables se leen de una pestaña "CATEGORIAS" dentro del MISMO
// archivo de cada área. Los encabezados de esa pestaña = nombre del campo a poblar.

// Hoja de usuarios (usuario | contraseña | nombre | rol). ID en variable de entorno
// (GOOGLE_USERS_SHEET_ID) o completá el id acá.
const USERS_SHEET = { id: process.env.GOOGLE_USERS_SHEET_ID || '1jUIUIPqwU4_N0u_jvY8No1SQH07aicVNGv9_O_zz9NM', sheetName: 'Usuarios ERP' };

// ===== Google Sheets (cuenta de servicio) =====
// Opción fácil: pegar el JSON completo en GOOGLE_CREDENTIALS.
// Alternativa: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY por separado.
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

// Escribe una fila respetando las columnas calculadas (no las toca).
// rowNumber: fila real de la hoja. skipCols: índices de columnas a NO escribir.
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
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  return { ok: true };
}

// ===== Categorías (listas para los desplegables) =====
function _colLetter(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function _norm(s) { return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
// Nombre de la pestaña de categorías por área (si no está listado, usa 'CATEGORIAS').
const CATEGORIES_SHEETS = {
  ventas_registro:    'CATEGORIAS-VENTAS',
  compras_registro:   'CATEGORIAS-COMPRAS',
  proyectos_registro: 'CATEGORIAS-PROYECTOS',
  prod_ordenes:       'CATEGORIAS-PRODUCCION'
};
function _categoriesSheetFor(key) {
  const cfg = SHEETS[key];
  if (!cfg) return null;
  return { id: cfg.id, sheetName: CATEGORIES_SHEETS[key] || 'CATEGORIAS' };
}
async function getCategories(key) {
  const c = _categoriesSheetFor(key);
  if (!c) return {};
  let values;
  try { values = await readRange(c.id, c.sheetName); }
  catch (e) { return {}; } // si el archivo no tiene pestaña CATEGORIAS, sin desplegables
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
    out[h] = list;
  });
  return out;
}
async function addCategory(key, categoria, valor) {
  const c = _categoriesSheetFor(key);
  if (!c) throw new Error('Área sin hoja de categorías.');
  const sheets = getSheets();
  const values = await readRange(c.id, c.sheetName);
  const headers = (values[0] || []).map(h => String(h).trim());
  let col = -1;
  for (let i = 0; i < headers.length; i++) {
    if (_norm(headers[i]) === _norm(categoria)) { col = i; break; }
  }
  if (col === -1) throw new Error('No existe la categoría "' + categoria + '" en la hoja CATEGORIAS.');
  let row = 1;
  while (row < values.length && values[row][col] != null && String(values[row][col]).trim() !== '') row++;
  const range = "'" + c.sheetName + "'!" + _colLetter(col) + (row + 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId: c.id, range, valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[valor]] }
  });
  return { ok: true };
}

// ===== Tokens de sesión (HMAC firmado) =====
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

// Devuelve la sesión solo si el usuario puede escribir (no es lector)
function verifyWriter(token) {
  const s = verifyToken(token);
  if (!s) return null;
  const rol = String(s.rol || '').trim().toLowerCase();
  if (rol === 'lector' || rol === 'viewer' || rol === 'lectura') return null;
  return s;
}

// ===== Usuarios (contraseña en texto plano) =====
// Columnas de la hoja: usuario | contraseña | nombre | rol
async function findUser(usuario) {
  const rows = await readRange(USERS_SHEET.id, USERS_SHEET.sheetName);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').toLowerCase() === String(usuario || '').toLowerCase()) {
      return { usuario: rows[i][0], contrasena: rows[i][1], nombre: rows[i][2], rol: rows[i][3] };
    }
  }
  return null;
}

// ===== Utilidad: leer el body JSON =====
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

async function updateRow(spreadsheetId, sheetName, rowNumber, record) {
  const sheets = getSheets();
  const values = await readRange(spreadsheetId, sheetName);
  const headers = (values[0] || []).map(h => String(h));
  const rowArr = headers.map(h => (record && record[h] != null) ? record[h] : '');
  const lastCol = _colLetter(headers.length - 1);
  const range = "'" + sheetName + "'!A" + rowNumber + ":" + lastCol + rowNumber;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values: [rowArr] }
  });
  return { ok: true };
}

// Columnas calculadas por fórmula en la hoja: el ERP NO las escribe (deja que la fórmula trabaje).
const FORMULA_FIELDS = {
  ventas_registro:    ['Mes'],   // columnas calculadas por fórmula en la hoja (el ERP no las escribe)
  compras_registro:   ['Mes'],
  proyectos_registro: ['Mes', 'Avance'],
  prod_ordenes:       ['Mes']
};

// ===== Alta y edición de registros (respetando columnas calculadas) =====
function _skipCols(key, headers) {
  const skip = new Set();
  (FORMULA_FIELDS[key] || []).forEach(f => {
    const i = headers.findIndex(h => _norm(h) === _norm(f));
    if (i !== -1) skip.add(i);
  });
  return skip;
}
async function addRecord(key, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Esta área no está conectada.');
  const values = await readRange(cfg.id, cfg.sheetName);
  const headers = (values[0] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  const rowArr = headers.map(h => (record && record[h] != null) ? record[h] : '');
  if (skip.size === 0) {           // sin fórmulas: append normal
    await appendRow(cfg.id, cfg.sheetName, rowArr);
    return { ok: true };
  }
  // Con fórmulas: busca la primera fila realmente vacía y escribe sin tocar las calculadas
  const dataCols = headers.map((_, i) => i).filter(i => !skip.has(i));
  let target = values.length + 1;  // por defecto, después de la última fila con datos
  for (let r = 1; r < values.length; r++) {
    const empty = dataCols.every(c => values[r][c] == null || String(values[r][c]).trim() === '');
    if (empty) { target = r + 1; break; }
  }
  await writeRowSkipping(cfg.id, cfg.sheetName, target, rowArr, skip);
  return { ok: true };
}
async function updateRecord(key, rowNumber, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Esta área no está conectada.');
  const values = await readRange(cfg.id, cfg.sheetName);
  const headers = (values[0] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  const rowArr = headers.map(h => (record && record[h] != null) ? record[h] : '');
  await writeRowSkipping(cfg.id, cfg.sheetName, Number(rowNumber), rowArr, skip);
  return { ok: true };
}

// ===== Tablas de referencia (autocompletado al elegir una opción) =====
// Por área: hoja del mismo archivo, columna clave y columnas que se autocompletan.
// Autocompletados por área. Cada área puede tener VARIOS (lista).
// keyField = campo del formulario que se vuelve desplegable.
// keyAliases = nombre(s) de la columna en la hoja fuente que llena el desplegable.
// id = (opcional) archivo distinto al del área. fills = campos que se autocompletan.
// filter = (opcional) solo incluye filas disponibles.
const LOOKUPS = {
  ventas_registro: [
    {
      sheetName: 'Catalogo',                    // mismo archivo que Ventas (catálogo de mobiliario)
      keyField: 'Producto',
      keyAliases: ['Producto', 'Nombre'],
      fills: ['Categoría', 'Colección', 'Material', 'Acabado', 'Medidas', 'Costo Total USD'],
      // Disponibilidad: columna "Disponible" (1 = disponible, 0 = vendido/agotado)
      filter: { field: 'Disponible', gt0: true }
    },
    {
      sheetName: 'Lista de Clientes',           // completá el id del archivo de clientes en SHEETS.ventas_clientes
      keyField: 'Cliente',                      // campo del formulario de Ventas
      keyAliases: ['Nombre/Razón Social', 'Cliente'],
      fills: []                                 // solo desplegable, sin autocompletar otros campos
    }
  ],
  proyectos_registro: [
    {
      sheetName: 'Lista de Clientes',
      keyField: 'Cliente',
      keyAliases: ['Nombre/Razón Social', 'Cliente'],
      fills: []
    }
  ],
  compras_registro: [
    {
      sheetName: 'Lista de Proveedores',        // completá el id en SHEETS.compras_proveedores
      keyField: 'Proveedor',                    // campo del formulario de Compras
      keyAliases: ['Nombre/Razón Social', 'Proveedor'],
      fills: [],
      // Solo proveedores activos
      filter: { field: ['Status', 'Estatus', 'Estado'], equalsAny: ['ACTIVO'] }
    }
  ]
};

async function _resolveLookup(cfgArea, lk) {
  const srcId = lk.id || cfgArea.id;   // por defecto, misma hoja del área; lk.id permite otro archivo
  let values;
  try { values = await readRange(srcId, lk.sheetName); }
  catch (e) { return null; }
  if (!values.length) return null;
  const headers = values[0].map(h => String(h).trim());
  const findCol = (names) => {
    const list = Array.isArray(names) ? names : [names];
    for (const a of list) {
      const i = headers.findIndex(h => _norm(h) === _norm(a));
      if (i !== -1) return i;
    }
    return -1;
  };
  const keyCol = findCol(lk.keyAliases || [lk.keyField]);
  if (keyCol === -1) return null;

  // Filtro de disponibilidad (opcional)
  const flt = lk.filter || null;
  const filterCol = (flt && flt.field) ? findCol(flt.field) : -1;
  function passes(row) {
    if (!flt || filterCol === -1) return true;
    const v = String(row[filterCol] == null ? '' : row[filterCol]).trim();
    if (flt.notEmpty) return v !== '';
    if (flt.gt0) { const n = parseFloat(v.replace(/[^0-9.,\-]/g, '').replace(/,/g, '')); return !isNaN(n) && n > 0; }
    if (flt.equalsAny) return flt.equalsAny.some(x => _norm(x) === _norm(v));
    if (flt.notIn) return !flt.notIn.some(x => _norm(x) === _norm(v));
    return true;
  }

  const fills = lk.fills || [];
  const options = [];
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!passes(row)) continue;
    const name = String(row[keyCol] == null ? '' : row[keyCol]).trim();
    if (!name) continue;
    if (options.indexOf(name) === -1) options.push(name);
    const rec = {};
    fills.forEach(f => {
      const c = findCol(f);
      if (c !== -1) rec[f] = String(row[c] == null ? '' : row[c]).trim();
    });
    map[name] = rec;
  }
  options.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  return { keyField: lk.keyField, fills, options, map };
}

// Devuelve TODOS los lookups de un área (lista, ya resueltos).
async function getLookups(key) {
  const cfgArea = SHEETS[key];
  const defs = LOOKUPS[key];
  if (!cfgArea || !defs) return [];
  const list = Array.isArray(defs) ? defs : [defs];
  const out = [];
  for (const lk of list) {
    const r = await _resolveLookup(cfgArea, lk);
    if (r && r.options && r.options.length) out.push(r);
  }
  return out;
}

module.exports = { MENU, SHEETS, USERS_SHEET, FORMULA_FIELDS, AREA_ROW_FILTERS, readRange, appendRow, updateRow,
  addRecord, updateRecord, getCategories, addCategory, getLookups,
  signToken, verifyToken, verifyWriter, findUser, readBody };
