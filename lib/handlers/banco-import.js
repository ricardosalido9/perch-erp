// Subir un estado de cuenta o un detalle de movimientos y proponer la captura.
//
// El ERP NUNCA escribe solo: este endpoint solo propone. La escritura pasa por
// 'banco-aprobar', y ahí sí queda registrado quién aprobó cada renglón.
//
// De dónde sale cada cosa:
//   fecha, concepto, total, cuenta   -> del PDF
//   descripción                      -> de la referencia que ustedes escriben al transferir
//   cliente / proveedor              -> se busca en las listas y en las ventas
//   categoría y subcategoría         -> del catálogo, con lo aprendido en "Reglas del banco"
//   factura, UUID, concepto CFDI     -> se dejan vacíos: eso lo liga el paso de CFDIs
const core = require('../core');
const CFG = require('../config');
const lector = require('../banco-lector');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
  sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
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
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3]*10000 + MESES_N[m[2]]*100 + +m[1];
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function leerHoja(id, pestana) {
  if (!id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(id, pestana); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  // Los encabezados no siempre están en la primera fila. En el catálogo, la fila 1
  // trae los títulos de bloque ("Ingresos", "Egresos", "Colaboradores") y los
  // encabezados de verdad están en la fila 2. Se busca la fila que los tenga.
  let hr = 0;
  for (let k = 0; k < Math.min(4, values.length); k++) {
    const fila = (values[k] || []).map(x => norm(x));
    if (fila.indexOf('concepto') !== -1 || fila.indexOf('fecha') !== -1 ||
        fila.indexOf('categoria') !== -1) { hr = k; break; }
  }
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; headers.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers, rows, matriz: values.slice(hr + 1), filaEncabezados: hr + 1 };
}

