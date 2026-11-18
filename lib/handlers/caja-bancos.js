// ===== Efectivo y Bancos =====
//
// Val, 18 nov: una sección con Resumen, una pestaña por cuenta y Flujo de
// efectivo. *"Solo métele y luego te digo de dónde se jala la info."*
//
// Por eso las cuentas **no están escritas en el código**: se descubren solas.
// Cualquier pestaña del archivo *Registro de Efectivo* que tenga una fila de
// encabezados con "Fecha" y columnas de Entradas/Salidas es una cuenta. Hoy eso
// da Caja Chica, Efectivo General y CETES. El día que me diga de dónde salen
// los movimientos de BBVA, esa cuenta aparece sin tocar nada más.
//
//   ?action=caja-bancos                  → todo: resumen, cuentas, flujo
//   ?action=caja-bancos&guardar=1        → un movimiento (entrada, salida o traspaso)
//
// El saldo **no se captura**: lo calcula el ERP, movimiento a movimiento, desde
// el saldo inicial de cada cuenta. El de la hoja se usa solo para comparar.
const CFG = require('../config');
const core = require('../core');

const ARCHIVO = CFG.ARCHIVOS.EFECTIVO;
// Pestañas que no son cuentas
const NO_SON_CUENTA = ['portada', 'resumen', 'categorias', 'categorías',
                       'etiquetas perch', 'hoja 10', 'conciliaciones', 'config'];

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
       .match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de\s+)?(\d{4})/);
  if (g && MES_NUM[g[2]]) return { a: +g[3], m: MES_NUM[g[2]], d: +g[1] };
  return null;
}
const clave = (f) => f ? f.a * 10000 + f.m * 100 + f.d : 0;
const enPalabras = (f) => f ? f.d + ' ' + MESES[f.m - 1] + ' ' + f.a : '';
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
function letra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// Un movimiento es traspaso si lo dice su concepto o su categoría
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
  const cF = col(H, 'Fecha'), cEnt = col(H, 'Entradas', 'Entrada', 'Abono', 'Abonos'),
        cSal = col(H, 'Salidas', 'Salida', 'Cargo', 'Cargos'),
        cCon = col(H, 'Concepto Estado de Cuenta', 'Concepto'),
        cDes = col(H, 'Descripción', 'Descripcion'),
        cCat = col(H, 'Categoría', 'Categoria'),
        cCli = col(H, 'Cliente'), cPro = col(H, 'Proveedor'),
        cSaldo = col(H, 'Saldo'), cRef = col(H, 'Referencia'),
        cComp = col(H, 'Comprobante'), cComent = col(H, 'Comentarios');
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
      concepto: conc, descripcion: desc,
      categoria: cCat ? txt(g(cCat)) : '',
      cliente: cCli ? txt(g(cCli)) : '',
      proveedor: cPro ? txt(g(cPro)) : '',
      referencia: cRef ? txt(g(cRef)) : '',
      comprobante: cComp ? txt(g(cComp)) : '',
      comentarios: cComent ? txt(g(cComent)) : '',
      entrada: ent, salida: sal,
      saldoHoja: cSaldo ? txt(g(cSaldo)) : ''
    });
  }
  // Del MÁS ANTIGUO al MÁS RECIENTE. Los que no traen fecha se quedan al final,
  // en el orden en que están capturados: inventarles una fecha sería peor.
  movs.sort((a, b) => (a.orden || 9e14) - (b.orden || 9e14) || a.fila - b.fila);
  let saldo = 0;
  movs.forEach(m => {
    saldo = Math.round((saldo + m.entrada - m.salida) * 100) / 100;
    m.saldo = saldo;                      // calculado por el ERP, no leído
    m.traspaso = esTraspaso(m);
  });
  return { ok: true, hoja, headers: H, filaEncabezados: hr + 1, colInicio: c0,
           movs, saldo, H, cols: { cF, cEnt, cSal, cCon, cDes, cCat, cCli, cPro,
                                   cSaldo, cRef, cComp, cComent } };
}

