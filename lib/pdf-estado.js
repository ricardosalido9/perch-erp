// Reporte de un estado financiero en PDF. Sirve para los tres, porque recibe las
// filas ya armadas por el handler y no sabe cuál es cuál.
//
// Va en horizontal: doce meses más total y año anterior no caben en vertical sin
// dejar las cifras ilegibles, y una tabla financiera que hay que leer con lupa no
// sirve para presentarla.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4H = { w: 841.89, h: 595.28 };   // A4 acostado
const M = 34;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const PAPEL = rgb(0.97, 0.965, 0.95);
const VERDE = rgb(0.17, 0.43, 0.29);
const ROJO  = rgb(0.62, 0.24, 0.20);

function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
  t = t.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2010-\u2015\u2212]/g, '-')
       .replace(/[\u2026]/g, '...')
       .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
  return t;
}
// En una tabla de doce columnas los pesos completos no caben. Se abrevia a miles,
// y el encabezado avisa que las cifras van en miles.
function miles(n) {
  const v = Number(n) || 0;
  if (!v) return '-';
  // Todo con los mismos decimales. Mezclar "5.7" con "1,336" en la misma columna
  // se lee como si fueran escalas distintas.
  const k = Math.round(v / 1000);
  if (!k) return v > 0 ? '0' : '(0)';
  const s = Math.abs(k).toLocaleString('en-US');
  return k < 0 ? '(' + s + ')' : s;
}
function pesos(n) {
  const v = Math.round(Number(n) || 0);
  const s = '$' + Math.abs(v).toLocaleString('en-US');
  return v < 0 ? '(' + s + ')' : s;
}
function pct(n, dec) {
  if (n === null || n === undefined) return '';
  return (n * 100).toFixed(dec === undefined ? 1 : dec) + '%';
}

