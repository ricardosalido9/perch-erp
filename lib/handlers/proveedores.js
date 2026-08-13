// Estado de cuenta por proveedor.
// Junta tres cosas que hoy viven separadas:
//   Pedidos a Proveedores  -> qué se le pidió (pedido general, con sus muebles)
//   Entradas de Inventario -> qué ya llegó de ese pedido
//   EGRESOS                -> qué se le ha pagado (ligado por Pedido)
// El resultado es: proveedor > pedido > muebles, con pagado y por pagar.
const core = require('../core');

// Renglones de EGRESOS que no son pagos al proveedor: ajustes, traspasos, notas de
// crédito, devoluciones. Se separan para que no inflen lo pagado.
// Un pedido se considera CERRADO cuando ya se entregó completo o se canceló.
// El saldo del proveedor solo tiene sentido sobre los pedidos abiertos.
const CERRADO = /entregado|cancelad|cerrado|finiquitad|liquidad/i;


const AJUSTES = /ajuste|cuadrar|cuadre|correccion|corrección|reclasific|traspaso|redondeo|nota de credito|nota de crédito|devolucion|devolución|saldo inicial|apertura/i;

function txt(v) { return String(v == null ? '' : v).trim(); }
// Los números de pedido a veces llegan como "3153.0" porque la celda es numérica
function normPedido(v) {
  return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, ''));
}
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
async function leerHoja(cfg, hoja) {
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, hoja); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
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

    // El estado de cuenta sale SOLO de la pestaña "Pedidos a Proveedores" del archivo
    // donde se captura. Los pagos SOLO de EGRESOS, ligados por número de pedido.
    // Nada de gastos manuales ni de otras pestañas.
    const cfgOp = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;
    // EGRESOS del archivo de finanzas: ese es el que está conciliado con bancos
    const ID_EGRESOS = '1cacFpLcoSwTnWNFc6LgRo1Fb3qJa-qZl0HYhpExUWO4';
    // Pedidos que ya se dieron por liquidados. La fuente es "Mi hoja", y solo cuentan
    // los que dicen literalmente AJUSTE MANUAL. Que un comentario mencione "ajuste"
    // no basta: puede estar describiendo un pago que todavía falta.
    const liquidados = {};
    try {
      const cfgRev = core.areaCfg ? await core.areaCfg('prov_revision') : core.SHEETS.prov_revision;
      if (cfgRev && cfgRev.id) {
        const mh = await leerHoja(cfgRev, cfgRev.sheetName);
        if (mh.headers.length) {
          const mP = col(mh.headers, 'Pedidos', 'Pedido', 'Pedido Proveedor');
          const mPr = col(mh.headers, 'Proveedor');
          const mC = col(mh.headers, 'Comentarios', 'Diferencias', 'Comentario', 'Status');
          if (mP && mC) mh.rows.forEach(r => {
            const nota = txt(r[mC]);
            // Debe decir "ajuste manual" o "ajustes manuales", no cualquier "ajuste"
            if (!/ajustes?\s+manual(es)?/i.test(nota)) return;
            const k = normPedido(r[mP]) + '||' + norm(mPr ? r[mPr] : '');
            liquidados[k] = nota;
            liquidados[normPedido(r[mP])] = nota;   // por si el proveedor viene vacío
          });
        }
      }
    } catch (e) { /* sin Mi hoja: nada queda liquidado */ }

    let [ped, ent, egr] = await Promise.all([
      leer('prov_pedidos'), leer('prov_entradas'),
      leerHoja({ id: ID_EGRESOS }, 'EGRESOS')
    ]);
    if (!egr.headers.length) egr = await leer('fin_egresos');
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
    const cItem = col(H, 'Productos', 'Producto', 'Item');
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
      const eI = col(ent.headers, 'Productos', 'Producto', 'Item');
      const eM = col(ent.headers, 'Material');
      const eC = col(ent.headers, 'Cantidad');
      if (eP) ent.rows.forEach(r => {
        const k = normPedido(r[eP]) + '|' + norm(eI ? r[eI] : '') + '|' + norm(eM ? r[eM] : '');
        entradas[k] = (entradas[k] || 0) + (eC ? num(r[eC]) : 0);
      });
    }

    // Lo que ya se pagó, por pedido de proveedor
    const pagos = {};
    const provsPorPedido = {};   // pedido -> qué proveedores lo usan
    if (egr.headers.length) {
      const gP = col(egr.headers, 'Pedido');
      const gT = col(egr.headers, 'Total');
      const gPr = col(egr.headers, 'Proveedor');
      const gF = col(egr.headers, 'Fecha', 'Fecha ');
      const gC = col(egr.headers, 'Concepto');
      const gD = col(egr.headers, 'Descripción', 'Descripcion');
      const gM = col(egr.headers, 'Método de pago', 'Metodo de pago');
      const gCu = col(egr.headers, 'Cuenta');
      const gD2 = col(egr.headers, 'Descripción', 'Descripcion');
      const gC2 = col(egr.headers, 'Concepto');
      if (gP && gT) egr.rows.forEach(r => {
        // Se indexa por PEDIDO. El proveedor se guarda para poder desempatar cuando dos
        // proveedores distintos usan el mismo número de pedido.
        if (!normPedido(r[gP])) return;
        const k = normPedido(r[gP]) + '||' + norm(gPr ? r[gPr] : '');
        const soloPedido = normPedido(r[gP]);
        provsPorPedido[soloPedido] = provsPorPedido[soloPedido] || {};
        provsPorPedido[soloPedido][norm(gPr ? r[gPr] : '')] = 1;
        // Se guarda el proveedor del pago para no mezclar pagos de otro proveedor
        // que por casualidad tenga el mismo número de pedido.
        if (!pagos[k]) pagos[k] = { monto: 0, n: 0, prov: gPr ? txt(r[gPr]) : '', detalle: [] };
        const m = num(r[gT]);
        // Todo renglón de EGRESOS ligado a ese pedido cuenta como pagado.
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

    // Pedidos que sí quedaron dentro del corte
    const pedidosVigentes = {};
    // proveedor > pedido > muebles
    const provs = {};
    ped.rows.forEach(r => {
      const prov = txt(r[cProv]);
      const pedido = txt(r[cPed]);
      if (!prov && !pedido) return;
      const kp = prov || 'Sin proveedor';
      if (!provs[kp]) provs[kp] = { proveedor: kp, pedidos: {} };
      const kd = (pedido || '(sin pedido)').replace(/\.0+$/, '');
      pedidosVigentes[normPedido(kd) + '||' + norm(prov)] = true;
      if (!provs[kp].pedidos[kd]) {
        provs[kp].pedidos[kd] = {
          pedido: kd, fecha: cFec ? txt(r[cFec]) : '', estimada: cEst ? txt(r[cEst]) : '',
          items: [], costo: 0, piezas: 0, recibidas: 0, abierto: false, status: ''
        };
      }
      const d = provs[kp].pedidos[kd];
      // Basta con que un renglón del pedido siga abierto para que el pedido lo esté
      const st = cSt ? txt(r[cSt]) : '';
      if (st && !CERRADO.test(st)) d.abierto = true;
      if (st && !d.status) d.status = st;
      const cant = cCant ? num(r[cCant]) : 0;
      let costo = cCT ? num(r[cCT]) : 0;
      if (!costo) {
        const cCT2 = col(H, 'Costo Total');
        costo = cCT2 ? num(r[cCT2]) : 0;
      }
      if (!costo && cCU) costo = num(r[cCU]) * cant;
      const llego = entradas[normPedido(pedido) + '|' + norm(cItem ? r[cItem] : '') + '|' + norm(cMat ? r[cMat] : '')] || 0;
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
        // Si ese número de pedido solo lo usa un proveedor, se toman sus pagos aunque el
        // nombre esté escrito distinto. Si lo comparten varios, se exige que coincida.
        const kd2 = normPedido(kd);
        const provs = Object.keys(provsPorPedido[kd2] || {});
        let pg = { monto: 0, n: 0, detalle: [] };
        if (provs.length === 1) pg = pagos[kd2 + '||' + provs[0]] || pg;
        else if (provs.length > 1) pg = pagos[kd2 + '||' + norm(p.proveedor)] || pg;
        const kLiq = normPedido(d.pedido) + '||' + norm(p.proveedor);
        const notaLiq = liquidados[kLiq] || liquidados[normPedido(d.pedido)] || '';
        return Object.assign({}, d, {
          liquidado: !!notaLiq, notaAjuste: notaLiq,
          pagado: pg.monto, pagos: pg.n, detallePagos: pg.detalle || [],
          // Si se liquidó con ajuste manual, su saldo es cero: no arrastra la diferencia
          porPagar: notaLiq ? 0 : Math.round((d.costo - pg.monto) * 100) / 100,
          saldoOriginal: Math.round((d.costo - pg.monto) * 100) / 100,
          pendientes: Math.max(0, d.piezas - d.recibidas)
        });
      }).sort((a, b) => b.porPagar - a.porPagar);
      const abiertos = pedidos.filter(x => x.abierto);
      const suma2 = (arr, k) => Math.round(arr.reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
      const tot = pedidos.reduce((a, x) => a + x.costo, 0);
      const pag = pedidos.reduce((a, x) => a + x.pagado, 0);
      const conAjuste = pedidos.filter(x => x.liquidado);
      const saldoReal = pedidos.reduce((a, x) => a + x.porPagar, 0);
      return {
        proveedor: p.proveedor, pedidos: pedidos,
        totales: {
          pedidos: pedidos.length,
          piezas: pedidos.reduce((a, x) => a + x.piezas, 0),
          pendientes: pedidos.reduce((a, x) => a + x.pendientes, 0),
          costo: tot, pagado: pag,
          liquidadosConAjuste: conAjuste.length,
          ajusteTotal: Math.round(conAjuste.reduce((a, x) => a + (x.saldoOriginal || 0), 0) * 100) / 100,
          porPagar: Math.round(saldoReal * 100) / 100
        },
        // Lo mismo pero solo con los pedidos que siguen abiertos
        abiertos: {
          pedidos: abiertos.length,
          piezas: suma2(abiertos, 'piezas'),
          pendientes: suma2(abiertos, 'pendientes'),
          costo: suma2(abiertos, 'costo'),
          pagado: suma2(abiertos, 'pagado'),
          porPagar: Math.round((suma2(abiertos, 'costo') - suma2(abiertos, 'pagado')) * 100) / 100
        }
      };
    }).sort((a, b) => b.abiertos.porPagar - a.abiertos.porPagar);

    return res.status(200).json({
      ok: true,
      conPagos: !!Object.keys(pagos).length,
      proveedores: salida
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
