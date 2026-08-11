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

// Renglones que no son pagos reales: son ajustes contables para cuadrar la hoja.
// Se apartan para que la conciliación muestre solo movimientos de dinero de verdad.
const AJUSTES = /ajuste|cuadrar|cuadre|correccion|corrección|reclasific|traspaso|redondeo|saldo inicial|apertura|prueba|cancelad/i;
function esAjuste(...textos) {
  return textos.some(t => AJUSTES.test(String(t == null ? '' : t)));
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = body.anio ? +body.anio : 2026;

    // Las dos pestañas viven en el MISMO archivo de Operación. Comparar contra el
    // EGRESOS del archivo histórico de finanzas no tiene sentido: son universos distintos.
    let [gm, eg] = await Promise.all([
      leer('prov_pedidos', 'Gastos Manuales'),
      leer('prov_pedidos', 'EGRESOS')
    ]);
    if (!eg.headers.length) eg = await leer('fin_egresos');   // respaldo
    if (!gm.headers.length) return res.status(400).json({ error: 'No se pudo leer la pestaña "Gastos Manuales".' });
    if (!eg.headers.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de EGRESOS.' });

    const gF = col(gm.headers, 'Fecha'), gT = col(gm.headers, 'Total con IVA', 'Total');
    const gP = col(gm.headers, 'Proveedor'), gD = col(gm.headers, 'Descripción', 'Descripcion');
    const gC = col(gm.headers, 'Concepto'), gPed = col(gm.headers, 'Pedido');
    // En Gastos Manuales el método de pago va escrito en Comentarios
    const gCom = col(gm.headers, 'Comentarios', 'Método de pago', 'Metodo de pago');
    const eF = col(eg.headers, 'Fecha'), eT = col(eg.headers, 'Total');
    const eP = col(eg.headers, 'Proveedor'), eD = col(eg.headers, 'Descripción', 'Descripcion');
    const eC = col(eg.headers, 'Cuenta'), ePed = col(eg.headers, 'Pedido');
    const eM = col(eg.headers, 'Método de pago', 'Metodo de pago', 'Forma de pago');
    if (!gT || !eT) return res.status(400).json({ error: 'Falta la columna de total en alguna de las dos pestañas.' });

    const dentro = (f) => { const d = fecha(f); return d !== null && new Date(d * 86400000).getUTCFullYear() === anio; };
    const manuales = gm.rows.filter(r => num(r[gT]) && dentro(r[gF]));
    const banco = eg.rows.filter(r => num(r[eT]) && dentro(r[eF]))
      .map(r => ({ r: r, m: Math.round(num(r[eT]) * 100) / 100, d: fecha(r[eF]),
                   p: norm(eP ? r[eP] : ''), ped: norm(ePed ? r[ePed] : ''), usado: false }));

    // El cruce se hace por PASADAS, de la señal más fuerte a la más débil, y cada pasada
    // recorre TODOS los gastos antes de bajar a la siguiente. Así un cruce flojo no se
    // roba un movimiento que le tocaba a uno fuerte.
    const conciliados = [], ajustes = [], pendientes = [];
    manuales.forEach(g => {
      if (esAjuste(g[gD], gC ? g[gC] : '')) {
        ajustes.push({
          origen: 'Gastos Manuales', fila: g._fila, fecha: txt(g[gF]), dia: fecha(g[gF]),
          proveedor: txt(gP ? g[gP] : ''), concepto: txt(gC ? g[gC] : ''),
          descripcion: txt(gD ? g[gD] : ''), pedido: txt(gPed ? g[gPed] : ''),
          monto: Math.round(num(g[gT]) * 100) / 100
        });
        return;
      }
      pendientes.push({
        r: g, m: Math.round(num(g[gT]) * 100) / 100, d: fecha(g[gF]),
        p: norm(gP ? g[gP] : ''), ped: norm(gPed ? g[gPed] : ''), listo: false
      });
    });

    const mismoMonto = (a, b) => Math.abs(a - b) < 0.02;
    const dist = (a, b) => (a === null || b === null) ? 9999 : Math.abs(a - b);
    const PASADAS = [
      { nombre: 'Mismo pedido y mismo monto',
        ok: (g, e) => !!g.ped && g.ped === e.ped && mismoMonto(g.m, e.m) },
      { nombre: 'Mismo monto y misma fecha',
        ok: (g, e) => mismoMonto(g.m, e.m) && dist(g.d, e.d) === 0 },
      { nombre: 'Mismo monto, hasta 3 días',
        ok: (g, e) => mismoMonto(g.m, e.m) && dist(g.d, e.d) <= 3 },
      { nombre: 'Mismo monto, hasta 10 días',
        ok: (g, e) => mismoMonto(g.m, e.m) && dist(g.d, e.d) <= 10 },
      { nombre: 'Mismo monto, hasta 30 días',
        ok: (g, e) => mismoMonto(g.m, e.m) && dist(g.d, e.d) <= 30 },
      { nombre: 'Mismo pedido y proveedor, MONTO DISTINTO',
        ok: (g, e) => !!g.ped && g.ped === e.ped && !!g.p && g.p === e.p },
      { nombre: 'Solo coincide el monto',
        ok: (g, e) => mismoMonto(g.m, e.m) }
    ];

    PASADAS.forEach(pasada => {
      pendientes.forEach(g => {
        if (g.listo) return;
        let cand = banco.filter(e => !e.usado && pasada.ok(g, e));
        if (cand.length > 1 && g.p) {
          const mismoProv = cand.filter(e => e.p === g.p);
          if (mismoProv.length) cand = mismoProv;
        }
        if (cand.length > 1) cand = cand.slice().sort((a, b) => dist(g.d, a.d) - dist(g.d, b.d));
        if (!cand.length) return;
        const e = cand[0];
        e.usado = true; g.listo = true;
        conciliados.push({
          fila: g.r._fila, fecha: txt(g.r[gF]), dia: g.d, proveedor: txt(gP ? g.r[gP] : ''),
          concepto: txt(gC ? g.r[gC] : ''), descripcion: txt(gD ? g.r[gD] : ''),
          pedido: txt(gPed ? g.r[gPed] : ''), monto: g.m,
          metodoManual: txt(gCom ? g.r[gCom] : ''),
          nivel: pasada.nombre, filaEgreso: e.r._fila,
          fechaBanco: txt(e.r[eF]), cuenta: txt(eC ? e.r[eC] : ''),
          montoBanco: e.m, diferencia: Math.round((e.m - g.m) * 100) / 100,
          metodo: txt(eM ? e.r[eM] : ''),
          dias: (g.d !== null && e.d !== null) ? Math.abs(e.d - g.d) : null
        });
      });
    });

    const sinPar = pendientes.filter(g => !g.listo).map(g => ({
      fila: g.r._fila, fecha: txt(g.r[gF]), dia: g.d, proveedor: txt(gP ? g.r[gP] : ''),
      concepto: txt(gC ? g.r[gC] : ''), descripcion: txt(gD ? g.r[gD] : ''),
      pedido: txt(gPed ? g.r[gPed] : ''), monto: g.m,
      metodo: txt(gCom ? g.r[gCom] : '')
    }));

    banco.filter(e => !e.usado && esAjuste(e.r[eD], eC ? e.r[eC] : '')).forEach(e => {
      e.usado = true;
      ajustes.push({
        origen: 'EGRESOS', fila: e.r._fila, fecha: txt(e.r[eF]), dia: e.d,
        proveedor: txt(eP ? e.r[eP] : ''), concepto: '', descripcion: txt(eD ? e.r[eD] : ''),
        pedido: txt(ePed ? e.r[ePed] : ''), monto: e.m
      });
    });

    const soloBanco = banco.filter(e => !e.usado).map(e => ({
      fila: e.r._fila, fecha: txt(e.r[eF]), dia: e.d, proveedor: txt(eP ? e.r[eP] : ''),
      descripcion: txt(eD ? e.r[eD] : ''), cuenta: txt(eC ? e.r[eC] : ''),
      metodo: txt(eM ? e.r[eM] : ''),
      pedido: txt(ePed ? e.r[ePed] : ''), monto: e.m
    }));

    const suma = (a, k) => Math.round(a.reduce((t, x) => t + (x[k] || x.monto || 0), 0) * 100) / 100;
    return res.status(200).json({
      ok: true, anio: anio,
      totales: {
        manuales: manuales.length, banco: banco.length,
        conciliados: conciliados.length,
        sinPar: sinPar.length, montoSinPar: suma(sinPar, 'monto'),
        soloBanco: soloBanco.length, montoSoloBanco: suma(soloBanco, 'monto'),
        ajustes: ajustes.length, montoAjustes: suma(ajustes, 'monto')
      },
      porMetodoManual: (function () {
        const c = {};
        sinPar.forEach(x => { const k = x.metodo || 'Sin nota'; c[k] = c[k] || { n: 0, monto: 0 };
          c[k].n++; c[k].monto = Math.round((c[k].monto + x.monto) * 100) / 100; });
        return Object.keys(c).map(k => ({ metodo: k, n: c[k].n, monto: c[k].monto }))
          .sort((a, b) => b.monto - a.monto).slice(0, 10);
      })(),
      porMetodo: (function () {
        const c = {};
        soloBanco.forEach(x => { const k = x.metodo || 'Sin método'; c[k] = c[k] || { n: 0, monto: 0 };
          c[k].n++; c[k].monto = Math.round((c[k].monto + x.monto) * 100) / 100; });
        return Object.keys(c).map(k => ({ metodo: k, n: c[k].n, monto: c[k].monto }))
          .sort((a, b) => b.monto - a.monto);
      })(),
      porNivel: PASADAS.map(n => ({
        nivel: n.nombre, n: conciliados.filter(c => c.nivel === n.nombre).length
      })).filter(x => x.n),
      conciliados: conciliados.sort((a, b) => (b.dia || 0) - (a.dia || 0)),
      sinPar: sinPar.sort((a, b) => (b.dia || 0) - (a.dia || 0)),
      soloBanco: soloBanco.sort((a, b) => (b.dia || 0) - (a.dia || 0)),
      ajustes: ajustes.sort((a, b) => (b.dia || 0) - (a.dia || 0))
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
