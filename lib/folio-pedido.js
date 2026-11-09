// Qué número de pedido toca para un proveedor.
//
// "En Pedidos a Proveedores, al seleccionar el proveedor, que el ERP sugiera la
// nomenclatura del pedido correspondiente al consecutivo" (Nico, 6 nov).
//
// No hay UNA nomenclatura: en la hoja conviven dos.
//
//   TANDEM        PCH-T-074, PCH-T-075, PCH-T-076     número corrido, sin mes ni año
//   SERGIO        S-SEP-09-26, S-OCT-10-26, S-NOV-11-26   inicial + mes + mes nº + año
//   MARCELINO     MD-M-NOV-06-26                       ahí el 06 NO es el mes
//   MARTIN        M-JN-06-26                           JN = junio, y 06 = 6
//
// Por eso no se inventa un formato: se copia el del propio proveedor y se le
// cambia lo que toca. Lo que había antes partía el número en "todo lo de
// adelante" + "los dígitos del final", así que a S-OCT-10-26 le sumaba uno al
// **año** y proponía S-OCT-10-27.
//
// Esta misma lógica está repetida en index.html para el formulario, y
// t-folio-pedido.js corre los dos contra los mismos casos para que no se
// separen.
const MESES3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
// Cómo los escriben ellos, con sus abreviaturas de verdad
const MES_NUM = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JN: 6, JUL: 7, JL: 7,
  AGO: 8, AG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12
};

// "S-OCT-10-26" → [{t:'L',v:'S'},{t:'S',v:'-'},{t:'L',v:'OCT'},…]
function partir(s) {
  const out = [];
  String(s == null ? '' : s).trim().replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ]+)|(\d+)|([^A-Za-z0-9]+)/g,
    (m, let_, num, sep) => {
      // v va en mayúsculas para comparar; orig conserva cómo lo escriben ellos
      if (let_) out.push({ t: 'L', v: let_.toUpperCase(), orig: let_ });
      else if (num) out.push({ t: 'N', v: num });
      else out.push({ t: 'S', v: sep });
      return '';
    });
  return out;
}
// La forma: el molde del número, sin los valores que cambian
function formaDe(tk) {
  return tk.map(x => x.t === 'N' ? 'N' : (x.t === 'S' ? x.v : (MES_NUM[x.v] ? 'M' : x.v))).join('|');
}

// numeros: los números de pedido que ya tiene ESE proveedor, como vienen en la hoja
// hoy: Date (opcional, para poder probarlo)
function siguientePedido(numeros, hoy) {
  const H = hoy || new Date();
  const mesHoy = H.getMonth() + 1;
  const aaHoy = String(H.getFullYear()).slice(-2);

  const limpios = (numeros || []).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
  if (!limpios.length) return { sugerido: '', basadoEn: '', porque: '' };

  // Se agrupan por forma y gana la que más use ese proveedor
  const porForma = {};
  limpios.forEach(n => {
    const tk = partir(n);
    if (!tk.some(x => x.t === 'N')) return;          // sin números no hay consecutivo
    const f = formaDe(tk);
    (porForma[f] = porForma[f] || { forma: f, casos: [] }).casos.push(tk);
  });
  const grupos = Object.keys(porForma).map(k => porForma[k])
    .sort((a, b) => b.casos.length - a.casos.length);
  if (!grupos.length) return { sugerido: '', basadoEn: '', porque: '' };
  const g = grupos[0];

  const posN = [];
  g.casos[0].forEach((x, i) => { if (x.t === 'N') posN.push(i); });
  const posMes = g.casos[0].findIndex(x => x.t === 'L' && MES_NUM[x.v]);

  // El último grupo de dígitos es el año cuando hay más de uno y de verdad
  // parece año (dos dígitos, de 20 en adelante).
  let iAnio = -1;
  if (posN.length > 1) {
    const ult = posN[posN.length - 1];
    const vals = g.casos.map(c => parseInt(c[ult].v, 10));
    if (vals.every(v => v >= 20 && v <= 99) && g.casos[0][ult].v.length === 2) iAnio = ult;
  }
  const iCons = posN.filter(i => i !== iAnio).pop();
  if (iCons == null) return { sugerido: '', basadoEn: '', porque: '' };

  // ¿Ese número va pegado al mes? Se mira en su propio historial.
  let pegadoAlMes = false;
  if (posMes !== -1) {
    let coinciden = 0, mirados = 0;
    g.casos.forEach(c => {
      const m = MES_NUM[c[posMes].v];
      if (!m) return;
      mirados++;
      if (parseInt(c[iCons].v, 10) === m) coinciden++;
    });
    pegadoAlMes = mirados > 0 && (coinciden / mirados) >= 0.6;
  }

  // El más alto de ese proveedor es la base
  const ordenados = g.casos.slice().sort((a, b) =>
    parseInt(a[iCons].v, 10) - parseInt(b[iCons].v, 10));
  const base = ordenados[ordenados.length - 1];
  const largo = base[iCons].v.length;
  const maximo = parseInt(base[iCons].v, 10);

  const nuevo = base.map((x, i) => {
    if (i === iCons) {
      const n = pegadoAlMes ? mesHoy : (maximo + 1);
      return String(n).padStart(largo, '0');
    }
    if (i === iAnio) return aaHoy;
    if (i === posMes) {
      // Se respeta su abreviatura cuando la tienen para este mes; si no, la de tres letras
      const suyas = {};
      g.casos.forEach(c => { const m = MES_NUM[c[posMes].v]; if (m) suyas[m] = c[posMes].orig; });
      return suyas[mesHoy] || MESES3[mesHoy - 1];
    }
    return x.orig || x.v;
  }).join('');

  return {
    sugerido: nuevo,
    basadoEn: base.map(x => x.orig || x.v).join(''),
    porque: pegadoAlMes
      ? 'El número va con el mes, como en sus pedidos anteriores.'
      : 'Sigue el consecutivo de este proveedor.'
  };
}

module.exports = { siguientePedido, partir, formaDe, MES_NUM, MESES3 };
