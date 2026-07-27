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

// Entre TODAS las columnas cuyo encabezado coincide (por nombre), elige la que tenga más celdas con texto.
// Sirve cuando hay dos columnas casi iguales (ej. "Tipo de Producto" y "Tipo de producto").
function colConDatos(H, rows, nombres) {
  const cands = H.filter(h => nombres.some(n => norm(h) === norm(n)));
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  let best = cands[0], bestN = -1;
  cands.forEach(h => {
    let c = 0; rows.forEach(r => { if (String(r[h] == null ? '' : r[h]).trim() !== '') c++; });
    if (c > bestN) { bestN = c; best = h; }
  });
  return best;
}
// Entre columnas candidatas, elige la que sume MÁS (en valor absoluto): distingue pesos (~2M) de margen (~0.55).
function colMonto(H, rows, nombres) {
  const cands = H.filter(h => nombres.some(n => norm(h) === norm(n)));
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  let best = cands[0], bestSum = -1;
  cands.forEach(h => {
    let s = 0; rows.forEach(r => { const n = num(r[h]); if (n !== null) s += Math.abs(n); });
    if (s > bestSum) { bestSum = s; best = h; }
  });
  return best;
}

module.exports = async (req, res) => {
  try {
    const { token } = await core.readBody(req);
    if (!core.verifyToken(token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const ventas = await leer('ventas_registro');
    const H = ventas.headers;
    const R = ventas.rows;

    const cFecha = col(H, 'Fecha del Cierre', 'Fecha');
    const cProd  = col(H, 'Producto');
    const cCli   = col(H, 'Cliente');
    const cTipo  = colConDatos(H, R, ['Tipo de producto', 'Tipo de Producto', 'Categoria producto', 'Categoría']);
    const cVend  = col(H, 'Vendedor');
    const cCant  = col(H, 'Cantidad', 'Unidades');
    const cVenta = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
    const cUtil  = colMonto(H, R, ['Utilidad', 'Utilidad Final', 'Utilidad Bruta']);

    // Filas compactas: d(fecha num) f(fecha texto) venta util u(unidades) prod cli tipo vend
    const out = ventas.rows.map(r => ({
      d:     cFecha ? fechaNum(r[cFecha]) : null,
      f:     cFecha ? txt(r[cFecha]) : '',
      venta: cVenta ? num(r[cVenta]) : null,
      util:  cUtil ? num(r[cUtil]) : null,
      u:     cCant ? (num(r[cCant]) || 0) : 0,
      prod:  cProd ? (txt(r[cProd]) || 'Sin nombre') : 'Sin nombre',
      cli:   cCli ? txt(r[cCli]) : '',
      tipo:  cTipo ? (txt(r[cTipo]) || 'Sin categorizar') : 'Sin categorizar',
      vend:  cVend ? txt(r[cVend]) : ''
    }));

    return res.status(200).json({ ventas: out });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
