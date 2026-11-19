// ===== Efectivo y Bancos =====
//
// Val, 18 nov: una sección con Resumen, una pestaña por cuenta y Flujo de
// efectivo. *"Solo métele y luego te digo de dónde se jala la info."*
// Val, 19 nov: *"este es el archivo para efectivo y bancos que subimos ayer…
// el tema es quiero ver cuáles cuadran y cuáles no, entonces dónde subirte los
// movimientos para ver si me hace falta algo"*.
//
// Las cuentas **no están escritas en el código**: se descubren solas. Cualquier
// pestaña del archivo de Efectivo con una fila de encabezados que diga "Fecha" y
// columnas de Entradas/Salidas es una cuenta. En el archivo del 19 nov eso da
// siete: Efectivo General, Caja Chica, BBVA 0117441789, BBVA 0122411350,
// Openpay, Paypal y American Express.
//
//   ?action=caja-bancos                 → resumen, cuentas y flujo de un año
//   ?action=caja-bancos&guardar=1       → un movimiento (entrada, salida o traspaso)
//   ?action=caja-bancos&que=cruce       → cruzar el estado de cuenta contra lo capturado
//   ?action=caja-bancos&que=alta-cruce  → dar de alta lo que salió "solo en el banco"
//   ?action=caja-bancos&que=categorias  → crear la pestaña Categorías precargada
//
// El saldo **no se captura**: lo calcula el ERP, movimiento a movimiento. El de
// la hoja se usa solo para comparar — y en American Express **no cuadra**: su
// columna Saldo enseña el monto de cada renglón en vez del acumulado, en 382 de
// 383 renglones. Por eso el panel avisa cuando la hoja y el corrido se separan.
const CFG = require('../config');
const core = require('../core');

const ARCHIVO = CFG.ARCHIVOS.EFECTIVO;
// Pestañas que no son cuentas. Se compara por el principio del nombre, así que
// "Resumen Ejecutivo" también queda fuera (antes entraba y salía como un error).
const NO_SON_CUENTA = ['portada', 'resumen', 'categor', 'etiquetas', 'hoja ',
                       'conciliac', 'config', 'instruc', 'tabla dinamica'];

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
const ERROR_CELDA = /^#(VALUE|REF|DIV\/0|N\/A|NAME|NUM|NULL)/i;
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (ERROR_CELDA.test(t)) return 0;
  if (/^\(.*\)$/.test(t)) t = '-' + t.replace(/[()]/g, '');     // (1,000) = -1000
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const redondo = (n) => Math.round(n * 100) / 100;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_NUM = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
                  sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
