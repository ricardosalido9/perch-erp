// Cruce contra los CFDIs reales del SAT.
//
// Dos pestañas del archivo de facturación:
//   "Vigentes"    -> todas las facturas emitidas, con su UUID
//   "Complementos"-> cada complemento de pago, con UUIDRel apuntando a la factura
//
// La regla: una factura PPD necesita complemento por cada pago. Si su UUID no
// aparece en UUIDRel de ningún complemento, falta emitirlo.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normUUID(v) { return String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-F0-9-]/g, ''); }
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
async function leerHoja(id, hoja) {
  let values;
  try { values = await core.readRange(id, hoja); } catch (e) { return { headers: [], rows: [], error: e.message }; }
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
async function leerArea(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  return leerHoja(cfg.id, cfg.sheetName);
}
function venceComplemento(dia) {
  if (!dia) return null;
  let a = Math.floor(dia / 10000), m = Math.floor(dia / 100) % 100;
  m += 1;
  if (m > 12) { m = 1; a += 1; }
  return a * 10000 + m * 100 + 5;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const cfgC = core.areaCfg ? await core.areaCfg('cfdi_vigentes') : core.SHEETS.cfdi_vigentes;
    if (!cfgC || !cfgC.id) {
      return res.status(200).json({
        ok: false, sinArchivo: true,
        mensaje: 'Falta conectar el archivo de CFDIs. Pásame su id y lo configuro.'
      });
    }
    let [vig, comp, cxc] = await Promise.all([
      leerHoja(cfgC.id, cfgC.sheetName || 'Vigentes'),
      leerHoja(cfgC.id, 'Complementos'),
      leerArea('fin_cxc')
    ]);
    // La pestaña de complementos puede llamarse distinto en cada archivo
    if (!comp.headers.length) {
      for (const nombre of ['Complementos de Pago', 'Complementos de pago', 'Pagos',
                            'COMPLEMENTOS', 'Complemento']) {
        comp = await leerHoja(cfgC.id, nombre);
        if (comp.headers.length) break;
      }
    }
    if (!vig.headers.length) {
      let pest = [];
      try { pest = await core.listTabs(cfgC.id); } catch (e) { pest = []; }
      return res.status(400).json({
        error: 'No se pudo leer la pestaña "' + (cfgC.sheetName || 'Vigentes') + '".',
        pestanasDelArchivo: pest
      });
    }

    const V = vig.headers;
    const vUUID = col(V, 'UUID');
    const vTipo = col(V, 'Tipo');
    const vEstado = col(V, 'Estado SAT');
    const vFecha = col(V, 'Fecha Emision', 'Fecha Emisión');
    const vSerie = col(V, 'Serie');
    const vFolio = col(V, 'Folio');
    const vRecep = col(V, 'Nombre Receptor');
    const vRfc = col(V, 'RFC Receptor');
    const vMet = col(V, 'Metodo de Pago', 'Método de Pago');
    const vTot = col(V, 'Total');
    const vCom = col(V, 'Comentarios');
    const vRfcEm = col(V, 'RFC Emisor');
    if (!vUUID) return res.status(400).json({ error: 'La pestaña de facturas no tiene columna UUID.' });

    // Los complementos, agrupados por la factura a la que pagan
    const porFactura = {};
    let compsSinRelacion = 0;
    if (comp.headers.length) {
      const cRel = col(comp.headers, 'UUIDRel', 'UUID Relacion', 'UUID Relación');
      const cUUID = col(comp.headers, 'UUID');
      const cFec = col(comp.headers, 'Fecha Emision', 'Fecha Emisión');
      const cMonto = col(comp.headers, 'Monto', 'Total');
      const cEst = col(comp.headers, 'Estado SAT');
      const cForma = col(comp.headers, 'FormaDePagoP', 'FormaDePago');
      if (cRel) comp.rows.forEach(r => {
        const rel = normUUID(r[cRel]);
        if (!rel) { compsSinRelacion++; return; }
        if (/cancelad/i.test(txt(cEst ? r[cEst] : ''))) return;   // cancelado: no cuenta
        if (!porFactura[rel]) porFactura[rel] = [];
        porFactura[rel].push({
          uuid: txt(cUUID ? r[cUUID] : ''), fecha: txt(cFec ? r[cFec] : ''),
          dia: cFec ? fechaNum(r[cFec]) : null,
          monto: cMonto ? num(r[cMonto]) : 0,
          forma: txt(cForma ? r[cForma] : '')
        });
      });
    }

    // CxC: para ligar la factura con su venta
    const porUUIDcxc = {};
    if (cxc.headers.length) {
      const xU = col(cxc.headers, 'UUID', 'Folio Fiscal');
      const xRef = col(cxc.headers, 'No. de Referencia', 'Folio');
      const xCli = col(cxc.headers, 'Cliente');
      if (xU && xRef) cxc.rows.forEach(r => {
        const u = normUUID(r[xU]);
        if (!u) return;
        porUUIDcxc[u] = { folio: txt(r[xRef]), cliente: txt(xCli ? r[xCli] : '') };
      });
    }

    const hoy = (() => { const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
    const diasEntre = (a, b) => {
      if (!a || !b) return null;
      const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
      return Math.round((f(b) - f(a)) / 86400000);
    };

    const faltaComplemento = [], conComplemento = [], pue = [], canceladas = [], sinEnCxc = [];
    const tiposVistos = {}, metodosVistos = {};
    const rfcPropio = norm(body.rfc || '');

    vig.rows.forEach(r => {
      const u = normUUID(r[vUUID]);
      if (!u) return;
      const tipo = norm(vTipo ? r[vTipo] : '');
      tiposVistos[tipo || '(vacío)'] = (tiposVistos[tipo || '(vacío)'] || 0) + 1;
      // Facturas de ingreso. Se descartan solo los tipos que claramente NO lo son.
      if (/^p$|^pago|complement/.test(tipo)) return;
      if (/^e$|^egreso|nota de credito/.test(tipo)) return;
      if (/^t$|^traslado/.test(tipo)) return;
      if (/^n$|^nomina|nómina/.test(tipo)) return;
      const cancelada = /cancelad/i.test(txt(vEstado ? r[vEstado] : ''));
      const metodo = norm(vMet ? r[vMet] : '');
      const liga = porUUIDcxc[u] || null;
      const base = {
        uuid: txt(r[vUUID]),
        serie: txt(vSerie ? r[vSerie] : ''), folioF: txt(vFolio ? r[vFolio] : ''),
        fecha: txt(vFecha ? r[vFecha] : ''), dia: vFecha ? fechaNum(r[vFecha]) : null,
        receptor: txt(vRecep ? r[vRecep] : ''), rfc: txt(vRfc ? r[vRfc] : ''),
        metodo: txt(vMet ? r[vMet] : ''), total: vTot ? num(r[vTot]) : 0,
        estado: txt(vEstado ? r[vEstado] : ''),
        comentarios: txt(vCom ? r[vCom] : ''),
        folioVenta: liga ? liga.folio : '',
        complementos: porFactura[u] || []
      };

      if (cancelada) { canceladas.push(base); return; }
      if (!liga) sinEnCxc.push(base);

      metodosVistos[metodo || '(vacío)'] = (metodosVistos[metodo || '(vacío)'] || 0) + 1;
      if (/pue/.test(metodo)) { pue.push(base); return; }
      if (!/ppd/.test(metodo)) { pue.push(Object.assign({}, base, { sinMetodo: true })); return; }

      // Es PPD: se revisa si tiene complemento
      const cs = porFactura[u] || [];
      const pagado = cs.reduce((a, x) => a + (x.monto || 0), 0);
      if (!cs.length) {
        const vence = venceComplemento(base.dia);
        const dias = diasEntre(vence, hoy);
        faltaComplemento.push(Object.assign({}, base, {
          pagadoEnComplementos: 0, vence: vence,
          diasDeRetraso: (dias !== null && dias > 0) ? dias : 0,
          urgente: dias !== null && dias > 0,
          motivo: 'Sin ningún complemento'
        }));
      } else if (pagado < base.total - 1) {
        faltaComplemento.push(Object.assign({}, base, {
          pagadoEnComplementos: Math.round(pagado * 100) / 100,
          falta: Math.round((base.total - pagado) * 100) / 100,
          motivo: 'Complementado a medias: van ' + cs.length +
                  (cs.length === 1 ? ' pago' : ' pagos')
        }));
      } else {
        conComplemento.push(Object.assign({}, base, {
          pagadoEnComplementos: Math.round(pagado * 100) / 100
        }));
      }
    });

    faltaComplemento.sort((a, b) => (b.diasDeRetraso || 0) - (a.diasDeRetraso || 0) || (a.dia || 0) - (b.dia || 0));
    const suma = (a) => Math.round(a.reduce((t, x) => t + (x.total || 0), 0) * 100) / 100;

    return res.status(200).json({
      ok: true,
      faltaComplemento, conComplemento, pue, canceladas, sinEnCxc,
      diagnostico: {
        pestanaFacturas: cfgC.sheetName || 'Vigentes',
        columnasFacturas: vig.headers.filter(Boolean),
        seLeyoComplementos: !!comp.headers.length,
        columnasComplementos: comp.headers.filter(Boolean),
        filasComplementos: comp.rows.length,
        tiposEncontrados: tiposVistos,
        metodosEncontrados: metodosVistos,
        errorComplementos: comp.error || ''
      },
      totales: {
        facturas: vig.rows.length,
        faltaComplemento: faltaComplemento.length, montoFalta: suma(faltaComplemento),
        vencidos: faltaComplemento.filter(x => x.urgente).length,
        conComplemento: conComplemento.length,
        pue: pue.length,
        sinMetodo: pue.filter(x => x.sinMetodo).length,
        canceladas: canceladas.length,
        sinEnCxc: sinEnCxc.length, montoSinEnCxc: suma(sinEnCxc),
        complementos: comp.rows.length, compsSinRelacion: compsSinRelacion
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
