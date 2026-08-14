// Arma el estado de cuenta de un proveedor en PDF.
const core = require('../core');
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
    const [inv, cta] = await Promise.all([correr(invProv), correr(proveedores)]);

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
        const falta = (it.cantidad || 0) - (it.recibidas || 0);
        vendidas.push({ producto: it.item, material: it.material, pedido: d.pedido,
                        folio: fol, piezas: it.cantidad });
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