MESES.forEach((m, i) => { MES_NUM[m] = i + 1; });
// Devuelve {a, m, d} o null. Nunca inventa una fecha.
function fecha(v) {
  if (v instanceof Date) return { a: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const t = txt(v);
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    if (n > 20000 && n < 80000) {
      const x = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return { a: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
    }
  }
  let g = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (g) return { a: +g[1], m: +g[2], d: +g[3] };
  g = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (g) { let a = +g[3]; if (a < 100) a += 2000; return { a, m: +g[2], d: +g[1] }; }
  g = norm(t).replace(/,/g, ' ').replace(/\s+/g, ' ')
       .match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\.?\s*(?:de\s+)?(\d{2,4})/);
  if (g && MES_NUM[g[2]]) { let a = +g[3]; if (a < 100) a += 2000; return { a, m: MES_NUM[g[2]], d: +g[1] }; }
  return null;
}
const clave = (f) => f ? f.a * 10000 + f.m * 100 + f.d : 0;
const enPalabras = (f) => f ? f.d + ' ' + MESES[f.m - 1] + ' ' + f.a : '';
// Días entre dos fechas, para emparejar con tolerancia
function diasEntre(a, b) {
  if (!a || !b) return 9999;
  const ms = Date.UTC(a.a, a.m - 1, a.d) - Date.UTC(b.a, b.m - 1, b.d);
  return Math.round(Math.abs(ms) / 86400000);
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
// Para encabezados que varían de banco a banco: busca el que CONTENGA la palabra
function colQueContenga(H, ...n) {
  for (const x of n) {
    const c = H.filter(y => norm(y).indexOf(norm(x)) !== -1)[0];
    if (c) return c;
  }
  return null;
}
function letra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Un movimiento es traspaso si lo dice su concepto, su categoría o su descripción
const esTraspaso = (m) => /traspaso|transferencia entre|entre cuentas/i.test(
  norm(m.concepto) + ' ' + norm(m.categoria) + ' ' + norm(m.descripcion));

// ===== Leer una cuenta =====
//
// La tabla no siempre empieza en A1: se busca la celda que dice "Fecha" y de
// ahí arrancan los encabezados.
async function leerCuenta(hoja) {
  let values;
  try { values = await core.readRange(ARCHIVO, hoja); }
  catch (e) { return { ok: false, error: e.message }; }
  if (!values || !values.length) return { ok: false, error: 'La pestaña está vacía.' };
  let hr = -1, c0 = 0;
  for (let i = 0; i < Math.min(15, values.length) && hr === -1; i++) {
    const f = values[i] || [];
    for (let j = 0; j < f.length; j++) {
      if (norm(f[j]) === 'fecha') { hr = i; c0 = j; break; }
    }
  }
  if (hr === -1) return { ok: false, error: 'No hay una fila de encabezados con "Fecha".' };
  const cab = values[hr] || [];
  const H = [];
  for (let j = c0; j < cab.length; j++) H.push(txt(cab[j]));
  const cF = col(H, 'Fecha'), cEnt = col(H, 'Entradas', 'Entrada', 'Abono', 'Abonos', 'Depósitos'),
        cSal = col(H, 'Salidas', 'Salida', 'Cargo', 'Cargos', 'Retiros'),
        cCon = col(H, 'Concepto', 'Concepto Estado de Cuenta'),
        cDes = col(H, 'Descripción', 'Descripcion'),
        cCat = col(H, 'Categoría', 'Categoria'),
        cSub = col(H, 'Subcategoría', 'Subcategoria'),
        // En este archivo cliente y proveedor comparten una sola columna
        cCliPro = col(H, 'Cliente/Proveedor', 'Cliente / Proveedor', 'Cliente-Proveedor'),
        cCli = col(H, 'Cliente'), cPro = col(H, 'Proveedor'),
        cSaldo = col(H, 'Saldo'),
        // "Referencia Estado de Cuenta" es como llega el movimiento en el banco:
        // es la llave para cruzar contra el estado de cuenta.
        cRef = col(H, 'Referencia Estado de Cuenta') || colQueContenga(H, 'referencia'),
        cComp = col(H, 'Comprobante'), cComent = col(H, 'Comentarios'),
        cMes = col(H, 'Mes'), cAnio = col(H, 'Año', 'Anio', 'Ano');
  if (!cEnt && !cSal) return { ok: false, error: 'No tiene columnas de Entradas ni Salidas.' };

  const movs = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const g = (c) => (c ? f[c0 + H.indexOf(c)] : '');
    const fe = fecha(g(cF));
    const ent = cEnt ? num(g(cEnt)) : 0;
    const sal = cSal ? num(g(cSal)) : 0;
    const desc = txt(g(cDes)), conc = txt(g(cCon));
    if (!fe && !ent && !sal && !desc && !conc) continue;        // renglón vacío
    movs.push({
      fila: i + 1,
      fecha: enPalabras(fe), orden: clave(fe), anio: fe ? fe.a : 0, mes: fe ? fe.m : 0,
      _f: fe,
      concepto: conc, descripcion: desc,
      categoria: cCat ? txt(g(cCat)) : '',
      subcategoria: cSub ? txt(g(cSub)) : '',
      quien: cCliPro ? txt(g(cCliPro)) : (txt(g(cCli)) || txt(g(cPro))),
      referencia: cRef ? txt(g(cRef)) : '',
      comprobante: cComp ? txt(g(cComp)) : '',
      comentarios: cComent ? txt(g(cComent)) : '',
      entrada: ent, salida: sal,
      saldoHoja: cSaldo ? num(g(cSaldo)) : null,
      traeSaldo: !!cSaldo && txt(g(cSaldo)) !== ''
    });
  }
  // ---- La columna Saldo de la hoja, revisada EN EL ORDEN DE LA HOJA ----
  //
  // Esto se revisa antes de ordenar por fecha, a propósito. El panel ordena por
  // fecha y la hoja va en el orden en que se capturó; si unos cuantos renglones
  // quedaron fuera de orden, los dos saldos corren distinto renglón por renglón
  // y aun así terminan en el mismo número. Eso NO es un error de la hoja, y
  // avisarlo sería una falsa alarma: pasa en Efectivo General (1 renglón fuera
  // de orden) y en BBVA 0122411350 (2).
  //
  // Lo que sí es un error es que el saldo final no cuadre. Ahí la columna está
  // rota de verdad, como en American Express: enseña el monto de cada renglón
  // en vez del acumulado, en 382 de 383.
  let enOrdenHoja = 0, saldoRoto = 0, primerRoto = null, desordenados = 0;
  const porFila = movs.slice().sort((a, b) => a.fila - b.fila);
  porFila.forEach((m, i) => {
    enOrdenHoja = redondo(enOrdenHoja + m.entrada - m.salida);
    if (m.traeSaldo && Math.abs(m.saldoHoja - enOrdenHoja) > 0.5) {
      saldoRoto++;
      if (!primerRoto) primerRoto = { fila: m.fila, fecha: m.fecha,
                                      hoja: m.saldoHoja, erp: enOrdenHoja };
    }
    if (i > 0 && m.orden && porFila[i - 1].orden && m.orden < porFila[i - 1].orden) desordenados++;
  });
  const saldoFinalHoja = porFila.length && porFila[porFila.length - 1].traeSaldo
    ? porFila[porFila.length - 1].saldoHoja : null;

  // Del MÁS ANTIGUO al MÁS RECIENTE. Los que no traen fecha se quedan al final,
  // en el orden en que están capturados: inventarles una fecha sería peor.
  movs.sort((a, b) => (a.orden || 9e14) - (b.orden || 9e14) || a.fila - b.fila);
  let saldo = 0;
  movs.forEach(m => {
    saldo = redondo(saldo + m.entrada - m.salida);
    m.saldo = saldo;                      // calculado por el ERP, no leído
    m.traspaso = esTraspaso(m);
  });
  const cuadraFinal = saldoFinalHoja === null || Math.abs(saldoFinalHoja - saldo) < 0.5;
  return { ok: true, hoja, headers: H, filaEncabezados: hr + 1, colInicio: c0,
           movs, saldo,
           // Solo se avisa cuando el saldo final de la hoja NO cuadra
           saldoRoto: cuadraFinal ? 0 : saldoRoto,
           primerRoto: cuadraFinal ? null : primerRoto,
           saldoFinalHoja, desordenados,
           cols: { cF, cEnt, cSal, cCon, cDes, cCat, cSub, cCliPro, cCli, cPro,
                   cSaldo, cRef, cComp, cComent, cMes, cAnio } };
}

