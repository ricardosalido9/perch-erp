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
const CFG = require('./config');

// La carpeta se pregunta a la configuración, NO a la variable de entorno.
//
// Aquí estaba el problema de "la cotización sale sin fotos" (Camila, 6 nov):
// este archivo leía `process.env.DRIVE_FOTOS` directo, sin el respaldo que sí
// tiene config.js. Con la variable sin poner en el servidor, el diagnóstico de
// Drive mostraba la carpeta correcta —porque ése sí lee config— y el buscador de
// fotos la tenía vacía, así que NINGÚN mueble encontraba su foto aunque el
// archivo estuviera ahí con el nombre exacto. Se pregunta cada vez, no al cargar
// el archivo, para que no se quede guardado un valor vacío.
function carpetaDeFotos() {
  return String((CFG.ARCHIVOS && CFG.ARCHIVOS.DRIVE_FOTOS) || '').trim();
}

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
// "Banca Coa - Nogal .png" → { producto: 'banca coa', material: 'nogal' }
// Los nombres traen espacios de más y a veces el material lleva paréntesis.
//
// El guion no siempre trae espacio de los dos lados: en la carpeta hay
// "Banca Coa Tejida- Encino Negro.png". Con la regla vieja ese archivo no se
// partía y quedaba archivado como un producto llamado "banca coa tejida- encino
// negro", que no existe, así que esa foto nunca se encontraba. Basta un espacio
// de UN lado. Se exige el espacio para no partir medidas como "170-45".
function partirNombre(archivo) {
  let base = String(archivo || '').replace(/\.(png|jpe?g|webp|gif)$/i, '').trim();
  let partes = base.split(/\s+[-–—]\s+/);
  if (partes.length < 2) partes = base.split(/\s[-–—]|[-–—]\s/);
  if (partes.length < 2) return { producto: norm(base), material: '' };
  const producto = norm(partes[0]);
  const material = norm(partes.slice(1).join(' - '));
  return { producto, material };
}

let _indice = null, _cuando = 0;
const VIGENCIA = 10 * 60 * 1000;      // diez minutos

async function indice() {
  const CARPETA = carpetaDeFotos();
  if (!CARPETA) {
    return { porVariante: {}, porProducto: {}, total: 0, carpeta: '',
             error: 'No está configurada la carpeta de fotos del catálogo.' };
  }
  // Si la carpeta cambió, lo guardado ya no sirve
  if (_indice && _indice.carpeta === CARPETA && (Date.now() - _cuando) < VIGENCIA) return _indice;

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
//
// El catálogo nombra algunas variantes con diagonal —"Banca Coa Tejida/ Kraft"—
// mientras las fotos se llaman "Banca Coa Tejida - Nogal.png". Si el nombre
// completo no coincide se busca lo que va ANTES de la diagonal, que es el mueble.
async function fotoDe(producto, material) {
  const idx = await indice();
  const p = norm(producto);
  if (!p) return null;
  const m = norm(material);
  const busca = (clave) =>
    (m && idx.porVariante[clave + '|' + m]) || idx.porProducto[clave] || null;
  let f = busca(p);
  if (!f && p.indexOf('/') !== -1) f = busca(norm(p.split('/')[0]));
  return f;
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

// Una sola frase que el panel puede mostrar tal cual cuando una cotización sale
// sin fotos. Antes el PDF salía mudo y había que adivinar si era la carpeta, el
// permiso o el nombre del archivo.
async function motivo() {
  const idx = await indice();
  if (!idx.carpeta) {
    return 'No está configurada la carpeta de fotos del catálogo (DRIVE_FOTOS).';
  }
  if (idx.error) {
    let cuenta = '';
    try { cuenta = require('./drive').correoCuenta() || ''; } catch (e) { cuenta = ''; }
    return 'No se pudo leer la carpeta de fotos: ' + idx.error +
           (cuenta ? ' · Revisa que ' + cuenta + ' sea Editor de la carpeta.' : '');
  }
  if (!idx.total) {
    return 'La carpeta de fotos se leyó bien pero está vacía (0 imágenes).';
  }
  return '';   // la carpeta está bien: si falta una foto, es el nombre
}

function olvidar() { _indice = null; _cuando = 0; }

module.exports = { fotoDe, comoVa, motivo, indice, partirNombre, olvidar, carpetaDeFotos };
