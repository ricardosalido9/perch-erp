// Reporte mensual de CFDIs: emitidos, recibidos y nómina.
// Es el respaldo del mes: cuánto se facturó, cuánto nos facturaron, cómo se pagó
// y qué complementos faltan. NO calcula el impuesto a pagar: eso es del contador.
//
// Las columnas de la descarga del SAT vienen con muchos nombres según de dónde se
// bajaron, así que cada una se busca con varios alias. Lo que no encuentre lo reporta
// en el diagnóstico en vez de inventar el número.
const core = require('../core');
const CFG = require('../config');
const { reporteCfdi } = require('../pdf-cfdi');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  if (/^#(VALUE|REF|DIV|N\/A|NAME|NUM|NULL)/i.test(t)) return 0;
  // Formato contable: "-$ 1,234.00-" no es negativo, los guiones son de alineación
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
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
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
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  return null;
}

async function leerHoja(id, pestana) {
  if (!id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(id, pestana); } catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers, rows };
}

// Un bloque del reporte: totales por alguna clasificación
function agrupar(filas, clasificar, campos) {
  const g = {};
  filas.forEach(r => {
    const k = clasificar(r) || '(sin clasificar)';
    const o = g[k] = g[k] || { etiqueta: k, n: 0 };
    o.n++;
    Object.keys(campos).forEach(c => { o[c] = (o[c] || 0) + campos[c](r); });
  });
  return Object.keys(g).map(k => g[k]).sort((a, b) => (b.total || 0) - (a.total || 0));
}
const red = (n) => Math.round((n || 0) * 100) / 100;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const hoy = new Date();
    const anio = +body.anio || hoy.getFullYear();
    let mes = +body.mes;
    if (!mes) { mes = hoy.getMonth(); if (mes === 0) mes = 12; }

    const [emi, emiComp, rec, recComp, nom] = await Promise.all([
      leerHoja(CFG.ARCHIVOS.CFDI_EMITIDOS, CFG.PESTANAS.cfdiVigentes),
      leerHoja(CFG.ARCHIVOS.CFDI_EMITIDOS, CFG.PESTANAS.cfdiComplementos),
      leerHoja(CFG.ARCHIVOS.CFDI_RECIBIDOS, CFG.PESTANAS.cfdiVigentes),
      leerHoja(CFG.ARCHIVOS.CFDI_RECIBIDOS, CFG.PESTANAS.cfdiComplementos),
      leerHoja(CFG.ARCHIVOS.CFDI_RECIBIDOS, 'NOMINA').then(x => x.headers.length ? x
        : leerHoja(CFG.ARCHIVOS.CFDI_RECIBIDOS, 'Nómina'))
    ]);
    if (!emi.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer la pestaña de CFDIs emitidos.' });
    }

    const faltantes = [];
    // Arma el resumen de una hoja de CFDIs (sirve igual para emitidos y recibidos)
    function bloque(hoja, etiqueta) {
      const H = hoja.headers;
      if (!H.length) return null;
      const cFec = col(H, 'Fecha Emision', 'Fecha Emisión', 'Fecha');
      const cTipo = col(H, 'Tipo', 'Tipo de Comprobante', 'Efecto Comprobante');
      const cEst = col(H, 'Estado SAT', 'Estado', 'Estatus');
      const cMet = col(H, 'Metodo de Pago', 'Método de Pago', 'MetodoPago');
      const cSub = col(H, 'Subtotal', 'SubTotal', 'Sub Total');
      // En la descarga del SAT la columna se llama "IVA 16%", no "IVA"
      const cIva = col(H, 'IVA 16%', 'IVA', 'IVA Trasladado', 'Impuestos Trasladados',
                       'Total Impuestos Trasladados', 'IVA Acreditable');
      const cTot = col(H, 'Total');
      const cRetI = col(H, 'Retenido IVA', 'IVA Retenido', 'Retencion IVA', 'Retención IVA');
      const cRetR = col(H, 'Retenido ISR', 'ISR Retenido', 'Retencion ISR', 'Retención ISR');
      const cUUID = col(H, 'UUID');
      const cConc = col(H, 'Conciliado', 'Conciliada', 'Conciliado PUE');
      const cDesc = col(H, 'Descuento');
      if (!cSub) faltantes.push(etiqueta + ': no tiene columna de Subtotal');
      if (!cIva) faltantes.push(etiqueta + ': no tiene columna de IVA');
      if (!cTot) faltantes.push(etiqueta + ': no tiene columna de Total');
      if (!cFec) faltantes.push(etiqueta + ': no tiene columna de Fecha');

      // Solo el mes que se está cerrando, y sin cancelados
      const delMes = hoja.rows.filter(r => {
        if (cEst && /cancel/i.test(txt(r[cEst]))) return false;
        const d = cFec ? fechaNum(r[cFec]) : null;
        return d !== null && Math.floor(d / 10000) === anio && Math.floor(d / 100) % 100 === mes;
      });

      const campos = {
        subtotal: r => cSub ? num(r[cSub]) : 0,
        iva: r => cIva ? num(r[cIva]) : 0,
        total: r => cTot ? num(r[cTot]) : 0,
        retIva: r => cRetI ? num(r[cRetI]) : 0,
        retIsr: r => cRetR ? num(r[cRetR]) : 0
      };
      const esNota = (r) => /nota de credito|egreso|^e$/i.test(norm(cTipo ? r[cTipo] : ''));
      const metodo = (r) => {
        const m = norm(cMet ? r[cMet] : '');
        if (/ppd|parcialidad|diferido/.test(m)) return 'PPD - Pago en parcialidades o diferido';
        if (/pue|una sola/.test(m)) return 'PUE - Pago en una sola exhibición';
        return m ? txt(r[cMet]) : '(sin método)';
      };
      const esPUE = (r) => /^PUE/.test(metodo(r));
      const esPPD = (r) => /^PPD/.test(metodo(r));

      // Complementos que llegaron para las PPD de este mes
      const uuidsConComplemento = {};
      const comp = (etiqueta === 'Emitidos') ? emiComp : recComp;
      if (comp && comp.headers.length) {
        const cRel = col(comp.headers, 'UUIDRel', 'UUID Relacion', 'UUID Relación',
                         'UUID Relacionado');
        const cEstC = col(comp.headers, 'Estado SAT', 'Estado');
        if (cRel) comp.rows.forEach(r => {
          if (cEstC && /cancel/i.test(txt(r[cEstC]))) return;
          const u = txt(r[cRel]).toUpperCase();
          if (u) uuidsConComplemento[u] = 1;
        });
      }
      const tieneComplemento = (r) =>
        cUUID ? !!uuidsConComplemento[txt(r[cUUID]).toUpperCase()] : false;

      const ppd = delMes.filter(esPPD);
      const pue = delMes.filter(esPUE);
      const sum = (lista, c) => red(lista.reduce((a, r) => a + campos[c](r), 0));

      return {
        etiqueta,
        n: delMes.length,
        porTipo: [
          { etiqueta: 'Factura', n: delMes.filter(r => !esNota(r)).length,
            subtotal: sum(delMes.filter(r => !esNota(r)), 'subtotal'),
            iva: sum(delMes.filter(r => !esNota(r)), 'iva'),
            total: sum(delMes.filter(r => !esNota(r)), 'total') },
          { etiqueta: 'Nota de Crédito', n: delMes.filter(esNota).length,
            subtotal: sum(delMes.filter(esNota), 'subtotal'),
            iva: sum(delMes.filter(esNota), 'iva'),
            total: sum(delMes.filter(esNota), 'total') }
        ],
        porMetodo: agrupar(delMes, metodo, campos).map(x => ({
          etiqueta: x.etiqueta, n: x.n, subtotal: red(x.subtotal), iva: red(x.iva),
          total: red(x.total), retIva: red(x.retIva), retIsr: red(x.retIsr)
        })),
        complementos: [
          { etiqueta: 'Ya con complemento', n: ppd.filter(tieneComplemento).length,
            subtotal: sum(ppd.filter(tieneComplemento), 'subtotal'),
            iva: sum(ppd.filter(tieneComplemento), 'iva'),
            total: sum(ppd.filter(tieneComplemento), 'total') },
          { etiqueta: 'Todavía sin complemento', n: ppd.filter(r => !tieneComplemento(r)).length,
            subtotal: sum(ppd.filter(r => !tieneComplemento(r)), 'subtotal'),
            iva: sum(ppd.filter(r => !tieneComplemento(r)), 'iva'),
            total: sum(ppd.filter(r => !tieneComplemento(r)), 'total') }
        ],
        totales: {
          subtotal: sum(delMes, 'subtotal'), iva: sum(delMes, 'iva'),
          total: sum(delMes, 'total'),
          retIva: sum(delMes, 'retIva'), retIsr: sum(delMes, 'retIsr'),
          pue: pue.length, ppd: ppd.length,
          ivaPPDsinComplemento: sum(ppd.filter(r => !tieneComplemento(r)), 'iva')
        },
        columnas: {
          subtotal: cSub || '(no está)', iva: cIva || '(no está)',
          total: cTot || '(no está)', metodo: cMet || '(no está)',
          retencionIva: cRetI || '(no está)', retencionIsr: cRetR || '(no está)',
          conciliado: cConc || '(no está)'
        }
      };
    }

    const emitidos = bloque(emi, 'Emitidos');
    const recibidos = rec.headers.length ? bloque(rec, 'Recibidos') : null;

    // Nómina: si la descarga trae los CFDIs de nómina, se resume igual
    let nomina = null;
    if (nom && nom.headers.length) {
      const H = nom.headers;
      const cFec = col(H, 'Fecha Emision', 'Fecha Emisión', 'Fecha');
      const cPer = col(H, 'Percepciones', 'Total Percepciones');
      const cDes = col(H, 'Descuento', 'Deducciones', 'Total Deducciones');
      const cTot = col(H, 'Total');
      const cRet = col(H, 'TotalImpuestosRetenidos', 'Total Impuestos Retenidos',
                       'Impuestos Retenidos');
      const cTipoN = col(H, 'Tipo', 'TipoNomina');
      const cReg = col(H, 'TipoRegimen', 'Tipo Regimen', 'Régimen');
      const filas = nom.rows.filter(r => {
        const d = cFec ? fechaNum(r[cFec]) : null;
        return d !== null && Math.floor(d / 10000) === anio && Math.floor(d / 100) % 100 === mes;
      });
      if (filas.length && cPer) {
        const campos = {
          percepciones: r => num(r[cPer]),
          descuento: r => cDes ? num(r[cDes]) : 0,
          total: r => cTot ? num(r[cTot]) : 0,
          retenidos: r => cRet ? num(r[cRet]) : 0
        };
        nomina = {
          n: filas.length,
          porTipo: agrupar(filas, r => txt(cTipoN ? r[cTipoN] : '') || 'Sin tipo', campos)
            .map(x => ({ etiqueta: x.etiqueta, n: x.n, percepciones: red(x.percepciones),
                         descuento: red(x.descuento), total: red(x.total),
                         retenidos: red(x.retenidos) })),
          porRegimen: agrupar(filas, r => txt(cReg ? r[cReg] : '') || 'Sin régimen', campos)
            .map(x => ({ etiqueta: x.etiqueta, n: x.n, percepciones: red(x.percepciones),
                         descuento: red(x.descuento), total: red(x.total),
                         retenidos: red(x.retenidos) })),
          totales: {
            percepciones: red(filas.reduce((a, r) => a + campos.percepciones(r), 0)),
            descuento: red(filas.reduce((a, r) => a + campos.descuento(r), 0)),
            total: red(filas.reduce((a, r) => a + campos.total(r), 0)),
            retenidos: red(filas.reduce((a, r) => a + campos.retenidos(r), 0))
          }
        };
      }
    }

    const datos = {
      empresa: CFG.EMPRESA.nombre || 'Perch',
      rfc: CFG.EMPRESA.rfc || '',
      mes: MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1),
      anio, emitidos, recibidos, nomina,
      // El IVA del mes, que es lo que de verdad importa del reporte
      iva: (emitidos && recibidos) ? {
        trasladado: emitidos.totales.iva,
        acreditable: recibidos.totales.iva,
        diferencia: red(emitidos.totales.iva - recibidos.totales.iva)
      } : null,
      advertencias: faltantes
    };

    if (body.soloDatos) return res.status(200).json({ ok: true, datos, mes, anio });

    const buf = await reporteCfdi(datos, {
      generado: hoy.getDate() + ' de ' + MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear()
    });
    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      nombre: 'CFDIs ' + datos.mes + ' ' + anio + ' - ' + datos.empresa + '.pdf',
      advertencias: faltantes,
      resumen: {
        emitidos: emitidos ? emitidos.n : 0,
        recibidos: recibidos ? recibidos.n : 0,
        nomina: nomina ? nomina.n : 0
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