// Las pestañas del archivo que son cuentas
async function cuentasDelArchivo() {
  let nombres = [];
  try { nombres = await core.listarPestanas(ARCHIVO); }
  catch (e) { nombres = []; }
  return nombres.filter(n => !NO_SON_CUENTA.some(x => norm(n).indexOf(x) === 0));
}

// ===== Las listas de los desplegables =====
//
// Este archivo NO trae pestaña de categorías (Val, 19 nov: *"¿te falta la lista
// de conceptos?"*). Así que las listas se arman de lo que ya está capturado: 45
// conceptos, 15 categorías y las subcategorías de cada una. Si algún día existe
// una pestaña "Categorías", ésa manda y esto queda de respaldo.
function listasDe(cuentas) {
  const conceptos = {}, cats = {}, subs = {}, quien = {};
  const paresCat = {}, conceptoCat = {};
  cuentas.forEach(c => (c.movs || []).forEach(m => {
    if (m.concepto) conceptos[m.concepto] = (conceptos[m.concepto] || 0) + 1;
    if (m.categoria) cats[m.categoria] = (cats[m.categoria] || 0) + 1;
    if (m.subcategoria) subs[m.subcategoria] = (subs[m.subcategoria] || 0) + 1;
    if (m.quien) quien[m.quien] = (quien[m.quien] || 0) + 1;
    if (m.categoria && m.subcategoria) {
      (paresCat[m.categoria] = paresCat[m.categoria] || {})[m.subcategoria] = 1;
    }
    // Qué categoría suele llevar cada concepto: para proponerla al capturar
    if (m.concepto && m.categoria) {
      const x = conceptoCat[m.concepto] = conceptoCat[m.concepto] || {};
      x[m.categoria] = (x[m.categoria] || 0) + 1;
    }
  }));
  const porUso = (o) => Object.keys(o).sort((a, b) => o[b] - o[a] || (a < b ? -1 : 1));
  const sugerida = {};
  Object.keys(conceptoCat).forEach(k => {
    sugerida[k] = porUso(conceptoCat[k])[0] || '';
  });
  const subsDe = {};
  Object.keys(paresCat).forEach(k => { subsDe[k] = Object.keys(paresCat[k]).sort(); });
  return {
    conceptos: porUso(conceptos), categorias: porUso(cats),
    subcategorias: porUso(subs), subsDe, categoriaDe: sugerida,
    quien: porUso(quien).slice(0, 400),
    deDonde: 'de lo que ya está capturado en las cuentas'
  };
}
async function listasDeLaPestana() {
  let values;
  try { values = await core.readRange(ARCHIVO, 'Categorías'); }
  catch (e) {
    try { values = await core.readRange(ARCHIVO, 'Categorias'); }
    catch (e2) { return null; }
  }
  if (!values || values.length < 2) return null;
  const H = (values[0] || []).map(h => txt(h));
  const iC = H.findIndex(h => norm(h) === 'concepto');
  const iCa = H.findIndex(h => norm(h).indexOf('categoria') === 0);
  const iSu = H.findIndex(h => norm(h).indexOf('subcategoria') === 0);
  if (iC === -1 && iCa === -1) return null;
  const conceptos = [], cats = [], subs = [], subsDe = {}, categoriaDe = {};
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    const c = iC !== -1 ? txt(f[iC]) : '';
    const ca = iCa !== -1 ? txt(f[iCa]) : '';
    const su = iSu !== -1 ? txt(f[iSu]) : '';
    if (c && conceptos.indexOf(c) === -1) conceptos.push(c);
    if (ca && cats.indexOf(ca) === -1) cats.push(ca);
    if (su && subs.indexOf(su) === -1) subs.push(su);
    if (ca && su) { (subsDe[ca] = subsDe[ca] || []); if (subsDe[ca].indexOf(su) === -1) subsDe[ca].push(su); }
    if (c && ca && !categoriaDe[c]) categoriaDe[c] = ca;
  }
  return { conceptos, categorias: cats, subcategorias: subs, subsDe, categoriaDe,
           quien: [], deDonde: 'de la pestaña Categorías del archivo' };
}

