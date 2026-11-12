// Saca el texto de un PDF CONSERVANDO las columnas.
//
// Por qué hace falta: en el estado de cuenta de BBVA no hay nada que diga si un
// número es cargo o abono. Lo único que los distingue es en qué columna está
// impreso. Un extractor normal devuelve el texto corrido y esa información se
// pierde, así que todos los movimientos saldrían como cargo.
//
// Aquí se leen las posiciones de cada pedazo de texto y se rearma la página como
// si fuera una hoja de ancho fijo, igual que hace `pdftotext -layout`.
const pdfParse = require('pdf-parse');

// Ancho de la hoja en caracteres. 200 alcanza para el formato horizontal del banco.
const COLUMNAS = 200;

function render(pageData) {
  return pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  }).then(contenido => {
    const items = contenido.items || [];
    if (!items.length) return '';

    // Cada pedazo trae su posición: transform[4] es la x, transform[5] la y
    let minX = Infinity, maxX = -Infinity;
    items.forEach(it => {
      const x = it.transform[4];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + (it.width || 0));
    });
    const ancho = Math.max(1, maxX - minX);

    // Se agrupan por renglón: dos pedazos con y parecida van en la misma línea
    const renglones = {};
    items.forEach(it => {
      const y = Math.round(it.transform[5]);
      let clave = null;
      for (const k in renglones) {
        if (Math.abs(+k - y) <= 2) { clave = k; break; }
      }
      if (clave === null) { clave = String(y); renglones[clave] = []; }
      renglones[clave].push({
        x: it.transform[4],
        ancho: it.width || 0,
        texto: it.str == null ? '' : String(it.str)
      });
    });

    // De arriba hacia abajo (en el PDF la y crece hacia arriba)
    const orden = Object.keys(renglones).map(Number).sort((a, b) => b - a);
    const lineas = orden.map(y => {
      const partes = renglones[String(y)].sort((a, b) => a.x - b.x);
      let linea = '', finAnterior = null;
      partes.forEach(p => {
        if (!p.texto) return;
        // Si este pedazo viene pegado al anterior, se une SIN espacio. El PDF parte
        // los números en varios pedazos ("3,250.1" y luego "1") y si se separan,
        // el importe queda ilegible y se acaba leyendo el saldo en su lugar.
        const pegado = finAnterior !== null && (p.x - finAnterior) < 2.5;
        if (pegado) {
          linea += p.texto;
        } else {
          const destino = Math.round(((p.x - minX) / ancho) * COLUMNAS);
          if (destino > linea.length) linea += ' '.repeat(destino - linea.length);
          else if (linea.length && !/\s$/.test(linea)) linea += ' ';
          linea += p.texto;
        }
        finAnterior = p.x + (p.ancho || 0);
      });
      return linea.replace(/\s+$/, '');
    });
    return lineas.join('\n');
  });
}

async function extraer(buffer) {
  const datos = await pdfParse(buffer, { pagerender: render });
  return datos.text || '';
}

module.exports = { extraer };
