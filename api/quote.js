// Junta TODO lo necesario para imprimir una cotización: los renglones de ese folio
// más la foto, descripción y medidas que vienen del catálogo.
const core = require('../lib/core');

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
  if (!cfg) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
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
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const key = body.key || 'cotizaciones';
    const folio = String(body.folio || '').trim();
    if (!folio) return res.status(400).json({ error: 'Falta el folio de la cotización.' });

    const src = await leer(key);
    if (!src.headers.length) return res.status(400).json({ error: 'No se pudo leer la hoja de ' + key + '.' });

    const H = src.headers;
    const cRef  = col(H, 'No. de Referencia', 'No de Referencia', 'Referencia', 'Folio');
    const cCli  = col(H, 'Cliente');
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
    const cPct  = col(H, '% descuento');
    const cDto  = col(H, 'Descuentos');
    const cEnv  = col(H, 'Envio', 'Envío');
    if (!cRef) return res.status(400).json({ error: 'La hoja no tiene columna de folio.' });

    const filas = src.rows.filter(r => norm(r[cRef]) === norm(folio));
    if (!filas.length) return res.status(404).json({ error: 'No se encontró el folio ' + folio + '.' });

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
          const dato = {
            foto: kFoto ? String(r[kFoto] || '').trim() : '',
            desc: kDesc ? String(r[kDesc] || '').trim() : '',
            med:  kMed ? String(r[kMed] || '').trim() : ''
          };
          if (!dato.foto && !dato.desc && !dato.med) return;
          const p = norm(r[kProd]);
          if (!p) return;
          const variante = p + '|' + norm(kMat ? r[kMat] : '') + '|' + norm(kExt ? r[kExt] : '');
          if (!mapa[variante]) mapa[variante] = dato;
          if (!mapa[p]) mapa[p] = dato;              // respaldo por producto
        });
      }
    }

    let subtotal = 0, envio = 0;
    const items = filas.map(r => {
      const cant = num(r[cCant]) || 1;
      const pu = num(r[cPU]);
      const pct = cPct ? num(r[cPct]) : 0;
      const dto = cDto ? num(r[cDto]) : 0;
      let total = pu * cant;
      if (pct) total = total - (total * pct / 100);
      if (dto) total = total - dto;
      subtotal += total;
      envio += cEnv ? num(r[cEnv]) : 0;

      const p = norm(r[cProd]);
      const clave = p + '|' + norm(cMat ? r[cMat] : '') + '|' + norm(cExt ? r[cExt] : '');
      const cd = mapa[clave] || mapa[p] || { foto: '', desc: '', med: '' };

      // La descripción de la fila manda; si no hay, la del catálogo; si no, se arma con lo que hay
      let desc = (cDesc && String(r[cDesc] || '').trim()) || cd.desc || '';
      if (!desc) {
        const partes = [];
        if (cMat && r[cMat]) partes.push('Opción madera ' + String(r[cMat]).trim());
        if (cExt && r[cExt] && norm(r[cExt]) !== 'na') partes.push(String(r[cExt]).trim());
        if (cTela && r[cTela] && norm(r[cTela]) !== 'no') partes.push('Tapizado en ' + String(r[cTela]).trim());
        desc = partes.join('. ');
      }
      const med = (cMed && String(r[cMed] || '').trim()) || cd.med || '';
      return {
        producto: String(r[cProd] || '').trim(),
        material: cMat ? String(r[cMat] || '').trim() : '',
        desc: desc,
        medidas: med,
        especificaciones: cEsp ? String(r[cEsp] || '').trim() : '',
        foto: cd.foto,
        cantidad: cant,
        precio: pu,
        total: total
      };
    });

    const total = subtotal + envio;
    return res.status(200).json({
      ok: true,
      folio: folio,
      cliente: String(filas[0][cCli] || '').trim(),
      despacho: String(filas[0][cDesp] || '').trim(),
      fecha: String(filas[0][cFec] || '').trim(),
      items: items,
      envio: envio,
      total: total,
      anticipo: Math.round(total * 0.6 * 100) / 100,
      finiquito: Math.round(total * 0.4 * 100) / 100
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
