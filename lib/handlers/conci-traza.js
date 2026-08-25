// Por qué un renglón de Gastos Manuales no cruzó con EGRESOS.
// Se abre directo en el navegador, SIN sesión:
//   /api/erp?action=conci-traza&fila=222
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
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fecha(v) {
  if (v instanceof Date) return Math.floor(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()) / 86400000);
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Math.floor(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000);
  m = s.replace(/,/g, ' ').replace(/\s+/g, ' ')
        .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return Math.floor(Date.UTC(+m[3], MESES[m[2]] - 1, +m[1]) / 86400000);
  return null;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(hoja) {
  const cfg = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;
  if (!cfg || !cfg.id) return { headers: [], rows: [], error: 'Sin archivo de Operación configurado.' };
  let values;
  try { values = await core.readRange(cfg.id, hoja); }
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
    const q = req.query || {};
    const body = req._body || {};
    const fila = +(q.fila || q.f || body.fila) || 0;
    if (!fila) return res.status(400).json({ error: 'Falta ?fila=NUMERO' });

    const [gm, eg] = await Promise.all([leer('Gastos Manuales'), leer('EGRESOS')]);
    if (!gm.headers.length) return res.status(400).json({ error: 'No se pudo leer Gastos Manuales.', detalle: gm.error });
    if (!eg.headers.length) return res.status(400).json({ error: 'No se pudo leer EGRESOS.', detalle: eg.error });

    const gF = col(gm.headers, 'Fecha'), gT = col(gm.headers, 'Total con IVA', 'Total');
    const gP = col(gm.headers, 'Proveedor'), gPed = col(gm.headers, 'Pedido');
    const gPag = col(gm.headers, 'Pagado'), gD = col(gm.headers, 'Descripción', 'Descripcion');
    const eF = col(eg.headers, 'Fecha'), eT = col(eg.headers, 'Total');
    const eP = col(eg.headers, 'Proveedor'), ePed = col(eg.headers, 'Pedido');
    const eD = col(eg.headers, 'Descripción', 'Descripcion');

    const g = gm.rows.filter(r => r._fila === fila)[0];
    if (!g) return res.status(404).json({ error: 'No hay fila ' + fila + ' en Gastos Manuales.' });

    const m = num(g[gT]), d = fecha(g[gF]), ped = norm(gPed ? g[gPed] : '');
    const prov = norm(gP ? g[gP] : '');

    // Otros gastos manuales que compiten por el mismo movimiento del banco
    const competidores = gm.rows.filter(r => r._fila !== fila &&
      ((ped && norm(gPed ? r[gPed] : '') === ped) || (m !== null && Math.abs((num(r[gT]) || 0) - m) <= 1)))
      .slice(0, 10).map(r => ({
        fila: r._fila, fecha: txt(r[gF]), monto: num(r[gT]),
        pedido: txt(gPed ? r[gPed] : ''), descripcion: txt(gD ? r[gD] : '')
      }));

    const candidatos = eg.rows.filter(r => {
      const em = num(r[eT]);
      return (ped && norm(ePed ? r[ePed] : '') === ped) || (m !== null && em !== null && Math.abs(em - m) <= 1);
    }).slice(0, 15).map(r => ({
      fila: r._fila, fechaCruda: txt(r[eF]), fechaLeida: fecha(r[eF]),
      montoCrudo: txt(r[eT]), montoLeido: num(r[eT]),
      pedido: txt(ePed ? r[ePed] : ''), proveedor: txt(eP ? r[eP] : ''),
      descripcion: txt(eD ? r[eD] : ''),
      mismoPedido: !!ped && norm(ePed ? r[ePed] : '') === ped,
      mismoProveedor: !!prov && norm(eP ? r[eP] : '') === prov,
      diferenciaMonto: (m !== null && num(r[eT]) !== null) ? Math.round((num(r[eT]) - m) * 100) / 100 : null,
      diferenciaDias: (d !== null && fecha(r[eF]) !== null) ? Math.abs(fecha(r[eF]) - d) : null
    }));

    return res.status(200).json({
      ok: true,
      gastoManual: {
        fila: fila, fechaCruda: txt(g[gF]), fechaLeida: d,
        montoCrudo: txt(g[gT]), montoLeido: m,
        pedidoCrudo: txt(gPed ? g[gPed] : ''), proveedor: txt(gP ? g[gP] : ''),
        pagadoCrudo: txt(gPag ? g[gPag] : '(sin columna Pagado)'),
        descripcion: txt(gD ? g[gD] : '')
      },
      candidatosEnEgresos: candidatos,
      otrosGastosQueCompiten: competidores,
      lectura: {
        columnasGastos: gm.headers.filter(Boolean),
        columnasEgresos: eg.headers.filter(Boolean),
        totalGastos: gm.rows.length, totalEgresos: eg.rows.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
