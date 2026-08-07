// Estado de cuenta por proveedor.
// Junta tres cosas que hoy viven separadas:
//   Pedidos a Proveedores  -> qué se le pidió (pedido general, con sus muebles)
//   Entradas de Inventario -> qué ya llegó de ese pedido
//   EGRESOS                -> qué se le ha pagado (ligado por Pedido)
// El resultado es: proveedor > pedido > muebles, con pagado y por pagar.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
// Los montos vienen como  -$ 1,234.00-  (los guiones de los extremos son formato)
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(headers, ...nombres) {
  for (const n of nombres) {
    const h = headers.filter(x => norm(x) === norm(n))[0];
    if (h) return h;
  }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id || /^PEGAR_/.test(cfg.id)) return { headers: [], rows: [], falta: true };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ped, ent, egr] = await Promise.all([leer('prov_pedidos'), leer('prov_entradas'), leer('fin_egresos')]);
    if (ped.falta) {
      return res.status(400).json({
        error: 'Falta el id del archivo de Operación 2026 en lib/core.js (prov_pedidos).',
        pista: 'Sustituye PEGAR_ID_OPERACION_2026 por el id que sale en la URL del archivo.'
      });
    }
    if (!ped.headers.length) return res.status(400).json({ error: 'No se pudo leer "Pedidos a Proveedores".' });

    const H = ped.headers;
    const cProv = col(H, 'Proveedor');
    const cPed  = col(H, 'Pedido Proveedor', 'Pedido');
    const cItem = col(H, 'Item', 'Producto');
    const cMat  = col(H, 'Material');
    const cCant = col(H, 'Cantidad');
    const cCU   = col(H, 'Costo Unitario');
    const cCT   = col(H, 'Costo Total + IVA', 'Costo Total');
    const cSt   = col(H, 'Status');
    const cFol  = col(H, 'Folio cliente', 'Folio Cliente', 'Pedido Cliente');
    const cFec  = col(H, 'Fecha');
    const cEst  = col(H, 'Fecha Estimada de Entrega', 'Fecha estimada de entrega');
    if (!cProv || !cPed) return res.status(400).json({ error: 'Faltan las columnas Proveedor y Pedido Proveedor.' });

    // Lo que ya llegó, por pedido de proveedor + item + material
    const entradas = {};
    if (ent.headers.length) {
      const eP = col(ent.headers, 'Pedido Proveedor', 'Pedido');
      const eI = col(ent.headers, 'Item', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eC = col(ent.headers, 'Cantidad');
      if (eP) ent.rows.forEach(r => {
        const k = norm(r[eP]) + '|' + norm(eI ? r[eI] : '') + '|' + norm(eM ? r[eM] : '');
        entradas[k] = (entradas[k] || 0) + (eC ? num(r[eC]) : 0);
      });
    }

    // Lo que ya se pagó, por pedido de proveedor
    const pagos = {};
    if (egr.headers.length) {
      const gP = col(egr.headers, 'Pedido');
      const gT = col(egr.headers, 'Total');
      const gPr = col(egr.headers, 'Proveedor');
      const gF = col(egr.headers, 'Fecha', 'Fecha ');
      const gC = col(egr.headers, 'Concepto');
      const gD = col(egr.headers, 'Descripción', 'Descripcion');
      const gM = col(egr.headers, 'Método de pago', 'Metodo de pago');
      const gCu = col(egr.headers, 'Cuenta');
      if (gP && gT) egr.rows.forEach(r => {
        const k = norm(r[gP]);
        if (!k) return;
        if (!pagos[k]) pagos[k] = { monto: 0, n: 0, prov: gPr ? txt(r[gPr]) : '', detalle: [] };
        const m = num(r[gT]);
        pagos[k].monto += m;
        pagos[k].n++;
        // Máximo 20 pagos por pedido, para no inflar la respuesta
        if (pagos[k].detalle.length < 20) {
          pagos[k].detalle.push({
            fecha: gF ? txt(r[gF]) : '', monto: m,
            concepto: gC ? txt(r[gC]) : '', descripcion: gD ? txt(r[gD]) : '',
            metodo: gM ? txt(r[gM]) : '', cuenta: gCu ? txt(r[gCu]) : ''
          });
        }
      });
    }

    // proveedor > pedido > muebles
    const provs = {};
    ped.rows.forEach(r => {
      const prov = txt(r[cProv]);
      const pedido = txt(r[cPed]);
      if (!prov && !pedido) return;
      const kp = prov || 'Sin proveedor';
      if (!provs[kp]) provs[kp] = { proveedor: kp, pedidos: {} };
      const kd = pedido || '(sin pedido)';
      if (!provs[kp].pedidos[kd]) {
        provs[kp].pedidos[kd] = {
          pedido: kd, fecha: cFec ? txt(r[cFec]) : '', estimada: cEst ? txt(r[cEst]) : '',
          items: [], costo: 0, piezas: 0, recibidas: 0
        };
      }
      const d = provs[kp].pedidos[kd];
      const cant = cCant ? num(r[cCant]) : 0;
      const costo = cCT ? num(r[cCT]) : (cCU ? num(r[cCU]) * cant : 0);
      const llego = entradas[norm(pedido) + '|' + norm(cItem ? r[cItem] : '') + '|' + norm(cMat ? r[cMat] : '')] || 0;
      d.items.push({
        item: cItem ? txt(r[cItem]) : '', material: cMat ? txt(r[cMat]) : '',
        cantidad: cant, recibidas: llego, pendientes: Math.max(0, cant - llego),
        costo: costo, status: cSt ? txt(r[cSt]) : '',
        // El destino puede ser un cliente, o stock/showroom
        destino: cFol ? (txt(r[cFol]) || 'Sin asignar') : 'Sin asignar'
      });
      d.costo += costo; d.piezas += cant; d.recibidas += llego;
    });

    const salida = Object.keys(provs).map(k => {
      const p = provs[k];
      const pedidos = Object.keys(p.pedidos).map(kd => {
        const d = p.pedidos[kd];
        const pg = pagos[norm(kd)] || { monto: 0, n: 0 };
        return Object.assign({}, d, {
          pagado: pg.monto, pagos: pg.n, detallePagos: pg.detalle || [],
          porPagar: Math.round((d.costo - pg.monto) * 100) / 100,
          pendientes: Math.max(0, d.piezas - d.recibidas)
        });
      }).sort((a, b) => b.porPagar - a.porPagar);
      const tot = pedidos.reduce((a, x) => a + x.costo, 0);
      const pag = pedidos.reduce((a, x) => a + x.pagado, 0);
      return {
        proveedor: p.proveedor, pedidos: pedidos,
        totales: {
          pedidos: pedidos.length,
          piezas: pedidos.reduce((a, x) => a + x.piezas, 0),
          pendientes: pedidos.reduce((a, x) => a + x.pendientes, 0),
          costo: tot, pagado: pag, porPagar: Math.round((tot - pag) * 100) / 100
        }
      };
    }).sort((a, b) => b.totales.porPagar - a.totales.porPagar);

    return res.status(200).json({
      ok: true,
      conPagos: !!Object.keys(pagos).length,
      proveedores: salida
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
