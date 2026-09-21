// Junta TODO lo necesario para imprimir una cotización: los renglones de ese folio
// más la foto, descripción y medidas que vienen del catálogo.
const core = require('../core');
const fotos = require('../fotos');

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
    if (!cRef) return { error: 'La hoja no tiene columna de folio.' };

    const filas = src.rows.filter(r => norm(r[cRef]) === norm(folio));
    if (!filas.length) return { error: 'No se encontró el folio ' + folio + '.' };

    // Catálogo: foto, descripción y medidas por producto (y por variante si coincide)
    const cat = await leer('inventario');
    const mapa = {};
    if (cat.headers.length) {
      const K = cat.headers;
      const kProd = col(K, 'Productos', 'Producto');
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
      let total = pu * cant;
      if (pct) total = total - (total * pct / 100);
      if (dto) total = total - dto;
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
      const descConfiable = !!exacto;

      // La descripción de la fila manda; si no hay, la del catálogo de ESA variante
      let desc = (cDesc && String(r[cDesc] || '').trim()) ||
                 (descConfiable ? cd.desc : '') || '';
      if (!desc) {
        const partes = [];
        if (cMat && r[cMat]) partes.push(String(r[cMat]).trim());
        if (cExt && r[cExt] && norm(r[cExt]) !== 'na') partes.push(String(r[cExt]).trim());
        if (cTela && r[cTela] && norm(r[cTela]) !== 'no') partes.push(String(r[cTela]).trim().replace(/^s[ií]\s*-\s*/i, ''));
        desc = partes.join('. ');
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
        material: cMat ? String(r[cMat] || '').trim() : '',
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
        cantidad: cant,
        precio: pu,
        descPct: pct || 0,
        descMonto: dto || 0,
        total: total
      };
    }));

    const total = subtotal + envio;
    // Entrega inmediata: la pieza está en bodega y se paga completa, así que no
    // hay anticipo ni finiquito que partir. Se decide con el campo "Tiempo de
    // entrega" que ya se captura, para no pedir un dato nuevo.
    const cTiempo = col(H, 'Tiempo de entrega', 'Tiempo de Entrega', 'Tiempo entrega');
    const tiempo = cTiempo ? String(filas[0][cTiempo] || '').trim() : '';
    const inmediata = /inmediat/i.test(tiempo);
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
