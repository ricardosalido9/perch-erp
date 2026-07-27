const core = require('../lib/core');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function num(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (!s || s === '-' || s === '.') return null;
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
  const cfg = core.SHEETS[key];
  if (!cfg) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0].map(h => String(h));
  const rows = [];
  for (let i = 1; i < values.length; i++) {
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

    const [ventas, compras] = await Promise.all([
      leer('ventas_registro'), leer('compras_registro')
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

      let ventasMes = 0, opsMes = 0, utilMes = 0, sinVendedor = 0, sinCliente = 0;
      R.forEach(r => {
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

      if (sinVendedor) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin vendedor', detalle: sinVendedor + (sinVendedor === 1 ? ' venta sin vendedor asignado' : ' ventas sin vendedor asignado'), n: sinVendedor });
      if (sinCliente) out.avisos.push({ tipo: 'warn', area: 'ventas_registro',
        titulo: 'Ventas sin cliente', detalle: sinCliente + (sinCliente === 1 ? ' venta sin cliente' : ' ventas sin cliente'), n: sinCliente });

      out.ultimasVentas = R.map(r => ({ r, d: cF ? fechaNum(r[cF]) : null }))
        .filter(x => x.d !== null).sort((a, b) => b.d - a.d).slice(0, 6)
        .map(x => ({
          fecha: cF ? txt(x.r[cF]) : '',
          cliente: cCl ? txt(x.r[cCl]) : '',
          marca: cProd ? txt(x.r[cProd]) : (cTipo ? txt(x.r[cTipo]) : ''),
          tu: cVen ? num(x.r[cVen]) : null
        }));
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
