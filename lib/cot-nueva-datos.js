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
// El porcentaje que va en el TÍTULO de la columna. Solo se pone cuando TODOS los
// renglones llevan el mismo: si uno lleva 15% y otro nada, poner "DESCUENTO 15%"
// arriba dice que todos tienen 15%, y no es cierto.
//
// Antes bastaba con que los renglones CON descuento coincidieran entre sí, así
// que un descuento puesto a un solo artículo se anunciaba como si fuera de toda
// la cotización.
function pctComun(items) {
  if (!items.length) return 0;
  const pcts = items.map(i => Number(i.descPct) || 0);
  return pcts.every(p => p === pcts[0]) && pcts[0] > 0 ? pcts[0] : 0;
}

async function aFormatoNuevo(cot, opciones) {
  const o = opciones || {};
  const items = cot.items || [];
  const productos = [];
  for (const it of items) {
    const cant = Number(it.cantidad) || 1;
    productos.push({
      producto: it.producto,
      // El nombre del mueble SIEMPRE va primero. Antes la descripción era solo lo
      // que trae el catálogo más las especificaciones, así que cuando el catálogo
      // no tenía descripción para esa variante el renglón salía diciendo nada más
      // "Nogal" —el material— y el cliente no sabía qué está cotizando.
      // El nombre del mueble SIEMPRE va primero. Antes la descripción era solo lo
      // que trae el catálogo más las especificaciones, así que cuando el catálogo
      // no tenía descripción para esa variante el renglón salía diciendo nada más
      // "Nogal" —el material— y el cliente no sabía qué está cotizando.
      //
      // Cada pedazo se agrega solo si no está ya dicho: el material suele venir
      // repetido dentro de la descripción del catálogo y quedaba "Nogal · Nogal".
      // La descripción del renglón, armada sin repetir nada.
      //
      // Se junta de cuatro fuentes —nombre, material, descripción del catálogo y
      // especificaciones— y todas tienden a decir lo mismo: el catálogo empieza
      // repitiendo el nombre del mueble y suele mencionar la madera. Sin limpiar
      // quedaba "Atril Bisbita Grande / Nogal / Atril Bisbita Grande. Elaborado
      // en madera sólida de nogal", que es lo mismo tres veces.
      descripcion: (function () {
        const plano = (x) => String(x == null ? '' : x).toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

        const nombre = String(it.producto || '').trim();
        const desc = String(it.desc || '').trim();
        const esp = String(it.especificaciones || '').trim();
        const material = String(it.material || '').trim();

        // De la descripción se quitan los renglones de arriba que solo repiten el
        // nombre del mueble. El catálogo los escribe como título y aquí el título
        // ya lo pone el nombre.
        const enNombre = plano(nombre);
        const cuerpo = (desc + (esp ? '\n' + esp : ''))
          .split(/\r?\n/).map(x => x.trim()).filter(Boolean)
          .filter(l => {
            const pl = plano(l);
            if (!pl) return false;
            // Renglón corto que ya está dicho en el nombre del producto
            return !(pl.length <= 40 && enNombre.indexOf(pl) !== -1);
          })
          // Y si el primer renglón ARRANCA con el nombre, se le quita esa parte
          .map((l, k) => {
            if (k !== 0 || !nombre) return l;
            if (plano(l).indexOf(enNombre) !== 0) return l;
            return l.slice(nombre.length).replace(/^\s*[.·,:;-]?\s*/, '');
          })
          .filter(Boolean);

        const textoCuerpo = plano(cuerpo.join(' '));
        const partes = [];
        if (nombre) partes.push(nombre);
        // El material solo si el cuerpo no lo dice ya
        if (material && !/^(na|n\/a|no|-)$/i.test(material) &&
            textoCuerpo.indexOf(plano(material)) === -1) {
          partes.push(material);
        }
        cuerpo.forEach(l => partes.push(l));
        // Con saltos de línea: el PDF los usa para saber qué es título y qué no
        return partes.join('\n');
      })(),
      medidas: it.medidas,
      cantidad: cant,
      // El módulo pinta dos columnas: el precio de lista y el precio ya con
      // descuento. quote.js entrega el precio unitario y el total del renglón,
      // así que el precio final por pieza se obtiene dividiendo entre la cantidad.
      precioConIVA: Number(it.precio) || 0,
      precioFinal: cant ? (Number(it.total) || 0) / cant : Number(it.precio) || 0,
      // El descuento de ESTE renglón, para poder mostrarlo aunque los demás
      // lleven otro o ninguno
      descPct: Number(it.descPct) || 0,
      // La foto de la carpeta manda sobre la liga del catálogo
      fotoBase64: o.sinFotos ? '' : await fotoEnBase64(
        it.fotoDrive ? ('https://drive.google.com/file/d/' + it.fotoDrive + '/view') : it.foto)
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
      finiquito: cot.finiquito,
      entregaInmediata: !!cot.entregaInmediata,
      cpDestino: cot.cpDestino || ''
    },
    piezas: items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
    descuentoPct: pctComun(items)
  };
}

module.exports = { aFormatoNuevo };
