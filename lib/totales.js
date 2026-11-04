// El total de un renglón de la hoja de ventas, aunque la fórmula no haya bajado.
//
// 4 nov. Urs: "el total de la N1-26 es $231,420". El panel decía $113,508 y un
// margen de 8.3%. No era una cuenta mal hecha del ERP: la venta tiene dos
// renglones —7 Burós y 5 Sillas— y en el de las Sillas las columnas de precio
// (Precio sin IVA, Impuestos, Descuentos, Total Pedido, Total con envío sin
// impuestos) están VACÍAS. La fórmula de la hoja no se copió a ese renglón.
// El Costo total sí está, así que el ERP sumaba el costo de las 12 piezas
// contra el precio de 7: margen 8.3% en vez de 47%.
//
// Es el mismo agujero que ya se había tapado para la columna "Descuentos" en
// el comparativo de costos. Aquí se rehace igual que la hoja:
//     precio unitario × cantidad ÷ 1.16  −  descuento  +  envío sin impuestos
// y se avisa de cuáles renglones hubo que calcular, para que alguien baje la
// fórmula en la hoja.
'use strict';

// idx: los índices de columna que ya resolvió el handler con col().
// num: la misma función num() del handler, para no cambiar cómo se leen los
// números (la hoja trae " $ 19,800.00 " con espacios).
function totalSinIVADe(idx, r, num) {
  // Vacío NO es lo mismo que cero. Un renglón de cortesía o una reposición
  // tienen su fórmula y dan $0: ése es su total y no se toca. Solo se rehace
  // cuando la celda está en blanco, que es cuando la fórmula no bajó.
  const crudo = idx.total ? String(r[idx.total] == null ? '' : r[idx.total]).trim() : '';
  if (crudo !== '') return { total: num(r[idx.total]), calculado: false };

  // Sin total en la hoja: se rehace desde el precio
  const base = (idx.sinIVA && num(r[idx.sinIVA]))
    ? num(r[idx.sinIVA])
    : ((idx.pu ? num(r[idx.pu]) : 0) * (idx.cant ? num(r[idx.cant]) : 0)) / 1.16;
  if (!base) return { total: 0, calculado: false };

  let pct = idx.pct ? num(r[idx.pct]) : 0;
  if (pct > 0 && pct < 1) pct = pct * 100;      // 0.05 y 5% son lo mismo
  const desc = pct ? (base * pct / 100) : (idx.desc ? num(r[idx.desc]) : 0);
  const envio = idx.envio ? num(r[idx.envio]) : 0;

  return { total: Math.round((base - desc + envio) * 100) / 100, calculado: true };
}

// Los índices que necesita el cálculo, resueltos una sola vez por handler.
function indicesTotal(H, col) {
  return {
    total:  col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos'),
    sinIVA: col(H, 'Precio sin IVA'),
    pu:     col(H, 'Precio Unitario'),
    cant:   col(H, 'Cantidad'),
    pct:    col(H, '% descuento', '% Descuento', 'Descuento %'),
    desc:   col(H, 'Descuentos'),
    envio:  col(H, 'Envio sin Impuestos', 'Envío sin Impuestos')
  };
}

module.exports = { totalSinIVADe, indicesTotal };
