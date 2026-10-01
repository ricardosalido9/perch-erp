// Las fotos de los muebles, buscadas por nombre de archivo.
//
// En la carpeta de fotos los archivos se llaman "Producto - Material.png", que es
// exactamente la llave con la que el ERP identifica una variante. Buscar por ahí
// es más confiable que la liga del catálogo: la liga hay que pegarla a mano en
// cada renglón y se rompe sola —la mayoría eran ligas de "compartir", que
// devuelven una página de Drive y no la imagen—.
//
// El índice se arma una vez y se guarda en memoria: la carpeta cambia poco y
// pedirla en cada cotización cuesta tiempo por nada.
const core = require('./core');

const CARPETA = process.env.DRIVE_FOTOS || '';

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
// "Banca Coa - Nogal .png" → { producto: 'banca coa', material: 'nogal' }
// Los nombres traen espacios de más y a veces el material lleva paréntesis.
function partirNombre(archivo) {
  let base = String(archivo || '').replace(/\.(png|jpe?g|webp|gif)$/i, '').trim();
  const partes = base.split(/\s+[-–—]\s+/);
  if (partes.length < 2) return { producto: norm(base), material: '' };
  const producto = norm(partes[0]);
  const material = norm(partes.slice(1).join(' - '));
  return { producto, material };
}

let _indice = null, _cuando = 0;
const VIGENCIA = 10 * 60 * 1000;      // diez minutos

async function indice() {
  if (!CARPETA) return { porVariante: {}, porProducto: {}, total: 0, carpeta: '' };
  if (_indice && (Date.now() - _cuando) < VIGENCIA) return _indice;

  const porVariante = {}, porProducto = {};
  let total = 0, error = '';
  try {
    const d = core.getDrive();
    let pageToken = null;
    do {
      const r = await d.files.list({
        q: "'" + CARPETA + "' in parents and trashed = false and mimeType contains 'image/'",
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 200, pageToken: pageToken || undefined,
        supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      (r.data.files || []).forEach(f => {
        const { producto, material } = partirNombre(f.name);
        if (!producto) return;
        total++;
        const dato = { id: f.id, nombre: f.name, mime: f.mimeType };
        if (material) {
          const k = producto + '|' + material;
          if (!porVariante[k]) porVariante[k] = dato;
        }
        // La primera que aparezca sirve de respaldo cuando el material no coincide
        if (!porProducto[producto]) porProducto[producto] = dato;
      });
      pageToken = r.data.nextPageToken;
    } while (pageToken);
  } catch (e) {
    error = (e && e.message) || String(e);
  }
  _indice = { porVariante, porProducto, total, carpeta: CARPETA, error };
  _cuando = Date.now();
  return _indice;
}

// Busca la foto de un producto con su material. Devuelve el id de Drive o null.
async function fotoDe(producto, material) {
  const idx = await indice();
  const p = norm(producto);
  if (!p) return null;
  const m = norm(material);
  // Primero la variante exacta; si no, cualquier foto de ese producto
  return (m && idx.porVariante[p + '|' + m]) || idx.porProducto[p] || null;
}

// Para los diagnósticos: qué tiene la carpeta y qué no se encontró
async function comoVa() {
  const idx = await indice();
  return {
    carpeta: idx.carpeta || '(sin configurar)',
    liga: idx.carpeta ? ('https://drive.google.com/drive/folders/' + idx.carpeta) : '',
    fotos: idx.total,
    variantes: Object.keys(idx.porVariante).length,
    productos: Object.keys(idx.porProducto).length,
    error: idx.error || ''
  };
}

function olvidar() { _indice = null; _cuando = 0; }

module.exports = { fotoDe, comoVa, indice, partirNombre, olvidar, CARPETA };
