// Empata las fotos que están en Drive con los productos del catálogo.
//
// La regla: si hay una foto del mueble EN ESE MATERIAL, se usa esa. Si no, se
// deja la que ya estaba. Nunca se pisa una foto buena con una genérica.
//
// Los nombres de archivo que reconoce, en orden de preferencia:
//   Consola Ninfa - Nogal.jpg      producto y material
//   Consola Ninfa Nogal.jpg        lo mismo sin guion
//   Consola Ninfa.jpg              solo el producto, sirve para cualquier material
const core = require('../core');
const CFG = require('../config');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
// Para comparar nombres de archivo con nombres de producto: solo letras y números
function clave(s) {
  return norm(s).replace(/[^a-z0-9]/g, '');
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}

// Recorre una carpeta de Drive y devuelve todas las imágenes, entrando también
// a las subcarpetas: Pau las tiene ordenadas por producto.
async function listarFotos(drive, carpetaId, hasta, nivel) {
  const out = [];
  if (nivel > 3) return out;
  let pageToken = null;
  do {
    const r = await drive.files.list({
      q: "'" + carpetaId + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, thumbnailLink)',
      pageSize: 200, pageToken: pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true
    });
    for (const f of (r.data.files || [])) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        const dentro = await listarFotos(drive, f.id, hasta, nivel + 1);
        // La carpeta que las contiene suele ser el nombre del producto
        dentro.forEach(x => { x.carpeta = x.carpeta || f.name; out.push(x); });
      } else if (/^image\//.test(f.mimeType || '')) {
        out.push({ id: f.id, nombre: f.name, carpeta: '',
                   link: f.webViewLink || ('https://drive.google.com/uc?id=' + f.id) });
      }
      if (out.length >= hasta) break;
    }
    pageToken = r.data.nextPageToken;
  } while (pageToken && out.length < hasta);
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const carpetaId = txt(body.carpeta) || CFG.ARCHIVOS.DRIVE_FOTOS;
    if (!carpetaId) {
      return res.status(400).json({
        error: 'No está configurada la carpeta de fotos.',
        pista: 'Pon la variable DRIVE_FOTOS con el id de la carpeta.'
      });
    }

    let drive;
    try { drive = core.getDrive(); }
    catch (e) { return res.status(400).json({ error: 'No se pudo conectar a Drive.', detalle: e.message }); }

    let fotos;
    try { fotos = await listarFotos(drive, carpetaId, 2000, 0); }
    catch (e) {
      return res.status(400).json({
        error: 'No se pudo leer la carpeta de fotos.',
        pista: 'Compártela con la cuenta de servicio, con permiso de Lector o Editor.',
        detalle: (e && e.message) || ''
      });
    }

    // El catálogo: producto, material y la foto que ya tiene
    const cfg = core.areaCfg ? await core.areaCfg('inventario') : core.SHEETS.inventario;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'El catálogo no está conectado.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer el catálogo.' });
    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const cProd = col(H, 'Productos', 'Producto');
    const cMat = col(H, 'Material');
    const cFoto = col(H, 'Foto', 'Imagen', 'Link foto', 'Foto del producto');
    if (!cProd) return res.status(400).json({ error: 'El catálogo no tiene columna de producto.' });

    // Índice de fotos por clave
    const porProductoMaterial = {}, porProducto = {};
    fotos.forEach(f => {
      const sinExt = String(f.nombre).replace(/\.[a-z0-9]+$/i, '');
      // "Consola Ninfa - Nogal" -> producto y material
      const partes = sinExt.split(/\s*[-–_]\s*/);
      if (partes.length >= 2) {
        const k = clave(partes[0]) + '|' + clave(partes.slice(1).join(' '));
        if (!porProductoMaterial[k]) porProductoMaterial[k] = f;
      }
      const kp = clave(sinExt);
      if (!porProducto[kp]) porProducto[kp] = f;
      // Si vino de una subcarpeta, esa carpeta suele ser el producto
      if (f.carpeta) {
        const kc = clave(f.carpeta) + '|' + clave(sinExt);
        if (!porProductoMaterial[kc]) porProductoMaterial[kc] = f;
        const kc2 = clave(f.carpeta);
        if (!porProducto[kc2]) porProducto[kc2] = f;
      }
    });

    const propuestas = [];
    let conFoto = 0, sinFoto = 0, seRespeta = 0;
    for (let i = hr + 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      const producto = txt(o[cProd]);
      if (!producto) continue;
      const material = cMat ? txt(o[cMat]) : '';
      const actual = cFoto ? txt(o[cFoto]) : '';

      const kExacta = clave(producto) + '|' + clave(material);
      const hit = porProductoMaterial[kExacta] || porProducto[clave(producto)] || null;
      const exacta = !!porProductoMaterial[kExacta];

      if (actual) {
        seRespeta++;
        // Ya tiene foto: solo se propone cambiarla si aparece una del material exacto
        if (exacta && porProductoMaterial[kExacta].link !== actual) {
          propuestas.push({
            fila: i + 1, producto, material, actual,
            propuesta: porProductoMaterial[kExacta].link,
            archivo: porProductoMaterial[kExacta].nombre,
            porQue: 'Hay una foto de este mueble en este material; la de ahora es de otro.',
            cambia: true
          });
        }
        continue;
      }
      if (hit) {
        conFoto++;
        propuestas.push({
          fila: i + 1, producto, material, actual: '',
          propuesta: hit.link, archivo: hit.nombre,
          porQue: exacta ? 'Foto de este mueble en este material.'
                         : 'No hay foto de este material; se usa la del mueble.',
          exacta: exacta, cambia: false
        });
      } else {
        sinFoto++;
      }
    }

    return res.status(200).json({
      ok: true,
      fotosEnDrive: fotos.length,
      renglonesDelCatalogo: Math.max(0, values.length - hr - 1),
      seRespetaLaQueYaTenia: seRespeta,
      seLlenarian: conFoto,
      siguenSinFoto: sinFoto,
      columnaFoto: cFoto || '(NO ESTÁ)',
      // Si no hay columna de foto, no hay dónde escribir
      aviso: cFoto ? '' : 'El catálogo no tiene columna de foto. Agrégale una que se ' +
        'llame "Foto" para poder guardar las ligas.',
      propuestas: propuestas.slice(0, 500)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
