// Relación de entregas de un proveedor: el control que lleva Nico a mano.
// Un renglón por pieza, agrupado por pedido, con lo que se pidió, lo que ya entregó,
// lo que falta, cuánto se le pagó y cuándo. Es la versión legible del archivote.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

// Horizontal: son muchas columnas y en vertical no se leen
const HOJA = { w: 841.89, h: 595.28 };
const M = 32;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const VERDE = rgb(0.17, 0.43, 0.29);
const AMBAR = rgb(0.55, 0.42, 0.12);

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
function recorta(t, font, size, ancho) {
  let s = limpio(t);
  if (font.widthOfTextAtSize(s, size) <= ancho) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > ancho) s = s.slice(0, -1);
  return s + '...';
}

// Las columnas, en el orden del control de Nico.
// Los anchos suman 776, que es lo que cabe en horizontal con los márgenes (777.89).
const COLS = [
  { t: 'Folio',    k: 'folio',    w: 54 },
  { t: 'Pedido',   k: 'pedido',   w: 66 },
  { t: 'Cliente',  k: 'cliente',  w: 76 },
  { t: 'Pzs',      k: 'cantidad', w: 26, der: true },
  { t: 'Mueble',   k: 'producto', w: 112 },
  { t: 'Material', k: 'material', w: 64 },
  { t: 'C. unitario', k: 'costo', w: 62, der: true },
  { t: 'Subtotal', k: 'subtotal', w: 64, der: true },
  { t: 'IVA',      k: 'iva',      w: 54, der: true },
  { t: 'Total',    k: 'total',    w: 66, der: true },
  { t: 'Status',   k: 'status',   w: 60, der: false },
  { t: 'Entreg.',  k: 'entregadas', w: 38, der: true },
  { t: 'Pend.',    k: 'pendientes', w: 34, der: true }
];

