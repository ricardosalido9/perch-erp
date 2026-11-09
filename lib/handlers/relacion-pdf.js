// Relación de pedidos de un proveedor, en PDF horizontal.
// Reúsa el estado de cuenta (que ya sabe de pedidos, entregas y pagos) y lo
// presenta renglón por renglón, como el control que lleva Nico.
const core = require('../core');
const CFG = require('../config');
const proveedores = require('./proveedores');
const { relacionDeEntregas } = require('../pdf-relacion');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function txt(v) { return String(v == null ? '' : v).trim(); }
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Los datos de la venta que le tocan a cada folio: quién es el cliente
async function clientesPorFolio() {
  const cfg = core.areaCfg ? await core.areaCfg('ventas_registro') : core.SHEETS.ventas_registro;
  if (!cfg || !cfg.id) return {};
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return {}; }
  if (!values.length) return {};
  const H = (values[0] || []).map(x => String(x).trim());
  const col = (...n) => {
    for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
    return null;
  };
  const cRef = col('No. de Referencia', 'Folio');
  const cCli = col('Cliente');
  if (!cRef || !cCli) return {};
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const o = {}; H.forEach((h, j) => { o[h] = values[i][j]; });
    const f = txt(o[cRef]);
    if (f && !out[f]) out[f] = txt(o[cCli]);
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const quien = txt(body.proveedor);
    if (!quien) return res.status(400).json({ error: 'Falta el proveedor.' });

    // Se corre el estado de cuenta y se le pide su respuesta
    const correr = (fn) => new Promise((resolve, reject) => {
      const falso = { status() { return falso; }, json(o) { resolve(o); return falso; } };
      req._body = { token: body.token };
      fn(req, falso).catch(reject);
    });
    const [cta, clientes] = await Promise.all([correr(proveedores), clientesPorFolio()]);
    const p = (cta.proveedores || []).filter(x => norm(x.proveedor) === norm(quien))[0];
    if (!p) return res.status(404).json({ error: 'No se encontró a ' + quien + '.' });

    // "La casilla de Solo lo que nos falta de entregar no nos está filtrando en
    // el PDF" (Nico, 6 nov). Tenía razón: de los tres documentos del proveedor
    // solo la relación para el proveedor hacía caso al filtro de la pantalla.
    // Éste salía siempre completo, con todo lo entregado desde enero.
    //
    // "Pendiente" es lo mismo que marca la pantalla: el pedido sigue abierto
    // (algún renglón sin entregar) y del renglón todavía faltan piezas.
    const soloPend = !!body.soloPendientes;

    // Solo pedidos con movimiento: los vacíos no aportan nada al control
    const pedidos = (p.pedidos || [])
      .filter(d => (d.items || []).length)
      .filter(d => !soloPend || d.abierto)
      .map(d => ({
        pedido: d.pedido, fecha: d.fecha || '', estimada: d.estimada || '',
        pagado: d.pagado || 0,
        lineas: (d.items || []).filter(it => !soloPend || (it.pendientes || 0) > 0).map(it => {
          const folio = txt(it.destino);
          const esCliente = folio && ['stock', 'exhibicion', 'exhibición', 'sin asignar']
            .indexOf(norm(folio)) === -1;
          return {
            folio: esCliente ? folio : 'PERCH',
            cliente: esCliente ? (clientes[folio] || '') : 'Perch',
            producto: it.item, material: it.material,
            cantidad: it.cantidad || 0,
            // El costo del renglón viene como total: se baja a unitario
            costo: (it.cantidad ? (it.costo || 0) / it.cantidad : (it.costo || 0)),
            status: it.status || '',
            entregadas: it.recibidas || 0,
            pendientes: it.pendientes || 0,
            especificaciones: ''
          };
        }),
        // Los pagos del pedido se muestran una vez, en el primer renglón
        pagos: (d.detallePagos || []).slice(0, 4)
          .map(x => ({ monto: x.monto, fecha: x.fecha }))
      }));
    // Un pedido abierto puede quedarse sin renglones pendientes: no se imprime vacío
    const conLineas = pedidos.filter(pd => pd.lineas.length);
    if (conLineas.length) {
      conLineas.forEach(pd => { pd.lineas[0].pagos = pd.pagos; });
    }
    // Que el documento diga con qué filtro salió: si no, no hay forma de saber
    // desde el papel si filtró o si de verdad eso es todo lo que hay.
    const filtro = soloPend
      ? 'Solo lo que falta por entregar.'
      : 'Todos los pedidos, incluidos los ya entregados.';

    const hoy = new Date();
    const buf = await relacionDeEntregas({ proveedor: p.proveedor, pedidos: conLineas }, {
      fecha: hoy.getDate() + ' ' + MESES[hoy.getMonth()] + ', ' + hoy.getFullYear(),
      iva: CFG.EMPRESA.iva,
      hechoPor: txt(body.hechoPor),
      nota: filtro + ' Las piezas en ambar siguen pendientes de entregar.'
    });

    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      proveedor: p.proveedor,
      filtro: filtro,
      soloPendientes: soloPend,
      pedidos: conLineas.length,
      renglones: conLineas.reduce((a, x) => a + x.lineas.length, 0)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
