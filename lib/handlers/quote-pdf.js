// Genera el PDF de una cotización/venta y lo guarda en Drive, en la carpeta que toca:
//   cotización -> Carpeta madre / Cotizaciones / "COT-E1-26 Cliente.pdf"
//   venta      -> Carpeta madre / Ventas / "E1-26 Cliente" / "E1-26 Cliente.pdf"
const core = require('../core');
const drive = require('../drive');
const { generarCotizacion } = require('../pdf');
const { armar } = require('./quote');

const CONDICIONES = [
  'Precios en pesos mexicanos con IVA incluido.',
  'Tiempo de entrega: 6 semanas a partir del anticipo y de la confirmacion de materiales.',
  'Garantia de 12 meses por defectos de fabricacion.',
  'Nuestros muebles son ensamblados a mano, por lo que pueden variar ligeramente en acabados y tonalidades.'
];
const BANCO = { titular: 'Perch Diseno y Mobiliario', banco: 'BBVA', clabe: '012180001174417892' };
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mesAnio(fecha) {
  const s = String(fecha || '').toLowerCase();
  for (let i = 0; i < MESES.length; i++) {
    if (s.indexOf(MESES[i].toLowerCase()) !== -1) {
      const a = s.match(/(20\d{2})/);
      return MESES[i] + (a ? ' ' + a[1] : '');
    }
  }
  const m = s.match(/(\d{4})-(\d{2})-/);
  if (m) return MESES[parseInt(m[2], 10) - 1] + ' ' + m[1];
  return '';
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const key = body.key || 'cotizaciones';
    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
    const esVenta = (body.venta === true) || key === 'ventas_registro';

    const cot = await armar(key, folio);
    if (cot.error) return res.status(400).json({ error: cot.error });
    cot.mesAnio = mesAnio(cot.fecha);

    let pdfBuf;
    try {
      pdfBuf = await generarCotizacion(cot, { condiciones: CONDICIONES, banco: BANCO });
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo armar el PDF: ' + ((e && e.message) || e) });
    }

    const nombre = drive.limpia(folio + ' ' + (cot.cliente || '')) + '.pdf';

    // Si solo se quiere el archivo (sin Drive), se devuelve en base64
    if (body.soloArchivo) {
      return res.status(200).json({ ok: true, nombre: nombre, pdf: pdfBuf.toString('base64') });
    }

    try {
      const dest = await drive.carpetaDestino(esVenta, folio, cot.cliente);
      const archivo = await drive.subir(dest.drive, dest.carpeta.id, nombre, 'application/pdf', pdfBuf);
      return res.status(200).json({
        ok: true,
        nombre: nombre,
        archivo: archivo.webViewLink || '',
        carpeta: dest.carpeta.webViewLink || ('https://drive.google.com/drive/folders/' + dest.carpeta.id),
        carpetaId: dest.carpeta.id,
        destino: esVenta ? 'Ventas' : 'Cotizaciones'
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const exp = drive.explicar(msg);
      // El PDF sí se hizo: se devuelve igual para que el usuario lo pueda bajar
      return res.status(200).json({
        ok: true, sinDrive: true, nombre: nombre, pdf: pdfBuf.toString('base64'),
        causa: exp.causa, arreglo: exp.arreglo, detalle: msg,
        carpetaMadre: drive.CARPETA_MADRE,
        cuenta: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
      });
    }
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
