// PDF de cotización con el formato nuevo de Perch.
// Sin cuadrícula: solo líneas horizontales finas. Ficha del producto a la izquierda,
// foto en el centro y las cifras a la derecha.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
const TINTA = rgb(0.09, 0.19, 0.17);
const SUAVE = rgb(0.45, 0.50, 0.49);
const LINEA = rgb(0.80, 0.79, 0.76);

// La fuente estándar del PDF solo entiende Latin-1. Los caracteres invisibles que se
// cuelan al copiar y pegar tumban la generación, así que se limpian antes de escribir.
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
function cortar(texto, font, size, ancho) {
  const palabras = limpio(texto).split(/\s+/).filter(Boolean);
  const out = [];
  let linea = '';
  palabras.forEach(p => {
    const prueba = linea ? linea + ' ' + p : p;
    if (font.widthOfTextAtSize(prueba, size) <= ancho) linea = prueba;
    else { if (linea) out.push(linea); linea = p; }
  });
  if (linea) out.push(linea);
  return out;
}
async function bajarImagen(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') || '').toLowerCase();
    if (tipo.includes('webp') || tipo.includes('svg')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return { buf, png: tipo.includes('png') || buf.slice(0, 4).toString('hex') === '89504e47' };
  } catch (e) { return null; }
}

