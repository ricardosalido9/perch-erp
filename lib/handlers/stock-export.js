// Recalcula el Stock desde el archivo vivo de Operación y lo escribe en el consolidado.
// Stock no se captura: se deduce de lo pedido, lo que entró y lo que salió.
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
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ped, sal] = await Promise.all([leer('prov_pedidos'), leer('prov_salidas')]);
    if (!ped.headers.length) return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });

    const stock = {};
    const clave = (i, m) => txt(i) + ' | ' + txt(m);

    const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
    const pM = col(ped.headers, 'Material');
    const pC = col(ped.headers, 'Cantidad');
    const pE = col(ped.headers, 'Entradas');
    const pPr = col(ped.headers, 'Proveedor');
    const pF = col(ped.headers, 'Folio cliente');
    ped.rows.forEach(r => {
      const it = txt(pI ? r[pI] : '');
      if (!it) return;
      const k = clave(it, pM ? r[pM] : '');
      const e = stock[k] = stock[k] || { item: it, material: txt(pM ? r[pM] : ''),
        ped: 0, ent: 0, sal: 0, asig: 0, prov: {} };
      const c = pC ? num(r[pC]) : 0;
      e.ped += c;
      e.ent += pE ? num(r[pE]) : 0;
      if (pPr && txt(r[pPr])) e.prov[txt(r[pPr])] = 1;
      const fol = norm(pF ? r[pF] : '');
      if (fol && ['stock', 'exhibicion', ''].indexOf(fol) === -1) e.asig += c;
    });

    const sI = col(sal.headers, 'Productos', 'Producto', 'Item');
    const sM = col(sal.headers, 'Material');
    const sC = col(sal.headers, 'Cantidad');
    sal.rows.forEach(r => {
      const it = txt(sI ? r[sI] : '');
      if (!it) return;
      const k = clave(it, sM ? r[sM] : '');
      const e = stock[k] = stock[k] || { item: it, material: txt(sM ? r[sM] : ''),
        ped: 0, ent: 0, sal: 0, asig: 0, prov: {} };
      e.sal += sC ? num(r[sC]) : 0;
    });

    const filas = [['Item', 'Material', 'Proveedores', 'Pedidas', 'Entradas', 'Salidas',
      'Stock', 'Por llegar', 'Llegaron de más', 'Asignadas a venta']];
    const revisar = [['Item', 'Material', 'Piezas', 'Motivo']];
    let piezas = 0, porLlegar = 0;
    Object.keys(stock).sort().forEach(k => {
      const v = stock[k];
      const disp = v.ent - v.sal;
      const falta = Math.max(0, v.ped - v.ent);
      const extra = Math.max(0, v.ent - v.ped);
      if (disp > 0) piezas += disp;
      porLlegar += falta;
      filas.push([v.item, v.material, Object.keys(v.prov).sort().join(' / '),
        v.ped, v.ent, v.sal, disp, falta, extra, v.asig]);
      if (disp < 0) revisar.push([v.item, v.material, disp, 'Stock negativo: salieron más de las que entraron']);
      if (extra) revisar.push([v.item, v.material, extra, 'Llegaron más piezas de las pedidas']);
    });

    const dest = core.areaCfg ? await core.areaCfg('op_stock') : core.SHEETS.op_stock;
    if (!dest || !dest.id) return res.status(400).json({ error: 'No está configurado el archivo consolidado.' });
    await core.escribirTabla(dest.id, dest.sheetName || 'Stock', filas);
    await core.escribirTabla(dest.id, 'Revisar', revisar);

    return res.status(200).json({
      ok: true, combinaciones: filas.length - 1, piezas: piezas, porLlegar: porLlegar,
      revisar: revisar.length - 1,
      archivo: 'https://docs.google.com/spreadsheets/d/' + dest.id + '/edit'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
