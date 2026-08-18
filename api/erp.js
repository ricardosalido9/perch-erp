// Punto de entrada único del ERP.
// Vercel cuenta cada archivo de /api como una función serverless, y el plan Hobby
// permite 12. Por eso todas las acciones viven en /lib/handlers y se atienden aquí.
//
// POST /api/erp   con { action: 'data', ... }
// GET  /api/erp?action=funnel-debug&area=cotizaciones
const core = require('../lib/core');

const RUTAS = {
  login:          require('../lib/handlers/login'),
  menu:           require('../lib/handlers/menu'),
  inicio:         require('../lib/handlers/inicio'),
  dashboard:      require('../lib/handlers/dashboard'),
  data:           require('../lib/handlers/data'),
  add:            require('../lib/handlers/add'),
  update:         require('../lib/handlers/update'),
  categories:     require('../lib/handlers/categories'),
  lookup:         require('../lib/handlers/lookup'),
  fill:           require('../lib/handlers/fill'),
  quote:          require('../lib/handlers/quote'),
  'quote-pdf':    require('../lib/handlers/quote-pdf'),
  upload:         require('../lib/handlers/upload'),
  'funnel-debug': require('../lib/handlers/funnel-debug'),
  inspect:        require('../lib/handlers/inspect'),
  'to-sale':      require('../lib/handlers/to-sale'),
  proveedores:    require('../lib/handlers/proveedores'),
  costos:         require('../lib/handlers/costos'),
  pendientes:     require('../lib/handlers/pendientes'),
  'costos-export': require('../lib/handlers/costos-export'),
  version:        require('../lib/handlers/version'),
  'stock-export': require('../lib/handlers/stock-export'),
  folio:          require('../lib/handlers/folio'),
  conciliacion:   require('../lib/handlers/conciliacion'),
  'conci-traza':  require('../lib/handlers/conci-traza'),
  'inv-prov':     require('../lib/handlers/inventario-prov'),
  clientes:       require('../lib/handlers/clientes'),
  csf:            require('../lib/handlers/csf'),
  'prov-export':  require('../lib/handlers/prov-export'),
  memoria:        require('../lib/handlers/memoria'),
  'lookup-debug': require('../lib/handlers/lookup-debug'),
  'pago-traza':   require('../lib/handlers/pago-traza'),
  'prov-pdf':     require('../lib/handlers/prov-pdf'),
  'cta-clientes': require('../lib/handlers/clientes-cuenta'),
  'cxc-notas':    require('../lib/handlers/cxc-notas'),
  facturacion:    require('../lib/handlers/facturacion'),
  cfdi:           require('../lib/handlers/cfdi'),
  'cfdi-prov':    require('../lib/handlers/cfdi-recibidos'),
  'cfdi-traza':   require('../lib/handlers/cfdi-traza'),
  'ingreso-traza':require('../lib/handlers/ingreso-traza'),
  rh:             require('../lib/handlers/rh'),
  'rh-traza':     require('../lib/handlers/rh-traza'),
  'gastos-op':    require('../lib/handlers/gastos-op'),
  efectivo:       require('../lib/handlers/efectivo'),
  impuestos:      require('../lib/handlers/impuestos'),
  cierre:         require('../lib/handlers/cierre'),
  config:         require('../lib/handlers/config'),
  pagos:          require('../lib/handlers/pagos'),
  logistica:      require('../lib/handlers/logistica'),
  logistica:      require('../lib/handlers/logistica'),
  'efe-traza':    require('../lib/handlers/efe-traza')
};

module.exports = async (req, res) => {
  try {
    let body = {};
    try { body = await core.readBody(req); } catch (e) { body = {}; }
    req._body = body || {};                       // para que el handler no relea el stream

    // La acción puede venir en el cuerpo, en la query, o en la ruta (/api/data -> "data").
    // Lo último permite que un navegador con el index.html viejo en caché siga funcionando.
    let accion = String(
      (req.query && req.query.action) || (req._body && req._body.action) || ''
    ).trim();
    if (!accion && req.url) {
      const m = String(req.url).split('?')[0].match(/\/api\/([^/]+)$/);
      if (m && m[1] !== 'erp') accion = decodeURIComponent(m[1]).replace(/\.js$/, '');
    }

    if (!accion) {
      return res.status(400).json({
        error: 'Falta indicar la acción.',
        acciones: Object.keys(RUTAS)
      });
    }
    const handler = RUTAS[accion];
    if (!handler) {
      return res.status(404).json({
        error: 'Acción desconocida: "' + accion + '".',
        acciones: Object.keys(RUTAS)
      });
    }
    return await handler(req, res);
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
