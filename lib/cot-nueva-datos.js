// Traduce lo que arma quote.js a lo que espera el formato nuevo de cotización.
//
// Existían los dos lados y no se hablaban: el módulo del formato nuevo esperaba
// campos llamados precioConIVA, precioFinal, descripcion y fotoBase64, y lo que
// entrega quote.js se llama precio, total, desc y foto. Conectarlos tal cual
// habría sacado todos los precios en cero, que es peor que no conectarlos.
//
// Aquí vive esa traducción, en un solo lugar, para que el día que cambie uno de
// los dos no haya que ir a buscar el desajuste por todo el código.
const { bajarImagen } = require('./pdf');

// Las fotos del catálogo son ligas. El PDF necesita los bytes, y el módulo del
// formato nuevo los quiere en base64. Se reusa el mismo bajador del PDF viejo.
const _cache = {};
async function fotoEnBase64(liga) {
  if (!liga) return '';
  if (_cache[liga] !== undefined) return _cache[liga];
  try {
    const d = await bajarImagen(liga);
    _cache[liga] = d && d.buf ? d.buf.toString('base64') : '';
  } catch (e) { _cache[liga] = ''; }
  return _cache[liga];
}

// El descuento del encabezado de la tabla: si TODOS los renglones con descuento
// traen el mismo porcentaje, se pone en el título de la columna. Si hay varios
// distintos, no se pone ninguno y cada renglón muestra su precio ya rebajado.
function pctComun(items) {
  const pcts = items.filter(i => i.descPct).map(i => i.descPct);
  if (!pcts.length) return 0;
  return pcts.every(p => p === pcts[0]) ? pcts[0] : 0;
}

async function aFormatoNuevo(cot, opciones) {
  const o = opciones || {};
  const items = cot.items || [];
  const productos = [];
  for (const it of items) {
    const cant = Number(it.cantidad) || 1;
    productos.push({
      producto: it.producto,
      descripcion: [it.desc, it.especificaciones].filter(Boolean).join('. '),
      medidas: it.medidas,
      cantidad: cant,
      // El módulo pinta dos columnas: el precio de lista y el precio ya con
      // descuento. quote.js entrega el precio unitario y el total del renglón,
      // así que el precio final por pieza se obtiene dividiendo entre la cantidad.
      precioConIVA: Number(it.precio) || 0,
      precioFinal: cant ? (Number(it.total) || 0) / cant : Number(it.precio) || 0,
      fotoBase64: o.sinFotos ? '' : await fotoEnBase64(it.foto)
    });
  }
  return {
    cot: {
      cliente: cot.cliente,
      despacho: cot.despacho,
      proyecto: cot.proyecto,
      folio: cot.folio,
      productos: productos,
      envio: cot.envio,
      total: cot.total,
      anticipo: cot.anticipo,
      finiquito: cot.finiquito
    },
    piezas: items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
    descuentoPct: pctComun(items)
  };
}

module.exports = { aFormatoNuevo };
