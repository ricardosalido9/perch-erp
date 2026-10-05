// De dónde salió cada pieza y a dónde se fue.
//
// Hoy esa historia está repartida en tres hojas: el pedido dice a quién se le
// compró, la entrada dice cuándo llegó, y la salida a qué venta se mandó. Para
// seguir una pieza hay que abrir las tres y cruzarlas a mano.
//
// Esto las junta en un solo renglón por pieza: proveedor y pedido de un lado,
// destino del otro —el cliente que se la llevó, o "en stock" si sigue en bodega—.
//
//   ?action=traza&pedido=PCH-T-011&proveedor=TANDEM
const core = require('../core');

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers: H, rows };
}
// Un renglón del pedido se identifica por pedido + producto + material
const clave = (ped, prod, mat) => norm(ped) + '|' + norm(prod) + '|' + norm(mat);
const esSoloSaldo = (n) => /^\s*saldo inicial del corte/i.test(String(n || ''));

module.exports = async (req, res) => {
  try {
    const body = Object.assign({}, req.query || {}, await core.readBody(req));
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ped, ent, sal, cat] = await Promise.all([
      leer('prov_pedidos'), leer('prov_entradas'), leer('prov_salidas'), leer('inventario')
    ]);
    if (!ped.headers.length) return res.status(400).json({ error: 'No se pudo leer los pedidos.' });

    // La foto del catálogo, para que la pieza se vea y no solo se lea
    const fotos = {};
    if (cat.headers.length) {
      const kP = col(cat.headers, 'Productos', 'Producto');
      const kM = col(cat.headers, 'Material');
      const kF = col(cat.headers, 'Fotos', 'Foto', 'Imagen');
      if (kP && kF) cat.rows.forEach(r => {
        const f = txt(r[kF]);
        if (!f) return;
        const k = norm(r[kP]) + '|' + norm(kM ? r[kM] : '');
        if (!fotos[k]) fotos[k] = f;
        const soloProd = norm(r[kP]);
        if (!fotos[soloProd]) fotos[soloProd] = f;
      });
    }

    const pP = col(ped.headers, 'Pedido Proveedor', 'Pedido');
    const pPr = col(ped.headers, 'Proveedor');
    const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
    const pM = col(ped.headers, 'Material');
    const pC = col(ped.headers, 'Cantidad');
    const pCU = col(ped.headers, 'Costo Unitario');
    const pF = col(ped.headers, 'Fecha');
    const pFol = col(ped.headers, 'Folio cliente');
    const pSt = col(ped.headers, 'Status');

    // Lo que ya llegó y lo que ya salió, por renglón de pedido
    const entradas = {}, salidas = {};
    if (ent.headers.length) {
      const eP = col(ent.headers, 'Pedido Proveedor', 'Pedido');
      const eI = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eC = col(ent.headers, 'Cantidad');
      const eF = col(ent.headers, 'Fecha');
      if (eP && eI) ent.rows.forEach(r => {
        const k = clave(r[eP], r[eI], eM ? r[eM] : '');
        const e = entradas[k] = entradas[k] || { cant: 0, fechas: [] };
        e.cant += eC ? num(r[eC]) : 0;
        if (eF && txt(r[eF])) e.fechas.push(txt(r[eF]));
      });
    }
    if (sal.headers.length) {
      const sP = col(sal.headers, 'Pedido Proveedor', 'Pedido');
      const sI = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sC = col(sal.headers, 'Cantidad');
      const sFol = col(sal.headers, 'Folio', 'Folio cliente');
      const sCli = col(sal.headers, 'Cliente');
      const sF = col(sal.headers, 'Fecha de cierre de venta', 'Fecha');
      if (sP && sI) sal.rows.forEach(r => {
        const k = clave(r[sP], r[sI], sM ? r[sM] : '');
        const s2 = salidas[k] = salidas[k] || { cant: 0, destinos: [] };
        const c = sC ? num(r[sC]) : 0;
        s2.cant += c;
        s2.destinos.push({
          folio: sFol ? txt(r[sFol]) : '', cliente: sCli ? txt(r[sCli]) : '',
          cantidad: c, fecha: sF ? txt(r[sF]) : ''
        });
      });
    }

    const filtroPed = norm(body.pedido || '');
    const filtroProv = norm(body.proveedor || '');
    const piezas = [];
    ped.rows.forEach(r => {
      const prod = txt(pI ? r[pI] : '');
      if (!prod || esSoloSaldo(prod)) return;          // deuda, no mueble
      const pedido = txt(pP ? r[pP] : '');
      const prov = txt(pPr ? r[pPr] : '');
      if (filtroPed && norm(pedido).indexOf(filtroPed) === -1) return;
      if (filtroProv && norm(prov).indexOf(filtroProv) === -1) return;
      const mat = txt(pM ? r[pM] : '');
      const k = clave(pedido, prod, mat);
      const pedidas = pC ? num(r[pC]) : 0;
      const llegaron = (entradas[k] || {}).cant || 0;
      const salieron = (salidas[k] || {}).cant || 0;
      const enStock = llegaron - salieron;
      piezas.push({
        pedido, proveedor: prov, producto: prod, material: mat,
        foto: fotos[norm(prod) + '|' + norm(mat)] || fotos[norm(prod)] || '',
        costoUnitario: pCU ? num(r[pCU]) : 0,
        fechaPedido: pF ? txt(r[pF]) : '',
        statusPedido: pSt ? txt(r[pSt]) : '',
        folioOriginal: pFol ? txt(r[pFol]) : '',
        pedidas, llegaron, salieron,
        enStock: enStock > 0 ? enStock : 0,
        porLlegar: pedidas - llegaron > 0 ? pedidas - llegaron : 0,
        // A dónde se fue cada pieza que salió
        destinos: (salidas[k] || {}).destinos || [],
        fechaEntrada: ((entradas[k] || {}).fechas || [])[0] || ''
      });
    });

    const suma = (f) => piezas.reduce((a, x) => a + (x[f] || 0), 0);
    return res.status(200).json({
      ok: true,
      piezas,
      totales: {
        lineas: piezas.length, pedidas: suma('pedidas'), llegaron: suma('llegaron'),
        salieron: suma('salieron'), enStock: suma('enStock'), porLlegar: suma('porLlegar')
      },
      pedidos: Array.from(new Set(piezas.map(p => p.pedido).filter(Boolean))).sort(),
      proveedores: Array.from(new Set(piezas.map(p => p.proveedor).filter(Boolean))).sort()
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
