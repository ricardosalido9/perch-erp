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
const letra = (i) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
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
    // Corregir un cobro ya registrado: moverlo de folio o cancelarlo.
    //
    // Hasta ahora un cobro capturado era definitivo: si caía en el folio
    // equivocado no había por dónde arreglarlo desde el ERP, y eso obliga a
    // meterse a la hoja a mano, que es peor. No se borra el renglón —correrlo
    // mueve todo lo de abajo— se corrige y queda escrito quién y cuándo.
    if (body.accion === 'mover' || body.accion === 'cancelar') {
      const fila = Math.round(num(body.fila));
      if (!(fila > 1)) return res.status(400).json({ error: 'Falta cuál cobro.' });
      const b2 = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
      if (!b2 || !b2.id) return res.status(400).json({ error: 'No hay dónde guardar el cobro.' });
      let vv = [];
      try { vv = await core.readRange(b2.id, PESTANA); } catch (e) { vv = []; }
      if (!vv.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de cobros.' });
      const H2 = (vv[0] || []).map(h => txt(h));
      const idx = (re) => H2.findIndex(h => re.test(h));
      const actual = vv[fila - 1] || [];
      const iFol = idx(/^folio/i), iMon = idx(/monto|importe/i), iNot = idx(/notas|comentario/i);
      const iCli = idx(/cliente/i);
      if (iFol === -1) return res.status(400).json({ error: 'La pestaña no tiene columna Folio.' });

      const quien = sesion.u || '';
      const antesFolio = txt(actual[iFol]);
      const antesMonto = num(actual[iMon]);
      const celdas = [];
      let mensaje = '';

      if (body.accion === 'mover') {
        const nuevo = txt(body.folioNuevo);
        if (!nuevo) return res.status(400).json({ error: 'Falta el folio correcto.' });
        celdas.push({ range: "'" + PESTANA + "'!" + letra(iFol) + fila, values: [[nuevo]] });
        if (iCli !== -1 && txt(body.clienteNuevo)) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iCli) + fila,
                        values: [[txt(body.clienteNuevo)]] });
        }
        if (iNot !== -1) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iNot) + fila,
            values: [[(txt(actual[iNot]) ? txt(actual[iNot]) + ' · ' : '') +
                      'Movido de ' + (antesFolio || '(sin folio)') + ' a ' + nuevo +
                      ' por ' + (quien || 'el ERP') + ' el ' + hoyLargo()]] });
        }
        mensaje = 'El cobro pasó de ' + (antesFolio || '(sin folio)') + ' a ' + nuevo + '.';
      } else {
        if (iMon !== -1) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iMon) + fila, values: [[0]] });
        }
        if (iNot !== -1) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iNot) + fila,
            values: [[(txt(actual[iNot]) ? txt(actual[iNot]) + ' · ' : '') +
                      'CANCELADO por ' + (quien || 'el ERP') + ' el ' + hoyLargo() +
                      ' (era $' + antesMonto.toLocaleString('en-US', { minimumFractionDigits: 2 }) +
                      ')' + (txt(body.motivo) ? ' · ' + txt(body.motivo) : '')]] });
        }
        mensaje = 'El cobro de ' + (antesFolio || 'ese folio') + ' quedó cancelado. ' +
                  'El renglón se queda con el registro de qué pasó.';
      }
      await core.writeCells(b2.id, celdas);
      return res.status(200).json({ ok: true, accion: body.accion, fila, mensaje });
    }

    const folio = txt(body.folio);
    const monto = num(body.monto);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    // Qué cobros tiene ya ese folio. Se consulta antes de registrar otro: quien
    // captura necesita ver si el que está por meter ya está, sobre todo cuando
    // viene de un intento que falló a la mitad.
    if (body.listar) {
      const base0 = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
      if (!base0 || !base0.id) return res.status(200).json({ ok: true, cobros: [] });
      let vals = [];
      try { vals = await core.readRange(base0.id, PESTANA); } catch (e) { vals = []; }
      if (!vals.length) return res.status(200).json({ ok: true, cobros: [] });
      const Hh = (vals[0] || []).map(h => txt(h));
      const dame = (o, re) => { const c = Hh.filter(h => re.test(h))[0]; return c ? txt(o[c]) : ''; };
      const cobros = [];
      for (let i = 1; i < vals.length; i++) {
        const o = {}; Hh.forEach((h, j) => { o[h] = vals[i][j]; });
        if (txt(dame(o, /^folio/i)).toLowerCase() !== folio.toLowerCase()) continue;
        cobros.push({
          fila: i + 1,
          fecha: dame(o, /fecha del pago/i), monto: num(dame(o, /monto|importe/i)),
          metodo: dame(o, /m[ée]todo|forma/i), referencia: dame(o, /referencia/i),
          requiereFactura: dame(o, /requiere factura/i),
          facturado: dame(o, /^facturado/i),
          banco: dame(o, /confirmado en banco/i),
          quien: dame(o, /registr[óo]$|qui[ée]n/i),
          notas: dame(o, /notas|comentario/i),
          cancelado: /CANCELADO/.test(dame(o, /notas|comentario/i))
        });
      }
      return res.status(200).json({ ok: true, cobros,
        total: Math.round(cobros.reduce((a2, x) => a2 + x.monto, 0) * 100) / 100 });
    }
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

    // La hoja recibe un renglón, no un objeto: hay que acomodar cada valor bajo
    // su encabezado. Mandarlo como objeto hacía que Google contestara "Unknown
    // name 'Fecha del pago'", que no le dice nada a quien está capturando.
    const faltan = ['Fecha del pago', 'Folio', 'Monto']
      .filter(n => !Object.keys(rec).some(k => k === n && H.indexOf(k) !== -1));
    if (faltan.length) {
      return res.status(400).json({
        error: 'A la pestaña "' + PESTANA + '" le faltan columnas.',
        pista: 'Agrega en el primer renglón: ' + faltan.join(' · ') +
               '. Las que debe tener son: ' + COLS.join(' · ')
      });
    }
    const fila = H.map(h => (rec[h] == null ? '' : rec[h]));
    await core.appendRows(base.id, PESTANA, [fila], H);

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
