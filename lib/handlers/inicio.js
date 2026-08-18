const core = require('../core');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  // Formato contable de las hojas:  -$ 1,234.00-  (los guiones de los extremos son formato)
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
const MESES = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,
  septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12 };
function fechaNum(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]);
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?\s+(?:de\s+)?(\d{4})$/);
  if (m && MESES[m[2]]) return (+m[3]) * 10000 + MESES[m[2]] * 100 + (+m[1]);
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const hasData = headers.some((_, j) => values[i][j] != null && String(values[i][j]).trim() !== '');
    if (!hasData) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (values[i][j] != null) ? values[i][j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}
function col(headers, ...nombres) {
  for (const n of nombres) { const h = headers.find(x => norm(x) === norm(n)); if (h) return h; }
  return null;
}
// Entre columnas casi iguales, elige la que tenga más celdas con texto (ej. dos "Tipo de producto").
function colConDatos(H, rows, nombres) {
  const cands = H.filter(h => nombres.some(n => norm(h) === norm(n)));
  if (cands.length <= 1) return cands[0] || null;
  let best = cands[0], bestN = -1;
  cands.forEach(h => { let c = 0; rows.forEach(r => { if (String(r[h] == null ? '' : r[h]).trim() !== '') c++; }); if (c > bestN) { bestN = c; best = h; } });
  return best;
}
// Entre columnas candidatas, elige la que sume más (pesos, no margen).
function colMonto(H, rows, nombres) {
  const cands = H.filter(h => nombres.some(n => norm(h) === norm(n)));
  if (cands.length <= 1) return cands[0] || null;
  let best = cands[0], bestSum = -1;
  cands.forEach(h => { let s = 0; rows.forEach(r => { const n = num(r[h]); if (n !== null) s += Math.abs(n); }); if (s > bestSum) { bestSum = s; best = h; } });
  return best;
}
function txt(v) { return String(v == null ? '' : v).trim(); }

