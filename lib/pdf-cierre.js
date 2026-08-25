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

  // Barras que comparan dos años: la de este año sólida, la del pasado en gris.
  // Es la forma más rápida de ver si un mes o una categoría creció o se cayó.
  function barrasComparadas(filas, formato, etiquetaA, etiquetaB) {
    if (!filas.length) { txt('Sin datos.', M, y, reg, 8, SUAVE); y -= 18; return; }
    espacio(150);
    const max = Math.max.apply(null, filas.map(x => Math.max(x.a || 0, x.b || 0))) || 1;
    const grupos = filas.length;
    const anchoGrupo = (ANCHO - (grupos - 1) * 10) / grupos;
    const anchoBarra = Math.min(22, (anchoGrupo - 4) / 2);
    const base = y - 104;
    // Leyenda
    page.drawRectangle({ x: M, y: y - 10, width: 9, height: 9, color: TINTA });
    txt(etiquetaA, M + 13, y - 9, reg, 7, SUAVE);
    const wA = reg.widthOfTextAtSize(etiquetaA, 7);
    page.drawRectangle({ x: M + 20 + wA, y: y - 10, width: 9, height: 9,
                         color: rgb(0.78, 0.79, 0.77) });
    txt(etiquetaB, M + 33 + wA, y - 9, reg, 7, SUAVE);

    filas.forEach((x, i) => {
      const px = M + i * (anchoGrupo + 10);
      const hA = Math.max(2, Math.round(((x.a || 0) / max) * 84));
      const hB = Math.max(2, Math.round(((x.b || 0) / max) * 84));
      // La del año pasado va detrás, a la izquierda
      page.drawRectangle({ x: px, y: base, width: anchoBarra, height: hB,
                           color: rgb(0.78, 0.79, 0.77) });
      page.drawRectangle({ x: px + anchoBarra + 3, y: base, width: anchoBarra, height: hA,
                           color: TINTA });
      const et = formato(x.a || 0);
      const w = reg.widthOfTextAtSize(et, 6);
      txt(et, px + anchoBarra + 3 + (anchoBarra - w) / 2, base + hA + 4, reg, 6, SUAVE);
      // Nombre debajo, cortado si no cabe
      const nm = recortaTexto(x.etiqueta, reg, 6.5, anchoGrupo);
      const w2 = reg.widthOfTextAtSize(nm, 6.5);
      txt(nm, px + (anchoGrupo - w2) / 2, base - 11, reg, 6.5, SUAVE);
      // Cuánto cambió
      if (x.b) {
        const cambio = ((x.a - x.b) / x.b) * 100;
        const ct = (cambio >= 0 ? '+' : '') + Math.round(cambio) + '%';
        const w3 = reg.widthOfTextAtSize(ct, 6.5);
        txt(ct, px + (anchoGrupo - w3) / 2, base - 21, neg, 6.5,
            cambio >= 0 ? VERDE : ROJO);
      }
    });
    y = base - 34;
  }
  function recortaTexto(t, font, size, ancho) {
    let s = limpio(t);
    if (font.widthOfTextAtSize(s, size) <= ancho) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > ancho) s = s.slice(0, -1);
    return s + '.';
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

  // ===== Reporte de Ventas: las nueve secciones =====
  if (d.ventasReporte) {
    const R = d.ventasReporte;
    const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);
    const flecha = (v) => v == null ? '—' : (v >= 0 ? '+' + Math.round(v) + '%' : Math.round(v) + '%');
    const colorPct = (v) => v == null ? SUAVE : (v >= 0 ? VERDE : ROJO);

    titulo('VENTAS DEL MES', 'Contra el mismo mes del año pasado y contra la meta');
    const f1 = ['Vendido', money(R.mes.venta), money(R.mesAnterior.venta),
                flecha(pct(R.mes.venta, R.mesAnterior.venta))];
    const f2 = ['Costo', money(R.mes.costo), money(R.mesAnterior.costo),
                flecha(pct(R.mes.costo, R.mesAnterior.costo))];
    const f3 = ['Utilidad', money(R.mes.utilidad), money(R.mesAnterior.utilidad),
                flecha(pct(R.mes.utilidad, R.mesAnterior.utilidad))];
    f3._neg = true;
    const f4 = ['Margen', (R.mes.margen != null ? R.mes.margen.toFixed(1) + '%' : '—'),
                (R.mesAnterior.margen != null ? R.mesAnterior.margen.toFixed(1) + '%' : '—'),
                (R.mes.margen != null && R.mesAnterior.margen != null
                  ? (R.mes.margen - R.mesAnterior.margen).toFixed(1) + ' pts' : '—')];
    const f5 = ['Operaciones', String(R.mes.operaciones), String(R.mesAnterior.operaciones),
                flecha(pct(R.mes.operaciones, R.mesAnterior.operaciones))];
    const f6 = ['Piezas', String(R.mes.piezas), String(R.mesAnterior.piezas),
                flecha(pct(R.mes.piezas, R.mesAnterior.piezas))];
    tabla([{ t: 'Concepto', w: ANCHO - 300 }, { t: 'Este mes', w: 100, der: true },
           { t: 'Año pasado', w: 100, der: true }, { t: 'Cambio', w: 100, der: true }],
      [f1, f2, f3, f4, f5, f6]);

    if (R.meta) {
      const fm = ['Meta del mes', money(R.meta), '',
                  (R.vsMeta != null ? R.vsMeta.toFixed(1) + '%' : '—')];
      fm._neg = true;
      fm._color = (R.vsMeta || 0) >= 100 ? VERDE : AMBAR;
      tabla([{ t: '', w: ANCHO - 300 }, { t: '', w: 100, der: true },
             { t: '', w: 100, der: true }, { t: 'Avance', w: 100, der: true }], [fm]);
    } else {
      txt('Sin meta capturada para este mes. Se toma de la pestaña "Metas" de VENTAS ' +
          '(Mes, Año, Meta).', M, y, reg, 7.5, SUAVE);
      y -= 18;
    }

    titulo('EL AÑO HASTA HOY', 'Acumulado contra el mismo periodo del año pasado');
    const a1 = ['Vendido', money(R.anio.venta), money(R.anioAnterior.venta),
                flecha(pct(R.anio.venta, R.anioAnterior.venta))];
    const a2 = ['Utilidad', money(R.anio.utilidad), money(R.anioAnterior.utilidad),
                flecha(pct(R.anio.utilidad, R.anioAnterior.utilidad))];
    a2._neg = true;
    const a3 = ['Margen', (R.anio.margen != null ? R.anio.margen.toFixed(1) + '%' : '—'),
                (R.anioAnterior.margen != null ? R.anioAnterior.margen.toFixed(1) + '%' : '—'),
                (R.anio.margen != null && R.anioAnterior.margen != null
                  ? (R.anio.margen - R.anioAnterior.margen).toFixed(1) + ' pts' : '—')];
    tabla([{ t: 'Concepto', w: ANCHO - 300 }, { t: String(d.anio || ''), w: 100, der: true },
           { t: 'Año pasado', w: 100, der: true }, { t: 'Cambio', w: 100, der: true }],
      [a1, a2, a3]);

    if ((R.porTipo || []).length) {
      titulo('POR TIPO DE MUEBLE', 'Este mes contra el mismo mes del año pasado');
      barrasComparadas(
        R.porTipo.filter(t => t.mes.venta || t.mesAnterior.venta).slice(0, 8)
          .map(t => ({ etiqueta: t.nombre, a: t.mes.venta, b: t.mesAnterior.venta })),
        corto, 'Este mes', 'Año pasado');
      tabla([{ t: 'Tipo', w: 118 }, { t: 'Vendido', w: 82, der: true },
             { t: 'Año pasado', w: 82, der: true }, { t: 'Cambio', w: 58, der: true },
             { t: 'Utilidad', w: 80, der: true }, { t: 'Margen', w: 54, der: true },
             { t: 'vs margen', w: ANCHO - 474, der: true }],
        R.porTipo.filter(t => t.mes.venta || t.mesAnterior.venta).map(t => {
          const f = [t.nombre, money(t.mes.venta), money(t.mesAnterior.venta),
                     flecha(t.cambioMes), money(t.mes.utilidad),
                     (t.mes.margen != null ? t.mes.margen.toFixed(1) + '%' : '—'),
                     (t.cambioMargen != null ? t.cambioMargen.toFixed(1) + ' pts' : '—')];
          f._color = colorPct(t.cambioMes);
          return f;
        }));

      titulo('POR TIPO DE MUEBLE, EN EL AÑO', 'Acumulado contra el año pasado');
      barrasComparadas(
        R.porTipo.filter(t => t.anio.venta || t.anioAnterior.venta)
          .sort((a, b) => b.anio.venta - a.anio.venta).slice(0, 8)
          .map(t => ({ etiqueta: t.nombre, a: t.anio.venta, b: t.anioAnterior.venta })),
        corto, String(d.anio || 'Este año'), 'Año pasado');
      tabla([{ t: 'Tipo', w: 150 }, { t: 'Este año', w: 100, der: true },
             { t: 'Año pasado', w: 100, der: true }, { t: 'Cambio', w: 70, der: true },
             { t: 'Utilidad', w: ANCHO - 420, der: true }],
        R.porTipo.filter(t => t.anio.venta || t.anioAnterior.venta)
          .sort((a, b) => b.anio.venta - a.anio.venta)
          .map(t => {
            const f = [t.nombre, money(t.anio.venta), money(t.anioAnterior.venta),
                       flecha(t.cambioAnio), money(t.anio.utilidad)];
            f._color = colorPct(t.cambioAnio);
            return f;
          }));
    }

    if ((R.marketingCanal || []).length || (R.marketingTipoCliente || []).length) {
      titulo('DE DÓNDE LLEGARON', 'Los dos cortes: canal y tipo de cliente');
      if ((R.marketingCanal || []).length) {
        tabla([{ t: 'Canal', w: 200 }, { t: 'Operaciones', w: 90, der: true },
               { t: 'Vendido', w: 110, der: true }, { t: '% del mes', w: ANCHO - 400, der: true }],
          R.marketingCanal.filter(x => x.venta).map(x => [
            x.nombre, String(x.operaciones), money(x.venta),
            (R.mes.venta ? ((x.venta / R.mes.venta) * 100).toFixed(1) + '%' : '—')]));
      }
      if ((R.marketingTipoCliente || []).length) {
        tabla([{ t: 'Tipo de cliente', w: 200 }, { t: 'Operaciones', w: 90, der: true },
               { t: 'Vendido', w: 110, der: true }, { t: '% del mes', w: ANCHO - 400, der: true }],
          R.marketingTipoCliente.filter(x => x.venta).map(x => [
            x.nombre, String(x.operaciones), money(x.venta),
            (R.mes.venta ? ((x.venta / R.mes.venta) * 100).toFixed(1) + '%' : '—')]));
      }
    }

    if (R.cotizaciones) {
      titulo('COTIZACIONES', 'Cuánto se cotizó y cuánto se cerró');
      const C = R.cotizaciones;
      const c1 = ['Cotizaciones del mes', String(C.mes.n), String(C.mesAnterior.n),
                  flecha(pct(C.mes.n, C.mesAnterior.n))];
      const c2 = ['Monto cotizado', money(C.mes.monto), money(C.mesAnterior.monto),
                  flecha(pct(C.mes.monto, C.mesAnterior.monto))];
      const c3 = ['Ventas cerradas', String(R.mes.operaciones), String(R.mesAnterior.operaciones),
                  flecha(pct(R.mes.operaciones, R.mesAnterior.operaciones))];
      const c4 = ['Conversión',
                  (C.mes.n ? ((R.mes.operaciones / C.mes.n) * 100).toFixed(1) + '%' : '—'),
                  (C.mesAnterior.n
                    ? ((R.mesAnterior.operaciones / C.mesAnterior.n) * 100).toFixed(1) + '%' : '—'),
                  ''];
      c4._neg = true;
      const c5 = ['En el año', String(C.anio.n), String(C.anioAnterior.n),
                  flecha(pct(C.anio.n, C.anioAnterior.n))];
      tabla([{ t: 'Concepto', w: ANCHO - 300 }, { t: 'Este mes', w: 100, der: true },
             { t: 'Año pasado', w: 100, der: true }, { t: 'Cambio', w: 100, der: true }],
        [c1, c2, c3, c4, c5]);
    }

    if (R.nuevos) {
      titulo('LEADS Y SHOWROOM', 'Se empezaron a capturar este año, así que todavía no hay con qué comparar');
      tabla([{ t: 'Concepto', w: ANCHO - 200 }, { t: 'Este mes', w: 100, der: true },
             { t: 'En el año', w: 100, der: true }],
        [['Leads nuevos', String(R.nuevos.leads || 0), String(R.nuevos.leadsAnio || 0)],
         ['Visitas al showroom', String(R.nuevos.visitas || 0), String(R.nuevos.visitasAnio || 0)]]);
    }
  }

  // ===== 7. Operación: lo que hizo producción este mes =====
  // Es la hoja que presenta Nico: qué se pidió, qué llegó, qué salió y qué se pagó.
  if (d.operacion) {
    const op = d.operacion;
    const hayAlgo = op.pedido.piezas || op.recibido.piezas ||
                    op.entregado.piezas || op.pagado.n;
    if (hayAlgo) {
      titulo('OPERACIÓN DEL MES', 'Lo que se pidió, lo que llegó y lo que salió');
      cajas([
        { t: 'SE PIDIÓ', v: String(Math.round(op.pedido.piezas)),
          s: 'piezas en ' + op.pedido.pedidos + ' pedidos', c: TINTA },
        { t: 'LLEGÓ', v: String(Math.round(op.recibido.piezas)), s: 'piezas recibidas',
          c: op.recibido.piezas >= op.pedido.piezas ? VERDE : AMBAR },
        { t: 'SE ENTREGÓ', v: String(Math.round(op.entregado.piezas)),
          s: 'piezas a ' + op.entregado.folios + ' clientes', c: VERDE },
        { t: 'SE PAGÓ', v: corto(op.pagado.monto), s: op.pagado.n + ' pagos', c: TINTA }
      ]);
      const filasOp = [
        ['Comprometido en pedidos nuevos', money(op.pedido.monto)],
        ['Pagado a proveedores', money(op.pagado.monto)]
      ];
      const dif = ['Diferencia entre lo pedido y lo pagado',
                   money(op.pedido.monto - op.pagado.monto)];
      dif._neg = true;
      dif._color = (op.pedido.monto - op.pagado.monto) > 0 ? AMBAR : VERDE;
      filasOp.push(dif);
      tabla([{ t: 'Concepto', w: ANCHO - 130 }, { t: 'Importe', w: 130, der: true }], filasOp);

      if ((op.porProveedor || []).length) {
        titulo('A QUIÉN SE LE PIDIÓ', 'Pedidos del mes por proveedor');
        tabla([{ t: 'Proveedor', w: 230 }, { t: 'Piezas', w: 70, der: true },
               { t: 'Llegaron', w: 70, der: true },
               { t: 'Importe', w: ANCHO - 370, der: true }],
          op.porProveedor.map(p => [p.proveedor, p.piezas, p.recibidas, money(p.monto)]));
      }
    }
  }

  // ===== 8. El año hasta hoy =====
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
