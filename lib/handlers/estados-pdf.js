// Los estados financieros en un solo PDF: portada, estado de resultados, flujo de
// efectivo y balance, uno tras otro.
//
// Hasta ahora cada estado salía en su propio archivo y alguien los juntaba a mano
// para mandarlos. Aquí se arma el documento completo de una vez, con el mismo
// cálculo que la pantalla, así que no puede discrepar de lo que ve quien lo revisa.
//
//   ?action=estados-pdf  { anio, desde, hasta }
const core = require('../core');
const CFG = require('../config');
const armar = require('./estados');
const { reporteEstado } = require('../pdf-estado');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const path = require('path');
const fs = require('fs');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// Un estado, pedido al mismo motor que dibuja la pantalla
async function traer(token, cual, anio, desde, hasta) {
  let datos = null, error = null;
  const captura = { status: (c) => ({ json: (o) => {
    if (c === 200 && o && o.ok) datos = o; else error = o; return o;
  } }) };
  await armar({ _body: { token, estado: cual, anio, desde, hasta } }, captura);
  return { datos, error };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const anio = +body.anio || new Date().getFullYear();
    const desde = Math.min(12, Math.max(1, +body.desde || 1));
    // Sin rango, hasta el mes en curso: los meses que no han pasado entran en cero
    const hasta = Math.min(12, Math.max(desde, +body.hasta ||
      (anio < new Date().getFullYear() ? 12 : new Date().getMonth() + 1)));

    const cuales = ['resultados', 'flujo', 'balance'];
    const partes = [];
    const noSalieron = [];
    for (const cual of cuales) {
      const { datos, error } = await traer(body.token, cual, anio, desde, hasta);
      if (datos) partes.push({ cual, datos });
      // Que falte el balance no es un error: todavía no está armado
      else noSalieron.push({ cual, porQue: (error && error.error) || 'no se pudo armar' });
    }
    if (!partes.length) {
      return res.status(400).json({
        error: 'No se pudo armar ningún estado.',
        pista: noSalieron.map(x => x.cual + ': ' + x.porQue).join(' · ')
      });
    }

    // ---- el documento ----
    const salida = await PDFDocument.create();
    const reg = await salida.embedFont(StandardFonts.Helvetica);
    const neg = await salida.embedFont(StandardFonts.HelveticaBold);
    const TINTA = rgb(0.09, 0.19, 0.17);
    const PAPEL = rgb(0.97, 0.965, 0.95);

    // Portada
    const p0 = salida.addPage([595.28, 841.89]);
    p0.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: PAPEL });
    try {
      const f = path.join(__dirname, '..', '..', 'assets', 'Perch_Logo.png');
      if (fs.existsSync(f)) {
        const img = await salida.embedPng(fs.readFileSync(f));
        const w = 150, h = w * (img.height / img.width);
        p0.drawImage(img, { x: 60, y: 841.89 - 90 - h, width: w, height: h });
      } else {
        p0.drawText((CFG.EMPRESA && CFG.EMPRESA.nombre) || 'Estados financieros',
          { x: 60, y: 841.89 - 100, size: 22, font: neg, color: TINTA });
      }
    } catch (e) { /* sin logo, la portada sale igual */ }

    const periodo = (desde === hasta ? MESES[desde - 1]
                     : MESES[desde - 1] + ' a ' + MESES[hasta - 1]) + ' de ' + anio;
    p0.drawText('Estados Financieros ' + anio,
      { x: 60, y: 500, size: 30, font: neg, color: TINTA });
    p0.drawText(cap(periodo), { x: 60, y: 470, size: 13, font: reg, color: TINTA });
    p0.drawText(partes.map(p => cap(p.datos.titulo)).join('  ·  '),
      { x: 60, y: 440, size: 10, font: reg, color: rgb(0.45, 0.45, 0.43) });
    const hoy = new Date();
    p0.drawText('Generado el ' + hoy.getDate() + ' de ' + MESES[hoy.getMonth()] +
      ' de ' + hoy.getFullYear(),
      { x: 60, y: 90, size: 9, font: reg, color: rgb(0.45, 0.45, 0.43) });

    // Cada estado, pegado tras la portada
    for (const p of partes) {
      const buf = await reporteEstado(p.datos, {
        titulo: p.datos.titulo,
        empresa: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
        periodo: cap(periodo),
        vacios: !!body.vacios
      });
      const doc = await PDFDocument.load(buf);
      const paginas = await salida.copyPages(doc, doc.getPageIndices());
      paginas.forEach(pg => salida.addPage(pg));
    }

    const bytes = await salida.save();
    return res.status(200).json({
      ok: true,
      pdf: Buffer.from(bytes).toString('base64'),
      nombre: 'Estados Financieros ' + anio + ' - ' +
              ((CFG.EMPRESA && CFG.EMPRESA.nombre) || 'Perch') + '.pdf',
      estados: partes.map(p => p.datos.titulo),
      // Lo que no entró y por qué: el balance suele faltar y conviene saberlo
      faltaron: noSalieron,
      paginas: salida.getPageCount()
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
