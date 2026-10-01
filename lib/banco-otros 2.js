// Lectores de PayPal y American Express.
//
// Son formatos distintos al del banco y cada uno tiene su trampa:
//
// PAYPAL. Cada movimiento ocupa tres renglones: la descripción arriba, la fecha
// con los importes en medio, y el Id. abajo. Trae Bruto, Comisión y Neto, y el
// signo ya viene puesto: negativo es salida. Ojo con los pares "Pago preaprobado"
// más "Depósito general a tarjeta" del mismo monto y día: se anulan entre sí,
// porque PayPal cobra y al mismo tiempo carga la tarjeta.
//
// AMEX. Es una tarjeta de crédito, no una cuenta: los importes NO llevan signo y
// todo es cargo salvo lo que trae "CR" en el renglón de abajo. La fecha viene
// como "15 de Junio", sin año, así que el año se toma del periodo del estado.
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
                agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };

function limpiar(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
function aNumero(t) {
  const s = String(t || '').replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ===== PayPal =====
function leerPayPal(texto, ctx) {
  const lineas = texto.split(/\r?\n/);
  const movs = [];
  const reMov = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(.*)$/;
  let descripcionPrevia = '';

  lineas.forEach((ln, i) => {
    const m = ln.match(reMov);
    if (!m) {
      const t = limpiar(ln);
      // La descripción va arriba de la fecha; los Id. y encabezados no cuentan
      if (t && !/^id\.?:/i.test(t) && !/^fecha\s+descrip/i.test(t) &&
          !/historial de transacciones/i.test(t)) {
        descripcionPrevia = t;
      }
      return;
    }
    const resto = m[4];
    // Bruto, comisión y neto, en ese orden, al final de la línea
    const nums = resto.match(/-?[\d,]+\.\d{2}/g) || [];
    if (nums.length < 3) return;
    const bruto = aNumero(nums[nums.length - 3]);
    const comision = aNumero(nums[nums.length - 2]);
    const neto = aNumero(nums[nums.length - 1]);
    // Lo que quede antes de los números, si trae texto, completa la descripción
    const antes = limpiar(resto.slice(0, resto.indexOf(nums[nums.length - 3]))
      .replace(/\b(Completado|Pendiente|Cancelado|Denegado)\b/i, '')
      .replace(/\bMXN|USD|EUR\b/i, ''));
    const idLinea = limpiar((lineas[i + 1] || '')).match(/Id\.?:\s*([A-Z0-9]+)/i);

    const desc = limpiar((descripcionPrevia + ' ' + antes)).slice(0, 200);
    descripcionPrevia = '';
    movs.push({
      cuenta: ctx.cuenta || 'PayPal',
      banco: 'PayPal',
      fecha: (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]),
      concepto: desc.split(':')[0].slice(0, 80) || 'Movimiento de PayPal',
      descripcion: desc,
      referencia: idLinea ? idLinea[1] : '',
      rfc: '',
      // El neto ya trae el signo puesto
      tipo: neto >= 0 ? 'INGRESO' : 'EGRESO',
      monto: Math.abs(neto),
      bruto: Math.abs(bruto),
      comision: Math.abs(comision),
      estado: /Completado/i.test(resto) ? 'Completado' : limpiar(
        (resto.match(/\b(Pendiente|Cancelado|Denegado|Completado)\b/i) || [])[0] || '')
    });
  });

  // Los pares que se anulan: mismo día, mismo monto, uno sale y otro entra,
  // porque PayPal cobra la factura y de inmediato carga la tarjeta.
  movs.forEach(a => {
    if (a.anulado) return;
    const par = movs.filter(b => !b.anulado && b !== a && b.fecha === a.fecha &&
      Math.abs(b.monto - a.monto) < 0.01 && b.tipo !== a.tipo &&
      /dep[oó]sito general a tarjeta/i.test(b.descripcion + a.descripcion))[0];
    if (par) { a.anulado = true; par.anulado = true; }
  });
  return movs;
}

// ===== American Express =====
function leerAmex(texto, ctx) {
  const lineas = texto.split(/\r?\n/);
  const movs = [];
  // "15 de Junio  FACEBK *2MKNLV57R2   DUBLIN        9,574.64"
  const reMov = /^\s*(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(.*)$/;

  // El año sale del periodo del estado de cuenta
  let anio = ctx.anio || new Date().getFullYear();
  const per = texto.match(/(\d{1,2})\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+\s+(\d{4})/);
  if (per) anio = +per[2];

  let actual = null;
  lineas.forEach((ln, i) => {
    const m = ln.match(reMov);
    if (!m) {
      if (!actual) return;
      const t = limpiar(ln);
      if (!t) return;
      // "CR" en el renglón de abajo significa que fue un abono, no un cargo
      if (/^CR$/i.test(t)) { actual.tipo = 'INGRESO'; return; }
      if (/^(RFC|CARGO|REF)/i.test(t) || /\/REF/.test(t)) {
        const rfc = (t.match(/RFC([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i) || [])[1];
        if (rfc) actual.rfc = rfc;
        actual.referencia = limpiar((actual.referencia + ' ' + t)).slice(0, 200);
      }
      return;
    }
    const mes = MESES[norm(m[2])];
    if (!mes) return;
    const resto = m[3];
    const nums = resto.match(/[\d,]+\.\d{2}/g) || [];
    if (!nums.length) return;
    const importe = aNumero(nums[nums.length - 1]);
    const desc = limpiar(resto.slice(0, resto.lastIndexOf(nums[nums.length - 1])));
    if (!desc) return;

    // El estado va de un mes al siguiente: si el mes es mayor al del corte,
    // el movimiento es del año anterior.
    let a = anio;
    if (ctx.mesCorte && mes > ctx.mesCorte) a = anio - 1;

    movs.push(actual = {
      cuenta: ctx.cuenta || 'American Express',
      banco: 'American Express',
      fecha: a * 10000 + mes * 100 + (+m[1]),
      // El comercio es lo primero de la descripción; después viene la ciudad
      concepto: desc.replace(/\s{2,}.*$/, '').slice(0, 80),
      descripcion: desc,
      referencia: '',
      rfc: '',
      // En una tarjeta de crédito todo es cargo salvo los abonos y los pagos
      tipo: /gracias por su pago|pago recibido|abono|bonificaci/i.test(desc)
        ? 'INGRESO' : 'EGRESO',
      monto: Math.abs(importe)
    });
  });
  return movs;
}

// Cuál de los dos formatos es
function detectar(texto) {
  if (/Historial de transacciones/i.test(texto) && /Comisi[oó]n/i.test(texto)) return 'paypal';
  if (/American Express|Saldo Anterior.*Pagos y|Fecha y Detalle de las operaciones/i.test(texto)) return 'amex';
  return null;
}

function leer(texto, ctx) {
  const c = ctx || {};
  const cual = detectar(texto);
  if (cual === 'paypal') return { fuente: 'PayPal', movimientos: leerPayPal(texto, c) };
  if (cual === 'amex') return { fuente: 'American Express', movimientos: leerAmex(texto, c) };
  return { fuente: null, movimientos: [] };
}

module.exports = { leer, detectar, leerPayPal, leerAmex };
