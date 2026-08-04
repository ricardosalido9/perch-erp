const core = require('../lib/core');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  // Formato contable de las hojas:  -$ 1,234.00-  (los guiones de los extremos son formato)
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
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
  // Si core.js quedara desactualizado (sin areaCfg), se usa la config directa
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
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

// Días transcurridos desde una fecha AAAAMMDD
function _diasDesde(d) {
  const a = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100;
  const t = Date.UTC(a, m - 1, dd);
  const hoy = new Date();
  const h = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((h - t) / 86400000);
}

// ===== Funnel de ventas (pestaña "Montse 2026") =====
// La hoja es una BITÁCORA DE CONTACTOS, no un listado de cotizaciones:
//   MES · Prioridad · Cliente · Despacho · TIPO CLIENTE · Forma de Contacto · Mail · NOTAS ·
//   Fecha contacto · Visito Showroom · Cotización · Estatus · Valor Venta · Valor Cotización
// "Cotización" = qué se le mandó (Información / Cotizacion / Catálogo). "Estatus" = texto libre.
const F_ETAPA = [
  { cat: 'cotizacion', re: /cotizacion|enviada/ },      // se le mandó una cotización
  { cat: 'catalogo',   re: /catalogo|price ?list/ },
  { cat: 'info',       re: /informacion|por enviar/ }
];
const F_RESULT = [
  { cat: 'perdida', re: /cancelad|decidio otra|no se cerro|no interesad|declin|rebot/ },
  { cat: 'ganada',  re: /venta cerrada|venta exitosa|cliente exitos|clienta exitos|exitosa|exitoso|pagada|pagado|por pagar|cerrada|cerrado/ },
  { cat: 'perdida', re: /sin respuesta|sin respuestra|no dio respuesta|no ha dado respuesta|no respondio|sin repuesta/ },
  { cat: 'abierta', re: /esperando|espera|seguimiento|en proceso|en contacto|pendiente|si responde|nos tendra|nos tiene|revisar|volver a buscar|por visitar|escogimos|va tarde|darle seguimiento|confrimar|confirmar|cita/ }
];
function clasifPor(lista, v) {
  const n = norm(v);
  if (!n || n === 'na' || n === 'n/a' || n === '-' || n === '--') return null;   // "NA" = sin dato
  for (const g of lista) if (g.re.test(n)) return g.cat;
  return 'otro';
}
// Fecha: usa "Fecha contacto" en cualquiera de sus formas; si no, el mes de la columna MES.
function fechaFunnel(v, mesFallback, anio) {
  const base = fechaNum(v);
  if (base !== null) return base;
  const s = norm(v);
  let m = s.match(/^(\d{1,2})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{2})$/);        // 02-03-26
  if (m) return (2000 + (+m[3])) * 10000 + (+m[2]) * 100 + (+m[1]);
  m = s.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)$/);                             // "13 abril" / "18 de marzo"
  if (m && MESES[m[2]]) return anio * 10000 + MESES[m[2]] * 100 + (+m[1]);
  m = s.match(/^([a-z]+)\s*(\d{1,2})$/);                                       // "20 marzo" invertido
  if (m && MESES[m[1]]) return anio * 10000 + MESES[m[1]] * 100 + (+m[2]);
  m = s.match(/^([a-z]+)$/);                                                   // "Enero"
  if (m && MESES[m[1]]) return anio * 10000 + MESES[m[1]] * 100 + 1;
  if (mesFallback) return anio * 10000 + mesFallback * 100 + 1;
  return null;
}
function mesDeTexto(v) {
  const s = norm(v);
  const n = parseInt(s, 10);                       // CxC guarda el mes como número (1..12)
  if (!isNaN(n) && n >= 1 && n <= 12 && /^\d+$/.test(s)) return n;
  for (const k in MESES) if (s === k || s.indexOf(k + ' ') === 0 || s.indexOf(k) === 0) return MESES[k];
  return null;
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

    // ===== Marketing (misma base, otra pestaña; por pedido) =====
    let marketing = [];
    try {
      const mk = await leer('marketing');
      const Hm = mk.headers;
      const mF   = col(Hm, 'Fecha del Cierre', 'Fecha');
      const mTot = colMonto(Hm, mk.rows, ['Total con envio sin impuestos', 'Total con envío sin impuestos', 'Total Pedido', 'Total']);
      const mCli = col(Hm, 'Cliente');
      const mCity = col(Hm, 'Ciudad');
      const mProy = col(Hm, 'Proyecto');
      const mComo = col(Hm, 'Cómo Llego', 'Cómo Llegó', 'Como Llego', 'Como Llegó');
      const mLin  = col(Hm, 'Línea de Negocio', 'Linea de Negocio');
      const mTL   = col(Hm, 'Tipo de Línea', 'Tipo de Linea');
      const mShow = col(Hm, 'Showroom');
      const mHap  = col(Hm, 'Happening');
      const lim  = (v) => { const s = txt(v); return s ? s : 'Sin especificar'; };
      const limH = (v) => { const s = txt(v); const n = s.toLowerCase(); return (!s || n === 'na' || n === 'n/a' || n === '-') ? 'Sin especificar' : s; };
      marketing = mk.rows.map(r => ({
        d:    mF ? fechaNum(r[mF]) : null,
        tot:  mTot ? num(r[mTot]) : null,
        city: mCity ? lim(r[mCity]) : 'Sin especificar',
        proy: mProy ? lim(r[mProy]) : 'Sin especificar',
        como: mComo ? lim(r[mComo]) : 'Sin especificar',
        lin:  mLin ? lim(r[mLin]) : 'Sin especificar',
        tl:   mTL ? lim(r[mTL]) : 'Sin especificar',
        show: mShow ? (txt(r[mShow]) || 'Sin especificar') : 'Sin especificar',
        hap:  mHap ? limH(r[mHap]) : 'Sin especificar',
        cli:  mCli ? txt(r[mCli]) : ''
      })).filter(x => x.d !== null && x.tot !== null);
    } catch (e) { marketing = []; }

    // ===== Metas mensuales =====
    let metas = [];
    try {
      const mt = await leer('metas');
      const Ht = mt.headers;
      const tPer = col(Ht, 'Periodo', 'Fecha del Cierre', 'Fecha');
      const tMes = col(Ht, 'Mes');
      const tMV  = col(Ht, 'Meta Ventas', 'Meta de Ventas', 'Meta ventas');
      const tMU  = col(Ht, 'Meta Utilidad Bruta', 'Meta Utilidad', 'Meta de Utilidad');
      const numG = (v) => { const s = String(v == null ? '' : v).replace(/[^0-9.]/g, ''); const n = parseFloat(s); return isNaN(n) ? 0 : n; };
      metas = mt.rows.map(r => {
        const f = tPer ? fechaNum(r[tPer]) : null;
        let anio = null, mes = null;
        if (f !== null) { anio = Math.floor(f / 10000); mes = Math.floor(f / 100) % 100; }
        if ((!mes) && tMes) mes = parseInt(numG(r[tMes]), 10) || null;
        return { anio: anio, mes: mes, mv: tMV ? numG(r[tMV]) : 0, mu: tMU ? numG(r[tMU]) : 0 };
      }).filter(x => x.anio && x.mes && (x.mv || x.mu));
    } catch (e) { metas = []; }

    // ===== Cuentas por Cobrar — el PEDIDO completo (pestaña CxC) =====
    // Aquí cada fila es un pedido entero (en VENTAS cada fila es un producto).
    // Se mandan las filas con fecha para que el dashboard respete el filtro de periodo.
    let cxc = { ok: false, motivo: '', cols: {}, headers: [], rows: [] };
    try {
      const cx = await leer('fin_cxc');
      const Hc = cx.headers;
      if (!Hc.length) throw new Error('No se pudo leer la pestaña CxC (¿compartida con la cuenta de servicio?).');

      // Los montos vienen como  -$ 1,234.00-  ; los sobrepagos como  -$ -930.00-
      const numCx = (v) => {
        let t = String(v == null ? '' : v).replace(/[$\s]/g, '');
        if (t.charAt(0) === '-') t = t.slice(1);
        if (t.charAt(t.length - 1) === '-') t = t.slice(0, -1);
        const neg = t.charAt(0) === '-';
        const n = parseFloat(t.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? 0 : (neg ? -n : n);
      };
      const cRef  = col(Hc, 'No. de Referencia', 'No de Referencia', 'Referencia', 'Folio');
      const cCli  = col(Hc, 'Cliente');
      const cDesp = col(Hc, 'Despacho');
      const cProd = col(Hc, 'Productos', 'Producto');
      const cTot  = col(Hc, 'Total con envío', 'Total con envio') || col(Hc, 'Total Pedido', 'Total');
      const cPzs  = col(Hc, 'Productos', 'Piezas', 'Cantidad');       // número de piezas del pedido
      const cComo = col(Hc, 'Cómo entró la venta', 'Como entro la venta', 'Cómo Llegó');
      const cEnv  = col(Hc, 'Envio', 'Envío');
      const cPag  = col(Hc, 'Pagado');
      const cPC   = col(Hc, 'Por cobrar', 'Por Cobrar', 'Saldo');
      const cAnt  = col(Hc, 'Anticipo');
      const cFin  = col(Hc, 'Finiquito');
      const cFac  = col(Hc, 'Factura Si/No', 'Factura', 'Factura Si / No');
      const cFP   = col(Hc, 'Forma de pago', 'Forma de Pago', 'Método de pago');
      const cF    = col(Hc, 'Fecha del Cierre', 'Fecha');
      const cFE   = col(Hc, 'Fecha de Entrega', 'Fecha de entrega');
      const cMes  = col(Hc, 'Mes', 'MES');
      if (!cTot) throw new Error('No se encontró la columna de total del pedido. Encabezados: ' + Hc.filter(Boolean).join(' | '));

      const anioCx = new Date().getFullYear();
      const rows = [];
      let cancelados = 0;
      cx.rows.forEach(r => {
        const ref = cRef ? txt(r[cRef]) : '';
        const tot = numCx(r[cTot]);
        if (!ref && !tot) return;                        // fila vacía o de relleno
        // Pedidos cancelados: se cuentan aparte, no suman a facturado ni a cobranza
        const marca = norm((cPC ? txt(r[cPC]) : '') + ' ' + (cFE ? txt(r[cFE]) : ''));
        if (/cancelad/.test(marca)) { cancelados++; return; }
        const pag = cPag ? numCx(r[cPag]) : 0;
        const pc  = cPC ? numCx(r[cPC]) : (tot - pag);
        let d = cF ? fechaNum(r[cF]) : null;
        if (d === null && cMes) {                        // sin fecha: se usa el mes (día 1)
          const m = mesDeTexto(r[cMes]);
          if (m) d = anioCx * 10000 + m * 100 + 1;
        }
        rows.push({
          d: d,
          dias: d !== null ? _diasDesde(d) : null,
          f:    cF ? txt(r[cF]) : '',
          fe:   cFE ? txt(r[cFE]) : '',
          ref:  ref,
          cli:  cCli ? txt(r[cCli]) : '',
          desp: cDesp ? txt(r[cDesp]) : '',
          prod: cProd ? txt(r[cProd]) : '',
          tot:  tot,
          env:  cEnv ? numCx(r[cEnv]) : 0,
          pzs:  cPzs ? (parseInt(String(r[cPzs]).replace(/[^0-9]/g, ''), 10) || 0) : 0,
          pag:  pag,
          pc:   pc,
          ant:  cAnt ? numCx(r[cAnt]) : 0,
          fin:  cFin ? numCx(r[cFin]) : 0,
          como: cComo ? (txt(r[cComo]) || 'Sin especificar') : 'Sin especificar',
          fac:  cFac ? (txt(r[cFac]) || 'Sin especificar') : 'Sin especificar',
          fp:   cFP ? (txt(r[cFP]) || 'Sin especificar') : 'Sin especificar'
        });
      });

      cxc = {
        ok: true, motivo: '',
        cols: { ref: cRef || '', total: cTot, pagado: cPag || '', porCobrar: cPC || '',
                fecha: cF || '', mes: cMes || '', piezas: cPzs || '', como: cComo || '' },
        headers: Hc.filter(Boolean),
        cancelados: cancelados,
        conFecha: rows.filter(x => x.d !== null).length,
        rows: rows
      };
    } catch (e) {
      cxc = { ok: false, motivo: String(e && e.message ? e.message : e), cols: {}, headers: [], rows: [] };
    }

    // ===== Funnel de ventas (bitácora de contactos "Montse 2026") =====
    let funnel = { ok: false, motivo: '', rows: [], cols: {}, headers: [], estatus: [], descartadas: 0 };
    try {
      const cfgF = core.areaCfg ? await core.areaCfg('funnel') : core.SHEETS.funnel;
      if (!cfgF || !cfgF.id) throw new Error('El área "funnel" no tiene archivo configurado en lib/core.js.');
      let raw;
      try { raw = await core.readRange(cfgF.id, cfgF.sheetName); }
      catch (e) {
        throw new Error('No se pudo leer "' + cfgF.sheetName + '". Comparte el archivo con la cuenta de servicio ' +
          'y revisa el nombre de la pestaña. (' + (e.message || e) + ')');
      }
      if (!raw || !raw.length) throw new Error('La pestaña "' + cfgF.sheetName + '" está vacía.');

      const hrF = (cfgF.headerRow && cfgF.headerRow > 1) ? (cfgF.headerRow - 1) : 0;
      const Hf = (raw[hrF] || []).map(h => String(h).trim());
      const Rf = [];
      for (let i = hrF + 1; i < raw.length; i++) {
        const fila = raw[i] || [];
        if (!Hf.some((_, j) => txt(fila[j]) !== '')) continue;
        const o = {};
        Hf.forEach((h, j) => { o[h] = (fila[j] != null) ? fila[j] : ''; });
        Rf.push(o);
      }

      // Año de la pestaña ("Montse 2026") para las fechas que solo traen día y mes
      const mAnio = String(cfgF.sheetName).match(/(20\d{2})/);
      const anioF = mAnio ? +mAnio[1] : new Date().getFullYear();

      const cMes  = col(Hf, 'MES', 'Mes');
      const cPrio = col(Hf, 'Prioridad');
      const cCliF = col(Hf, 'Cliente');
      const cDesp = col(Hf, 'Despacho');
      const cTipo = col(Hf, 'TIPO CLIENTE', 'Tipo Cliente', 'Tipo de Cliente');
      const cVia  = col(Hf, 'Forma de Contacto', 'Forma de contacto');
      const cFcon = col(Hf, 'Fecha contacto', 'Fecha de contacto', 'Fecha');
      const cSR   = col(Hf, 'Visito Showroom', 'Visitó Showroom', 'Visito showroom');
      const cEtap = col(Hf, 'Cotización', 'Cotizacion');
      const cEst  = col(Hf, 'Estatus', 'Status', 'Estado');
      const cVV   = col(Hf, 'Valor Venta', 'Valor venta');
      const cVC   = col(Hf, 'Valor Cotización', 'Valor Cotizacion', 'Valor cotización');
      if (!cMes || !cCliF) throw new Error('No se encontraron las columnas MES / Cliente. Encabezados leídos: ' + Hf.filter(Boolean).join(' | '));

      const est = {};
      let descartadas = 0;
      const rowsF = [];
      Rf.forEach(r => {
        const mes = mesDeTexto(r[cMes]);
        const cli = txt(r[cCliF]);
        // Filas de sección ("ABRIL (pautas)", "SHOWROOM VISITAS", "JUNIO") y filas incompletas
        if (!mes || !cli) { descartadas++; return; }

        const lbl  = cEst ? txt(r[cEst]) : '';
        const prio = cPrio ? txt(r[cPrio]) : '';
        let res = clasifPor(F_RESULT, lbl) || 'sin';
        if (res === 'sin' && /no interesad/.test(norm(prio))) res = 'perdida';
        const etapa = (cEtap ? clasifPor(F_ETAPA, r[cEtap]) : null) || 'sin';

        if (lbl) { if (!est[lbl]) est[lbl] = { lbl: lbl, cat: res, n: 0 }; est[lbl].n++; }

        rowsF.push({
          d:     fechaFunnel(cFcon ? r[cFcon] : '', mes, anioF),
          mes:   mes,
          cli:   cli,
          desp:  cDesp ? txt(r[cDesp]) : '',
          tipo:  cTipo ? (txt(r[cTipo]) || 'Sin especificar') : 'Sin especificar',
          via:   cVia ? (txt(r[cVia]) || 'Sin especificar') : 'Sin especificar',
          sr:    cSR ? (txt(r[cSR]) || 'Sin especificar') : 'Sin especificar',
          prio:  prio || 'Sin especificar',
          etapa: etapa,
          res:   res,
          lbl:   lbl || 'Sin estatus',
          vv:    cVV ? num(r[cVV]) : null,
          vc:    cVC ? num(r[cVC]) : null
        });
      });

      funnel = {
        ok: true, motivo: '',
        pestana: cfgF.sheetName, filaEncabezados: hrF + 1, anio: anioF,
        headers: Hf.filter(Boolean),
        cols: { mes: cMes, cliente: cCliF, etapa: cEtap || '', estatus: cEst || '',
                valorVenta: cVV || '', valorCotizacion: cVC || '', fecha: cFcon || '' },
        descartadas: descartadas,
        estatus: Object.keys(est).map(k => est[k]).sort((a, b) => b.n - a.n),
        rows: rowsF
      };
    } catch (e) {
      funnel = { ok: false, motivo: String(e && e.message ? e.message : e), rows: [], cols: {}, headers: [], estatus: [], descartadas: 0 };
    }

    return res.status(200).json({ ventas: out, marketing: marketing, metas: metas, cxc: cxc, funnel: funnel });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
