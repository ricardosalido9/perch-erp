// Historial de cobros: todo lo que se ha cobrado, junto y por fecha, con su
// comprobante al lado.
//
// 5 nov. Val: "¿hay forma de que todo lo que sube en archivos de los cobros se
// pueda ver en algún lado como lista histórica? O sea, que vea esos ingresos
// que va subiendo y así también pueda ver los finiquitos".
//
// Los cobros ya se guardaban: cada uno es un renglón de "Pagos de clientes" con
// su link de Drive en la columna Comprobante. Lo que no había era dónde verlos
// todos: había que abrir venta por venta.
//
// Qué resuelve de fondo: la hoja no dice cuál cobro es anticipo y cuál
// finiquito. Se calcula aquí, por folio y en orden de fecha, contra el total de
// esa venta:
//   - el primero, si no la cubre toda            → anticipo
//   - el que deja el saldo en cero               → finiquito
//   - uno solo que cubre toda la venta           → pago total
//   - los de en medio                            → pago a cuenta
// Un cobro de una venta que el panel no encuentra se queda "sin clasificar" en
// vez de inventarle un tipo.
//
//   ?action=cobros-historial  { anio, mes }
const core = require('../core');
const { totalSinIVADe, indicesTotal } = require('../totales');

const PESTANA = process.env.TAB_PAGOS_CLIENTES || 'Pagos de clientes';
const MES = { ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4,
              may:5, mayo:5, jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8,
              sep:9, sept:9, septiembre:9, oct:10, octubre:10, nov:11,
              noviembre:11, dic:12, diciembre:12 };
const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
// Los folios llegan a veces como "O5-26" y a veces como "COT-O5-26": un cobro
// capturado sobre la cotización es el mismo dinero de la misma venta.
const normFolio = (v) => norm(txt(v).replace(/\.0+$/, '')).replace(/^cot-/, '');
function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(txt(v).replace(/[^0-9.,-]/g, '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return 0;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.replace(/,/g, ' ').match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MES[m[2]]) return +m[3] * 10000 + MES[m[2]] * 100 + +m[1];
  return 0;
}
const fechaTxt = (n) => !n ? '' :
  (n % 100) + ' ' + MESES[Math.floor(n / 100) % 100] + ' ' + Math.floor(n / 10000);

function col(H, ...nn) {
  for (const n of nn) { const h = H.filter(x => norm(x) === norm(n))[0]; if (h) return h; }
  return null;
}
async function leerHoja(id, pestana) {
  const values = await core.readRange(id, pestana);
  if (!values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => txt(h));
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    Object.defineProperty(o, '__fila', { value: i + 1, enumerable: false });
    rows.push(o);
  }
  return { headers: H, rows };
}

