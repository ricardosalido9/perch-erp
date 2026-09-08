// Cotización con el formato nuevo (el que está diseñando Pau).
//
// Lo que sí se reproduce: la estructura completa. El encabezado con las cajas de
// Documento, Cliente, Despacho y Cantidad de artículos; la tabla con foto,
// descripción, precio con IVA, descuento, cantidad y total; el bloque de datos
// bancarios con Finiquito, Anticipo y Total; y la hoja de condiciones a dos
// columnas.
//
// Las tipografías ya están: Victorian Orchid Light para los títulos y Coolvetica
// para el texto. Van en assets/fuentes y se incrustan en el PDF, así que el
// archivo se ve igual en cualquier computadora aunque no las tenga instaladas.
//
// De Coolvetica no existe el corte Light: el paquete trae Regular, Condensed,
// Cramped, Heavy Compressed e Italic. Se usa Regular, que es el más cercano.
//
// Si por lo que sea una fuente no carga, se cae a Helvetica y el PDF sale igual
// de completo, solo que con otra letra. Nunca truena por una fuente.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
let fontkit = null;
try { fontkit = require('@pdf-lib/fontkit'); } catch (e) { fontkit = null; }

const DIR_FUENTES = path.join(__dirname, '..', 'assets', 'fuentes');
function archivoFuente(nombre) {
  try {
    const f = path.join(DIR_FUENTES, nombre);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  } catch (e) { return null; }
}
const DIR_ASSETS = path.join(__dirname, '..', 'assets');
function archivoAsset(nombre) {
  try {
    const f = path.join(DIR_ASSETS, nombre);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  } catch (e) { return null; }
}

let LOGO = null;
try { LOGO = require('./logo'); } catch (e) { LOGO = null; }

// Carta (612 x 792), que es como está armado el diseño. En A4 los márgenes y la
// tabla quedaban distintos a la muestra.
const A4 = { w: 612, h: 792 };
const M = 42;
const TINTA = rgb(0.09, 0.09, 0.08);
const SUAVE = rgb(0.45, 0.45, 0.43);
const LINEA = rgb(0.78, 0.77, 0.74);
const PORTADA = rgb(0.20, 0.16, 0.15);   // el café oscuro de la portada
const CREMA = rgb(0.96, 0.95, 0.91);
// El papel del diseño: un blanco cálido, no blanco puro
const PAPEL = rgb(0.973, 0.969, 0.961);

