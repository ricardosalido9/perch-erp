// La relación de entregas que se le manda al proveedor.
//
// Sale directo de Pedidos a proveedores, que ya guarda un renglón por producto.
// Por eso dos muebles del mismo pedido pueden tener fechas de entrega distintas:
// la fecha vive en el renglón, no en el pedido. Era la duda de Nico.
//
//   ?action=entregas-pdf  { proveedor, desde, hasta, soloPendientes }
const core = require('../core');
const CFG = require('../config');
const { relacionParaProveedor } = require('../pdf-entregas');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const MES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
                sept:9, oct:10, nov:11, dic:12 };

// La fecha se muestra como la escribe Nico: 14/septiembre/2026
function comoFecha(v) {
  if (v instanceof Date) {
    return v.getDate() + '/' + MESES[v.getMonth()] + '/' + v.getFullYear();
  }
  const s = txt(v);
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return (+m[3]) + '/' + MESES[+m[2] - 1] + '/' + m[1];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return (+m[1]) + '/' + MESES[+m[2] - 1] + '/' + m[3];
  return s;   // si ya viene escrita a mano, se respeta
}
function aNumero(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth()+1) * 100 + v.getDate();
  const s = norm(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.match(/^(\d{1,2})\s*\/?\s*([a-z]+)\s*\/?\s*(\d{4})/);
  if (m) {
    const mes = MES_N[m[2].slice(0, 4)] || MES_N[m[2].slice(0, 3)];
    if (mes) return +m[3]*10000 + mes*100 + +m[1];
  }
  return 0;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows };
}
function col(H, ...ns) {
  for (const n of ns) { const c = H.filter(x => norm(x) === norm(n))[0]; if (c) return c; }
  return null;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const quien = txt(body.proveedor);
    if (!quien) return res.status(400).json({ error: 'Falta el proveedor.' });

    const [ped, ven] = await Promise.all([leer('prov_pedidos'), leer('ventas_registro')]);
    if (!ped.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer Pedidos a proveedores.' });
    }
    const H = ped.headers;
    const cProv = col(H, 'Proveedor');
    const cPed  = col(H, 'Pedido Proveedor', 'Pedido');
    const cItem = col(H, 'Productos', 'Producto', 'Item');
    const cMat  = col(H, 'Material');
    const cCant = col(H, 'Cantidad');
    const cFol  = col(H, 'Folio cliente', 'Folio Cliente', 'Folio', 'Pedido Cliente');
    const cEst  = col(H, 'Fecha Estimada de Entrega', 'Fecha estimada de entrega');
    const cTela = col(H, 'Tela');
    const cEsp  = col(H, 'Especificaciones', 'Especificacion', 'Detalles');
    // No hay columna "Status Tela" y no hace falta: el Status del renglón del
    // pedido dice lo mismo (por entregar / entregado) y ya existe.
    const cStat = col(H, 'Status Tela', 'Status de Tela', 'Status');
    const cCom  = col(H, 'Comentarios', 'Comentario', 'Notas', 'Observaciones');
    if (!cProv) return res.status(400).json({ error: 'Pedidos a proveedores no tiene columna "Proveedor".' });

    // El cliente sale de VENTAS, buscándolo por el folio
    const cliente = {};
    if (ven.headers.length) {
      const vF = col(ven.headers, 'No. de Referencia', 'No de Referencia', 'Folio');
      const vC = col(ven.headers, 'Cliente');
      if (vF && vC) ven.rows.forEach(r => {
        const f = txt(r[vF]);
        if (f && !cliente[norm(f)]) cliente[norm(f)] = txt(r[vC]);
      });
    }

    const desde = aNumero(body.desde) || 0;
    const hasta = aNumero(body.hasta) || 99999999;
    const soloPend = !!body.soloPendientes;

    const renglones = [];
    let sinFecha = 0;
    ped.rows.forEach(r => {
      if (norm(r[cProv]) !== norm(quien)) return;
      const est = cStat ? txt(r[cStat]) : '';
      if (soloPend && /entregad/i.test(est)) return;
      const f = cEst ? aNumero(r[cEst]) : 0;
      if (!f) sinFecha++;
      else if (f < desde || f > hasta) return;
      const fol = cFol ? txt(r[cFol]) : '';
      // Tela y Especificaciones van juntas en una sola columna, como en el control
      const tela = [cTela ? txt(r[cTela]) : '', cEsp ? txt(r[cEsp]) : '']
                   .filter(Boolean).join(' · ');
      renglones.push({
        folio: fol || 'Sin asignar',
        cantidad: cCant ? num(r[cCant]) : '',
        item: cItem ? txt(r[cItem]) : '',
        material: cMat ? txt(r[cMat]) : '',
        tela: tela,
        status: est,
        comentarios: cCom ? txt(r[cCom]) : '',
        pedido: cPed ? txt(r[cPed]) : '',
        cliente: cliente[norm(fol)] || (fol ? '' : ''),
        entrega: cEst ? comoFecha(r[cEst]) : '',
        _orden: f || 99999999
      });
    });
    if (!renglones.length) {
      return res.status(404).json({
        error: 'No hay renglones de ' + quien + ' en ese rango.',
        pista: 'Revisa que el nombre del proveedor esté escrito igual que en Pedidos a ' +
               'proveedores, y que los renglones tengan Fecha Estimada de Entrega.'
      });
    }
    // Por fecha de entrega, que es como se lee un control de producción
    renglones.sort((a, b) => a._orden - b._orden);

    const hoy = new Date();
    const buf = await relacionParaProveedor(
      { proveedor: quien, renglones: renglones },
      { fecha: hoy.getDate() + '/' + (hoy.getMonth() + 1) + '/' + hoy.getFullYear(),
        hechoPor: txt(body.hechoPor) });

    // Las columnas que no existen se avisan: el PDF sale igual, pero vacío en
    // esa columna, y sin decirlo nadie sabría por qué.
    const faltan = [];
    if (!cTela) faltan.push('Tela');
    if (!cEsp) faltan.push('Especificaciones');
    if (!cCom) faltan.push('Comentarios');
    if (!cEst) faltan.push('Fecha Estimada de Entrega');

    return res.status(200).json({
      ok: true,
      pdf: buf.toString('base64'),
      nombre: 'Relacion de entregas - ' + quien + '.pdf',
      renglones: renglones.length,
      sinFecha: sinFecha,
      faltan: faltan
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
