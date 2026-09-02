// Duplicar una cotización: crea una versión nueva usando la anterior como base.
//
// El caso real: la cotización ya se mandó al cliente y ahora quiere dos piezas en
// vez de una. Editar la original borraría lo que ya se envió, así que se hace una
// nueva con folio propio y se deja la vieja intacta como historia. Las dos quedan
// ligadas por el comentario, para saber cuál nació de cuál.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}

// Lo que NO se copia: el folio nace nuevo, las fechas se ponen al día y el status
// arranca en blanco para que no herede el "Enviada" de la anterior.
const NO_COPIAR = ['No. de Referencia', 'Folio', 'Status', 'Mes', 'Año', 'Trimestre',
                   'Fecha del Cierre', 'Fecha'];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = txt(body.folio);
    if (!folio) return res.status(400).json({ error: 'Falta el folio de la cotización.' });

    const cfg = core.areaCfg ? await core.areaCfg('cotizaciones') : core.SHEETS.cotizaciones;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Cotizaciones no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer Cotizaciones.' });

    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const cRef = col(H, 'No. de Referencia', 'Folio');
    if (!cRef) return res.status(400).json({ error: 'La hoja no tiene columna de folio.' });
    const cCom = col(H, 'Comentarios', 'Notas');

    // Los renglones de esa cotización
    const origen = [];
    for (let i = hr + 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      if (norm(o[cRef]) === norm(folio)) origen.push(o);
    }
    if (!origen.length) {
      return res.status(404).json({ error: 'No se encontró la cotización ' + folio + '.' });
    }

    // Cambios que pide el usuario, por renglón: { 0: { Cantidad: 2 }, ... }
    const cambios = body.cambios || {};
    const nuevos = origen.map((o, i) => {
      const rec = {};
      H.forEach(h => {
        if (NO_COPIAR.some(x => norm(x) === norm(h))) return;
        if (o[h] != null && String(o[h]) !== '') rec[h] = o[h];
      });
      // Se aplican los cambios de ese renglón, si los hay
      const cam = cambios[String(i)] || {};
      Object.keys(cam).forEach(k => {
        const real = H.filter(h => norm(h) === norm(k))[0];
        if (real) rec[real] = cam[k];
      });
      // Puede ser para otro cliente: es común reusar una cotización buena. Si no
      // se cambia, la nueva nace con el nombre del anterior y se pierde de vista.
      const cCli = col(H, 'Cliente');
      const clienteNuevo = txt(body.cliente);
      if (cCli && clienteNuevo) rec[cCli] = clienteNuevo;
      if (cCom) {
        const antes = txt(rec[cCom]);
        rec[cCom] = (antes ? antes + ' · ' : '') + 'Versión nueva de ' + folio +
          (clienteNuevo ? ', ahora para ' + clienteNuevo : '');
      }
      return rec;
    });

    // Renglones que se quitan de la versión nueva
    const quitar = (body.quitar || []).map(x => String(x));
    const aEscribir = nuevos.filter((_, i) => quitar.indexOf(String(i)) === -1);
    // Renglones que se agregan
    (body.agregar || []).forEach(x => {
      const rec = {};
      Object.keys(x).forEach(k => {
        const real = H.filter(h => norm(h) === norm(k))[0];
        if (real) rec[real] = x[k];
      });
      if (Object.keys(rec).length) aEscribir.push(rec);
    });
    if (!aEscribir.length) {
      return res.status(400).json({ error: 'La versión nueva se quedaría sin productos.' });
    }

    const escrito = await core.addRecordsBatch('cotizaciones', aEscribir);
    const folioNuevo = txt(escrito && escrito.folio);

    return res.status(200).json({
      ok: true,
      folioNuevo: folioNuevo,
      renglones: aEscribir.length,
      cliente: txt(body.cliente),
      mensaje: (folioNuevo
        ? 'Se creó ' + folioNuevo + ' con ' + aEscribir.length +
          (aEscribir.length === 1 ? ' producto.' : ' productos.')
        : 'Se creó la versión nueva con ' + aEscribir.length + ' renglones.') +
        (txt(body.cliente) ? ' Para ' + txt(body.cliente) + '.' : ''),
      nota: 'La cotización ' + folio + ' se queda como estaba. Si el cliente se decide ' +
            'por la nueva, cambia el status de la anterior a "Rechazada".'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