async function relacionDeEntregas(datos, opciones) {
  const o = opciones || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = HOJA.w - M * 2;
  let page = null, y = 0, pagina = 0;

  const der = (t, x, w, yy, f, s, c) => {
    const tl = limpio(t);
    page.drawText(tl, { x: x + w - f.widthOfTextAtSize(tl, s) - 4, y: yy, size: s, font: f, color: c || TINTA });
  };
  const raya = (yy, g, c) => {
    page.drawLine({ start: { x: M, y: yy }, end: { x: HOJA.w - M, y: yy },
                    thickness: g || 0.5, color: c || LINEA });
  };
  function encabezadoTabla() {
    let x = M;
    COLS.forEach(c => {
      if (c.der) der(c.t, x, c.w, y, neg, 6.5, SUAVE);
      else page.drawText(limpio(c.t), { x: x, y, size: 6.5, font: neg, color: SUAVE });
      x += c.w;
    });
    y -= 5; raya(y, 0.5); y -= 10;
  }
  function nuevaPagina() {
    page = pdf.addPage([HOJA.w, HOJA.h]);
    pagina++;
    y = HOJA.h - M;
    if (logo) {
      const w = 62, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    der('WWW.PERCH.MX', M, ANCHO, y - 14, neg, 7, TINTA);
    y -= 36;
    raya(y, 0.8, TINTA);
    y -= 16;
    if (pagina === 1) {
      page.drawText(limpio('RELACION DE PEDIDOS'), { x: M, y, size: 12, font: neg, color: TINTA });
      der(o.fecha || '', M, ANCHO, y, reg, 8.5, SUAVE);
      y -= 14;
      page.drawText(limpio('Proveedor: ' + (datos.proveedor || '')),
                    { x: M, y, size: 10, font: neg, color: TINTA });
      if (o.hechoPor) der('Realizado por: ' + o.hechoPor, M, ANCHO, y, reg, 7.5, SUAVE);
      y -= 20;
    } else { y -= 4; }
    encabezadoTabla();
  }
  function espacio(alto) { if (y - alto < M + 30) { nuevaPagina(); } }

  nuevaPagina();

  let granPiezas = 0, granTotal = 0, granPagado = 0;

  (datos.pedidos || []).forEach(ped => {
    espacio(46);
    // Título del pedido
    page.drawText(limpio(ped.pedido || '(sin pedido)'),
                  { x: M, y, size: 8.5, font: neg, color: VERDE });
    const cab = [];
    if (ped.fecha) cab.push('Pedido el ' + ped.fecha);
    if (ped.estimada) cab.push('Estimada ' + ped.estimada);
    if (cab.length) der(cab.join('  ·  '), M, ANCHO, y, reg, 7, SUAVE);
    y -= 12;

    let subPiezas = 0, subTotal = 0;
    (ped.lineas || []).forEach(l => {
      espacio(20);
      const subtotal = (l.cantidad || 0) * (l.costo || 0);
      const iva = subtotal * (o.iva == null ? 0.16 : o.iva);
      const total = subtotal + iva;
      subPiezas += (l.cantidad || 0);
      subTotal += total;
      const v = {
        folio: l.folio || 'PERCH', pedido: ped.pedido || '', cliente: l.cliente || '',
        cantidad: String(l.cantidad || 0), producto: l.producto || '', material: l.material || '',
        costo: money(l.costo || 0), subtotal: money(subtotal), iva: money(iva), total: money(total),
        status: l.status || '', entregadas: String(l.entregadas || 0),
        pendientes: String(l.pendientes || 0)
      };
      let x = M;
      COLS.forEach(c => {
        const color = (c.k === 'pendientes' && (l.pendientes || 0) > 0) ? AMBAR
                    : (c.k === 'status' && /entregad/i.test(l.status || '')) ? VERDE : TINTA;
        const t = recorta(v[c.k], reg, 7, c.w - 6);
        if (c.der) der(t, x, c.w, y, reg, 7, color);
        else page.drawText(t, { x: x, y, size: 7, font: reg, color: color });
        x += c.w;
      });
      y -= 10;
      // Especificaciones y anticipos, debajo del renglón
      const abajo = [];
      if (l.especificaciones) abajo.push(l.especificaciones);
      (l.pagos || []).slice(0, 4).forEach(p => {
        abajo.push('Pago ' + money(p.monto) + (p.fecha ? ' el ' + p.fecha : ''));
      });
      if (abajo.length) {
        page.drawText(recorta(abajo.join('  ·  '), reg, 6.2, ANCHO - 20),
                      { x: M + 10, y, size: 6.2, font: reg, color: SUAVE });
        y -= 9;
      }
    });

    // Subtotal del pedido, con lo pagado
    espacio(24);
    raya(y + 6, 0.5);
    const pag = ped.pagado || 0;
    granPiezas += subPiezas; granTotal += subTotal; granPagado += pag;
    page.drawText(limpio('Subtotal ' + (ped.pedido || '')),
                  { x: M + 10, y, size: 7, font: neg, color: SUAVE });
    const resumen = subPiezas + (subPiezas === 1 ? ' pieza' : ' piezas') +
                    '   ·   Total ' + money(subTotal) +
                    '   ·   Pagado ' + money(pag) +
                    '   ·   Falta ' + money(Math.max(0, subTotal - pag));
    der(resumen, M, ANCHO, y, neg, 7.5, TINTA);
    y -= 20;
  });

  // ===== Gran total =====
  espacio(40);
  raya(y + 8, 0.8, TINTA);
  y -= 6;
  page.drawText(limpio('TOTAL'), { x: M, y, size: 9, font: neg, color: TINTA });
  der(granPiezas + (granPiezas === 1 ? ' pieza' : ' piezas') +
      '   ·   ' + money(granTotal) +
      '   ·   Pagado ' + money(granPagado) +
      '   ·   Falta ' + money(Math.max(0, granTotal - granPagado)),
      M, ANCHO, y, neg, 10, TINTA);
  y -= 22;

  if (o.nota) {
    page.drawText(recorta(o.nota, reg, 7, ANCHO), { x: M, y, size: 7, font: reg, color: SUAVE });
  }

  pdf.getPages().forEach((p, i) => {
    const t = limpio('Operacion PERCH  ·  ' + (datos.proveedor || '') + '  ·  ' +
                     (o.fecha || '') + '  ·  ' + (i + 1));
    p.drawText(t, { x: (HOJA.w - reg.widthOfTextAtSize(t, 6.5)) / 2, y: M - 16,
                    size: 6.5, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { relacionDeEntregas };
