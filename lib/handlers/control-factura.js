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
            dia: fechaNum(cFec ? o[cFec] : ''), total, usada: false
          });
        }
      }
    }

    const hoy = new Date();
    const mesHoy = hoy.getFullYear() * 100 + (hoy.getMonth() + 1);
    const diaHoy = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();
    const finDeMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const diasQueQuedan = finDeMes - hoy.getDate();

    const conFactura = [], pendientes = [];
    (cot.confirmados || []).forEach(c => {
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
      if (cfdis.length || marcado) conFactura.push(fila);
      else pendientes.push(fila);
    });

    const suma = (a) => Math.round(a.reduce((s, x) => s + (x.monto || 0), 0) * 100) / 100;
    const urgentes = pendientes.filter(x => x.deMesAnterior);
    const delMes = pendientes.filter(x => !x.deMesAnterior);

    return res.status(200).json({
      ok: true,
      urgentes, delMes, conFactura,
      totales: {
        urgentes: suma(urgentes), nUrgentes: urgentes.length,
        delMes: suma(delMes), nDelMes: delMes.length,
        facturado: suma(conFactura), nFacturado: conFactura.length,
        marcadoSinCfdi: conFactura.filter(x => x.marcadoSinCfdi).length,
        diasQueQuedan
      },
      lectura: {
        cobrosConfirmados: (cot.confirmados || []).length,
        facturasLeidas: leidas, columnaFolioEnCfdi: columnaFolio,
        mes: MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear()
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
