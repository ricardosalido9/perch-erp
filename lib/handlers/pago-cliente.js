// Registra un cobro reportado por quien vende: el cliente dijo que pagó y mandó
// su comprobante, pero el banco todavía no lo confirma.
//
// Sirve para operar —liberar un pedido, programar la entrega— sin esperar a que
// se suba el estado de cuenta. NO es un ingreso: los estados financieros siguen
// contando solo lo que pasó por el banco. La pantalla de Cuentas por Cobrar los
// muestra por separado hasta que cuadran.
//
//   ?action=pago-cliente  { folio, cliente, monto, fecha, metodo, referencia, comprobante }
const core = require('../core');

const PESTANA = process.env.TAB_PAGOS_CLIENTES || 'Pagos de clientes';
const COLS = ['Fecha del pago', 'Folio', 'Cliente', 'Monto', 'Método', 'Referencia',
              'Comprobante', 'Requiere factura', 'Facturado', 'Registró', 'Registrado el',
              'Confirmado en banco', 'Notas'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

const txt = (v) => String(v == null ? '' : v).trim();
function num(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function hoyLargo() {
  const d = new Date();
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    if (core.verifyWriter && !core.verifyWriter(body.token)) {
      return res.status(403).json({ error: 'Tu usuario no puede registrar cobros.' });
    }
    const folio = txt(body.folio);
    const monto = num(body.monto);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
    if (monto <= 0) {
      return res.status(400).json({
        error: 'Falta cuánto pagó el cliente.',
        pista: 'Un comprobante sin monto no sirve para cuadrar contra el banco.'
      });
    }

    // Vive junto a Cuentas por Cobrar, que es donde se va a cotejar
    const base = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
    if (!base || !base.id) {
      return res.status(400).json({ error: 'No hay dónde guardar el cobro.',
        pista: 'Falta conectar el archivo de Cuentas por Cobrar.' });
    }

    let values = [];
    try { values = await core.readRange(base.id, PESTANA); } catch (e) { values = []; }
    if (!values.length || !(values[0] || []).some(h => txt(h))) {
      return res.status(400).json({
        error: 'No existe la pestaña donde se guardan los cobros.',
        pista: 'Crea una pestaña llamada "' + PESTANA + '" en el archivo de Cuentas por ' +
               'Cobrar, con estas columnas en el primer renglón: ' + COLS.join(' · ')
      });
    }
    const H = (values[0] || []).map(h => txt(h));

    const rec = {};
    rec[H.filter(h => /fecha del pago/i.test(h))[0] || 'Fecha del pago'] =
      txt(body.fecha) || hoyLargo();
    rec[H.filter(h => /^folio/i.test(h))[0] || 'Folio'] = folio;
    rec[H.filter(h => /cliente/i.test(h))[0] || 'Cliente'] = txt(body.cliente);
    rec[H.filter(h => /monto|importe/i.test(h))[0] || 'Monto'] = monto;
    rec[H.filter(h => /m[ée]todo|forma/i.test(h))[0] || 'Método'] = txt(body.metodo);
    rec[H.filter(h => /referencia/i.test(h))[0] || 'Referencia'] = txt(body.referencia);
    rec[H.filter(h => /comprobante|archivo/i.test(h))[0] || 'Comprobante'] = txt(body.comprobante);
    // Si el cliente pide factura se pregunta aquí, que es cuando se sabe: la
    // factura se amarra al pago, no a la venta.
    rec[H.filter(h => /requiere factura/i.test(h))[0] || 'Requiere factura'] =
      txt(body.requiereFactura);
    rec[H.filter(h => /^facturado/i.test(h))[0] || 'Facturado'] = '';
    rec[H.filter(h => /registr[óo]$|qui[ée]n/i.test(h))[0] || 'Registró'] = sesion.u || '';
    rec[H.filter(h => /registrado el/i.test(h))[0] || 'Registrado el'] = hoyLargo();
    rec[H.filter(h => /notas|comentario/i.test(h))[0] || 'Notas'] = txt(body.notas);

    await core.appendRows(base.id, PESTANA, [rec], H);

    return res.status(200).json({
      ok: true, folio, monto,
      mensaje: 'Cobro de ' + folio + ' por $' +
        monto.toLocaleString('en-US', { minimumFractionDigits: 2 }) + ' registrado.',
      // Se dice en voz alta para que nadie lo confunda con un ingreso
      requiereFactura: txt(body.requiereFactura),
      nota: 'Queda como cobro reportado. Cuenta como ingreso cuando aparezca en el banco.' +
        (/^s[ií]/i.test(txt(body.requiereFactura))
          ? ' Y queda pendiente de facturar: sale en Cobros contra banco.' : '')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
