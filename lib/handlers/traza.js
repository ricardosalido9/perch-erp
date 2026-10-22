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

const MESES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
// Sheets devuelve algunas fechas como número de serie (46300 = 30 sep 2026).
// Mostrarlo tal cual se lee como un importe y confunde.
function fecha(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    if (!isNaN(d.getTime())) {
      return d.getUTCDate() + ' ' + MESES_ES[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }
  }
  return t;
}
// La fecha como número, para poder ordenar. Acepta las tres formas que conviven
// en la hoja: el serial de Sheets, "7 octubre 2026" y 07/10/2026.
function aOrden(v) {
  if (v instanceof Date) return v.getTime();
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  if (/^\d{4,6}$/.test(t)) return Date.UTC(1899, 11, 30) + Number(t) * 86400000;
  const m1 = t.toLowerCase().match(
    /^(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)\s*(?:de\s+)?(\d{4})$/);
  if (m1) {
    const mes = MESES_ES.findIndex(x => x.indexOf(m1[2].slice(0, 3)) === 0);
    if (mes >= 0) return Date.UTC(Number(m1[3]), mes, Number(m1[1]));
  }
  const m2 = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m2) {
    const a = Number(m2[3]) < 100 ? 2000 + Number(m2[3]) : Number(m2[3]);
    return Date.UTC(a, Number(m2[2]) - 1, Number(m2[1]));
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
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

    const [ped, ent, sal, cat, ven] = await Promise.all([
      leer('prov_pedidos'), leer('prov_entradas'), leer('prov_salidas'), leer('inventario'),
      leer('ventas_registro')
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
        if (eF && txt(r[eF])) e.fechas.push(fecha(r[eF]));
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
          cantidad: c, fecha: sF ? fecha(r[sF]) : ''
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
        fechaPedido: pF ? fecha(r[pF]) : '',
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

    // ===== La historia por VENTA =====
    //
    // La vista "por venta" se armaba solo con lo que había SALIDO de bodega, así
    // que una venta sin surtir no existía y el orden era alfabético: O1-26 antes
    // que S27-26. Ahora manda la hoja de ventas: salen todas, de la más nueva a
    // la más vieja, con lo que se vendió, lo que costó y lo que dejó.
    const ventas = [];
    if (ven.headers.length) {
      const vF = col(ven.headers, 'No. de Referencia', 'Folio');
      const vC = col(ven.headers, 'Cliente');
      const vFe = col(ven.headers, 'Fecha del Cierre', 'Fecha');
      const vP = col(ven.headers, 'Producto', 'Productos');
      const vM = col(ven.headers, 'Material');
      const vME = col(ven.headers, 'Material Extra');
      const vQ = col(ven.headers, 'Cantidad');
      const vPU = col(ven.headers, 'Precio Unitario');
      const vPct = col(ven.headers, '% descuento', '% Descuento', 'Descuento %');
      const vDto = col(ven.headers, 'Descuentos');
      const vSt = col(ven.headers, 'Status');

      // Lo que salió de bodega hacia cada venta, con su costo real
      const salidoA = {};
      if (sal.headers.length) {
        const sFol = col(sal.headers, 'Folio', 'Folio cliente');
        const sI = col(sal.headers, 'Producto', 'Productos', 'Item');
        const sM = col(sal.headers, 'Material');
        const sC = col(sal.headers, 'Cantidad');
        const sCU = col(sal.headers, 'Costo Unitario');
        const sPed = col(sal.headers, 'Pedido Proveedor', 'Pedido');
        const sPrv = col(sal.headers, 'Proveedor');
        if (sFol && sI) sal.rows.forEach(r => {
          const k = norm(r[sFol]) + '|' + norm(r[sI]);
          const o = salidoA[k] = salidoA[k] || { cant: 0, costo: 0, origenes: [] };
          const c = sC ? num(r[sC]) : 0;
          const cu = sCU ? num(r[sCU]) : 0;
          o.cant += c; o.costo += c * cu;
          o.origenes.push({ pedido: sPed ? txt(r[sPed]) : '',
                            proveedor: sPrv ? txt(r[sPrv]) : '',
                            material: sM ? txt(r[sM]) : '',
                            cantidad: c, costoUnitario: cu });
        });
      }
      // El costo que el catálogo propone, para estimar lo que todavía no se surte
      const costoCat = {};
      if (cat.headers.length) {
        const kP = col(cat.headers, 'Productos', 'Producto');
        const kM = col(cat.headers, 'Material');
        const kC = col(cat.headers, 'Costos Total', 'Costo Unitario', 'Costo');
        if (kP && kC) cat.rows.forEach(r => {
          const k = norm(r[kP]) + '|' + norm(kM ? r[kM] : '');
          if (!costoCat[k]) costoCat[k] = num(r[kC]);
          if (!costoCat[norm(r[kP])]) costoCat[norm(r[kP])] = num(r[kC]);
        });
      }

      const porFolio = {};
      if (vF && vP) ven.rows.forEach((r, i) => {
        const folio = txt(r[vF]);
        const prod = txt(r[vP]);
        if (!folio || !prod) return;
        const g = porFolio[norm(folio)] = porFolio[norm(folio)] ||
          { folio, cliente: txt(vC ? r[vC] : ''), fecha: fecha(vFe ? r[vFe] : ''),
            status: txt(vSt ? r[vSt] : ''), _orden: aOrden(vFe ? r[vFe] : ''), _fila: i,
            productos: [] };
        if (i > g._fila) g._fila = i;
        const cant = vQ ? num(r[vQ]) : 0;
        const precio = vPU ? num(r[vPU]) : 0;
        let importe = cant * precio;
        let pct = vPct ? num(r[vPct]) : 0;
        if (pct > 0 && pct < 1) pct = pct * 100;
        if (pct) importe -= importe * pct / 100;
        else if (vDto && vDto !== vPct) importe -= num(r[vDto]);
        g.productos.push({
          producto: prod, material: txt(vM ? r[vM] : ''),
          materialExtra: txt(vME ? r[vME] : ''),
          vendidas: cant, precio, importe: Math.round(importe * 100) / 100,
          descuentoPct: pct || 0,
          foto: fotos[norm(prod) + '|' + norm(vM ? r[vM] : '')] || fotos[norm(prod)] || ''
        });
      });

      Object.keys(porFolio).forEach(k => {
        const v = porFolio[k];
        let venta = 0, costo = 0, estimado = false, surtidasTot = 0, vendidasTot = 0;
        v.productos.forEach(p => {
          const sa = salidoA[norm(v.folio) + '|' + norm(p.producto)] ||
                     { cant: 0, costo: 0, origenes: [] };
          p.surtidas = Math.round(sa.cant);
          p.origenes = sa.origenes;
          // El costo de lo que ya salió es el de verdad. Lo que falta por surtir
          // se estima con el catálogo, y se dice que es estimado: una utilidad
          // que no avisa que está a medias es peor que no darla.
          const faltan = Math.max(0, p.vendidas - p.surtidas);
          const cEst = faltan * (costoCat[norm(p.producto) + '|' + norm(p.material)] ||
                                 costoCat[norm(p.producto)] || 0);
          if (faltan > 0) estimado = true;
          p.costo = Math.round((sa.costo + cEst) * 100) / 100;
          p.costoEstimado = faltan > 0;
          p.utilidad = Math.round((p.importe - p.costo) * 100) / 100;
          p.margen = p.importe ? Math.round((p.utilidad / p.importe) * 1000) / 10 : 0;
          venta += p.importe; costo += p.costo;
          surtidasTot += p.surtidas; vendidasTot += p.vendidas;
        });
        venta = Math.round(venta * 100) / 100;
        costo = Math.round(costo * 100) / 100;
        ventas.push(Object.assign(v, {
          totales: { venta, costo,
                     utilidad: Math.round((venta - costo) * 100) / 100,
                     margen: venta ? Math.round(((venta - costo) / venta) * 1000) / 10 : 0,
                     estimado, vendidas: vendidasTot, surtidas: surtidasTot },
          // Para el botón "Surtir": si ya está todo, no hace falta
          faltaSurtir: vendidasTot - surtidasTot > 0
        }));
      });
      // De la más nueva a la más vieja. Si la fecha no se puede leer, el orden de
      // la hoja desempata, que también va de lo viejo a lo nuevo.
      ventas.sort((a, b) => (b._orden - a._orden) || (b._fila - a._fila));
    }

    const suma = (f) => piezas.reduce((a, x) => a + (x[f] || 0), 0);
    return res.status(200).json({
      ok: true,
      piezas,
      ventas,
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
