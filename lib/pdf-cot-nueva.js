// Cotización con el formato nuevo (el que está diseñando Pau).
//
// Lo que sí se reproduce: la estructura completa. El encabezado con las cajas de
// Documento, Cliente, Despacho y Cantidad de artículos; la tabla con foto,
// descripción, precio con IVA, descuento, cantidad y total; el bloque de datos
// bancarios con Finiquito, Anticipo y Total; y la hoja de condiciones a dos
// columnas.
//
// Lo que falta: las tipografías Coolvetica Light y Victorian Orchid Light, y la
// imagen de fondo de la portada. Mientras no lleguen, se usa Helvetica y la
// portada sale en color plano. Todo lo demás ya queda en su lugar, así que
// cuando lleguen los archivos solo se cambian dos cosas.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

let LOGO = null;
try { LOGO = require('./logo'); } catch (e) { LOGO = null; }

const A4 = { w: 595.28, h: 841.89 };
const M = 42;
const TINTA = rgb(0.09, 0.09, 0.08);
const SUAVE = rgb(0.45, 0.45, 0.43);
const LINEA = rgb(0.78, 0.77, 0.74);
const PORTADA = rgb(0.20, 0.16, 0.15);   // el café oscuro de la portada
const CREMA = rgb(0.96, 0.95, 0.91);

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
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { if (LOGO && LOGO.base64) logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); }
  catch (e) { logo = null; }

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
  let fondo = null;
  if (opt.portadaBase64) {
    try {
      const buf = Buffer.from(opt.portadaBase64, 'base64');
      fondo = /^\/9j/.test(opt.portadaBase64) ? await pdf.embedJpg(buf) : await pdf.embedPng(buf);
    } catch (e) { fondo = null; }
  }
  if (fondo) page.drawImage(fondo, { x: 0, y: 0, width: A4.w, height: A4.h });
  else page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: PORTADA });

  // La barra crema con PERCH espaciado y los datos del documento
  const barraY = A4.h - 120, barraH = 26;
  page.drawRectangle({ x: M, y: barraY, width: ANCHO, height: barraH, color: CREMA });
  txt('P     E     R     C     H', M + 14, barraY + 9, reg, 9, PORTADA, 1.5);
  const dchos = 'COTIZACION    ' + limpio(cot.cliente || '').toUpperCase() +
                '    ' + (opt.fechaCorta || '');
  der(dchos, M, ANCHO - 14, barraY + 9, reg, 7.5, PORTADA);

  // Pie de la portada
  const pieP = ['PERCH', (opt.sitio || 'WWW.PERCH.COM'), (opt.telefono || '')];
  let yp = 92;
  pieP.filter(Boolean).forEach(l => {
    const w = reg.widthOfTextAtSize(limpio(l), 7.5);
    page.drawText(limpio(l), { x: (A4.w - w) / 2, y: yp, size: 7.5, font: reg, color: CREMA });
    yp -= 12;
  });

  // ===== Encabezado de las hojas interiores =====
  function encabezado() {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    if (logo) {
      const w = 110, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    } else {
      txt('P E R C H', M, y - 22, neg, 20, TINTA, 3);
    }
    // Los datos de la empresa, abajo del logo
    let yy = y - 58;
    [opt.empresa || 'PERCH', opt.sitio || 'WWW.PERCH.COM', opt.telefono || '']
      .filter(Boolean).forEach(l => { txt(l, M, yy, reg, 6.5, SUAVE); yy -= 10; });

    // Las cuatro cajas de la derecha
    const xc = M + ANCHO * 0.46, wc = ANCHO * 0.54;
    const filas = [
      ['DOCUMENTO', opt.tipoDocumento || 'Cotización'],
      ['CLIENTE', cot.cliente || ''],
      ['DESPACHO', cot.despacho || cot.proyecto || ''],
      ['CANT. DE ARTICULOS', String(opt.piezas == null ? '' : opt.piezas)]
    ];
    let yb = y - 8;
    filas.forEach(f => {
      // Línea con las puntas redondeadas del diseño
      page.drawLine({ start: { x: xc, y: yb - 16 }, end: { x: xc + wc, y: yb - 16 },
                      thickness: 0.6, color: LINEA });
      txt(f[0], xc + 4, yb - 12, reg, 6.5, SUAVE, 0.6);
      der(f[1], xc, wc - 4, yb - 12, reg, 8.5, TINTA);
      yb -= 27;
    });
    y = Math.min(yy, yb) - 26;
  }

  encabezado();

  // ===== La tabla de productos =====
  const COLS = { foto: 62, desc: 150, precio: 78, desc2: 78, cant: 62 };
  COLS.total = ANCHO - (COLS.foto + COLS.desc + COLS.precio + COLS.desc2 + COLS.cant);
  const pctDesc = Number(opt.descuentoPct || 0);

  function cabeceraTabla() {
    let x = M;
    txt('ITEM', x, y, reg, 6.5, SUAVE, 0.6); x += COLS.foto;
    txt('DESCRIPCION', x, y, reg, 6.5, SUAVE, 0.6); x += COLS.desc;
    der('PRECIO CON IVA', x, COLS.precio - 8, y, reg, 6.5, SUAVE); x += COLS.precio;
    der(pctDesc ? 'DESCUENTO ' + pctDesc + '%' : 'DESCUENTO', x, COLS.desc2 - 8, y, reg, 6.5, SUAVE);
    x += COLS.desc2;
    der('CANTIDAD', x, COLS.cant - 8, y, reg, 6.5, SUAVE); x += COLS.cant;
    der('TOTAL', x, COLS.total, y, reg, 6.5, SUAVE);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.6, color: LINEA });
    y -= 22;
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

  // El anticipo y el finiquito salen del porcentaje pactado
  const pctAnticipo = opt.anticipoPct == null ? 50 : Number(opt.anticipoPct);
  const anticipo = Math.round(sumaTotal * (pctAnticipo / 100) * 100) / 100;
  const finiquito = Math.round((sumaTotal - anticipo) * 100) / 100;

  const xt = M + ANCHO * 0.46, wt = ANCHO * 0.54;
  let yt = y;
  [['ANTICIPO' + (pctAnticipo !== 50 ? ' ' + pctAnticipo + '%' : ''), anticipo],
   ['FINIQUITO', finiquito],
   ['TOTAL', sumaTotal]].forEach((f, i) => {
    const esTotal = (i === 2);
    page.drawLine({ start: { x: xt, y: yt - 16 }, end: { x: xt + wt, y: yt - 16 },
                    thickness: esTotal ? 0.9 : 0.6, color: esTotal ? TINTA : LINEA });
    txt(f[0], xt + 4, yt - 12, esTotal ? neg : reg, 7.5, TINTA, 0.6);
    der(money2(f[1]), xt, wt - 4, yt - 12, esTotal ? neg : reg, 9, TINTA);
    yt -= 26;
  });

  // ===== Condiciones =====
  if ((opt.condiciones || []).length) {
    encabezado();
    const colW = (ANCHO - 24) / 2;
    let yc = [y, y];
    let cur = 0;
    (opt.condiciones || []).forEach(bloque => {
      const x = M + cur * (colW + 24);
      const cuerpo = [];
      (bloque.parrafos || []).forEach(p2 => {
        renglones(p2, reg, 7, colW).forEach(l => cuerpo.push(l));
        cuerpo.push('');
      });
      const alto = 22 + cuerpo.length * 9.5;
      // Se pone en la columna que tenga más espacio libre, para que las dos se
      // llenen parejo. Antes se llenaba la primera hasta abajo y la segunda
      // quedaba vacía.
      cur = (yc[1] > yc[0]) ? 1 : 0;
      if (yc[cur] - alto < 70) {
        const otra = cur === 0 ? 1 : 0;
        if (yc[otra] - alto >= 70) cur = otra;
        else { encabezado(); yc = [y, y]; cur = 0; }
      }
      const xx = M + cur * (colW + 24);
      txt(bloque.titulo || '', xx, yc[cur], reg, 7.5, SUAVE, 0.8);
      yc[cur] -= 6;
      page.drawLine({ start: { x: xx, y: yc[cur] }, end: { x: xx + colW, y: yc[cur] },
                      thickness: 0.6, color: LINEA });
      yc[cur] -= 12;
      cuerpo.forEach(l => {
        if (l) txt(l, xx, yc[cur], reg, 7, TINTA);
        yc[cur] -= 9.5;
      });
      yc[cur] -= 6;
    });
    const cierre = '*AL COMPRAR UN MUEBLE PERCH SE ASUME QUE SE ACEPTAN TODOS LOS TERMINOS Y CONDICIONES.';
    txt(cierre, M, 58, reg, 7, TINTA, 0.5);
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
