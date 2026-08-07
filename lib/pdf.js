// Arma el PDF de una cotización con el formato de Perch.
// Se genera en el servidor para que la foto, la tipografía y el acomodo salgan
// siempre iguales, sin depender del navegador ni del diálogo de impresión.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const LOGO = require('./logo');

const A4 = { w: 595.28, h: 841.89 };
const M = 40;                       // margen
const TINTA = rgb(0.09, 0.19, 0.17);   // #17302b
const SUAVE = rgb(0.30, 0.40, 0.38);
const LINEA = rgb(0.09, 0.19, 0.17);

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Corta el texto en renglones que quepan en el ancho dado
function cortar(texto, font, size, ancho) {
  const palabras = String(texto || '').split(/\s+/).filter(Boolean);
  const out = [];
  let linea = '';
  palabras.forEach(p => {
    const prueba = linea ? linea + ' ' + p : p;
    if (font.widthOfTextAtSize(prueba, size) <= ancho) { linea = prueba; }
    else { if (linea) out.push(linea); linea = p; }
  });
  if (linea) out.push(linea);
  return out;
}
// Texto con espaciado entre letras (para el wordmark)
function tracking(page, texto, x, y, font, size, sp, color) {
  let cx = x;
  for (const ch of texto) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + sp;
  }
  return cx - x - sp;
}

async function bajarImagen(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') || '').toLowerCase();
    if (tipo.includes('webp') || tipo.includes('svg')) return null;   // pdf-lib no los soporta
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return { buf, png: tipo.includes('png') || buf.slice(0, 4).toString('hex') === '89504e47' };
  } catch (e) { return null; }
}

/**
 * cot = { folio, cliente, despacho, fecha, mesAnio, items[], envio, total, anticipo, finiquito }
 * item = { producto, desc, medidas, especificaciones, foto, cantidad, precio, total }
 */
