// Junta TODO lo necesario para imprimir una cotización: los renglones de ese folio
// más la foto, descripción y medidas que vienen del catálogo.
const core = require('../core');
const fotos = require('../fotos');
const materialTxt = require('../material-txt');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(headers, ...nombres) {
  for (const n of nombres) {
    const h = headers.filter(x => norm(x) === norm(n))[0];
    if (h) return h;
  }
  return null;
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], cfg, error: e.message }; }
  if (!values.length) return { headers: [], rows: [], cfg };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => String(f[j] == null ? '' : f[j]).trim() !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows, cfg };
}

// Junta los datos de una cotización. Devuelve { error } si algo falta.
async function armar(key, folio) {
  {

    const src = await leer(key);
    if (!src.headers.length) return { error: 'No se pudo leer la hoja de ' + key + '.' };

    const H = src.headers;
    const cRef  = col(H, 'No. de Referencia', 'No de Referencia', 'Referencia', 'Folio');
    const cCli  = col(H, 'Cliente');
    const cProy = col(H, 'Proyecto', 'Nombre del proyecto');
    const cDesp = col(H, 'Despacho');
    const cFec  = col(H, 'Fecha del Cierre', 'Fecha');
    const cProd = col(H, 'Producto');
    const cMat  = col(H, 'Material');
    const cExt  = col(H, 'Material Extra');
    const cTela = col(H, 'Tela');
    const cEsp  = col(H, 'Especificaciones');
    const cCant = col(H, 'Cantidad');
    const cPU   = col(H, 'Precio Unitario');
    const cDesc = col(H, 'Descripción', 'Descripcion');
    const cMed  = col(H, 'Medidas');
    // El descuento no salía en la cotización. La causa: aquí se buscaba la columna
    // con UN solo nombre, "% descuento", y si en la hoja se llama de cualquier otra
    // forma el descuento se leía como cero y la columna ni siquiera se dibujaba,
    // porque el PDF solo la pinta cuando algún renglón trae descuento.
    const cPct  = col(H, '% descuento', '% Descuento', 'Descuento %', 'Porcentaje de descuento',
                      'Descuento', '% desc', 'Desc %', 'Desc');
    const cDto  = col(H, 'Descuentos', 'Descuento', 'Monto descuento', 'Descuento monto',
                      'Descuento $', 'Importe descuento');
    const cEnv  = col(H, 'Envio', 'Envío');
    // La entrega POR RENGLÓN: cada mueble puede tener la suya
    const cEntrega = col(H, 'Fecha de entrega acordada', 'Fecha de Entrega Acordada');
    const cTiempoFila = col(H, 'Tiempo de entrega', 'Tiempo de Entrega', 'Tiempo entrega');
    if (!cRef) return { error: 'La hoja no tiene columna de folio.' };

    const filas = src.rows.filter(r => norm(r[cRef]) === norm(folio));
    if (!filas.length) return { error: 'No se encontró el folio ' + folio + '.' };

    // Catálogo: foto, descripción y medidas por producto (y por variante si coincide)
    const cat = await leer('inventario');
    const mapa = {};
    // Cuando el catálogo no se puede leer, la cotización sale igual pero SIN
    // descripciones, sin medidas y sin las fotos que salen de la liga del
    // catálogo. Hasta ahora salía así, callada, y parecía un problema de fotos.
    //
    // Pasó el 6 de noviembre: a la pestaña "Lista de Precios 2026" le borraron
    // los dos renglones de encabezados (y con ellos los primeros ~250
    // productos), así que el ERP ya no encontraba la columna "Productos" y el
    // catálogo entero quedaba en nada. Eso NO se arregla desde el código: se
    // restaura la hoja. Lo que sí toca al panel es decirlo.
    let problemaCatalogo = '';
    if (cat.headers.length) {
      const K = cat.headers;
      const kProd = col(K, 'Productos', 'Producto');
      if (!kProd) {
        problemaCatalogo = 'La pestaña del catálogo no tiene renglón de encabezados: ' +
          'no se encontró la columna "Productos". Por eso la cotización sale sin ' +
          'descripciones, sin medidas y sin las fotos del catálogo. ' +
          'Hay que restaurar la hoja desde el historial de versiones de Google Sheets. ' +
          'En el renglón de encabezados dice: ' +
          K.filter(Boolean).slice(0, 6).join(' · ');
      }
      const kMat  = col(K, 'Material');
      const kExt  = col(K, 'Material Extra');
      const kFoto = col(K, 'Fotos', 'Foto', 'Imagen');
      const kDesc = col(K, 'Descripción', 'Descripcion');
      const kMed  = col(K, 'Medidas', 'Dimensiones');
      if (kProd) {
        cat.rows.forEach(r => {
          const kTipo = col(K, 'Tipo de Producto', 'Categoria producto', 'Categoría');
          const dato = {
            foto: kFoto ? String(r[kFoto] || '').trim() : '',
            desc: sinOpcionMadera(kDesc ? r[kDesc] : ''),
            med:  kMed ? String(r[kMed] || '').trim() : '',
            cat:  kTipo ? String(r[kTipo] || '').trim() : ''
          };
          if (!dato.foto && !dato.desc && !dato.med && !dato.cat) return;
          const p = norm(r[kProd]);
          if (!p) return;
          // Tres llaves, de la más específica a la más general. Faltaba la de en
          // medio —producto + material, sin el material extra— y por eso un
          // "Escritorio Inca / Nogal" caía al respaldo por producto y se llevaba
          // la descripción del primer Escritorio Inca del catálogo, que puede ser
          // de Rosamorada. La cotización describía otra madera.
          const mat = norm(kMat ? r[kMat] : '');
          const variante = p + '|' + mat + '|' + norm(kExt ? r[kExt] : '');
          if (!mapa[variante]) mapa[variante] = dato;
          if (mat && !mapa[p + '|' + mat]) mapa[p + '|' + mat] = dato;
          // El respaldo por producto se guarda aparte: sirve para la foto, pero
          // su descripción es de OTRO material y no se debe usar como si fuera.
          if (!mapa['solo:' + p]) mapa['solo:' + p] = dato;
        });
      }
    } else {
      problemaCatalogo = 'No se pudo leer el catálogo (la pestaña de la lista de precios ' +
        'vino vacía). La cotización sale sin descripciones, sin medidas y sin las fotos ' +
        'del catálogo.';
    }
    // Se queda vacío aunque la columna sí exista: la hoja perdió sus renglones
    if (!problemaCatalogo && !Object.keys(mapa).length) {
      problemaCatalogo = 'El catálogo se leyó pero no trae ningún producto, así que la ' +
        'cotización sale sin descripciones, sin medidas y sin las fotos del catálogo.';
    }

    let subtotal = 0, envio = 0;
    const items = await Promise.all(filas.map(async (r) => {
      const cant = num(r[cCant]) || 1;
      const pu = num(r[cPU]);
      let pct = cPct ? num(r[cPct]) : 0;
      const dto = (cDto && cDto !== cPct) ? num(r[cDto]) : 0;
      // Google guarda un 10% como 0.1 si la celda tiene formato de porcentaje.
      // Un descuento entre 0 y 1 se entiende como fracción; de 1 para arriba, como
      // porcentaje. Un descuento real del 0.5% es rarísimo y este caso es común.
      if (pct > 0 && pct < 1) pct = pct * 100;
      // El porcentaje y el monto son el MISMO descuento, no dos.
      //
      // En la hoja de VENTAS, "Descuentos" es una columna de fórmula: el
      // resultado del "% descuento" (y además sin IVA). Restarla después de
      // aplicar el porcentaje cobraba el descuento dos veces, así que el PDF de
      // la orden salía más barato que la cotización —en COTIZACIONES esa columna
      // va vacía, por eso la cotización sí cuadraba—. Un 15% sobre $72,000
      // daba $51,889.66 en vez de $61,200. El monto solo manda cuando no hay
      // porcentaje, igual que en el total que se ve en pantalla (`lineTotal`).
      let total = pu * cant;
      if (pct) total = total - (total * pct / 100);
      else if (dto) total = total - dto;
      if (total < 0) total = 0;
      subtotal += total;
      envio += cEnv ? num(r[cEnv]) : 0;

      const p = norm(r[cProd]);
      const matFila = norm(cMat ? r[cMat] : '');
      const clave = p + '|' + matFila + '|' + norm(cExt ? r[cExt] : '');
      // Se busca de lo más específico a lo más general
      const exacto = mapa[clave] || (matFila ? mapa[p + '|' + matFila] : null);
      const soloProducto = mapa['solo:' + p] || null;
      const cd = exacto || soloProducto || { foto: '', desc: '', med: '', cat: '' };
      // Si solo coincidió el producto, la descripción y las medidas son de otra
      // variante: sirven la foto y la categoría, el texto no.
      // Una pieza sobre diseño no vive en el catálogo: su descripción es la que
      // se escribió en la cotización, y no debe avisarse como "falta la variante".
      const sobreDiseno = /sobre dise|pieza especial|a la medida|hecho a medida|personalizad/i
        .test(String(r[cProd] || ''));
      const descConfiable = !!exacto || sobreDiseno;

      // La descripción de la fila manda; si no hay, la del catálogo de ESA variante
      let desc = (cDesc && String(r[cDesc] || '').trim()) ||
                 (descConfiable ? cd.desc : '') || '';
      if (!desc) {
        desc = materialTxt.juntaMaterial(
          cMat ? r[cMat] : '', cExt ? r[cExt] : '', cTela ? r[cTela] : '');
      }
      const med = (cMed && String(r[cMed] || '').trim()) || cd.med || '';
      const cTipoV = col(H, 'Tipo de Producto', 'Tipo de producto');
      let fotoId = null;
      try {
        const f = await fotos.fotoDe(String(r[cProd] || ''), cMat ? String(r[cMat] || '') : '');
        fotoId = f ? f.id : null;
      } catch (e) { fotoId = null; }
      return {
        producto: String(r[cProd] || '').trim(),
        categoria: (cTipoV && String(r[cTipoV] || '').trim()) || cd.cat || '',
        // El segundo material es parte de lo que se vendió, así que va pegado al
        // primero: "Nogal · Piel". Hasta ahora solo aparecía como respaldo cuando
        // el renglón no traía Descripción —y casi siempre la trae, del catálogo—,
        // así que en la práctica nunca salía en el PDF.
        //
        // 10 nov, Camila: "agrego la tela, pero me sigue sin aparecer en el PDF".
        // Faltaba la columna **Tela**: esto decía "Rosamorada · Tela" —el tipo—
        // y nunca "Floriana Beige" —cuál—, que es lo que el cliente aprueba.
        material: materialTxt.juntaMaterial(
          cMat ? r[cMat] : '', cExt ? r[cExt] : '', cTela ? r[cTela] : ''),
        materialExtra: cExt ? String(r[cExt] || '').trim() : '',
        desc: desc,
        medidas: med,
        especificaciones: cEsp ? String(r[cEsp] || '').trim() : '',
        // La foto sale de la carpeta por nombre de archivo —"Producto - Material.png"—
        // y la liga del catálogo queda de respaldo. Las ligas hay que pegarlas a
        // mano en cada renglón y la mayoría eran de "compartir", que devuelven una
        // página de Drive y no la imagen.
        foto: cd.foto,
        fotoDrive: fotoId,
        varianteExacta: descConfiable,
        sobreDiseno: sobreDiseno,
        cantidad: cant,
        precio: pu,
        descPct: pct || 0,
        descMonto: dto || 0,
        total: total,
        // La entrega de ESTE mueble.
        //
        // "Si quisiéramos decirle al cliente que tres piezas se entregan en
        // diciembre y cuatro en febrero, cuando lo convertimos en el PDF no se
        // separan las fechas" (Pau, junta del 10 nov). Las columnas ya existen
        // por renglón —cada mueble puede tener la suya— y el PDF solo imprimía
        // el tiempo de entrega general del primer renglón.
        entrega: (function () {
          const f = cEntrega ? String(r[cEntrega] || '').trim() : '';
          const t = cTiempoFila ? String(r[cTiempoFila] || '').trim() : '';
          return f || t;
        })()
      };
    }));

    const total = subtotal + envio;
    // Entrega inmediata: la pieza está en bodega y se paga completa, así que no
    // hay anticipo ni finiquito que partir. Se decide con el campo "Tiempo de
    // entrega" que ya se captura, para no pedir un dato nuevo.
    const cTiempo = col(H, 'Tiempo de entrega', 'Tiempo de Entrega', 'Tiempo entrega');
    const tiempo = cTiempo ? String(filas[0][cTiempo] || '').trim() : '';
    // La nota de la cotización: lo que se acuerda aparte del mueble —una
    // promoción, un acabado especial, una condición—. Va al final del PDF.
    // 5 nov: hoy se escribe dentro de Especificaciones de un renglón ("*DESCUENTO
    // DEL 20% EXCLUSIVO SET DE SILLAS BUEN FIN 2026"), donde el cliente no la ve
    // y nadie la encuentra después.
    const cNotas = col(H, 'Notas', 'Nota', 'Observaciones', 'Comentarios');
    const notas = cNotas
      ? filas.map(f => String(f[cNotas] || '').trim()).filter(Boolean)
          .filter((t, i, a) => a.indexOf(t) === i).join('\n')
      : '';
    const inmediata = /inmediat/i.test(tiempo);
    // El CP de destino del envío. Se busca con los mismos nombres que acepta el
    // formulario donde se captura: si aquí se buscara distinto, se capturaría y
    // nunca saldría en el PDF.
    const cCP = col(H, 'CP destino', 'CP Destino', 'Código Postal destino',
                    'Codigo Postal destino', 'CP', 'C.P.', 'Código Postal', 'Codigo Postal') ||
                H.filter(h => /c\.?p\.? ?(de )?(destino|envio|envío)|codigo postal|código postal/i
                  .test(String(h)))[0] || null;
    // Limpio: si la columna tiene formato de moneda llega "$ 52,783.00", y si es
    // número el 03100 llega como 3100. Se recupera como cinco dígitos.
    const cpDestino = (function (v) {
      const t = String(v == null ? '' : v).trim();
      if (!t || /[a-zA-Z]/.test(t)) return t;
      const n = parseFloat(t.replace(/[$\s,]/g, ''));
      if (!isFinite(n)) return t;
      const d = String(Math.round(n));
      return d.length < 5 ? ('00000' + d).slice(-5) : d;
    })(cCP ? filas[0][cCP] : '');
    return {
      ok: true,
      folio: folio,
      cliente: String(filas[0][cCli] || '').trim(),
      despacho: String(filas[0][cDesp] || '').trim(),
      // Va al lado del cliente en el PDF. Si la hoja no tiene la columna, no sale.
      proyecto: cProy ? String(filas[0][cProy] || '').trim() : '',
      fecha: String(filas[0][cFec] || '').trim(),
      items: items,
      envio: envio,
      total: total,
      tiempoEntrega: tiempo,
      notas: notas,
      cpDestino: cpDestino,
      entregaInmediata: inmediata,
      // Sin partir el pago cuando es inmediata: el total se paga de una vez
      anticipo: inmediata ? 0 : Math.round(total * 0.6 * 100) / 100,
      finiquito: inmediata ? 0 : Math.round(total * 0.4 * 100) / 100,
      // De dónde salió cada cosa, para cuando algo no se ve en el PDF y hay que
      // saber si el problema es el dato o el nombre de la columna.
      lectura: {
        // De dónde sale el catálogo y qué encontró de cada producto. Cuando una
        // foto no aparece casi nunca falta: es que el nombre no coincide.
        catalogo: {
          archivo: cat.cfg ? ('https://docs.google.com/spreadsheets/d/' + cat.cfg.id + '/edit') : '',
          pestana: cat.cfg ? cat.cfg.sheetName : '(no se pudo leer)',
          // Lo que hay que arreglar en la hoja, dicho en una frase
          problema: problemaCatalogo,
          renglones: cat.rows.length,
          columnaFoto: (cat.headers.length ? (col(cat.headers, 'Fotos', 'Foto', 'Imagen') ||
                        '(NO SE ENCONTRÓ)') : '(sin catálogo)'),
          encabezados: cat.headers.filter(Boolean)
        },
        fotos: await fotos.comoVa(),
        productos: items.map(i => ({
          producto: i.producto, material: i.material,
          // Si la descripción se tomó de otra variante, conviene saberlo
          variante: i.varianteExacta ? 'exacta' : 'solo por producto',
          sobreDiseno: !!i.sobreDiseno,
          tieneFoto: !!(i.fotoDrive || i.foto),
          deLaCarpeta: !!i.fotoDrive,
          // Si no la halló, se dice con qué llave buscó: es lo que hay que igualar
          buscoComo: norm(i.producto) + ' | ' + norm(i.material)
        })),
        columnaPct: cPct || '(no se encontró)',
        columnaDescuento: cDto || '(no se encontró)',
        renglonesConDescuento: items.filter(i => i.descPct || i.descMonto).length,
        columnas: H.filter(Boolean)
      }
    };
  }
}

// La descripción del catálogo suele empezar repitiendo la madera —"Opción madera
// encino negro. Cuenta con un cajón…"— y eso ya va en su propia columna. Se quita
// esa entrada para que la descripción de la cotización empiece por lo que importa.
//
// Esta función se llamaba pero nunca se había escrito: cualquier cotización
// tronaba al llegar aquí y el PDF no se generaba.
function sinOpcionMadera(v) {
  let t = String(v == null ? '' : v).trim();
  if (!t) return '';
  // "Opción madera X." / "Opcion en madera X:" / "Opción X -"  al principio
  t = t.replace(/^\s*opci[oó]n(?:\s+(?:en|de))?\s+(?:madera|material|acabado)?\s*[^.:\-–—]{0,40}\s*[.:\-–—]\s*/i, '');
  // Si quedó vacío es que la descripción era SOLO eso: mejor devolver el original
  // que dejar el renglón en blanco en la cotización.
  t = t.trim();
  if (!t) return String(v == null ? '' : v).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio de la cotización.' });
    const out = await armar(body.key || 'cotizaciones', folio);
    if (out.error) return res.status(400).json({ error: out.error });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
module.exports.armar = armar;