// El banco abrevia y corta los nombres de los comercios: "FACEBK" por Facebook,
// "HOME DEPOT8691 COPILCO" por Home Depot. Para reconocerlos contra la lista de
// proveedores se comparan solo las letras y basta con que una sea el arranque de
// la otra, con al menos cinco letras para no confundir nombres cortos.
function soloLetras(s) {
  return norm(s).replace(/[^a-z]/g, '');
}
function seParecen(a, b) {
  const x = soloLetras(a), y = soloLetras(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const corto = x.length <= y.length ? x : y;
  const largo = x.length <= y.length ? y : x;
  if (corto.length < 5) return false;
  if (largo.indexOf(corto) !== -1) return true;
  // El banco no solo corta, también quita letras de en medio: "FACEBK" por
  // "FACEBOOK". Se acepta si las letras del corto aparecen EN ORDEN dentro del
  // largo y las primeras cuatro coinciden, para no juntar nombres parecidos.
  if (corto.slice(0, 4) !== largo.slice(0, 4)) return false;
  let i = 0;
  for (let j = 0; j < largo.length && i < corto.length; j++) {
    if (largo[j] === corto[i]) i++;
  }
  return i === corto.length;
}

// Palabras que aparecen en la referencia y apuntan a un concepto del catálogo.
// No adivinan la categoría: solo proponen el concepto, que es el que la manda.
const PISTAS = [
  { palabras: /redes|pauta|publicidad|marketing|instagram|facebook|meta ads/i, concepto: /marketing|publicidad/i },
  { palabras: /renta/i, concepto: /renta/i },
  { palabras: /flete|paqueter|envio|envío|entrega|guia|guía/i, concepto: /env[ií]o|entrega/i },
  { palabras: /tela|piel|tapicer/i, concepto: /tela|piel/i },
  { palabras: /marmol|mármol/i, concepto: /marmol|mármol/i },
  { palabras: /nomina|nómina|sueldo/i, concepto: /nomina|nómina|sueldo/i },
  { palabras: /honorario/i, concepto: /honorario/i },
  { palabras: /comision|comisión/i, concepto: /comision|comisión/i },
  { palabras: /seguro|fianza/i, concepto: /seguro|fianza/i },
  { palabras: /papeler|oficina/i, concepto: /papeler|oficina/i },
  { palabras: /carpinter/i, concepto: /carpinter/i },
  { palabras: /herrer/i, concepto: /herrer/i },
  { palabras: /limpieza/i, concepto: /limpieza/i },
  { palabras: /empaque|huacal/i, concepto: /empaque/i },
  { palabras: /mantenimiento/i, concepto: /mantenimiento/i },
  { palabras: /viatico|viático|gasolina|caseta|tag/i, concepto: /viatico|viático/i }
];

// Los movimientos que NO son ingreso ni egreso de la empresa, pero que sí se
// capturan con su propia categoría porque el dinero sí se movió de cuenta.
const TRASPASO = /traspaso cuentas propias|traspaso entre cuentas/i;
// El pago de la tarjeta tampoco es flujo: el gasto fue cuando se usó la tarjeta.
// El Dashboard y Gastos operativos ya lo excluían por texto; aquí no, así que al
// subir el estado de BBVA el pago a AMEX se proponía como un egreso más y había
// que corregirlo a mano cada mes.
const PAGO_TARJETA = /pago (de |a )?tarjeta|pago de tarjetas|american express|\bamex\b|tarjeta de cr[eé]dito/i;
const DEVUELTO = /devuelto|devolucion|devolución/i;
const IMPUESTO = /\bsat\b|imss|infonavit|afore|sipare/i;
const COMISION = /serv banca|iva com serv|comision|comisión/i;

// El catálogo viene en bloques paralelos dentro de la misma pestaña: uno para
// ingresos y otro para egresos, cada uno con Concepto, Método, Cuenta, la lista
// de clientes o proveedores, y Categoría y Subcategoría.
//
// La relación es: se elige un CONCEPTO y de ahí salen la categoría y la
// subcategoría. No se eligen las tres por separado.
function leerCatalogo(cats) {
  const vacio = { hay: false, ingresos: [], egresos: [], cuentas: [], metodos: {} };
  if (!cats.headers.length) return vacio;
  const H = cats.headers;
  // Las columnas se repiten con el mismo nombre en los dos bloques, así que se
  // localizan por posición: la primera "Concepto" es la de ingresos y la segunda
  // la de egresos.
  const posiciones = (nombre) => H.map((h, i) => norm(h) === norm(nombre) ? i : -1)
                                  .filter(i => i !== -1);
  const iConcepto = posiciones('Concepto');
  const iCat = posiciones('Categoría').concat(posiciones('Categoria'));
  const iSub = posiciones('Subcategoría').concat(posiciones('Subcategoria'));
  const iCuenta = posiciones('Cuenta');
  const iMetCobro = posiciones('Método de cobro').concat(posiciones('Metodo de cobro'));
  const iMetPago = posiciones('Método de pago').concat(posiciones('Metodo de pago'));

  // Los encabezados se repiten entre bloques, así que los renglones se leen por
  // POSICIÓN. Por eso el handler guarda también la matriz cruda.
  const M = cats.matriz || [];
  const bloque = (ci, cati, subi) => {
    if (ci == null || cati == null) return [];
    const out = [], vistos = {};
    M.forEach(f => {
      const concepto = txt(f[ci]);
      if (!concepto || vistos[norm(concepto)]) return;
      vistos[norm(concepto)] = 1;
      out.push({
        concepto: concepto,
        categoria: txt(cati == null ? '' : f[cati]),
        subcategoria: txt(subi == null ? '' : f[subi])
      });
    });
    return out;
  };
  const columna = (i) => {
    if (i == null) return [];
    const out = [], vistos = {};
    M.forEach(f => {
      const v = txt(f[i]);
      if (v && !vistos[norm(v)]) { vistos[norm(v)] = 1; out.push(v); }
    });
    return out;
  };

  return {
    hay: true,
    ingresos: bloque(iConcepto[0], iCat[0], iSub[0]),
    egresos: bloque(iConcepto[1], iCat[1], iSub[1]),
    cuentas: columna(iCuenta[0]).concat(columna(iCuenta[1]))
      .filter((v, i, a) => a.map(norm).indexOf(norm(v)) === i),
    metodos: {
      INGRESO: columna(iMetCobro[0]),
      EGRESO: columna(iMetPago[0])
    },
    // Las listas del propio catálogo: para ingresos se sugiere un CLIENTE y para
    // egresos un PROVEEDOR. No es lo mismo y no deben mezclarse.
    clientes: columna(posiciones('Lista de Clientes_Perch')[0]),
    proveedores: columna(
      H.map((h, i) => /lista de proveedores/i.test(String(h)) ? i : -1)
       .filter(i => i !== -1)[0])
  };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    if (!body.pdf) return res.status(400).json({ error: 'No llegó el archivo.' });

    // ---- 1. Sacar el texto del PDF ----
    let texto = '';
    try {
      // Se extrae conservando las columnas: sin eso no se puede saber si un
      // número es cargo o abono, porque el PDF no lo dice, solo lo alinea.
      const { extraer } = require('../pdf-texto');
      texto = await extraer(Buffer.from(body.pdf, 'base64'));
    } catch (e) {
      return res.status(400).json({
        error: 'No se pudo leer el PDF.',
        pista: 'Si el archivo es un escaneo (una foto del estado de cuenta), no trae ' +
               'texto y no se puede leer. Descárgalo de la banca en línea.',
        detalle: (e && e.message) || ''
      });
    }
    if (!/\d/.test(texto)) {
      return res.status(400).json({
        error: 'El PDF no trae texto, parece un escaneo.',
        pista: 'Descarga el estado de cuenta directo de BBVA en vez de escanearlo.'
      });
    }

    const cuenta = txt(body.cuenta);
    const anio = +body.anio || new Date().getFullYear();
    // De dónde viene el archivo. Si la pantalla lo dice, se corre ese lector y
    // nada más: así, cuando algo falla, el error habla del formato que se pidió y
    // no de "no encontré movimientos", que puede querer decir cualquier cosa.
    // Con 'auto' se prueba BBVA y luego los otros, como antes.
    const pedido = txt(body.fuente).toLowerCase();
    const otros = require('../banco-otros');
    const ctx = { cuenta: cuenta, anio: anio, mesCorte: +body.mesCorte || null };
    let movs = [], fuente = 'BBVA';

    if (pedido === 'paypal' || pedido === 'amex') {
      const r = pedido === 'paypal'
        ? { fuente: 'PayPal', movimientos: otros.leerPayPal(texto, ctx) }
        : { fuente: 'American Express', movimientos: otros.leerAmex(texto, ctx) };
      fuente = r.fuente;
      // Los pares que se anulan entre sí no se proponen: PayPal cobra la factura
      // y de inmediato carga la tarjeta, así que no es dinero que entre ni salga.
      movs = (r.movimientos || []).filter(m => !m.anulado);
      if (!movs.length) {
        const detectado = otros.detectar(texto);
        return res.status(400).json({
          error: 'No se encontraron movimientos con el formato de ' + r.fuente + '.',
          pista: detectado && detectado !== pedido
            ? 'El archivo se parece más a uno de ' + detectado + '. Cámbialo en ' +
              '"De dónde es el archivo" y vuelve a leerlo.'
            : 'Revisa que sea el estado de cuenta y no la carátula ni el resumen. ' +
              'Si el formato de ' + r.fuente + ' cambió, manda el PDF y se ajusta el lector.',
          fuente: r.fuente
        });
      }
    } else if (pedido === 'bbva') {
      movs = lector.leer(texto, ctx);
      if (!movs.length) {
        const detectado = otros.detectar(texto);
        return res.status(400).json({
          error: 'No se encontraron movimientos con el formato de BBVA.',
          pista: detectado
            ? 'El archivo se parece a uno de ' + detectado + '. Cámbialo en ' +
              '"De dónde es el archivo" y vuelve a leerlo.'
            : 'Se leen los dos formatos de BBVA: el estado de cuenta del mes y el ' +
              'detalle de BBVAnet. Revisa que no sea la carátula.',
          fuente: 'BBVA'
        });
      }
    } else {
      movs = lector.leer(texto, ctx);
    }

    // Si no es un estado de cuenta del banco, se prueban PayPal y American
    // Express, que traen otro formato y otras reglas de signo.
    if (!movs.length) {
      const r = otros.leer(texto, ctx);
      if (r.movimientos.length) {
        fuente = r.fuente;
        // Los pares que se anulan entre sí no se proponen: PayPal cobra la
        // factura y de inmediato carga la tarjeta, así que no es dinero que
        // entre ni salga de la empresa.
        movs = r.movimientos.filter(m => !m.anulado);
      }
    }
    if (!movs.length) {
      // Ya se reconocen BBVA, PayPal y American Express. Si el PDF trae el nombre
      // de otro banco, se dice cuál en vez de mandar a buscar un error que no está.
      const otroBanco = /santander|banorte|banamex|citibanamex|hsbc|scotiabank|inbursa|azteca/i;
      const cual = (texto.match(otroBanco) || [])[0];
      return res.status(400).json({
        error: cual ? 'Este estado de cuenta parece ser de ' + cual + '.'
                    : 'No se encontraron movimientos en el archivo.',
        pista: cual
          ? 'Por ahora se leen BBVA, PayPal y American Express. Cada banco acomoda ' +
            'las columnas distinto, así que hay que enseñarle ese formato. Manda un ' +
            'PDF de ejemplo y se agrega.'
          : 'Revisa que sea el estado de cuenta o el detalle de movimientos, ' +
            'no la carátula ni el comprobante fiscal.',
        banco: cual || ''
      });
    }

    // ---- 2. Lo que el ERP ya sabe ----
    const idFin = CFG.ARCHIVOS.FINANZAS;
    const [ing, egr, cats, reglas, clientes, provs, cxc, gastos] = await Promise.all([
      leerHoja(idFin, CFG.PESTANAS.ingresos),
      leerHoja(idFin, CFG.PESTANAS.egresos),
      // El catálogo está en su propio archivo. Si ahí no está, se busca en Finanzas.
      leerHoja(CFG.ARCHIVOS.CATALOGO_CUENTAS || idFin, CFG.PESTANAS.categorias)
        .then(x => x.headers.length ? x : leerHoja(idFin, CFG.PESTANAS.categorias)),
      leerHoja(idFin, 'Reglas del banco'),
      leerHoja(CFG.ARCHIVOS.CLIENTES, CFG.PESTANAS.clientes),
      leerHoja(CFG.ARCHIVOS.PROVEEDORES, CFG.PESTANAS.proveedores),
      // Cuentas por cobrar: para proponer de quién es un depósito
      leerHoja(CFG.ARCHIVOS.VENTAS, CFG.PESTANAS.cxc),
      // Los pagos que Nico solicitó: un egreso que cuadra con uno de estos ya
      // trae proveedor, pedido y concepto, así que no hay que adivinar nada.
      leerHoja(CFG.ARCHIVOS.OPERACION, CFG.PESTANAS.gastosManuales)
    ]);

    // El catálogo se lee una vez y se usa en todo lo que sigue
    const cat0 = leerCatalogo(cats);

    // ---- Lo ya capturado, para no duplicar y para cuadrar ----
    // No se compara solo por fecha exacta: el banco tiene fecha de operación y de
    // liquidación, y ustedes pueden haber capturado cualquiera de las dos. Se busca
    // el mismo monto en la misma cuenta dentro de una ventana de días.
    const VENTANA = 4;
    const capturados = [];
    const indexar = (hoja, tipo) => {
      if (!hoja.headers.length) return;
      const cF = col(hoja.headers, 'Fecha');
      const cT = col(hoja.headers, 'Total');
      const cC = col(hoja.headers, 'Cuenta');
      const cCon = col(hoja.headers, 'Concepto');
      const cDes = col(hoja.headers, 'Descripción', 'Descripcion');
      if (!cF || !cT) return;
      hoja.rows.forEach((r, i) => {
        const monto = Math.abs(parseFloat(String(r[cT]).replace(/[^0-9.\-]/g, '')) || 0);
        if (!monto) return;
        capturados.push({
          fila: i + 2, tipo: tipo, monto: monto,
          fecha: fechaNum(r[cF]),
          cuenta: txt(cC ? r[cC] : ''),
          concepto: txt(cCon ? r[cCon] : ''),
          descripcion: txt(cDes ? r[cDes] : ''),
          usado: false
        });
      });
    };
    indexar(ing, 'INGRESO');
    indexar(egr, 'EGRESO');

    // La cuenta se escribe EXACTAMENTE como está en el catálogo, para que quede
    // igual que lo capturado a mano. Antes se armaba el nombre en el código y
    // podía no coincidir con la lista.
    const cuentaLarga = (() => {
      const soloDigitos = cuenta.replace(/\D/g, '');
      const delCatalogo = (cat0.cuentas || []).filter(c =>
        String(c).replace(/\D/g, '') && String(c).replace(/\D/g, '') === soloDigitos)[0];
      if (delCatalogo) return delCatalogo;
      // Si la eligieron por nombre y no por número, se usa tal cual
      const porNombre = (cat0.cuentas || []).filter(c => norm(c) === norm(cuenta))[0];
      return porNombre || cuenta;
    })();
    const mismaCuenta = (a, b) => {
      const da = String(a || '').replace(/\D/g, ''), db = String(b || '').replace(/\D/g, '');
      if (!da || !db) return true;             // si no se sabe, no descarta
      return da.slice(-8) === db.slice(-8);
    };
    // Busca ese movimiento entre lo ya capturado y lo marca como usado
    const buscarCapturado = (m) => {
      const dias = (f) => {
        if (f === null || m.fecha === null) return 99;
        const a = new Date(Math.floor(m.fecha / 10000), Math.floor(m.fecha / 100) % 100 - 1, m.fecha % 100);
        const b = new Date(Math.floor(f / 10000), Math.floor(f / 100) % 100 - 1, f % 100);
        return Math.abs((a - b) / 86400000);
      };
      const cands = capturados.filter(c => !c.usado && c.tipo === m.tipo &&
        Math.abs(c.monto - m.monto) < 0.01 && mismaCuenta(c.cuenta, cuentaLarga) &&
        dias(c.fecha) <= VENTANA);
      if (!cands.length) return null;
      cands.sort((a, b) => dias(a.fecha) - dias(b.fecha));
      cands[0].usado = true;
      return cands[0];
    };

    // Las reglas aprendidas: texto -> categoría, subcategoría, contraparte
    const aprendidas = [];
    if (reglas.headers.length) {
      const rT = col(reglas.headers, 'Texto', 'Concepto', 'Contiene');
      const rTipo = col(reglas.headers, 'Tipo');
      const rCat = col(reglas.headers, 'Categoría', 'Categoria');
      const rSub = col(reglas.headers, 'Subcategoría', 'Subcategoria');
      const rCon = col(reglas.headers, 'Contraparte', 'Cliente', 'Proveedor');
      const rN = col(reglas.headers, 'Veces', 'Veces usada');
      if (rT) reglas.rows.forEach(r => {
        const t = norm(r[rT]);
        if (!t) return;
        aprendidas.push({
          texto: t,
          tipo: txt(rTipo ? r[rTipo] : ''),
          categoria: txt(rCat ? r[rCat] : ''),
          subcategoria: txt(rSub ? r[rSub] : ''),
          contraparte: txt(rCon ? r[rCon] : ''),
          veces: parseInt(txt(rN ? r[rN] : '0'), 10) || 0
        });
      });
      // Primero las reglas más específicas y las más usadas
      aprendidas.sort((a, b) => (b.texto.length - a.texto.length) || (b.veces - a.veces));
    }

    // Nombres de clientes y proveedores, para reconocerlos en la referencia
    const nombres = [];
    const cargarNombres = (hoja, tipo) => {
      if (!hoja.headers.length) return;
      const c = col(hoja.headers, 'Cliente', 'Proveedor', 'Nombre', 'Nombre/Razón Social');
      if (!c) return;
      hoja.rows.forEach(r => {
        const n = txt(r[c]);
        if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo });
      });
    };
    cargarNombres(clientes, 'CLIENTE');
    cargarNombres(provs, 'PROVEEDOR');
    // Las listas del catálogo también cuentan
    (cat0.clientes || []).forEach(n => {
      if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo: 'CLIENTE' });
    });
    (cat0.proveedores || []).forEach(n => {
      if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo: 'PROVEEDOR' });
    });
    nombres.sort((a, b) => b.clave.length - a.clave.length);

    // Lo que los clientes deben: sirve para proponer de quién es un depósito.
    // Se guarda el saldo pendiente de cada folio, no el total de la venta.
    const porCobrar = [];
    if (cxc.headers.length) {
      const xF = col(cxc.headers, 'No. de Referencia', 'Folio');
      const xC = col(cxc.headers, 'Cliente');
      const xS = col(cxc.headers, 'Saldo', 'Por cobrar', 'Pendiente', 'Saldo pendiente');
      const xT = col(cxc.headers, 'Total', 'Total con IVA', 'Importe');
      if (xC) cxc.rows.forEach(r => {
        const saldo = Math.abs(parseFloat(String(r[xS ? xS : xT]).replace(/[^0-9.\-]/g, '')) || 0);
        const total = Math.abs(parseFloat(String(r[xT ? xT : xS]).replace(/[^0-9.\-]/g, '')) || 0);
        const cliente = txt(r[xC]);
        if (!cliente) return;
        porCobrar.push({ folio: txt(xF ? r[xF] : ''), cliente: cliente,
                         saldo: saldo, total: total });
      });
    }
    // Busca a quién le cuadra el depósito: primero contra el saldo pendiente,
    // luego contra el total de la venta. Si le cuadra a más de uno, no adivina.
    const aQuienLeCuadra = (monto) => {
      const casi = (a, b) => b && Math.abs(a - b) <= Math.max(1, b * 0.005);
      let hits = porCobrar.filter(x => casi(monto, x.saldo));
      let porQue = 'coincide con lo que debe';
      if (!hits.length) {
        hits = porCobrar.filter(x => casi(monto, x.total));
        porQue = 'coincide con el total de la venta';
      }
      if (!hits.length) return null;
      // Si le cuadra a varios no se elige uno: se muestran los candidatos para
      // que quien aprueba escoja. Asignarle el depósito al cliente equivocado
      // después es un lío de cobranza.
      return {
        unico: hits.length === 1,
        cliente: hits[0].cliente, folio: hits[0].folio, porQue: porQue,
        opciones: hits.slice(0, 6).map(x => ({ cliente: x.cliente, folio: x.folio,
                                               saldo: Math.round(x.saldo * 100) / 100 }))
      };
    };

    // Los pagos solicitados que siguen sin marcar como pagados
    const solicitados = [];
    if (gastos.headers.length) {
      const gP = col(gastos.headers, 'Proveedor');
      const gT = col(gastos.headers, 'Total con IVA', 'Total', 'Monto');
      const gPed = col(gastos.headers, 'Pedido', 'Pedido Proveedor');
      const gCon = col(gastos.headers, 'Concepto');
      const gDes = col(gastos.headers, 'Descripción', 'Descripcion');
      const gPag = col(gastos.headers, 'Pagado');
      if (gP && gT) gastos.rows.forEach(r => {
        const monto = Math.abs(parseFloat(String(r[gT]).replace(/[^0-9.\-]/g, '')) || 0);
        if (!monto) return;
        solicitados.push({
          proveedor: txt(r[gP]), monto: monto,
          pedido: txt(gPed ? r[gPed] : ''), concepto: txt(gCon ? r[gCon] : ''),
          descripcion: txt(gDes ? r[gDes] : ''),
          pagado: /^(true|si|sí|x|1|pagado|verdadero)$/i.test(txt(gPag ? r[gPag] : ''))
        });
      });
    }
    const pagoSolicitado = (monto) => {
      const casi = (a, b) => b && Math.abs(a - b) <= Math.max(1, b * 0.005);
      let hits = solicitados.filter(x => !x.pagado && casi(monto, x.monto));
      if (!hits.length) hits = solicitados.filter(x => casi(monto, x.monto));
      if (hits.length !== 1) return null;
      return hits[0];
    };

    // ---- 3. Proponer ----
    const propuestas = movs.map(m => {
      const donde = (m.concepto + ' ' + m.descripcion + ' ' + m.referencia);
      const clave = norm(donde);
      const p = {
        fecha: m.fecha,
        fechaTexto: (m.fecha % 100) + ' ' + MESES[Math.floor(m.fecha / 100) % 100 - 1] +
                    ' ' + Math.floor(m.fecha / 10000),
        mes: Math.floor(m.fecha / 100) % 100,
        tipo: m.tipo,
        total: m.monto,
        cuenta: m.cuenta,
        concepto: m.concepto,
        descripcion: m.descripcion || m.referencia,
        conceptoEstadoDeCuenta: (m.concepto + ' ' + m.referencia).trim().slice(0, 180),
        rfc: m.rfc,
        contraparte: '',
        pedido: '',
        candidatos: [],
        conceptoSugerido: '',
        sinContraparte: false,
        categoria: '',
        subcategoria: '',
        confianza: 'nueva',
        porQue: '',
        cuentaLarga: cuentaLarga,
        // Método: si el cargo viene de tarjeta (código A15) es tarjeta; si no,
        // transferencia, que es como se captura casi todo.
        metodo: /^A1\d|^P3\d/.test(m.codigo || '') ? 'Tarjeta Crédito/Débito'
                                                    : 'Depósito/Transferencia electrónica',
        yaCapturado: false, capturadoEn: null
      };
      const yaEsta = buscarCapturado(m);
      if (yaEsta) {
        p.yaCapturado = true;
        p.capturadoEn = { fila: yaEsta.fila, concepto: yaEsta.concepto,
                          descripcion: yaEsta.descripcion };
      }

      // Los casos que se reconocen solos, sin necesidad de regla
      if (TRASPASO.test(donde)) {
        p.categoria = 'Traspaso entre cuentas';
        p.confianza = 'segura';
        // Mover dinero entre cuentas propias no tiene contraparte: no hay cliente
        // ni proveedor porque el dinero no salió de la empresa.
        p.sinContraparte = true;
        p.porQue = 'El banco lo marca como traspaso entre cuentas propias. ' +
                   'No lleva cliente ni proveedor.';
      } else if (/american express|\bamex\b/i.test(m.banco || '') && m.tipo === 'INGRESO') {
        // En el estado de una tarjeta, lo que "entra" es el pago que le hiciste
        // desde el banco. No es un ingreso de la empresa: es el mismo dinero que
        // ya salió de BBVA. Si entrara como ingreso, el mes quedaría inflado por
        // el monto del pago y además contado dos veces contra el cargo original.
        p.categoria = 'Pago de tarjeta';
        p.confianza = 'segura';
        p.sinContraparte = true;
        p.porQue = 'Es el pago que le hiciste a la tarjeta desde el banco, no un ingreso. ' +
                   'Se comporta igual que un traspaso entre cuentas propias.';
      } else if (PAGO_TARJETA.test(donde)) {
        p.categoria = 'Pago de tarjeta';
        p.confianza = 'segura';
        p.sinContraparte = true;
        p.porQue = 'Es el pago de la tarjeta, no un gasto. El gasto fue cuando se usó ' +
                   'la tarjeta, y ese se captura del estado de cuenta de la tarjeta. ' +
                   'Se comporta igual que un traspaso entre cuentas.';
      } else if (DEVUELTO.test(donde)) {
        p.categoria = 'Traspaso entre cuentas';
        p.confianza = 'revisar';
        p.porQue = 'Es una devolución. Si el envío original sí se hizo después, ' +
                   'ese sí se categoriza como el gasto que era.';
      } else if (IMPUESTO.test(donde)) {
        p.confianza = 'revisar';
        p.porQue = 'Parece pago de impuestos o seguridad social.';
      } else if (COMISION.test(donde)) {
        p.confianza = 'revisar';
        p.porQue = 'Parece comisión bancaria.';
      }

      // Lo aprendido manda sobre lo anterior
      const regla = aprendidas.filter(r =>
        clave.indexOf(r.texto) !== -1 && (!r.tipo || norm(r.tipo) === norm(m.tipo)))[0];
      if (regla) {
        p.categoria = regla.categoria || p.categoria;
        p.subcategoria = regla.subcategoria || p.subcategoria;
        p.contraparte = regla.contraparte || p.contraparte;
        p.confianza = regla.veces >= 3 ? 'segura' : 'probable';
        p.porQue = 'Ya lo categorizaste así ' + regla.veces +
                   (regla.veces === 1 ? ' vez.' : ' veces.');
      }

      // En un depósito, si el monto cuadra con lo que un cliente debe, se propone
      // ese cliente y su folio. Es la pista más fuerte que hay.
      if (m.tipo === 'INGRESO' && !p.contraparte) {
        const cuadra = aQuienLeCuadra(m.monto);
        if (cuadra && cuadra.unico) {
          p.contraparte = cuadra.cliente;
          p.pedido = cuadra.folio;
          p.confianza = (p.confianza === 'nueva') ? 'probable' : p.confianza;
          // Si es el cobro de una venta, el concepto es el de cobro a clientes
          const cobro = (cat0.ingresos || []).filter(o => /cobrad|clientes/i.test(o.concepto))[0];
          if (cobro && !p.conceptoSugerido) {
            p.conceptoSugerido = cobro.concepto;
            p.categoria = cobro.categoria;
            p.subcategoria = cobro.subcategoria;
          }
          p.porQue = (p.porQue ? p.porQue + ' ' : '') +
            'El monto ' + cuadra.porQue + ' de ' + cuadra.folio +
            ', de ' + cuadra.cliente + '.';
        } else if (cuadra) {
          p.candidatos = cuadra.opciones;
          p.porQue = (p.porQue ? p.porQue + ' ' : '') +
            'El monto le cuadra a ' + cuadra.opciones.length + ': ' +
            cuadra.opciones.map(o => o.folio + ' de ' + o.cliente).join(', ') +
            '. Elige cuál.';
        }
      }

      // Si no hay concepto todavía, se busca una pista en el texto del movimiento
      if (!p.conceptoSugerido && !p.categoria) {
        const pista = PISTAS.filter(x => x.palabras.test(donde))[0];
        if (pista) {
          const lista = (m.tipo === 'INGRESO') ? cat0.ingresos : cat0.egresos;
          const c = (lista || []).filter(o => pista.concepto.test(o.concepto))[0];
          if (c) {
            p.conceptoSugerido = c.concepto;
            p.categoria = c.categoria;
            p.subcategoria = c.subcategoria;
            p.confianza = (p.confianza === 'nueva') ? 'probable' : p.confianza;
            p.porQue = (p.porQue ? p.porQue + ' ' : '') +
              'Por lo que dice la referencia parece ' + c.concepto.toLowerCase() + '.';
          }
        }
      }

      // Ahora sí, el monto contra los pagos solicitados. Va DESPUÉS del texto a
      // propósito: una coincidencia de monto es débil y el texto es fuerte. Un pago
      // que dice "Dani Redes" no es de un carpintero aunque el monto le cuadre.
      if (m.tipo === 'EGRESO' && !p.contraparte && !p.conceptoSugerido) {
        const sol = pagoSolicitado(m.monto);
        if (sol) {
          p.contraparte = sol.proveedor;
          p.pedido = sol.pedido;
          if (!p.categoria) p.conceptoSugerido = sol.concepto;
          p.descripcionSugerida = sol.descripcion || sol.concepto;
          p.confianza = 'probable';
          p.porQue = (p.porQue ? p.porQue + ' ' : '') +
            'Cuadra con un pago que se pidió a ' + sol.proveedor +
            (sol.pedido ? ' del pedido ' + sol.pedido : '') + '.';
        }
      }

      // El nombre del cliente o proveedor, si aparece escrito en la referencia
      if (!p.contraparte) {
        // En un ingreso la contraparte es un CLIENTE; en un egreso, un PROVEEDOR
        const buscarEn = (m.tipo === 'INGRESO') ? 'CLIENTE' : 'PROVEEDOR';
        let hit = nombres.filter(n => n.tipo === buscarEn && clave.indexOf(n.clave) !== -1)[0];
        if (hit) {
          p.contraparte = hit.nombre;
          if (!p.porQue) p.porQue = 'El nombre aparece en la referencia.';
        } else {
          // El banco abrevia: "FACEBK" contra "FACEBOOK". Se compara la primera
          // palabra del concepto, que es donde va el comercio.
          const primera = txt(m.concepto).split(/[\s*\/]+/)[0];
          hit = nombres.filter(n => n.tipo === buscarEn && seParecen(primera, n.nombre))[0];
          if (hit) {
            p.contraparte = hit.nombre;
            if (!p.porQue) p.porQue = 'El banco lo abrevia como "' + primera +
              '"; en tu lista está como "' + hit.nombre + '".';
          }
        }
      }
      // ---- La descripción ----
      // Es lo que se va a leer en INGRESOS y EGRESOS, así que se arma con lo más
      // útil que se haya encontrado, en este orden:
      //   1. Lo que Nico escribió en la solicitud de pago
      //   2. El folio de la venta que se está cobrando, con el cliente
      //   3. El pedido del proveedor que se está pagando
      //   4. Lo que ustedes escribieron al hacer la transferencia
      const refBanco = txt(m.descripcion) || txt(m.referencia);
      if (p.sinContraparte) {
        p.descripcion = refBanco || 'Traspaso entre cuentas propias';
      } else if (p.descripcionSugerida) {
        p.descripcion = p.descripcionSugerida +
          (p.pedido ? ' · ' + p.pedido : '');
      } else if (m.tipo === 'INGRESO' && p.pedido) {
        p.descripcion = 'Cobro de ' + p.pedido +
          (p.contraparte ? ' · ' + p.contraparte : '') +
          (refBanco ? ' · ' + refBanco : '');
      } else if (m.tipo === 'EGRESO' && p.pedido) {
        p.descripcion = 'Pago del pedido ' + p.pedido +
          (p.contraparte ? ' a ' + p.contraparte : '') +
          (refBanco ? ' · ' + refBanco : '');
      } else {
        p.descripcion = refBanco;
      }
      p.descripcion = String(p.descripcion).slice(0, 180);
      return p;
    });

    const cuenta_ = (f) => propuestas.filter(f).length;
    // Lo que está capturado en la hoja de esas fechas y NO aparece en el banco.
    // Es la otra mitad del cuadre: no basta con no duplicar, hay que saber si
    // sobra algo capturado que el banco nunca cobró.
    const fechas = propuestas.map(p => p.fecha).filter(x => x);
    const desde = Math.min.apply(null, fechas), hasta = Math.max.apply(null, fechas);
    const sobran = capturados.filter(c => !c.usado && c.fecha !== null &&
      c.fecha >= desde && c.fecha <= hasta && mismaCuenta(c.cuenta, cuentaLarga))
      .map(c => ({ fila: c.fila, tipo: c.tipo, fecha: c.fecha,
                   monto: c.monto, concepto: c.concepto, descripcion: c.descripcion }));

    return res.status(200).json({
      ok: true,
      cuenta: cuentaLarga || cuenta,
      fuente: fuente,
      periodo: { desde, hasta },
      movimientos: propuestas.length,
      yaCapturados: cuenta_(x => x.yaCapturado),
      nuevos: cuenta_(x => !x.yaCapturado),
      seguras: cuenta_(x => !x.yaCapturado && x.confianza === 'segura'),
      probables: cuenta_(x => !x.yaCapturado && x.confianza === 'probable'),
      porRevisar: cuenta_(x => !x.yaCapturado && x.confianza !== 'segura' && x.confianza !== 'probable'),
      // El cuadre: lo del banco que falta capturar y lo capturado que el banco no tiene
      cuadre: {
        enBancoSinCapturar: cuenta_(x => !x.yaCapturado),
        capturadoSinBanco: sobran.length,
        detalleCapturadoSinBanco: sobran.slice(0, 40)
      },
      totalIngresos: Math.round(propuestas.filter(x => x.tipo === 'INGRESO')
        .reduce((a, x) => a + x.total, 0) * 100) / 100,
      totalEgresos: Math.round(propuestas.filter(x => x.tipo === 'EGRESO')
        .reduce((a, x) => a + x.total, 0) * 100) / 100,
      catalogo: cat0,
      // Para el campo de pedido: los folios que deben y los pedidos a proveedores
      folios: porCobrar.map(x => ({ folio: x.folio, cliente: x.cliente, saldo: x.saldo }))
        .filter(x => x.folio).slice(0, 400),
      pedidosProveedor: solicitados.map(x => ({ pedido: x.pedido, proveedor: x.proveedor,
        monto: x.monto })).filter(x => x.pedido).slice(0, 400),
      reglasAprendidas: aprendidas.length,
      lectura: {
        ingresosLeidos: ing.rows.length,
        egresosLeidos: egr.rows.length,
        catalogoLeido: cats.rows.length,
        conceptosIngreso: (cat0.ingresos || []).length,
        conceptosEgreso: (cat0.egresos || []).length,
        clientesEnCatalogo: (cat0.clientes || []).length,
        proveedoresEnCatalogo: (cat0.proveedores || []).length
      },
      propuestas: propuestas
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
