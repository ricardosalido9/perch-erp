// Quién falta de facturar y a quién falta emitirle el complemento de pago.
// Se lee de CxC (donde ya se captura la factura y si es PUE o PPD) cruzado contra
// INGRESOS, que es donde está la verdad de cuándo entró el dinero.
//
// La regla fiscal: el complemento SOLO aplica a facturas PPD (pago en parcialidades),
// y se emite a más tardar el día 5 del mes siguiente al pago.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normFolio(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }
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
function esSi(v) {
  const t = norm(v);
  return t === 'si' || t === 'sí' || t === 'true' || t === 'x' || t === '1' || t === 'verdadero';
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [] }; }
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

// El complemento vence el día 5 del mes siguiente al pago
function venceComplemento(diaPago) {
  if (!diaPago) return null;
  let a = Math.floor(diaPago / 10000), m = Math.floor(diaPago / 100) % 100;
  m += 1;
  if (m > 12) { m = 1; a += 1; }
  return a * 10000 + m * 100 + 5;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [cxc, ing, ven] = await Promise.all([
      leer('fin_cxc'), leer('fin_ingresos'), leer('ventas_registro')
    ]);
    if (!cxc.headers.length) return res.status(400).json({ error: 'No se pudo leer CxC.' });

    const H = cxc.headers;
    const cRef = col(H, 'No. de Referencia', 'Folio');
    const cCli = col(H, 'Cliente');
    const cTot = col(H, 'Total con envío', 'Total con envio', 'Total');
    const cPide = col(H, 'Factura Si / No', 'Requiere factura', 'Factura');
    const cUUID = col(H, 'UUID', 'UUID de la factura', 'Folio Fiscal');
    const cNumF = col(H, 'Número de Factura', 'Numero de Factura', 'Factura emitida');
    const cMet = col(H, 'Método de pago SAT', 'Metodo de pago SAT', 'PPD o PUE', 'Método de pago', 'PUE/PPD');
    const cComp = col(H, 'Complemento emitido', 'Complemento', 'Complemento de pago');
    const cFComp = col(H, 'Fecha del complemento', 'Fecha complemento');
    const cFecha = col(H, 'Fecha del Cierre', 'Fecha');
    if (!cRef) return res.status(400).json({ error: 'CxC no tiene la columna de folio.' });

    // Pagos por folio, de INGRESOS
    const pagos = {};
    if (ing.headers.length) {
      const iRef = col(ing.headers, 'No. de Referencia', 'Folio', 'Pedido');
      const iTot = col(ing.headers, 'Total', 'Monto', 'Importe');
      const iFec = col(ing.headers, 'Fecha');
      const iCon = col(ing.headers, 'Concepto');
      const iDes = col(ing.headers, 'Descripción', 'Descripcion');
      if (iTot) {
        const folios = [];
        cxc.rows.forEach(r => {
          const f = txt(r[cRef]);
          if (f && folios.indexOf(f) === -1) folios.push(f);
        });
        folios.sort((a, b) => b.length - a.length);
        const porNorm = {};
        folios.forEach(f => { porNorm[normFolio(f)] = f; });
        ing.rows.forEach(r => {
          const m = num(r[iTot]);
          if (!m) return;
          const crudo = txt(iRef ? r[iRef] : '');
          let folio = porNorm[normFolio(crudo)] || '';
          if (!folio) {
            const t = ' ' + norm(txt(iCon ? r[iCon] : '') + ' ' + txt(iDes ? r[iDes] : '') + ' ' + crudo) + ' ';
            folio = folios.filter(f => t.indexOf(norm(f)) !== -1)[0] || '';
          }
          if (!folio) return;
          const k = normFolio(folio);
          if (!pagos[k]) pagos[k] = { monto: 0, n: 0, ultimo: null, detalle: [] };
          pagos[k].monto += m;
          pagos[k].n++;
          const d = iFec ? fechaNum(r[iFec]) : null;
          if (d && (!pagos[k].ultimo || d > pagos[k].ultimo)) pagos[k].ultimo = d;
          if (pagos[k].detalle.length < 20) {
            pagos[k].detalle.push({ fecha: txt(iFec ? r[iFec] : ''), dia: d, monto: m,
                                    concepto: txt(iCon ? r[iCon] : '') });
          }
        });
      }
    }

    const hoy = (() => { const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
    const diasEntre = (a, b) => {
      if (!a || !b) return null;
      const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
      return Math.round((f(b) - f(a)) / 86400000);
    };

    const faltaFacturar = [], faltaComplemento = [], alDia = [], sinDefinir = [];

    cxc.rows.forEach(r => {
      const folio = txt(r[cRef]);
      if (!folio) return;
      const pide = cPide ? esSi(r[cPide]) : false;
      const uuid = txt(cUUID ? r[cUUID] : '') || txt(cNumF ? r[cNumF] : '');
      const metodo = norm(cMet ? r[cMet] : '');
      const compl = cComp ? esSi(r[cComp]) : false;
      const pg = pagos[normFolio(folio)] || { monto: 0, n: 0, ultimo: null, detalle: [] };
      const base = {
        fila: r._fila, folio: folio, cliente: txt(cCli ? r[cCli] : ''),
        total: cTot ? num(r[cTot]) : 0, fecha: txt(cFecha ? r[cFecha] : ''),
        cobrado: Math.round(pg.monto * 100) / 100, pagos: pg.n,
        ultimoPago: pg.ultimo, detallePagos: pg.detalle,
        uuid: uuid, metodo: cMet ? txt(r[cMet]) : '',
        complemento: compl, fechaComplemento: txt(cFComp ? r[cFComp] : '')
      };

      // 1) Pidió factura y no hay UUID capturado
      if (pide && !uuid) {
        faltaFacturar.push(Object.assign({}, base, {
          motivo: pg.n ? 'Ya pagó y sigue sin factura' : 'Pidió factura'
        }));
        return;
      }
      if (!uuid) return;                       // no pidió factura: no aplica nada

      // 2) Es PPD, ya hay pagos y el complemento sigue pendiente
      const esPPD = /ppd/.test(metodo);
      const esPUE = /pue/.test(metodo);
      if (!esPPD && !esPUE) {
        sinDefinir.push(Object.assign({}, base, {
          motivo: 'Falta anotar si la factura es PUE o PPD'
        }));
        return;
      }
      if (esPPD && pg.n && !compl) {
        const vence = venceComplemento(pg.ultimo);
        const dias = diasEntre(vence, hoy);
        faltaComplemento.push(Object.assign({}, base, {
          vence: vence,
          diasDeRetraso: (dias !== null && dias > 0) ? dias : 0,
          urgente: dias !== null && dias > 0,
          motivo: (dias !== null && dias > 0)
            ? 'Vencido desde hace ' + dias + (dias === 1 ? ' día' : ' días')
            : 'Por emitir'
        }));
        return;
      }
      alDia.push(base);
    });

    const ord = (a, b) => (b.ultimoPago || 0) - (a.ultimoPago || 0);
    faltaFacturar.sort(ord);
    faltaComplemento.sort((a, b) => (b.diasDeRetraso || 0) - (a.diasDeRetraso || 0) || ord(a, b));

    const suma = (a) => Math.round(a.reduce((t, x) => t + (x.total || 0), 0) * 100) / 100;
    return res.status(200).json({
      ok: true,
      faltaFacturar, faltaComplemento, sinDefinir, alDia,
      columnasQueFaltan: [
        !cMet ? 'Método de pago SAT (PUE o PPD)' : null,
        !cComp ? 'Complemento emitido' : null,
        !cUUID && !cNumF ? 'UUID de la factura' : null
      ].filter(Boolean),
      totales: {
        faltaFacturar: faltaFacturar.length, montoFacturar: suma(faltaFacturar),
        faltaComplemento: faltaComplemento.length, montoComplemento: suma(faltaComplemento),
        vencidos: faltaComplemento.filter(x => x.urgente).length,
        sinDefinir: sinDefinir.length,
        alDia: alDia.length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
