// El paquete del cierre: los seis reportes del mes en UN solo PDF, en orden.
//
// Antes había que entrar a cinco pantallas distintas, bajar cinco archivos y
// juntarlos a mano. Un cierre no debería ser un trabajo de archivo.
//
// Va todo en un documento y no en seis descargas a propósito: es un archivo que
// se manda completo, y el orden importa —primero el resultado, luego de dónde
// salió—. Seis archivos sueltos se mandan incompletos tarde o temprano.
//
//   ?action=cierre-paquete  { mes, anio }
const core = require('../core');
const CFG = require('../config');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { reporteSecciones, dinero } = require('../pdf-secciones');
const path = require('path');
const fs = require('fs');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// Se le pide a un handler su PDF, atrapando su respuesta
async function pedirPdf(handler, cuerpo) {
  let out = null, err = null;
  const captura = { status: (c) => ({ json: (o) => {
    if (c === 200 && o && (o.pdf || o.ok)) out = o; else err = o; return o;
  } }) };
  try { await handler({ _body: cuerpo }, captura); }
  catch (e) { err = { error: (e && e.message) || String(e) }; }
  return { out, err };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const hoy = new Date();
    // Por omisión el mes pasado: un cierre se hace cuando el mes ya terminó
    const mes = +body.mes || (hoy.getMonth() === 0 ? 12 : hoy.getMonth());
    const anio = +body.anio || (hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear());
    const tok = body.token;

    const piezas = [];
    const faltaron = [];

    // 1. Los estados financieros
    {
      const { out, err } = await pedirPdf(require('./estados-pdf'),
        { token: tok, anio, desde: 1, hasta: mes });
      if (out && out.pdf) piezas.push({ nombre: 'Estados financieros', pdf: out.pdf });
      else faltaron.push({ pieza: 'Estados financieros', porQue: (err && err.error) || 'no salió' });
    }
    // 2. El cierre de ventas del mes
    {
      const { out, err } = await pedirPdf(require('./cierre'), { token: tok, mes, anio });
      if (out && out.pdf) piezas.push({ nombre: 'Ventas del mes', pdf: out.pdf });
      else faltaron.push({ pieza: 'Ventas del mes', porQue: (err && err.error) || 'no salió' });
    }
    // 3. Los costos
    {
      const { out, err } = await pedirPdf(require('./costos-pdf'), { token: tok, mes, anio });
      if (out && out.pdf) piezas.push({ nombre: 'Costos', pdf: out.pdf });
      else faltaron.push({ pieza: 'Costos', porQue: (err && err.error) || 'no salió' });
    }
    // 4. La nómina
    {
      const { out, err } = await pedirPdf(require('./nomina-pdf'), { token: tok, mes, anio });
      if (out && out.pdf) piezas.push({ nombre: 'Nómina', pdf: out.pdf });
      else faltaron.push({ pieza: 'Nómina', porQue: (err && err.error) || 'no salió' });
    }
    // 5. Los CFDIs
    {
      const { out, err } = await pedirPdf(require('./cfdi-reporte'), { token: tok, mes, anio });
      if (out && out.pdf) piezas.push({ nombre: 'CFDIs', pdf: out.pdf });
      else faltaron.push({ pieza: 'CFDIs', porQue: (err && err.error) || 'no salió' });
    }
    // 6. Ingresos y egresos
    {
      const { out, err } = await pedirPdf(require('./ingresos-egresos-pdf'),
        { token: tok, mes, anio });
      if (out && out.pdf) piezas.push({ nombre: 'Ingresos y egresos', pdf: out.pdf });
      else faltaron.push({ pieza: 'Ingresos y egresos', porQue: (err && err.error) || 'no salió' });
    }

    if (!piezas.length) {
      return res.status(400).json({
        error: 'No salió ninguna pieza del cierre.',
        pista: faltaron.map(f => f.pieza + ': ' + f.porQue).join(' · ')
      });
    }

    // ---- se arma el documento ----
    const salida = await PDFDocument.create();
    const reg = await salida.embedFont(StandardFonts.Helvetica);
    const neg = await salida.embedFont(StandardFonts.HelveticaBold);
    const TINTA = rgb(0.09, 0.19, 0.17);
    const PAPEL = rgb(0.97, 0.965, 0.95);

    const p0 = salida.addPage([595.28, 841.89]);
    p0.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: PAPEL });
    try {
      const f = path.join(__dirname, '..', '..', 'assets', 'Perch_Logo.png');
      if (fs.existsSync(f)) {
        const img = await salida.embedPng(fs.readFileSync(f));
        const w = 150, h = w * (img.height / img.width);
        p0.drawImage(img, { x: 60, y: 841.89 - 90 - h, width: w, height: h });
      }
    } catch (e) { /* sin logo sale igual */ }
    p0.drawText('Cierre de ' + cap(MESES[mes - 1]), { x: 60, y: 520, size: 30, font: neg, color: TINTA });
    p0.drawText(cap(MESES[mes - 1]) + ' de ' + anio, { x: 60, y: 490, size: 13, font: reg, color: TINTA });
    let yy = 430;
    p0.drawText('Lo que trae este documento', { x: 60, y: yy, size: 9, font: neg, color: TINTA });
    yy -= 18;
    piezas.forEach((p, i) => {
      p0.drawText((i + 1) + '.  ' + p.nombre, { x: 60, y: yy, size: 10, font: reg, color: TINTA });
      yy -= 16;
    });
    if (faltaron.length) {
      yy -= 10;
      p0.drawText('No entraron:', { x: 60, y: yy, size: 9, font: neg,
                                    color: rgb(0.62, 0.20, 0.15) });
      yy -= 14;
      faltaron.forEach(f => {
        p0.drawText('·  ' + f.pieza + ' — ' + String(f.porQue).slice(0, 70),
          { x: 60, y: yy, size: 8, font: reg, color: rgb(0.45, 0.45, 0.43) });
        yy -= 12;
      });
    }
    p0.drawText('Generado el ' + hoy.getDate() + ' de ' + MESES[hoy.getMonth()] + ' de ' +
      hoy.getFullYear(), { x: 60, y: 90, size: 9, font: reg, color: rgb(0.45, 0.45, 0.43) });

    for (const p of piezas) {
      try {
        const doc = await PDFDocument.load(Buffer.from(p.pdf, 'base64'));
        const pgs = await salida.copyPages(doc, doc.getPageIndices());
        pgs.forEach(pg => salida.addPage(pg));
      } catch (e) {
        faltaron.push({ pieza: p.nombre, porQue: 'no se pudo pegar al documento' });
      }
    }

    const bytes = await salida.save();
    return res.status(200).json({
      ok: true,
      pdf: Buffer.from(bytes).toString('base64'),
      nombre: 'Cierre ' + cap(MESES[mes - 1]) + ' ' + anio + ' - ' +
              ((CFG.EMPRESA && CFG.EMPRESA.nombre) || 'Perch') + '.pdf',
      piezas: piezas.map(p => p.nombre),
      faltaron,
      paginas: salida.getPageCount()
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
