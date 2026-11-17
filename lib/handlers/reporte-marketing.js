// ===== Reporte de marketing: B2B vs B2C y todo lo que se captura al cerrar =====
//
// Camila, 17 nov: *"en cada cotización y venta lleno esta parte donde se
// especifica qué tipo de cliente hizo la compra, en especial si es B2B o B2C,
// pero en el reporte no veo dónde esté marcada esta estadística"*.
//
// Tenía razón en lo que importa: **ese dato no tenía reporte propio**. Lo único
// que existía era un panel dentro del Tablero, mezclado entre otros quince, y
// que solo aparece si la pestaña Marketing se logró leer. Nada que Camila
// pudiera abrir, revisar y mandar.
//
// Esto lee la pestaña **Marketing** —un renglón por pedido cerrado, con Ciudad,
// Proyecto, Cómo Llegó, Línea de Negocio, Tipo de Línea (B2B/B2C), Showroom y
// Happening— y arma el corte de cada una.
//
//   ?action=reporte-marketing            → todo el año en curso
//   ?action=reporte-marketing&anio=2026&mes=11
const core = require('../core');

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fecha(v) {
  const t = txt(v);
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
    }
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { anio: +m[1], mes: +m[2] };
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) { let a = +m[3]; if (a < 100) a += 2000; return { anio: a, mes: +m[2] }; }
  m = norm(t).match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de\s+)?(\d{4})/);
  if (m) { const i = MESES.indexOf(m[2]); if (i >= 0) return { anio: +m[3], mes: i + 1 }; }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : { anio: d.getFullYear(), mes: d.getMonth() + 1 };
}
// "SI", "Si", "sí", "x", "TRUE" y "1" son la misma respuesta. Sin
// estandarizarlas, cada forma de escribirla sale como una categoría distinta.
function siNo(v) {
  const n = norm(v);
  if (!n || n === 'na' || n === 'n/a' || n === '-') return 'Sin especificar';
  if (/^(si|s|x|true|verdadero|1|yes|ya)$/.test(n)) return 'Sí';
  if (/^(no|n|false|falso|0|ninguno|nunca)$/.test(n)) return 'No';
  return txt(v);
}
const lleno = (v) => (txt(v) ? txt(v) : 'Sin especificar');

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [], cfg: null, error: e.message }; }
  if (!values || !values.length) return { headers: [], rows: [], cfg };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = {}; let algo = false;
    H.forEach((h, j) => { if (h) { o[h] = f[j] == null ? '' : f[j]; if (txt(f[j])) algo = true; } });
    if (algo) { o.__fila = i + 1; rows.push(o); }
  }
  return { headers: H, rows, cfg };
}

