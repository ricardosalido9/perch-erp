// Facturas emitidas contra el dinero que entró.
//
// Dos preguntas distintas que se responden juntas:
//
//   1. De las facturas en parcialidades (PPD), ¿cuáles no tienen complemento y
//      cuáles lo tienen a medias? Agrupadas por cliente, para saber a quién
//      perseguir. Se liga por UUIDRel de la pestaña de complementos.
//
//   2. ¿Qué entró al banco que no tiene respaldo fiscal, y qué se facturó o se
//      complementó sin que entrara el dinero? Se cruza por MONTO, igual que el
//      estado de cuenta de proveedores, porque no hay UUID en los ingresos.
//
// Lo importante de cruzar por monto: un complemento contra el pago, no contra la
// venta. El complemento es el papel del cobro, así que debe empatar con lo que
// entró al banco ese día, no con el total de la factura.
const core = require('../core');
const CFG = require('../config');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  const contable = /^-/.test(t) && /-$/.test(t);
  const m = t.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return 0;
  let n = parseFloat(m[0].replace(/,/g, ''));
  if (isNaN(n)) return 0;
  if (!contable && (/^\(.*\)$/.test(t) || /^-/.test(t))) n = -n;
  return n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
  sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
  junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.replace(/,/g, ' ').replace(/\s+/g, ' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  return null;
}
const red = (n) => Math.round((n || 0) * 100) / 100;
const texto = (d) => d === null ? '' :
  (d % 100) + ' ' + MESES[Math.floor(d / 100) % 100 - 1] + ' ' + Math.floor(d / 10000);
// Cuántos días hay entre dos fechas en formato AAAAMMDD
function dias(a, b) {
  if (a === null || b === null) return 9999;
  const f = (x) => new Date(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100);
  return Math.abs((f(a) - f(b)) / 86400000);
}