module.exports = async (req, res) => {
  try {
    const { token } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ventas, compras, cxc, cotiz] = await Promise.all([
      leer('ventas_registro'), leer('compras_registro'), leer('fin_cxc'), leer('cotizaciones')
    ]);

    const hoy = new Date();
    const aaaamm = hoy.getFullYear() * 100 + (hoy.getMonth() + 1);
    const out = { avisos: [], resumen: {} };

    // ===== VENTAS: mes en curso + calidad de datos + últimas ventas =====
    {
      const H = ventas.headers, R = ventas.rows;
      const cF   = col(H, 'Fecha del Cierre', 'Fecha');
      const cVen = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
      const cUt  = colMonto(H, R, ['Utilidad', 'Utilidad Final', 'Utilidad Bruta']);
      const cV   = col(H, 'Vendedor');
      const cCl  = col(H, 'Cliente');
      const cTipo = colConDatos(H, R, ['Tipo de producto', 'Tipo de Producto']);
      const cProd = col(H, 'Producto');

      // La hoja trae fórmulas arrastradas hacia abajo: esas filas NO son ventas.
      // Una fila cuenta como venta solo si tiene folio o un importe mayor a cero.
      const cRef2 = col(H, 'No. de Referencia', 'No de Referencia', 'Referencia', 'Folio');
      const esVentaReal = (r) => {
        if (cRef2 && txt(r[cRef2])) return true;
        const t = cVen ? num(r[cVen]) : null;
        return (t !== null && Math.abs(t) > 0.005);
      };

      let ventasMes = 0, opsMes = 0, utilMes = 0, sinVendedor = 0, sinCliente = 0;
      R.forEach(r => {
        if (!esVentaReal(r)) return;                 // fila de fórmula: se ignora por completo
        const f = cF ? fechaNum(r[cF]) : null;
        if (f !== null && Math.floor(f / 100) === aaaamm) {
          const t = cVen ? num(r[cVen]) : null; if (t !== null) { ventasMes += t; opsMes++; }
          const u = cUt ? num(r[cUt]) : null; if (u !== null) utilMes += u;
        }
        if (cV && !txt(r[cV])) sinVendedor++;
        if (cCl && !txt(r[cCl])) sinCliente++;
      });
      out.resumen.ventasMes = ventasMes;
      out.resumen.opsMes = opsMes;
      out.resumen.utilidadMes = utilMes;

      // El aviso trae la columna que hay que filtrar al darle "Ver"
      if (sinVendedor) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin vendedor',
        detalle: sinVendedor + (sinVendedor === 1 ? ' venta sin vendedor asignado' : ' ventas sin vendedor asignado'),
        n: sinVendedor, filtro: { col: cV, vacio: true } });
      if (sinCliente) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin cliente',
        detalle: sinCliente + (sinCliente === 1 ? ' venta sin cliente' : ' ventas sin cliente'),
        n: sinCliente, filtro: { col: cCl, vacio: true } });

      // ===== Más pendientes de Ventas =====
      const cCat = col(H, 'Tipo de producto', 'Tipo de Producto');
      const cEnt = col(H, 'Fecha de entrega acordada');
      const cSt  = col(H, 'Status');
      let sinCat = 0, sinFecha = 0, sinReal = 0;
      // Estos se cuentan por folio, no por renglón: una venta de 20 muebles
      // son 20 renglones pero un solo pedido pendiente.
      const foliosPorEntregar = {}, foliosVencidosSet = {};
      const foliosVencidos = [];
      const statusAbiertos = [];
      const foliosSinReal = [];
      const cRef3 = col(H, 'No. de Referencia', 'Referencia', 'Folio');
      const hoyNum = (() => { const d = new Date();
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
      const cReal = col(H, 'Fecha de entrega real');
      R.forEach(r => {
        if (!esVentaReal(r)) return;
        const fol0 = cRef3 ? txt(r[cRef3]) : '';
        if (cCat && !txt(r[cCat])) { sinCat++; }
        if (cEnt && !txt(r[cEnt])) { sinFecha++; }
        const entregado = cSt ? /entregado/i.test(txt(r[cSt])) : false;
        if (cSt && !entregado) {
          const folio = cRef3 ? txt(r[cRef3]) : '';
          if (folio) foliosPorEntregar[folio] = 1;
          const st = txt(r[cSt]);
          if (st && statusAbiertos.indexOf(st) === -1) statusAbiertos.push(st);
          const fe = cEnt ? fechaNum(r[cEnt]) : null;
          if (fe !== null && fe < hoyNum) {
            if (folio) {
              foliosVencidosSet[folio] = 1;
              if (foliosVencidos.indexOf(folio) === -1) foliosVencidos.push(folio);
            }
          }
        }
        if (entregado && cReal && !txt(r[cReal])) {
          sinReal++;
          const f4 = cRef3 ? txt(r[cRef3]) : '';
          if (f4 && foliosSinReal.indexOf(f4) === -1) foliosSinReal.push(f4);
        }
      });
      if (sinCat) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin categoría de producto', detalle: sinCat + ' sin tipo de producto asignado',
        n: sinCat, filtro: { col: cCat, vacio: true } });
      if (sinFecha) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin fecha de entrega', detalle: sinFecha + ' sin fecha acordada',
        n: sinFecha, filtro: { col: cEnt, vacio: true } });
      const vencidas = Object.keys(foliosVencidosSet).length;
      const porEntregar = Object.keys(foliosPorEntregar).length;
      if (vencidas) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Entregas vencidas',
        detalle: vencidas === 1
          ? '1 pedido ya pasó su fecha y sigue sin entregarse'
          : vencidas + ' pedidos ya pasaron su fecha y siguen sin entregarse',
        n: vencidas, filtro: { col: cRef3, valores: foliosVencidos.slice(0, 300) } });
      if (porEntregar) out.avisos.push({ tipo: 'info', area: 'ventas_registro',
        titulo: 'Pendientes por entregar',
        detalle: porEntregar + (porEntregar === 1 ? ' pedido abierto' : ' pedidos abiertos'),
        n: porEntregar, filtro: { col: cSt, valores: statusAbiertos } });
      if (sinReal) out.avisos.push({ tipo: 'info', area: 'ventas_registro',
        titulo: 'Entregadas sin fecha real', detalle: sinReal + ' entregadas sin registrar el día',
        n: sinReal, filtro: { col: cRef3, valores: foliosSinReal.slice(0, 300) } });

      out.ultimasVentas = R.filter(esVentaReal).map(r => ({ r, d: cF ? fechaNum(r[cF]) : null }))
        .filter(x => x.d !== null).sort((a, b) => b.d - a.d).slice(0, 6)
        .map(x => ({
          fecha: cF ? txt(x.r[cF]) : '',
          cliente: cCl ? txt(x.r[cCl]) : '',
          marca: cProd ? txt(x.r[cProd]) : (cTipo ? txt(x.r[cTipo]) : ''),
          tu: cVen ? num(x.r[cVen]) : null
        }));
    }

    // ===== CUENTAS POR COBRAR: facturas y saldos =====
    if (cxc.headers.length) {
      const Hc = cxc.rows.length ? cxc.headers : [];
      const cQ = col(Hc, 'Factura Si / No', 'Factura Si/No');
      const cH = Hc.filter(h => String(h).trim().toLowerCase() === 'factura')[0];
      const cPC = col(Hc, 'Por cobrar');
      let facPend = 0, conSaldo = 0, montoSaldo = 0;
      cxc.rows.forEach(r => {
        if (cQ && /^si$/i.test(txt(r[cQ])) && cH && !/^(true|si|x)$/i.test(txt(r[cH]))) facPend++;
        if (cPC) {
          const v = num(r[cPC]);
          if (v !== null && v > 0.5) { conSaldo++; montoSaldo += v; }
        }
      });
      if (facPend) out.avisos.push({ tipo: 'warn', area: 'fac_control',
        titulo: 'Facturas por emitir', detalle: facPend + ' pedidos pidieron factura y sigue sin hacerse',
        n: facPend, filtro: { col: cQ, valores: ['Si'] } });
      if (conSaldo) out.avisos.push({ tipo: 'warn', area: 'fin_cxc',
        titulo: 'Pedidos por cobrar', detalle: conSaldo + ' pedidos con saldo', n: conSaldo,
        monto: montoSaldo, filtro: { col: cPC, gt0: true } });
    }

    // ===== COTIZACIONES: las que se están enfriando =====
    if (cotiz.headers.length) {
      const Hq = cotiz.headers;
      const qRef = col(Hq, 'No. de Referencia', 'Folio');
      const qSt  = col(Hq, 'Status');
      const qF   = col(Hq, 'Fecha del Cierre', 'Fecha');
      const vistos = {};
      let frias = 0;
      cotiz.rows.forEach(r => {
        const f = qRef ? txt(r[qRef]) : '';
        if (!f || vistos[f]) return;
        vistos[f] = 1;
        const st = qSt ? txt(r[qSt]) : '';
        if (/vendida|rechazad/i.test(st)) return;
        const d = qF ? fechaNum(r[qF]) : null;
        if (d === null) return;
        const a = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100;
        const dias = Math.round((Date.now() - Date.UTC(a, m - 1, dd)) / 86400000);
        if (dias > 15) frias++;
      });
      if (frias) out.avisos.push({ tipo: 'warn', area: 'cotizaciones',
        titulo: 'Cotizaciones sin respuesta', detalle: frias + ' llevan más de 15 días abiertas',
        n: frias, filtro: { col: qSt, noContiene: ['Vendida', 'Rechazada'] } });
    }

    // ===== COMPRAS: mes en curso =====
    {
      const H = compras.headers, R = compras.rows;
      const cF = col(H, 'Fecha');
      const cCosto = colMonto(H, R, ['Costo Total USD', 'TOTAL USD', 'Total USD', 'Total']);
      let comprasMes = 0, opsCompraMes = 0;
      R.forEach(r => {
        const f = cF ? fechaNum(r[cF]) : null;
        if (f !== null && Math.floor(f / 100) === aaaamm) {
          const c = cCosto ? num(r[cCosto]) : null; if (c !== null) { comprasMes += c; opsCompraMes++; }
        }
      });
      out.resumen.comprasMes = comprasMes;
      out.resumen.opsCompraMes = opsCompraMes;
    }

    // Los avisos de datos faltantes en ventas se juntan: son la misma tarea
    {
      const deVentas = out.avisos.filter(a => a.area === 'ventas_registro' &&
        /^Ventas sin /.test(a.titulo));
      if (deVentas.length > 1) {
        const total = deVentas.reduce((t, a) => t + (a.n || 0), 0);
        out.avisos = out.avisos.filter(a => deVentas.indexOf(a) === -1);
        out.avisos.push({
          tipo: 'warn', area: 'ventas_registro',
          titulo: 'Ventas con datos incompletos',
          detalle: deVentas.map(a => a.n + ' ' + a.titulo.replace('Ventas sin ', 'sin ')).join(' · '),
          n: total,
          filtro: deVentas[0].filtro || null,
          desglose: deVentas.map(a => ({ titulo: a.titulo, n: a.n, filtro: a.filtro || null }))
        });
      }
    }

    // ===== PAGOS QUE PIDIÓ NICO Y SIGUEN SIN HACERSE =====
    try {
      const pg = await leer('pagos_pedidos');
      if (pg.headers.length) {
        const Hg = pg.headers;
        const gPag = col(Hg, 'Pagado');
        const gTot = col(Hg, 'Total con IVA', 'Total');
        const gProv = col(Hg, 'Proveedor');
        const gFec = col(Hg, 'Fecha');
        const esSi2 = (v) => /^(si|sí|true|x|1|verdadero)$/i.test(txt(v));
        if (gTot) {
          let n = 0, monto = 0, atrasados = 0;
          const provs = {};
          const hoyN2 = (() => { const d = new Date();
            return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
          const dias = (a, b) => {
            const f = (x) => new Date(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100);
            return Math.round((f(b) - f(a)) / 86400000);
          };
          pg.rows.forEach(r => {
            if (gPag && esSi2(r[gPag])) return;      // ya se pagó
            const m = num(r[gTot]);
            if (!m) return;
            n++;
            monto += m;
            const p2 = txt(gProv ? r[gProv] : '');
            if (p2) provs[p2] = 1;
            const d = gFec ? fechaNum(r[gFec]) : null;
            if (d !== null && dias(d, hoyN2) >= 7) atrasados++;
          });
          if (n) out.avisos.push({
            tipo: atrasados ? 'alert' : 'warn', area: 'pagos_pedidos',
            titulo: 'Pagos por hacer',
            detalle: n + (n === 1 ? ' pago pedido' : ' pagos pedidos') + ' a ' +
                     Object.keys(provs).length + ' proveedores por ' +
                     monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) +
                     (atrasados ? ' · ' + atrasados + ' llevan más de una semana esperando' : ''),
            n: n
          });
        }
      }
    } catch (e) { /* si no hay hoja de pagos, no pasa nada */ }

    // ===== PRODUCCIÓN: lo que se atoró en el taller =====
    try {
      const ped = await leer('prov_pedidos');
      if (ped.headers.length) {
        const Hp = ped.headers;
        const pPed = col(Hp, 'Pedido Proveedor');
        const pProv = col(Hp, 'Proveedor');
        const pSt = col(Hp, 'Status');
        const pEst = col(Hp, 'Fecha Estimada de Entrega');
        const pCant = col(Hp, 'Cantidad');
        const pEnt = col(Hp, 'Entradas');
        const pCU = col(Hp, 'Costo Unitario');
        const pFol = col(Hp, 'Folio cliente');
        const hoyN = (() => { const d = new Date();
          return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
        let vencidos = {}, sinFechaEst = 0, sinCosto = 0, sinProveedor = 0, parciales = {};
        ped.rows.forEach(r => {
          const st = pSt ? txt(r[pSt]) : '';
          const entregado = /entregad|cancelad/i.test(st);
          const pedido = pPed ? txt(r[pPed]) : '';
          if (!entregado) {
            const fe = pEst ? fechaNum(r[pEst]) : null;
            if (fe !== null && fe < hoyN) { if (pedido) vencidos[pedido] = 1; }
            else if (fe === null && pedido) sinFechaEst++;
          }
          if (pCU && !num(r[pCU]) && !entregado) sinCosto++;
          if (pProv && !txt(r[pProv])) sinProveedor++;
          // Entregas a medias: llegó algo pero no todo
          if (pCant && pEnt) {
            const c = num(r[pCant]) || 0, e = num(r[pEnt]) || 0;
            if (e > 0 && e < c && pedido) parciales[pedido] = 1;
          }
        });
        const nVenc = Object.keys(vencidos).length;
        const nParc = Object.keys(parciales).length;
        if (nVenc) out.avisos.push({ tipo: 'alert', area: 'prov_pedidos',
          titulo: 'Pedidos que ya debieron llegar',
          detalle: nVenc + ' pasaron su fecha estimada y siguen sin entregarse', n: nVenc,
          filtro: pSt ? { col: pSt, noContiene: ['ENTREGADO', 'CANCELADO'] } : null });
        if (nParc) out.avisos.push({ tipo: 'warn', area: 'prov_pedidos',
          titulo: 'Pedidos a medias', detalle: nParc + ' recibieron una parte y falta el resto',
          n: nParc });
        if (sinCosto) out.avisos.push({ tipo: 'warn', area: 'prov_pedidos',
          titulo: 'Pedidos sin costo', detalle: sinCosto + ' renglones sin costo unitario',
          n: sinCosto, filtro: pCU ? { col: pCU, vacio: true } : null });
        if (sinProveedor) out.avisos.push({ tipo: 'warn', area: 'prov_pedidos',
          titulo: 'Pedidos sin proveedor', detalle: sinProveedor + ' renglones sin proveedor',
          n: sinProveedor, filtro: pProv ? { col: pProv, vacio: true } : null });
        if (sinFechaEst) out.avisos.push({ tipo: 'warn', area: 'prov_pedidos',
          titulo: 'Pedidos sin fecha estimada',
          detalle: sinFechaEst + ' abiertos sin saber cuándo llegan', n: sinFechaEst,
          filtro: pEst ? { col: pEst, vacio: true } : null });
      }
    } catch (e) { /* si no hay pedidos, no pasa nada */ }

    // ===== PRODUCCIÓN: salidas sin folio y piezas por revisar =====
    try {
      const sal = await leer('prov_salidas');
      if (sal.headers.length) {
        const Hs = sal.headers;
        const sFol = col(Hs, 'Folio cliente', 'Folio');
        const sCosto = col(Hs, 'Costo Unitario', 'Costo');
        let sinFolio = 0, sinCostoSal = 0;
        sal.rows.forEach(r => {
          if (sFol && !txt(r[sFol])) sinFolio++;
          if (sCosto && !num(r[sCosto])) sinCostoSal++;
        });
        if (sinCostoSal) out.avisos.push({ tipo: 'warn', area: 'prov_salidas',
          titulo: 'Salidas sin costo',
          detalle: sinCostoSal + ' salidas sin costo: el comparativo va a salir incompleto',
          n: sinCostoSal, filtro: sCosto ? { col: sCosto, vacio: true } : null });
      }
    } catch (e) { /* opcional */ }

    // ===== FISCAL: complementos y facturas pendientes =====
    // Se lee de CxC, que es donde vive el UUID y si la factura es PUE o PPD.
    if (cxc.headers.length) {
      const Hf = cxc.headers;
      const fRef = col(Hf, 'No. de Referencia', 'Folio');
      const fUUID = col(Hf, 'UUID', 'Folio Fiscal');
      const fMet = col(Hf, 'Método de pago SAT', 'Metodo de pago SAT', 'PPD o PUE', 'PUE/PPD');
      const fComp = col(Hf, 'Complemento emitido', 'Complemento');
      const fPag = col(Hf, 'Pagado', 'Total Cobrado');
      const esSi = (v) => {
        const t = norm(v);
        return t === 'si' || t === 'true' || t === 'x' || t === '1';
      };
      if (fUUID && fMet) {
        let faltaComp = 0, sinMetodo = 0;
        cxc.rows.forEach(r => {
          if (!txt(r[fUUID])) return;
          const met = norm(r[fMet]);
          const pagado = fPag ? num(r[fPag]) : 0;
          if (!/ppd/.test(met) && !/pue/.test(met)) { sinMetodo++; return; }
          if (/ppd/.test(met) && pagado > 0 && !(fComp && esSi(r[fComp]))) faltaComp++;
        });
        if (faltaComp) out.avisos.push({ tipo: 'alert', area: 'fac_control',
          titulo: 'Complementos de pago pendientes',
          detalle: faltaComp + ' facturas PPD ya cobradas siguen sin complemento',
          n: faltaComp });
        if (sinMetodo) out.avisos.push({ tipo: 'warn', area: 'fac_control',
          titulo: 'Facturas sin PUE ni PPD',
          detalle: sinMetodo + ' facturas no dicen si llevan complemento', n: sinMetodo });
        // Pidieron factura, ya pagaron, y sigue sin UUID
        let cobradoSinFactura = 0;
        const fPide = col(Hf, 'Factura Si / No', 'Requiere factura', 'Factura');
        if (fPide) cxc.rows.forEach(r => {
          const pide = /^(si|sí|true|x|1)$/i.test(txt(r[fPide]));
          const pagado = fPag ? num(r[fPag]) : 0;
          if (pide && pagado > 0 && !txt(r[fUUID])) cobradoSinFactura++;
        });
        if (cobradoSinFactura) out.avisos.push({ tipo: 'alert', area: 'fac_control',
          titulo: 'Cobrado y sin facturar',
          detalle: cobradoSinFactura + ' pedidos ya pagaron y siguen sin factura',
          n: cobradoSinFactura });
      }
    }

    // Cada quien ve solo los avisos de las áreas que le tocan
    const sesion = core.verifyToken(token);
    const perm = core.permisosDe(sesion && sesion.rol);
    if (perm) {
      out.avisos = (out.avisos || []).filter(a => !a.area || perm.areas.indexOf(a.area) !== -1);
      out.rol = sesion.rol;
      // Y los números del resumen: los de venta solo para quien ve ventas
      const veVentas = perm.areas.indexOf('ventas_registro') !== -1;
      const veCompras = perm.areas.indexOf('prov_pedidos') !== -1;
      if (!veVentas) {
        ['ventasMes', 'opsVentaMes', 'ticketMes', 'ventasAnio', 'utilidadMes'].forEach(k => {
          delete out.resumen[k];
        });
      }
      if (!veCompras) {
        ['comprasMes', 'opsCompraMes'].forEach(k => { delete out.resumen[k]; });
      }
    }
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
