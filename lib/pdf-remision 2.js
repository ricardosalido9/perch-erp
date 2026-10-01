// La Remisión de Entrega: el papel que firma el cliente cuando recibe.
//
// Sigue el formato de diseño: el logotipo arriba, los datos del documento a la
// derecha, el cliente y su dirección, la tabla de muebles con medidas, y abajo
// los dos recuadros de firma —el que revisó la mercancía y el que decidió no
// desempacarla—. Esa distinción importa: lo que se firma cambia de quién es la
// responsabilidad, así que van los dos y el cliente firma el que corresponda.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const path = require('path');
const fs = require('fs');

const A4 = { w: 612, h: 792 };
const M = 44;
const TINTA = rgb(0.29, 0.15, 0.15);   // el vino oscuro del documento
const SUAVE = rgb(0.45, 0.45, 0.43);
const LINEA = rgb(0.80, 0.79, 0.76);

const DIR = path.join(__dirname, 'assets');
function archivo(nombre, sub) {
  try {
    const f = path.join(__dirname, '..', 'assets', sub || '', nombre);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  } catch (e) { return null; }
}
// pdf-lib solo dibuja lo que la tipografía tiene; un carácter raro tira el documento
function limpio(v) {
  let t = String(v == null ? '' : v);
  t = t.replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl');
  t = t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
       .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00A0/g, ' ');
  return t.replace(/[^\x00-\xFF]/g, (c) => {
    const base = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\x00-\xFF]+$/.test(base) ? base : '';
  });
}

