// Para el botón "Mandar a venta": dice qué ventas pidieron cada producto
// y todavía no tienen una salida registrada.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
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

    const [ven, sal] = await Promise.all([leer('ventas_registro'), leer('prov_salidas')]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });

    // Lo que ya salió, por folio + producto
    const yaSalio = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio cliente', 'Folio');
      const sI = col(sal.headers, 'Item', 'Productos', 'Producto');
      const sC = col(sal.headers, 'Cantidad');
      if (sF && sI) sal.rows.forEach(r => {
        const k = txt(r[sF]).toUpperCase() + '|' + norm(r[sI]);
        yaSalio[k] = (yaSalio[k] || 0) + (sC ? num(r[sC]) : 0);
      });
    }

    const vF = col(ven.headers, 'No. de Referencia', 'Referencia', 'Folio');
    const vP = col(ven.headers, 'Producto', 'Productos');
    const vM = col(ven.headers, 'Material');
    const vC = col(ven.headers, 'Cantidad');
    const vCl = col(ven.headers, 'Cliente');
    const vFe = col(ven.headers, 'Fecha del Cierre');
    const vSt = col(ven.headers, 'Status');
    const vDir = col(ven.headers, 'Direccion de envio', 'Dirección de envío', 'Dirección de Entrega');
    if (!vF || !vP) return res.status(400).json({ error: 'VENTAS no tiene folio o producto.' });

    // Una entrada por venta + producto, con cuánto falta por surtir
    const pend = [];
    ven.rows.forEach(r => {
      const f = txt(r[vF]).toUpperCase();
      const p = txt(r[vP]);
      if (!f || !p) return;
      const cant = vC ? num(r[vC]) : 0;
      if (!cant) return;
      const salido = yaSalio[f + '|' + norm(p)] || 0;
      const falta = cant - salido;
      if (falta <= 0) return;                       // ya se surtió
      pend.push({
        folio: f, producto: p, material: vM ? txt(r[vM]) : '',
        cliente: vCl ? txt(r[vCl]) : '', fecha: vFe ? txt(r[vFe]) : '',
        status: vSt ? txt(r[vSt]) : '',
        pedidas: cant, surtidas: salido, faltan: falta,
        direccion: vDir ? txt(r[vDir]) : ''
      });
    });

    // Si piden productos concretos, solo se devuelven esos
    const filtro = (body.productos || []).map(norm).filter(Boolean);
    const salida = filtro.length
      ? pend.filter(x => filtro.indexOf(norm(x.producto)) !== -1)
      : pend;

    salida.sort((a, b) => (a.folio < b.folio ? 1 : -1));
    return res.status(200).json({ ok: true, pendientes: salida.slice(0, 400), total: salida.length });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
