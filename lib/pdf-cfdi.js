// Reporte mensual de CFDIs, en el formato que el contador ya usa: portada y una
// hoja por tipo, con tablas de subtotal, IVA y total. Horizontal, como el original.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const HOJA = { w: 841.89, h: 595.28 };
const M = 40;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const VERDE = rgb(0.36, 0.42, 0.31);       // el verde de encabezado del formato
const BLANCO = rgb(1, 1, 1);
const ROJO = rgb(0.63, 0.24, 0.20);

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
  if (!v) return '$  -';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function recorta(t, font, size, ancho) {
  let s = limpio(t);
  if (font.widthOfTextAtSize(s, size) <= ancho) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > ancho) s = s.slice(0, -1);
  return s + '...';
}

async function reporteCfdi(d, o) {
  const opt = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = HOJA.w - M * 2;
  let page = null, y = 0, etiquetaPie = '';

  const txt = (t, x, yy, f, s, c) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f || reg, color: c || TINTA });
  const der = (t, x, w, yy, f, s, c) => {
    const tl = limpio(t);
    page.drawText(tl, { x: x + w - (f || reg).widthOfTextAtSize(tl, s), y: yy,
                        size: s, font: f || reg, color: c || TINTA });
  };

  // ===== Portada =====
  page = pdf.addPage([HOJA.w, HOJA.h]);
  if (logo) {
    const w = 150, h = w * (LOGO.alto / LOGO.ancho);
    page.drawImage(logo, { x: (HOJA.w - w) / 2, y: HOJA.h - 150, width: w, height: h });
  }
  const titulo = 'CFDIs ' + d.anio;
  txt(titulo, (HOJA.w - neg.widthOfTextAtSize(titulo, 40)) / 2, HOJA.h / 2 + 10, neg, 40, TINTA);
  const sub = d.mes + ' ' + d.anio;
  txt(sub, (HOJA.w - reg.widthOfTextAtSize(sub, 16)) / 2, HOJA.h / 2 - 20, reg, 16, SUAVE);
  const datosPortada = [
    ['Razón Social', d.empresa || ''],
    ['RFC', d.rfc || ''],
    ['Periodo', d.mes + ' ' + d.anio],
    ['Generado', opt.generado || '']
  ];
  let yp = HOJA.h / 2 - 80;
  datosPortada.forEach(f => {
    if (!f[1]) return;
    txt(f[0], HOJA.w / 2 - 200, yp, reg, 9.5, SUAVE);
    txt(f[1], HOJA.w / 2 - 20, yp, reg, 9.5, TINTA);
    yp -= 18;
  });
  txt('Portada', HOJA.w - M - reg.widthOfTextAtSize('Portada', 8), M - 14, reg, 8, SUAVE);

  function nuevaPagina(tituloHoja) {
    page = pdf.addPage([HOJA.w, HOJA.h]);
    etiquetaPie = tituloHoja;
    y = HOJA.h - M;
    if (logo) {
      const w = 66, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    const t = tituloHoja + ' ' + d.mes + ' ' + d.anio;
    txt(t, (HOJA.w - neg.widthOfTextAtSize(t, 16)) / 2, y - 22, neg, 16, VERDE);
    y -= 58;
  }

  // Una tabla con encabezado verde, como el formato del contador
  function tabla(x, ancho, titulo2, cols, filas, opciones) {
    const op2 = opciones || {};
    const alto = 14;
    // Encabezado
    page.drawRectangle({ x, y: y - alto + 3, width: ancho, height: alto, color: VERDE });
    let cx = x + 4;
    cols.forEach((c, i) => {
      const t = (i === 0) ? titulo2 : c.t;
      if (c.der) der(t, cx, c.w - 8, y - alto + 7, neg, 6.5, BLANCO);
      else txt(t, cx, y - alto + 7, neg, 6.5, BLANCO);
      cx += c.w;
    });
    y -= alto + 4;
    // Filas
    filas.forEach(f => {
      cx = x + 4;
      cols.forEach((c, i) => {
        const v = f[i] == null ? '' : String(f[i]);
        const fuente = f._neg ? neg : reg;
        const color = f._color || TINTA;
        if (c.der) der(recorta(v, fuente, 7, c.w - 8), cx, c.w - 8, y, fuente, 7, color);
        else txt(recorta(v, fuente, 7, c.w - 8), cx, y, fuente, 7, color);
        cx += c.w;
      });
      y -= 12;
    });
    // Total
    if (op2.total) {
      page.drawLine({ start: { x, y: y + 8 }, end: { x: x + ancho, y: y + 8 },
                      thickness: 0.5, color: LINEA });
      y -= 2;
      cx = x + 4;
      cols.forEach((c, i) => {
        const v = op2.total[i] == null ? '' : String(op2.total[i]);
        if (c.der) der(recorta(v, neg, 7.5, c.w - 8), cx, c.w - 8, y, neg, 7.5, TINTA);
        else txt(v, cx, y, neg, 7.5, TINTA);
        cx += c.w;
      });
      y -= 16;
    }
    y -= 10;
  }

  // Bloque de "renglones sueltos" (concepto a la izquierda, importe a la derecha)
  function lista(x, ancho, filas) {
    filas.forEach(f => {
      txt(f[0], x, y, f[2] ? neg : reg, 7.5, f[2] ? TINTA : SUAVE);
      der(f[1], x, ancho, y, f[2] ? neg : reg, 7.5, f[3] || TINTA);
      y -= 13;
    });
    y -= 8;
  }

  // ===== Una hoja por bloque de CFDIs =====
  function hojaDeCfdis(b, titulo2, conRetenciones) {
    if (!b) return;
    nuevaPagina(titulo2);
    const colIzq = M, anchoIzq = 350;
    // La columna derecha arranca en 380 y mide 380: las tablas de abajo suman
    // exactamente eso, si no la última columna se salía de la caja.
    const colDer = M + 390, anchoDer = 380;
    const yInicio = y;

    // --- Izquierda: por tipo y los totales del mes ---
    const cols3 = [{ t: '', w: 120 }, { t: 'Subtotal', w: 78, der: true },
                   { t: 'IVA', w: 72, der: true }, { t: 'Total', w: 80, der: true }];
    tabla(colIzq, anchoIzq, 'Por Tipo', cols3,
      b.porTipo.map(x => [x.etiqueta, money(x.subtotal), money(x.iva), money(x.total)]),
      { total: ['Total', money(b.totales.subtotal), money(b.totales.iva), money(b.totales.total)] });

    const izq = [
      [titulo2 === 'CFDIs Emitidos' ? 'IVA Trasladado' : 'IVA Acreditable',
       money(b.totales.iva), true]
    ];
    if (conRetenciones) {
      izq.push(['Retenciones de IVA', money(b.totales.retIva), true]);
      izq.push(['Retenciones de ISR', money(b.totales.retIsr), true]);
    }
    izq.push(['Comprobantes del periodo', String(b.n), false]);
    izq.push(['Pagadas en una exhibicion (PUE)', String(b.totales.pue), false]);
    izq.push(['En parcialidades (PPD)', String(b.totales.ppd), false]);
    if (b.totales.ivaPPDsinComplemento) {
      izq.push(['IVA de PPD sin complemento', money(b.totales.ivaPPDsinComplemento),
                true, ROJO]);
    }
    lista(colIzq, anchoIzq, izq);

    // --- Derecha: método de pago y complementos ---
    y = yInicio;
    const colsMet = conRetenciones
      ? [{ t: '', w: 96 }, { t: 'Subtotal', w: 58, der: true }, { t: 'IVA', w: 54, der: true },
         { t: 'Ret. IVA', w: 50, der: true }, { t: 'Ret. ISR', w: 50, der: true },
         { t: 'Total', w: 72, der: true }]
      : [{ t: '', w: 140 }, { t: 'Subtotal', w: 82, der: true },
         { t: 'IVA', w: 78, der: true }, { t: 'Total', w: 80, der: true }];
    tabla(colDer, anchoDer, 'Metodo de Pago', colsMet,
      b.porMetodo.map(x => conRetenciones
        ? [x.etiqueta.replace(/ - .*/, ''), money(x.subtotal), money(x.iva),
           money(x.retIva), money(x.retIsr), money(x.total)]
        : [x.etiqueta, money(x.subtotal), money(x.iva), money(x.total)]),
      { total: conRetenciones
        ? ['Total', money(b.totales.subtotal), money(b.totales.iva), money(b.totales.retIva),
           money(b.totales.retIsr), money(b.totales.total)]
        : ['Total', money(b.totales.subtotal), money(b.totales.iva), money(b.totales.total)] });

    const cols4 = [{ t: '', w: 140 }, { t: 'Subtotal', w: 82, der: true },
                   { t: 'IVA', w: 78, der: true }, { t: 'Total', w: 80, der: true }];
    tabla(colDer, anchoDer, 'Complementos de Pago', cols4,
      b.complementos.map(x => [x.etiqueta + ' (' + x.n + ')', money(x.subtotal),
                               money(x.iva), money(x.total)]));
  }

  hojaDeCfdis(d.emitidos, 'CFDIs Emitidos', false);
  hojaDeCfdis(d.recibidos, 'CFDIs Recibidos', true);

  // ===== Nómina =====
  if (d.nomina) {
    nuevaPagina('CFDIs Nomina');
    const n = d.nomina;
    const cols = [{ t: '', w: 130 }, { t: 'Percepciones', w: 92, der: true },
                  { t: 'Descuento', w: 80, der: true }, { t: 'Total', w: 88, der: true },
                  { t: 'Retenidos', w: 84, der: true }];
    const ancho = 474;
    tabla(M, ancho, 'Por Tipo', cols,
      n.porTipo.map(x => [x.etiqueta, money(x.percepciones), money(x.descuento),
                          money(x.total), money(x.retenidos)]),
      { total: ['Total', money(n.totales.percepciones), money(n.totales.descuento),
                money(n.totales.total), money(n.totales.retenidos)] });
    tabla(M, ancho, 'Por Regimen', cols,
      n.porRegimen.map(x => [x.etiqueta, money(x.percepciones), money(x.descuento),
                             money(x.total), money(x.retenidos)]),
      { total: ['Total', money(n.totales.percepciones), money(n.totales.descuento),
                money(n.totales.total), money(n.totales.retenidos)] });
  }

  // ===== Resumen del IVA del mes =====
  if (d.iva) {
    nuevaPagina('Resumen del mes');
    const cols = [{ t: '', w: 300 }, { t: 'Importe', w: 160, der: true }];
    const f1 = ['IVA trasladado (lo que facturamos)', money(d.iva.trasladado)];
    const f2 = ['IVA acreditable (lo que nos facturaron)', money(d.iva.acreditable)];
    const f3 = ['Diferencia', money(d.iva.diferencia)];
    f3._neg = true;
    f3._color = d.iva.diferencia >= 0 ? TINTA : VERDE;
    tabla(M, 460, 'IVA del periodo', cols, [f1, f2, f3]);
    y -= 6;
    txt('Esta diferencia NO es el impuesto a pagar: no incluye retenciones, saldos a favor',
        M, y, reg, 7.5, SUAVE); y -= 11;
    txt('de meses anteriores ni el efecto de los complementos pendientes. La determinacion',
        M, y, reg, 7.5, SUAVE); y -= 11;
    txt('del impuesto la hace el contador; este reporte es el respaldo de los comprobantes.',
        M, y, reg, 7.5, SUAVE); y -= 20;

    if ((d.advertencias || []).length) {
      txt('Avisos de este reporte', M, y, neg, 9, ROJO); y -= 14;
      d.advertencias.forEach(a => {
        txt('- ' + a, M, y, reg, 7.5, ROJO); y -= 11;
      });
    }
  }

  // Pie en todas menos la portada
  pdf.getPages().forEach((p, i) => {
    if (i === 0) return;
    const t = limpio((d.empresa || '') + '  ·  ' + d.mes + ' ' + d.anio + '  ·  ' + (i + 1));
    p.drawText(t, { x: (HOJA.w - reg.widthOfTextAtSize(t, 6.5)) / 2, y: M - 18,
                    size: 6.5, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { reporteCfdi };