async function reporteEstado(d, o) {
  o = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = A4H.w - M * 2;
  let page = null, y = 0, pagina = 0;
  const txt = (t, x, yy, f, s, c) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f, color: c || TINTA });
  const der = (t0, x, w, yy, f, s, c) => {
    const t = limpio(t0);
    page.drawText(t, { x: x + w - f.widthOfTextAtSize(t, s), y: yy, size: s, font: f, color: c || TINTA });
  };
  const linea = (yy, x0, x1, c) =>
    page.drawLine({ start: { x: x0 === undefined ? M : x0, y: yy },
                    end: { x: x1 === undefined ? M + ANCHO : x1, y: yy },
                    thickness: 0.5, color: c || LINEA });

  const MES3 = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const meses = [];
  for (let m = d.desde; m <= d.hasta; m++) meses.push(m);

  // Reparto de anchos: el concepto se lleva lo que sobra
  const wTot = 62, wAnt = 62, wVar = 44;
  const wMes = Math.max(34, Math.min(52, (ANCHO - 210 - wTot - wAnt - wVar) / meses.length));
  const wCon = ANCHO - wMes * meses.length - wTot - wAnt - wVar;
  const xMes = (i) => M + wCon + wMes * i;
  const xTot = M + wCon + wMes * meses.length;

  function encabezado() {
    pagina++;
    page = pdf.addPage([A4H.w, A4H.h]);
    page.drawRectangle({ x: 0, y: 0, width: A4H.w, height: A4H.h, color: PAPEL });
    if (logo) {
      const h = 22, w = logo.width / logo.height * h;
      page.drawImage(logo, { x: M, y: A4H.h - M - h, width: w, height: h });
    }
    y = A4H.h - M - 42;
    txt(o.titulo || 'Estado financiero', M, y, neg, 17);
    der(o.empresa || '', M, ANCHO, y, reg, 9, SUAVE);
    y -= 14;
    txt(o.periodo || '', M, y, reg, 9.5, SUAVE);
    der(o.generado || '', M, ANCHO, y, reg, 8, SUAVE);
    y -= 16;
    txt('Cifras en miles de pesos. Los negativos van entre parentesis.', M, y, reg, 7.5, SUAVE);
    y -= 14;
    // encabezado de columnas
    page.drawRectangle({ x: M, y: y - 4, width: ANCHO, height: 15, color: TINTA });
    txt('CONCEPTO', M + 6, y, neg, 7.5, PAPEL);
    meses.forEach((m, i) => der(MES3[m - 1].toUpperCase(), xMes(i), wMes - 4, y, neg, 7.5, PAPEL));
    der('TOTAL', xTot, wTot - 4, y, neg, 7.5, PAPEL);
    der(String((o.anio || 0) - 1), xTot + wTot, wAnt - 4, y, neg, 7.5, PAPEL);
    der('VAR', xTot + wTot + wAnt, wVar - 4, y, neg, 7.5, PAPEL);
    y -= 18;
  }
  encabezado();

  (d.filas || []).forEach(f => {
    if (f.oculta) return;
    if (y < M + 40) { linea(y + 10); encabezado(); }
    const esM = f.tipo === 'margen';
    const size = f.nivel === 0 ? 8.5 : 8;
    const fuente = f.nivel <= 1 ? neg : reg;
    const color = esM ? SUAVE : TINTA;
    if (f.nivel === 0) {
      linea(y + 10, M, M + ANCHO, SUAVE);
      page.drawRectangle({ x: M, y: y - 3.5, width: ANCHO, height: 13,
                           color: rgb(0.94, 0.93, 0.90) });
    }
    txt(f.concepto, M + 6 + f.nivel * 9, y, fuente, size, color);
    meses.forEach((m, i) => {
      const v = f.meses[m - 1];
      if (v === null || v === undefined) return;
      der(esM ? pct(v, 0) : miles(v), xMes(i), wMes - 4, y, fuente, size,
          (!esM && v < 0) ? ROJO : color);
    });
    der(esM ? pct(f.total) : miles(f.total), xTot, wTot - 4, y, fuente, size,
        (!esM && f.total < 0) ? ROJO : color);
    der(esM ? pct(f.anterior) : miles(f.anterior), xTot + wTot, wAnt - 4, y, reg, size, SUAVE);
    let vr = '';
    if (esM && f.total !== null && f.anterior !== null && f.anterior !== undefined) {
      const pp = (f.total - f.anterior) * 100;
      vr = (pp > 0 ? '+' : '') + pp.toFixed(0) + 'pp';
    } else if (!esM && f.anterior) {
      const v = (f.total - f.anterior) / Math.abs(f.anterior) * 100;
      vr = (v > 0 ? '+' : '') + v.toFixed(0) + '%';
    }
    der(vr, xTot + wTot + wAnt, wVar - 4, y, fuente, size - 0.5,
        vr.indexOf('-') === 0 ? ROJO : (vr ? VERDE : SUAVE));
    y -= f.nivel === 0 ? 15 : 12;
  });

  // ---- Lo que hay que leer ----
  if ((o.lectura || []).length) {
    if (y < M + 120) encabezado();
    y -= 12;
    linea(y + 6);
    y -= 10;
    txt('LO QUE HAY QUE REVISAR', M, y, neg, 9);
    y -= 14;
    o.lectura.forEach(l => {
      if (y < M + 30) { encabezado(); }
      txt('-', M + 2, y, neg, 8, VERDE);
      // El texto se parte a mano porque va a dos columnas de ancho completo
      const pal = limpio(l).split(/\s+/);
      let li = '';
      const salida = [];
      pal.forEach(p => {
        const x = li ? li + ' ' + p : p;
        if (reg.widthOfTextAtSize(x, 8) <= ANCHO - 16) li = x;
        else { salida.push(li); li = p; }
      });
      if (li) salida.push(li);
      salida.forEach((s, i) => { txt(s, M + 12, y - i * 10, reg, 8, TINTA); });
      y -= salida.length * 10 + 5;
    });
  }

  // pie
  const n = pdf.getPageCount();
  for (let i = 0; i < n; i++) {
    const p = pdf.getPage(i);
    p.drawText(limpio((o.empresa || '') + '  ·  ' + (o.titulo || '') + '  ·  ' + (i + 1) + '/' + n),
      { x: M, y: 20, size: 7, font: reg, color: SUAVE });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { reporteEstado, miles, pesos };
