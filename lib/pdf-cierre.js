// Reporte mensual de cierre: el resumen del mes en PDF, listo para entregar.
// Ventas, costos, margen, productos, clientes, marketing y comparación con el año.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const PAPEL = rgb(0.97, 0.965, 0.95);
const VERDE = rgb(0.17, 0.43, 0.29);
const ROJO = rgb(0.62, 0.24, 0.20);
const AMBAR = rgb(0.55, 0.42, 0.12);

// pdf-lib con fuentes estándar solo dibuja Latin-1: se limpia lo que no puede
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
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function corto(n) {
  const v = Math.abs(Number(n) || 0);
  const s = (Number(n) || 0) < 0 ? '-' : '';
  if (v >= 1000000) return s + '$' + (v / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (v >= 1000) return s + '$' + Math.round(v / 1000) + 'k';
  return s + '$' + Math.round(v);
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

async function reporteMensual(d, o) {
  o = o || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0, pagina = 0;

  const txt = (t, x, yy, f, s, c) =>
    page.drawText(limpio(t), { x, y: yy, size: s, font: f, color: c || TINTA });
  const der = (t0, x, w, yy, f, s, c) => {
    const t = limpio(t0);
    page.drawText(t, { x: x + w - f.widthOfTextAtSize(t, s), y: yy, size: s, font: f, color: c || TINTA });
  };
  const raya = (yy, x1, x2, g, c) =>
    page.drawLine({ start: { x: x1 == null ? M : x1, y: yy }, end: { x: x2 == null ? (A4.w - M) : x2, y: yy },
                    thickness: g || 0.5, color: c || LINEA });

  function nuevaPagina() {
    page = pdf.addPage([A4.w, A4.h]);
    pagina++;
    y = A4.h - M;
    if (logo) {
      const w = 74, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    der('WWW.PERCH.MX', M, ANCHO, y - 17, neg, 7.5, TINTA);
    y -= 42;
    raya(y, M, A4.w - M, 0.8, TINTA);
    y -= 20;
    if (pagina === 1) {
      txt('CIERRE DE ' + String(o.mes || '').toUpperCase(), M, y, neg, 14, TINTA);
      der(o.subtitulo || '', M, ANCHO, y, reg, 9, SUAVE);
      y -= 26;
    } else {
      txt(String(o.mes || ''), M, y, neg, 9, SUAVE);
      y -= 18;
    }
  }
  function espacio(alto) { if (y - alto < M + 40) nuevaPagina(); }
  function titulo(t, sub) {
    espacio(60);
    txt(t, M, y, neg, 9.5, TINTA);
    y -= 11;
    if (sub) { txt(sub, M, y, reg, 7.5, SUAVE); y -= 10; }
    raya(y + 3, M, A4.w - M, 0.7, TINTA);
    y -= 13;
  }
  // Cajas de indicadores, cuatro por renglón
  function cajas(lista) {
    espacio(56);
    const ancho = (ANCHO - (lista.length - 1) * 8) / lista.length;
    lista.forEach((c, i) => {
      const x = M + i * (ancho + 8);
      page.drawRectangle({ x, y: y - 48, width: ancho, height: 48,
        color: PAPEL, borderColor: LINEA, borderWidth: 0.5 });
      txt(c.t, x + 9, y - 15, neg, 6.5, SUAVE);
      txt(c.v, x + 9, y - 33, neg, c.v.length > 9 ? 12 : 14, c.c || TINTA);
      if (c.s) txt(c.s, x + 9, y - 42, reg, 6, SUAVE);
    });
    y -= 62;
  }
  // Tabla con columnas configurables
  function tabla(cols, filas, o2) {
    o2 = o2 || {};
    if (!filas.length) {
      txt(o2.vacio || 'Sin movimientos este mes.', M, y, reg, 8, SUAVE);
      y -= 18; return;
    }
    espacio(30);
    let x = M;
    cols.forEach(c => {
      if (c.der) der(c.t, x, c.w, y, neg, 7, SUAVE);
      else txt(c.t, x, y, neg, 7, SUAVE);
      x += c.w;
    });
    y -= 6; raya(y); y -= 11;
    filas.forEach(f => {
      espacio(22);
      x = M;
      cols.forEach((c, i) => {
        const v = String(f[i] == null ? '' : f[i]);
        const t = cortar(v, reg, 8, c.w - 6)[0] || '';
        const font = f._neg ? neg : reg;
        if (c.der) der(t, x, c.w, y, font, 8, f._color || TINTA);
        else txt(t, x, y, font, 8, f._color || TINTA);
        x += c.w;
      });
      y -= 13;
    });
    y -= 8;
  }
  // Barras horizontales
  function barras(filas, formato, color) {
    if (!filas.length) { txt('Sin datos.', M, y, reg, 8, SUAVE); y -= 18; return; }
    const max = Math.max.apply(null, filas.map(f => f.valor || 0)) || 1;
    const anchoEtq = 150, anchoVal = 78;
    const anchoBarra = ANCHO - anchoEtq - anchoVal - 12;
    filas.forEach(f => {
      espacio(20);
      txt(cortar(f.etiqueta, reg, 8, anchoEtq - 4)[0] || '', M, y, reg, 8, TINTA);
      const w = Math.max(2, Math.round((f.valor / max) * anchoBarra));
      page.drawRectangle({ x: M + anchoEtq, y: y - 2, width: anchoBarra, height: 9,
        color: PAPEL });
      page.drawRectangle({ x: M + anchoEtq, y: y - 2, width: w, height: 9,
        color: color || TINTA });
      der(formato ? formato(f.valor) : String(f.valor), M + anchoEtq + anchoBarra + 8, anchoVal, y,
          neg, 8, TINTA);
      y -= 15;
    });
    y -= 6;
  }

  nuevaPagina();

  // ===== 1. El mes de un vistazo =====
  const v = d.ventas || {};
  const cmp = d.comparacion || {};
  const flechita = (pct) => pct == null ? '' :
    (pct >= 0 ? '+' + Math.round(pct) + '%' : Math.round(pct) + '%');
  cajas([
    { t: 'VENDIDO', v: corto(v.total), s: v.operaciones + ' ventas',
      c: TINTA },
    { t: 'CONTRA EL MES ANTERIOR', v: flechita(cmp.ventasPct) || '—',
      s: cmp.ventasPrev != null ? 'antes ' + corto(cmp.ventasPrev) : '',
      c: (cmp.ventasPct || 0) >= 0 ? VERDE : ROJO },
    { t: 'TICKET PROMEDIO', v: corto(v.ticket), s: v.piezas + ' piezas' },
    { t: 'MARGEN', v: (v.margenPct != null ? Math.round(v.margenPct) + '%' : '—'),
      s: v.utilidad != null ? corto(v.utilidad) + ' de utilidad' : '',
      c: (v.margenPct || 0) >= 30 ? VERDE : AMBAR }
  ]);

  // ===== 2. Ventas y costos =====
  titulo('VENTAS Y COSTOS DEL MES');
  const filasVC = [];
  filasVC.push(['Vendido', money(v.total)]);
  if (v.costo != null) filasVC.push(['Costo de lo vendido', money(v.costo)]);
  if (v.utilidad != null) {
    const f = ['Utilidad bruta', money(v.utilidad)];
    f._neg = true;
    f._color = v.utilidad >= 0 ? VERDE : ROJO;
    filasVC.push(f);
  }
  if (v.envios) filasVC.push(['Cobrado por envíos', money(v.envios)]);
  if (v.descuentos) filasVC.push(['Descuentos otorgados', '-' + money(v.descuentos)]);
  tabla([{ t: 'Concepto', w: ANCHO - 130 }, { t: 'Importe', w: 130, der: true }], filasVC);

  // ===== 3. Qué se vendió =====
  if ((d.productos || []).length) {
    titulo('LO QUE MÁS SE VENDIÓ', 'Por importe, no por número de piezas');
    barras(d.productos.slice(0, 8).map(p => ({ etiqueta: p.nombre, valor: p.total })), corto);
  }

  // ===== 4. Clientes =====
  if ((d.clientes || []).length) {
    titulo('CLIENTES DEL MES');
    tabla([{ t: 'Cliente', w: 200 }, { t: 'Despacho', w: 150 },
           { t: 'Ventas', w: 60, der: true }, { t: 'Importe', w: ANCHO - 410, der: true }],
      d.clientes.slice(0, 10).map(c => [c.nombre, c.despacho || '', c.n, money(c.total)]));
    if (d.clientesNuevos != null) {
      txt(d.clientesNuevos + ' de ellos compraron por primera vez.', M, y, reg, 8, SUAVE);
      y -= 18;
    }
  }

  // ===== 5. De dónde llegaron =====
  if ((d.marketing || []).length) {
    titulo('DE DÓNDE LLEGARON', 'Según lo capturado al cerrar cada venta');
    barras(d.marketing.slice(0, 7).map(x => ({ etiqueta: x.canal, valor: x.total })), corto, VERDE);
  }

  // ===== 6. El embudo =====
  if (d.embudo) {
    titulo('CÓMO SE MOVIÓ EL EMBUDO');
    const e = d.embudo;
    const filasE = [
      ['Leads nuevos', e.leads || 0],
      ['Visitas al showroom', e.visitas || 0],
      ['Cotizaciones enviadas', e.cotizaciones || 0],
      ['Ventas cerradas', e.ventas || 0]
    ];
    if (e.conversion != null) {
      const f = ['Conversión de cotización a venta', Math.round(e.conversion) + '%'];
      f._neg = true;
      filasE.push(f);
    }
    tabla([{ t: 'Etapa', w: ANCHO - 100 }, { t: '', w: 100, der: true }], filasE);
  }

  // ===== 7. El año hasta hoy =====
  if ((d.historico || []).length) {
    titulo('EL AÑO HASTA HOY', 'Ventas cerradas por mes');
    espacio(140);
    const max = Math.max.apply(null, d.historico.map(x => x.total)) || 1;
    const ancho = (ANCHO - (d.historico.length - 1) * 6) / d.historico.length;
    const base = y - 96;
    d.historico.forEach((x, i) => {
      const px = M + i * (ancho + 6);
      const alto = Math.max(2, Math.round((x.total / max) * 78));
      const esteMes = x.mes === d.mesNumero;
      page.drawRectangle({ x: px, y: base, width: ancho, height: alto,
        color: esteMes ? TINTA : rgb(0.72, 0.74, 0.72) });
      const et = corto(x.total);
      const w = reg.widthOfTextAtSize(et, 6.5);
      txt(et, px + (ancho - w) / 2, base + alto + 4, reg, 6.5, SUAVE);
      const nm = (x.nombre || '').slice(0, 3);
      const w2 = reg.widthOfTextAtSize(nm, 7);
      txt(nm, px + (ancho - w2) / 2, base - 11, esteMes ? neg : reg, 7,
          esteMes ? TINTA : SUAVE);
    });
    y = base - 26;
    if (d.acumulado != null) {
      raya(y + 6);
      y -= 6;
      txt('Acumulado del año', M, y, neg, 8.5, TINTA);
      der(money(d.acumulado), M, ANCHO, y, neg, 10, TINTA);
      y -= 18;
    }
  }

  // ===== 8. Notas =====
  if (o.notas) {
    espacio(50);
    titulo('NOTAS DEL MES');
    cortar(o.notas, reg, 8.5, ANCHO).forEach(l => {
      espacio(16);
      txt(l, M, y, reg, 8.5, TINTA);
      y -= 12;
    });
  }

  const paginas = pdf.getPages();
  paginas.forEach((p2, i) => {
    const t = limpio('Perch Diseño y Mobiliario  ·  ' + (o.mes || '') +
                     '  ·  ' + (i + 1) + ' de ' + paginas.length);
    p2.drawText(t, { x: (A4.w - reg.widthOfTextAtSize(t, 7)) / 2, y: M - 20,
                     size: 7, font: reg, color: SUAVE });
  });
  return Buffer.from(await pdf.save());
}

module.exports = { reporteMensual };