// ===== Conciliaciones: se crea sola si no existe =====
const H_CONCI = ['Mes', 'Cuenta', 'Periodo', 'Origen', 'Saldo inicial banco',
                 'Entradas banco', 'Salidas banco', 'Saldo final banco',
                 'Saldo final ERP', 'Diferencia', 'Estado', 'Solo en banco',
                 'Solo en ERP', 'Archivo', 'Link', 'Revisó', 'Última actualización'];
async function leerConciliaciones() {
  try {
    const values = await core.readRange(ARCHIVO, 'Conciliaciones');
    if (!values || !values.length) return { filas: [], existe: true };
    const H = (values[0] || []).map(h => txt(h));
    const filas = [];
    for (let i = 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; let algo = false;
      H.forEach((h, j) => { if (h) { o[h] = f[j] == null ? '' : f[j]; if (txt(f[j])) algo = true; } });
      if (algo) { o._fila = i + 1; filas.push(o); }
    }
    return { filas, existe: true, H };
  } catch (e) { return { filas: [], existe: false }; }
}
async function crearConciliaciones() {
  try {
    await core.asegurarPestana(ARCHIVO, 'Conciliaciones');
    await core.writeCells(ARCHIVO, [{ range: "'Conciliaciones'!A1", values: [H_CONCI] }]);
    return true;
  } catch (e) { return false; }
}

// ===== El estado de cuenta que se pega o se sube =====
//
// Cada banco lo exporta distinto, así que primero se buscan encabezados por
// nombre (Fecha, Descripción, Cargo/Abono, Retiro/Depósito, Importe). Si no hay
// encabezados, se lee renglón por renglón y **se dice que se leyó así**, con lo
// que se entendió a la vista, para que nadie dé por bueno lo que no revisó.
function partirRenglones(texto) {
  return String(texto || '').split(/\r?\n/).map(l => l.replace(/ /g, ' '))
    .filter(l => l.trim() !== '');
}
function partirCeldas(linea) {
  if (linea.indexOf('\t') !== -1) return linea.split('\t').map(x => x.trim());
  // CSV con comillas
  const out = []; let act = '', dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') { if (dentro && linea[i + 1] === '"') { act += '"'; i++; } else dentro = !dentro; }
    else if (ch === ',' && !dentro) { out.push(act.trim()); act = ''; }
    else act += ch;
  }
  out.push(act.trim());
  return out;
}
const MONTO_SUELTO = /-?\$?\s?\(?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})\)?|-?\$?\s?\d+\.\d{2}/g;

function leerEstadoDeCuenta(texto) {
  const lineas = partirRenglones(texto);
  if (!lineas.length) return { movs: [], como: 'vacio', aviso: 'No llegó nada que leer.' };
  const tablas = lineas.map(partirCeldas);

  // 1) ¿Hay una fila de encabezados?
  let hr = -1;
  for (let i = 0; i < Math.min(12, tablas.length); i++) {
    const f = tablas[i].map(norm);
    const tieneFecha = f.some(x => x === 'fecha' || x.indexOf('fecha') === 0);
    const tieneMonto = f.some(x => /cargo|abono|retiro|deposito|importe|monto|salida|entrada/.test(x));
    if (tieneFecha && tieneMonto) { hr = i; break; }
  }

  const movs = [];
  if (hr !== -1) {
    const H = tablas[hr];
    const idx = (...nn) => {
      for (const n of nn) {
        const i = H.findIndex(h => norm(h).indexOf(norm(n)) !== -1);
        if (i !== -1) return i;
      }
      return -1;
    };
    const iF = idx('fecha');
    const iD = idx('descripcion', 'concepto', 'referencia', 'detalle');
    const iCargo = idx('cargo', 'retiro', 'salida', 'debito');
    const iAbono = idx('abono', 'deposito', 'entrada', 'credito');
    const iImp = idx('importe', 'monto');
    for (let i = hr + 1; i < tablas.length; i++) {
      const f = tablas[i];
      const fe = fecha(iF !== -1 ? f[iF] : '');
      if (!fe) continue;
      let sal = iCargo !== -1 ? Math.abs(num(f[iCargo])) : 0;
      let ent = iAbono !== -1 ? Math.abs(num(f[iAbono])) : 0;
      if (!sal && !ent && iImp !== -1) {
        const v = num(f[iImp]);
        if (v < 0) sal = Math.abs(v); else ent = v;
      }
      if (!sal && !ent) continue;
      movs.push({ _f: fe, fecha: enPalabras(fe), orden: clave(fe),
                  descripcion: iD !== -1 ? txt(f[iD]) : '',
                  entrada: redondo(ent), salida: redondo(sal), linea: i + 1 });
    }
    return { movs, como: 'encabezados',
             columnas: { fecha: iF, descripcion: iD, cargo: iCargo, abono: iAbono, importe: iImp },
             encabezados: H.filter(Boolean) };
  }

  // 2) Sin encabezados: fecha al principio y los montos de la línea.
  //    Con dos montos, el último suele ser el saldo. El signo sale de una
  //    palabra del renglón, y si no hay ninguna, se dice que no se supo.
  let dudosos = 0;
  tablas.forEach((f, i) => {
    const linea = f.join(' ');
    const fe = fecha(f[0]) || fecha(linea);
    if (!fe) return;
    const montos = (linea.match(MONTO_SUELTO) || []).map(num).filter(x => x !== 0);
    if (!montos.length) return;
    const valor = Math.abs(montos.length > 1 ? montos[montos.length - 2] : montos[0]);
    const esSalida = /cargo|retiro|pago|compra|comision|salida|debito|egreso/i.test(linea);
    const esEntrada = /abono|deposito|dep[oó]sito|entrada|credito|ingreso|transferencia recibida/i.test(linea);
    if (!esSalida && !esEntrada) dudosos++;
    movs.push({ _f: fe, fecha: enPalabras(fe), orden: clave(fe),
                descripcion: linea.replace(MONTO_SUELTO, '').replace(/\s+/g, ' ').trim().slice(0, 120),
                entrada: esEntrada ? valor : 0,
                salida: esEntrada ? 0 : valor,
                dudoso: !esSalida && !esEntrada, linea: i + 1 });
  });
  return { movs, como: 'sin-encabezados', dudosos,
           aviso: 'El estado de cuenta llegó sin una fila de encabezados, así que se leyó ' +
                  'renglón por renglón.' +
                  (dudosos ? ' En ' + dudosos + (dudosos === 1 ? ' movimiento' : ' movimientos') +
                             ' no se pudo saber si es entrada o salida y se tomaron como salida: ' +
                             'revísalos antes de dar nada de alta.' : '') };
}

