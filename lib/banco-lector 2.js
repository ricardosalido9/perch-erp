// Lee un estado de cuenta de BBVA en PDF y saca los movimientos.
//
// Maneja los dos formatos que manda el banco:
//   1. El estado de cuenta del mes (PDF oficial, con fecha de operación y liquidación)
//   2. El detalle de movimientos de BBVAnet (el del mes en curso, con fecha dd-mm)
//
// De cada movimiento saca: fecha, concepto, descripción, referencia, cargo, abono,
// saldo, RFC de la contraparte cuando viene, y de qué cuenta es.
//
// Lo que NO hace: decidir la categoría. Eso lo propone otro paso contra el catálogo
// y siempre lo aprueba una persona.

const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8,
                sep:9, oct:10, nov:11, dic:12 };

// Todos los importes de una línea, con la posición donde termina cada uno
function posicionesDe(linea) {
  const out = [];
  const re = /[\d,]+\.\d{1,2}/g;
  let m;
  while ((m = re.exec(linea)) !== null) {
    out.push({ valor: aNumero(m[0]), inicio: m.index, fin: m.index + m[0].length });
  }
  return out;
}
function limpiar(t) {
  return String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
}
function aNumero(t) {
  const s = String(t || '').replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ===== Formato 1: estado de cuenta del mes =====
// "03/JUL  02/JUL  A15 PELETERIA MENDELE   3,202.76   3,781.79  3,731.79"
function leerEstadoDeCuenta(texto, ctx) {
  const lineas = texto.split(/\r?\n/);
  const movs = [];
  const reFecha = /^\s*(\d{2})\/([A-Z]{3})\s+(\d{2})\/([A-Z]{3})\s+(.*)$/;
  const reImportes = /([\d,]+\.\d{2})/g;

  let actual = null;
  // El movimiento se empuja al crearlo; cerrar solo deja de acumularle referencia
  const cerrar = () => { actual = null; };

  lineas.forEach(ln => {
    const m = ln.match(reFecha);
    if (m) {
      cerrar();
      const dia = +m[1];
      const mes = MESES[m[2].toLowerCase()] || ctx.mes || 0;
      const resto = m[5];
      // Los importes son los últimos números de la línea. El primero es el
      // movimiento y los que siguen son saldos, que no se usan para clasificar.
      const nums = resto.match(reImportes) || [];
      let descripcion = resto;
      if (nums.length) descripcion = resto.slice(0, resto.indexOf(nums[0]));
      const codigo = (descripcion.match(/^\s*([A-Z]\d{2}|[A-Z]{1,3}\d{0,2})\s+/) || [])[1] || '';
      movs.push(actual = {
        cuenta: ctx.cuenta || '',
        banco: 'BBVA',
        fecha: (ctx.anio || new Date().getFullYear()) * 10000 + mes * 100 + dia,
        codigo: codigo,
        concepto: limpiar(descripcion.replace(/^\s*[A-Z]\d{2}\s+/, '')),
        descripcion: '',
        referencia: '',
        rfc: '',
        // Todos los números de la línea con dónde TERMINA cada uno. Los importes
        // se alinean a la derecha, así que la posición final es la que identifica
        // la columna: cargo, abono o saldo.
        numeros: posicionesDe(ln)
      });
      return;
    }
    // Las líneas de abajo son la referencia: RFC, número de cuenta, nombre
    if (actual && ln.trim() && !/^\s*(BBVA MEXICO|Av\. Paseo|Total de Movimientos|FECHA|OPER)/i.test(ln)) {
      const rfc = (ln.match(/RFC:\s*([A-ZÑ&]{3,4}\s?\d{6}[A-Z0-9]{3})/i) || [])[1];
      if (rfc) actual.rfc = limpiar(rfc);
      actual.referencia = limpiar((actual.referencia + ' ' + ln).slice(0, 300));
    }
  });
  cerrar();
  return movs;
}

// ===== Formato 2: detalle de movimientos de BBVAnet =====
// "25-08  TRASPASO CUENTAS PROPIAS/ 6651282263  $ 5,000.00   $ 744,814.69"
function leerMovimientos(texto, ctx) {
  const lineas = texto.split(/\r?\n/);
  const movs = [];
  const reFecha = /^\s*(\d{2})-(\d{2})\s+(.*)$/;
  let actual = null, previa = '';
  const util = (l) => l.trim() &&
    !/^https?:|^\s*(Cerrar|Imprimir|En cumplimiento|Fecha\s+Concepto)/i.test(l);

  lineas.forEach(ln => {
    const m = ln.match(reFecha);
    if (m) {
      const dia = +m[1], mes = +m[2];
      const resto = m[3];
      const nums = resto.match(/\$\s*[\d,]+\.\d{2}/g) || [];
      // En este formato el concepto viene en la línea de ARRIBA de la fecha y la
      // referencia en la de abajo: el PDF los acomoda alrededor del renglón.
      const partes = limpiar(previa).split('/');
      actual = {
        cuenta: ctx.cuenta || '',
        banco: 'BBVA',
        fecha: (ctx.anio || new Date().getFullYear()) * 10000 + mes * 100 + dia,
        codigo: '',
        concepto: limpiar(partes[0]),
        descripcion: limpiar(partes.slice(1).join('/')),
        referencia: '',
        rfc: '',
        numeros: posicionesDe(ln)
      };
      movs.push(actual);
      previa = '';
      return;
    }
    if (!util(ln)) return;
    if (actual && !actual.referencia) {
      actual.referencia = limpiar(ln).slice(0, 300);
      const rfc = (ln.match(/RFC:\s*([A-ZÑ&]{3,4}\s?\d{6}[A-Z0-9]{3})/i) || [])[1];
      if (rfc) actual.rfc = limpiar(rfc);
    } else {
      previa = ln;                    // el concepto del movimiento que sigue
    }
  });
  return movs;
}

// ===== Cargo o abono =====
// El PDF no dice cuál columna es: se sabe por dónde está impreso el número.
// En vez de adivinar con un corte, se leen las posiciones del encabezado
// (Cargo, Abono, Saldo) y cada número se asigna a la columna más cercana.
// La de saldo se ignora: no es un movimiento, es el acumulado.
function columnasDelEncabezado(texto) {
  const lineas = texto.split(/\r?\n/);
  // Estado de cuenta: "CARGOS  ABONOS  OPERACIÓN  LIQUIDACIÓN"
  let ln = lineas.filter(x => /CARGOS/i.test(x) && /ABONOS/i.test(x))[0];
  if (ln) {
    const fin = (re) => { const i = ln.search(re); return i === -1 ? null : i + ln.match(re)[0].length; };
    return { cargo: fin(/CARGOS/i), abono: fin(/ABONOS/i),
             saldos: [fin(/OPERACI[OÓ]N/i), fin(/LIQUIDACI[OÓ]N/i)].filter(x => x !== null) };
  }
  // BBVAnet: "Cargo  Abono  Saldo"
  ln = lineas.filter(x => /\bCargo\b/.test(x) && /\bAbono\b/.test(x))[0];
  if (ln) {
    const fin = (re) => { const i = ln.search(re); return i === -1 ? null : i + ln.match(re)[0].length; };
    return { cargo: fin(/\bCargo\b/), abono: fin(/\bAbono\b/),
             saldos: [fin(/\bSaldo\b/)].filter(x => x !== null) };
  }
  return null;
}

function partirCargoAbono(movs, cols) {
  const salida = [];
  movs.forEach(m => {
    if (!m.numeros || !m.numeros.length) return;
    let elegido = null;
    if (cols) {
      // Se descartan los que caen en la columna de saldo y se toma el que quede
      const candidatos = m.numeros.filter(n => {
        const dCargo = cols.cargo === null ? 1e9 : Math.abs(n.fin - cols.cargo);
        const dAbono = cols.abono === null ? 1e9 : Math.abs(n.fin - cols.abono);
        const dSaldo = Math.min.apply(null,
          (cols.saldos.length ? cols.saldos : [1e9]).map(s => Math.abs(n.fin - s)));
        return Math.min(dCargo, dAbono) <= dSaldo;
      });
      if (candidatos.length) {
        const n = candidatos[0];
        const dCargo = cols.cargo === null ? 1e9 : Math.abs(n.fin - cols.cargo);
        const dAbono = cols.abono === null ? 1e9 : Math.abs(n.fin - cols.abono);
        elegido = { valor: n.valor, tipo: dAbono < dCargo ? 'INGRESO' : 'EGRESO' };
      }
    }
    if (!elegido) {
      const n = m.numeros[0];
      elegido = { valor: n.valor, tipo: 'EGRESO' };
    }
    salida.push({
      cuenta: m.cuenta, banco: m.banco, fecha: m.fecha, codigo: m.codigo,
      concepto: m.concepto, descripcion: m.descripcion,
      referencia: m.referencia, rfc: m.rfc,
      tipo: elegido.tipo, monto: elegido.valor
    });
  });
  return salida;
}

function leer(texto, ctx) {
  const c = ctx || {};
  // El estado de cuenta oficial también dice "Detalle de Movimientos Realizados",
  // así que no sirve para distinguirlos. Lo que sí los separa es el formato de la
  // fecha: el del banco usa 03/JUL y el de BBVAnet usa 25-08.
  const conBarra = (texto.match(/^\s*\d{2}\/[A-Z]{3}\s+\d{2}\/[A-Z]{3}/gm) || []).length;
  const conGuion = (texto.match(/^\s*\d{2}-\d{2}\s/gm) || []).length;
  const esBBVAnet = conGuion > conBarra;
  const crudos = esBBVAnet ? leerMovimientos(texto, c) : leerEstadoDeCuenta(texto, c);
  return partirCargoAbono(crudos, columnasDelEncabezado(texto));
}

// La llave que evita duplicados: si se sube el mes en curso y luego el estado de
// cuenta completo, los movimientos repetidos se reconocen y no entran dos veces.
function llave(m) {
  return [m.cuenta, m.fecha, m.tipo, m.monto.toFixed(2),
          String(m.concepto).slice(0, 24).toLowerCase()].join('|');
}

module.exports = { leer, llave, leerEstadoDeCuenta, leerMovimientos, columnasDelEncabezado };
