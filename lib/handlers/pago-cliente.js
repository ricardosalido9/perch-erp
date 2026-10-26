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

// Dónde vive ese folio y a nombre de quién. Se busca en ventas y, si no, en
// cotizaciones: no es lo mismo cobrarle a una venta que a una cotización.
async function dondeViveElFolio(folio) {
  for (const area of ['ventas_registro', 'cotizaciones']) {
    try {
      const cfg = core.areaCfg ? await core.areaCfg(area) : core.SHEETS[area];
      if (!cfg || !cfg.id) continue;
      const vals = await core.readRange(cfg.id, await core.resolveSheetName(cfg));
      if (!vals.length) continue;
      const hr = core._hrIdx ? core._hrIdx(cfg, vals) : 0;
      const H = (vals[hr] || []).map(h => txt(h));
      const norm = (x) => txt(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const iRef = H.findIndex(h => /^(no\. de referencia|folio)$/i.test(txt(h)));
      const iCli = H.findIndex(h => /^cliente$/i.test(txt(h)));
      if (iRef === -1 || iCli === -1) continue;
      for (let i = hr + 1; i < vals.length; i++) {
        const f = vals[i] || [];
        if (norm(f[iRef]) !== norm(folio)) continue;
        return { area, cliente: txt(f[iCli]) };
      }
    } catch (e) { /* si no se puede leer, se sigue con la otra */ }
  }
  return null;
}
async function clienteDelFolio(folio) {
  const d = await dondeViveElFolio(folio);
  return d ? d.cliente : '';
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
    // El seguimiento de facturación: la revisión de Comercial y la marca de
    // quien factura, sobre el mismo renglón del cobro.
    //
    // Antes esto vivía en el color rojo de una celda del Excel: servía para quien
    // lo pintaba y para nadie más. Puesto aquí, Camila marca que revisó las
    // condiciones, Dani marca que la emitió, y cada quien ve lo del otro con
    // nombre y fecha en vez de preguntar por WhatsApp.
    if (body.accion === 'revisar' || body.accion === 'facturada' || body.accion === 'nota') {
      const fila = Math.round(num(body.fila));
      if (!(fila > 1)) return res.status(400).json({ error: 'Falta cuál cobro.' });
      const b3 = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
      if (!b3 || !b3.id) return res.status(400).json({ error: 'No hay dónde guardar.' });
      let vv = [];
      try { vv = await core.readRange(b3.id, PESTANA); } catch (e) { vv = []; }
      if (!vv.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de cobros.' });
      let H3 = (vv[0] || []).map(h => txt(h));

      // Las dos columnas del seguimiento se crean al final si no existen
      const faltantes = [];
      const busca = (re, nombre) => {
        const i = H3.findIndex(h => re.test(h));
        if (i !== -1) return i;
        faltantes.push(nombre);
        return H3.length + faltantes.length - 1;
      };
      const iRev  = busca(/revisad/i, 'Revisado');
      const iNota = busca(/nota de facturaci/i, 'Nota de facturación');
      const iFact = H3.findIndex(h => /^facturado/i.test(h));
      if (faltantes.length) {
        await core.writeCells(b3.id, [{
          range: "'" + PESTANA + "'!" + letra(H3.length) + '1:' +
                 letra(H3.length + faltantes.length - 1) + '1',
          values: [faltantes]
        }]);
        H3 = H3.concat(faltantes);
      }

      const quien = sesion.u || '';
      const sello = hoyLargo();
      const celdas = [];
      // Dejar una nota no cambia quién revisó ni quién facturó: son tres marcas
      // distintas sobre el mismo renglón y pisarse entre ellas borraría trabajo.
      if (body.accion === 'nota') {
        /* solo la nota, abajo */
      } else if (body.accion === 'revisar') {
        const ok = !/^(no|0|false)$/i.test(txt(body.revisado)) && txt(body.revisado) !== '';
        celdas.push({ range: "'" + PESTANA + "'!" + letra(iRev) + fila,
                      values: [[ok ? ('Sí · ' + quien + ' · ' + sello) : '']] });
      } else {
        if (iFact === -1) return res.status(400).json({ error: 'La pestaña no tiene columna "Facturado".' });
        const ok = !/^(no|0|false)$/i.test(txt(body.facturada)) && txt(body.facturada) !== '';
        celdas.push({ range: "'" + PESTANA + "'!" + letra(iFact) + fila,
                      values: [[ok ? ('Sí · ' + quien + ' · ' + sello) : '']] });
      }
      if (body.nota != null) {
        celdas.push({ range: "'" + PESTANA + "'!" + letra(iNota) + fila,
                      values: [[txt(body.nota)]] });
      }
      await core.writeCells(b3.id, celdas);
      return res.status(200).json({ ok: true, accion: body.accion, fila,
        mensaje: body.accion === 'nota' ? 'Nota guardada.'
               : body.accion === 'revisar' ? 'Marcado como revisado.'
               : 'Marcada como facturada.',
        columnasCreadas: faltantes });
    }

    // Decir —o corregir— si un cobro ya registrado requiere factura.
    //
    // Se pregunta al registrarlo, pero si quedó en blanco el cobro no sale en
    // "Qué falta facturar" y no había dónde arreglarlo: las pantallas de cobros
    // son de solo lectura. Le pasó con la O15-26 y la O17-26.
    if (body.accion === 'requiere-factura') {
      const fila = Math.round(num(body.fila));
      if (!(fila > 1)) return res.status(400).json({ error: 'Falta cuál cobro.' });
      const valor = txt(body.requiereFactura);
      if (!/^(s[ií]|no|ya facturado)$/i.test(valor)) {
        return res.status(400).json({ error: 'Solo vale Sí, No o Ya facturado.' });
      }
      const b4 = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
      if (!b4 || !b4.id) return res.status(400).json({ error: 'No hay dónde guardar.' });
      let v4 = [];
      try { v4 = await core.readRange(b4.id, PESTANA); } catch (e) { v4 = []; }
      if (!v4.length) return res.status(400).json({ error: 'No se pudo leer la pestaña de cobros.' });
      const H4 = (v4[0] || []).map(h => txt(h));
      const iRF = H4.findIndex(h => /requiere factura/i.test(h));
      if (iRF === -1) {
        return res.status(400).json({ error: 'La pestaña no tiene columna "Requiere factura".' });
      }
      await core.writeCells(b4.id, [{
        range: "'" + PESTANA + "'!" + letra(iRF) + fila, values: [[valor]]
      }]);
      return res.status(200).json({ ok: true, fila, requiereFactura: valor,
        mensaje: /^s[ií]$/i.test(valor)
          ? 'Listo: este cobro ya sale en lo que falta facturar.'
          : 'Guardado: ' + valor + '.' });
    }

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
        // El cliente se trae del folio destino.
        //
        // Mover solo el folio dejaba el cobro con el nombre del dueño anterior:
        // "O5-26 · PASTORA CAMARENA" cuando la O5-26 es de Alejandro Romo. Medio
        // arreglado es peor que no arreglado, porque ya no se ve que esté mal.
        const cliDestino = txt(body.clienteNuevo) || await clienteDelFolio(nuevo);
        if (iCli !== -1 && cliDestino) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iCli) + fila,
                        values: [[cliDestino]] });
        }
        if (iNot !== -1) {
          celdas.push({ range: "'" + PESTANA + "'!" + letra(iNot) + fila,
            values: [[(txt(actual[iNot]) ? txt(actual[iNot]) + ' · ' : '') +
                      'Movido de ' + (antesFolio || '(sin folio)') + ' a ' + nuevo +
                      ' por ' + (quien || 'el ERP') + ' el ' + hoyLargo()]] });
        }
        mensaje = 'El cobro pasó de ' + (antesFolio || '(sin folio)') + ' a ' + nuevo +
                  (cliDestino ? ', a nombre de ' + cliDestino : '') + '.' +
                  (!cliDestino ? ' No encontré el cliente de ese folio: revísalo.' : '');
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

    // ¿Este cobro ya está? Mismo monto, misma referencia y misma fecha es el
    // mismo pago, aunque se registre desde otro folio.
    //
    // Pasó con María Morales: el mismo pago quedó dos veces, una en la
    // cotización COT-O6-26 y otra en la venta O7-26. Sin aviso no hay forma de
    // notarlo hasta que los totales no cuadran.
    if (!body.forzar) {
      const iF2 = H.findIndex(h => /^folio/i.test(h));
      const iM2 = H.findIndex(h => /monto|importe/i.test(h));
      const iR2 = H.findIndex(h => /referencia/i.test(h));
      const iD2 = H.findIndex(h => /fecha del pago/i.test(h));
      const iC2 = H.findIndex(h => /cliente/i.test(h));
      const ref = txt(body.referencia);
      const fec = txt(body.fecha) || hoyLargo();
      const igual = (a2, b2) => txt(a2).toLowerCase() === txt(b2).toLowerCase();
      const ya = [];
      for (let i = 1; i < values.length; i++) {
        const f = values[i] || [];
        if (iM2 === -1 || Math.abs(num(f[iM2]) - monto) > 0.009) continue;
        // El monto solo no basta: dos anticipos iguales son dos cobros.
        const mismaRef = ref && iR2 !== -1 && igual(f[iR2], ref);
        const mismaFecha = iD2 !== -1 && igual(f[iD2], fec);
        if (!mismaRef && !mismaFecha) continue;
        if (/CANCELADO/.test(iD2 !== -1 ? txt(f[H.findIndex(h => /notas|comentario/i.test(h))]) : '')) continue;
        ya.push({ fila: i + 1, folio: iF2 !== -1 ? txt(f[iF2]) : '',
                  cliente: iC2 !== -1 ? txt(f[iC2]) : '',
                  fecha: iD2 !== -1 ? txt(f[iD2]) : '',
                  referencia: iR2 !== -1 ? txt(f[iR2]) : '' });
      }
      if (ya.length) {
        return res.status(409).json({
          error: 'Este pago ya está registrado.',
          yaRegistrado: ya,
          pista: 'Aparece en ' + ya.map(x => (x.folio || '(sin folio)') +
            (x.cliente ? ' · ' + x.cliente : '')).join(' y ') +
            ', por el mismo monto' + (ref ? ' y la misma referencia' : ' y la misma fecha') +
            '. Si de verdad son dos pagos distintos, vuelve a darle y se registra.',
          sePuedeForzar: true
        });
      }
    }

    // Un cobro va contra una VENTA.
    //
    // Una cotización no es dinero comprometido: todavía puede no cerrarse, o
    // cerrarse con otro precio. Si el cobro se queda colgado del folio COT, la
    // venta nace sin su anticipo y el cobro nunca aparece en lo que hay que
    // facturar. Pasó con María Morales: el mismo pago quedó en la cotización
    // COT-O6-26 y en una venta O7-26 que ni siquiera existe en la hoja.
    if (!body.forzar) {
      const donde = await dondeViveElFolio(folio);
      if (!donde) {
        return res.status(409).json({
          error: 'No encuentro la venta ' + folio + '.',
          pista: 'Ese folio no está ni en Ventas ni en Cotizaciones. Revisa que esté bien ' +
                 'escrito. Si la venta todavía no se captura, captúrala primero y luego ' +
                 'registra el cobro, para que el anticipo nazca pegado a ella.',
          sePuedeForzar: true
        });
      }
      if (donde.area === 'cotizaciones') {
        return res.status(409).json({
          error: folio + ' es una cotización, no una venta.',
          pista: 'Pásala a venta con el botón "Mandar a venta" y registra el cobro en el ' +
                 'folio nuevo. Si lo dejas aquí, la venta nace sin su anticipo y el cobro ' +
                 'no sale en lo que falta facturar.',
          sePuedeForzar: true
        });
      }
    }

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