async function generarCotizacion(cot, opciones) {
  const o = opciones || {};
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Se descargan las fotos una sola vez
  const imgs = {};
  for (const it of cot.items) {
    if (!it.foto || imgs[it.foto] !== undefined) continue;
    const d = await bajarImagen(it.foto);
    let emb = null;
    if (d) { try { emb = d.png ? await pdf.embedPng(d.buf) : await pdf.embedJpg(d.buf); } catch (e) { emb = null; } }
    imgs[it.foto] = emb;
  }

  const COL_FOTO = 120, COL_PRE = 85, COL_CANT = 55, COL_TOT = 85;
  const anchoUtil = A4.w - M * 2;
  const COL_DESC = anchoUtil - COL_FOTO - COL_PRE - COL_CANT - COL_TOT;

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  // El logo real de Perch (assets/Logo_Perch.png, incrustado en lib/logo.js)
  let logo = null;
  try { logo = await pdf.embedPng(Buffer.from(LOGO.base64, 'base64')); } catch (e) { logo = null; }

  function encabezado() {
    if (logo) {
      const anchoLogo = 110;
      const altoLogo = anchoLogo * (LOGO.alto / LOGO.ancho);
      page.drawImage(logo, { x: M, y: y - altoLogo, width: anchoLogo, height: altoLogo });
    } else {
      tracking(page, 'PERCH', M, y - 24, neg, 22, 6, TINTA);   // respaldo si el logo no carga
    }
    const web = 'WWW.PERCH.MX';
    page.drawText(web, { x: A4.w - M - reg.widthOfTextAtSize(web, 9), y: y - 18, size: 9, font: reg, color: TINTA });
    y -= 58;
    page.drawText('CLIENTE: ' + (cot.cliente || ''), { x: M, y: y, size: 10, font: reg, color: TINTA });
    if (cot.despacho) {
      page.drawText('DESPACHO: ' + cot.despacho, { x: M, y: y - 14, size: 10, font: reg, color: TINTA });
    }
    page.drawText('FOLIO: ' + (cot.folio || ''), { x: M, y: y - 28, size: 10, font: reg, color: TINTA });
    const der1 = 'CIUDAD DE MEXICO', der2 = cot.mesAnio || '';
    page.drawText(der1, { x: A4.w - M - reg.widthOfTextAtSize(der1, 10), y: y, size: 10, font: reg, color: TINTA });
    page.drawText(der2, { x: A4.w - M - reg.widthOfTextAtSize(der2, 10), y: y - 14, size: 10, font: reg, color: TINTA });
    y -= 52;
  }
  function tituloTabla() {
    const xs = [M + COL_FOTO + COL_DESC, M + COL_FOTO + COL_DESC + COL_PRE, M + COL_FOTO + COL_DESC + COL_PRE + COL_CANT];
    const tits = ['Precio con IVA', 'Cantidad', 'Total'];
    const anchos = [COL_PRE, COL_CANT, COL_TOT];
    const alto = 22;
    tits.forEach((t, i) => {
      page.drawRectangle({ x: xs[i], y: y - alto, width: anchos[i], height: alto, borderColor: LINEA, borderWidth: 0.7 });
      const w = neg.widthOfTextAtSize(t, 8);
      page.drawText(t, { x: xs[i] + (anchos[i] - w) / 2, y: y - 15, size: 8, font: neg, color: TINTA });
    });
    y -= alto;
  }

  encabezado();
  tituloTabla();

  for (const it of cot.items) {
    const alto = 122;
    if (y - alto < M + 150) {                 // no cabe: página nueva
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
      tituloTabla();
    }
    const top = y, bot = y - alto;

    // Foto: se ajusta al recuadro SIN deformarla (respeta la proporción original)
    const emb = it.foto ? imgs[it.foto] : null;
    if (emb) {
      const caja = alto - 2;
      const escala = Math.min(caja / emb.width, caja / emb.height);
      const w = emb.width * escala, hh = emb.height * escala;
      page.drawImage(emb, { x: M + (COL_FOTO - w) / 2, y: bot + (alto - hh) / 2, width: w, height: hh });
    }

    // Descripción centrada
    const xDesc = M + COL_FOTO;
    page.drawRectangle({ x: xDesc, y: bot, width: COL_DESC, height: alto, borderColor: LINEA, borderWidth: 0.7 });
    const lineas = [];
    lineas.push({ t: String(it.producto || '').toUpperCase(), f: neg, s: 9 });
    cortar(it.desc, reg, 8, COL_DESC - 20).forEach(l => lineas.push({ t: l, f: reg, s: 8 }));
    if (it.medidas) cortar(it.medidas, reg, 8, COL_DESC - 20).forEach(l => lineas.push({ t: l, f: reg, s: 8 }));
    if (it.especificaciones) cortar(it.especificaciones, reg, 8, COL_DESC - 20).forEach(l => lineas.push({ t: l, f: reg, s: 8 }));
    // Descuento aplicado a esta pieza
    if (it.descPct) lineas.push({ t: 'Descuento ' + it.descPct + '%', f: neg, s: 8 });
    else if (it.descMonto) lineas.push({ t: 'Descuento ' + money(it.descMonto), f: neg, s: 8 });
    const altoTexto = lineas.length * 11;
    let ty = top - (alto - altoTexto) / 2 - 9;
    lineas.forEach(l => {
      const w = l.f.widthOfTextAtSize(l.t, l.s);
      page.drawText(l.t, { x: xDesc + (COL_DESC - w) / 2, y: ty, size: l.s, font: l.f, color: TINTA });
      ty -= 11;
    });

    // Precio / cantidad / total
    const celdas = [
      { x: xDesc + COL_DESC, w: COL_PRE, t: money(it.precio) },
      { x: xDesc + COL_DESC + COL_PRE, w: COL_CANT, t: String(it.cantidad) },
      { x: xDesc + COL_DESC + COL_PRE + COL_CANT, w: COL_TOT, t: money(it.total) }
    ];
    celdas.forEach(c => {
      page.drawRectangle({ x: c.x, y: bot, width: c.w, height: alto, borderColor: LINEA, borderWidth: 0.7 });
      const w = reg.widthOfTextAtSize(c.t, 9);
      page.drawText(c.t, { x: c.x + (c.w - w) / 2, y: bot + alto / 2 - 3, size: 9, font: reg, color: TINTA });
    });
    y = bot;
  }

  // Totales
  const filas = [];
  if (cot.envio) filas.push(['Envio', money(cot.envio)]);
  filas.push(['TOTAL', money(cot.total)]);
  filas.push(['Anticipo (60%)', money(cot.anticipo)]);
  filas.push(['Finiquito (40%)', money(cot.finiquito)]);
  const anchoTot = COL_PRE + COL_CANT + COL_TOT;
  const xTot = A4.w - M - anchoTot;
  filas.forEach(f => {
    const h = 20;
    page.drawRectangle({ x: xTot, y: y - h, width: anchoTot * 0.55, height: h, borderColor: LINEA, borderWidth: 0.7 });
    page.drawRectangle({ x: xTot + anchoTot * 0.55, y: y - h, width: anchoTot * 0.45, height: h, borderColor: LINEA, borderWidth: 0.7 });
    page.drawText(f[0], { x: xTot + 6, y: y - 14, size: 8.5, font: reg, color: TINTA });
    const w = reg.widthOfTextAtSize(f[1], 8.5);
    page.drawText(f[1], { x: xTot + anchoTot - 6 - w, y: y - 14, size: 8.5, font: reg, color: TINTA });
    y -= h;
  });

  // Condiciones y datos bancarios
  y -= 26;
  const cond = o.condiciones || [];
  cond.forEach(c => {
    cortar('- ' + c, reg, 7.5, anchoUtil).forEach(l => {
      page.drawText(l, { x: M, y: y, size: 7.5, font: reg, color: SUAVE });
      y -= 10;
    });
  });
  if (o.banco) {
    y -= 8;
    page.drawText('Datos bancarios', { x: M, y: y, size: 8, font: neg, color: TINTA }); y -= 11;
    page.drawText(o.banco.titular + ' - ' + o.banco.banco, { x: M, y: y, size: 7.5, font: reg, color: SUAVE }); y -= 10;
    page.drawText('CLABE ' + o.banco.clabe, { x: M, y: y, size: 7.5, font: reg, color: SUAVE });
  }

  return Buffer.from(await pdf.save());
}

module.exports = { generarCotizacion };
