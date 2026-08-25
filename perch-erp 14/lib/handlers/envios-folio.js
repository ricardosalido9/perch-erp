// Documentos del envío por folio de venta: guía y nota de remisión.
// Existe aparte del área de Envíos a propósito: Comercial necesita la liga para
// compartírsela al cliente, pero NO debe ver lo que costó el envío ni su utilidad.
// Por eso aquí solo salen los campos del documento, nunca los de dinero.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    // Quien puede ver las ventas puede ver la guía de esas ventas
    if (!core.puedeVerArea(sesion.rol, 'ventas_registro')) {
      return res.status(403).json({ error: 'Tu usuario no tiene acceso a las ventas.' });
    }

    const cfg = core.areaCfg ? await core.areaCfg('op_envios') : core.SHEETS.op_envios;
    if (!cfg || !cfg.id) return res.status(200).json({ ok: true, envios: {} });

    let values;
    try { values = await core.readRange(cfg.id, cfg.sheetName); }
    catch (e) { return res.status(200).json({ ok: true, envios: {} }); }
    if (!values.length) return res.status(200).json({ ok: true, envios: {} });

    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(x => String(x).trim());
    const col = (...n) => {
      for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
      return null;
    };
    const cFol = col('Pedido', 'Folio');
    if (!cFol) return res.status(200).json({ ok: true, envios: {} });
    const cGuia = col('Guía', 'Guia');
    const cTick = col('Ticket de Remisión', 'Ticket de Remision', 'Nota de remisión');
    const cPaq = col('Paqueteria', 'Paquetería');
    const cSt = col('Status');
    const cReal = col('Fecha de Entrega Real');
    const cEst = col('Fecha Estimada de Entrega');

    const envios = {};
    for (let i = hr + 1; i < values.length; i++) {
      const o = {}; H.forEach((h, j) => { o[h] = values[i][j]; });
      const folio = txt(o[cFol]);
      if (!folio) continue;
      const guia = cGuia ? txt(o[cGuia]) : '';
      const remision = cTick ? txt(o[cTick]) : '';
      const status = cSt ? txt(o[cSt]) : '';
      // Sin documentos y sin status no hay nada útil que mostrar
      if (!guia && !remision && !status) continue;
      (envios[folio] = envios[folio] || []).push({
        guia, remision, status,
        paqueteria: cPaq ? txt(o[cPaq]) : '',
        entregado: cReal ? txt(o[cReal]) : '',
        estimada: cEst ? txt(o[cEst]) : ''
      });
    }

    return res.status(200).json({ ok: true, envios });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
