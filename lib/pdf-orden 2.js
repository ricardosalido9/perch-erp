// Orden de compra: el papel que se le manda al proveedor cuando se le pide algo.
// Versión sencilla a propósito: qué se pide, en qué material, cuántas piezas, a qué
// costo y para cuándo. Las condiciones de pago se agregan cuando Nico las defina.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);

// pdf-lib con fuentes estándar solo dibuja Latin-1: lo que no quepa se limpia.
function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  t = t.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2010-\u2015]/g, '-')
       .replace(/[\u2026]/g, '...')
       .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
  return t;
}
function money(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cortar(t, font, size, ancho) {
  const pal = limpio(t).split(/\s+/).filter(Boolean);
  const out = []; let l = '';
  pal.forEach(p => {
    const x = l ? l + ' ' + p : p;
    if (font.widthOfTextAtSize(x, size) <= ancho) l = x;
    else { if (l) out.push(l); l = p; }
  });
  if (l) out.push(l);
  return out;
}

async function ordenDeCompra(datos, opciones) {
  const o = opciones || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0, pagina = 0;

  const der = (t, x, w, yy, f, s, c) => {
    page.drawText(limpio(t), { x: x + w - f.widthOfTextAtSize(limpio(t), s), y: yy,
                               size: s, font: f, color: c || TINTA });
  };
  const raya = (yy, g, c) => {
    page.drawLine({ start: { x: M, y: yy }, end: { x: A4.w - M, y: yy },
                    thickness: g || 0.5, color: c || LINEA });
  };
  function nuevaPagina() {
    page = pdf.addPage([A4.w, A4.h]);
    pagina++;
    y = A4.h - M;
    if (logo) {
      const w = 78, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    der('WWW.PERCH.MX', M, ANCHO, y - 18, neg, 7.5, TINTA);
    y -= 44;
    raya(y, 0.8, TINTA);
    y -= 20;
    if (pagina === 1) {
      page.drawText(limpio('ORDEN DE COMPRA'), { x: M, y, size: 13, font: neg, color: TINTA });
      der(o.fecha || '', M, ANCHO, y, reg, 9, SUAVE);
      y -= 16;
      page.drawText(limpio(datos.pedido || ''), { x: M, y, size: 11, font: neg, color: TINTA });
      y -= 26;
    } else { y -= 6; }
  }
  function espacio(alto) { if (y - alto < M + 40) nuevaPagina(); }

  nuevaPagina();

  // ===== A quién va y para cuándo =====
  const datosArriba = [
    ['PROVEEDOR', datos.proveedor || ''],
    ['FECHA DEL PEDIDO', datos.fecha || ''],
    ['ENTREGA ESTIMADA', datos.estimada || 'Por confirmar']
  ];
  const anchoCaja = (ANCHO - 16) / 3;
  datosArriba.forEach((c, i) => {
    const x = M + i * (anchoCaja + 8);
    page.drawRectangle({ x: x, y: y - 40, width: anchoCaja, height: 40,
      color: rgb(0.97, 0.965, 0.95), borderColor: LINEA, borderWidth: 0.5 });
    page.drawText(limpio(c[0]), { x: x + 8, y: y - 14, size: 6.5, font: neg, color: SUAVE });
    cortar(c[1], neg, 9, anchoCaja - 16).slice(0, 2).forEach((l, j) => {
      page.drawText(limpio(l), { x: x + 8, y: y - 27 - j * 10, size: 9, font: neg, color: TINTA });
    });
  });
  y -= 58;

  // ===== Lo que se pide =====
  page.drawText(limpio('LO QUE TE PEDIMOS'), { x: M, y, size: 9.5, font: neg, color: TINTA });
  y -= 11;
  page.drawText(limpio('Si algo no cuadra, avisanos antes de empezar.'),
                { x: M, y, size: 7.5, font: reg, color: SUAVE });
  y -= 10;
  raya(y + 3, 0.7, TINTA);
  y -= 14;

  const cols = [
    { t: 'Mueble',   w: 168 },
    { t: 'Material', w: 96 },
    { t: 'Piezas',   w: 46,  der: true },
    { t: 'Costo unitario', w: 92, der: true },
    { t: 'Importe',  w: 105, der: true }
  ];
  let x = M;
  cols.forEach(c => {
    if (c.der) der(c.t, x, c.w, y, neg, 7, SUAVE);
    else page.drawText(limpio(c.t), { x: x, y, size: 7, font: neg, color: SUAVE });
    x += c.w;
  });
  y -= 6; raya(y, 0.5); y -= 12;

  let piezas = 0, subtotal = 0;
  (datos.lineas || []).forEach(l => {
    espacio(30);
    const importe = (l.cantidad || 0) * (l.costo || 0);
    piezas += (l.cantidad || 0);
    subtotal += importe;
    const vals = [l.producto || '', l.material || '', String(l.cantidad || 0),
                  money(l.costo || 0), money(importe)];
    x = M;
    cols.forEach((c, i) => {
      const t = cortar(vals[i], reg, 8, c.w - 6)[0] || '';
      if (c.der) der(t, x, c.w, y, reg, 8, TINTA);
      else page.drawText(limpio(t), { x: x, y, size: 8, font: reg, color: TINTA });
      x += c.w;
    });
    y -= 11;
    // Tela y especificaciones van debajo del mueble, en chico
    const extra = [];
    if (l.tela && !/^no$/i.test(String(l.tela))) {
      extra.push('Tela: ' + String(l.tela).replace(/^s[ií]\s*-\s*/i, ''));
    }
    if (l.especificaciones) extra.push(l.especificaciones);
    if (extra.length) {
      cortar(extra.join(' · '), reg, 6.8, ANCHO - 20).slice(0, 3).forEach(ln => {
        page.drawText(limpio(ln), { x: M + 10, y, size: 6.8, font: reg, color: SUAVE });
        y -= 8;
      });
    }
    y -= 6;
  });

  // ===== Totales =====
  espacio(70);
  y -= 4;
  raya(y + 10, 0.8, TINTA);
  const iva = subtotal * (o.iva == null ? 0.16 : o.iva);
  const filasTot = [
    ['Piezas', String(piezas), false],
    ['Subtotal', money(subtotal), false],
    ['IVA', money(iva), false],
    ['TOTAL', money(subtotal + iva), true]
  ];
  filasTot.forEach(f => {
    der(f[0], A4.w - M - 260, 150, y, f[2] ? neg : reg, f[2] ? 9 : 8, f[2] ? TINTA : SUAVE);
    der(f[1], A4.w - M - 110, 110, y, f[2] ? neg : reg, f[2] ? 11 : 8.5, TINTA);
    y -= f[2] ? 20 : 13;
  });

  // ===== A dónde se entrega =====
  if (datos.entregarEn) {
    espacio(50);
    y -= 6;
    page.drawText(limpio('DONDE SE ENTREGA'), { x: M, y, size: 9.5, font: neg, color: TINTA });
    y -= 11;
    raya(y + 3, 0.7, TINTA);
    y -= 14;
    cortar(datos.entregarEn, reg, 8, ANCHO).forEach(l => {
      page.drawText(limpio(l), { x: M, y, size: 8, font: reg, color: TINTA });
      y -= 11;
    });
  }

  if (o.nota) {
    espacio(30);
    y -= 8;
    cortar(o.nota, reg, 7.5, ANCHO).forEach(l => {
      page.drawText(limpio(l), { x: M, y, size: 7.5, font: reg, color: SUAVE });
      y -= 10;
    });
  }

  pdf.getPages().forEach((p, i) => {
    const t = limpio((datos.pedido || '') + '  ·  ' + (datos.proveedor || '') +
                     '  ·  ' + (i + 1));
    p.drawText(t, { x: (A4.w - reg.widthOfTextAtSize(t, 7)) / 2, y: M - 20,
                    size: 7, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { ordenDeCompra };