async function leerHoja(id, pestana) {
  if (!id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(id, pestana); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  let hr = 0;
  for (let k = 0; k < Math.min(3, values.length); k++) {
    const f = (values[k] || []).map(x => norm(x));
    if (f.indexOf('uuid') !== -1 || f.indexOf('fecha') !== -1 ||
        f.indexOf('fecha emision') !== -1) { hr = k; break; }
  }
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; headers.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();
    // Cuánta diferencia se acepta al cruzar por monto, y cuántos días
    const TOL = body.tolerancia == null ? 1 : +body.tolerancia;
    const DIAS = body.dias == null ? 8 : +body.dias;

    const [emi, comp, ing] = await Promise.all([
      leerHoja(CFG.ARCHIVOS.CFDI_EMITIDOS, CFG.PESTANAS.cfdiVigentes),
      leerHoja(CFG.ARCHIVOS.CFDI_EMITIDOS, CFG.PESTANAS.cfdiComplementos),
      leerHoja(CFG.ARCHIVOS.FINANZAS, CFG.PESTANAS.ingresos)
    ]);
    if (!emi.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer la pestaña de CFDIs emitidos.' });
    }

    // ---- Facturas emitidas ----
    const H = emi.headers;
    const cFec = col(H, 'Fecha Emision', 'Fecha Emisión', 'Fecha');
    const cMes = col(H, 'Mes');
    const cUUID = col(H, 'UUID');
    const cRec = col(H, 'Nombre Receptor', 'Receptor', 'Cliente');
    const cRFC = col(H, 'RFC Receptor');
    const cMet = col(H, 'Metodo de Pago', 'Método de Pago');
    const cTipo = col(H, 'Tipo');
    const cEst = col(H, 'Estado SAT', 'Estado');
    const cTot = col(H, 'Total');
    const cSerie = col(H, 'Serie'), cFolio = col(H, 'Folio');

    const facturas = [];
    emi.rows.forEach(r => {
      if (cEst && /cancel/i.test(txt(r[cEst]))) return;
      const tipo = norm(cTipo ? r[cTipo] : '');
      if (/^p$|^pago|complement/.test(tipo)) return;      // los complementos van aparte
      if (/^n$|nomina|nómina/.test(tipo)) return;
      const d = cFec ? fechaNum(r[cFec]) : null;
      const a = d === null ? anio : Math.floor(d / 10000);
      if (a !== anio) return;
      const met = norm(cMet ? r[cMet] : '');
      facturas.push({
        uuid: txt(cUUID ? r[cUUID] : '').toUpperCase(),
        fecha: d, fechaTexto: texto(d),
        mes: cMes ? (parseInt(txt(r[cMes]), 10) || (d === null ? null : Math.floor(d / 100) % 100))
                  : (d === null ? null : Math.floor(d / 100) % 100),
        cliente: txt(cRec ? r[cRec] : ''),
        rfc: txt(cRFC ? r[cRFC] : ''),
        folio: (txt(cSerie ? r[cSerie] : '') + txt(cFolio ? r[cFolio] : '')).trim(),
        metodo: /ppd|parcialidad|diferido/.test(met) ? 'PPD'
              : (/pue|una sola/.test(met) ? 'PUE' : '(sin método)'),
        total: red(num(cTot ? r[cTot] : 0)),
        esNota: /nota de credito|egreso|^e$/i.test(tipo)
      });
    });

    // ---- Complementos de pago, ligados por UUIDRel ----
    const complementos = [];
    if (comp.headers.length) {
      const Hc = comp.headers;
      const kRel = col(Hc, 'UUIDRel', 'UUID Relacion', 'UUID Relación', 'UUID Relacionado');
      const kFec = col(Hc, 'Fecha Emision', 'Fecha Emisión', 'Fecha');
      const kTot = col(Hc, 'Total', 'Monto', 'Importe Pagado');
      const kEst = col(Hc, 'Estado SAT', 'Estado');
      const kUUID = col(Hc, 'UUID');
      if (kRel) comp.rows.forEach(r => {
        if (kEst && /cancel/i.test(txt(r[kEst]))) return;
        const d = kFec ? fechaNum(r[kFec]) : null;
        complementos.push({
          uuid: txt(kUUID ? r[kUUID] : ''),
          rel: txt(r[kRel]).toUpperCase(),
          fecha: d, fechaTexto: texto(d),
          monto: red(num(kTot ? r[kTot] : 0)),
          usado: false
        });
      });
    }

    // ---- Lo que entró al banco ----
    const ingresos = [];
    if (ing.headers.length) {
      const Hi = ing.headers;
      const iF = col(Hi, 'Fecha');
      const iT = col(Hi, 'Total');
      const iC = col(Hi, 'Cliente');
      const iCon = col(Hi, 'Concepto');
      const iDes = col(Hi, 'Descripción', 'Descripcion');
      const iCta = col(Hi, 'Cuenta');
      if (iF && iT) ing.rows.forEach((r, i) => {
        const d = fechaNum(r[iF]);
        if (d === null || Math.floor(d / 10000) !== anio) return;
        const monto = red(Math.abs(num(r[iT])));
        if (!monto) return;
        const concepto = txt(iCon ? r[iCon] : '');
        // Los traspasos entre cuentas propias no llevan factura: no son cobros
        if (/traspaso/i.test(concepto)) return;
        ingresos.push({
          fila: i + 2, fecha: d, fechaTexto: texto(d), monto: monto,
          cliente: txt(iC ? r[iC] : ''), concepto: concepto,
          descripcion: txt(iDes ? r[iDes] : ''),
          cuenta: txt(iCta ? r[iCta] : ''), usado: false
        });
      });
    }

    // ===== 1. PPD contra sus complementos, por cliente =====
    const porUUID = {};
    complementos.forEach(c => {
      if (!c.rel) return;
      (porUUID[c.rel] = porUUID[c.rel] || []).push(c);
    });
    const ppd = facturas.filter(f => f.metodo === 'PPD' && !f.esNota).map(f => {
      const suyos = porUUID[f.uuid] || [];
      const cobrado = red(suyos.reduce((a, c) => a + c.monto, 0));
      const falta = red(f.total - cobrado);
      return Object.assign({}, f, {
        complementos: suyos.length,
        cobrado: cobrado,
        falta: falta,
        ultimoComplemento: suyos.length
          ? suyos.map(c => c.fechaTexto).filter(Boolean).slice(-1)[0] : '',
        estado: !suyos.length ? 'sin complemento'
              : (falta > TOL ? 'a medias' : 'saldada'),
        // Los días que lleva esperando: es lo que dice qué tan urgente es
        diasDesde: f.fecha === null ? null
          : Math.round(dias(f.fecha, (new Date().getFullYear() * 10000) +
              ((new Date().getMonth() + 1) * 100) + new Date().getDate()))
      });
    });

    const porCliente = (() => {
      const g = {};
      ppd.forEach(f => {
        const k = f.cliente || '(sin receptor)';
        const c = g[k] = g[k] || { cliente: k, rfc: f.rfc, facturas: [],
          total: 0, cobrado: 0, falta: 0, sinComplemento: 0, aMedias: 0, saldadas: 0 };
        c.facturas.push(f);
        c.total += f.total; c.cobrado += f.cobrado;
        if (f.estado !== 'saldada') c.falta += f.falta;
        if (f.estado === 'sin complemento') c.sinComplemento++;
        else if (f.estado === 'a medias') c.aMedias++;
        else c.saldadas++;
      });
      return Object.keys(g).map(k => {
        const c = g[k];
        c.total = red(c.total); c.cobrado = red(c.cobrado); c.falta = red(c.falta);
        c.facturas.sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
        c.masVieja = c.facturas.filter(f => f.estado !== 'saldada')[0] || null;
        return c;
      }).filter(c => c.sinComplemento || c.aMedias)
        .sort((a, b) => b.falta - a.falta);
    })();

    // ===== 2. Ingresos contra facturas y complementos, por monto =====
    // El papel que respalda un cobro es el complemento si la factura fue PPD, o la
    // propia factura si fue PUE. Los dos se ponen en la misma bolsa y se cruzan
    // contra lo que entró al banco.
    const papeles = [];
    complementos.forEach(c => {
      const f = facturas.filter(x => x.uuid === c.rel)[0];
      papeles.push({ tipo: 'complemento', uuid: c.uuid, fecha: c.fecha,
        fechaTexto: c.fechaTexto, monto: c.monto,
        cliente: f ? f.cliente : '', factura: f ? f.folio : '', usado: false });
    });
    facturas.filter(f => f.metodo === 'PUE' && !f.esNota).forEach(f => {
      papeles.push({ tipo: 'factura PUE', uuid: f.uuid, fecha: f.fecha,
        fechaTexto: f.fechaTexto, monto: f.total,
        cliente: f.cliente, factura: f.folio, usado: false });
    });

    const ligados = [];
    ingresos.forEach(x => {
      const cands = papeles.filter(p => !p.usado && Math.abs(p.monto - x.monto) <= TOL &&
        dias(p.fecha, x.fecha) <= DIAS);
      if (!cands.length) return;
      // Si hay varios, gana el del mismo cliente y luego el más cercano en fecha
      cands.sort((a, b) => {
        const ma = norm(a.cliente) && norm(a.cliente) === norm(x.cliente) ? 0 : 1;
        const mb = norm(b.cliente) && norm(b.cliente) === norm(x.cliente) ? 0 : 1;
        return (ma - mb) || (dias(a.fecha, x.fecha) - dias(b.fecha, x.fecha));
      });
      cands[0].usado = true;
      x.usado = true;
      ligados.push({ ingreso: x, papel: cands[0],
        mismoCliente: norm(cands[0].cliente) === norm(x.cliente) });
    });

    const ingresosSinPapel = ingresos.filter(x => !x.usado)
      .sort((a, b) => b.fecha - a.fecha).slice(0, 200);
    const papelSinIngreso = papeles.filter(p => !p.usado)
      .sort((a, b) => (b.fecha || 0) - (a.fecha || 0)).slice(0, 200);

    return res.status(200).json({
      ok: true,
      anio: anio,
      resumen: {
        facturas: facturas.length,
        ppd: ppd.length,
        sinComplemento: ppd.filter(f => f.estado === 'sin complemento').length,
        aMedias: ppd.filter(f => f.estado === 'a medias').length,
        saldadas: ppd.filter(f => f.estado === 'saldada').length,
        porCobrarConComplemento: red(ppd.filter(f => f.estado !== 'saldada')
          .reduce((a, f) => a + f.falta, 0)),
        ingresos: ingresos.length,
        ligados: ligados.length,
        ingresosSinPapel: ingresos.filter(x => !x.usado).length,
        montoSinPapel: red(ingresos.filter(x => !x.usado).reduce((a, x) => a + x.monto, 0)),
        papelSinIngreso: papeles.filter(p => !p.usado).length,
        montoPapelSinIngreso: red(papeles.filter(p => !p.usado).reduce((a, p) => a + p.monto, 0))
      },
      porCliente: porCliente,
      ingresosSinPapel: ingresosSinPapel,
      papelSinIngreso: papelSinIngreso,
      lectura: {
        emitidosLeidos: emi.rows.length,
        complementosLeidos: comp.rows.length,
        ingresosLeidos: ing.rows.length,
        columnaRelacion: comp.headers.length
          ? (col(comp.headers, 'UUIDRel', 'UUID Relacion') || '(NO ESTÁ)') : '(sin pestaña)'
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
