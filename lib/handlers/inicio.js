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
      let sinCat = 0, sinFecha = 0, porEntregar = 0, vencidas = 0, sinReal = 0;
      const hoyNum = (() => { const d = new Date();
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
      const cReal = col(H, 'Fecha de entrega real');
      R.forEach(r => {
        if (!esVentaReal(r)) return;
        if (cCat && !txt(r[cCat])) sinCat++;
        if (cEnt && !txt(r[cEnt])) sinFecha++;
        const entregado = cSt ? /entregado/i.test(txt(r[cSt])) : false;
        if (cSt && !entregado) {
          porEntregar++;
          const fe = cEnt ? fechaNum(r[cEnt]) : null;
          if (fe !== null && fe < hoyNum) vencidas++;
        }
        if (entregado && cReal && !txt(r[cReal])) sinReal++;
      });
      if (sinCat) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin categoría de producto', detalle: sinCat + ' sin tipo de producto asignado',
        n: sinCat, filtro: { col: cCat, vacio: true } });
      if (sinFecha) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin fecha de entrega', detalle: sinFecha + ' sin fecha acordada',
        n: sinFecha, filtro: { col: cEnt, vacio: true } });
      if (vencidas) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Entregas vencidas', detalle: vencidas + ' ya pasaron su fecha y siguen sin entregar',
        n: vencidas, filtro: { col: cSt, noContiene: ['Entregado'] } });
      if (porEntregar) out.avisos.push({ tipo: 'info', area: 'ventas_registro',
        titulo: 'Pendientes por entregar', detalle: porEntregar + ' pedidos abiertos',
        n: porEntregar, filtro: { col: cSt, noContiene: ['Entregado'] } });
      if (sinReal) out.avisos.push({ tipo: 'info', area: 'ventas_registro',
        titulo: 'Entregadas sin fecha real', detalle: sinReal + ' entregadas sin registrar el día',
        n: sinReal, filtro: { col: cReal, vacio: true } });

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
      if (facPend) out.avisos.push({ tipo: 'warn', area: 'fin_cxc',
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

    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
