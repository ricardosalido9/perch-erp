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
      { key:'cotizaciones',    label:'Cotizaciones' },
      { key:'leads',           label:'Leads' },
      { key:'showroom',        label:'Showroom' },
      { key:'expediente',      label:'Clientes' },
      { key:'ventas_clientes', label:'Lista de clientes' }
  ] },
  { key:'produccion',  label:'Producción',  icon:'tool', children:[
      { key:'op_stock',      label:'Stock' },
      { key:'prov_pedidos',  label:'Pedidos a proveedores' },
      { key:'prov_entradas', label:'Entradas' },
      { key:'prov_salidas',  label:'Salidas' },
      { key:'proveedores',   label:'Estado de cuenta proveedores' },
      { key:'inv_prov',      label:'Qué tiene cada proveedor' },
      { key:'costos',        label:'Comparativo de costos' },
      { key:'op_revisar',    label:'Revisar' },
      { key:'conciliacion',  label:'Gastos vs Egresos' },
      { key:'op_envios',     label:'Envíos' },
      { key:'prov_revision', label:'Discrepancias por revisar' }
  ] },

  { key:'inventario',  label:'Catálogo',    icon:'box' },
  { key:'funnel',      label:'Funnel de ventas', icon:'layers' },
  { key:'facturacion', label:'Facturación', icon:'receipt', children:[
      { key:'fac_complementos', label:'Complementos de pago' },
      { key:'fac_proveedores',  label:'Facturas de proveedores' },
      { key:'fac_impuestos',    label:'Impuestos' }
  ] },
  { key:'rh', label:'Nómina y RH', icon:'users', children:[
      { key:'rh_personal', label:'Personal' },
      { key:'rh_nomina',   label:'Nómina' }
  ] },
  { key:'finanzas',    label:'Finanzas',    icon:'dollar', children:[
      { key:'fin_bancos',   label:'Bancos y Cajas' },
      { key:'fin_cxc',      label:'Cuentas por Cobrar' },
      { key:'fin_cxp',      label:'Cuentas por Pagar' },
      { key:'fin_ingresos', label:'Ingresos' },
      { key:'fin_egresos',  label:'Egresos' },
      { key:'fin_efectivo', label:'Efectivo' },
      { key:'fin_gastos_op',label:'Gastos operativos' },
      { key:'fin_estados',  label:'Estados financieros' }
  ] }
];

