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
  ventas_registro: { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'VENTAS' },
  ventas_clientes: { id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM', sheetName: 'Lista de Clientes' },
  // --- Proyectos (diseño de interiores / mobiliario a medida) ---
  proyectos_registro: { id: '', sheetName: 'Proyectos' },
  proyectos_partidas: { id: '', sheetName: 'Partidas' },
  // --- Producción / Taller ---
  prod_ordenes:    { id: '', sheetName: 'Ordenes de Taller' },
  prod_materiales: { id: '', sheetName: 'Materiales' },
  // --- Compras (submenú: Compras + Proveedores) ---
  compras_registro:    { id: '', sheetName: 'Compras' },
  compras_proveedores: { id: '1zf_j6V-Wr_a7-0MGyntaPPvYRo-tPL4BSmtKOlyZJe8', sheetName: 'Lista de Proveedores' },
  // --- Catálogo de mobiliario (inventario) ---
  inventario: { id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA', sheetName: 'Lista de Precios 2026' },
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
  ventas_registro:     'CATEGORIAS-VENTAS',
  compras_registro:    'CATEGORIAS-COMPRAS',
  compras_proveedores: 'CATEGORIAS',
  proyectos_registro:  'CATEGORIAS-PROYECTOS',
  prod_ordenes:        'CATEGORIAS-PRODUCCION'
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
  // Columnas calculadas por fórmula en la hoja: el panel NO las escribe (las deja intactas).
  ventas_registro: ['Trimestre', 'Año', 'Mes',
    'Precio sin IVA', 'Impuestos', 'Total Pedido',
    'Envio sin Impuestos', 'Total con envío', 'Total con envio sin impuestos',
    'Costo Unitario', 'Costo total', 'Costo Envío', 'Utilidad', 'Utilidad Final'],
  compras_registro:   ['Mes'],
  proyectos_registro: ['Mes', 'Avance'],
  prod_ordenes:       ['Mes']
};

// ===== Valores por defecto al dar de alta (campos que no aparecen en el formulario) =====
const DEFAULTS = {
  ventas_registro: { 'Status': 'Por Entregar' }
};

// ===== Folio automático (No. de Referencia) =====
// Formato: LETRA_MES + consecutivo del mes + "-" + año de 2 dígitos.  Ej: enero -> E1-26, E2-26 ; mayo -> MY1-26
const MES_LETRA = { 1:'E', 2:'F', 3:'M', 4:'A', 5:'MY', 6:'J', 7:'JL', 8:'AG', 9:'S', 10:'O', 11:'N', 12:'D' };
const AUTO_REF = {
  ventas_registro: { field: 'No. de Referencia', dateField: 'Fecha del Cierre' }
};
const _MESES_REF = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,
  septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12 };
function _mesAnioDe(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return { mes: +m[2], anio: +m[1] };
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) return { mes: +m[2], anio: +m[3] };
  if ((m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?\s+(?:de\s+)?(\d{4})$/)) && _MESES_REF[m[2]])
    return { mes: _MESES_REF[m[2]], anio: +m[3] };
  const d = new Date();                         // sin fecha válida: usa la de hoy
  return { mes: d.getMonth() + 1, anio: d.getFullYear() };
}
function _generarFolio(values, headers, refField, record, dateField) {
  const { mes, anio } = _mesAnioDe(record[dateField]);
  const letra = MES_LETRA[mes] || 'X';
  const yy = String(anio % 100).padStart(2, '0');
  const iRef = headers.findIndex(h => String(h).trim().toLowerCase() === String(refField).trim().toLowerCase());
  let maxSeq = 0;
  if (iRef !== -1) {
    for (let r = 1; r < values.length; r++) {
      const val = String(values[r][iRef] == null ? '' : values[r][iRef]).trim().toUpperCase();
      const mm = val.match(/^([A-Z]+)(\d+)-(\d{2})$/);
      if (mm && mm[1] === letra && mm[3] === yy) { const n = +mm[2]; if (n > maxSeq) maxSeq = n; }
    }
  }
  return letra + (maxSeq + 1) + '-' + yy;
}

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
  record = Object.assign({}, record || {});

  // Valores por defecto (solo si el campo llegó vacío)
  const defs = DEFAULTS[key] || {};
  Object.keys(defs).forEach(f => {
    if (record[f] == null || String(record[f]).trim() === '') record[f] = defs[f];
  });

  // Folio automático (No. de Referencia)
  const ar = AUTO_REF[key];
  if (ar) {
    const iRef = headers.findIndex(h => String(h).trim().toLowerCase() === String(ar.field).trim().toLowerCase());
    if (iRef !== -1) {
      const actual = headers[iRef];
      if (record[actual] == null || String(record[actual]).trim() === '') {
        record[actual] = _generarFolio(values, headers, ar.field, record, ar.dateField);
      }
    }
  }

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
      // Cascada de producto: eliges Producto -> Material -> Material 2 (si aplica)
      // y se autocompletan Tipo de Producto y Precio Unitario desde el catálogo.
      type: 'cascade',
      id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA',   // archivo "Lista de Precios 2026"
      sheetName: 'Lista de Precios 2026',
      levels: ['Producto', 'Material', 'Material Extra'],  // desplegables encadenados (en la hoja de Ventas)
      fills: ['Tipo de Producto', 'Precio Unitario', 'Costo Unitario'],
      // Opcional: si el catálogo trae "Disponible", solo ofrece variantes disponibles.
      filter: { field: 'Disponible', gt0: true }
    },
    {
      id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM',  // archivo "Lista de Clientes"
      sheetName: 'Lista de Clientes',
      keyField: 'Cliente',                      // campo del formulario de Ventas
      keyAliases: ['Nombre/Razón Social', 'Nombre Comercial', 'Razón Social', 'Cliente'],
      // Al elegir el cliente, se autocompletan estos campos de la venta desde la Lista de Clientes:
      fills: [
        { from: ['Teléfono', 'Telefono', 'Tel', 'Celular', 'Teléfono 1', 'Teléfono principal'], to: 'Telefono' },
        { from: ['Dirección de envío', 'Direccion de envio', 'Dirección', 'Direccion', 'Domicilio',
                 'Dirección de Envío', 'Dirección completa', 'Dirección de entrega'], to: 'Direccion de envio' },
        { from: ['Despacho'], to: 'Despacho' }
      ]
    }
  ],
  proyectos_registro: [
    {
      id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM',  // archivo "Lista de Clientes"
      sheetName: 'Lista de Clientes',
      keyField: 'Cliente',
      keyAliases: ['Nombre Comercial', 'Nombre/Razón Social', 'Razón Social', 'Cliente'],
      fills: []
    }
  ],
  compras_registro: [
    {
      sheetName: 'Lista de Proveedores',        // completá el id en SHEETS.compras_proveedores
      keyField: 'Proveedor',                    // campo del formulario de Compras
      keyAliases: ['Nombre Comercial', 'Razón Social', 'Nombre/Razón Social', 'Proveedor'],
      fills: [],
      // Solo proveedores activos (compara sin distinguir mayúsculas/acentos)
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
      // f puede ser un string (mismo nombre en ambas hojas) o { from, to }:
      //   from = columna(s) posibles en la hoja de origen (Clientes/Proveedores)
      //   to   = nombre del campo destino en el formulario (Ventas)
      const target = (typeof f === 'string') ? f : f.to;
      const source = (typeof f === 'string') ? f : f.from;
      const c = findCol(source);
      if (c !== -1 && target) rec[target] = String(row[c] == null ? '' : row[c]).trim();
    });
    map[name] = rec;
  }
  options.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  // Normaliza fills a la lista de destinos para que el frontend sepa qué campos llenar.
  const fillTargets = fills.map(f => (typeof f === 'string') ? f : f.to).filter(Boolean);
  return { keyField: lk.keyField, fills: fillTargets, options, map };
}

