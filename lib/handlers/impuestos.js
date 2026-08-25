// Resumen fiscal del mes: lo que hay que revisar antes de pagar impuestos.
//
// Junta en una sola pantalla el IVA trasladado (de lo que facturamos) contra el
// acreditable (de lo que nos facturaron), y los pendientes que afectan ese cálculo:
// complementos que faltan, facturas por emitir y pagos sin comprobante.
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
  if (/^#(VALUE|REF|DIV|N\/A|NAME|NUM|NULL)/i.test(t)) return 0;
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
  try { values = await core.readRange(id, hoja); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
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
// El complemento vence el día 5 del mes siguiente al pago
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
    const hoy = new Date();
    const anio = +body.anio || hoy.getFullYear();

    const cfgE = core.SHEETS.cfdi_vigentes;
    const cfgR = core.SHEETS.cfdi_recibidos;
    // La pestaña de complementos se llama distinto en cada archivo
    const buscarComplementos = async (id) => {
      if (!id) return { headers: [], rows: [] };
      for (const n of ['COMPLEMENTOS DE PAGO', 'Complementos de Pago', 'Complementos',
                       'Complementos de pago', 'COMPLEMENTOS', 'Pagos']) {
        const h = await leerHoja(id, n);
        if (h.headers.length) return h;
      }
      return { headers: [], rows: [] };
    };
    let [emit, recib, cxc] = await Promise.all([
      cfgE && cfgE.id ? leerHoja(cfgE.id, cfgE.sheetName || 'VIGENTES') : Promise.resolve({ headers: [], rows: [] }),
      cfgR && cfgR.id ? leerHoja(cfgR.id, cfgR.sheetName || 'VIGENTES') : Promise.resolve({ headers: [], rows: [] }),
      leerArea('fin_cxc')
    ]);
    const [emitComp, recibComp] = await Promise.all([
      buscarComplementos(cfgE && cfgE.id), buscarComplementos(cfgR && cfgR.id)
    ]);

    // Si no se pudo leer nada, se dice por qué en vez de devolver una pantalla vacía
    if (!emit.headers.length && !recib.headers.length) {
      const diag = { archivoEmitidos: cfgE ? cfgE.id : '(no configurado)',
                     pestanaEmitidos: cfgE ? cfgE.sheetName : '',
                     archivoRecibidos: cfgR ? cfgR.id : '(no configurado)',
                     pestanaRecibidos: cfgR ? cfgR.sheetName : '' };
      try { diag.pestanasEmitidos = await core.listTabs(cfgE.id); } catch (e) { diag.pestanasEmitidos = []; }
      try { diag.pestanasRecibidos = await core.listTabs(cfgR.id); } catch (e) { diag.pestanasRecibidos = []; }
      return res.status(200).json({
        ok: false, sinDatos: true, diagnostico: diag,
        mensaje: 'No se pudieron leer los CFDIs. Revisa el nombre de las pestañas.'
      });
    }

    // --- Los CFDIs, mes por mes: base, IVA y total ---
    const resumir = (hoja, quien) => {
      if (!hoja.headers.length) return null;
      const H = hoja.headers;
      const cTipo = col(H, 'Tipo');
      const cEst = col(H, 'Estado SAT');
      const cFec = col(H, 'Fecha Emision', 'Fecha Emisión');
      const cSub = col(H, 'SubTotal', 'Subtotal');
      const cIVA = col(H, 'IVA 16%', 'IVA');
      const cRetI = col(H, 'Retenido IVA');
      const cRetIsr = col(H, 'Retenido ISR');
      const cTot = col(H, 'Total');
      const cUUID = col(H, 'UUID');
      const cMet = col(H, 'Metodo de Pago', 'Método de Pago');
      const cNom = col(H, quien === 'emitidas' ? 'Nombre Receptor' : 'Nombre Emisor');
      const meses = {};
      let canceladas = 0;
      // Por qué se descarta cada renglón: sin esto, un mes en cero no se distingue
      // de un mes que no se pudo leer.
      const descartes = { total: hoja.rows.length, esPago: 0, esNomina: 0, sinFecha: 0,
                          deOtroAnio: 0, canceladas: 0, contadas: 0,
                          sinSubtotal: 0, sinIva: 0, ejemplosSinFecha: [] };
      hoja.rows.forEach(r => {
        const tipo = norm(cTipo ? r[cTipo] : '');
        if (/^p$|^pago|complement/.test(tipo)) { descartes.esPago++; return; }
        if (/^n$|^nomina|nómina/.test(tipo)) { descartes.esNomina++; return; }
        const cancelada = /cancelad/i.test(txt(cEst ? r[cEst] : ''));
        const d = cFec ? fechaNum(r[cFec]) : null;
        if (d === null) {
          descartes.sinFecha++;
          if (descartes.ejemplosSinFecha.length < 5) {
            descartes.ejemplosSinFecha.push(txt(cFec ? r[cFec] : '(columna no encontrada)'));
          }
          return;
        }
        if (Math.floor(d / 10000) !== anio) { descartes.deOtroAnio++; return; }
        if (cancelada) { canceladas++; descartes.canceladas++; return; }
        descartes.contadas++;
        if (!cSub || !num(r[cSub])) descartes.sinSubtotal++;
        if (!cIVA || !num(r[cIVA])) descartes.sinIva++;
        const m = Math.floor(d / 100) % 100;
        const esEgreso = /^e$|^egreso|nota de credito/.test(tipo);
        const signo = esEgreso ? -1 : 1;   // las notas de crédito restan
        if (!meses[m]) meses[m] = { mes: m, base: 0, iva: 0, retIVA: 0, retISR: 0, total: 0, n: 0,
                                    notasCredito: 0 };
        meses[m].base += signo * (cSub ? num(r[cSub]) : 0);
        meses[m].iva += signo * (cIVA ? num(r[cIVA]) : 0);
        meses[m].retIVA += signo * (cRetI ? num(r[cRetI]) : 0);
        meses[m].retISR += signo * (cRetIsr ? num(r[cRetIsr]) : 0);
        meses[m].total += signo * (cTot ? num(r[cTot]) : 0);
        meses[m].n++;
        if (esEgreso) meses[m].notasCredito++;
      });
      const red = (n) => Math.round(n * 100) / 100;
      return {
        canceladas,
        // Qué columnas encontró y qué hizo con cada renglón
        lectura: {
          columnas: {
            fecha: cFec || '(NO ESTÁ)', subtotal: cSub || '(NO ESTÁ)',
            iva: cIVA || '(NO ESTÁ)', total: cTot || '(NO ESTÁ)',
            tipo: cTipo || '(NO ESTÁ)', estado: cEst || '(NO ESTÁ)'
          },
          encabezados: H.filter(Boolean),
          descartes: descartes
        },
        porMes: Object.keys(meses).map(k => {
          const x = meses[k];
          return { mes: x.mes, n: x.n, notasCredito: x.notasCredito,
                   base: red(x.base), iva: red(x.iva),
                   retIVA: red(x.retIVA), retISR: red(x.retISR), total: red(x.total) };
        }).sort((a, b) => a.mes - b.mes)
      };
    };
    const emitidas = resumir(emit, 'emitidas');
    const recibidas = resumir(recib, 'recibidas');
    // El detalle de qué se leyó y qué se descartó, para la pantalla
    const lectura = {
      emitidas: emitidas ? emitidas.lectura : null,
      recibidas: recibidas ? recibidas.lectura : null
    };

    // --- El IVA del mes: trasladado menos acreditable ---
    const mesesTodos = [];
    for (let m = 1; m <= 12; m++) {
      const e = emitidas ? emitidas.porMes.filter(x => x.mes === m)[0] : null;
      const r = recibidas ? recibidas.porMes.filter(x => x.mes === m)[0] : null;
      if (!e && !r) continue;
      const trasladado = e ? e.iva : 0;
      const acreditable = r ? r.iva : 0;
      const retenido = e ? e.retIVA : 0;
      mesesTodos.push({
        mes: m,
        facturado: e ? e.total : 0, baseFacturada: e ? e.base : 0, facturas: e ? e.n : 0,
        comprado: r ? r.total : 0, baseComprada: r ? r.base : 0, recibidas: r ? r.n : 0,
        ivaTrasladado: trasladado,
        ivaAcreditable: acreditable,
        ivaRetenido: retenido,
        // A cargo si el trasladado supera al acreditable
        ivaAPagar: Math.round((trasladado - acreditable - retenido) * 100) / 100,
        isrRetenido: e ? e.retISR : 0,
        notasCredito: (e ? e.notasCredito : 0) + (r ? r.notasCredito : 0)
      });
    }

    // --- Lo que falta y afecta el cálculo ---
    const pendientes = [];
    const hoyN = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();

    // 1) Complementos que debemos emitir (facturas PPD ya cobradas)
    if (emit.headers.length) {
      const H = emit.headers;
      const cUUID = col(H, 'UUID'), cMet = col(H, 'Metodo de Pago', 'Método de Pago');
      const cFec = col(H, 'Fecha Emision', 'Fecha Emisión');
      const cTot = col(H, 'Total'), cTipo = col(H, 'Tipo'), cEst = col(H, 'Estado SAT');
      const cRec = col(H, 'Nombre Receptor');
      // Los complementos que ya se emitieron
      const yaComplementadas = {};
      if (emitComp.headers.length) {
        const cRel = col(emitComp.headers, 'UUIDRel', 'UUID Relacion');
        const cMonto = col(emitComp.headers, 'Monto', 'Total');
        if (cRel) emitComp.rows.forEach(r => {
          const u = normUUID(r[cRel]);
          if (!u) return;
          yaComplementadas[u] = (yaComplementadas[u] || 0) + (cMonto ? num(r[cMonto]) : 0);
        });
      }
      let faltan = 0, montoFaltan = 0, vencidos = 0;
      emit.rows.forEach(r => {
        const tipo = norm(cTipo ? r[cTipo] : '');
        if (/^p$|^pago|complement|^e$|^egreso/.test(tipo)) return;
        if (/cancelad/i.test(txt(cEst ? r[cEst] : ''))) return;
        if (!/ppd/.test(norm(cMet ? r[cMet] : ''))) return;
        const d = cFec ? fechaNum(r[cFec]) : null;
        if (d === null || Math.floor(d / 10000) !== anio) return;
        const u = normUUID(r[cUUID]);
        const total = cTot ? num(r[cTot]) : 0;
        const pagado = yaComplementadas[u] || 0;
        if (pagado >= total - 1) return;
        faltan++;
        montoFaltan += (total - pagado);
        const vence = venceComplemento(d);
        if (vence && vence < hoyN) vencidos++;
      });
      if (faltan) pendientes.push({
        tipo: 'emitir', urgente: vencidos > 0,
        titulo: 'Complementos que debemos emitir',
        detalle: faltan + ' facturas PPD sin complemento completo' +
                 (vencidos ? ' · ' + vencidos + ' ya vencidos' : ''),
        n: faltan, monto: Math.round(montoFaltan * 100) / 100, area: 'cfdi_control'
      });
    }

    // 2) Complementos que nos deben los proveedores
    if (recib.headers.length) {
      const H = recib.headers;
      const cUUID = col(H, 'UUID'), cMet = col(H, 'Metodo de Pago', 'Método de Pago');
      const cFec = col(H, 'Fecha Emision', 'Fecha Emisión');
      const cTot = col(H, 'Total'), cTipo = col(H, 'Tipo'), cEst = col(H, 'Estado SAT');
      const yaRecibidos = {};
      if (recibComp.headers.length) {
        const cRel = col(recibComp.headers, 'UUIDRel', 'UUID Relacion');
        const cMonto = col(recibComp.headers, 'Monto', 'Total');
        if (cRel) recibComp.rows.forEach(r => {
          const u = normUUID(r[cRel]);
          if (!u) return;
          yaRecibidos[u] = (yaRecibidos[u] || 0) + (cMonto ? num(r[cMonto]) : 0);
        });
      }
      let faltan = 0, montoIVA = 0;
      recib.rows.forEach(r => {
        const tipo = norm(cTipo ? r[cTipo] : '');
        if (/^p$|^pago|complement|^e$|^egreso/.test(tipo)) return;
        if (/cancelad/i.test(txt(cEst ? r[cEst] : ''))) return;
        if (!/ppd/.test(norm(cMet ? r[cMet] : ''))) return;
        const d = cFec ? fechaNum(r[cFec]) : null;
        if (d === null || Math.floor(d / 10000) !== anio) return;
        const u = normUUID(r[cUUID]);
        const total = cTot ? num(r[cTot]) : 0;
        if ((yaRecibidos[u] || 0) >= total - 1) return;
        faltan++;
        const cIVA = col(H, 'IVA 16%', 'IVA');
        montoIVA += cIVA ? num(r[cIVA]) : 0;
      });
      if (faltan) pendientes.push({
        tipo: 'pedir', urgente: false,
        titulo: 'Complementos que nos deben',
        detalle: faltan + ' facturas PPD de proveedores sin su complemento. ' +
                 'Sin él no se puede acreditar ese IVA',
        n: faltan, monto: Math.round(montoIVA * 100) / 100, area: 'cfdi_prov'
      });
    }

    // 3) Ventas cobradas que siguen sin factura
    if (cxc.headers.length) {
      const H = cxc.headers;
      const cPide = col(H, 'Factura Si / No', 'Requiere factura', 'Factura');
      const cUUID = col(H, 'UUID', 'Folio Fiscal');
      const cPag = col(H, 'Pagado', 'Total Cobrado');
      const cTot = col(H, 'Total con envío', 'Total con envio', 'Total');
      if (cPide && cUUID) {
        let n = 0, monto = 0;
        cxc.rows.forEach(r => {
          const pide = /^(si|sí|true|x|1)$/i.test(txt(r[cPide]));
          if (!pide || txt(r[cUUID])) return;
          const pagado = cPag ? num(r[cPag]) : 0;
          if (pagado <= 0) return;
          n++;
          monto += cTot ? num(r[cTot]) : 0;
        });
        if (n) pendientes.push({
          tipo: 'emitir', urgente: true,
          titulo: 'Cobrado y sin facturar',
          detalle: n + ' ventas ya cobradas sin factura emitida',
          n, monto: Math.round(monto * 100) / 100, area: 'fac_control'
        });
      }
    }

    const red = (x) => Math.round(x * 100) / 100;
    const totalAnio = mesesTodos.reduce((a, m) => ({
      facturado: a.facturado + m.facturado,
      comprado: a.comprado + m.comprado,
      ivaTrasladado: a.ivaTrasladado + m.ivaTrasladado,
      ivaAcreditable: a.ivaAcreditable + m.ivaAcreditable,
      ivaRetenido: a.ivaRetenido + m.ivaRetenido,
      ivaAPagar: a.ivaAPagar + m.ivaAPagar,
      isrRetenido: a.isrRetenido + m.isrRetenido
    }), { facturado: 0, comprado: 0, ivaTrasladado: 0, ivaAcreditable: 0,
          ivaRetenido: 0, ivaAPagar: 0, isrRetenido: 0 });
    Object.keys(totalAnio).forEach(k => { totalAnio[k] = red(totalAnio[k]); });

    // El mes anterior es el que toca declarar
    let mesDeclarar = hoy.getMonth();       // 0..11 -> el mes pasado en base 1
    if (mesDeclarar === 0) mesDeclarar = 12;
    const elMes = mesesTodos.filter(m => m.mes === mesDeclarar)[0] || null;

    return res.status(200).json({
      ok: true, anio,
      mesDeclarar, elMes,
      // El día 17 del mes siguiente vence la declaración
      venceDeclaracion: (() => {
        const a = mesDeclarar === 12 ? anio + 1 : anio;
        const m = mesDeclarar === 12 ? 1 : mesDeclarar + 1;
        return a * 10000 + m * 100 + 17;
      })(),
      meses: mesesTodos,
      totalAnio,
      pendientes,
      canceladas: {
        emitidas: emitidas ? emitidas.canceladas : 0,
        recibidas: recibidas ? recibidas.canceladas : 0
      },
      lectura,
      fuentes: {
        emitidas: emit.headers.length ? emit.rows.length : 0,
        complementosEmitidos: emitComp.rows.length,
        recibidas: recib.headers.length ? recib.rows.length : 0,
        complementosRecibidos: recibComp.rows.length,
        columnasEmitidas: emit.headers.filter(Boolean).slice(0, 40),
        columnasRecibidas: recib.headers.filter(Boolean).slice(0, 40),
        // Qué columnas encontró para el cálculo
        columnasClave: (() => {
          const H = emit.headers;
          return {
            fecha: col(H, 'Fecha Emision', 'Fecha Emisión') || '(NO ENCONTRADA)',
            subtotal: col(H, 'SubTotal', 'Subtotal') || '(NO ENCONTRADA)',
            iva: col(H, 'IVA 16%', 'IVA') || '(NO ENCONTRADA)',
            total: col(H, 'Total') || '(NO ENCONTRADA)',
            tipo: col(H, 'Tipo') || '(NO ENCONTRADA)',
            estado: col(H, 'Estado SAT') || '(NO ENCONTRADA)'
          };
        })(),
        aniosEncontrados: (() => {
          const H = emit.headers, cF = col(H, 'Fecha Emision', 'Fecha Emisión');
          if (!cF) return [];
          const a = {};
          emit.rows.forEach(r => {
            const d = fechaNum(r[cF]);
            if (d) a[Math.floor(d / 10000)] = (a[Math.floor(d / 10000)] || 0) + 1;
          });
          return Object.keys(a).map(k => ({ anio: +k, n: a[k] })).sort((x, y) => y.anio - x.anio);
        })()
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