function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  t = t.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2010-\u2015]/g, '-').replace(/[\u2026]/g, '...').replace(/\u00A0/g, ' ');
  t = t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
  return t;
}
function money(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function money2(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function cotizacionNueva(cot, o) {
  const opt = o || {};
  const pdf = await PDFDocument.create();
  if (fontkit) { try { pdf.registerFontkit(fontkit); } catch (e) {} }

  // reg  = el texto de la cotización
  // neg  = lo que va destacado
  // tit  = los títulos y la portada
  let reg = await pdf.embedFont(StandardFonts.Helvetica);
  let neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let tit = neg;
  let num = reg;   // la de las cifras
  if (fontkit) {
    // Se intenta incrustar solo los caracteres que se usan, que es lo que deja el
    // archivo ligero. Algunas tipografías no soportan ese recorte y truenan al
    // guardarse: en ese caso se incrusta completa. Pesa más y funciona.
    // Las tipografías se incrustan completas, sin recortar a los caracteres usados.
    // El recorte deja el archivo más ligero, pero con estas fuentes truena —y no
    // al incrustarlas, sino al guardar el PDF, cuando ya no hay vuelta atrás—.
    // Un PDF que pesa unos cientos de kb de más es mejor que uno que no sale.
    const cargar = async (archivo) => {
      const buf = archivoFuente(archivo);
      if (!buf) return null;
      try { return await pdf.embedFont(buf, { subset: false }); } catch (e) { return null; }
    };
    // Everett para el texto corrido, Victorian Orchid para los rótulos y
    // Coolvetica para las cifras. De Coolvetica sigue faltando la Light.
    const everett  = await cargar('Everett-Regular.otf');
    const everettL = await cargar('Everett-Light.otf');
    const cool     = await cargar('Coolvetica-Lt.otf') || await cargar('Coolvetica-Rg.otf');
    const victoria = await cargar('VictorianOrchid-Regular.otf');
    const vicBook  = await cargar('VictorianOrchid-Book.otf');
    if (everett || cool) reg = everett || cool;
    tit = victoria || vicBook || neg;
    neg = vicBook || victoria || neg;
    if (everettL) num = everettL;
  }
  const fuentes = { reg: reg !== undefined, tit: tit !== neg };
  // El logotipo tipográfico y el monograma, tal cual los mandó diseño.
  let logoTipo = null, monograma = null;
  try {
    const b = archivoAsset('Perch_Logo.png');
    if (b) logoTipo = await pdf.embedPng(b);
  } catch (e) { logoTipo = null; }
  try {
    const b = archivoAsset('Perch_Monograma.png');
    if (b) monograma = await pdf.embedPng(b);
  } catch (e) { monograma = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0;

  const txt = (t, x, yy, f, s, c, sp) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f || reg,
      color: c || TINTA, characterSpacing: sp || 0 });
  const der = (t, x, w, yy, f, s, c) => {
    const tl = limpio(t);
    page.drawText(tl, { x: x + w - (f || reg).widthOfTextAtSize(tl, s), y: yy,
                        size: s, font: f || reg, color: c || TINTA });
  };
  function recorta(t, font, size, ancho) {
    let s = limpio(t);
    if (font.widthOfTextAtSize(s, size) <= ancho) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > ancho) s = s.slice(0, -1);
    return s + '...';
  }
  // Parte un texto en renglones que quepan
  function renglones(t, font, size, ancho) {
    const palabras = limpio(t).split(/\s+/).filter(Boolean);
    const out = []; let linea = '';
    palabras.forEach(p => {
      const prueba = linea ? linea + ' ' + p : p;
      if (font.widthOfTextAtSize(prueba, size) <= ancho) linea = prueba;
      else { if (linea) out.push(linea); linea = p; }
    });
    if (linea) out.push(linea);
    return out;
  }

  // ===== Portada =====
  // El diseño lleva una foto de fondo con textura. Si llega, se pone; si no,
  // se rellena con el mismo café para que el resto se vea igual.
  page = pdf.addPage([A4.w, A4.h]);
  // La portada del diseño es papel claro, no un fondo oscuro: el logotipo con el
  // monograma arriba a la izquierda, la línea del documento a la derecha, y los
  // datos de contacto centrados abajo.
  page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: PAPEL });

  const yLogo = A4.h - 84;
  if (logoTipo) {
    const wl = 150, hl = wl * (logoTipo.height / logoTipo.width);
    page.drawImage(logoTipo, { x: M + 6, y: yLogo - hl + 4, width: wl, height: hl });
    if (monograma) {
      const hm = 74, wm = hm * (monograma.width / monograma.height);
      page.drawImage(monograma, { x: M + 6 + wl * 0.71, y: yLogo - hm + 16, width: wm, height: hm });
    }
  } else {
    txt('PÉRCH', M + 6, yLogo - 14, tit, 22, TINTA, 9);
  }

  // La línea del documento, a la altura del logotipo
  const dchos = 'COTIZACIÓN     ' + limpio(cot.cliente || '').toUpperCase() +
                '     ' + (opt.fechaCorta || '');
  der(dchos, M, ANCHO - 6, yLogo - 12, tit, 8.5, TINTA);

  // Los datos de contacto, centrados abajo
  const pieP = [(opt.empresa || 'PÉRCH'), (opt.sitio || 'WWW.PERCH.COM'), (opt.telefono || '')];
  let yp = 108;
  pieP.filter(Boolean).forEach(l => {
    const w = tit.widthOfTextAtSize(limpio(l), 8.5);
    page.drawText(limpio(l), { x: (A4.w - w) / 2, y: yp, size: 8.5, font: tit, color: TINTA });
    yp -= 13;
  });

  // ===== Encabezado de las hojas interiores =====
  function encabezado() {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    // El logotipo tipográfico, tal cual lo mandó diseño.
    if (logoTipo) {
      const wl = 132, hl = wl * (logoTipo.height / logoTipo.width);
      page.drawImage(logoTipo, { x: M + 2, y: y - 12 - hl, width: wl, height: hl });
    } else {
      txt('PÉRCH', M + 4, y - 26, tit, 21, TINTA, 9);
    }

    // Los datos de la empresa, abajo del logotipo
    let yy = y - 56;
    [opt.empresa || 'PÉRCH', opt.sitio || 'WWW.PERCH.COM', opt.telefono || '']
      .filter(Boolean).forEach(l => { txt(l, M + 4, yy, reg, 7.5, TINTA); yy -= 12; });

    // El bloque de datos de la derecha: rótulo en la tipografía de títulos, el
    // dato a la derecha, y una línea abajo de cada renglón.
    const xc = M + ANCHO * 0.46, wc = ANCHO * 0.54;
    const filas = [
      ['DOCUMENTO', opt.tipoDocumento || 'Cotización'],
      ['CLIENTE', cot.cliente || ''],
      ['DESPACHO', cot.despacho || cot.proyecto || ''],
      ['CANT. DE ARTÍCULOS', String(opt.piezas == null ? '' : opt.piezas)]
    ];
    let yb = y - 8;
    filas.forEach(f => {
      page.drawLine({ start: { x: xc, y: yb - 16 }, end: { x: xc + wc, y: yb - 16 },
                      thickness: 0.7, color: TINTA });
      txt(f[0], xc + 2, yb - 12, tit, 8.5, TINTA, 0.4);
      der(f[1], xc, wc - 2, yb - 12, reg, 8, TINTA);
      yb -= 29;
    });
    y = Math.min(yy, yb) - 30;
  }

  encabezado();

  // ===== La tabla de productos =====
  const COLS = { foto: 58, desc: 148, precio: 100, desc2: 96, cant: 62 };
  COLS.total = ANCHO - (COLS.foto + COLS.desc + COLS.precio + COLS.desc2 + COLS.cant);
  const pctDesc = Number(opt.descuentoPct || 0);

  function cabeceraTabla() {
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: M + ANCHO, y: y + 12 },
                    thickness: 0.7, color: TINTA });
    let x = M;
    txt('ITEM', x + 4, y, tit, 8.5, TINTA, 0); x += COLS.foto;
    txt('DESCRIPCIÓN', x, y, tit, 8.5, TINTA, 0); x += COLS.desc;
    der('PRECIO CON IVA', x, COLS.precio - 8, y, tit, 8.5, TINTA); x += COLS.precio;
    der(pctDesc ? 'DESCUENTO ' + pctDesc + '%' : 'DESCUENTO', x, COLS.desc2 - 8, y, tit, 8.5, TINTA);
    x += COLS.desc2;
    der('CANTIDAD', x, COLS.cant - 8, y, tit, 8.5, TINTA); x += COLS.cant;
    der('TOTAL', x, COLS.total, y, tit, 8.5, TINTA);
    y -= 9;
    page.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.7, color: TINTA });
    y -= 26;
  }
  cabeceraTabla();

  // Las fotos que ya vengan resueltas del catálogo
  const fotos = {};
  for (const p of (cot.productos || [])) {
    if (!p.fotoBase64 || fotos[p.fotoBase64]) continue;
    try {
      const buf = Buffer.from(p.fotoBase64, 'base64');
      fotos[p.fotoBase64] = /^\/9j/.test(p.fotoBase64) ? await pdf.embedJpg(buf) : await pdf.embedPng(buf);
    } catch (e) { fotos[p.fotoBase64] = null; }
  }

  let sumaTotal = 0;
  (cot.productos || []).forEach(p => {
    const lineas = renglones(p.descripcion || p.producto || '', reg, 7.5, COLS.desc - 12);
    const alto = Math.max(58, lineas.length * 10 + 16);
    if (y - alto < 150) { encabezado(); cabeceraTabla(); }

    const yTop = y;
    const img = p.fotoBase64 ? fotos[p.fotoBase64] : null;
    if (img) {
      const lado = 48;
      const rel = img.width / img.height;
      const w = rel >= 1 ? lado : lado * rel;
      const h = rel >= 1 ? lado / rel : lado;
      page.drawImage(img, { x: M, y: yTop - h + 6, width: w, height: h });
    } else {
      // Sin foto se deja el hueco, no un recuadro vacío que ensucie
      page.drawRectangle({ x: M, y: yTop - 42, width: 48, height: 48,
                           color: rgb(0.95, 0.94, 0.92) });
    }

    let ly = yTop;
    lineas.forEach(l => { txt(l, M + COLS.foto, ly, reg, 7.5, TINTA); ly -= 10; });
    if (p.medidas) { txt(p.medidas, M + COLS.foto, ly, reg, 7.5, TINTA); ly -= 10; }

    const yMedio = yTop - Math.min(alto, lineas.length * 10 + 6) / 2 - 4;
    let x = M + COLS.foto + COLS.desc;
    const precio = Number(p.precioConIVA || 0);
    const conDesc = pctDesc ? precio * (1 - pctDesc / 100) : Number(p.precioFinal || precio);
    const cant = Number(p.cantidad || 1);
    const total = conDesc * cant;
    sumaTotal += total;

    der(money(precio), x, COLS.precio - 8, yMedio, reg, 8.5, TINTA); x += COLS.precio;
    der(money(conDesc), x, COLS.desc2 - 8, yMedio, reg, 8.5, TINTA); x += COLS.desc2;
    der(String(cant), x, COLS.cant - 8, yMedio, reg, 8.5, TINTA); x += COLS.cant;
    der(money(total), x, COLS.total, yMedio, reg, 8.5, TINTA);

    y = yTop - alto;
  });

  // ===== Datos bancarios y totales =====
  if (y < 220) encabezado();
  y = Math.min(y, 210);
  const banco = opt.banco || {};
  let yb = y;
  [banco.nombre || 'BBVA', banco.titular || '', banco.cuenta ? 'CUENTA: ' + banco.cuenta : '',
   banco.clabe ? 'CLABE: ' + banco.clabe : '', banco.swift ? 'SWIFT: ' + banco.swift : '']
    .filter(Boolean).forEach((l, i) => {
      txt(l, M, yb, i === 0 ? neg : reg, 7, i === 0 ? TINTA : SUAVE);
      yb -= 11;
    });

  // El total lleva el envío: la suma de los renglones es solo el mueble.
  const envio = Number(cot.envio || 0);
  const granTotal = Math.round((sumaTotal + envio) * 100) / 100;

  // El anticipo y el finiquito los calcula quien arma la cotización, no este
  // módulo: la regla de Perch es 60/40 y vive en un solo lugar. Si no vienen,
  // se reparte por el porcentaje que se indique, y si tampoco, mitad y mitad.
  const pctAnticipo = opt.anticipoPct == null ? 60 : Number(opt.anticipoPct);
  const anticipo = cot.anticipo != null ? Number(cot.anticipo)
                 : Math.round(granTotal * (pctAnticipo / 100) * 100) / 100;
  const finiquito = cot.finiquito != null ? Number(cot.finiquito)
                  : Math.round((granTotal - anticipo) * 100) / 100;

  const xt = M + ANCHO * 0.46, wt = ANCHO * 0.54;
  let yt = y;
  // El orden es el de la muestra: finiquito, anticipo y hasta abajo el total.
  const filasTot = [['FINIQUITO', finiquito], ['ANTICIPO', anticipo]];
  if (envio) filasTot.push(['ENVIO', envio]);
  filasTot.push(['TOTAL', granTotal]);
  // En el diseño los totales van dentro de un recuadro con esquinas redondeadas,
  // con una línea entre renglón y renglón.
  const altoFila = 27;
  const altoCaja = filasTot.length * altoFila;
  page.drawRectangle({
    x: xt, y: yt + 11 - altoCaja, width: wt, height: altoCaja,
    borderColor: TINTA, borderWidth: 0.7, color: undefined
  });
  filasTot.forEach((f, i) => {
    const ultima = (i === filasTot.length - 1);
    if (!ultima) {
      page.drawLine({ start: { x: xt, y: yt - 16 }, end: { x: xt + wt, y: yt - 16 },
                      thickness: 0.6, color: TINTA });
    }
    txt(f[0], xt + 8, yt - 11, tit, 9, TINTA, 0.4);
    der(money2(f[1]), xt, wt - 8, yt - 11, reg, 8.5, TINTA);
    yt -= altoFila;
  });

  // ===== Términos y condiciones =====
  // Dos columnas fijas, izquierda y derecha, con los temas repartidos como en el
  // diseño. No se acomodan solos por cómo caen: cada bloque tiene su lado.
  const TERMINOS = require('./cot-terminos');
  const cols = opt.condicionesPorColumna || TERMINOS;
  if ((cols.izquierda || []).length || (cols.derecha || []).length) {
    encabezado();
    const sep = 34;
    const colW = (ANCHO - sep) / 2;
    const arranque = y - 18;
    const pintarColumna = (bloques, xx) => {
      let yc = arranque;
      (bloques || []).forEach(b => {
        txt(b.titulo || '', xx, yc, tit, 9, TINTA, 0.3);
        yc -= 7;
        page.drawLine({ start: { x: xx, y: yc }, end: { x: xx + colW, y: yc },
                        thickness: 0.6, color: LINEA });
        yc -= 15;
        (b.parrafos || []).forEach(p2 => {
          renglones(p2, reg, 7.2, colW - 8).forEach(l => {
            txt(l, xx + 6, yc, reg, 7.2, TINTA);
            yc -= 9.8;
          });
          yc -= 7;
        });
        yc -= 12;
      });
      return yc;
    };
    const finIzq = pintarColumna(cols.izquierda, M);
    const finDer = pintarColumna(cols.derecha, M + colW + sep);
    const abajo = Math.min(finIzq, finDer);
    txt(cols.pie || '', M, Math.max(abajo - 6, 54), reg, 7.5, TINTA);
  }

  // Numeración, como en el diseño: 1/2
  const paginas = pdf.getPages();
  paginas.forEach((p2, i) => {
    if (i === 0) return;                       // la portada no lleva número
    const t = (i) + '/' + (paginas.length - 1);
    p2.drawText(t, { x: M, y: 34, size: 7, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { cotizacionNueva };
