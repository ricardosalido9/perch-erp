// Escribe el estado de cuenta de proveedores en el archivo consolidado, en dos pestañas:
//   "Proveedores"          -> un renglón por proveedor
//   "Proveedores detalle"  -> un renglón por PEDIDO, con su costo, sus pagos y su saldo
// Sirve para comparar contra el control interno y ver dónde está la diferencia.
const core = require('../core');
const proveedores = require('./proveedores');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const datos = await new Promise((resolve, reject) => {
      const fake = { status() { return fake; }, json(o) { resolve(o); return fake; } };
      req._body = { token: body.token };
      proveedores(req, fake).catch(reject);
    });
    if (datos.error) return res.status(400).json({ error: datos.error });

    const P = datos.proveedores || [];
    const red = (n) => Math.round((n || 0) * 100) / 100;

    const cab = ['Proveedor', 'Pedidos', 'Piezas', 'Por llegar',
      'Le he pedido', 'Le he pagado', 'De eso, ajustes', 'Saldo',
      'Pedidos abiertos', 'Pedido (solo abiertos)', 'Pagado (solo abiertos)', 'Saldo (solo abiertos)'];
    const filas = [cab];
    P.forEach(p => {
      const t = p.totales, a = p.abiertos || {};
      filas.push([p.proveedor, t.pedidos, t.piezas, t.pendientes,
        red(t.costo), red(t.pagado), red(t.ajustes), red(t.porPagar),
        a.pedidos || 0, red(a.costo), red(a.pagado), red(a.porPagar)]);
    });

    const cab2 = ['Proveedor', 'Pedido', 'Fecha', 'Status', '¿Abierto?', 'Piezas', 'Recibidas',
      'Por llegar', 'Costo del pedido', 'Pagado', 'De eso, ajustes', 'Saldo', 'Núm. de pagos'];
    const det = [cab2];
    P.forEach(p => {
      (p.pedidos || []).forEach(d => {
        det.push([p.proveedor, d.pedido, d.fecha || '', d.status || '',
          d.abierto ? 'Sí' : 'No', d.piezas, d.recibidas, d.pendientes,
          red(d.costo), red(d.pagado), red(d.ajustes), red(d.porPagar), d.pagos || 0]);
      });
    });

    const cab3 = ['Proveedor', 'Pedido', 'Fecha del pago', 'Concepto', 'Descripción',
      'Cuenta', 'Monto', '¿Es ajuste?'];
    const pagos = [cab3];
    P.forEach(p => {
      (p.pedidos || []).forEach(d => {
        (d.detallePagos || []).forEach(g => {
          pagos.push([p.proveedor, d.pedido, g.fecha || '', g.concepto || '', g.descripcion || '',
            g.cuenta || g.metodo || '', red(g.monto), g.ajuste ? 'Sí' : 'No']);
        });
      });
    });

    const cfg = core.areaCfg ? await core.areaCfg('op_stock') : core.SHEETS.op_stock;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'No está configurado el archivo consolidado.' });
    await core.escribirTabla(cfg.id, 'Proveedores', filas);
    await core.escribirTabla(cfg.id, 'Proveedores detalle', det);
    await core.escribirTabla(cfg.id, 'Proveedores pagos', pagos);

    return res.status(200).json({
      ok: true, proveedores: filas.length - 1, pedidos: det.length - 1, pagos: pagos.length - 1,
      archivo: 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