// Agrupa y ordena de mayor a menor monto, con su porcentaje
function cortar(filas, saca) {
  const g = {};
  let total = 0, pedidos = 0;
  filas.forEach(f => {
    const k = saca(f);
    const x = g[k] = g[k] || { que: k, pedidos: 0, monto: 0, piezas: 0 };
    x.pedidos++; x.monto += f.monto; x.piezas += f.piezas;
    total += f.monto; pedidos++;
  });
  return Object.keys(g).map(k => g[k]).sort((a, b) => b.monto - a.monto).map(x => ({
    que: x.que,
    pedidos: x.pedidos,
    piezas: Math.round(x.piezas),
    monto: Math.round(x.monto * 100) / 100,
    pctMonto: total ? Math.round(x.monto / total * 1000) / 10 : 0,
    pctPedidos: pedidos ? Math.round(x.pedidos / pedidos * 1000) / 10 : 0,
    ticket: x.pedidos ? Math.round(x.monto / x.pedidos * 100) / 100 : 0
  }));
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    const mk = await leer('marketing');
    if (!mk.headers.length) {
      return res.status(400).json({
        error: 'No se pudo leer la pestaña "Marketing" del archivo de Ventas.' +
               (mk.error ? ' (' + mk.error + ')' : '')
      });
    }
    const H = mk.headers;
    const cF  = col(H, 'Fecha del Cierre', 'Fecha');
    const cRef = col(H, 'No. de Referencia', 'Folio');
    const cTot = col(H, 'Total Pedido', 'Total');
    const cEnv = col(H, 'Envio', 'Envío');
    const cPz  = col(H, 'Productos', 'Piezas', 'Cantidad');
    const cTL  = col(H, 'Tipo de Línea', 'Tipo de Linea', 'Tipo de Cliente');
    const cLin = col(H, 'Línea de Negocio', 'Linea de Negocio');
    const cProy = col(H, 'Proyecto', 'Tipo de Proyecto');
    const cComo = col(H, 'Cómo Llego', 'Cómo Llegó', 'Como Llego', 'Como Llegó');
    const cCity = col(H, 'Ciudad');
    const cShow = col(H, 'Showroom', 'Visito Showroom');
    const cHap = col(H, 'Happening');
    const cCli = col(H, 'Cliente');
    const cDesp = col(H, 'Despacho');
    if (!cTL) {
      return res.status(400).json({
        error: 'La pestaña Marketing no tiene la columna "Tipo de Línea", que es donde se ' +
               'captura B2B o B2C. Encabezados leídos: ' + H.filter(Boolean).join(' | ')
      });
    }

    // ---- Filtro de periodo ----
    const hoy = core.ahoraMx ? new Date() : new Date();
    const anio = body.anio ? +body.anio : hoy.getFullYear();
    const mes = body.mes ? +body.mes : 0;          // 0 = todo el año

    const todas = [], anios = {};
    let sinFecha = 0, sinTipo = 0;
    mk.rows.forEach(r => {
      const f = fecha(r[cF]);
      if (!f) { sinFecha++; return; }
      anios[f.anio] = 1;
      const tl = txt(cTL ? r[cTL] : '');
      if (!tl) sinTipo++;
      todas.push({
        anio: f.anio, mes: f.mes,
        folio: cRef ? txt(r[cRef]) : '',
        cliente: cCli ? txt(r[cCli]) : '',
        despacho: cDesp ? txt(r[cDesp]) : '',
        monto: (cTot ? num(r[cTot]) : 0) + (cEnv ? num(r[cEnv]) : 0),
        piezas: cPz ? num(r[cPz]) : 0,
        tl: lleno(tl),
        lin: cLin ? lleno(r[cLin]) : 'Sin especificar',
        proy: cProy ? lleno(r[cProy]) : 'Sin especificar',
        como: cComo ? lleno(r[cComo]) : 'Sin especificar',
        city: cCity ? lleno(r[cCity]) : 'Sin especificar',
        show: cShow ? siNo(r[cShow]) : 'Sin especificar',
        hap: cHap ? siNo(r[cHap]) : 'Sin especificar'
      });
    });

    const delPeriodo = todas.filter(x => x.anio === anio && (!mes || x.mes === mes));

    // ---- B2B vs B2C mes por mes, que es la pregunta de fondo ----
    const porMes = [];
    for (let m = 1; m <= 12; m++) {
      const delMes = todas.filter(x => x.anio === anio && x.mes === m);
      if (!delMes.length) continue;
      const fila = { mes: m, nombre: MESES[m - 1], pedidos: delMes.length, monto: 0, tipos: {} };
      delMes.forEach(x => {
        fila.monto += x.monto;
        const t = fila.tipos[x.tl] = fila.tipos[x.tl] || { pedidos: 0, monto: 0 };
        t.pedidos++; t.monto += x.monto;
      });
      fila.monto = Math.round(fila.monto * 100) / 100;
      Object.keys(fila.tipos).forEach(k => {
        fila.tipos[k].monto = Math.round(fila.tipos[k].monto * 100) / 100;
      });
      porMes.push(fila);
    }

    return res.status(200).json({
      ok: true,
      anio, mes,
      anios: Object.keys(anios).sort().reverse(),
      pedidos: delPeriodo.length,
      monto: Math.round(delPeriodo.reduce((a, x) => a + x.monto, 0) * 100) / 100,
      piezas: Math.round(delPeriodo.reduce((a, x) => a + x.piezas, 0)),
      sinTipo,
      sinFecha,
      // El corte que pidió Camila, primero
      tipoLinea: cortar(delPeriodo, x => x.tl),
      porMes,
      cortes: [
        { titulo: 'Línea de negocio', filas: cortar(delPeriodo, x => x.lin) },
        { titulo: 'Tipo de proyecto', filas: cortar(delPeriodo, x => x.proy) },
        { titulo: 'Cómo llegó', filas: cortar(delPeriodo, x => x.como) },
        { titulo: 'Ciudad', filas: cortar(delPeriodo, x => x.city) },
        { titulo: '¿Visitó el showroom?', filas: cortar(delPeriodo, x => x.show) },
        { titulo: 'Happening', filas: cortar(delPeriodo, x => x.hap) }
      ],
      base: 'Total del pedido más envío, como está capturado en la pestaña Marketing. ' +
            'Un renglón por pedido cerrado.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