// Devuelve TODOS los lookups de un área (lista, ya resueltos).
// Resuelve una cascada: devuelve todas las variantes (filas) con sus niveles y campos a autocompletar.
function _esVacioNivel(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '' || s === 'na' || s === 'n/a' || s === '-' || s === '--' ||
         s === 'ninguno' || s === 'ninguna' || s === 'no aplica' || s === 'none';
}
async function _resolveCascade(cfgArea, lk) {
  const srcId = lk.id || cfgArea.id;
  let values;
  try { values = await readRange(srcId, lk.sheetName); }
  catch (e) { return null; }
  if (!values.length) return null;
  const headers = values[0].map(h => String(h).trim());
  const findCol = (name) => headers.findIndex(h => _norm(h) === _norm(name));

  const levelCols = (lk.levels || []).map(l => ({ name: l, col: findCol(l) })).filter(x => x.col !== -1);
  if (!levelCols.length) return null;
  const fillCols = (lk.fills || []).map(f => ({ name: f, col: findCol(f) })).filter(x => x.col !== -1);

  const flt = lk.filter || null;
  const filterCol = (flt && flt.field) ? findCol(Array.isArray(flt.field) ? flt.field[0] : flt.field) : -1;
  function passes(row) {
    if (!flt || filterCol === -1) return true;
    const v = String(row[filterCol] == null ? '' : row[filterCol]).trim();
    if (flt.gt0) { const n = parseFloat(v.replace(/[^0-9.,\-]/g, '').replace(/,/g, '')); return !isNaN(n) && n > 0; }
    if (flt.notEmpty) return v !== '';
    return true;
  }

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!passes(row)) continue;
    const rec = {};
    let anyLevel = false;
    levelCols.forEach(lc => {
      let v = String(row[lc.col] == null ? '' : row[lc.col]).trim();
      if (_esVacioNivel(v)) v = '';               // "NA", "N/A", "-", "Ninguno" = sin ese eje
      rec[lc.name] = v; if (v) anyLevel = true;
    });
    if (!anyLevel) continue;                       // fila sin producto: se ignora
    fillCols.forEach(fc => { rec[fc.name] = String(row[fc.col] == null ? '' : row[fc.col]).trim(); });
    rows.push(rec);
  }
  if (!rows.length) return null;
  return {
    type: 'cascade',
    keyField: levelCols[0].name,                   // el primer nivel es el campo "clave" (Producto)
    levels: levelCols.map(x => x.name),
    fills: fillCols.map(x => x.name),
    rows: rows
  };
}

async function getLookups(key) {
  const cfgArea = SHEETS[key];
  const defs = LOOKUPS[key];
  if (!cfgArea || !defs) return [];
  const list = Array.isArray(defs) ? defs : [defs];
  const out = [];
  for (const lk of list) {
    if (lk.type === 'cascade') {
      const c = await _resolveCascade(cfgArea, lk);
      if (c && c.rows && c.rows.length) out.push(c);
      continue;
    }
    const r = await _resolveLookup(cfgArea, lk);
    if (r && r.options && r.options.length) out.push(r);
  }
  return out;
}

module.exports = { MENU, SHEETS, USERS_SHEET, FORMULA_FIELDS, AREA_ROW_FILTERS, readRange, appendRow, updateRow,
  addRecord, updateRecord, getCategories, addCategory, getLookups,
  signToken, verifyToken, verifyWriter, findUser, readBody };
