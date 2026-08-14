// Lo mismo que el cruce de CFDIs emitidos, pero del lado de las compras.
//
//   EGRESOS  -> lo que salió del banco
//   Vigentes -> las facturas que nos emitieron los proveedores
//   Complementos -> los complementos que nos mandaron (UUIDRel apunta a la factura)
//
// Responde dos cosas:
//   1. Qué pagos no tienen factura   -> no se puede deducir ni acreditar el IVA
//   2. Qué factura PPD nuestra no tiene su complemento -> hay que pedírselo al proveedor
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
function venceComplemento(dia) {
  if (!dia) return null;
  let a = Math.floor(dia / 10000), m = Math.floor(dia / 100) % 100;
  m += 1;
  if (m > 12) { m = 1; a += 1; }
  return a * 10000 + m * 100 + 5;
}
// Movimientos que no son compras: no se les puede exigir factura
const NO_APLICA = /traspaso|ajuste|cuadr|correccion|reclasific|redondeo|saldo inicial|apertura|prueba|cancelad|nomina|nómina|sueldo|prestamo|préstamo|dividendo|impuesto|isr|iva |imss|infonavit|sat\b/i;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const cfg = core.areaCfg ? await core.areaCfg('cfdi_recibidos') : core.SHEETS.cfdi_recibidos;
    if (!cfg || !cfg.id) {
      return res.status(200).json({
        ok: false, sinArchivo: true,
        mensaje: 'Falta conectar el archivo de CFDIs recibidos. Pásame su link y lo configuro.'
      });
    }
    const cfgE = core.areaCfg ? await core.areaCfg('fin_egresos') : core.SHEETS.fin_egresos;
    const cfgP = core.areaCfg ? await core.areaCfg('compras_proveedores') : core.SHEETS.compras_proveedores;
    const [vig, comp, egr, lista] = await Promise.all([
      leerHoja(cfg.id, cfg.sheetName || 'Vigentes'),
      leerHoja(cfg.id, 'Complementos'),
      cfgE && cfgE.id ? leerHoja(cfgE.id, cfgE.sheetName) : Promise.resolve({ headers: [], rows: [] }),
      cfgP && cfgP.id ? leerHoja(cfgP.id, cfgP.sheetName) : Promise.resolve({ headers: [], rows: [] })
    ]);

    // El puente: en EGRESOS se escribe el nombre comercial ("TANDEM") y en el CFDI
    // viene la razón social ("Tandem Muebles SA de CV"). La lista de proveedores
    // tiene los dos, así que se usa para traducir.
    const aComercial = {};      // cualquier forma del nombre -> nombre comercial
    const rfcDe = {};
    let sinRazonSocial = [];
    if (lista.headers.length) {
      const lCom = col(lista.headers, 'Proveedor', 'Nombre Comercial', 'Nombre comercial');
      const lRaz = col(lista.headers, 'Razón Social', 'Razon Social', 'Nombre/Razón Social');
      const lRfc = col(lista.headers, 'RFC');
      if (lCom) lista.rows.forEach(r => {
        const com = txt(r[lCom]);
        if (!com) return;
        aComercial[norm(com)] = com;
        const raz = txt(lRaz ? r[lRaz] : '');
        if (raz) aComercial[norm(raz)] = com;
        else sinRazonSocial.push(com);
        const rfc = txt(lRfc ? r[lRfc] : '').toUpperCase();
        if (rfc) { rfcDe[rfc] = com; aComercial[norm(rfc)] = com; }
      });
    }
    // Devuelve el nombre comercial venga como venga
    const comercial = (nombre, rfc) => {
      const porRfc = rfc ? rfcDe[String(rfc).trim().toUpperCase()] : null;
      if (porRfc) return porRfc;
      return aComercial[norm(nombre)] || txt(nombre);
    };
    if (!vig.headers.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de facturas recibidas.' });

    const V = vig.headers;
    const vUUID = col(V, 'UUID');
    const vTipo = col(V, 'Tipo');
    const vEstado = col(V, 'Estado SAT');
    const vFecha = col(V, 'Fecha Emision', 'Fecha Emisión');
    const vEmisor = col(V, 'Nombre Emisor');
    const vRfcEm = col(V, 'RFC Emisor');
    const vMet = col(V, 'Metodo de Pago', 'Método de Pago');
    const vTot = col(V, 'Total');
    const vSerie = col(V, 'Serie'), vFolioF = col(V, 'Folio');

    // Complementos recibidos, por la factura a la que pagan
    const porFactura = {};
    if (comp.headers.length) {
      const cRel = col(comp.headers, 'UUIDRel', 'UUID Relacion', 'UUID Relación');
      const cMonto = col(comp.headers, 'Monto', 'Total');
      const cFec = col(comp.headers, 'Fecha Emision', 'Fecha Emisión');
      const cEst = col(comp.headers, 'Estado SAT');
      if (cRel) comp.rows.forEach(r => {
        const rel = normUUID(r[cRel]);
        if (!rel) return;
        if (/cancelad/i.test(txt(cEst ? r[cEst] : ''))) return;
        if (!porFactura[rel]) porFactura[rel] = [];
        porFactura[rel].push({ monto: cMonto ? num(r[cMonto]) : 0,
                               fecha: txt(cFec ? r[cFec] : ''), dia: cFec ? fechaNum(r[cFec]) : null });
      });
    }

    const hoy = (() => { const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
    const diasEntre = (a, b) => {
      if (!a || !b) return null;
      const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
      return Math.round((f(b) - f(a)) / 86400000);
    };

    // --- 1) Facturas de proveedores: cuáles esperan complemento ---
    const faltaComplemento = [], conComplemento = [], puePro = [];
    const facturasPorProveedor = {};
    vig.rows.forEach(r => {
      const u = normUUID(r[vUUID]);
      if (!u) return;
      const tipo = norm(vTipo ? r[vTipo] : '');
      if (tipo && !/^i/.test(tipo) && !/ingreso/.test(tipo)) return;
      if (/cancelad/i.test(txt(vEstado ? r[vEstado] : ''))) return;
      const metodo = norm(vMet ? r[vMet] : '');
      const prov = comercial(txt(vEmisor ? r[vEmisor] : ''), txt(vRfcEm ? r[vRfcEm] : ''));
      const razonSocial = txt(vEmisor ? r[vEmisor] : '');
      const base = {
        uuid: txt(r[vUUID]), proveedor: prov, razonSocial: razonSocial,
        rfc: txt(vRfcEm ? r[vRfcEm] : ''),
        serie: txt(vSerie ? r[vSerie] : ''), folioF: txt(vFolioF ? r[vFolioF] : ''),
        fecha: txt(vFecha ? r[vFecha] : ''), dia: vFecha ? fechaNum(r[vFecha]) : null,
        total: vTot ? num(r[vTot]) : 0, metodo: txt(vMet ? r[vMet] : '')
      };
      const k = norm(prov);
      if (!facturasPorProveedor[k]) facturasPorProveedor[k] = [];
      facturasPorProveedor[k].push(base);

      if (!/ppd/.test(metodo)) { puePro.push(base); return; }
      const cs = porFactura[u] || [];
      const pagado = cs.reduce((a, x) => a + (x.monto || 0), 0);
      if (!cs.length || pagado < base.total - 1) {
        const vence = venceComplemento(base.dia);
        const dias = diasEntre(vence, hoy);
        faltaComplemento.push(Object.assign({}, base, {
          complementado: Math.round(pagado * 100) / 100,
          falta: Math.round((base.total - pagado) * 100) / 100,
          vence: vence, diasDeRetraso: (dias !== null && dias > 0) ? dias : 0,
          urgente: dias !== null && dias > 0,
          motivo: cs.length ? 'Complementado a medias' : 'Sin complemento'
        }));
      } else {
        conComplemento.push(Object.assign({}, base, { complementado: Math.round(pagado * 100) / 100 }));
      }
    });

    // --- 2) Lo pagado contra lo facturado, por proveedor ---
    // Un pago suelto no se puede casar con una factura: en PPD los pagos son parciales.
    // Lo que sí tiene sentido es comparar el total del año: si a un proveedor se le
    // pagaron $500,000 y solo facturó $300,000, faltan $200,000 de facturas.
    const porProveedor = {};
    let noAplican = 0, sinProveedor = 0;
    if (egr.headers.length) {
      const eP = col(egr.headers, 'Proveedor');
      const eT = col(egr.headers, 'Total');
      const eF = col(egr.headers, 'Fecha');
      const eC = col(egr.headers, 'Concepto');
      const eD = col(egr.headers, 'Descripción', 'Descripcion');
      const ePed = col(egr.headers, 'Pedido');
      const anio = +body.anio || 2026;

      egr.rows.forEach(r => {
        const d = eF ? fechaNum(r[eF]) : null;
        if (d && Math.floor(d / 10000) !== anio) return;
        const m = eT ? num(r[eT]) : 0;
        if (!m) return;
        const desc = txt(eC ? r[eC] : '') + ' ' + txt(eD ? r[eD] : '');
        if (NO_APLICA.test(desc)) { noAplican++; return; }
        const provCrudo = txt(eP ? r[eP] : '');
        if (!provCrudo) { sinProveedor++; return; }
        const prov = comercial(provCrudo, '');
        const k = norm(prov);
        if (!porProveedor[k]) porProveedor[k] = {
          proveedor: prov, pagado: 0, nPagos: 0, facturado: 0, nFacturas: 0, pagos: []
        };
        porProveedor[k].pagado += m;
        porProveedor[k].nPagos++;
        if (porProveedor[k].pagos.length < 30) {
          porProveedor[k].pagos.push({
            fila: r._fila, fecha: txt(eF ? r[eF] : ''), monto: m,
            concepto: txt(eC ? r[eC] : ''), pedido: txt(ePed ? r[ePed] : '')
          });
        }
      });
    }
    // Lo facturado por cada uno
    Object.keys(facturasPorProveedor).forEach(k => {
      const fs = facturasPorProveedor[k];
      if (!porProveedor[k]) porProveedor[k] = {
        proveedor: fs[0].proveedor, pagado: 0, nPagos: 0, facturado: 0, nFacturas: 0, pagos: []
      };
      porProveedor[k].facturado = Math.round(fs.reduce((a, x) => a + x.total, 0) * 100) / 100;
      porProveedor[k].nFacturas = fs.length;
      porProveedor[k].facturas = fs;
    });

    const sinFactura = Object.keys(porProveedor).map(k => {
      const p = porProveedor[k];
      const dif = Math.round((p.pagado - p.facturado) * 100) / 100;
      return Object.assign({}, p, {
        pagado: Math.round(p.pagado * 100) / 100,
        faltaFacturar: dif > 1 ? dif : 0,
        aFavor: dif < -1 ? Math.abs(dif) : 0
      });
    }).filter(p => p.faltaFacturar > 1)
      .sort((a, b) => b.faltaFacturar - a.faltaFacturar);

    const conFactura = Object.keys(porProveedor).filter(k => {
      const p = porProveedor[k];
      return p.pagado > 0 && p.pagado - p.facturado <= 1;
    }).length;

    faltaComplemento.sort((a, b) => (b.diasDeRetraso || 0) - (a.diasDeRetraso || 0) || (a.dia || 0) - (b.dia || 0));
    sinFactura.sort((a, b) => b.monto - a.monto);
    const suma = (a, k) => Math.round(a.reduce((t, x) => t + (x[k || 'total'] || 0), 0) * 100) / 100;

    return res.status(200).json({
      ok: true,
      faltaComplemento, conComplemento, puePro,
      sinRazonSocial: sinRazonSocial.slice(0, 60),
      sinFactura: sinFactura.slice(0, 200),
      totales: {
        facturasRecibidas: vig.rows.length,
        complementosRecibidos: comp.rows.length,
        faltaComplemento: faltaComplemento.length, montoFaltaComp: suma(faltaComplemento),
        vencidos: faltaComplemento.filter(x => x.urgente).length,
        conComplemento: conComplemento.length,
        pue: puePro.length,
        sinFactura: sinFactura.length, montoSinFactura: suma(sinFactura, 'faltaFacturar'),
        conFactura: conFactura, noAplican: noAplican, sinProveedor: sinProveedor,
        enLista: Object.keys(aComercial).length, sinRazonSocial: sinRazonSocial.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