// Lo que vale cada venta, CON IVA: es contra eso que se compara lo cobrado,
// porque el cliente paga con IVA. Si a un renglón no le bajó la fórmula del
// total —el agujero de la 526— se rehace igual que en el comparativo.
async function totalesPorFolio() {
  const cfg = core.areaCfg ? await core.areaCfg('ventas_registro') : core.SHEETS.ventas_registro;
  if (!cfg || !cfg.id) return {};
  let ven;
  try { ven = await leerHoja(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return {}; }
  const H = ven.headers;
  const vF = col(H, 'No. de Referencia', 'Referencia', 'Folio');
  const vC = col(H, 'Cliente');
  const vSt = col(H, 'Status');
  const vTot = col(H, 'Total con envío', 'Total con envio');
  const idxTot = indicesTotal(H, col);
  if (!vF) return {};
  const out = {};
  ven.rows.forEach(r => {
    const f = normFolio(r[vF]);
    if (!f) return;
    const d = out[f] = out[f] || { folio: txt(r[vF]), cliente: '', total: 0, cancelada: false };
    if (!d.cliente && vC) d.cliente = txt(r[vC]);
    if (vSt && /cancelad|anulad/i.test(txt(r[vSt]))) d.cancelada = true;
    const conIVA = vTot ? num(r[vTot]) : 0;
    // Sin total con IVA en la hoja: se arma del total sin impuestos
    d.total += conIVA || Math.round(totalSinIVADe(idxTot, r, num).total * 1.16 * 100) / 100;
  });
  Object.keys(out).forEach(k => { out[k].total = Math.round(out[k].total * 100) / 100; });
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    const cfg = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'No está configurada la hoja de ventas.' });

    let pagos;
    try { pagos = await leerHoja(cfg.id, PESTANA); }
    catch (e) {
      return res.status(502).json({
        error: 'No se pudo leer la pestaña "' + PESTANA + '".',
        pista: 'Es la misma que usa "Cobros contra banco". Revisa que la cuenta de ' +
               'servicio sea Editor del archivo de ventas.'
      });
    }
    if (!pagos.headers.length) {
      return res.status(502).json({ error: 'La pestaña "' + PESTANA + '" está vacía.' });
    }

    const H = pagos.headers;
    const cFec = col(H, 'Fecha del pago', 'Fecha');
    const cFol = col(H, 'Folio');
    const cCli = col(H, 'Cliente');
    const cMon = col(H, 'Monto', 'Importe');
    const cMet = col(H, 'Método', 'Metodo', 'Forma de pago');
    const cRef = col(H, 'Referencia');
    const cCom = col(H, 'Comprobante');
    const cFac = col(H, 'Facturado');
    const cReq = col(H, 'Requiere factura');
    const cQui = col(H, 'Registró', 'Registro');
    const cBan = col(H, 'Confirmado en banco');
    const cNot = col(H, 'Notas');
    if (!cFec || !cMon) {
      return res.status(400).json({
        error: 'La pestaña "' + PESTANA + '" no tiene Fecha del pago o Monto.',
        columnas: H
      });
    }

    const ventas = await totalesPorFolio();

    // Un cobro cancelado se deja ver —para eso está el historial— pero no suma
    // en ningún lado ni cuenta para saber si la venta ya quedó finiquitada.
    const esCancelado = (r) => /cancelad/i.test(txt(cNot ? r[cNot] : ''));

    const todos = pagos.rows.map(r => {
      const fol = txt(cFol ? r[cFol] : '');
      const v = ventas[normFolio(fol)] || null;
      return {
        fecha: fechaNum(cFec ? r[cFec] : 0),
        folio: fol,
        cliente: txt(cCli ? r[cCli] : '') || (v ? v.cliente : ''),
        monto: Math.round(num(r[cMon]) * 100) / 100,
        metodo: txt(cMet ? r[cMet] : ''),
        referencia: txt(cRef ? r[cRef] : ''),
        comprobante: txt(cCom ? r[cCom] : ''),
        requiereFactura: /^s[ií]/i.test(txt(cReq ? r[cReq] : '')),
        facturado: txt(cFac ? r[cFac] : ''),
        registro: txt(cQui ? r[cQui] : ''),
        banco: txt(cBan ? r[cBan] : ''),
        notas: txt(cNot ? r[cNot] : ''),
        fila: r.__fila || null,
        cancelado: esCancelado(r),
        ventaTotal: v ? v.total : null,
        ventaCancelada: !!(v && v.cancelada)
      };
    });

    // Anticipo / a cuenta / finiquito: se resuelve por folio, en orden de fecha
    const porFolio = {};
    todos.forEach(c => {
      if (c.cancelado || !c.folio) return;
      const k = normFolio(c.folio);
      (porFolio[k] = porFolio[k] || []).push(c);
    });
    Object.keys(porFolio).forEach(k => {
      const lista = porFolio[k].slice().sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
      const total = lista[0].ventaTotal;
      let acum = 0;
      lista.forEach((c, i) => {
        acum = Math.round((acum + c.monto) * 100) / 100;
        c.acumulado = acum;
        if (total === null || !total) { c.tipo = 'sin clasificar'; c.saldo = null; return; }
        // Un peso de diferencia por redondeos no deja una venta "sin finiquitar"
        const saldo = Math.round((total - acum) * 100) / 100;
        c.saldo = saldo;
        const cubre = saldo <= 1;
        c.tipo = cubre ? (i === 0 ? 'pago total' : 'finiquito')
                       : (i === 0 ? 'anticipo' : 'pago a cuenta');
      });
    });
    todos.forEach(c => {
      if (!c.tipo) c.tipo = c.cancelado ? 'cancelado' : 'sin clasificar';
      if (c.saldo === undefined) c.saldo = null;
      if (c.acumulado === undefined) c.acumulado = null;
      c.fechaTxt = fechaTxt(c.fecha);
      c.confirmado = !!txt(c.banco);
    });

    // Filtro por año y mes, con lo más nuevo arriba
    const anio = +body.anio || 0;
    const mes = +body.mes || 0;
    const lista = todos
      .filter(c => !anio || Math.floor(c.fecha / 10000) === anio)
      .filter(c => !mes || (Math.floor(c.fecha / 100) % 100) === mes)
      .sort((a, b) => (b.fecha || 0) - (a.fecha || 0) || (b.fila || 0) - (a.fila || 0));

    const vivos = lista.filter(c => !c.cancelado);
    const suma = (f) => Math.round(vivos.filter(f).reduce((a, c) => a + c.monto, 0) * 100) / 100;

    // Los meses que existen, para los botones de arriba
    const meses = {};
    todos.forEach(c => { if (c.fecha) meses[Math.floor(c.fecha / 100)] = 1; });

    return res.status(200).json({
      ok: true,
      cobros: lista,
      meses: Object.keys(meses).map(Number).sort((a, b) => b - a)
        .map(k => ({ anio: Math.floor(k / 100), mes: k % 100,
                     label: MESES[k % 100] + ' ' + Math.floor(k / 100) })),
      resumen: {
        cobros: vivos.length,
        cobrado: suma(() => true),
        finiquitos: vivos.filter(c => c.tipo === 'finiquito' || c.tipo === 'pago total').length,
        finiquitado: suma(c => c.tipo === 'finiquito' || c.tipo === 'pago total'),
        anticipos: vivos.filter(c => c.tipo === 'anticipo').length,
        anticipado: suma(c => c.tipo === 'anticipo'),
        conComprobante: vivos.filter(c => c.comprobante).length,
        sinComprobante: vivos.filter(c => !c.comprobante).length,
        confirmados: vivos.filter(c => c.confirmado).length,
        cancelados: lista.filter(c => c.cancelado).length,
        sinClasificar: vivos.filter(c => c.tipo === 'sin clasificar').length
      },
      pestana: PESTANA
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