// Las pestañas del archivo que son cuentas
async function cuentasDelArchivo() {
  let nombres = [];
  try { nombres = await core.listarPestanas(ARCHIVO); }
  catch (e) { nombres = []; }
  return nombres.filter(n => NO_SON_CUENTA.indexOf(norm(n)) === -1);
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

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    const puedeEscribir = !!core.verifyWriter(body.token);

    const nombres = await cuentasDelArchivo();
    if (!nombres.length) {
      return res.status(400).json({
        error: 'No se pudo leer el archivo de Efectivo (' + ARCHIVO + '). ' +
               'Revisa que esté compartido con la cuenta de servicio.'
      });
    }

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
        if (nombres.filter(n => norm(n) === norm(d.cuenta)).length === 0) {
          return res.status(400).json({ error: 'No existe la cuenta "' + d.cuenta + '".' });
        }
        const hoja = nombres.filter(n => norm(n) === norm(d.cuenta))[0];
        const c = await leerCuenta(hoja);
        if (!c.ok) return res.status(400).json({ error: 'No se pudo leer "' + hoja + '": ' + c.error });
        const H = c.headers, c0 = c.colInicio;
        const fila = new Array(H.length).fill('');
        const pon = (nombre, valor) => {
          if (!nombre) return;
          const i = H.indexOf(nombre);
          if (i !== -1 && valor !== '' && valor != null) fila[i] = valor;
        };
        pon(c.cols.cF, txt(body.fecha));
        pon(col(H, 'Mes'), dia.m);
        pon(c.cols.cCon, txt(body.concepto) || (tipo === 'traspaso' ? 'Traspaso entre cuentas' : ''));
        pon(c.cols.cDes, d.descripcion);
        pon(c.cols.cCat, txt(body.categoria));
        pon(c.cols.cCli, txt(body.cliente));
        pon(c.cols.cPro, txt(body.proveedor));
        pon(c.cols.cRef, txt(body.referencia));
        pon(c.cols.cComp, txt(body.comprobante));
        pon(c.cols.cComent, txt(body.comentarios));
        if (d.entrada) pon(c.cols.cEnt, d.entrada);
        if (d.salida) pon(c.cols.cSal, d.salida);
        // El saldo se escribe calculado, para que la hoja siga cuadrando sola
        pon(c.cols.cSaldo, Math.round((c.saldo + d.entrada - d.salida) * 100) / 100);
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
        escritos.push({ cuenta: hoja, fila: destino });
      }
      return res.status(200).json({ ok: true, escritos,
        mensaje: tipo === 'traspaso'
          ? 'Traspaso registrado en las dos cuentas.'
          : 'Movimiento registrado.' });
    }

    // ---- Leer todo ----
    const cuentas = [];
    for (const n of nombres) {
      const c = await leerCuenta(n);
      if (!c.ok) { cuentas.push({ cuenta: n, error: c.error, movs: [] }); continue; }
      const ult = c.movs.length ? c.movs[c.movs.length - 1] : null;
      cuentas.push({
        cuenta: n, saldo: c.saldo, movs: c.movs,
        ultimo: ult ? { fecha: ult.fecha, descripcion: ult.descripcion,
                        entrada: ult.entrada, salida: ult.salida } : null,
        columnas: c.headers.filter(Boolean)
      });
    }

    // Conciliaciones (y se crea la pestaña si no está)
    let conci = await leerConciliaciones();
    if (!conci.existe) { if (await crearConciliaciones()) conci = { filas: [], existe: true }; }

    // Años con movimientos
    const anios = {};
    cuentas.forEach(c => (c.movs || []).forEach(m => { if (m.anio) anios[m.anio] = 1; }));

    return res.status(200).json({
      ok: true,
      moneda: 'MXN',
      puedeEscribir,
      archivo: 'https://docs.google.com/spreadsheets/d/' + ARCHIVO,
      cuentas,
      anios: Object.keys(anios).sort().reverse(),
      conciliaciones: conci.filas,
      hayConciliaciones: conci.existe,
      nota: 'El saldo lo calcula el ERP movimiento a movimiento. El de la hoja ' +
            'se usa solo para comparar.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
