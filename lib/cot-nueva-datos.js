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

// Cuánto se espera por una foto antes de seguir sin ella.
//
// 6 nov. Camila: "intenté hacer una cotización y me sale sin fotos". No era
// permisos —la cuenta de servicio es Editor de la carpeta— ni los nombres: la
// foto "Banco Chara Bajo - Nogal.png" existe. Son el PESO y el ORDEN: las fotos
// del catálogo se cambiaron en septiembre por PNG de entre 1.4 y 1.9 MB, y se
// bajaban UNA POR UNA. Siete artículos son ~10 MB en fila india, más de lo que
// aguanta la función antes de cortarse, y cada fallo se tragaba en silencio: la
// cotización salía completa, sin fotos y sin decir por qué.
const ESPERA_FOTO = 7000;

function conLimite(promesa, ms) {
  return new Promise((resolve) => {
    let listo = false;
    const reloj = setTimeout(() => { if (!listo) { listo = true; resolve(null); } }, ms);
    promesa.then(v => { if (!listo) { listo = true; clearTimeout(reloj); resolve(v); } })
           .catch(() => { if (!listo) { listo = true; clearTimeout(reloj); resolve(null); } });
  });
}

async function fotoEnBase64(liga) {
  if (!liga) return '';
  if (_cache[liga] !== undefined) return _cache[liga];
  const d = await conLimite(bajarImagen(liga), ESPERA_FOTO);
  _cache[liga] = d && d.buf ? d.buf.toString('base64') : '';
  return _cache[liga];
}

// Todas las fotos a la vez, no una tras otra. Devuelve un mapa liga → base64.
async function fotosDeTodos(ligas) {
  const unicas = ligas.filter((l, i) => l && ligas.indexOf(l) === i);
  const sacadas = await Promise.all(unicas.map(async (l) => [l, await fotoEnBase64(l)]));
  const mapa = {};
  sacadas.forEach(([l, b]) => { mapa[l] = b; });
  return mapa;
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
  // Las fotos se piden todas juntas antes de armar los renglones
  const ligaDe = (it) => (it.fotoDrive
    ? ('https://drive.google.com/file/d/' + it.fotoDrive + '/view') : it.foto) || '';
  const fotos = o.sinFotos ? {} : await fotosDeTodos(items.map(ligaDe));
  const sinFoto = [];
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
      fotoBase64: o.sinFotos ? '' : (fotos[ligaDe(it)] || '')
    });
    // Para poder decir cuáles faltaron, en vez de entregar el PDF mudo
    if (!o.sinFotos && !(fotos[ligaDe(it)] || '')) {
      sinFoto.push(String(it.producto || '').trim() +
        (it.material ? ' · ' + String(it.material).trim() : '') +
        (ligaDe(it) ? '' : ' (no hay foto en el catálogo ni en la carpeta)'));
    }
  }
  return {
    cot: {
      cliente: cot.cliente,
      // La fecha de la cotización, para la portada
      fecha: cot.fecha || '',
      despacho: cot.despacho,
      proyecto: cot.proyecto,
      folio: cot.folio,
      productos: productos,
      envio: cot.envio,
      total: cot.total,
      anticipo: cot.anticipo,
      finiquito: cot.finiquito,
      entregaInmediata: !!cot.entregaInmediata,
      cpDestino: cot.cpDestino || '',
      // El tiempo de entrega y la nota van al final de la cotización
      tiempoEntrega: cot.tiempoEntrega || '',
      notas: cot.notas || ''
    },
    piezas: items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
    descuentoPct: pctComun(items),
    // Qué muebles salieron sin foto, para decirlo en pantalla
    sinFoto: sinFoto
  };
}

module.exports = { aFormatoNuevo };
