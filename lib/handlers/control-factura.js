// Control de facturación: qué está cobrado y falta facturar, y qué ya se facturó.
//
// Junta tres cosas que hoy viven separadas: los cobros que registró Comercial,
// los ingresos del banco que los confirman, y los CFDIs que el SAT tiene. Con eso
// dice, por folio, si ya hay factura o sigue pendiente.
//
// Lo importante es el plazo: una factura se emite dentro del mes del cobro. Si se
// pasa el mes ya no se puede, así que lo que urge se separa de lo que todavía da
// tiempo.
//
//   ?action=control-factura
const core = require('../core');
const cotejo = require('./cxc-cotejo');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const MESN = { ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4, may:5, mayo:5,
               jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8, sep:9, sept:9, septiembre:9,
               oct:10, octubre:10, nov:11, noviembre:11, dic:12, diciembre:12 };

const txt = (v) => String(v == null ? '' : v).trim();
let hayColumnaUso = false;
// El formato contable de las hojas trae guiones y símbolos: -$ 1,234.00-
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) t = t.replace(/^-\s*/, '').replace(/-\s*$/, '');
  const n = parseFloat(t.replace(/[^0-9.,\-]/g, '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
const normFolio = (v) => norm(String(v == null ? '' : v).trim().replace(/\.0+$/, ''));
function fechaNum(v) {
  const t = norm(v);
  if (!t) return 0;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = t.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MESN[m[2]]) return +m[3] * 10000 + MESN[m[2]] * 100 + +m[1];
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  return 0;
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // Los cobros ya cruzados contra el banco
    let cot = null, err = null;
    const captura = { status: (c) => ({ json: (o) => {
      if (c === 200 && o && o.ok) cot = o; else err = o; return o; } }) };
    await cotejo({ _body: { token: body.token } }, captura);
    if (!cot) return res.status(400).json({ error: (err && err.error) || 'No se pudo leer los cobros.',
                                            pista: err && err.pista });

    // Las facturas que el SAT tiene, para no depender de que alguien las marque
    const cfg = core.areaCfg ? await core.areaCfg('cfdi_vigentes') : core.SHEETS.cfdi_vigentes;
    const facturas = [];
    let leidas = 0, columnaFolio = '(no se encontró)';
    if (cfg && cfg.id) {
      let values = [];
      for (const pest of [cfg.sheetName || 'EMITIDOS'].concat(cfg.sheetNameAlt || [])) {
        try { values = await core.readRange(cfg.id, pest); } catch (e) { values = []; }
        if (values && values.length) break;
      }
      if (values && values.length) {
        const H = (values[0] || []).map(h => txt(h));
        // El CFDI viene de la descarga del SAT y no trae el folio de la venta: no
        // es algo que se pueda pedir a quien factura. Se cruza por el cliente, el
        // monto y la fecha, que es lo que sí trae.
        const cRef = col(H, 'No. de Referencia', 'Folio', 'Pedido', 'Folio cliente');
        const cRec = col(H, 'Nombre Receptor', 'Receptor', 'Cliente');
        const cUUID = col(H, 'UUID');
        const cFec = col(H, 'Fecha Emision', 'Fecha Emisión', 'Fecha');
        const cTot = col(H, 'Total');
        const cEst = col(H, 'Estado SAT', 'Estado');
        // El uso de CFDI con el que ya se le facturó antes a ese cliente. No es
        // una preferencia inventada: es lo que el SAT tiene timbrado. Sirve para
        // poder dar Condiciones OK sin esperar a que alguien capture la ficha.
        const cUso = col(H, 'UsoCFDI', 'Uso CFDI', 'Uso de CFDI');
        const cSer = col(H, 'Serie'), cFol = col(H, 'Folio');
        columnaFolio = cRef || '(el SAT no la trae: se cruza por cliente y monto)';
        for (let i = 1; i < values.length; i++) {
          const o = {}; H.forEach((h, j) => { o[h] = values[i][j]; });
          if (/cancelad/i.test(txt(cEst ? o[cEst] : ''))) continue;   // una cancelada no factura nada
          const total = cTot ? Number(String(o[cTot]).replace(/[^0-9.-]/g, '')) || 0 : 0;
          if (!total) continue;
          leidas++;
          facturas.push({
            folio: cRef ? normFolio(o[cRef]) : '',
            receptor: norm(cRec ? o[cRec] : ''),
            uuid: txt(cUUID ? o[cUUID] : ''), fecha: txt(cFec ? o[cFec] : ''),
            dia: fechaNum(cFec ? o[cFec] : ''), total, usada: false,
            uso: txt(cUso ? o[cUso] : ''),
            serieFolio: [txt(cSer ? o[cSer] : ''), txt(cFol ? o[cFol] : '')]
                        .filter(Boolean).join('-')
          });
        }
      }
    }

    // El último uso de CFDI por cliente, con la factura de la que salió. Si la
    // ficha del cliente todavía no lo tiene capturado, esto es lo que de verdad
    // se le facturó la vez pasada.
    const usoPrevio = {};
    facturas.slice().sort((a, b) => a.dia - b.dia).forEach(f => {
      if (!f.receptor || !f.uso) return;
      usoPrevio[f.receptor] = { uso: f.uso, fecha: f.fecha, factura: f.serieFolio };
    });

    const hoy = new Date();
    const mesHoy = hoy.getFullYear() * 100 + (hoy.getMonth() + 1);
    const diaHoy = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();
    const finDeMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasQueQuedan = finDeMes - hoy.getDate();

    // Entran los cobros confirmados por el banco Y los que todavía no.
    //
    // Esperar a la conciliación para avisar que falta facturar es al revés: el
    // plazo corre desde la fecha del pago, no desde el día que alguien sube el
    // estado de cuenta. Si se espera, el mes se pasa y ya no se puede emitir.
    // Los que el banco no ha confirmado salen marcados, para que quien factura
    // decida si emite o espera el dinero — pero los ve.
    const cobros = (cot.confirmados || []).map(c => Object.assign({}, c, { enBanco: true }))
      .concat((cot.sinBanco || []).map(c => Object.assign({}, c, { enBanco: false })));

    // Los datos fiscales del cliente y el total de su venta.
    //
    // Esto es lo que hay que revisar antes de pedir la factura, y hoy vive en
    // tres pantallas distintas: el RFC y el régimen en la ficha del cliente, el
    // total en la venta, y el método en los CFDIs una vez emitida. Juntarlo aquí
    // es la diferencia entre revisar y adivinar.
    const fiscales = {}, totalDeVenta = {};
    try {
      const cfgC2 = core.areaCfg ? await core.areaCfg('ventas_clientes') : core.SHEETS.ventas_clientes;
      if (cfgC2 && cfgC2.id) {
        const v = await core.readRange(cfgC2.id, await core.resolveSheetName(cfgC2));
        const hr2 = core._hrIdx ? core._hrIdx(cfgC2, v) : 0;
        const Hc = (v[hr2] || []).map(h => txt(h));
        const ix = (re) => Hc.findIndex(h => re.test(h));
        const iN = ix(/nombre\/raz[oó]n social|^nombre$|^cliente$/i);
        const iRS = ix(/^raz[oó]n social$/i), iRF = ix(/^rfc$/i);
        const iRG = ix(/r[ée]gimen/i), iUS = ix(/uso de cfdi|uso cfdi/i);
        hayColumnaUso = iUS !== -1;
        if (iN !== -1) for (let i = hr2 + 1; i < v.length; i++) {
          const f = v[i] || [];
          const k = norm(f[iN]);
          if (!k || fiscales[k]) continue;
          fiscales[k] = {
            razonSocial: iRS !== -1 ? txt(f[iRS]) : '', rfc: iRF !== -1 ? txt(f[iRF]) : '',
            regimen: iRG !== -1 ? txt(f[iRG]) : '', uso: iUS !== -1 ? txt(f[iUS]) : ''
          };
        }
      }
    } catch (e) { /* sin ficha fiscal, el control sale igual */ }
    try {
      const cfgV = core.areaCfg ? await core.areaCfg('ventas_registro') : core.SHEETS.ventas_registro;
      if (cfgV && cfgV.id) {
        const v = await core.readRange(cfgV.id, await core.resolveSheetName(cfgV));
        const hr3 = core._hrIdx ? core._hrIdx(cfgV, v) : 0;
        const Hv = (v[hr3] || []).map(h => txt(h));
        const iR = Hv.findIndex(h => /^(no\. de referencia|folio)$/i.test(h));
        const iT = Hv.findIndex(h => /^total con env[ií]o$/i.test(h)) !== -1
          ? Hv.findIndex(h => /^total con env[ií]o$/i.test(h))
          : Hv.findIndex(h => /^total pedido$/i.test(h));
        if (iR !== -1 && iT !== -1) for (let i = hr3 + 1; i < v.length; i++) {
          const f = v[i] || [];
          const k = normFolio(f[iR]);
          if (!k) continue;
          totalDeVenta[k] = (totalDeVenta[k] || 0) + num(f[iT]);
        }
      }
    } catch (e) { /* sin total, no se sugiere método */ }

    // Lo cobrado por folio, para saber si la venta ya quedó saldada.
    //
    // No basta con los cobros que capturó Comercial: eso empezó con el ERP, en
    // octubre. Los anticipos de todo lo anterior solo existen en INGRESOS, que
    // es el banco, y ahí el folio viene en la descripción (" AG3-26").
    //
    // Sin esto, una venta vieja que ya se pagó completa pero a la que hoy se le
    // registra el finiquito parece deber el anticipo, y su factura sale PPD
    // cuando debería ser PUE.
    //
    // No se duplica: el cotejo ya emparejó cada cobro capturado con su ingreso,
    // y "sinReportar" son solo los ingresos que NO casaron con ninguno.
    const cobradoPorFolio = {};
    cobros.forEach(c => {
      const k = normFolio(c.folio);
      cobradoPorFolio[k] = (cobradoPorFolio[k] || 0) + (c.monto || 0);
    });
    const deBanco = {};
    (cot.sinReportar || []).forEach(b => {
      const k = normFolio(b.folio);
      if (!k) return;
      cobradoPorFolio[k] = (cobradoPorFolio[k] || 0) + (b.monto || 0);
      deBanco[k] = (deBanco[k] || 0) + (b.monto || 0);
    });

    // Los cobros que nadie dijo si requieren factura. No se pueden colar entre
    // los que sí —sería inventar—, pero tampoco pueden desaparecer: así se
    // perdieron la O15-26 y la O17-26, cobradas y sin que nadie se enterara de
    // que faltaba facturarlas.
    const sinDefinir = [];
    cobros.forEach(c => {
      // Los cancelados ya quedaron fuera antes: se les deja el monto en 0.
      if (txt(c.requiereFactura)) return;
      sinDefinir.push({ fila: c.fila, folio: c.folio, cliente: c.cliente,
                        monto: c.monto, fecha: c.fecha });
    });

    const conFactura = [], pendientes = [];
    cobros.forEach(c => {
      if (!/^s[ií]/i.test(c.requiereFactura || '')) return;   // no la pidió
      // Se busca su factura: primero por folio si el archivo lo trae, si no por
      // cliente y monto, y si tampoco, por monto y fecha cercana. Cada una dice
      // cómo cuadró, para poder desconfiar de las más flojas.
      const f = normFolio(c.folio);
      const cli = norm(c.cliente);
      const dPagoBusca = fechaNum(c.fecha);
      const cerca = (a, b) => {
        if (!a || !b) return false;
        const g = (x) => new Date(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100);
        return Math.abs(Math.round((g(b) - g(a)) / 86400000)) <= 45;
      };
      let fac = f ? facturas.filter(x => !x.usada && x.folio && x.folio === f)[0] : null;
      let comoFac = 'folio';
      if (!fac && cli) {
        fac = facturas.filter(x => !x.usada && x.receptor &&
              (x.receptor.indexOf(cli) !== -1 || cli.indexOf(x.receptor) !== -1) &&
              Math.abs(x.total - c.monto) <= 2)[0];
        comoFac = 'cliente y monto';
      }
      if (!fac) {
        fac = facturas.filter(x => !x.usada && Math.abs(x.total - c.monto) <= 2 &&
              cerca(x.dia, dPagoBusca))[0];
        comoFac = 'monto y fecha';
      }
      if (fac) fac.usada = true;
      const cfdis = fac ? [fac] : [];
      const marcado = /^(s[ií]|listo|hecho)/i.test(c.facturado || '');
      const dPago = fechaNum(c.fecha);
      const mesPago = dPago ? Math.floor(dPago / 10000) * 100 + (Math.floor(dPago / 100) % 100) : 0;
      const fila = Object.assign({}, c, {
        cfdis: cfdis.length, uuid: fac ? fac.uuid : '',
        fechaFactura: fac ? fac.fecha : '', cuadroPor: fac ? comoFac : '',
        mesPago, deMesAnterior: !!(mesPago && mesPago < mesHoy),
        // Marcado a mano pero sin CFDI: alguien dijo que ya, y el SAT no lo tiene
        marcadoSinCfdi: marcado && !cfdis.length
      });

      // Lo que hay que tener a la mano para pedir la factura
      const fx = fiscales[norm(c.cliente)] || {};
      // Si la ficha no trae uso de CFDI, se enseña el de su última factura
      // timbrada. Se dice de dónde salió para que quien revisa lo confirme, no
      // para que lo dé por hecho.
      const up = usoPrevio[norm(c.cliente)] ||
                 (fx.razonSocial ? usoPrevio[norm(fx.razonSocial)] : null) || null;
      fila.fiscal = { razonSocial: fx.razonSocial || '', rfc: fx.rfc || '',
                      regimen: fx.regimen || '', uso: fx.uso || '',
                      usoPrevio: (!fx.uso && up) ? up.uso : '',
                      usoPrevioDe: (!fx.uso && up) ? (up.factura || up.fecha || '') : '' };
      fila.faltanDatos = [
        !fx.rfc ? 'RFC' : '', !fx.razonSocial ? 'razón social' : '',
        !fx.regimen ? 'régimen fiscal' : '',
        // Si ya se sabe con qué uso se le facturó antes, no es un dato que falte
        // para poder emitir: es uno que hay que confirmar.
        (hayColumnaUso && !fx.uso && !(up && up.uso)) ? 'uso de CFDI' : ''
      ].filter(Boolean);

      // PUE o PPD: no es una preferencia, sale de si la venta ya quedó pagada.
      // Si todavía falta dinero por cobrar, el pago es en parcialidades y la
      // factura va PPD, con su complemento por cada pago.
      const totalV = totalDeVenta[normFolio(c.folio)] || 0;
      const cobrado = cobradoPorFolio[normFolio(c.folio)] || 0;
      if (!totalV) {
        fila.metodo = ''; fila.metodoPorque = 'no encontré el total de esa venta';
      } else if (cobrado + 1 >= totalV) {
        fila.metodo = 'PUE';
        fila.metodoPorque = 'la venta ya quedó pagada completa';
      } else {
        fila.metodo = 'PPD';
        fila.metodoPorque = 'faltan ' +
          (totalV - cobrado).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) +
          ' por cobrar: lleva complemento por cada pago';
      }
      // De dónde salió lo pagado. Si parte viene del banco y no de un cobro
      // capturado, hay que poder verlo: es la diferencia entre confiar en el
      // número y entender de dónde sale.
      const delBanco = deBanco[normFolio(c.folio)] || 0;
      if (delBanco) {
        fila.cobradoDelBanco = delBanco;
        fila.metodoPorque += ' · ' +
          delBanco.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) +
          ' de eso sale de INGRESOS, no de un cobro capturado';
      }
      if (cfdis.length || marcado) conFactura.push(fila);
      else pendientes.push(fila);
    });

    const suma = (a) => Math.round(a.reduce((s, x) => s + (x.monto || 0), 0) * 100) / 100;
    const urgentes = pendientes.filter(x => x.deMesAnterior);
    const delMes = pendientes.filter(x => !x.deMesAnterior);

    return res.status(200).json({
      ok: true,
      urgentes, delMes, conFactura, sinDefinir,
      totales: {
        urgentes: suma(urgentes), nUrgentes: urgentes.length,
        delMes: suma(delMes), nDelMes: delMes.length,
        facturado: suma(conFactura), nFacturado: conFactura.length,
        marcadoSinCfdi: conFactura.filter(x => x.marcadoSinCfdi).length,
        sinConfirmarEnBanco: pendientes.filter(x => !x.enBanco).length,
        sinDefinir: sinDefinir.length,
        diasQueQuedan
      },
      lectura: {
        cobrosConfirmados: (cot.confirmados || []).length,
        cobrosSinBanco: (cot.sinBanco || []).length,
        hayColumnaUso,
        cobrosLeidos: cobros.length,
        facturasLeidas: leidas, columnaFolioEnCfdi: columnaFolio,
        mes: MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear()
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