// ===== Hojas conectadas (key del menú -> archivo y pestaña) =====
// Completá `id` (lo que va entre /d/ y /edit de la URL del archivo de Google Sheets)
// y `sheetName` (nombre EXACTO de la pestaña). Compartí ese archivo como Editor con
// la cuenta de servicio. Las áreas sin `id` aparecen como "por conectar".
const SHEETS = {
  // --- Ventas (submenú: Ventas + Clientes) ---
  ventas_registro: { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'VENTAS' },
  // Leads: quien escribe pero todavía no pide cotización. Captura mínima a propósito.
  leads:           { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'LEADS' },
  // Showroom: la visita existe por sí sola, venga o no de una cotización
  showroom:        { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'SHOWROOM' },
  // Cotizaciones: MISMA estructura que VENTAS (duplicar la pestaña y renombrarla)
  cotizaciones:    { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'COTIZACIONES' },
  ventas_clientes: { id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM', sheetName: 'Lista de Clientes' },
  // --- Proyectos: desactivado por ahora (quitado del menú) ---
  // proyectos_registro: { id: '', sheetName: 'Proyectos' },
  // proyectos_partidas: { id: '', sheetName: 'Partidas' },
  // --- Producción / Taller ---
  prod_ordenes:    { id: '', sheetName: 'Ordenes de Taller' },
  prod_materiales: { id: '', sheetName: 'Materiales' },
  // --- Compras (submenú: Compras + Proveedores) ---
  compras_registro:    { id: '', sheetName: 'Compras' },
  compras_proveedores: { id: '1zf_j6V-Wr_a7-0MGyntaPPvYRo-tPL4BSmtKOlyZJe8', sheetName: 'Lista de Proveedores' },
  // --- Catálogo de mobiliario (inventario) ---
  // La fila 1 es un título; los encabezados reales están en la FILA 2.
  // sheetNamePattern: cada año usa automáticamente la pestaña de ese año ("Lista de Precios 2027", etc.).
  // Si la del año en curso todavía no existe, usa la más reciente que sí exista.
  inventario: { id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA', sheetName: 'Lista de Precios 2026',
                sheetNamePattern: 'Lista de Precios {AAAA}', headerRow: 2 },
  // --- Marketing (misma base de Ventas, otra pestaña; se usa en el Dashboard) ---
  marketing: { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'Marketing' },
  // --- Metas mensuales (se usa en el Dashboard) ---
  metas: { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'Metas' },
  // --- Funnel de ventas / cotizaciones ---
  // La fila 1 de esta pestaña trae una celda suelta ("q"); los encabezados reales están en la FILA 2.
  funnel: { id: '18b4A-fHoJtSio0cmy3cBaYbWJQ3zHlQAmSzGiQuhk3A', sheetName: 'Montse 2026', headerRow: 2 },
  // --- Finanzas (conectar cuando estén las hojas) ---
  // fin_bancos:   { id: '', sheetName: 'Bancos y Cajas' },
  fin_cxc:      { id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU', sheetName: 'CxC' },
  // fin_cxp:      { id: '', sheetName: 'Cuentas por Pagar' },
  fin_ingresos: { id: '1cacFpLcoSwTnWNFc6LgRo1Fb3qJa-qZl0HYhpExUWO4', sheetName: 'INGRESOS' },
  // Ingresos y Egresos viven en el archivo histórico de finanzas
  fin_egresos:  { id: '1cacFpLcoSwTnWNFc6LgRo1Fb3qJa-qZl0HYhpExUWO4', sheetName: 'EGRESOS' },

  // ===== Producción =====
  // TODO producción en el archivo consolidado: pedidos, entradas, salidas, stock y
  // revisar. Una sola fuente, para que una salida registrada desde el ERP se vea en
  // el mismo archivo donde se capturó el pedido.
  prov_pedidos:  { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Pedidos a Proveedores' },
  prov_entradas: { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Entradas de Inventario' },
  prov_salidas:  { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Salidas de Inventario' },
  op_stock:      { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Stock' },
  op_revisar:    { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Revisar' },
  // Envíos: qué se mandó, con quién, a dónde y cuánto costó
  op_envios:     { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Envios' },

  // Revisión manual de estados de cuenta: la hoja que lleva Vale a mano.
  // Vive en el CONSOLIDADO, no en Operación 2026.
  prov_revision: { id: '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc', sheetName: 'Mi hoja' },

  // ===== Facturación e impuestos =====
  // Pendientes de ligar: pega el id del archivo cuando existan las pestañas.
  fac_complementos: { id: '', sheetName: 'Complementos de Pago' },
  fac_proveedores:  { id: '', sheetName: 'Facturas de Proveedores' },
  fac_impuestos:    { id: '', sheetName: 'Impuestos' },

  // ===== Finanzas =====
  fin_efectivo:  { id: '', sheetName: 'Efectivo' },
  fin_gastos_op: { id: '', sheetName: 'Gastos Operativos' },
  fin_estados:   { id: '', sheetName: 'Estados Financieros' },

  // ===== Nómina y RH =====
  rh_nomina:     { id: '', sheetName: 'Nomina' },
  rh_personal:   { id: '', sheetName: 'Personal' },
};

// Columnas que conviene que tenga cada pestaña nueva. Se muestran en pantalla
// mientras el área no esté ligada a un archivo.
const COLUMNAS_SUGERIDAS = {
  op_envios: ['Fecha', 'Mes', 'Año', 'Pedido', 'Cliente', 'Status',
              'Fecha Estimada de Entrega', 'Fecha de Entrega Real',
              'Paqueteria', 'Origen', 'Destino', 'Ciudad', 'Zona', 'Piezas',
              'Costo del Envío', 'Costo del Envío c / IVA',
              'Cobrado al Cliente', 'Utilidad del Envío', '% Margen del Envío',
              'Guía', 'Ticket de Remisión', 'Quién lo paga', 'Comentarios'],
  fac_complementos: ['Fecha', 'No. de Referencia', 'Cliente', 'Factura', 'UUID de la factura',
                     'Monto del pago', 'Fecha del pago', 'Forma de pago', 'Complemento emitido',
                     'UUID del complemento', 'Fecha del complemento', 'Comentarios'],
  fac_proveedores:  ['Fecha', 'Proveedor', 'Pedido', 'Concepto', 'Monto', 'Requiere factura',
                     'Factura recibida', 'UUID', 'Fecha de la factura', 'Link', 'Comentarios'],
  fac_impuestos:    ['Mes', 'Año', 'Impuesto', 'Base', 'Tasa', 'A cargo', 'A favor',
                     'Fecha de pago', 'Pagado', 'Línea de captura', 'Comentarios'],
  fin_efectivo:     ['Fecha', 'Mes', 'Tipo', 'Concepto', 'Descripción', 'Monto',
                     'Quién lo recibió', 'Cliente o Proveedor', 'Folio', 'Pasado a Ingresos/Egresos',
                     'Comentarios'],
  fin_gastos_op:    ['Fecha', 'Mes', 'Año', 'Categoría', 'Subcategoría', 'Concepto', 'Proveedor',
                     'Monto', 'IVA', 'Total', 'Forma de pago', 'Cuenta', 'Factura', 'Comentarios'],
  fin_estados:      ['Concepto', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                     'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre', 'Total'],
  rh_personal:      ['Nombre', 'Puesto', 'Área', 'Fecha de ingreso', 'Tipo de contrato',
                     'Sueldo bruto', 'Sueldo neto', 'Forma de pago', 'Cuenta', 'RFC', 'CURP',
                     'NSS', 'Status', 'Comentarios'],
  rh_nomina:        ['Periodo', 'Fecha de pago', 'Nombre', 'Puesto', 'Sueldo bruto', 'Deducciones',
                     'Sueldo neto', 'IMSS', 'ISR', 'Bonos', 'Total pagado', 'Cuenta', 'Comentarios']
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
// Cliente de Drive (para subir la CSF y crear la carpeta del pedido).
// Requiere que la carpeta madre esté compartida como Editor con la cuenta de servicio.
function getDrive() {
  const c = getCredentials();
  const auth = new google.auth.JWT(c.email, null, c.key, ['https://www.googleapis.com/auth/drive']);
  return google.drive({ version: 'v3', auth });
}
function getSheets() {
  const c = getCredentials();
  const auth = new google.auth.JWT(c.email, null, c.key, ['https://www.googleapis.com/auth/spreadsheets']);
  return google.sheets({ version: 'v4', auth });
}
// ===== Pestañas por año (ej. "Lista de Precios 2026" -> "Lista de Precios 2027") =====
const _tabsCache = {};
async function listTabs(spreadsheetId) {
  if (_tabsCache[spreadsheetId]) return _tabsCache[spreadsheetId];
  const sheets = getSheets();
  const r = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const titles = (r.data.sheets || []).map(x => x.properties.title);
  _tabsCache[spreadsheetId] = titles;
  return titles;
}
const _resolvedCache = {};
// Devuelve el nombre real de la pestaña. Si la config trae sheetNamePattern con {AAAA},
// busca la del año en curso; si no existe, la del año más reciente disponible.
async function resolveSheetName(cfg) {
  if (!cfg) return null;
  if (!cfg.sheetNamePattern || !cfg.id) return cfg.sheetName;
  const ck = cfg.id + '|' + cfg.sheetNamePattern;
  if (_resolvedCache[ck]) return _resolvedCache[ck];
  let titles;
  try { titles = await listTabs(cfg.id); }
  catch (e) { return cfg.sheetName; }                       // sin permisos para listar: usa la fija
  const esc = cfg.sheetNamePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('^' + esc.replace('\\{AAAA\\}', '(\\d{4})') + '$', 'i');
  const anios = [];
  titles.forEach(t => { const m = rx.exec(String(t).trim()); if (m) anios.push({ anio: +m[1], title: t }); });
  if (!anios.length) return cfg.sheetName;
  const hoy = new Date().getFullYear();
  const exacto = anios.filter(a => a.anio === hoy)[0];
  const previos = anios.filter(a => a.anio <= hoy).sort((a, b) => b.anio - a.anio);
  const elegido = exacto || previos[0] || anios.sort((a, b) => b.anio - a.anio)[0];
  _resolvedCache[ck] = elegido.title;
  return elegido.title;
}
// Config de un área con la pestaña ya resuelta.
async function areaCfg(key) {
  const cfg = SHEETS[key];
  if (!cfg) return null;
  return { id: cfg.id, sheetName: await resolveSheetName(cfg), headerRow: cfg.headerRow || 1 };
}

async function readRange(spreadsheetId, sheetName) {
  const sheets = getSheets();
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'" + sheetName + "'" });
    return r.data.values || [];
  } catch (e) {
    // La pestaña puede estar escrita distinto (CXC vs CxC, espacios de más...): se busca el nombre real.
    let real = null;
    try {
      const titles = await listTabs(spreadsheetId);
      real = titles.filter(t => _norm(t) === _norm(sheetName))[0] || null;
    } catch (e2) { real = null; }
    if (!real || real === sheetName) {
      // Se dice cuáles pestañas SÍ existen: es lo que resuelve el problema en un vistazo
      let existentes = [];
      try { existentes = await listTabs(spreadsheetId); } catch (e3) { existentes = []; }
      const err = new Error(
        'No se encontró la pestaña "' + sheetName + '" en ese archivo.' +
        (existentes.length ? ' Las que hay son: ' + existentes.join(' · ') : ''));
      err.pestanas = existentes;
      throw err;
    }
    const r2 = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'" + real + "'" });
    return r2.data.values || [];
  }
}
async function appendRow(spreadsheetId, sheetName, row) {
  const sheets = getSheets();
  const r = await sheets.spreadsheets.values.append({
    spreadsheetId, range: "'" + sheetName + "'",
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
  // "Hoja'!A57:Z57" -> 57 (para saber en qué fila quedó y poder copiarle las fórmulas)
  const rango = (r.data && r.data.updates && r.data.updates.updatedRange) || '';
  const m = rango.match(/![A-Z]+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ===== Fórmulas de la hoja =====
// Google Sheets NO continúa solo las fórmulas cuando una fila se escribe por API.
// Por eso, después de agregar una fila, se copian las fórmulas de la fila anterior
// (con PASTE_FORMULA, que ajusta las referencias) SOLO en las columnas calculadas.
const _sheetIdCache = {};
async function _sheetIdDe(spreadsheetId, sheetName) {
  const ck = spreadsheetId + '|' + sheetName;
  if (_sheetIdCache[ck] != null) return _sheetIdCache[ck];
  const sheets = getSheets();
  const r = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  let id = null;
  (r.data.sheets || []).forEach(x => {
    if (_norm(x.properties.title) === _norm(sheetName)) id = x.properties.sheetId;
  });
  _sheetIdCache[ck] = id;
  return id;
}
// La cuadrícula de una hoja tiene un número fijo de filas. Escribir más allá del límite
// falla con "exceeds grid limits", así que primero se agregan las filas que hagan falta.
const _gridCache = {};
async function _asegurarFilas(spreadsheetId, sheetName, filaNecesaria) {
  const ck = spreadsheetId + '|' + _norm(sheetName);
  const sheets = getSheets();
  if (_gridCache[ck] == null) {
    const r = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title,gridProperties)' });
    (r.data.sheets || []).forEach(x => {
      if (_norm(x.properties.title) === _norm(sheetName)) {
        _gridCache[ck] = { sheetId: x.properties.sheetId, filas: x.properties.gridProperties.rowCount || 0 };
      }
    });
  }
  const g = _gridCache[ck];
  if (!g || filaNecesaria <= g.filas) return true;
  const faltan = (filaNecesaria - g.filas) + 50;      // margen para las próximas altas
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ appendDimension: { sheetId: g.sheetId, dimension: 'ROWS', length: faltan } }] }
  });
  g.filas += faltan;
  return true;
}

// Busca hacia arriba la fila más cercana que realmente tenga fórmulas en esas columnas.
// (Si la fila de arriba quedó vacía, copiar de ahí no serviría de nada.)
async function _filaFuenteFormulas(spreadsheetId, sheetName, skipCols, antesDe, hr) {
  const sheets = getSheets();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId, range: "'" + sheetName + "'", valueRenderOption: 'FORMULA'
  });
  const vals = r.data.values || [];
  const cols = Array.from(skipCols);
  let best = null, bestN = 0;
  const desde = Math.min(antesDe - 1, vals.length);
  for (let i = desde - 1; i >= (hr || 1); i--) {
    const fila = vals[i] || [];
    let n = 0;
    cols.forEach(c => { const v = String(fila[c] == null ? '' : fila[c]); if (v.charAt(0) === '=') n++; });
    if (n > bestN) { bestN = n; best = i + 1; }
    if (bestN === cols.length) break;         // fila completa: no hace falta seguir buscando
  }
  return best;
}

// skipCols: Set con los índices de las columnas calculadas. srcRow/dstRow son filas reales (1-based).
async function copiarFormulas(spreadsheetId, sheetName, srcRow, dstRow, skipCols) {
  if (!skipCols || !skipCols.size || !srcRow || !dstRow || srcRow >= dstRow) return { ok: false };
  const sheetId = await _sheetIdDe(spreadsheetId, sheetName);
  if (sheetId == null) return { ok: false };
  // Rangos contiguos de columnas calculadas (una petición por bloque)
  const cols = Array.from(skipCols).sort((a, b) => a - b);
  const bloques = [];
  let ini = cols[0], prev = cols[0];
  for (let i = 1; i < cols.length; i++) {
    if (cols[i] === prev + 1) { prev = cols[i]; continue; }
    bloques.push([ini, prev]); ini = cols[i]; prev = cols[i];
  }
  bloques.push([ini, prev]);
  const requests = bloques.map(b => ({
    copyPaste: {
      source:      { sheetId, startRowIndex: srcRow - 1, endRowIndex: srcRow, startColumnIndex: b[0], endColumnIndex: b[1] + 1 },
      destination: { sheetId, startRowIndex: dstRow - 1, endRowIndex: dstRow, startColumnIndex: b[0], endColumnIndex: b[1] + 1 },
      pasteType: 'PASTE_FORMULA'
    }
  }));
  const sheets = getSheets();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  return { ok: true, bloques: bloques.length };
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
// Fila de encabezados de un área (por defecto la 1). Índice 0-based dentro de values.
function _hrIdx(cfg) { return (cfg && cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0; }
function _norm(s) { return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
// Nombre de la pestaña de categorías por área (si no está listado, usa 'CATEGORIAS').
const CATEGORIES_SHEETS = {
  // Las respuestas de marketing salen de la pestaña "Categorías" del Dashboard Comercial
  ventas_registro:     'Categorías',
  cotizaciones:        'Categorías',
  leads:               'Categorías',
  showroom:            'Categorías',
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
// Las columnas se localizan por nombre: así no importa si se agrega Correo en medio.
async function findUser(usuario) {
  const rows = await readRange(USERS_SHEET.id, USERS_SHEET.sheetName);
  if (!rows.length) return null;
  const head = (rows[0] || []).map(h => _norm(h));
  const idx = (...nombres) => {
    for (const n of nombres) {
      const i = head.indexOf(_norm(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  const iU = idx('Usuario', 'User'), iC = idx('Contraseña', 'Contrasena', 'Password'),
        iN = idx('Nombre'), iR = idx('Rol', 'Perfil'), iM = idx('Correo', 'Email');
  for (let i = 1; i < rows.length; i++) {
    const f = rows[i] || [];
    const u = String(f[iU !== -1 ? iU : 0] || '');
    if (u.toLowerCase() !== String(usuario || '').toLowerCase()) continue;
    return {
      usuario: u,
      contrasena: f[iC !== -1 ? iC : 1],
      nombre: f[iN !== -1 ? iN : 2],
      correo: iM !== -1 ? f[iM] : '',
      rol: f[iR !== -1 ? iR : 3]
    };
  }
  return null;
}

// ===== Qué ve cada rol =====
// Admin ve todo. Los demás solo las áreas listadas.
const PERMISOS = {
  comercial: {
    menus: ['inicio', 'dashboard', 'ventas', 'finanzas'],
    areas: ['inicio', 'dashboard', 'ventas_registro', 'cotizaciones', 'leads', 'showroom',
            'expediente', 'ventas_clientes', 'fin_cxc', 'marketing', 'metas', 'inventario'],
    // No ve utilidad ni costos: son columnas de la hoja de ventas
    ocultarColumnas: ['Costo Unitario', 'Costo total', 'Costo Total', 'Costo real',
                      'Utilidad', '% Utilidad', 'Margen', 'Costos Total', 'Costo Envío']
  },
  operativo: {
    menus: ['produccion'],
    areas: ['prov_pedidos', 'prov_entradas', 'prov_salidas', 'op_stock', 'op_revisar',
            'proveedores', 'inv_prov', 'inventario'],
    ocultarColumnas: []
  }
};
function permisosDe(rol) {
  const r = String(rol || '').trim().toLowerCase();
  if (!r || r === 'admin' || r === 'administrador') return null;   // null = ve todo
  return PERMISOS[r] || PERMISOS[r.replace(/s$/, '')] || null;
}
function puedeVerArea(rol, key) {
  const p = permisosDe(rol);
  if (!p) return true;
  return p.areas.indexOf(key) !== -1;
}

// ===== Utilidad: leer el body JSON =====
async function readBody(req) {
  if (req && req._body) return req._body;   // el router ya lo leyó
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
    'Costo Unitario', 'Costo total', 'Costo Envío', 'Utilidad', 'Utilidad Final', '% Utilidad'],
  // CxC: el ERP no toca estas columnas (si son fórmula, se conservan; si no, las llena tu equipo)
  fin_cxc:            ['Por cobrar', 'Anticipo', 'Finiquito'],
  cotizaciones:       ['Trimestre', 'Año', 'Mes',
    'Precio sin IVA', 'Impuestos', 'Total Pedido',
    'Envio sin Impuestos', 'Total con envío', 'Total con envio sin impuestos',
    'Costo Unitario', 'Costo total', 'Costo Envío', 'Utilidad', 'Utilidad Final', '% Utilidad'],
  compras_registro:   ['Mes'],
  proyectos_registro: ['Mes', 'Avance'],
  prod_ordenes:       ['Mes']
};

// ===== Valores por defecto al dar de alta (campos que no aparecen en el formulario) =====
const DEFAULTS = {
  ventas_registro: { 'Status': 'Por Entregar' },
  prov_pedidos:    { 'Status': 'PENDIENTE COMPLETO' },
  cotizaciones:    { 'Status': 'Pendiente' }
};

// ===== Folio automático (No. de Referencia) =====
// Formato: LETRA_MES + consecutivo del mes + "-" + año de 2 dígitos.  Ej: enero -> E1-26, E2-26 ; mayo -> MY1-26
const MES_LETRA = { 1:'E', 2:'F', 3:'M', 4:'A', 5:'MY', 6:'J', 7:'JL', 8:'AG', 9:'S', 10:'O', 11:'N', 12:'D' };
const AUTO_REF = {
  ventas_registro: { field: 'No. de Referencia', dateField: 'Fecha del Cierre' },
  // Las cotizaciones usan el mismo esquema de mes/año pero con prefijo: COT-E1-26
  cotizaciones:    { field: 'No. de Referencia', dateField: 'Fecha del Cierre', prefix: 'COT-' }
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
function _generarFolio(values, headers, refField, record, dateField, prefix) {
  const pre = String(prefix || '').toUpperCase();
  const { mes, anio } = _mesAnioDe(record[dateField]);
  const letra = MES_LETRA[mes] || 'X';
  const yy = String(anio % 100).padStart(2, '0');
  const iRef = headers.findIndex(h => String(h).trim().toLowerCase() === String(refField).trim().toLowerCase());
  const rx = new RegExp('^' + pre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([A-Z]+)(\\d+)-(\\d{2})$');
  let maxSeq = 0;
  if (iRef !== -1) {
    for (let r = 1; r < values.length; r++) {
      const val = String(values[r][iRef] == null ? '' : values[r][iRef]).trim().toUpperCase();
      const mm = val.match(rx);
      if (mm && mm[1] === letra && mm[3] === yy) { const n = +mm[2]; if (n > maxSeq) maxSeq = n; }
    }
  }
  return pre + letra + (maxSeq + 1) + '-' + yy;
}

// Crea la pestaña si no existe
async function asegurarPestana(spreadsheetId, nombre) {
  const sheets = getSheets();
  let titles = [];
  try { titles = await listTabs(spreadsheetId); } catch (e) { titles = []; }
  if (titles.some(t => _norm(t) === _norm(nombre))) {
    return titles.filter(t => _norm(t) === _norm(nombre))[0];
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: nombre } } }] }
  });
  delete _tabsCache[spreadsheetId];
  return nombre;
}

// Vacía una pestaña y escribe la tabla completa (matriz de filas)
async function escribirTabla(spreadsheetId, nombre, matriz) {
  const sheets = getSheets();
  const real = await asegurarPestana(spreadsheetId, nombre);
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "'" + real + "'" });
  if (!matriz.length) return { filas: 0 };
  // Se asegura que la cuadrícula tenga filas suficientes
  try { await _asegurarFilas(spreadsheetId, real, matriz.length + 5); } catch (e) { /* sigue */ }
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "'" + real + "'!A1",
    valueInputOption: 'RAW', requestBody: { values: matriz }
  });
  return { filas: matriz.length - 1, pestana: real };
}

// Escribe celdas sueltas (varios rangos en una sola llamada)
async function writeCells(spreadsheetId, data) {
  if (!data || !data.length) return;
  const sheets = getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
}

// Arma la fila a partir del registro, tolerando diferencias de acentos/espacios/mayúsculas
// en los nombres de campo (ej. "Total con envio" -> columna "Total con envío").
function _filaDesde(headers, record) {
  const m = {};
  Object.keys(record || {}).forEach(k => { m[_norm(k)] = record[k]; });
  return headers.map(h => {
    if (record && record[h] != null) return record[h];
    const v = m[_norm(h)];
    return (v != null) ? v : '';
  });
}

// ===== Alta y edición de registros (respetando columnas calculadas) =====
function _skipCols(key, headers) {
  const skip = new Set();
  (FORMULA_FIELDS[key] || []).forEach(f => {
    // OJO: la hoja tiene encabezados repetidos (dos "Mes", dos "Tipo de Producto").
    // Se protegen TODAS las columnas que coincidan, no solo la primera.
    headers.forEach((h, i) => { if (_norm(h) === _norm(f)) skip.add(i); });
  });
  return skip;
}
async function addRecord(key, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Esta área no está conectada.');
  const sheetName = await resolveSheetName(cfg);
  const values = await readRange(cfg.id, sheetName);
  const hr = _hrIdx(cfg);
  const headers = (values[hr] || []).map(h => String(h));
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
        record[actual] = _generarFolio(values, headers, ar.field, record, ar.dateField, ar.prefix);
      }
    }
  }

  const skip = _skipCols(key, headers);
  const rowArr = _filaDesde(headers, record);
  if (skip.size === 0) {           // sin fórmulas: append normal
    const fila = await appendRow(cfg.id, sheetName, rowArr);
    return { ok: true, fila: fila };
  }
  // Con fórmulas: busca la primera fila realmente vacía y escribe sin tocar las calculadas
  const dataCols = headers.map((_, i) => i).filter(i => !skip.has(i));
  let target = values.length + 1;  // por defecto, después de la última fila con datos
  for (let r = hr + 1; r < values.length; r++) {
    const empty = dataCols.every(c => values[r][c] == null || String(values[r][c]).trim() === '');
    if (empty) { target = r + 1; break; }
  }
  try { await _asegurarFilas(cfg.id, sheetName, target); } catch (e) { /* si falla, el error se verá abajo */ }
  await writeRowSkipping(cfg.id, sheetName, target, rowArr, skip);
  // Continúa las fórmulas: se busca la última fila que SÍ las tenga y se copian
  try {
    const src = await _filaFuenteFormulas(cfg.id, sheetName, skip, target, hr + 1);
    if (src) await copiarFormulas(cfg.id, sheetName, src, target, skip);
  } catch (e) { /* la fila queda igual */ }
  return { ok: true, fila: target };
}
// ===== Alta de VARIOS registros de un mismo pedido (una fila por producto, mismo folio) =====
async function addRecordsBatch(key, records) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Esta área no está conectada.');
  if (!Array.isArray(records) || !records.length) throw new Error('No hay productos en la venta.');
  const sheetName = await resolveSheetName(cfg);
  const values = await readRange(cfg.id, sheetName);
  const hr = _hrIdx(cfg);
  const headers = (values[hr] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  const defs = DEFAULTS[key] || {};

  // Preparar cada registro con sus valores por defecto
  const prepared = records.map(r => {
    const rec = Object.assign({}, r || {});
    Object.keys(defs).forEach(f => {
      if (rec[f] == null || String(rec[f]).trim() === '') rec[f] = defs[f];
    });
    return rec;
  });

  // Un SOLO folio para todo el pedido (basado en la fecha del primer registro)
  let folio = null;
  const ar = AUTO_REF[key];
  if (ar) {
    const iRef = headers.findIndex(h => _norm(h) === _norm(ar.field));
    if (iRef !== -1) {
      folio = _generarFolio(values, headers, ar.field, prepared[0], ar.dateField, ar.prefix);
      const actual = headers[iRef];
      prepared.forEach(rec => {
        if (rec[actual] == null || String(rec[actual]).trim() === '') rec[actual] = folio;
      });
    }
  }

  // Primera fila realmente vacía; se escriben N filas consecutivas
  const dataCols = headers.map((_, i) => i).filter(i => !skip.has(i));
  let target = values.length + 1;
  for (let r = hr + 1; r < values.length; r++) {
    const empty = dataCols.every(c => values[r][c] == null || String(values[r][c]).trim() === '');
    if (empty) { target = r + 1; break; }
  }
  try { await _asegurarFilas(cfg.id, sheetName, target + prepared.length); } catch (e) { /* se verá abajo */ }
  let srcForm = null;
  try { srcForm = await _filaFuenteFormulas(cfg.id, sheetName, skip, target, hr + 1); } catch (e) { srcForm = null; }
  for (let n = 0; n < prepared.length; n++) {
    const rowArr = _filaDesde(headers, prepared[n]);
    await writeRowSkipping(cfg.id, sheetName, target + n, rowArr, skip);
    try { if (srcForm) await copiarFormulas(cfg.id, sheetName, srcForm, target + n, skip); } catch (e) { /* sigue */ }
  }
  return { ok: true, folio: folio, filas: prepared.length, fila: target };
}

