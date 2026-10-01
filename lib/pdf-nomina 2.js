// Reporte mensual de nómina. Vertical, en la hoja de estilo de Perch.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const VERDE = rgb(0.17, 0.43, 0.29);
const AMBAR = rgb(0.55, 0.42, 0.12);
const ROJO = rgb(0.63, 0.24, 0.20);

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
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function corto(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'k';
  return '$' + Math.round(v);
}

async function reporteNomina(d, o) {
  const opt = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0, pagina = 0;

  const txt = (t, x, yy, f, s, c) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f || reg, color: c || TINTA });
  const der = (t, x, w, yy, f, s, c) => {
    const tl = limpio(t);
    page.drawText(tl, { x: x + w - (f || reg).widthOfTextAtSize(tl, s), y: yy,
                        size: s, font: f || reg, color: c || TINTA });
  };
  const raya = (yy, g, c) => page.drawLine({ start: { x: M, y: yy }, end: { x: A4.w - M, y: yy },
                                             thickness: g || 0.5, color: c || LINEA });
  function recorta(t, font, size, ancho) {
    let s = limpio(t);
    if (font.widthOfTextAtSize(s, size) <= ancho) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > ancho) s = s.slice(0, -1);
    return s + '...';
  }
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
      txt('NÓMINA DE ' + String(d.mes || '').toUpperCase() + ' ' + (d.anio || ''),
          M, y, neg, 14, TINTA);
      der(opt.generado || '', M, ANCHO, y, reg, 9, SUAVE);
      y -= 24;
    } else {
      txt(String(d.mes || '') + ' ' + (d.anio || ''), M, y, neg, 9, SUAVE);
      y -= 18;
    }
  }
  function espacio(alto) { if (y - alto < M + 40) nuevaPagina(); }
  function titulo(t, sub) {
    espacio(60);
    y -= 8;
    txt(t, M, y, neg, 10.5, TINTA);
    y -= 12;
    if (sub) { txt(sub, M, y, reg, 8, SUAVE); y -= 10; }
    raya(y + 3, 0.7, TINTA);
    y -= 14;
  }
  function cajas(lista) {
    espacio(60);
    const ancho = (ANCHO - (lista.length - 1) * 8) / lista.length;
    lista.forEach((c, i) => {
      const x = M + i * (ancho + 8);
      page.drawRectangle({ x, y: y - 46, width: ancho, height: 46,
        color: rgb(0.97, 0.965, 0.95), borderColor: LINEA, borderWidth: 0.5 });
      txt(c.t, x + 9, y - 15, neg, 6.5, SUAVE);
      txt(c.v, x + 9, y - 32, neg, 15, c.c || TINTA);
      if (c.s) txt(recorta(c.s, reg, 6.5, ancho - 16), x + 9, y - 42, reg, 6.5, SUAVE);
    });
    y -= 60;
  }
  function tabla(cols, filas, total) {
    espacio(40);
    let x = M;
    cols.forEach(c => {
      if (c.der) der(c.t, x, c.w - 6, y, neg, 7, SUAVE);
      else txt(c.t, x, y, neg, 7, SUAVE);
      x += c.w;
    });
    y -= 6; raya(y, 0.5); y -= 12;
    filas.forEach(f => {
      espacio(20);
      x = M;
      cols.forEach((c, i) => {
        const fu = f._neg ? neg : reg;
        const co = f._color || TINTA;
        const v = recorta(f[i] == null ? '' : String(f[i]), fu, 8, c.w - 6);
        if (c.der) der(v, x, c.w - 6, y, fu, 8, co);
        else txt(v, x, y, fu, 8, co);
        x += c.w;
      });
      y -= 12;
    });
    if (total) {
      raya(y + 8, 0.6, TINTA);
      y -= 4;
      x = M;
      cols.forEach((c, i) => {
        const v = total[i] == null ? '' : String(total[i]);
        if (c.der) der(v, x, c.w - 6, y, neg, 8.5, TINTA);
        else txt(v, x, y, neg, 8.5, TINTA);
        x += c.w;
      });
      y -= 16;
    }
    y -= 8;
  }

  nuevaPagina();

  // ===== El mes de un vistazo =====
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const flecha = (v) => v == null ? '—' : (v >= 0 ? '+' + Math.round(v) + '%' : Math.round(v) + '%');
  const vsMes = pct(d.resumen.neto, d.mesAnterior.neto);
  cajas([
    { t: 'NETO PAGADO', v: corto(d.resumen.neto), s: d.resumen.recibos + ' recibos', c: TINTA },
    { t: 'COLABORADORES', v: String(d.resumen.colaboradores),
      s: 'plantilla de ' + d.plantilla, c: TINTA },
    { t: 'CONTRA EL MES ANTERIOR', v: flecha(vsMes),
      s: corto(d.mesAnterior.neto) + ' en ' + (d.mesAnteriorNombre || ''),
      c: (vsMes || 0) <= 0 ? VERDE : AMBAR },
    { t: 'PROMEDIO', v: corto(d.promedio), s: 'neto por persona', c: TINTA }
  ]);

  titulo('EL MES', 'Contra el mes anterior y contra el mismo mes del año pasado');
  const fN = ['Neto pagado', money(d.resumen.neto), money(d.mesAnterior.neto),
              money(d.mismoMesAnioAnterior.neto)];
  fN._neg = true;
  tabla([{ t: 'Concepto', w: ANCHO - 300 }, { t: 'Este mes', w: 100, der: true },
         { t: d.mesAnteriorNombre || 'Mes anterior', w: 100, der: true },
         { t: 'Año pasado', w: 100, der: true }],
    [['Bruto', money(d.resumen.bruto), money(d.mesAnterior.bruto),
      money(d.mismoMesAnioAnterior.bruto)],
     fN,
     ['Retenido', money(d.resumen.bruto - d.resumen.neto),
      money(d.mesAnterior.bruto - d.mesAnterior.neto),
      money(d.mismoMesAnioAnterior.bruto - d.mismoMesAnioAnterior.neto)],
     ['Colaboradores', String(d.resumen.colaboradores), String(d.mesAnterior.colaboradores),
      String(d.mismoMesAnioAnterior.colaboradores)],
     ['Recibos timbrados', String(d.resumen.recibos), String(d.mesAnterior.recibos),
      String(d.mismoMesAnioAnterior.recibos)]]);

  // ===== Movimientos de personal =====
  titulo('MOVIMIENTOS DEL MES', 'Altas, bajas y rotación');
  const fRot = ['Rotación', (d.rotacion || 0).toFixed(1) + '%'];
  fRot._neg = true;
  fRot._color = (d.rotacion || 0) > 10 ? AMBAR : VERDE;
  tabla([{ t: 'Concepto', w: ANCHO - 120 }, { t: '', w: 120, der: true }],
    [['Altas', String((d.altas || []).length)],
     ['Bajas', String((d.bajas || []).length)],
     ['Plantilla al cierre', String(d.plantilla)],
     fRot]);
  if ((d.altas || []).length || (d.bajas || []).length) {
    const lineas = [];
    (d.altas || []).forEach(a => lineas.push(['Alta', a.nombre, a.puesto || '']));
    (d.bajas || []).forEach(b => {
      const f = ['Baja', b.nombre, b.puesto || ''];
      f._color = ROJO;
      lineas.push(f);
    });
    tabla([{ t: 'Movimiento', w: 80 }, { t: 'Nombre', w: 250 },
           { t: 'Puesto', w: ANCHO - 330 }], lineas);
  }

  // ===== Por área =====
  if ((d.porArea || []).length) {
    titulo('POR ÁREA', 'Con el desglose de cada puesto');
    const filas = [];
    d.porArea.forEach(a => {
      const f = [a.area, String(a.colaboradores), money(a.bruto), money(a.neto)];
      f._neg = true;
      filas.push(f);
      a.puestos.forEach(p => {
        filas.push(['   ' + p.puesto, String(p.colaboradores), money(p.bruto), money(p.neto)]);
      });
    });
    tabla([{ t: 'Área y puesto', w: ANCHO - 300 }, { t: 'Personas', w: 70, der: true },
           { t: 'Bruto', w: 115, der: true }, { t: 'Neto', w: 115, der: true }],
      filas,
      ['Total', String(d.resumen.colaboradores), money(d.resumen.bruto), money(d.resumen.neto)]);
  }

  // ===== Por tipo de pago =====
  if ((d.porTipoPago || []).length) {
    titulo('POR TIPO DE PAGO', 'Nómina, honorarios y asimilados se declaran distinto');
    tabla([{ t: 'Tipo', w: ANCHO - 300 }, { t: 'Personas', w: 70, der: true },
           { t: 'Bruto', w: 115, der: true }, { t: 'Neto', w: 115, der: true }],
      d.porTipoPago.map(t => [t.tipo, String(t.colaboradores), money(t.bruto), money(t.neto)]));
  }

  // ===== El año =====
  if (d.anioAcumulado && d.anioAcumulado.neto) {
    titulo('EL AÑO HASTA HOY', 'Acumulado contra el mismo periodo del año pasado');
    const cambio = pct(d.anioAcumulado.neto, d.anioAnterior.neto);
    const fa = ['Neto pagado en el año', money(d.anioAcumulado.neto),
                money(d.anioAnterior.neto), flecha(cambio)];
    fa._neg = true;
    fa._color = (cambio || 0) <= 0 ? VERDE : AMBAR;
    tabla([{ t: 'Concepto', w: ANCHO - 300 }, { t: String(d.anio), w: 100, der: true },
           { t: 'Año pasado', w: 100, der: true }, { t: 'Cambio', w: 100, der: true }],
      [fa,
       ['Bruto en el año', money(d.anioAcumulado.bruto), money(d.anioAnterior.bruto),
        flecha(pct(d.anioAcumulado.bruto, d.anioAnterior.bruto))]]);
  }

  // ===== Detalle =====
  if ((d.detalle || []).length) {
    nuevaPagina();
    titulo('DETALLE DEL MES', 'Un renglón por recibo timbrado');
    tabla([{ t: 'Timbrado', w: 74 }, { t: 'Nombre', w: 158 }, { t: 'Puesto', w: 96 },
           { t: 'Tipo', w: 58 }, { t: 'Bruto', w: 66, der: true },
           { t: 'Neto', w: ANCHO - 452, der: true }],
      d.detalle.map(r => [r.timbrado, r.nombre, r.puesto || r.departamento || '',
                          r.tipoPago, money(r.bruto), money(r.neto)]),
      ['', String(d.resumen.recibos) + ' recibos', '', '',
       money(d.resumen.bruto), money(d.resumen.neto)]);
  }

  if (opt.notas) {
    espacio(40);
    y -= 6;
    txt('NOTAS', M, y, neg, 9, TINTA); y -= 14;
    String(opt.notas).split(/\n/).forEach(l => {
      txt(recorta(l, reg, 8, ANCHO), M, y, reg, 8, SUAVE); y -= 11;
    });
  }

  pdf.getPages().forEach((p, i) => {
    const t = limpio((d.empresa || '') + '  ·  Nómina ' + (d.mes || '') + ' ' + (d.anio || '') +
                     '  ·  ' + (i + 1));
    p.drawText(t, { x: (A4.w - reg.widthOfTextAtSize(t, 7)) / 2, y: M - 20,
                    size: 7, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { reporteNomina };
