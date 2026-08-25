// Orden de compra de un pedido a proveedor, en PDF.
// Lee los renglones de ese pedido y los arma en el formato de Perch.
const core = require('../core');
const CFG = require('../config');
const { ordenDeCompra } = require('../pdf-orden');

function txt(v) { return String(v == null ? '' : v).trim(); }
function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function col(headers, ...nombres) {
  for (const n of nombres) {
    const h = headers.filter(x => norm(x) === norm(n))[0];
    if (h) return h;
  }
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const pedido = txt(body.pedido);
    if (!pedido) return res.status(400).json({ error: 'Falta el número de pedido.' });

    const cfg = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Producción no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });

    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const cPed = col(H, 'Pedido Proveedor', 'Pedido');
    const cProv = col(H, 'Proveedor');
    const cProd = col(H, 'Producto', 'Productos');
    const cMat = col(H, 'Material');
    const cTela = col(H, 'Tela');
    const cEsp = col(H, 'Especificaciones');
    const cCant = col(H, 'Cantidad');
    const cCU = col(H, 'Costo Unitario');
    const cFec = col(H, 'Fecha');
    const cEst = col(H, 'Fecha Estimada de Entrega');
    const cDest = col(H, 'Destino');
    if (!cPed || !cProd) {
      return res.status(400).json({ error: 'La hoja no tiene columnas de pedido y producto.' });
    }

    const lineas = [];
    let proveedor = '', fecha = '', estimada = '', destinos = {};
    for (let i = hr + 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      if (norm(o[cPed]) !== norm(pedido)) continue;
      const prod = txt(o[cProd]);
      if (!prod) continue;
      if (!proveedor && cProv) proveedor = txt(o[cProv]);
      if (!fecha && cFec) fecha = txt(o[cFec]);
      if (!estimada && cEst) estimada = txt(o[cEst]);
      if (cDest && txt(o[cDest])) destinos[txt(o[cDest])] = 1;
      lineas.push({
        producto: prod,
        material: cMat ? txt(o[cMat]) : '',
        tela: cTela ? txt(o[cTela]) : '',
        especificaciones: cEsp ? txt(o[cEsp]) : '',
        cantidad: cCant ? num(o[cCant]) : 0,
        costo: cCU ? num(o[cCU]) : 0
      });
    }
    if (!lineas.length) {
      return res.status(404).json({ error: 'No se encontró el pedido ' + pedido + '.' });
    }

    const hoy = new Date();
    const buf = await ordenDeCompra({
      pedido: pedido, proveedor: proveedor, fecha: fecha, estimada: estimada,
      lineas: lineas,
      // Si todos los renglones van al mismo lado, se dice; si van a varios, se aclara
      entregarEn: Object.keys(destinos).length === 1 ? Object.keys(destinos)[0] : ''
    }, {
      fecha: hoy.getDate() + ' de ' + MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear(),
      iva: CFG.EMPRESA.iva,
      nota: 'Cualquier cambio de precio o de fecha, avisanos antes de empezar. ' +
            'Al entregar, manda tu remision con este numero de pedido.'
    });

    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      pedido: pedido, proveedor: proveedor, renglones: lineas.length,
      piezas: lineas.reduce((a, l) => a + l.cantidad, 0)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