// Emparejar el banco contra lo capturado: mismo monto y fecha cercana.
// Uno a uno: un movimiento del ERP no puede casar con dos del banco.
function cruzar(delBanco, delErp, tolerancia) {
  const tol = tolerancia == null ? 3 : Math.max(0, Math.min(15, +tolerancia || 0));
  const libres = delErp.map((m, i) => ({ m, i, usado: false }));
  const cuadran = [], soloBanco = [];
  delBanco.forEach(b => {
    let mejor = null;
    libres.forEach(c => {
      if (c.usado) return;
      const mismoMonto = Math.abs(c.m.entrada - b.entrada) < 0.5 &&
                         Math.abs(c.m.salida - b.salida) < 0.5;
      if (!mismoMonto) return;
      const d = diasEntre(c.m._f, b._f);
      if (d > tol) return;
      // A igual distancia manda el que se parece en la descripción
      const parecido = (() => {
        const a = norm(b.descripcion), z = norm(c.m.descripcion + ' ' + c.m.referencia);
        if (!a || !z) return 0;
        const palabras = a.split(' ').filter(p => p.length > 3);
        if (!palabras.length) return 0;
        return palabras.filter(p => z.indexOf(p) !== -1).length / palabras.length;
      })();
      const puntos = d * 10 - parecido * 5;
      if (!mejor || puntos < mejor.puntos) mejor = { c, puntos, dias: d, parecido };
    });
    if (mejor) {
      mejor.c.usado = true;
      cuadran.push({ banco: b, erp: mejor.c.m, dias: mejor.dias,
                     mismoDia: mejor.dias === 0 });
    } else {
      soloBanco.push(b);
    }
  });
  const soloErp = libres.filter(c => !c.usado).map(c => c.m);
  return { cuadran, soloBanco, soloErp };
}

