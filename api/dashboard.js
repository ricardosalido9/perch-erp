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
  for (const n of nombres) {
    const h = headers.find(x => norm(x) === norm(n));
    if (h) return h;
  }
  return null;
}
function txt(v) { return String(v == null ? '' : v).trim(); }

module.exports = async (req, res) => {
  try {
    const { token } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ventas, inventario] = await Promise.all([
      leer('ventas_registro'), leer('inventario')
    ]);

    const out = {};

    // ===== VENTAS -> filas compactas =====
    // d(fecha num) f(fecha texto) tu(Total USD) ub(Utilidad) u(unidades)
    // mar(marca) v(vendedor) ch(canal) cl(cliente) pr(producto)
    {
      const H = ventas.headers;
      const cF = col(H, 'Fecha');
      const cTU = col(H, 'TOTAL USD', 'Total USD');
      const cUB = col(H, 'Utilidad Bruta');
      const cU = col(H, 'Unidades');
      const cMar = col(H, 'Categoría', 'Categoria', 'Colección', 'Coleccion', 'Línea', 'Linea', 'Marca');
      const cV = col(H, 'Vendedor');
      const cCh = col(H, 'Canal de Venta');
      const cCl = col(H, 'Cliente');
      const cPr = col(H, 'Producto');
      out.ventas = ventas.rows.map(r => ({
        d: cF ? fechaNum(r[cF]) : null,
        f: cF ? txt(r[cF]) : '',
        tu: cTU ? num(r[cTU]) : null,
        ub: cUB ? num(r[cUB]) : null,
        u: cU ? (num(r[cU]) || 0) : 0,
        mar: cMar ? txt(r[cMar]) : '',
        v: cV ? txt(r[cV]) : '',
        ch: cCh ? txt(r[cCh]) : '',
        cl: cCl ? txt(r[cCl]) : '',
        pr: cPr ? txt(r[cPr]) : ''
      }));
    }

    // ===== INVENTARIO -> agregados (snapshot actual) =====
    {
      const H = inventario.headers, R = inventario.rows;
      const cDisp = col(H, 'Disponible');
      const cCosto = col(H, 'Costo Total USD');
      const cMar = col(H, 'Categoría', 'Categoria', 'Colección', 'Coleccion', 'Línea', 'Linea', 'Marca');
      let disponibles = 0, valorStockUSD = 0;
      const dispPorMarca = {}, valorPorMarca = {};
      R.forEach(r => {
        const disp = cDisp ? num(r[cDisp]) : null;
        if (disp === null || disp <= 0) return;   // solo disponibles
        disponibles++;
        const costo = cCosto ? (num(r[cCosto]) || 0) : 0;
        valorStockUSD += costo;
        const m = cMar ? txt(r[cMar]) : '';
        if (m) {
          dispPorMarca[m] = (dispPorMarca[m] || 0) + 1;
          valorPorMarca[m] = (valorPorMarca[m] || 0) + costo;
        }
      });
      out.inventario = {
        registros: R.length,
        disponibles: disponibles,
        vendidos: R.length - disponibles,
        valorStockUSD: valorStockUSD,
        dispPorMarca: dispPorMarca,
        valorPorMarca: valorPorMarca
      };
    }

    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
