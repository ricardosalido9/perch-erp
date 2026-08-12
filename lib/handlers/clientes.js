// Expediente de un cliente: todo lo que sabemos de él en un solo lugar.
// Junta Leads, Showroom, Cotizaciones, Ventas y la Lista de Clientes para responder:
// cuándo fue el primer contacto, cuántas cotizaciones se le mandaron, cuántas cerró,
// cuándo se le buscó por última vez y qué datos suyos faltan.
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
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return +m[3] * 10000 + MESES[m[2]] * 100 + +m[1];
  return null;
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
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

// Datos que un cliente debería tener completos. Se puede ajustar sin tocar nada más.
const OBLIGATORIOS = [
  { campo: 'Teléfono',           alias: ['Telefono', 'Tel', 'Celular'] },
  { campo: 'Despacho',           alias: ['Despacho/Cliente'] },
  { campo: 'Dirección de envío', alias: ['Direccion de envio', 'Dirección de Envío', 'Dirección', 'Direccion'] }
];

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [cli, lds, shw, cot, ven] = await Promise.all([
      leer('ventas_clientes'), leer('leads'), leer('showroom'), leer('cotizaciones'), leer('ventas_registro')
    ]);

    const fichas = {};
    const ficha = (nombre) => {
      const k = norm(nombre);
      if (!k) return null;
      if (!fichas[k]) fichas[k] = {
        cliente: txt(nombre), despacho: '', enLista: false, faltan: [],
        leads: 0, visitas: 0, cotizaciones: {}, ventas: {},
        primer: null, ultimo: null, montoCot: 0, montoVenta: 0, hitos: []
      };
      return fichas[k];
    };
    const marca = (f, d, tipo, detalle) => {
      if (d === null) return;
      if (f.primer === null || d < f.primer) f.primer = d;
      if (f.ultimo === null || d > f.ultimo) f.ultimo = d;
      if (f.hitos.length < 60) f.hitos.push({ fecha: d, tipo: tipo, detalle: detalle || '' });
    };

    // --- Lista de Clientes: es la ficha oficial ---
    if (cli.headers.length) {
      const cN = col(cli.headers, 'Cliente', 'Nombre/Razón Social', 'Contacto');
      const cD = col(cli.headers, 'Despacho');
      if (cN) cli.rows.forEach(r => {
        const f = ficha(r[cN]);
        if (!f) return;
        f.enLista = true;
        if (cD && txt(r[cD])) f.despacho = txt(r[cD]);
        OBLIGATORIOS.forEach(o => {
          const c = col(cli.headers, o.campo, ...(o.alias || []));
          // Si la hoja no tiene esa columna, no se puede exigir el dato
          if (c && !txt(r[c])) f.faltan.push(o.campo);
        });
      });
    }

    // --- Leads ---
    if (lds.headers.length) {
      const lN = col(lds.headers, 'Contacto', 'Cliente', 'Nombre');
      const lF = col(lds.headers, 'Fecha');
      const lV = col(lds.headers, 'Cómo Llego', 'Como llego', 'Cómo llegó');
      if (lN) lds.rows.forEach(r => {
        const f = ficha(r[lN]);
        if (!f) return;
        f.leads++;
        marca(f, lF ? fechaNum(r[lF]) : null, 'Lead', txt(lV ? r[lV] : ''));
      });
    }

    // --- Showroom ---
    if (shw.headers.length) {
      const sN = col(shw.headers, 'Cliente', 'Contacto');
      const sF = col(shw.headers, 'Fecha');
      const sNo = col(shw.headers, 'Notas', 'Comentarios');
      if (sN) shw.rows.forEach(r => {
        const f = ficha(r[sN]);
        if (!f) return;
        f.visitas++;
        const d = sF ? fechaNum(r[sF]) : null;
        f.detalleVisitas = f.detalleVisitas || [];
        f.detalleVisitas.push({ fila: r._fila, fecha: txt(sF ? r[sF] : ''), d: d,
                                notas: txt(sNo ? r[sNo] : '') });
        marca(f, d, 'Visita al showroom', txt(sNo ? r[sNo] : ''));
      });
    }

    // --- Cotizaciones: se cuentan por folio, no por renglón ---
    if (cot.headers.length) {
      const qN = col(cot.headers, 'Cliente');
      const qR = col(cot.headers, 'No. de Referencia', 'Folio');
      const qF = col(cot.headers, 'Fecha del Cierre', 'Fecha');
      const qS = col(cot.headers, 'Status');
      const qC = col(cot.headers, 'Cantidad'), qP = col(cot.headers, 'Precio Unitario');
      if (qN && qR) cot.rows.forEach(r => {
        const f = ficha(r[qN]);
        if (!f) return;
        const fol = txt(r[qR]);
        if (!fol) return;
        if (!f.cotizaciones[fol]) {
          f.cotizaciones[fol] = { folio: fol, status: txt(qS ? r[qS] : ''), total: 0,
                                  fecha: qF ? txt(r[qF]) : '', d: qF ? fechaNum(r[qF]) : null };
          marca(f, f.cotizaciones[fol].d, 'Cotización', fol);
        }
        f.cotizaciones[fol].total += (qC ? num(r[qC]) : 0) * (qP ? num(r[qP]) : 0);
      });
    }

    // --- Ventas ---
    if (ven.headers.length) {
      const vN = col(ven.headers, 'Cliente');
      const vR = col(ven.headers, 'No. de Referencia', 'Folio');
      const vF = col(ven.headers, 'Fecha del Cierre');
      const vT = col(ven.headers, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
      if (vN && vR) ven.rows.forEach(r => {
        const fol = txt(r[vR]);
        const t = vT ? num(r[vT]) : 0;
        if (!fol && !t) return;                       // fila de fórmula arrastrada
        const f = ficha(r[vN]);
        if (!f || !fol) return;
        if (!f.ventas[fol]) {
          f.ventas[fol] = { folio: fol, total: 0, fecha: vF ? txt(r[vF]) : '', d: vF ? fechaNum(r[vF]) : null };
          marca(f, f.ventas[fol].d, 'Venta', fol);
        }
        f.ventas[fol].total += t;
      });
    }

    const hoy = (() => { const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
    const diasDesde = (d) => {
      if (d === null) return null;
      const a = new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
      return Math.round((Date.now() - a.getTime()) / 86400000);
    };

    let lista = Object.keys(fichas).map(k => {
      const f = fichas[k];
      const cots = Object.keys(f.cotizaciones).map(x => f.cotizaciones[x]);
      const vtas = Object.keys(f.ventas).map(x => f.ventas[x]);
      // Cotizaciones que se cerraron. Nunca puede haber más ganadas que cotizaciones:
      // si hay ventas sin cotización previa, esas no cuentan para la conversión.
      const ganadas = Math.min(
        Math.max(cots.filter(c => /vendida/i.test(c.status)).length, vtas.length),
        cots.length);
      return {
        cliente: f.cliente, despacho: f.despacho, enLista: f.enLista, faltan: f.faltan,
        leads: f.leads, visitas: f.visitas,
        cotizaciones: cots.length, vendidas: ganadas,
        ventas: vtas.length,
        // Ventas que no vinieron de una cotización registrada
        ventasSinCotizar: Math.max(0, vtas.length - cots.length),
        montoCotizado: Math.round(cots.reduce((a, x) => a + x.total, 0) * 100) / 100,
        montoVendido: Math.round(vtas.reduce((a, x) => a + x.total, 0) * 100) / 100,
        conversion: cots.length ? Math.round((ganadas / cots.length) * 100) : null,
        primerContacto: f.primer, ultimoMovimiento: f.ultimo,
        diasSinContacto: diasDesde(f.ultimo),
        abiertas: cots.filter(c => !/vendida|rechazad/i.test(c.status)).length,
        detalleCotizaciones: cots.sort((a, b) => (b.d || 0) - (a.d || 0)),
        detalleVentas: vtas.sort((a, b) => (b.d || 0) - (a.d || 0)),
        detalleVisitas: (f.detalleVisitas || []).sort((a, b) => (b.d || 0) - (a.d || 0)),
        hitos: f.hitos.sort((a, b) => (b.fecha || 0) - (a.fecha || 0)).slice(0, 20)
      };
    });

    const q = norm(body.buscar || '');
    if (q) lista = lista.filter(x => norm(x.cliente).indexOf(q) !== -1);
    lista.sort((a, b) => (b.ultimoMovimiento || 0) - (a.ultimoMovimiento || 0));

    return res.status(200).json({
      ok: true,
      obligatorios: OBLIGATORIOS.map(o => o.campo),
      clientes: lista.slice(0, 500),
      totales: {
        clientes: lista.length,
        soloLead: lista.filter(x => x.leads && !x.cotizaciones).length,
        conCotizacion: lista.filter(x => x.cotizaciones).length,
        conVenta: lista.filter(x => x.ventas).length,
        sinFicha: lista.filter(x => !x.enLista).length,
        conDatosFaltantes: lista.filter(x => x.faltan.length).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
