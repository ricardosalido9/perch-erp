// ¿Qué folios tienen su expediente partido en varias carpetas?
//
// 27 nov. Camila: *"cuando subo un cobro con esa característica se hace otra
// carpeta, varios pedidos tienen ya de dos a tres. Dan no encontraba un
// comprobante y estaba pero en otra carpeta del cliente."*
//
// La causa está tapada desde la 582 (ver lib/drive.js), pero las carpetas que
// ya se crearon siguen ahí. Esto las encuentra todas de una pasada, sin
// preguntarle a Drive folio por folio: se listan las carpetas de cada carpeta
// madre —unas pocas consultas— y se agrupan por el folio con el que empiezan.
const core = require('../core');
const drive = require('../drive');
const cf = require('../carpeta-folio');

// Un nombre de carpeta empieza con un folio si arranca con algo tipo "AG8-26"
// y luego viene un espacio, un guion o nada.
const FOLIO = /^([A-Za-z]{1,3}\d{1,3}-\d{2})(?=$|[\s\-_])/;

async function paginar(api, extra) {
  const fuera = [];
  let token = null;
  do {
    const r = await api.files.list(Object.assign({
      fields: 'nextPageToken, files(id, name, webViewLink, createdTime, parents)',
      pageSize: 1000, pageToken: token || undefined,
      supportsAllDrives: true, includeItemsFromAllDrives: true
    }, extra));
    (r.data.files || []).forEach(f => fuera.push(f));
    token = r.data.nextPageToken || null;
  } while (token);
  return fuera;
}

// Las carpetas de un folio NO siempre están donde el ERP guarda hoy: las de la
// AG8-26 de agosto viven en una carpeta madre que ya no está en la
// configuración, y si solo se miran las madres de hoy el reporte dice que todo
// está bien. Así que se barre la **unidad compartida completa** y se filtra por
// el nombre. Si no se puede saber cuál es la unidad, se cae a las madres.
async function todasLasCarpetas(api, madres) {
  const soloCarpetas = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  for (const madre of madres) {
    try {
      const meta = await api.files.get({
        fileId: madre, fields: 'id, driveId', supportsAllDrives: true
      });
      const driveId = meta.data && meta.data.driveId;
      if (driveId) {
        return { lista: await paginar(api, { q: soloCarpetas, corpora: 'drive',
                                             driveId, includeItemsFromAllDrives: true }),
                 donde: 'toda la unidad compartida' };
      }
    } catch (e) { /* se prueba la siguiente madre */ }
  }
  let lista = [];
  for (const madre of madres) {
    lista = lista.concat(await paginar(api, { q: "'" + madre + "' in parents and " + soloCarpetas }));
  }
  return { lista, donde: 'las carpetas de Ventas' };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });
    if (String(ses.rol || '') !== 'admin' && String(ses.rol || '') !== 'comercial') {
      return res.status(403).json({ error: 'Esto lo revisa un admin.' });
    }

    const api = core.getDrive();
    const madres = drive.carpetasEnUso();
    if (!madres.length) return res.status(400).json({ error: 'Drive no está configurado.' });

    const porFolio = {};
    const errores = [];
    let donde = '';
    try {
      const r = await todasLasCarpetas(api, madres);
      donde = r.donde;
      r.lista.forEach(c => {
        const m = FOLIO.exec(String(c.name || '').trim());
        if (!m) return;
        const f = m[1].toUpperCase();
        (porFolio[f] = porFolio[f] || []).push({
          id: c.id, nombre: c.name, madre: (c.parents || [])[0] || '',
          link: c.webViewLink || ('https://drive.google.com/drive/folders/' + c.id),
          creada: c.createdTime || ''
        });
      });
    } catch (e) {
      return res.status(502).json({
        error: 'No se pudo leer las carpetas de Drive.',
        pista: (e && e.message) || String(e) });
    }

    // Solo los partidos, y para cada carpeta cuántos archivos tiene: la que más
    // trae suele ser la buena, y es el dato que hace falta para decidir.
    const partidos = [];
    for (const f of Object.keys(porFolio)) {
      if (porFolio[f].length < 2) continue;
      for (const c of porFolio[f]) {
        try {
          const r = await api.files.list({
            q: "'" + c.id + "' in parents and trashed = false",
            fields: 'files(id)', pageSize: 100,
            supportsAllDrives: true, includeItemsFromAllDrives: true
          });
          c.archivos = (r.data.files || []).length;
        } catch (e) { c.archivos = null; }
      }
      porFolio[f].sort((a, b) => (b.archivos || 0) - (a.archivos || 0));
      partidos.push({ folio: f, carpetas: porFolio[f],
                      archivos: porFolio[f].reduce((s, c) => s + (c.archivos || 0), 0) });
    }
    partidos.sort((a, b) => b.carpetas.length - a.carpetas.length ||
                            a.folio.localeCompare(b.folio));

    // Lo que dice CxC de cada uno: es el nombre que manda, y si trae link ya
    // está resuelto para el panel.
    for (const p of partidos) {
      try {
        const dice = await cf.loQueDiceCxC(p.folio);
        p.cxc = dice ? dice.valor : '';
        p.cxcFila = dice ? dice.fila : null;
        p.tieneLink = !!(dice && cf.idDeCarpeta(dice.valor));
      } catch (e) { p.cxc = ''; }
    }

    return res.status(200).json({
      ok: true,
      folios: Object.keys(porFolio).length,
      partidos: partidos.length,
      carpetasDeMas: partidos.reduce((s, p) => s + p.carpetas.length - 1, 0),
      donde,
      detalle: partidos,
      errores
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || 'Error al revisar las carpetas.' });
  }
};
