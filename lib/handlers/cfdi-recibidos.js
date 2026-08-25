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
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
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
function diasEntreFechas(a, b) {
  if (!a || !b) return null;
  const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
  return Math.round((f(b) - f(a)) / 86400000);
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
    let [vig, comp, egr, lista] = await Promise.all([
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
    const formaMensual = {};    // proveedores que facturan una vez al mes
    const duplicados = [];      // razones sociales que también son proveedor aparte
    let sinRazonSocial = [];
    if (lista.headers.length) {
      const lCom = col(lista.headers, 'Proveedor', 'Nombre Comercial', 'Nombre comercial');
      const lRaz = col(lista.headers, 'Razón Social', 'Razon Social', 'Nombre/Razón Social');
      const lRfc = col(lista.headers, 'RFC');
      const lForma = col(lista.headers, 'Forma de Facturar', 'Forma de facturar', 'Facturación');
      // Primero se registran TODOS los nombres comerciales: son los que mandan.
      // Si un nombre es proveedor por sí mismo, no lo puede reclamar otro como
      // razón social suya. (Genaro aparece dentro de Martín y también solo.)
      const esProveedorPropio = {};
      if (lCom) lista.rows.forEach(r => {
        const c = txt(r[lCom]);
        if (c) esProveedorPropio[norm(c)] = true;
      });
      if (lCom) lista.rows.forEach(r => {
        const com = txt(r[lCom]);
        if (!com) return;
        aComercial[norm(com)] = com;
        // Un proveedor puede facturar con varias razones sociales. Se aceptan
        // separadas por salto de línea, punto y coma, barra o coma. Y se limpian
        // las comillas que Google agrega cuando la celda tiene varios renglones.
        const razones = String(lRaz ? r[lRaz] : '')
          .replace(/^["']+|["']+$/g, '')
          .split(/[\n\r;|]+|\s{3,}/)
          .map(x => txt(x).replace(/^["']+|["']+$/g, '').trim())
          .filter(Boolean);
        if (razones.length) {
          razones.forEach(rz => {
            const k2 = norm(rz);
            // Si esa razón social ADEMÁS existe como proveedor por su cuenta, se
            // avisa, pero manda la relación: si la lista dice que Genaro es una
            // razón social de Martín, sus facturas son de Martín. Antes se
            // descartaba y esas facturas se quedaban sin dueño.
            if (esProveedorPropio[k2] && k2 !== norm(com)) {
              duplicados.push({ razonSocial: rz, dentroDe: com });
            }
            aComercial[k2] = com;
          });
        } else sinRazonSocial.push(com);
        String(lRfc ? r[lRfc] : '').replace(/["']/g, '')
          .split(/[\n\r;,|\s]+/).map(x => txt(x).toUpperCase())
          .filter(Boolean).forEach(rfc => { rfcDe[rfc] = com; aComercial[norm(rfc)] = com; });
        // Cómo factura: por pago, o una sola factura al mes por todos los pagos
        if (lForma && /mensual/i.test(txt(r[lForma]))) formaMensual[norm(com)] = true;
      });
    }
    // Nombres comerciales que se pueden buscar dentro de una razón social.
    // Se usan solo los de 4 letras o más, para no confundir siglas cortas.
    const comerciales = Object.keys(aComercial)
      .map(k => aComercial[k])
      .filter((v, i, a) => a.indexOf(v) === i)
      .filter(v => norm(v).replace(/[^a-z0-9]/g, '').length >= 4)
      .sort((a, b) => b.length - a.length);

    const razonesPorProveedor = {};
    // Devuelve el nombre comercial venga como venga: por RFC, por nombre exacto,
    // o porque la razón social CONTIENE el nombre comercial.
    // "TANDEM INTERIORES" y "TANDEM ARQUITECTURA Y DISEÑO" son los dos TANDEM.
    const comercial = (nombre, rfc) => {
      const porRfc = rfc ? rfcDe[String(rfc).trim().toUpperCase()] : null;
      if (porRfc) { anota(porRfc, nombre); return porRfc; }
      const exacto = aComercial[norm(nombre)];
      if (exacto) { anota(exacto, nombre); return exacto; }
      const n = ' ' + norm(nombre).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
      const hit = comerciales.filter(c => {
        const cc = norm(c).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        return n.indexOf(' ' + cc + ' ') !== -1;
      })[0];
      if (hit) { anota(hit, nombre); return hit; }
      return txt(nombre);
    };
    function anota(comer, razon) {
      const r = txt(razon);
      if (!r || norm(r) === norm(comer)) return;
      const k = norm(comer);
      if (!razonesPorProveedor[k]) razonesPorProveedor[k] = [];
      if (razonesPorProveedor[k].indexOf(r) === -1) razonesPorProveedor[k].push(r);
    }
    if (!comp.headers.length) {
      for (const nombre of ['COMPLEMENTOS DE PAGO', 'Complementos de Pago', 'Complementos de pago', 'Pagos',
                            'COMPLEMENTOS', 'Complemento', 'Recibidos Complementos']) {
        comp = await leerHoja(cfg.id, nombre);
        if (comp.headers.length) break;
      }
    }
    if (!vig.headers.length) {
      let pest = [];
      try { pest = await core.listTabs(cfg.id); } catch (e) { pest = []; }
      return res.status(400).json({
        error: 'No se pudo leer la pestaña de facturas recibidas.', pestanasDelArchivo: pest
      });
    }

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
    let faltaComplemento = [], conComplemento = [];
    const puePro = [];
    const tiposVistos = {}, formasVistas = {};
    const facturasPorProveedor = {};
    vig.rows.forEach(r => {
      const u = normUUID(r[vUUID]);
      if (!u) return;
      const tipo = norm(vTipo ? r[vTipo] : '');
      // Se descartan solo los tipos que claramente NO son factura de compra
      if (/^p$|^pago|complement/.test(tipo)) return;
      if (/^e$|^egreso|nota de credito/.test(tipo)) return;
      if (/^t$|^traslado/.test(tipo)) return;
      if (/^n$|^nomina|nómina/.test(tipo)) return;
      tiposVistos[tipo || '(vacío)'] = (tiposVistos[tipo || '(vacío)'] || 0) + 1;
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
    let noAplican = 0, sinProveedor = 0, enEfectivo = 0, efectivoMonto = 0;
    let sinFecha = 0, deOtroAnio = 0;
    const todosLosPagos = {};
    let columnaMetodo = null, columnasEgresos = [];
    if (egr.headers.length) {
      const eP = col(egr.headers, 'Proveedor');
      const eT = col(egr.headers, 'Total');
      const eF = col(egr.headers, 'Fecha');
      const eC = col(egr.headers, 'Concepto');
      const eD = col(egr.headers, 'Descripción', 'Descripcion');
      const ePed = col(egr.headers, 'Pedido');
      const eMet = col(egr.headers, 'Método de pago', 'Metodo de pago', 'Metodo de Pago',
                       'Método de Pago', 'Forma de pago', 'Forma de Pago', 'FormaDePago',
                       'Tipo de pago', 'Metodo', 'Método');
      const eCta = col(egr.headers, 'Cuenta');
      const anio = +body.anio || 2026;
      columnaMetodo = eMet;
      columnasEgresos = egr.headers.filter(Boolean);

      egr.rows.forEach(r => {
        const d = eF ? fechaNum(r[eF]) : null;
        // Sin fecha legible no se puede saber de qué año es: mejor no contarlo
        if (d === null) { sinFecha++; return; }
        if (Math.floor(d / 10000) !== anio) { deOtroAnio++; return; }
        const m = eT ? num(r[eT]) : 0;
        if (!m) return;
        const desc = txt(eC ? r[eC] : '') + ' ' + txt(eD ? r[eD] : '');
        if (NO_APLICA.test(desc)) { noAplican++; return; }
        // SOLO depósitos y transferencias. Lo demás (efectivo, cheque, sin método)
        // queda fuera: la lista blanca es más segura que ir descartando uno por uno.
        const forma = norm(eMet ? r[eMet] : '');
        formasVistas[txt(eMet ? r[eMet] : '') || '(vacío)'] =
          (formasVistas[txt(eMet ? r[eMet] : '') || '(vacío)'] || 0) + 1;
        // Si la hoja no tiene columna de método, no se puede filtrar: entran todos
        // y se avisa en el diagnóstico para que se note.
        let esBanco = true;
        if (eMet) {
          esBanco = /deposito|transferencia|spei|traspaso electronico/
            .test(forma.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
        }
        const provTmp = comercial(txt(eP ? r[eP] : ''), '');
        const kTmp = norm(provTmp);
        if (!todosLosPagos[kTmp]) todosLosPagos[kTmp] = [];
        if (todosLosPagos[kTmp].length < 120) {
          todosLosPagos[kTmp].push({
            fila: r._fila, fecha: txt(eF ? r[eF] : ''), dia: d, monto: m,
            metodo: txt(eMet ? r[eMet] : '') || '(sin método)',
            concepto: txt(eC ? r[eC] : ''), descripcion: txt(eD ? r[eD] : ''),
            pedido: txt(ePed ? r[ePed] : ''), cuenta: txt(eCta ? r[eCta] : ''),
            entraAlCruce: esBanco
          });
        }
        if (!esBanco) { enEfectivo++; efectivoMonto += m; return; }
        const provCrudo = txt(eP ? r[eP] : '');
        if (!provCrudo) { sinProveedor++; return; }
        const prov = comercial(provCrudo, '');
        const k = norm(prov);
        if (!porProveedor[k]) porProveedor[k] = {
          proveedor: prov, pagado: 0, nPagos: 0, facturado: 0, nFacturas: 0, pagos: []
        };
        porProveedor[k].pagado += m;
        porProveedor[k].nPagos++;
        if (porProveedor[k].pagos.length < 80) {
          porProveedor[k].pagos.push({
            fila: r._fila, fecha: txt(eF ? r[eF] : ''), dia: d, monto: m,
            concepto: txt(eC ? r[eC] : ''), descripcion: txt(eD ? r[eD] : ''),
            pedido: txt(ePed ? r[ePed] : ''), cuenta: txt(eCta ? r[eCta] : '')
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

    let sinFactura = Object.keys(porProveedor).map(k => {
      const p = porProveedor[k];
      const dif = Math.round((p.pagado - p.facturado) * 100) / 100;
      // Las facturas cubren los pagos del más viejo al más nuevo. Los que quedan
      // descubiertos son los que hay que reclamar: normalmente los más recientes.
      let saldoFacturas = p.facturado;
      const pagosOrdenados = (p.pagos || []).slice().sort((a, b) => (a.dia || 0) - (b.dia || 0));
      pagosOrdenados.forEach(g => {
        if (saldoFacturas >= g.monto - 1) {
          saldoFacturas -= g.monto;
          g.cubierto = 'sí';
        } else if (saldoFacturas > 1) {
          g.cubierto = 'a medias';
          g.sinCubrir = Math.round((g.monto - saldoFacturas) * 100) / 100;
          saldoFacturas = 0;
        } else {
          g.cubierto = 'no';
          g.sinCubrir = g.monto;
        }
      });
      const esMensual = !!formaMensual[k];
      // Los que facturan una vez al mes se cruzan por mes, no pago por pago
      let porMes = null;
      {
        const meses = {};
        const mesDe = (d) => d ? Math.floor(d / 100) : null;   // AAAAMM
        (todosLosPagos[k] || []).forEach(g => {
          if (!g.entraAlCruce) return;
          const mm = mesDe(g.dia);
          if (!mm) return;
          if (!meses[mm]) meses[mm] = { mes: mm, pagado: 0, facturado: 0, nPagos: 0, nFacturas: 0 };
          meses[mm].pagado += g.monto;
          meses[mm].nPagos++;
        });
        // Cada factura se queda en el mes en que se emitió. Solo se mueve al mes
        // anterior si ahí hubo pagos sin facturar y en su propio mes no hubo ninguno:
        // ese es el caso real de "facturé en abril lo de marzo".
        (p.facturas || []).forEach(f => {
          let mm = f.dia ? Math.floor(f.dia / 100) : null;
          if (!mm) return;
          const dia = f.dia % 100;
          if (dia <= 10) {
            let a = Math.floor(mm / 100), m2 = (mm % 100) - 1;
            if (m2 < 1) { m2 = 12; a -= 1; }
            const anterior = a * 100 + m2;
            const suMes = meses[mm];
            const mesAnterior = meses[anterior];
            // Se mueve solo si su propio mes no tuvo pagos y el anterior sí, y le falta
            if ((!suMes || !suMes.nPagos) && mesAnterior && mesAnterior.nPagos &&
                mesAnterior.facturado < mesAnterior.pagado - 1) {
              mm = anterior;
            }
          }
          if (!meses[mm]) meses[mm] = { mes: mm, pagado: 0, facturado: 0, nPagos: 0, nFacturas: 0 };
          meses[mm].facturado += f.total;
          meses[mm].nFacturas++;
        });
        porMes = Object.keys(meses).map(m2 => {
          const x = meses[m2];
          const dif = Math.round((x.pagado - x.facturado) * 100) / 100;
          return {
            mes: x.mes,
            pagado: Math.round(x.pagado * 100) / 100,
            facturado: Math.round(x.facturado * 100) / 100,
            nPagos: x.nPagos, nFacturas: x.nFacturas,
            falta: dif > 1 ? dif : 0,
            cuadra: Math.abs(dif) <= 1 || (dif < 0 && !x.nPagos),
            motivo: dif > 1 ? (x.nFacturas ? 'Facturó de menos' : 'Sin factura de ese mes')
                   : (dif < -1 ? (x.nPagos ? 'Facturó de más' : 'Facturado y sin pagar')
                               : 'Cuadra'),
            // Facturar sin haber cobrado todavía no es un problema del proveedor
            porPagar: (dif < -1 && !x.nPagos) ? Math.abs(dif) : 0
          };
        }).sort((a, b) => b.mes - a.mes);
      }
      return Object.assign({}, p, {
        formaDeFacturar: esMensual ? 'mensual' : 'por pago',
        porMes: porMes,
        mesesQueNoCuadran: porMes ? porMes.filter(x => !x.cuadra).length : 0,
        pagado: Math.round(p.pagado * 100) / 100,
        faltaFacturar: dif > 1 ? dif : 0,
        aFavor: dif < -1 ? Math.abs(dif) : 0,
        razonesSociales: razonesPorProveedor[k] || [],
        facturas: (p.facturas || []).slice(0, 40),
        // TODOS los pagos, con la factura que les corresponde si se encuentra
        todosLosPagos: (todosLosPagos[k] || []).map(g => {
          if (!g.entraAlCruce) return g;
          const libres = (p.facturas || []).filter(f => !f._usada);
          // 1) Primero, una factura del mismo monto
          let hit = libres.filter(f => Math.abs(f.total - g.monto) <= 1)
            .sort((a, b) => Math.abs((a.dia || 0) - (g.dia || 0)) - Math.abs((b.dia || 0) - (g.dia || 0)))[0];
          let exacta = !!hit;
          // 2) Si no hay, una de fecha cercana (30 días): se pagó de más o de menos
          if (!hit) {
            hit = libres.filter(f => {
              const dd = (f.dia && g.dia) ? Math.abs(diasEntreFechas(f.dia, g.dia)) : null;
              return dd !== null && dd <= 30;
            }).sort((a, b) => {
              const da = Math.abs(diasEntreFechas(a.dia, g.dia));
              const db = Math.abs(diasEntreFechas(b.dia, g.dia));
              // Primero la de fecha más cercana; si empatan, la de monto más parecido
              return da - db || Math.abs(a.total - g.monto) - Math.abs(b.total - g.monto);
            })[0];
          }
          if (hit) {
            hit._usada = true;
            const dd = (hit.dia && g.dia) ? Math.abs(diasEntreFechas(hit.dia, g.dia)) : null;
            const dif = Math.round((hit.total - g.monto) * 100) / 100;
            return Object.assign({}, g, {
              factura: { uuid: hit.uuid, serie: hit.serie, folioF: hit.folioF,
                         fecha: hit.fecha, total: hit.total, metodo: hit.metodo },
              diasDeDiferencia: dd, cuadra: exacta,
              // Lo que se facturó de más (positivo) o de menos (negativo)
              diferencia: exacta ? 0 : dif,
              facturadoDeMas: dif > 1 ? dif : 0,
              pagadoDeMas: dif < -1 ? Math.abs(dif) : 0
            });
          }
          return Object.assign({}, g, { cuadra: false });
        }),
        // Los pagos que se quedaron sin respaldo, del más reciente al más viejo
        pagosDescubiertos: pagosOrdenados.filter(g => g.cubierto !== 'sí')
          .sort((a, b) => (b.dia || 0) - (a.dia || 0))
      });
    }).filter(p => p.pagado > 1 || p.facturado > 1)
      .sort((a, b) => b.faltaFacturar - a.faltaFacturar || b.pagado - a.pagado);

    const conFactura = Object.keys(porProveedor).filter(k => {
      const p = porProveedor[k];
      return p.pagado > 0 && p.pagado - p.facturado <= 1;
    }).length;

    faltaComplemento.sort((a, b) => (b.diasDeRetraso || 0) - (a.diasDeRetraso || 0) || (a.dia || 0) - (b.dia || 0));
    sinFactura.sort((a, b) => b.monto - a.monto);
    const suma = (a, k) => Math.round(a.reduce((t, x) => t + (x[k || 'total'] || 0), 0) * 100) / 100;

    // ---- Punto 127: Operación solo ve a SUS proveedores ----
    // A Nico le sirve saber qué facturas le deben los talleres, pero no tiene por qué
    // ver a los proveedores administrativos (renta, contador, software). Se filtra por
    // los que aparecen en Pedidos a Proveedores; los demás no salen.
    const sesion = core.verifyToken(body.token);
    const rolNorm = String((sesion && sesion.rol) || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let filtradoDeOperacion = null;
    if (rolNorm === 'operativo' || rolNorm === 'operacion') {
      const deProduccion = {};
      try {
        const cfgPed = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;
        if (cfgPed && cfgPed.id) {
          const vals = await core.readRange(cfgPed.id, cfgPed.sheetName);
          const Hp = (vals[0] || []).map(x => String(x).trim());
          const iProv = Hp.findIndex(x => norm(x) === norm('Proveedor'));
          if (iProv !== -1) {
            for (let i = 1; i < vals.length; i++) {
              const p = txt((vals[i] || [])[iProv]);
              if (p) deProduccion[norm(p)] = p;
            }
          }
        }
      } catch (e) { /* si no se puede leer, no se filtra: mejor de más que de menos */ }
      if (Object.keys(deProduccion).length) {
        // Un proveedor cuenta si su nombre o alguna de sus razones sociales está en pedidos
        const esDeProduccion = (nombre) => {
          const k = norm(nombre);
          if (deProduccion[k]) return true;
          return Object.keys(deProduccion).some(x => x && (k.indexOf(x) !== -1 || x.indexOf(k) !== -1));
        };
        const antes = faltaComplemento.length + sinFactura.length;
        faltaComplemento = faltaComplemento.filter(x => esDeProduccion(x.proveedor));
        sinFactura = sinFactura.filter(x => esDeProduccion(x.proveedor));
        conComplemento = conComplemento.filter(x => esDeProduccion(x.proveedor));
        filtradoDeOperacion = {
          activo: true,
          proveedoresDeProduccion: Object.keys(deProduccion).length,
          ocultos: antes - (faltaComplemento.length + sinFactura.length)
        };
      }
    }

    return res.status(200).json({
      ok: true,
      filtradoDeOperacion,
      faltaComplemento, conComplemento, puePro,
      sinRazonSocial: sinRazonSocial.slice(0, 60),
      duplicados: duplicados,
      // Un corte por mes con TODOS los proveedores: para agarrar un mes y ver a
      // quién hay que pedirle factura, en vez de ir proveedor por proveedor.
      resumenMensual: (() => {
        const g = {};
        sinFactura.forEach(p => {
          (p.porMes || []).forEach(m => {
            const e = g[m.mes] = g[m.mes] || { mes: m.mes, proveedores: [],
              pagado: 0, facturado: 0, falta: 0 };
            e.pagado += m.pagado; e.facturado += m.facturado;
            if (m.falta > 1) {
              e.falta += m.falta;
              e.proveedores.push({
                proveedor: p.proveedor, formaDeFacturar: p.formaDeFacturar,
                pagado: m.pagado, facturado: m.facturado, falta: m.falta,
                nPagos: m.nPagos, nFacturas: m.nFacturas, motivo: m.motivo,
                razonesSociales: p.razonesSociales || [],
                correo: p.correo || '', contacto: p.contacto || ''
              });
            }
          });
        });
        return Object.keys(g).map(k => {
          const e = g[k];
          e.pagado = Math.round(e.pagado * 100) / 100;
          e.facturado = Math.round(e.facturado * 100) / 100;
          e.falta = Math.round(e.falta * 100) / 100;
          e.proveedores.sort((a, b) => b.falta - a.falta);
          return e;
        }).sort((a, b) => b.mes - a.mes);
      })(),
      razonesPorProveedor: razonesPorProveedor,
      sinFactura: sinFactura.slice(0, 200),
      diagnostico: {
        columnaMetodoDePago: columnaMetodo || '(NO SE ENCONTRÓ)',
        columnasDeEgresos: columnasEgresos,
        tiposEncontrados: tiposVistos,
        formasDePagoEncontradas: formasVistas,
        seLeyoComplementos: !!comp.headers.length,
        filasComplementos: comp.rows.length,
        columnasComplementos: comp.headers.filter(Boolean),
        emisoresSinIdentificar: Object.keys(facturasPorProveedor)
          .filter(k => !aComercial[k] && !(razonesPorProveedor[k] || []).length)
          .slice(0, 40)
          .map(k => ({ nombre: facturasPorProveedor[k][0].proveedor,
                       facturas: facturasPorProveedor[k].length,
                       monto: Math.round(facturasPorProveedor[k].reduce((a, x) => a + x.total, 0) * 100) / 100 }))
      },
      totales: {
        facturasRecibidas: vig.rows.length,
        complementosRecibidos: comp.rows.length,
        faltaComplemento: faltaComplemento.length, montoFaltaComp: suma(faltaComplemento),
        vencidos: faltaComplemento.filter(x => x.urgente).length,
        conComplemento: conComplemento.length,
        pue: puePro.length,
        sinFactura: sinFactura.length, montoSinFactura: suma(sinFactura, 'faltaFacturar'),
        conFactura: conFactura, noAplican: noAplican, sinProveedor: sinProveedor,
        fueraDelCruce: enEfectivo, montoFueraDelCruce: Math.round(efectivoMonto * 100) / 100,
        anio: +body.anio || 2026, sinFecha: sinFecha, deOtroAnio: deOtroAnio,
        enEfectivo: enEfectivo, efectivoMonto: Math.round(efectivoMonto * 100) / 100,
        enLista: Object.keys(aComercial).length, sinRazonSocial: sinRazonSocial.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
