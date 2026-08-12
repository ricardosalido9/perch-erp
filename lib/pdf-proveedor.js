// Estado de cuenta de un proveedor, listo para mandárselo.
// Cuatro bloques: lo que tiene guardado, lo que falta que entregue,
// lo que ya está vendido y espera al cliente, y los saldos por pedido.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 44;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);
const AMBAR = rgb(0.55, 0.42, 0.12);
const VERDE = rgb(0.17, 0.43, 0.29);

function money(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function cortar(t, font, size, ancho) {
  const pal = String(t || '').split(/\s+/).filter(Boolean);
  const out = []; let l = '';
  pal.forEach(p => {
    const x = l ? l + ' ' + p : p;
    if (font.widthOfTextAtSize(x, size) <= ancho) l = x;
    else { if (l) out.push(l); l = p; }
  });
  if (l) out.push(l);
  return out;
}

async function estadoDeCuenta(datos, opciones) {
  const o = opciones || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const ANCHO = A4.w - M * 2;
  let page = null, y = 0, pagina = 0;

  const der = (t, x, w, yy, f, s, c) => {
    page.drawText(t, { x: x + w - f.widthOfTextAtSize(t, s), y: yy, size: s, font: f, color: c || TINTA });
  };
  const raya = (yy, x1, x2, g, c) => {
    page.drawLine({ start: { x: x1 || M, y: yy }, end: { x: x2 || (A4.w - M), y: yy },
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
    raya(y, M, A4.w - M, 0.8, TINTA);
    y -= 20;
    if (pagina === 1) {
      page.drawText('ESTADO DE CUENTA', { x: M, y, size: 13, font: neg, color: TINTA });
      der(o.fecha || '', M, ANCHO, y, reg, 9, SUAVE);
      y -= 16;
      page.drawText(datos.proveedor || '', { x: M, y, size: 11, font: neg, color: TINTA });
      y -= 26;
    } else { y -= 6; }
  }
  function espacio(alto) { if (y - alto < M + 40) nuevaPagina(); }

  function titulo(t, sub, color) {
    espacio(56);
    page.drawText(t, { x: M, y, size: 9.5, font: neg, color: color || TINTA });
    y -= 11;
    if (sub) {
      page.drawText(sub, { x: M, y, size: 7.5, font: reg, color: SUAVE });
      y -= 10;
    }
    raya(y + 3, M, A4.w - M, 0.7, color || TINTA);
    y -= 12;
  }
  // Tabla simple: columnas con ancho y alineación
  function tabla(cols, filas) {
    if (!filas.length) {
      page.drawText('Nada por aquí.', { x: M, y, size: 8, font: reg, color: SUAVE });
      y -= 18; return;
    }
    let x = M;
    cols.forEach(c => {
      if (c.der) der(c.t, x, c.w, y, neg, 7, SUAVE);
      else page.drawText(c.t, { x: x, y, size: 7, font: neg, color: SUAVE });
      x += c.w;
    });
    y -= 6; raya(y, M, A4.w - M, 0.5); y -= 11;
    filas.forEach(f => {
      espacio(24);
      x = M;
      cols.forEach((c, i) => {
        const v = String(f[i] == null ? '' : f[i]);
        const t = cortar(v, reg, 8, c.w - 6)[0] || '';
        if (c.der) der(t, x, c.w, y, f._neg ? neg : reg, 8, f._color || TINTA);
        else page.drawText(t, { x: x, y, size: 8, font: f._neg ? neg : reg, color: f._color || TINTA });
        x += c.w;
      });
      y -= 13;
    });
    y -= 8;
  }

  nuevaPagina();

  // 1) Lo que tiene guardado
  titulo('EN TU BODEGA', 'Piezas terminadas que todavía no se han recogido', VERDE);
  tabla([{ t: 'Mueble', w: 170 }, { t: 'Material', w: 100 }, { t: 'Pedido', w: 110 },
         { t: 'Piezas', w: 60, der: true }, { t: 'Desde', w: 67, der: true }],
        (datos.enBodega || []).map(r => [r.producto, r.material, r.pedido, r.piezas, r.fecha]));

  // 2) Lo que falta que fabrique
  titulo('POR FABRICAR', 'Piezas pedidas que todavía no llegan', AMBAR);
  tabla([{ t: 'Mueble', w: 170 }, { t: 'Material', w: 100 }, { t: 'Pedido', w: 110 },
         { t: 'Piezas', w: 60, der: true }, { t: 'Estimada', w: 67, der: true }],
        (datos.porFabricar || []).map(r => [r.producto, r.material, r.pedido, r.piezas, r.estimada]));

  // 3) Lo ya vendido que espera entrega
  if ((datos.vendidas || []).length) {
    titulo('YA VENDIDO — LISTO PARA ENTREGAR AL CLIENTE',
           'Estas piezas ya tienen dueño; en cuanto estén se entregan', TINTA);
    tabla([{ t: 'Mueble', w: 160 }, { t: 'Material', w: 90 }, { t: 'Pedido', w: 95 },
           { t: 'Folio', w: 85 }, { t: 'Piezas', w: 77, der: true }],
          datos.vendidas.map(r => [r.producto, r.material, r.pedido, r.folio, r.piezas]));
  }

  // 4) Saldos
  titulo('SALDOS POR PEDIDO', '', TINTA);
  const filasS = (datos.saldos || []).map(r => [r.pedido, r.fecha, money(r.costo), money(r.pagado), money(r.porPagar)]);
  tabla([{ t: 'Pedido', w: 130 }, { t: 'Fecha', w: 97 },
         { t: 'Importe', w: 90, der: true }, { t: 'Pagado', w: 90, der: true },
         { t: 'Por pagar', w: 100, der: true }], filasS);

  espacio(40);
  raya(y + 6, A4.w - M - 280, A4.w - M, 0.8, TINTA);
  page.drawText('TOTAL POR PAGAR', { x: A4.w - M - 280, y, size: 9.5, font: neg, color: TINTA });
  der(money(datos.totalPorPagar), A4.w - M - 280, 280, y, neg, 11, TINTA);
  y -= 22;

  if (o.nota) {
    cortar(o.nota, reg, 7.5, ANCHO).forEach(l => {
      page.drawText(l, { x: M, y, size: 7.5, font: reg, color: SUAVE });
      y -= 10;
    });
  }

  pdf.getPages().forEach((p, i) => {
    const t = (datos.proveedor || '') + '  ·  ' + (o.fecha || '') + '  ·  ' + (i + 1);
    p.drawText(t, { x: (A4.w - reg.widthOfTextAtSize(t, 7)) / 2, y: M - 20, size: 7, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { estadoDeCuenta };
