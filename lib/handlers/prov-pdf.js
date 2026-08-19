// Arma el estado de cuenta de un proveedor en PDF.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function normaliza(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function colDe(h, ...n) {
  for (const x of n) { const c = h.filter(y => normaliza(y) === normaliza(x))[0]; if (c) return c; }
  return null;
}
// Ventas: para cada folio, a quién va, a dónde y con qué especificaciones
async function datosDeVentas() {
  const cfg = core.areaCfg ? await core.areaCfg('ventas_registro') : core.SHEETS.ventas_registro;
  if (!cfg || !cfg.id) return {};
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return {}; }
  if (!values.length) return {};
  const H = (values[0] || []).map(x => String(x).trim());
  const cRef = colDe(H, 'No. de Referencia', 'Folio');
  const cCli = colDe(H, 'Cliente');
  const cDir = colDe(H, 'Direccion de envio', 'Dirección de envío', 'Dirección de Entrega');
  const cEsp = colDe(H, 'Especificaciones');
  const cTela = colDe(H, 'Tela');
  const cProd = colDe(H, 'Producto');
  const cMat = colDe(H, 'Material');
  const cFe = colDe(H, 'Fecha de entrega acordada');
  const cTel = colDe(H, 'Telefono', 'Teléfono');
  if (!cRef) return {};
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
    const folio = txt(o[cRef]);
    if (!folio) continue;
    if (!out[folio]) out[folio] = {
      cliente: txt(cCli ? o[cCli] : ''), direccion: txt(cDir ? o[cDir] : ''),
      telefono: txt(cTel ? o[cTel] : ''), entrega: txt(cFe ? o[cFe] : ''), lineas: []
    };
    if (!out[folio].direccion && cDir) out[folio].direccion = txt(o[cDir]);
    const prod = txt(cProd ? o[cProd] : '');
    if (prod) out[folio].lineas.push({
      producto: prod, material: txt(cMat ? o[cMat] : ''),
      tela: txt(cTela ? o[cTela] : ''), especificaciones: txt(cEsp ? o[cEsp] : '')
    });
  }
  return out;
}
const invProv = require('./inventario-prov');
const proveedores = require('./proveedores');
const { estadoDeCuenta } = require('../pdf-proveedor');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
               'septiembre','octubre','noviembre','diciembre'];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const quien = String(body.proveedor || '').trim();
    if (!quien) return res.status(400).json({ error: 'Falta el proveedor.' });
    const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const correr = (fn) => new Promise((resolve, reject) => {
      const fake = { status() { return fake; }, json(o) { resolve(o); return fake; } };
      req._body = { token: body.token };
      fn(req, fake).catch(reject);
    });
    const [inv, cta, ventas] = await Promise.all([correr(invProv), correr(proveedores), datosDeVentas()]);

    const p = (inv.proveedores || []).filter(x => norm(x.proveedor) === norm(quien))[0];
    const c = (cta.proveedores || []).filter(x => norm(x.proveedor) === norm(quien))[0];
    if (!p && !c) return res.status(404).json({ error: 'No se encontró a ' + quien + '.' });

    const enBodega = [], porFabricar = [], vendidas = [];
    ((p && p.lineas) || []).forEach(l => {
      (l.pedidos || []).forEach(q => {
        if (q.disponibles > 0) {
          enBodega.push({ producto: l.producto, material: l.material, pedido: q.pedido,
                          piezas: q.disponibles, fecha: q.fecha || '' });
        }
        if (q.porFabricar > 0) {
          porFabricar.push({ producto: l.producto, material: l.material, pedido: q.pedido,
                             piezas: q.porFabricar, estimada: q.estimada || '' });
        }
      });
    });

    // Piezas con folio de cliente que todavía no salen
    ((c && c.pedidos) || []).forEach(d => {
      (d.items || []).forEach(it => {
        const fol = String(it.destino || '').trim();
        if (!fol || ['stock', 'exhibicion', 'exhibición', 'sin asignar'].indexOf(norm(fol)) !== -1) return;
        // Solo va lo que ESTE proveedor todavía tiene que entregar. Antes se calculaba
        // el faltante y luego se imprimía la cantidad original: por eso el estado de
        // cuenta le repetía piezas que ya había entregado.
        const falta = (it.cantidad || 0) - (it.recibidas || 0);
        if (falta <= 0) return;
        const v = ventas[fol] || {};
        // La especificación de ESE mueble en ESA venta
        const ln = (v.lineas || []).filter(l =>
          norm(l.producto) === norm(it.item) &&
          (!l.material || !it.material || norm(l.material) === norm(it.material)))[0] || {};
        const detalle = [];
        if (ln.tela && !/^no$/i.test(ln.tela)) detalle.push('Tela: ' + ln.tela.replace(/^s[ií]\s*-\s*/i, ''));
        if (ln.especificaciones) detalle.push(ln.especificaciones);
        vendidas.push({ producto: it.item, material: it.material, pedido: d.pedido,
                        folio: fol, piezas: falta,
                        cliente: v.cliente || '', direccion: v.direccion || '',
                        telefono: v.telefono || '', entrega: v.entrega || '',
                        detalle: detalle.join(' · ') });
      });
    });

    const saldos = ((c && c.pedidos) || [])
      .filter(d => Math.abs(d.porPagar) > 0.5 || d.pagado > 0)
      .map(d => ({ pedido: d.pedido, fecha: d.fecha || '', costo: d.costo,
                   pagado: d.pagado, porPagar: d.porPagar,
                   // La nota solo va si es para el proveedor: las de control interno no
                   nota: (body.conNotas && d.notaAjuste) ? d.notaAjuste : '' }));

    const hoy = new Date();
    const buf = await estadoDeCuenta({
      proveedor: (p && p.proveedor) || (c && c.proveedor) || quien,
      enBodega, porFabricar, vendidas, saldos,
      totalPorPagar: (c && c.totales) ? c.totales.porPagar : 0
    }, {
      fecha: hoy.getDate() + ' de ' + MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear(),
      nota: 'Cualquier diferencia, avísanos antes de facturar. Los pagos se hacen los días acordados ' +
            'y el finiquito al confirmar la entrega.'
    });

    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      resumen: { enBodega: enBodega.length, porFabricar: porFabricar.length,
                 vendidas: vendidas.length, saldos: saldos.length }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
