// Concilia la pestaña "Gastos Manuales" (control de Nico) contra "EGRESOS" (lo que
// efectivamente salió del banco). Cruza por monto con tolerancia de fechas, porque
// el banco casi nunca registra el mismo día en que se captura el gasto.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fecha(v) {
  if (v instanceof Date) return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / 86400000);
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000);
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return Math.floor(Date.UTC(+m[3], MESES[m[2]] - 1, +m[1]) / 86400000);
  return null;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key, hoja) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, hoja || cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = body.anio ? +body.anio : 2026;

    const [gm, eg] = await Promise.all([
      leer('prov_pedidos', 'Gastos Manuales'),      // vive en el archivo de Operación
      leer('fin_egresos')
    ]);
    if (!gm.headers.length) return res.status(400).json({ error: 'No se pudo leer la pestaña "Gastos Manuales".' });
    if (!eg.headers.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de EGRESOS.' });

    const gF = col(gm.headers, 'Fecha'), gT = col(gm.headers, 'Total con IVA', 'Total');
    const gP = col(gm.headers, 'Proveedor'), gD = col(gm.headers, 'Descripción', 'Descripcion');
    const gC = col(gm.headers, 'Concepto'), gPed = col(gm.headers, 'Pedido');
    const eF = col(eg.headers, 'Fecha'), eT = col(eg.headers, 'Total');
    const eP = col(eg.headers, 'Proveedor'), eD = col(eg.headers, 'Descripción', 'Descripcion');
    const eC = col(eg.headers, 'Cuenta'), ePed = col(eg.headers, 'Pedido');
    if (!gT || !eT) return res.status(400).json({ error: 'Falta la columna de total en alguna de las dos pestañas.' });

    const dentro = (f) => { const d = fecha(f); return d !== null && new Date(d * 86400000).getUTCFullYear() === anio; };
    const manuales = gm.rows.filter(r => num(r[gT]) && dentro(r[gF]));
    const banco = eg.rows.filter(r => num(r[eT]) && dentro(r[eF]))
      .map(r => ({ r: r, m: Math.round(num(r[eT]) * 100) / 100, d: fecha(r[eF]),
                   p: norm(eP ? r[eP] : ''), usado: false }));

    const NIVELES = [
      { nombre: 'Misma fecha', tol: 0 },
      { nombre: 'Hasta 3 días de diferencia', tol: 3 },
      { nombre: 'Hasta 10 días de diferencia', tol: 10 },
      { nombre: 'Hasta 30 días de diferencia', tol: 30 },
      { nombre: 'Solo coincide el monto', tol: 9999 }
    ];
    const conciliados = [], sinPar = [];
    manuales.forEach(g => {
      const m = Math.round(num(g[gT]) * 100) / 100;
      const d = fecha(g[gF]);
      const p = norm(gP ? g[gP] : '');
      const cand = banco.filter(e => !e.usado && Math.abs(e.m - m) < 0.02);
      let elegido = null, nivel = null;
      for (const n of NIVELES) {
        let c2 = cand.filter(e => d === null || e.d === null || Math.abs(e.d - d) <= n.tol);
        if (p) { const mismoProv = c2.filter(e => e.p === p); if (mismoProv.length) c2 = mismoProv; }
        if (c2.length) { elegido = c2[0]; nivel = n.nombre; break; }
      }
      const base = {
        fila: g._fila, fecha: txt(g[gF]), proveedor: txt(gP ? g[gP] : ''),
        concepto: txt(gC ? g[gC] : ''), descripcion: txt(gD ? g[gD] : ''),
        pedido: txt(gPed ? g[gPed] : ''), monto: m
      };
      if (elegido) {
        elegido.usado = true;
        conciliados.push(Object.assign(base, {
          nivel: nivel, filaEgreso: elegido.r._fila,
          fechaBanco: txt(elegido.r[eF]), cuenta: txt(eC ? elegido.r[eC] : ''),
          dias: (d !== null && elegido.d !== null) ? Math.abs(elegido.d - d) : null
        }));
      } else {
        sinPar.push(base);
      }
    });

    const soloBanco = banco.filter(e => !e.usado).map(e => ({
      fila: e.r._fila, fecha: txt(e.r[eF]), proveedor: txt(eP ? e.r[eP] : ''),
      descripcion: txt(eD ? e.r[eD] : ''), cuenta: txt(eC ? e.r[eC] : ''),
      pedido: txt(ePed ? e.r[ePed] : ''), monto: e.m
    }));

    const suma = (a, k) => Math.round(a.reduce((t, x) => t + (x[k] || x.monto || 0), 0) * 100) / 100;
    return res.status(200).json({
      ok: true, anio: anio,
      totales: {
        manuales: manuales.length, banco: banco.length,
        conciliados: conciliados.length,
        sinPar: sinPar.length, montoSinPar: suma(sinPar, 'monto'),
        soloBanco: soloBanco.length, montoSoloBanco: suma(soloBanco, 'monto')
      },
      porNivel: NIVELES.map(n => ({
        nivel: n.nombre, n: conciliados.filter(c => c.nivel === n.nombre).length
      })).filter(x => x.n),
      conciliados: conciliados,
      sinPar: sinPar.sort((a, b) => b.monto - a.monto),
      soloBanco: soloBanco.sort((a, b) => b.monto - a.monto)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