async function remisionPDF(d, o) {
  o = o || {};
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  let reg = await pdf.embedFont(StandardFonts.Helvetica);
  let neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let tit = neg;
  const cargar = async (n) => {
    const b = archivo(n, 'fuentes');
    if (!b) return null;
    try { return await pdf.embedFont(b, { subset: false }); } catch (e) { return null; }
  };
  const everett = await cargar('Everett-Regular.otf');
  const victoria = await cargar('VictorianOrchid-Regular.otf');
  const vicBook = await cargar('VictorianOrchid-Book.otf');
  if (everett) reg = everett;
  tit = victoria || vicBook || neg;
  neg = vicBook || victoria || neg;

  let logo = null;
  try { const b = archivo('Perch_Logo.png'); if (b) logo = await pdf.embedPng(b); } catch (e) {}

  const page = pdf.addPage([A4.w, A4.h]);
  const ANCHO = A4.w - M * 2;
  const txt = (t, x, y, f, s, c, sp) =>
    page.drawText(limpio(t), { x, y, size: s, font: f, color: c || TINTA,
                               characterSpacing: sp || 0 });
  const der = (t, x, w, y, f, s, c) => {
    const t2 = limpio(t);
    page.drawText(t2, { x: x + w - f.widthOfTextAtSize(t2, s), y, size: s, font: f, color: c || TINTA });
  };
  const renglones = (t, f, s, ancho) => {
    const out = [];
    String(t == null ? '' : t).split(/\r?\n/).forEach(parrafo => {
      let linea = '';
      limpio(parrafo).split(/\s+/).filter(Boolean).forEach(p => {
        const prueba = linea ? linea + ' ' + p : p;
        if (f.widthOfTextAtSize(prueba, s) > ancho) { if (linea) out.push(linea); linea = p; }
        else linea = prueba;
      });
      out.push(linea);
    });
    return out.filter(x => x !== undefined);
  };

  // ---- encabezado ----
  // Medidas tomadas de la remisión de diseño: el logotipo grande arriba a la
  // izquierda, los datos de la empresa debajo, y el bloque del documento a la
  // derecha con DOCUMENTO, FECHA y FOLIO en ese orden.
  const arriba = (v) => A4.h - v;          // la plantilla se mide desde arriba
  if (logo) {
    const w = 140, h = w * (logo.height / logo.width);
    page.drawImage(logo, { x: 45, y: arriba(58) - 4, width: w, height: h });
  } else {
    txt('PÉRCH', 45, arriba(56), tit, 20, TINTA, 9);
  }
  let yy = arriba(96);
  [(o.empresa || 'PÉRCH'), 'WWW.PERCH.COM', (o.telefono || '+52 1 56 1801 7975')]
    .forEach(l => { txt(l, 45, yy, reg, 9, TINTA); yy -= 12; });

  const xd = 289, wd = 578 - 289;
  let yd = arriba(58);
  [['DOCUMENTO', 'Remisión de Entrega'],
   ['FECHA', d.fecha || ''],
   ['FOLIO NO.', d.folioRemision || '']].forEach(f => {
    txt(f[0], xd, yd, tit, 9.5, TINTA, 0.2);
    der(f[1], xd, wd, yd, reg, 9, TINTA);
    page.drawLine({ start: { x: xd, y: yd - 6 }, end: { x: xd + wd, y: yd - 6 },
                    thickness: 0.7, color: TINTA });
    yd -= 23;
  });

  // ---- cliente, teléfono y dirección: bloque de la izquierda ----
  const xv = 155, wb = 330 - 39;           // dónde empieza el valor y hasta dónde llega la línea
  let yb = arriba(174);
  const renglon = (etiqueta, valor, lineas) => {
    txt(etiqueta, 39, yb, tit, 9.5, TINTA, 0.2);
    (lineas || [String(valor || '')]).forEach((l, k) => {
      txt(l, xv, yb - k * 12, reg, 9, TINTA);
    });
    const alto = ((lineas || ['']).length - 1) * 12;
    page.drawLine({ start: { x: 39, y: yb - alto - 7 }, end: { x: 39 + wb, y: yb - alto - 7 },
                    thickness: 0.7, color: TINTA });
    yb -= alto + 25;
  };
  renglon('CLIENTE', d.cliente || '');
  renglon('TELÉFONO', d.telefonoCliente || '');
  renglon('DIRECCIÓN', '', renglones(d.direccion || '', reg, 9, 330 - xv));

  // ---- tabla ----
  const yTab = arriba(325);
  const C = { item: 88, det: 200, med: 150 };   // CANTIDAD va alineada a la derecha
  let x = 42;
  txt('ITEM', x, yTab, tit, 9.5, TINTA, 0.2); x += C.item;
  txt('DETALLES', x, yTab, tit, 9.5, TINTA, 0.2); x += C.det;
  // MEDIDAS va centrada sobre su columna, como en la plantilla
  const wMed = C.med;
  const tm = 'MEDIDAS';
  page.drawText(tm, { x: x + (wMed - tit.widthOfTextAtSize(tm, 9.5)) / 2, y: yTab,
                      size: 9.5, font: tit, color: TINTA });
  der('CANTIDAD', 42, 572 - 42, yTab, tit, 9.5, TINTA);
  page.drawLine({ start: { x: 42, y: yTab - 10 }, end: { x: 572, y: yTab - 10 },
                  thickness: 0.7, color: TINTA });

  let y = yTab - 30;
  let piezas = 0;
  (d.items || []).forEach(it => {
    if (y < 180) return;                    // abajo mandan las firmas
    let x2 = 42;
    txt(it.item || '', x2, y, reg, 9, TINTA); x2 += C.item;
    renglones(it.detalle || '', reg, 9, C.det - 10)
      .forEach((l, k) => txt(l, x2, y - k * 11, reg, 9, TINTA));
    x2 += C.det;
    const med = limpio(it.medidas || '');
    page.drawText(med, { x: x2 + (wMed - reg.widthOfTextAtSize(med, 9)) / 2, y,
                         size: 9, font: reg, color: TINTA });
    der(String(it.cantidad == null ? '' : it.cantidad), 42, 572 - 42, y, reg, 9, TINTA);
    piezas += Number(it.cantidad) || 0;
    y -= 27;
  });
  page.drawLine({ start: { x: 42, y: y + 12 }, end: { x: 572, y: y + 12 },
                  thickness: 0.7, color: TINTA });

  // El total, abajo a la derecha
  const nPz = String(d.totalPiezas != null ? d.totalPiezas : piezas);
  const yTot = y - 12;
  der('CANTIDAD DE ARTÍCULOS', 42, 572 - 42 - 34, yTot, tit, 9.5, TINTA);
  der(nPz, 42, 572 - 42, yTot, reg, 9, TINTA);

  // ---- firmas: la línea arriba y el texto debajo, centrado ----
  const yLinea = arriba(656);
  const anchoF = 203;
  [[89, 'RECIBÍ Y REVISÉ EL MOBILIARIO, AFIRMO QUE LAS PIEZAS CUENTAN CON EL DISEÑO Y CALIDAD PACTADO'],
   [350, 'RECIBÍ EL MOBILIARIO EN PERFECTAS CONDICIONES Y DECIDÍ NO DESEMPACARLO PARA SU CORRECTA REVISIÓN.']
  ].forEach(([x0, t]) => {
    page.drawLine({ start: { x: x0, y: yLinea }, end: { x: x0 + anchoF, y: yLinea },
                    thickness: 0.7, color: TINTA });
    let yt = yLinea - 15;
    renglones(t, reg, 7.5, anchoF).forEach(l => {
      page.drawText(limpio(l), { x: x0 + (anchoF - reg.widthOfTextAtSize(limpio(l), 7.5)) / 2,
                                 y: yt, size: 7.5, font: reg, color: TINTA });
      yt -= 10;
    });
  });

  // ---- pie legal, centrado ----
  const pie = '*Al firmar este documento afirmo que a partir de este día PERCH no se hará ' +
    'responsable por inconformidades en cualquier detalle de calidad o quejas sobre los ' +
    'acabados, texturas, formas, colores y dimensiones del mobiliario.';
  let yp = arriba(750);
  renglones(pie, reg, 7, 380).forEach(l => {
    page.drawText(limpio(l), { x: (A4.w - reg.widthOfTextAtSize(limpio(l), 7)) / 2, y: yp,
                               size: 7, font: reg, color: TINTA });
    yp -= 9.5;
  });

  return Buffer.from(await pdf.save());
}

module.exports = { remisionPDF };