async function updateRecord(key, rowNumber, record) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Esta área no está conectada.');
  const sheetName = await resolveSheetName(cfg);
  const values = await readRange(cfg.id, sheetName);
  const hr = _hrIdx(cfg);
  const headers = (values[hr] || []).map(h => String(h));
  const skip = _skipCols(key, headers);
  const rowArr = _filaDesde(headers, record);
  await writeRowSkipping(cfg.id, sheetName, Number(rowNumber), rowArr, skip);
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
      // Cascada de producto: eliges Producto -> Material -> Material Extra (si aplica)
      // y se autocompletan Tipo de Producto y Precio Unitario desde el catálogo.
      type: 'cascade',
      id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA',   // archivo "Lista de Precios 2026"
      sheetName: 'Lista de Precios 2026',
      sheetNamePattern: 'Lista de Precios {AAAA}',   // en 2027 usa sola la pestaña de 2027
      headerRow: 2,                                          // los encabezados están en la FILA 2 (la 1 es un título)
      // { field: campo en VENTAS, from: nombre(s) en el CATÁLOGO, fromIndex: respaldo por posición (0-based) }
      levels: [
        { field: 'Producto',       from: ['Productos', 'Producto', 'Nombre'], fromIndex: 1 },        // col B
        { field: 'Material',        from: ['Material', 'Coleccion', 'Colección'], fromIndex: 2 },      // col C (madera)
        { field: 'Material Extra',  from: ['Material Extra', 'Material extra', 'Material 2', 'Material2',
                                            'Segundo Material', 'Material Secundario', 'Acabado', 'Tapizado'], fromIndex: 3 }  // col D
      ],
      fills: [
        { field: 'Tipo de Producto', from: ['Tipo de Producto', 'Categoria producto', 'Categoría', 'Tipo de Mueble'] },
        { field: 'Precio Unitario',  from: ['Precio Unitario', 'Precio de Venta', 'Precio Venta', 'Precio', 'PVP'] },   // <- columna "Precio Unitario" de Lista de Precios
        { field: 'Costo Unitario',   from: ['Costos Total', 'Costo Unitario', 'Costo Total', 'Costos', 'Costo'] },
        // Para la cotización (si el catálogo aún no las tiene, se escriben a mano en el formulario)
        { field: 'Descripción',      from: ['Descripción', 'Descripcion', 'Detalle', 'Descripción del producto'] },
        { field: 'Medidas',          from: ['Medidas', 'Dimensiones', 'Medida', 'Tamaño'] },
        { field: 'Foto',             from: ['Fotos', 'Foto', 'Imagen'] }
      ]
      // (sin filtro de "Disponible": el catálogo es lista de precios / bajo pedido)
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
  cotizaciones: [
    {
      // Cascada de producto: eliges Producto -> Material -> Material Extra (si aplica)
      // y se autocompletan Tipo de Producto y Precio Unitario desde el catálogo.
      type: 'cascade',
      id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA',   // archivo "Lista de Precios 2026"
      sheetName: 'Lista de Precios 2026',
      sheetNamePattern: 'Lista de Precios {AAAA}',   // en 2027 usa sola la pestaña de 2027
      headerRow: 2,                                          // los encabezados están en la FILA 2 (la 1 es un título)
      // { field: campo en VENTAS, from: nombre(s) en el CATÁLOGO, fromIndex: respaldo por posición (0-based) }
      levels: [
        { field: 'Producto',       from: ['Productos', 'Producto', 'Nombre'], fromIndex: 1 },        // col B
        { field: 'Material',        from: ['Material', 'Coleccion', 'Colección'], fromIndex: 2 },      // col C (madera)
        { field: 'Material Extra',  from: ['Material Extra', 'Material extra', 'Material 2', 'Material2',
                                            'Segundo Material', 'Material Secundario', 'Acabado', 'Tapizado'], fromIndex: 3 }  // col D
      ],
      fills: [
        { field: 'Tipo de Producto', from: ['Tipo de Producto', 'Categoria producto', 'Categoría', 'Tipo de Mueble'] },
        { field: 'Precio Unitario',  from: ['Precio Unitario', 'Precio de Venta', 'Precio Venta', 'Precio', 'PVP'] },   // <- columna "Precio Unitario" de Lista de Precios
        { field: 'Costo Unitario',   from: ['Costos Total', 'Costo Unitario', 'Costo Total', 'Costos', 'Costo'] },
        // Para la cotización (si el catálogo aún no las tiene, se escriben a mano en el formulario)
        { field: 'Descripción',      from: ['Descripción', 'Descripcion', 'Detalle', 'Descripción del producto'] },
        { field: 'Medidas',          from: ['Medidas', 'Dimensiones', 'Medida', 'Tamaño'] },
        { field: 'Foto',             from: ['Fotos', 'Foto', 'Imagen'] }
      ]
      // (sin filtro de "Disponible": el catálogo es lista de precios / bajo pedido)
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
  leads: [
    { id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM', sheetName: 'Lista de Clientes',
      keyField: 'Contacto', keyAliases: ['Cliente', 'Nombre/Razón Social'], fills: [] }
  ],
  showroom: [
    { id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM', sheetName: 'Lista de Clientes',
      keyField: 'Cliente', keyAliases: ['Nombre/Razón Social'], fills: [{ from: ['Despacho'], to: 'Despacho' }] }
  ],
  // Funnel: el Cliente se sugiere desde la Lista de Clientes (pero se puede escribir uno nuevo)
  funnel: [
    {
      id: '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM',  // archivo "Lista de Clientes"
      sheetName: 'Lista de Clientes',
      keyField: 'Cliente',
      keyAliases: ['Nombre/Razón Social', 'Nombre Comercial', 'Razón Social', 'Cliente'],
      fills: [ { from: ['Despacho'], to: 'Despacho' } ]
    }
  ],
  // Pedidos a proveedores: producto y material salen del catálogo; el costo se propone solo
  op_envios: [
    {
      // Al escribir el folio de la venta se llenan solos el cliente y a dónde va
      type: 'lookup',
      id: '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU',
      sheetName: 'VENTAS',
      keyField: 'Pedido',
      keyAliases: ['No. de Referencia', 'Folio', 'Pedido'],
      fills: [
        { to: 'Cliente',  from: ['Cliente'] },
        { to: 'Destino',  from: ['Direccion de envio', 'Dirección de envío', 'Dirección de Entrega'] },
        { to: 'Status',   from: ['Status'] },
        { to: 'Fecha Estimada de Entrega', from: ['Fecha de entrega acordada'] },
        { to: 'Fecha de Entrega Real', from: ['Fecha de entrega real'] }
      ],
      // Se suman por folio: las piezas de la venta y lo que se le cobró de envío
      sumarVarios: [
        { campo: 'Piezas', col: ['Cantidad'] },
        { campo: 'Cobrado al Cliente', col: ['Envio', 'Envío'] }
      ]
    }
  ],

  prov_pedidos: [
    {
      type: 'cascade',
      id: '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA',
      sheetName: 'Lista de Precios 2026',
      sheetNamePattern: 'Lista de Precios {AAAA}',
      headerRow: 2,
      levels: [
        { field: 'Producto', from: ['Productos', 'Producto'], fromIndex: 1 },
        // El material ofrece también el Material Extra: al proveedor se le puede pedir
        // la madera o el tejido por separado, según qué componente surta.
        { field: 'Material', from: ['Material'], fromIndex: 2, union: ['Material Extra'] }
      ],
      // Sin fills: el costo NO sale del catálogo, sale de Costos Unitarios según el
      // proveedor. Si ese proveedor no surte ese mueble, el campo se queda vacío.
      fills: []
    },
    {
      id: '1zf_j6V-Wr_a7-0MGyntaPPvYRo-tPL4BSmtKOlyZJe8',
      sheetName: 'Lista de Proveedores',
      keyField: 'Proveedor',
      keyAliases: ['Nombre/Razón Social', 'Razón Social', 'Proveedor'],
      fills: []
    },
    {
      // El costo unitario lo manda la pestaña Costos Unitarios: depende del proveedor,
      // del año y de la combinación producto + material. Se rellena solo y es editable.
      type: 'tabla',
      id: '1cbRHK4_-WxCd8q7hemw-PYrt3opZ5GSn5tzghGpByV4',
      sheetName: 'Costos Unitarios',
      llaves: [
        { campo: 'Producto',  col: ['Productos', 'Producto'] },
        { campo: 'Material',  col: ['Material 1', 'Material'] },
        { campo: 'Proveedor', col: ['Proveedor'] }
      ],
      anioCol: 'Año',
      fills: [{ field: 'Costo Unitario', from: ['Costos Unitarios', 'Costo Unitario'] }]
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
  const lkName = await resolveSheetName({ id: srcId, sheetName: lk.sheetName, sheetNamePattern: lk.sheetNamePattern });
  try { values = await readRange(srcId, lkName); }
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
    const aSumar = lk.sumarVarios || (lk.sumar ? [lk.sumar] : []);
    aSumar.forEach(sm => {
      const cS = findCol(sm.col || [sm.campo]);
      if (cS === -1) return;
      const n = parseFloat(String(row[cS] == null ? '' : row[cS]).replace(/[^0-9.\-]/g, ''));
      if (isNaN(n)) return;
      const prev = map[name] ? parseFloat(map[name][sm.campo] || 0) || 0 : 0;
      rec[sm.campo] = Math.round((prev + n) * 100) / 100;
    });
    map[name] = Object.assign({}, map[name] || {}, rec);
  }
  options.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  // Normaliza fills a la lista de destinos para que el frontend sepa qué campos llenar.
  const fillTargets = fills.map(f => (typeof f === 'string') ? f : f.to).filter(Boolean);
  (lk.sumarVarios || (lk.sumar ? [lk.sumar] : [])).forEach(sm => fillTargets.push(sm.campo));
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
  const lkName = await resolveSheetName({ id: srcId, sheetName: lk.sheetName, sheetNamePattern: lk.sheetNamePattern });
  try { values = await readRange(srcId, lkName); }
  catch (e) { return null; }
  if (!values.length) return null;
  // Encabezados: por defecto fila 1; si la hoja tiene un título arriba, usar headerRow (ej. 2).
  const hr = (lk.headerRow && lk.headerRow > 1) ? (lk.headerRow - 1) : 0;
  if (values.length <= hr) return null;
  const headers = values[hr].map(h => String(h).trim());
  const findCol = (names) => {
    const list = Array.isArray(names) ? names : [names];
    for (const a of list) { const i = headers.findIndex(h => _norm(h) === _norm(a)); if (i !== -1) return i; }
    return -1;
  };

  // Cada nivel: string, o { field, from:[alias...], fromIndex } (fromIndex = respaldo por posición 0-based)
  const levelCols = (lk.levels || []).map(l => {
    const field = (typeof l === 'string') ? l : l.field;
    const from  = (typeof l === 'string') ? l : (l.from || l.field);
    let cIdx = findCol(from);
    if (cIdx === -1 && typeof l === 'object' && l.fromIndex != null && l.fromIndex < headers.length) cIdx = l.fromIndex;
    // "union": el nivel también ofrece los valores de otras columnas.
    // Ej. Material del catálogo ofrece Material Y Material Extra, porque al proveedor
    // se le puede pedir la madera o el tejido por separado.
    const extra = [];
    if (typeof l === 'object' && l.union) {
      (Array.isArray(l.union) ? l.union : [l.union]).forEach(u => {
        const j = findCol(u);
        if (j !== -1 && j !== cIdx) extra.push(j);
      });
    }
    return { name: field, col: cIdx, extra: extra };
  }).filter(x => x.col !== -1);
  if (!levelCols.length) return null;
  // Igual para los campos autocompletados
  const fillCols = (lk.fills || []).map(f => {
    const field = (typeof f === 'string') ? f : f.field;
    const from  = (typeof f === 'string') ? f : (f.from || f.field);
    let cIdx = findCol(from);
    if (cIdx === -1 && typeof f === 'object' && f.fromIndex != null && f.fromIndex < headers.length) cIdx = f.fromIndex;
    return { name: field, col: cIdx };
  }).filter(x => x.col !== -1);

  const flt = lk.filter || null;
  const filterCol = (flt && flt.field) ? findCol(Array.isArray(flt.field) ? flt.field[0] : flt.field) : -1;
  function passes(row) {
    if (!flt || filterCol === -1) return true;
    const v = String(row[filterCol] == null ? '' : row[filterCol]).trim();
    if (flt.gt0) { const n = parseFloat(v.replace(/[^0-9.,\-]/g, '').replace(/,/g, '')); return !isNaN(n) && n > 0; }
    if (flt.notEmpty) return v !== '';
    return true;
  }

  const conUnion = levelCols.filter(lc => lc.extra && lc.extra.length);
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const row = values[i];
    if (!passes(row)) continue;
    // Una fila del catálogo puede generar varias combinaciones cuando un nivel une columnas
    if (conUnion.length) {
      const lc = conUnion[0];
      const vals = [lc.col].concat(lc.extra)
        .map(c => String(row[c] == null ? '' : row[c]).trim())
        .filter(v => v && !_esVacioNivel(v));
      const unicos = vals.filter((v, k) => vals.indexOf(v) === k);
      if (unicos.length > 1) {
        unicos.forEach(v => {
          const copia = row.slice();
          copia[lc.col] = v;
          lc.extra.forEach(c => { copia[c] = ''; });
          values.push(copia);            // se procesa como una fila más
        });
        continue;
      }
      if (unicos.length === 1 && String(row[lc.col] || '').trim() !== unicos[0]) {
        row[lc.col] = unicos[0];
      }
    }
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

// Tabla de consulta por varias llaves (ej. costo unitario por producto + material + proveedor).
// Se manda al navegador como una lista de filas ya normalizadas; el frontend busca ahí.
async function _resolveTabla(cfgArea, lk) {
  const id = lk.id || cfgArea.id;
  let hoja = lk.sheetName;
  if (lk.sheetNamePattern) {
    try { hoja = await resolveSheetName({ id, sheetNamePattern: lk.sheetNamePattern }); } catch (e) { /* usa la fija */ }
  }
  let values;
  try { values = await readRange(id, hoja); } catch (e) { return null; }
  if (!values.length) return null;
  const hr = (lk.headerRow && lk.headerRow > 1) ? (lk.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const idx = (nombres) => {
    for (const n of nombres) {
      const i = headers.findIndex(h => _norm(h) === _norm(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  const llaves = (lk.llaves || []).map(k => ({ campo: k.campo, i: idx(k.col || [k.campo]) }))
    .filter(k => k.i !== -1);
  if (!llaves.length) return null;
  const rellenos = (lk.fills || []).map(f => ({
    field: (typeof f === 'string') ? f : f.field,
    i: idx((typeof f === 'string') ? [f] : (f.from || [f.field]))
  })).filter(f => f.i !== -1);
  const iAnio = lk.anioCol ? idx([lk.anioCol]) : -1;

  const filas = [];
  for (let r = hr + 1; r < values.length; r++) {
    const row = values[r] || [];
    const o = { _k: llaves.map(k => _norm(row[k.i])).join('||') };
    if (!o._k.replace(/\|/g, '')) continue;
    rellenos.forEach(f => {
      const v = row[f.i];
      if (v != null && String(v).trim() !== '') o[f.field] = v;
    });
    if (!Object.keys(o).some(x => x !== '_k')) continue;
    if (iAnio !== -1) {
      const a = parseInt(String(row[iAnio]).replace(/[^0-9]/g, ''), 10);
      o._anio = isNaN(a) ? null : a;
    }
    filas.push(o);
  }
  return {
    type: 'tabla',
    campos: llaves.map(k => k.campo),
    fills: rellenos.map(f => f.field),
    conAnio: iAnio !== -1,
    filas: filas
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
    if (lk.type === 'tabla') {
      const t = await _resolveTabla(cfgArea, lk);
      if (t && t.filas && t.filas.length) out.push(t);
      continue;
    }
    const r = await _resolveLookup(cfgArea, lk);
    if (r && r.options && r.options.length) out.push(r);
  }
  return out;
}

module.exports = { MENU, SHEETS, USERS_SHEET, FORMULA_FIELDS, AREA_ROW_FILTERS, readRange, appendRow, updateRow,
  getDrive, copiarFormulas, writeCells, escribirTabla, asegurarPestana, COLUMNAS_SUGERIDAS,
  PERMISOS, permisosDe, puedeVerArea,
  resolveSheetName, areaCfg, listTabs,
  addRecordsBatch,
  addRecord, updateRecord, getCategories, addCategory, getLookups,
  signToken, verifyToken, verifyWriter, findUser, readBody };
