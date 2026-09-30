// Cotejo de cobros: lo que reportó quien vende contra lo que entró al banco.
//
// Son dos registros distintos a propósito. El reportado sirve para operar el
// mismo día —liberar un pedido, programar la entrega— y el del banco es el que
// cuenta como ingreso. Esta pantalla los cruza y deja ver los tres casos que
// importan: los que cuadran, los reportados que nunca llegaron al banco, y el
// dinero que entró sin que nadie lo registrara.
//
// El segundo caso es el que atrapa comprobantes falsos y pagos que se fueron a
// otra cuenta. El tercero, ventas cobradas que nadie ligó a su folio.
//
//   ?action=cxc-cotejo  { dias, tolerancia }
const core = require('../core');

const PESTANA = process.env.TAB_PAGOS_CLIENTES || 'Pagos de clientes';
const MESES = { ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4, may:5, mayo:5,
                jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8, sep:9, sept:9, septiembre:9,
                oct:10, octubre:10, nov:11, noviembre:11, dic:12, diciembre:12 };

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
const normFolio = (v) => norm(String(v == null ? '' : v).trim().replace(/\.0+$/, ''));
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fechaNum(v) {
  const t = norm(v);
  if (!t) return 0;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = t.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return +m[3] * 10000 + MESES[m[2]] * 100 + +m[1];
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  return 0;
}
// Días entre dos fechas AAAAMMDD
function diasEntre(a, b) {
  if (!a || !b) return 999;
  const f = (x) => new Date(Math.floor(x / 10000), Math.floor(x / 100) % 100 - 1, x % 100);
  return Math.abs(Math.round((f(b) - f(a)) / 86400000));
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leerHoja(id, pestana) {
  let values;
  try { values = await core.readRange(id, pestana); } catch (e) { return { headers: [], rows: [] }; }
  if (!values || !values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => txt(h));
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    H.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers: H, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    // Cuánto puede diferir el monto y la fecha para dar dos registros por iguales
    const tol = body.tolerancia == null ? 1 : num(body.tolerancia);
    const dias = body.dias == null ? 7 : num(body.dias);

    const cfgC = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
    const cfgI = core.areaCfg ? await core.areaCfg('ingresos') : core.SHEETS.ingresos;
    if (!cfgC || !cfgC.id) return res.status(400).json({ error: 'Falta conectar Cuentas por Cobrar.' });

    const [rep, ing] = await Promise.all([
      leerHoja(cfgC.id, PESTANA),
      cfgI && cfgI.id ? leerHoja(cfgI.id, cfgI.sheetName || 'INGRESOS')
                      : Promise.resolve({ headers: [], rows: [] })
    ]);
    if (!rep.headers.length) {
      return res.status(400).json({
        error: 'No se encontró la pestaña "' + PESTANA + '".',
        pista: 'Vive en el archivo de Cuentas por Cobrar y la llena el ERP al subir un ' +
               'comprobante de pago.'
      });
    }

    const rF = col(rep.headers, 'Folio'), rM = col(rep.headers, 'Monto', 'Importe');
    const rD = col(rep.headers, 'Fecha del pago', 'Fecha');
    const rC = col(rep.headers, 'Cliente'), rQ = col(rep.headers, 'Registró', 'Quién');
    const rRef = col(rep.headers, 'Referencia'), rConf = col(rep.headers, 'Confirmado en banco');

    const iF = col(ing.headers, 'No. de Referencia', 'Folio', 'Pedido');
    const iM = col(ing.headers, 'Total', 'Monto', 'Importe');
    const iD = col(ing.headers, 'Fecha');
    const iC = col(ing.headers, 'Concepto'), iDes = col(ing.headers, 'Descripción', 'Descripcion');

    // Los ingresos del banco, para irlos tachando conforme se emparejan
    const banco = (ing.rows || []).map(r => ({
      fila: r._fila, folio: iF ? txt(r[iF]) : '', monto: num(iM ? r[iM] : 0),
      dia: iD ? fechaNum(r[iD]) : 0, concepto: iC ? txt(r[iC]) : '',
      descripcion: iDes ? txt(r[iDes]) : '', usado: false
    })).filter(x => x.monto > 0);

    const confirmados = [], sinBanco = [];
    (rep.rows || []).forEach(r => {
      const folio = rF ? txt(r[rF]) : '';
      const monto = num(rM ? r[rM] : 0);
      const dia = rD ? fechaNum(r[rD]) : 0;
      if (!folio || monto <= 0) return;
      const base = {
        fila: r._fila, folio, cliente: rC ? txt(r[rC]) : '', monto,
        fecha: rD ? txt(r[rD]) : '', registro: rQ ? txt(r[rQ]) : '',
        referencia: rRef ? txt(r[rRef]) : ''
      };
      // Primero por folio y monto; si no, por monto y fecha cercana, que es como
      // llegan los pagos que el banco no trae identificados.
      let m = banco.filter(b => !b.usado && normFolio(b.folio) === normFolio(folio) &&
                                Math.abs(b.monto - monto) <= tol)[0];
      let como = 'folio y monto';
      if (!m) {
        m = banco.filter(b => !b.usado && Math.abs(b.monto - monto) <= tol &&
                              diasEntre(b.dia, dia) <= dias)[0];
        como = 'monto y fecha';
      }
      if (m) {
        m.usado = true;
        confirmados.push(Object.assign({}, base, {
          cuadroPor: como, filaBanco: m.fila, montoBanco: m.monto,
          conceptoBanco: m.concepto || m.descripcion,
          // Si cuadró por monto y fecha, al ingreso le falta su folio
          faltaFolioEnBanco: como === 'monto y fecha'
        }));
      } else {
        const antiguedad = dia ? diasEntre(dia, (function () {
          const d = new Date();
          return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        })()) : null;
        sinBanco.push(Object.assign({}, base, { diasEsperando: antiguedad }));
      }
    });

    // Dinero que entró y nadie reportó, solo el que trae folio de venta
    const sinReportar = banco.filter(b => !b.usado && b.folio).map(b => ({
      fila: b.fila, folio: b.folio, monto: b.monto,
      fecha: b.dia ? String(b.dia) : '', concepto: b.concepto || b.descripcion
    }));

    const suma = (a) => Math.round(a.reduce((s, x) => s + x.monto, 0) * 100) / 100;
    return res.status(200).json({
      ok: true,
      tolerancia: tol, dias,
      confirmados, sinBanco, sinReportar,
      totales: {
        confirmados: suma(confirmados), sinBanco: suma(sinBanco), sinReportar: suma(sinReportar),
        nConfirmados: confirmados.length, nSinBanco: sinBanco.length, nSinReportar: sinReportar.length,
        // Los que cuadraron solo por monto y fecha: al banco le falta el folio
        faltaFolio: confirmados.filter(x => x.faltaFolioEnBanco).length
      },
      lectura: {
        pestana: PESTANA, reportados: (rep.rows || []).length,
        ingresosLeidos: banco.length,
        columnaFolioBanco: iF || '(NO SE ENCONTRÓ)',
        columnaConfirmado: rConf || '(no existe, no se puede marcar)'
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
