// La relación de entregas que Nico le manda al proveedor cada semana.
//
// No confundir con "Relación de pedidos", que lleva costo, IVA y total: esa es
// para cuadrar el estado de cuenta y es de uso interno. Esta va PARA el proveedor,
// así que no lleva un solo peso. Lo que lleva es lo que él necesita para producir:
// qué mueble, de qué material, con qué tela, en qué estado está y para cuándo.
//
// Las columnas y el orden salen del control que ya llevaba Nico a mano.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const HOJA = { w: 841.89, h: 595.28 };   // A4 acostado
const M = 32;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.85, 0.84, 0.81);
const PAPEL = rgb(0.97, 0.965, 0.95);
const VERDE = rgb(0.17, 0.43, 0.29);

// Los tres estados que usa el control, con su color
const COLOR_ESTADO = (s) => {
  const t = String(s || '').toLowerCase();
  if (/entregad/.test(t)) return { fondo: rgb(0.88, 0.94, 0.88), texto: rgb(0.17, 0.43, 0.29) };
  if (/por entregar|pendiente|proceso/.test(t)) return { fondo: rgb(0.99, 0.95, 0.80), texto: rgb(0.55, 0.40, 0.05) };
  return null;
};

function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  t = t.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2010-\u2015\u2212]/g, '-')
       .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
  return t;
}

// Los anchos suman 777, que es lo que cabe en horizontal con los márgenes
const COLS = [
  { t: 'Folio',      k: 'folio',    w: 54 },
  { t: 'Cant.',      k: 'cantidad', w: 32, centro: true },
  { t: 'Item',       k: 'item',     w: 112 },
  { t: 'Material',   k: 'material', w: 66 },
  { t: 'Tela / Especificaciones', k: 'tela', w: 130, envuelve: true },
  { t: 'Status',     k: 'status',   w: 62, centro: true, pill: true },
  { t: 'Comentarios',k: 'comentarios', w: 130, envuelve: true },
  { t: 'Pedido',     k: 'pedido',   w: 62 },
  { t: 'Cliente',    k: 'cliente',  w: 78 },
  { t: 'Entrega',    k: 'entrega',  w: 51, centro: true }
];

async function relacionParaProveedor(datos, o) {
  o = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  let page = null, y = 0;
  const x0 = {};
  let acum = M;
  COLS.forEach(c => { x0[c.k] = acum; acum += c.w; });

  // Parte el texto en las líneas que quepan en su columna
  const partir = (t, ancho, size) => {
    const pal = limpio(t).split(/\s+/).filter(Boolean);
    const out = []; let li = '';
    pal.forEach(p => {
      const x = li ? li + ' ' + p : p;
      if (reg.widthOfTextAtSize(x, size) <= ancho - 8) li = x;
      else { if (li) out.push(li); li = p; }
    });
    if (li) out.push(li);
    return out.length ? out : [''];
  };

  function encabezado() {
    page = pdf.addPage([HOJA.w, HOJA.h]);
    page.drawRectangle({ x: 0, y: 0, width: HOJA.w, height: HOJA.h, color: PAPEL });
    if (logo) {
      const h = 22, w = logo.width / logo.height * h;
      page.drawImage(logo, { x: M, y: HOJA.h - M - h, width: w, height: h });
    }
    y = HOJA.h - M - 20;
    const tit = 'Relacion de entregas / Proveedores';
    page.drawText(limpio(tit), {
      x: M + (HOJA.w - M * 2) - reg.widthOfTextAtSize(limpio(tit), 11),
      y: y, size: 11, font: reg, color: TINTA });
    y -= 26;
    // El nombre del proveedor, como en el control de Nico
    page.drawRectangle({ x: M, y: y - 4, width: 200, height: 15, color: rgb(0.90, 0.89, 0.86) });
    page.drawText(limpio(String(datos.proveedor || '').toUpperCase()),
      { x: M + 5, y: y, size: 8, font: neg, color: TINTA });
    y -= 22;
    // encabezado de la tabla
    page.drawRectangle({ x: M, y: y - 5, width: acum - M, height: 16, color: TINTA });
    COLS.forEach(c => {
      const t = limpio(c.t);
      const w = neg.widthOfTextAtSize(t, 6.5);
      page.drawText(t, {
        x: c.centro ? x0[c.k] + (c.w - w) / 2 : x0[c.k] + 4,
        y: y, size: 6.5, font: neg, color: PAPEL });
    });
    y -= 18;
  }
  encabezado();

  (datos.renglones || []).forEach(r => {
    // Cuántas líneas necesita el renglón: manda la columna más larga
    const lineas = {};
    let alto = 1;
    COLS.forEach(c => {
      if (!c.envuelve) return;
      lineas[c.k] = partir(r[c.k], c.w, 6.5);
      alto = Math.max(alto, lineas[c.k].length);
    });
    const altoPx = alto * 8 + 6;
    if (y - altoPx < M + 24) { encabezado(); }

    page.drawLine({ start: { x: M, y: y + 10 }, end: { x: acum, y: y + 10 },
                    thickness: 0.4, color: LINEA });
    COLS.forEach(c => {
      if (c.pill) {
        const col = COLOR_ESTADO(r[c.k]);
        const t = limpio(r[c.k] || '');
        if (!t) return;
        const w = reg.widthOfTextAtSize(t, 6.5);
        if (col) {
          page.drawRectangle({ x: x0[c.k] + 3, y: y - 3, width: c.w - 6, height: 11,
                               color: col.fondo });
        }
        page.drawText(t, { x: x0[c.k] + (c.w - w) / 2, y: y, size: 6.5, font: reg,
                           color: col ? col.texto : TINTA });
        return;
      }
      if (c.envuelve) {
        (lineas[c.k] || ['']).forEach((li, i) => {
          page.drawText(li, { x: x0[c.k] + 4, y: y - i * 8, size: 6.5, font: reg, color: TINTA });
        });
        return;
      }
      const t = limpio(r[c.k] == null ? '' : String(r[c.k]));
      if (!t) return;
      const w = reg.widthOfTextAtSize(t, 7);
      page.drawText(t.slice(0, 40), {
        x: c.centro ? x0[c.k] + (c.w - w) / 2 : x0[c.k] + 4,
        y: y, size: 7, font: c.k === 'folio' ? neg : reg, color: TINTA });
    });
    y -= altoPx;
  });

  // pie
  const n = pdf.getPageCount();
  for (let i = 0; i < n; i++) {
    const p = pdf.getPage(i);
    p.drawText(limpio(o.fecha || ''), { x: M, y: 22, size: 8, font: reg, color: TINTA });
    const der = limpio('Realizo: ' + (o.hechoPor || ''));
    p.drawText(der, { x: HOJA.w - M - reg.widthOfTextAtSize(der, 8), y: 22,
                      size: 8, font: reg, color: TINTA });
    if (n > 1) {
      const pg = (i + 1) + '/' + n;
      p.drawText(pg, { x: HOJA.w / 2, y: 22, size: 7, font: reg, color: SUAVE });
    }
  }
  return Buffer.from(await pdf.save());
}

module.exports = { relacionParaProveedor };
