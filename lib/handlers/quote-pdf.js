// Genera el PDF de una cotización/venta y lo guarda en Drive, en la carpeta que toca:
//   cotización -> Carpeta madre / Cotizaciones / "COT-E1-26 Cliente.pdf"
//   venta      -> Carpeta madre / Ventas / "E1-26 Cliente" / "E1-26 Cliente.pdf"
const core = require('../core');
const drive = require('../drive');
const { generarCotizacion } = require('../pdf');
const { armar } = require('./quote');

// Van bajo el título CONDICIONES ESPECIALES, abajo a la izquierda.
const CONDICIONES = [
  'Entrega aproximada: 6 a 8 semanas a partir del anticipo y de la confirmacion de materiales.',
  'Precios en pesos mexicanos con IVA incluido. Garantia de 12 meses por defectos de fabricacion.',
  'Nuestros muebles son ensamblados a mano, por lo que pueden variar ligeramente en acabados y tonalidades.'
];
const BANCO = {
  titular: 'PERCH DISEÑO Y MOBILIARIO SA DE CV', banco: 'BBVA',
  cuenta: '0117441789', clabe: '012180001174417892', swift: 'BCMRMXMMPYM'
};
const FACTURACION = [
  'Enviar: Cotización / Constancia Fiscal / Uso de CFDI / PPD o PUE',
  'contabilidad@perch.mx  ·  Isabel  ·  +52 55 2050 2562',
  'Días de elaboración de facturas: martes y jueves.'
];
// Segunda hoja de la cotización
const TERMINOS = [
  { titulo: 'PRECIOS Y ENVÍOS', puntos: [
    'Todos los precios indicados son en moneda nacional MXN e incluyen IVA.',
    'Se incluye el envío en CDMX; cualquier envío fuera de esta área se cotizará posteriormente con los datos correspondientes.',
    'El finiquito se solicitará de 2 a 5 días antes de la entrega. Al quedar saldado se notificará la fecha tentativa de envío.',
    'PERCH no se responsabiliza por retrasos derivados de datos incorrectos o ausencia de personal para recibir. Una reentrega podrá generar un cargo adicional.',
    'Los envíos foráneos se cotizan con empresas externas; PERCH no se responsabiliza por variaciones de tiempo, costo o calidad de la entrega.',
    'Las recolecciones por el cliente requieren previo aviso. PERCH no se responsabiliza del pedido después de su salida.',
    'Los precios están sujetos a cambio sin previo aviso.'
  ] },
  { titulo: 'COTIZACIONES', puntos: [
    'Todas las cotizaciones son válidas por 30 días.',
    'Para esta orden, el tiempo de entrega aproximado es de 4 a 6 semanas, sujeto a existencias y producción.'
  ] },
  { titulo: 'CANCELACIONES', puntos: [
    'Las órdenes pagadas con anticipo no podrán ser devueltas. Si se notifica un cambio dentro de 3 días hábiles, el monto podrá ofrecerse como cupón para otro pedido.',
    'PERCH podrá cancelar una orden si el cliente no acepta los términos o no paga en tiempo.'
  ] },
  { titulo: 'PAGOS Y FACTURACIÓN', puntos: [
    'Las órdenes aceptadas serán propiedad de PERCH hasta el pago del finiquito.',
    'Anticipo: 60%. Finiquito: 40%.',
    'Los datos bancarios y requisitos de facturación aparecen al pie de esta página.'
  ] },
  { titulo: 'MODIFICACIONES Y DIMENSIONES', puntos: [
    'Los muebles son ensamblados manualmente y utilizan materiales naturales, por lo que pueden variar en acabados, texturas, tonalidades, formas y dimensiones.',
    'Las pieles, maderas y mármoles pueden presentar marcas y vetas distintas a las imágenes de referencia.',
    'Si una orden se modifica con un material no probado por PERCH, pueden cambiar el precio, la calidad y el resultado del producto.'
  ] },
  { titulo: 'DEVOLUCIONES Y DAÑOS', puntos: [
    'Cualquier devolución debe ser aceptada previamente por PERCH.',
    'En entregas locales, cualquier daño debe reportarse al operador en el momento de la entrega. Al firmar la nota de remisión se acepta el buen estado de las piezas.',
    'En envíos foráneos, los daños deben reportarse dentro de los primeros 3 días con evidencia fotográfica del empaque y del mueble.'
  ] },
  { titulo: 'GARANTÍA', puntos: [
    'PERCH ofrece garantía de 12 meses por defectos de fabricación que impidan el uso correcto de la pieza.'
  ] },
  { titulo: 'MANTENIMIENTO', puntos: [
    'Madera: limpiar únicamente con un paño semihúmedo y secar; no usar químicos, detergentes ni aceites.',
    'Tapiz de piel: usar solo un paño semihúmedo y secar. Tela: aspirar ocasionalmente, evitar el agua y acudir a limpieza profesional en caso de manchas.'
  ] }
];
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
      pdfBuf = await generarCotizacion(cot, {
        condiciones: CONDICIONES, banco: BANCO, ciudad: 'CIUDAD DE MEXICO',
        terminos: TERMINOS, facturacion: FACTURACION
      });
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo armar el PDF: ' + ((e && e.message) || e) });
    }

    const nombre = drive.limpia(folio + ' ' + (cot.cliente || '')) + '.pdf';

    // Si solo se quiere el archivo (sin Drive), se devuelve en base64
    if (body.soloArchivo) {
      return res.status(200).json({ ok: true, nombre: nombre, pdf: pdfBuf.toString('base64'),
      // Se manda la lectura para poder avisar en pantalla cuando la cotización
      // salió sin descuentos: en el PDF esa columna simplemente no aparece y no
      // hay forma de distinguir "no hay descuento" de "no encontré la columna".
      lectura: cot.lectura || null });
    }

    try {
      // La fecha sirve de respaldo si el folio no dice de qué mes es
      const dest = await drive.carpetaDestino(esVenta, folio, cot.cliente, new Date());
      const archivo = await drive.subir(dest.drive, dest.carpeta.id, nombre, 'application/pdf', pdfBuf);
      return res.status(200).json({
        ok: true,
        nombre: nombre,
        archivo: archivo.webViewLink || '',
        carpeta: dest.carpeta.webViewLink || ('https://drive.google.com/drive/folders/' + dest.carpeta.id),
        carpetaId: dest.carpeta.id,
        destino: esVenta ? ('Ventas · ' + (dest.mes || '')) : 'Cotizaciones'
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const exp = drive.explicar(msg);
      // El PDF sí se hizo: se devuelve igual para que el usuario lo pueda bajar
      return res.status(200).json({
        ok: true, sinDrive: true, nombre: nombre, pdf: pdfBuf.toString('base64'),
        causa: exp.causa, arreglo: exp.arreglo, detalle: msg,
        carpetaMadre: drive.carpetaEnUso(),
        cuenta: drive.correoCuenta()
      });
    }
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