module.exports = async (req, res) => {
  try {
    const body = req._body || await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    const puedeEscribir = !!core.verifyWriter(body.token);
    const que = norm(body.que);

    const nombres = await cuentasDelArchivo();
    if (!nombres.length) {
      return res.status(400).json({
        error: 'No se pudo leer el archivo de Efectivo (' + ARCHIVO + '). ' +
               'Revisa que esté compartido con la cuenta de servicio.'
      });
    }
    const laCuenta = (n) => nombres.filter(x => norm(x) === norm(n))[0];

    // ---- Escribir un movimiento en una cuenta (lo usan guardar y alta-cruce) ----
    const escribirEn = async (hoja, datos, sello) => {
      const c = await leerCuenta(hoja);
      if (!c.ok) throw new Error('No se pudo leer "' + hoja + '": ' + c.error);
      const H = c.headers, c0 = c.colInicio;
      const dia = fecha(datos.fecha);
      const fila = new Array(H.length).fill('');
      const pon = (nombre, valor) => {
        if (!nombre) return;
        const i = H.indexOf(nombre);
        if (i !== -1 && valor !== '' && valor != null) fila[i] = valor;
      };
      pon(c.cols.cF, txt(datos.fecha));
      if (dia) { pon(c.cols.cMes, dia.m); pon(c.cols.cAnio, dia.a); }
      pon(c.cols.cCon, txt(datos.concepto));
      pon(c.cols.cDes, txt(datos.descripcion));
      pon(c.cols.cCat, txt(datos.categoria));
      pon(c.cols.cSub, txt(datos.subcategoria));
      pon(c.cols.cCliPro, txt(datos.quien));
      if (!c.cols.cCliPro) { pon(c.cols.cCli, txt(datos.quien)); }
      pon(c.cols.cRef, txt(datos.referencia));
      pon(c.cols.cComp, txt(datos.comprobante));
      pon(c.cols.cComent, txt(datos.comentarios));
      if (datos.entrada) pon(c.cols.cEnt, redondo(datos.entrada));
      if (datos.salida) pon(c.cols.cSal, redondo(datos.salida));
      // El saldo se escribe calculado, para que la hoja siga cuadrando sola
      pon(c.cols.cSaldo, redondo(c.saldo + (datos.entrada || 0) - (datos.salida || 0)));
      const cU = col(H, 'Última actualización', 'Ultima actualizacion');
      if (cU) pon(cU, sello);

      // Dónde escribir: después del último movimiento. Y antes de escribir se
      // relee, por lo del 13 de noviembre.
      const ultima = c.movs.length ? Math.max.apply(null, c.movs.map(m => m.fila))
                                   : c.filaEncabezados;
      const destino = ultima + 1;
      await core._confirmaVacios(ARCHIVO, hoja, destino, 1, H, new Set());
      await core.writeCells(ARCHIVO, [{
        range: "'" + hoja + "'!" + letra(c0) + destino, values: [fila]
      }]);
      return destino;
    };

    // ---- Guardar un movimiento ----
    if (body.guardar) {
      if (!puedeEscribir) {
        return res.status(403).json({ error: 'Tu usuario solo puede consultar.' });
      }
      const tipo = norm(body.tipo);                 // entrada | salida | traspaso
      const monto = Math.abs(num(body.monto));
      if (!monto) return res.status(400).json({ error: 'Falta el monto.' });
      if (!txt(body.fecha)) return res.status(400).json({ error: 'Falta la fecha.' });
      const dia = fecha(body.fecha);
      if (!dia) return res.status(400).json({ error: 'No entendí la fecha "' + txt(body.fecha) + '".' });

      const destinos = [];
      if (tipo === 'traspaso') {
        const de = txt(body.cuenta), a = txt(body.cuentaDestino);
        if (!de || !a) return res.status(400).json({ error: 'Un traspaso necesita cuenta de origen y de destino.' });
        if (norm(de) === norm(a)) return res.status(400).json({ error: 'El traspaso tiene la misma cuenta de los dos lados.' });
        destinos.push({ cuenta: de, entrada: 0, salida: monto,
                        descripcion: txt(body.descripcion) || ('Traspaso a ' + a) });
        destinos.push({ cuenta: a, entrada: monto, salida: 0,
                        descripcion: txt(body.descripcion) || ('Traspaso de ' + de) });
      } else {
        const c = txt(body.cuenta);
        if (!c) return res.status(400).json({ error: 'Elige la cuenta.' });
        if (tipo !== 'entrada' && tipo !== 'salida') {
          return res.status(400).json({ error: 'El movimiento tiene que ser entrada, salida o traspaso.' });
        }
        destinos.push({ cuenta: c, entrada: tipo === 'entrada' ? monto : 0,
                        salida: tipo === 'salida' ? monto : 0,
                        descripcion: txt(body.descripcion) });
      }

      const sello = (sesion.usuario || sesion.u || '') + ' / ' + core.ahoraMx();
      const escritos = [];
      for (const d of destinos) {
        const hoja = laCuenta(d.cuenta);
        if (!hoja) return res.status(400).json({ error: 'No existe la cuenta "' + d.cuenta + '".' });
        const fila = await escribirEn(hoja, {
          fecha: txt(body.fecha),
          concepto: txt(body.concepto) || (tipo === 'traspaso' ? 'Traspaso entre cuentas' : ''),
          descripcion: d.descripcion,
          categoria: txt(body.categoria) || (tipo === 'traspaso' ? 'Traspaso entre cuentas' : ''),
          subcategoria: txt(body.subcategoria) || (tipo === 'traspaso' ? 'Traspaso entre cuentas' : ''),
          quien: txt(body.quien) || txt(body.cliente) || txt(body.proveedor),
          referencia: txt(body.referencia), comprobante: txt(body.comprobante),
          comentarios: txt(body.comentarios),
          entrada: d.entrada, salida: d.salida
        }, sello);
        escritos.push({ cuenta: hoja, fila });
      }
      return res.status(200).json({ ok: true, escritos,
        mensaje: tipo === 'traspaso'
          ? 'Traspaso registrado en las dos cuentas.'
          : 'Movimiento registrado.' });
    }

    // ---- Crear la pestaña Categorías con lo que ya se usa ----
    if (que === 'categorias') {
      if (!puedeEscribir) return res.status(403).json({ error: 'Tu usuario solo puede consultar.' });
      const cuentas = [];
      for (const n of nombres) {
        const c = await leerCuenta(n);
        if (c.ok) cuentas.push(c);
      }
      const L = listasDe(cuentas);
      const filas = [['Concepto', 'Categoría', 'Subcategoría']];
      L.conceptos.forEach(c => {
        const ca = L.categoriaDe[c] || '';
        const su = (L.subsDe[ca] || [])[0] || '';
        filas.push([c, ca, su]);
      });
      // Y las parejas categoría/subcategoría que no quedaron arriba
      L.categorias.forEach(ca => {
        (L.subsDe[ca] || []).forEach(su => {
          if (!filas.some(f => f[1] === ca && f[2] === su)) filas.push(['', ca, su]);
        });
      });
      try {
        await core.asegurarPestana(ARCHIVO, 'Categorías');
        await core.writeCells(ARCHIVO, [{ range: "'Categorías'!A1", values: filas }]);
      } catch (e) {
        return res.status(500).json({ error: 'No se pudo crear la pestaña: ' + e.message });
      }
      return res.status(200).json({ ok: true, filas: filas.length - 1,
        mensaje: 'Se creó la pestaña "Categorías" con ' + (filas.length - 1) + ' renglones.' });
    }

    // ---- Cruzar el estado de cuenta contra lo capturado ----
    if (que === 'cruce' || que === 'alta-cruce') {
      const hoja = laCuenta(txt(body.cuenta));
      if (!hoja) return res.status(400).json({ error: 'Elige la cuenta contra la que se va a cruzar.' });
      const c = await leerCuenta(hoja);
      if (!c.ok) return res.status(400).json({ error: 'No se pudo leer "' + hoja + '": ' + c.error });

      const leido = leerEstadoDeCuenta(body.texto);
      if (!leido.movs.length) {
        return res.status(400).json({
          error: 'No se entendió ningún movimiento de lo que pegaste.',
          pista: 'Pega el estado de cuenta con su renglón de encabezados (Fecha, ' +
                 'Descripción y Cargo/Abono o Importe). Sirve copiado de Excel, ' +
                 'del CSV del banco o separado por comas.',
          como: leido.como, aviso: leido.aviso
        });
      }
      // Solo se compara contra el periodo que trae el estado de cuenta: si no,
      // todo lo de los otros meses saldría como "solo en el ERP".
      //
      // La ventana se abre los mismos días de la tolerancia por cada lado. Sin
      // eso, un movimiento que el banco registra dos días después del corte
      // quedaba fuera del periodo y salía como "falta capturar" aunque estuviera
      // capturado: la tolerancia no servía de nada en las orillas.
      const tolDias = body.tolerancia == null ? 3 : Math.max(0, Math.min(15, +body.tolerancia || 0));
      const corre = (f, dias) => {
        const d = new Date(Date.UTC(f.a, f.m - 1, f.d + dias));
        return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
      };
      const masViejo = leido.movs.reduce((a, b2) => a.orden <= b2.orden ? a : b2);
      const masNuevo = leido.movs.reduce((a, b2) => a.orden >= b2.orden ? a : b2);
      const desde = clave(corre(masViejo._f, -tolDias));
      const hasta = clave(corre(masNuevo._f, tolDias));
      const delPeriodo = c.movs.filter(m => m.orden >= desde && m.orden <= hasta);
      const r = cruzar(leido.movs, delPeriodo, tolDias);

      // ---- Dar de alta lo que solo está en el banco ----
      if (que === 'alta-cruce') {
        if (!puedeEscribir) return res.status(403).json({ error: 'Tu usuario solo puede consultar.' });
        const cuales = Array.isArray(body.cuales) ? body.cuales : null;
        const sello = (sesion.usuario || sesion.u || '') + ' / ' + core.ahoraMx();
        const altas = [];
        for (let i = 0; i < r.soloBanco.length; i++) {
          if (cuales && cuales.indexOf(i) === -1) continue;
          const b = r.soloBanco[i];
          const fila = await escribirEn(hoja, {
            fecha: b.fecha, concepto: txt(body.concepto),
            descripcion: b.descripcion || 'Del estado de cuenta',
            categoria: txt(body.categoria), subcategoria: txt(body.subcategoria),
            referencia: b.descripcion,
            comentarios: 'Dado de alta del estado de cuenta',
            entrada: b.entrada, salida: b.salida
          }, sello);
          altas.push({ fecha: b.fecha, monto: b.entrada || b.salida, fila });
        }
        return res.status(200).json({ ok: true, cuenta: hoja, altas,
          mensaje: altas.length + (altas.length === 1 ? ' movimiento dado de alta en '
                                                      : ' movimientos dados de alta en ') + hoja });
      }

      const suma = (a, f) => redondo(a.reduce((s, x) => s + f(x), 0));
      return res.status(200).json({
        ok: true, cuenta: hoja,
        como: leido.como, aviso: leido.aviso, encabezados: leido.encabezados || null,
        periodo: { desde: enPalabras(masViejo._f), hasta: enPalabras(masNuevo._f) },
        tolerancia: tolDias,
        banco: {
          movs: leido.movs.length,
          entradas: suma(leido.movs, m => m.entrada),
          salidas: suma(leido.movs, m => m.salida)
        },
        erp: {
          movs: delPeriodo.length,
          entradas: suma(delPeriodo, m => m.entrada),
          salidas: suma(delPeriodo, m => m.salida)
        },
        cuadran: r.cuadran.map(x => ({
          fecha: x.banco.fecha, descripcion: x.banco.descripcion,
          entrada: x.banco.entrada, salida: x.banco.salida,
          dias: x.dias, filaErp: x.erp.fila, enElErp: x.erp.descripcion
        })),
        soloBanco: r.soloBanco.map((b, i) => ({
          i, fecha: b.fecha, descripcion: b.descripcion,
          entrada: b.entrada, salida: b.salida, dudoso: !!b.dudoso
        })),
        soloErp: r.soloErp.map(m => ({
          fila: m.fila, fecha: m.fecha, concepto: m.concepto, descripcion: m.descripcion,
          entrada: m.entrada, salida: m.salida
        })),
        diferencia: redondo(
          (suma(leido.movs, m => m.entrada) - suma(leido.movs, m => m.salida)) -
          (suma(delPeriodo, m => m.entrada) - suma(delPeriodo, m => m.salida))),
        nota: 'Se empareja por monto igual y fecha cercana (± ' + tolDias + ' días), uno a uno. ' +
              'Nada se escribe hasta que lo confirmes.'
      });
    }

    // ---- Leer todo ----
    //
    // El archivo trae 3,800 movimientos, así que NO se mandan todos: se manda el
    // año que se está viendo y, de lo anterior, solo el saldo con el que arranca.
    const hoy = new Date();
    const cuentas = [];
    const crudas = [];
    const aniosSet = {};
    for (const n of nombres) {
      const c = await leerCuenta(n);
      if (!c.ok) { cuentas.push({ cuenta: n, error: c.error, movs: [] }); continue; }
      crudas.push(c);
      c.movs.forEach(m => { if (m.anio) aniosSet[m.anio] = 1; });
    }
    const anios = Object.keys(aniosSet).sort().reverse();
    const anio = body.anio ? +body.anio : (anios.length ? +anios[0] : hoy.getFullYear());

    crudas.forEach(c => {
      const delAnio = c.movs.filter(m => m.anio === anio);
      const antes = c.movs.filter(m => m.anio && m.anio < anio);
      const saldoInicial = redondo(antes.reduce((s, m) => s + m.entrada - m.salida, 0));
      const ult = c.movs.length ? c.movs[c.movs.length - 1] : null;
      cuentas.push({
        cuenta: c.hoja, saldo: c.saldo, saldoInicial,
        totalMovs: c.movs.length,
        movs: delAnio.map(m => ({
          fila: m.fila, fecha: m.fecha, orden: m.orden, anio: m.anio, mes: m.mes,
          concepto: m.concepto, descripcion: m.descripcion, categoria: m.categoria,
          subcategoria: m.subcategoria, quien: m.quien, referencia: m.referencia,
          comentarios: m.comentarios, entrada: m.entrada, salida: m.salida,
          saldo: m.saldo, traspaso: m.traspaso
        })),
        ultimo: ult ? { fecha: ult.fecha, descripcion: ult.descripcion,
                        entrada: ult.entrada, salida: ult.salida } : null,
        // Cuando la columna Saldo de la hoja no cuadra con el corrido del ERP
        saldoRoto: c.saldoRoto, primerRoto: c.primerRoto,
        saldoFinalHoja: c.saldoFinalHoja, desordenados: c.desordenados,
        columnas: c.headers.filter(Boolean)
      });
    });

    // Conciliaciones (y se crea la pestaña si no está)
    let conci = await leerConciliaciones();
    if (!conci.existe) { if (await crearConciliaciones()) conci = { filas: [], existe: true }; }

    // Las listas de los desplegables: la pestaña manda; si no hay, lo capturado
    const deLaPestana = await listasDeLaPestana();
    const listas = deLaPestana || listasDe(crudas);
    listas.hayPestana = !!deLaPestana;

    return res.status(200).json({
      ok: true,
      moneda: 'MXN',
      puedeEscribir,
      archivo: 'https://docs.google.com/spreadsheets/d/' + ARCHIVO,
      anio, anios,
      cuentas,
      listas,
      conciliaciones: conci.filas,
      hayConciliaciones: conci.existe,
      nota: 'El saldo lo calcula el ERP movimiento a movimiento. El de la hoja ' +
            'se usa solo para comparar.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