async function generarCotizacion(cot, opciones) {
  const o = opciones || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  const imgs = {};
  for (const it of cot.items) {
    if (!it.foto || imgs[it.foto] !== undefined) continue;
    const d = await bajarImagen(it.foto);
    let emb = null;
    if (d) { try { emb = d.png ? await pdf.embedPng(d.buf) : await pdf.embedJpg(d.buf); } catch (e) { emb = null; } }
    imgs[it.foto] = emb;
  }

  const pctDesc = (cot.items.filter(i => i.descPct)[0] || {}).descPct || 0;
  const conDesc = cot.items.some(i => i.descPct || i.descMonto);

  const ANCHO = A4.w - M * 2;
  const COL_TOT = 62, COL_CANT = 54, COL_DESC = conDesc ? 78 : 0, COL_PRE = 78;
  const xTot  = A4.w - M - COL_TOT;
  const xCant = xTot - COL_CANT;
  const xDesc = xCant - COL_DESC;
  const xPre  = xDesc - COL_PRE;
  const FOTO = 108;
  const xFoto = M + 138;

  let page = null, y = 0, pagina = 0;

  const derecha = (t0, xIzq, ancho, yy, font, size, color) => {
    const t = limpio(t0);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(limpio(t), { x: xIzq + ancho - w, y: yy, size, font, color: color || TINTA });
  };
  const raya = (yy, x1, x2, grosor, color) => {
    page.drawLine({ start: { x: x1 || M, y: yy }, end: { x: x2 || (A4.w - M), y: yy },
                    thickness: grosor || 0.6, color: color || LINEA });
  };

  function encabezadoTabla() {
    derecha('Precio con IVA', xPre, COL_PRE, y, neg, 7.5);
    if (conDesc) derecha('Descuento' + (pctDesc ? ' ' + pctDesc + '%' : ''), xDesc, COL_DESC, y, neg, 7.5);
    derecha('Cantidad', xCant, COL_CANT, y, neg, 7.5);
    derecha('Total', xTot, COL_TOT, y, neg, 7.5);
    y -= 8;
    raya(y, xPre, A4.w - M, 0.8, TINTA);
    y -= 16;
  }

  function nuevaPagina() {
    page = pdf.addPage([A4.w, A4.h]);
    pagina++;
    y = A4.h - M;
    if (logo) {
      const w = 96, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    const web = 'WWW.PERCH.MX';
    page.drawText(limpio(web), { x: A4.w - M - neg.widthOfTextAtSize(web, 8), y: y - 22, size: 8, font: neg, color: TINTA });
    y -= 56;
    raya(y, M, A4.w - M, 0.8);
    y -= 22;
    if (pagina === 1) {
      page.drawText(limpio('CLIENTE: ' + (cot.cliente || '')), { x: M, y, size: 9.5, font: reg, color: TINTA });
      if (cot.despacho) {
        page.drawText(limpio('DESPACHO: ' + cot.despacho), { x: M, y: y - 14, size: 9.5, font: reg, color: TINTA });
      }
      derecha(o.ciudad || 'CIUDAD DE MEXICO', M, ANCHO, y, reg, 9.5);
      derecha(cot.mesAnio || '', M, ANCHO, y - 14, reg, 9.5);
      derecha('COTIZACION ' + (cot.folio || ''), M, ANCHO, y - 28, reg, 8, SUAVE);
      y -= 56;
    } else {
      y -= 10;
    }
    encabezadoTabla();
  }

  nuevaPagina();

  cot.items.forEach((it, idx) => {
    const emb = it.foto ? imgs[it.foto] : null;
    const anchoTxt = 118;
    const lineas = [];
    // La categoría (Decorativo, Sillones…) no se muestra: confunde más de lo que ayuda
    cortar(String(it.producto || '').toUpperCase(), neg, 9.5, anchoTxt)
      .forEach(l => lineas.push({ t: l, f: neg, s: 9.5, c: TINTA }));
    if (it.desc) cortar(it.desc, reg, 7, anchoTxt).forEach(l => lineas.push({ t: l, f: reg, s: 7, c: SUAVE }));
    if (it.medidas) cortar(it.medidas, reg, 7, anchoTxt).forEach(l => lineas.push({ t: l, f: reg, s: 7, c: SUAVE }));
    if (it.especificaciones) cortar(it.especificaciones, reg, 7, anchoTxt)
      .forEach(l => lineas.push({ t: l, f: reg, s: 7, c: SUAVE }));

    const altoTxt = lineas.reduce((a, l) => a + l.s + 3.5, 0);
    const alto = Math.max(FOTO + 30, altoTxt + 30);
    if (y - alto < M + 140) nuevaPagina();

    const top = y, bot = y - alto, medio = (top + bot) / 2;

    let ty = medio + altoTxt / 2 - lineas[0].s;
    lineas.forEach(l => {
      const w = l.f.widthOfTextAtSize(l.t, l.s);
      page.drawText(limpio(l.t), { x: M + (anchoTxt - w) / 2, y: ty, size: l.s, font: l.f, color: l.c });
      ty -= l.s + 3.5;
    });

    if (emb) {
      const esc = Math.min(FOTO / emb.width, FOTO / emb.height);
      const w = emb.width * esc, h = emb.height * esc;
      page.drawImage(emb, { x: xFoto + (FOTO - w) / 2, y: medio - h / 2, width: w, height: h });
    }

    const yc = medio - 3;
    derecha(money(it.precio), xPre, COL_PRE, yc, reg, 9);
    if (conDesc) {
      const conDto = it.descPct ? it.precio * (1 - it.descPct / 100)
                                : (it.descMonto ? it.precio - (it.descMonto / (it.cantidad || 1)) : it.precio);
      derecha(money(conDto), xDesc, COL_DESC, yc, reg, 9);
    }
    derecha(String(it.cantidad), xCant, COL_CANT, yc, reg, 9);
    derecha(money(it.total), xTot, COL_TOT, yc, reg, 9);

    y = bot;
    if (idx < cot.items.length - 1) raya(y + 8, M, A4.w - M, 0.5);
  });

  y -= 30;
  if (y < M + 140) nuevaPagina();
  const anchoTot = COL_PRE + COL_DESC + COL_CANT + COL_TOT;
  const xT = A4.w - M - anchoTot;
  const filas = [];
  if (cot.envio) filas.push(['Envio', money(cot.envio), false]);
  filas.push(['TOTAL', money(cot.total), true]);
  filas.push(['Anticipo 60%', money(cot.anticipo), true]);
  filas.push(['Finiquito 40%', money(cot.finiquito), true]);
  raya(y + 14, xT, A4.w - M, 0.8, TINTA);
  const yTotales = y;
  filas.forEach(f => {
    page.drawText(limpio(f[0]), { x: xT, y, size: 8.5, font: f[2] ? neg : reg, color: TINTA });
    derecha(f[1], xT, anchoTot, y, f[2] ? neg : reg, 8.5);
    y -= 11;
    raya(y + 5, xT, A4.w - M, 0.5);
    y -= 11;
  });

  const cond = o.condiciones || [];
  if (cond.length) {
    let yc2 = yTotales;
    page.drawText(limpio('CONDICIONES ESPECIALES'), { x: M, y: yc2, size: 8, font: neg, color: TINTA });
    yc2 -= 14;
    cond.forEach(c => {
      cortar(c, reg, 7.5, ANCHO * 0.52).forEach(l => {
        page.drawText(limpio(l), { x: M, y: yc2, size: 7.5, font: reg, color: SUAVE });
        yc2 -= 10;
      });
    });
    if (o.banco) {
      yc2 -= 8;
      page.drawText(limpio(o.banco.titular + ' · ' + o.banco.banco), { x: M, y: yc2, size: 7, font: reg, color: SUAVE });
      yc2 -= 9;
      page.drawText(limpio('CLABE ' + o.banco.clabe), { x: M, y: yc2, size: 7, font: reg, color: SUAVE });
    }
  }

  // ===== Hoja de condiciones generales =====
  if (o.terminos && o.terminos.length) {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    if (logo) {
      const w = 74, h = w * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - h, width: w, height: h });
    }
    const web2 = 'WWW.PERCH.MX';
    page.drawText(limpio(web2), { x: A4.w - M - neg.widthOfTextAtSize(web2, 7.5), y: y - 18, size: 7.5, font: neg, color: TINTA });
    y -= 44;
    const tit = 'CONDICIONES GENERALES DE VENTA' + (cot.folio ? '  ' + cot.folio : '');
    page.drawText(limpio(tit), { x: M, y, size: 9, font: neg, color: TINTA });
    y -= 8;
    raya(y, M, A4.w - M, 0.8, TINTA);
    y -= 16;

    // Dos columnas para que quepa todo en una hoja
    const COLW = (ANCHO - 26) / 2;
    const PISO = M + 96;                 // debajo van los datos bancarios
    let colX = M, colTope = y, segunda = false;
    const salto = () => {
      if (!segunda) { segunda = true; colX = M + COLW + 26; y = colTope; }
      else { page = pdf.addPage([A4.w, A4.h]); y = A4.h - M; colTope = y; colX = M; segunda = false; }
    };
    o.terminos.forEach(bloque => {
      const alto = 12 + bloque.puntos.reduce((a, p2) =>
        a + cortar('- ' + p2, reg, 6.9, COLW).length * 8.6, 0) + 9;
      if (y - alto < PISO) salto();
      page.drawText(limpio(bloque.titulo), { x: colX, y, size: 7.8, font: neg, color: TINTA });
      y -= 12;
      bloque.puntos.forEach(p2 => {
        cortar('- ' + p2, reg, 6.9, COLW).forEach((l, i2) => {
          page.drawText(limpio(l), { x: colX + (i2 ? 6 : 0), y, size: 6.9, font: reg, color: SUAVE });
          y -= 8.6;
        });
      });
      y -= 9;
    });

    // Datos bancarios y facturación, al pie de la hoja
    let yb = M + 74;
    raya(yb + 14, M, A4.w - M, 0.8, TINTA);
    if (o.banco) {
      page.drawText(limpio('DATOS BANCARIOS · ' + o.banco.banco), { x: M, y: yb, size: 7.6, font: neg, color: TINTA });
      yb -= 10;
      page.drawText(limpio(o.banco.titular), { x: M, y: yb, size: 6.8, font: reg, color: SUAVE }); yb -= 9;
      if (o.banco.cuenta) { page.drawText(limpio('CUENTA  ' + o.banco.cuenta), { x: M, y: yb, size: 6.8, font: reg, color: SUAVE }); yb -= 9; }
      page.drawText(limpio('CLABE  ' + o.banco.clabe), { x: M, y: yb, size: 6.8, font: reg, color: SUAVE }); yb -= 9;
      if (o.banco.swift) { page.drawText(limpio('SWIFT  ' + o.banco.swift), { x: M, y: yb, size: 6.8, font: reg, color: SUAVE }); yb -= 9; }
      page.drawText('Usar el nombre del cliente o despacho como concepto del pago.',
        { x: M, y: yb, size: 6.4, font: reg, color: SUAVE });
    }
    if (o.facturacion) {
      let yf = M + 74;
      const xf = M + ANCHO / 2 + 10;
      page.drawText(limpio('FACTURA TU PEDIDO'), { x: xf, y: yf, size: 7.6, font: neg, color: TINTA }); yf -= 10;
      o.facturacion.forEach(l => {
        cortar(l, reg, 6.8, ANCHO / 2 - 10).forEach(x2 => {
          page.drawText(limpio(x2), { x: xf, y: yf, size: 6.8, font: reg, color: SUAVE }); yf -= 9;
        });
      });
    }
    page.drawText('Al comprar un mueble PERCH se asume la aceptación de todos los Términos y Condiciones.',
      { x: M, y: M - 4, size: 6.2, font: reg, color: SUAVE });
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const t = (cot.folio || '') + '  ·  ' + (i + 1);
    const w = reg.widthOfTextAtSize(t, 7);
    p.drawText(limpio(t), { x: (A4.w - w) / 2, y: M - 18, size: 7, font: reg, color: SUAVE });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { generarCotizacion };
