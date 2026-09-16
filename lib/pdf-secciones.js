// Un PDF de secciones con renglones. Lo usan los reportes que no tenían el suyo
// —costos e ingresos-egresos— para no escribir dos veces el mismo dibujo.
//
// No pretende ser bonito: pretende ser legible impreso y salir siempre. Los
// reportes que sí tienen diseño propio, como los estados, siguen con el suyo.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const A4 = { w: 595.28, h: 841.89 };
const M = 46;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.45, 0.43);
const LINEA = rgb(0.82, 0.81, 0.78);
const MAL = rgb(0.62, 0.20, 0.15);

// pdf-lib solo escribe los caracteres que la tipografía tiene. Un acento suelto
// tira todo el documento, así que se limpia antes de dibujar.
function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
       .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00A0/g, ' ');
  return t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
}
const dinero = (v) => {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

async function reporteSecciones(d, o) {
  o = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try {
    const f = path.join(__dirname, '..', 'assets', 'Perch_Logo.png');
    if (fs.existsSync(f)) logo = await pdf.embedPng(fs.readFileSync(f));
  } catch (e) { logo = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0;
  const txt = (t, x, yy, f, s, c) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f, color: c || TINTA });
  const der = (t, x, w, yy, f, s, c) => {
    const t2 = limpio(t);
    page.drawText(t2, { x: x + w - f.widthOfTextAtSize(t2, s), y: yy, size: s, font: f,
                        color: c || TINTA });
  };

  function nuevaPagina() {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    if (logo) {
      const w = 82, h = w * (logo.height / logo.width);
      page.drawImage(logo, { x: M, y: y - h + 6, width: w, height: h });
    } else {
      txt(o.empresa || '', M, y - 8, neg, 12);
    }
    der(limpio(d.titulo || ''), M, ANCHO, y - 6, neg, 13);
    if (d.subtitulo) der(limpio(d.subtitulo), M, ANCHO, y - 20, reg, 8.5, SUAVE);
    y -= 44;
    page.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.8, color: TINTA });
    y -= 22;
  }
  nuevaPagina();

  // Las cifras de arriba, en una franja
  if ((d.cifras || []).length) {
    const ancho = ANCHO / d.cifras.length;
    d.cifras.forEach((k, i) => {
      const x = M + i * ancho;
      txt(String(k.k || '').toUpperCase(), x, y, reg, 6.5, SUAVE);
      txt(String(k.v || ''), x, y - 15, neg, 13);
      if (k.f) txt(String(k.f), x, y - 27, reg, 7, SUAVE);
    });
    y -= 46;
  }

  (d.secciones || []).forEach(sec => {
    const filas = sec.filas || [];
    if (!filas.length) return;
    if (y < M + 90) nuevaPagina();
    txt(sec.titulo || '', M, y, neg, 10.5);
    if (sec.nota) der(limpio(sec.nota), M, ANCHO, y, reg, 7.5, SUAVE);
    y -= 7;
    page.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y }, thickness: 0.7, color: TINTA });
    y -= 15;

    filas.forEach(f => {
      if (y < M + 26) {
        nuevaPagina();
        txt((sec.titulo || '') + ' (sigue)', M, y, neg, 10.5);
        y -= 20;
      }
      const esTotal = !!f.total;
      const fuente = esTotal ? neg : reg;
      txt(String(f.nombre || ''), M + (f.nivel ? f.nivel * 10 : 0), y, fuente, 9);
      if (f.detalle) {
        const w = fuente.widthOfTextAtSize(limpio(String(f.nombre || '')), 9);
        txt(String(f.detalle), M + (f.nivel ? f.nivel * 10 : 0) + w + 8, y, reg, 7.5, SUAVE);
      }
      const v = (f.texto != null) ? String(f.texto) : dinero(f.valor);
      der(v, M, ANCHO, y, fuente, 9, (Number(f.valor) < 0) ? MAL : TINTA);
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: M + ANCHO, y },
                      thickness: esTotal ? 0.7 : 0.3, color: esTotal ? TINTA : LINEA });
      y -= 13;
    });
    y -= 14;
  });

  if ((d.notas || []).length) {
    if (y < M + 80) nuevaPagina();
    txt('Lo que hay que revisar', M, y, neg, 10.5);
    y -= 16;
    d.notas.forEach(n => {
      const palabras = limpio(String(n)).split(/\s+/);
      let linea = '';
      palabras.forEach(p => {
        const prueba = linea ? linea + ' ' + p : p;
        if (reg.widthOfTextAtSize(prueba, 8.5) > ANCHO - 14) {
          if (y < M + 20) nuevaPagina();
          txt('· ' + linea, M + 4, y, reg, 8.5); y -= 12; linea = p;
        } else linea = prueba;
      });
      if (linea) { if (y < M + 20) nuevaPagina(); txt('· ' + linea, M + 4, y, reg, 8.5); y -= 14; }
    });
  }

  // Pie con la numeración
  const n = pdf.getPageCount();
  for (let i = 0; i < n; i++) {
    const p = pdf.getPage(i);
    p.drawText(limpio(o.pie || ''), { x: M, y: 26, size: 7.5, font: reg, color: SUAVE });
    const pg = (i + 1) + ' / ' + n;
    p.drawText(pg, { x: A4.w - M - reg.widthOfTextAtSize(pg, 7.5), y: 26, size: 7.5,
                     font: reg, color: SUAVE });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { reporteSecciones, dinero, limpio };
