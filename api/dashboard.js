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

    const ventas = await leer('ventas_registro');
    const H = ventas.headers;

    const cFecha = col(H, 'Fecha del Cierre', 'Fecha');
    const cProd  = col(H, 'Producto');
    const cCli   = col(H, 'Cliente');
    const cTipo  = col(H, 'Tipo de Producto', 'Categoria producto', 'Categoría');
    const cVend  = col(H, 'Vendedor');
    const cCant  = col(H, 'Cantidad', 'Unidades');
    const cVenta = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos',
                        'Total con envío', 'Total Pedido');
    const cUtil  = col(H, 'Utilidad', 'Utilidad Final');

    // Filas compactas: d(fecha num) f(fecha texto) venta util u(unidades) prod cli tipo vend
    const out = ventas.rows.map(r => ({
      d:     cFecha ? fechaNum(r[cFecha]) : null,
      f:     cFecha ? txt(r[cFecha]) : '',
      venta: cVenta ? num(r[cVenta]) : null,
      util:  cUtil ? num(r[cUtil]) : null,
      u:     cCant ? (num(r[cCant]) || 0) : 0,
      prod:  cProd ? txt(r[cProd]) : '',
      cli:   cCli ? txt(r[cCli]) : '',
      tipo:  cTipo ? txt(r[cTipo]) : '',
      vend:  cVend ? txt(r[cVend]) : ''
    }));

    return res.status(200).json({ ventas: out });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
