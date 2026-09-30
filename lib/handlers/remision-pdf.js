// La Remisión de Entrega de un folio, lista para imprimir y firmar.
//
// Sale del mismo cálculo que la cotización, así que los muebles y las medidas
// son los mismos que se le cotizaron al cliente: no se vuelve a capturar nada.
//
//   ?action=remision-pdf  { folio, key }
const core = require('../core');
const CFG = require('../config');
const quote = require('./quote');
const { remisionPDF } = require('../pdf-remision');

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const txt = (v) => String(v == null ? '' : v).trim();

// El teléfono y la dirección del cliente salen de la Lista de Clientes; si no
// está ahí, de la propia venta. Escribirlos a mano en cada remisión es donde se
// cuelan los errores de dirección que acaban en una entrega fallida.
async function datosCliente(nombre) {
  try {
    const cfg = core.areaCfg ? await core.areaCfg('ventas_clientes') : core.SHEETS.ventas_clientes;
    if (!cfg || !cfg.id) return {};
    const values = await core.readRange(cfg.id, await core.resolveSheetName(cfg));
    const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const col = (...n) => { for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; } return null; };
    const cNom = col('Nombre/Razón Social', 'Nombre', 'Cliente');
    const cTel = col('Teléfono', 'Telefono');
    const cDir = col('Dirección de envío', 'Direccion de envio', 'Dirección', 'Direccion');
    if (!cNom) return {};
    for (let i = hr + 1; i < values.length; i++) {
      const o = {}; H.forEach((h, j) => { o[h] = values[i][j]; });
      if (norm(o[cNom]) && norm(o[cNom]) === norm(nombre)) {
        return { telefono: txt(cTel ? o[cTel] : ''), direccion: txt(cDir ? o[cDir] : '') };
      }
    }
  } catch (e) { /* sin datos del cliente, la remisión sale igual */ }
  return {};
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = txt(body.folio);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    // Se le pide al mismo motor que arma la cotización
    let q = null, err = null;
    const captura = { status: (c) => ({ json: (o) => {
      if (c === 200 && o && o.ok) q = o; else err = o; return o; } }) };
    await quote({ _body: { token: body.token, key: body.key || 'ventas_registro', folio } }, captura);
    if (!q) return res.status(400).json({ error: (err && err.error) || 'No se encontró el folio.' });

    const cli = await datosCliente(q.cliente);
    const hoy = new Date();
    const dd = (n) => String(n).padStart(2, '0');

    const buf = await remisionPDF({
      folioRemision: txt(body.folioRemision) || folio,
      fecha: txt(body.fecha) ||
             (dd(hoy.getDate()) + '.' + dd(hoy.getMonth() + 1) + '.' + hoy.getFullYear()),
      cliente: q.despacho ? (q.cliente + ' · ' + q.despacho) : q.cliente,
      telefonoCliente: txt(body.telefono) || cli.telefono || '',
      direccion: txt(body.direccion) || cli.direccion || '',
      items: (q.items || []).map(i => ({
        item: i.producto,
        detalle: [i.material, i.especificaciones].filter(Boolean).join(' · '),
        medidas: i.medidas || '',
        cantidad: i.cantidad
      }))
    }, { telefono: (CFG.EMPRESA && CFG.EMPRESA.telefono) || '' });

    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      nombre: 'Remisión de entrega ' + folio + '.pdf',
      // Para que se vea si faltó algo que hay que completar a mano
      faltan: [!cli.telefono ? 'teléfono del cliente' : '',
               !cli.direccion ? 'dirección de entrega' : ''].filter(Boolean)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
