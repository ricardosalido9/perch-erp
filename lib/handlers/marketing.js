// ===== Los datos de marketing de una venta: revisar, capturar y recuperar =====
//
// Camila, 19 nov: *"a todas las cotizaciones les puse la info de donde llegaron,
// creo que al pasarla a ventas se borra, me ayudas a decir donde puede a cada
// venta ingresarle esta info de nuevo"*.
//
// No se borraba. Lo que pasaba era esto:
//
// 1. La ventana de "Marcar como vendida" leía sus propias preguntas con un
//    nombre equivocado, así que TODO lo que se contestaba ahí se tiraba. Se
//    arregló en el panel (19 nov). Por eso "Tipo de Línea" —que solo se
//    pregunta ahí— estaba lleno en 145 de 145 renglones viejos y en casi
//    ninguno de los que escribió el panel.
//
// 2. La pestaña Marketing tenía un hueco a media tabla (un renglón basura con
//    fecha "17 julio 1905" y dos vacíos, dentro del bloque de 2024). El panel
//    escribía ahí, porque el "append" de Google termina la tabla en el primer
//    renglón vacío. Esos renglones SÍ traen el dato; los que se ven vacíos son
//    una segunda copia que quedó al final de la hoja. El reporte leía las dos.
//
// Aquí vive lo que hace falta para salir de eso sin volver a capturar a mano:
//
//   que=revisar   → qué le falta a cada venta, qué está duplicado y de dónde
//                   se puede recuperar. No escribe nada.
//   que=guardar   → captura los datos de marketing de UNA venta: actualiza su
//                   renglón en Marketing (no crea otro) y, lo que tenga columna,
//                   también en la hoja de Ventas.
//   que=jalar     → recupera en bloque lo que ya está en la cotización o en la
//                   venta. Con aplicar=false solo enseña qué haría.
const core = require('../core');

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
function colLetter(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function anioDe(v) {
  const m = txt(v).match(/(\d{4})/);
  return m ? +m[1] : 0;
}

// Las columnas de Marketing y cómo se llama lo mismo en Cotizaciones y en Ventas.
// Nunca se busca por letra ni por posición: solo por nombre de encabezado.
const CAMPOS = [
  { mkt: 'Cómo Llego',       hoja: ['Forma de Contacto', 'Cómo Llego', 'Como llego', 'Cómo llegó'] },
  { mkt: 'Tipo de Línea',    hoja: ['Tipo de Cliente', 'Tipo de Línea', 'TIPO CLIENTE'] },
  { mkt: 'Showroom',         hoja: ['Visito Showroom', 'Showroom', 'Visitó Showroom'] },
  { mkt: 'Notas',            hoja: ['Notas', 'NOTAS', 'Comentarios'] },
  // Estas cuatro no tienen columna ni en Cotizaciones ni en Ventas: viven solo
  // en Marketing, así que solo se capturan desde el panel.
  { mkt: 'Ciudad',           hoja: ['Ciudad'] },
  { mkt: 'Proyecto',         hoja: ['Tipo de Proyecto', 'Proyecto'] },
  { mkt: 'Línea de Negocio', hoja: ['Línea de Negocio', 'Linea de Negocio'] },
  { mkt: 'Happening',        hoja: ['Happening', 'HAPPENING'] }
];

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [], cfg: null, error: e.message }; }
  if (!values || !values.length) return { headers: [], rows: [], cfg };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = {}; let algo = false;
    H.forEach((h, j) => { if (h) { o[h] = f[j] == null ? '' : f[j]; if (txt(f[j])) algo = true; } });
    if (algo) { o.__fila = i + 1; rows.push(o); }
  }
  const sheetName = await core.resolveSheetName(cfg);
  return { headers: H, rows, cfg, sheetName, hr };
}

// Un índice folio -> lo que trae cada hoja fuente, para no leerlas dos veces
function indice(hoja, campos) {
  const H = hoja.headers;
  const cRef = col(H, 'No. de Referencia', 'Folio');
  const mapa = {};
  if (!cRef) return mapa;
  hoja.rows.forEach(r => {
    const f = txt(r[cRef]).toUpperCase();
    if (!f) return;
    const dest = mapa[f] = mapa[f] || { folio: f, fila: r.__fila, datos: {} };
    campos.forEach(c => {
      if (dest.datos[c.mkt]) return;              // ya lo trajo otro renglón del folio
      const h = col(H, ...c.hoja);
      if (h && txt(r[h])) dest.datos[c.mkt] = txt(r[h]);
    });
  });
  return mapa;
}

// El renglón de Marketing que vale para un folio: el que más campos trae.
// Cuando hay más de uno, los demás son copias que inflan el reporte.
function porFolio(mk) {
  const H = mk.headers;
  const cRef = col(H, 'No. de Referencia', 'Folio');
  const grupos = {};
  if (!cRef) return grupos;
  mk.rows.forEach(r => {
    const f = txt(r[cRef]).toUpperCase();
    if (!f) return;
    (grupos[f] = grupos[f] || []).push(r);
  });
  Object.keys(grupos).forEach(f => {
    grupos[f].sort((a, b) => {
      const pa = CAMPOS.filter(c => txt(a[c.mkt])).length;
      const pb = CAMPOS.filter(c => txt(b[c.mkt])).length;
      if (pb !== pa) return pb - pa;
      return a.__fila - b.__fila;
    });
  });
  return grupos;
}

module.exports = async (req, res) => {
  try {
    const body = req._body || await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    const que = txt(body.que) || 'revisar';
    const escribe = (que === 'guardar' || (que === 'jalar' && body.aplicar));
    if (escribe && !core.verifyWriter(body.token)) {
      return res.status(403).json({ error: 'Tu usuario solo puede consultar.' });
    }

    const mk = await leer('marketing');
    if (!mk.headers.length) {
      return res.status(400).json({
        error: 'No se pudo leer la pestaña "Marketing".' + (mk.error ? ' (' + mk.error + ')' : '')
      });
    }
    const Hm = mk.headers;
    const cRefM = col(Hm, 'No. de Referencia', 'Folio');
    if (!cRefM) {
      return res.status(400).json({
        error: 'La pestaña Marketing no tiene columna "No. de Referencia".',
        columnas_de_la_hoja: Hm.filter(Boolean)
      });
    }
    const grupos = porFolio(mk);

    // ---------- lo que hoy tiene UNA venta, para precargar la ventana ----------
    if (que === 'uno') {
      const folio = txt(body.folio).toUpperCase();
      if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
      const mios = grupos[folio] || [];
      const mejor = mios[0] || null;
      const datos = {};
      CAMPOS.forEach(c => { datos[c.mkt] = mejor ? txt(mejor[c.mkt]) : ''; });

      // Lo que falte se propone desde la venta y desde su cotización, para que
      // no haya que volver a teclear lo que ya está capturado en otro lado.
      const sugerencias = {};
      const ven1 = await leer('ventas_registro');
      const cot1 = await leer('cotizaciones');
      const buscar = (hoja, etiqueta) => {
        const H = hoja.headers;
        if (!H.length) return;
        const cR = col(H, 'No. de Referencia', 'Folio');
        const cSt = col(H, 'Status', 'Estatus');
        if (!cR) return;
        hoja.rows.forEach(r => {
          const propio = txt(r[cR]).toUpperCase() === folio;
          const vendida = cSt && new RegExp('^\\s*vendida\\s*[: ]\\s*' + folio + '\\s*$', 'i')
            .test(txt(r[cSt]));
          if (!propio && !vendida) return;
          CAMPOS.forEach(c => {
            if (txt(datos[c.mkt]) || sugerencias[c.mkt]) return;
            const h = col(H, ...c.hoja);
            if (h && txt(r[h])) sugerencias[c.mkt] = { valor: txt(r[h]), de: etiqueta };
          });
        });
      };
      buscar(ven1, 'la venta');
      buscar(cot1, 'su cotización');

      return res.status(200).json({
        ok: true, folio, fila: mejor ? mejor.__fila : null,
        cliente: mejor ? txt(mejor[col(Hm, 'Cliente')]) : '',
        datos, sugerencias,
        copias: mios.length > 1 ? mios.slice(1).map(r => r.__fila) : [],
        campos: CAMPOS.map(c => c.mkt)
      });
    }

    // ---------- guardar los datos de UNA venta ----------
    if (que === 'guardar') {
      const folio = txt(body.folio).toUpperCase();
      if (!folio) return res.status(400).json({ error: 'Falta el folio de la venta.' });
      const datos = body.datos || {};
      const limpio = {};
      Object.keys(datos).forEach(k => { if (txt(datos[k])) limpio[k] = txt(datos[k]); });
      // Una venta sin ninguna respuesta de marketing igual necesita su renglón.
      // Con `asegurar` se crea si no está y, si ya está, no se toca nada: así el
      // alta normal no puede dejar una copia.
      if (!Object.keys(limpio).length && !body.asegurar) {
        return res.status(400).json({ error: 'No hay nada que guardar.' });
      }
      if (!Object.keys(limpio).length && (grupos[folio] || []).length) {
        return res.status(200).json({ ok: true, folio, fila: grupos[folio][0].__fila,
                                      creada: false, campos: [], yaEstaba: true });
      }

      const cuales = CAMPOS.filter(c => limpio[c.mkt] != null);
      const fuera = Object.keys(limpio).filter(k => !CAMPOS.some(c => c.mkt === k));

      // 1) El renglón de Marketing. Si ya existe se actualiza; nunca se agrega
      //    otro, que es lo que llenó la hoja de copias.
      const mios = grupos[folio] || [];
      let filaMkt = null, creada = false;
      if (mios.length) {
        filaMkt = mios[0].__fila;
        const data = [];
        cuales.forEach(c => {
          const i = Hm.findIndex(h => norm(h) === norm(c.mkt));
          if (i === -1) return;
          const L = colLetter(i);
          data.push({ range: "'" + mk.sheetName + "'!" + L + filaMkt + ':' + L + filaMkt,
                      values: [[limpio[c.mkt]]] });
        });
        if (data.length) await core.writeCells(mk.cfg.id, data);
      } else {
        // No tenía renglón: se crea uno con lo que se sabe de la venta
        const rec = {};
        rec[cRefM] = folio;
        cuales.forEach(c => { rec[c.mkt] = limpio[c.mkt]; });
        ['Fecha del Cierre', 'Cliente', 'Despacho', 'Productos', 'Total Pedido', 'Envio', 'Mes']
          .forEach(k => { if (txt(body[k])) rec[k] = txt(body[k]); });
        const out = await core.addRecord('marketing', rec);
        filaMkt = (out && (out.fila || out.row)) || null;
        creada = true;
      }

      // 2) Lo que sí tiene columna en la hoja de Ventas se guarda también ahí,
      //    que es el registro de la venta y no un resumen.
      const ven = await leer('ventas_registro');
      let filasVenta = 0;
      if (ven.headers.length) {
        const Hv = ven.headers;
        const cRefV = col(Hv, 'No. de Referencia', 'Folio');
        if (cRefV) {
          const data = [];
          const skip = (core.FORMULA_FIELDS && core.FORMULA_FIELDS.ventas_registro) || [];
          const esFormula = (h) => skip.some(s => norm(s) === norm(h));
          ven.rows.forEach(r => {
            if (txt(r[cRefV]).toUpperCase() !== folio) return;
            filasVenta++;
            cuales.forEach(c => {
              const h = col(Hv, ...c.hoja);
              if (!h || esFormula(h)) return;
              const i = Hv.findIndex(x => norm(x) === norm(h));
              if (i === -1) return;
              const L = colLetter(i);
              data.push({ range: "'" + ven.sheetName + "'!" + L + r.__fila + ':' + L + r.__fila,
                          values: [[limpio[c.mkt]]] });
            });
          });
          if (data.length) await core.writeCells(ven.cfg.id, data);
        }
      }

      return res.status(200).json({
        ok: true, folio, fila: filaMkt, creada,
        campos: cuales.map(c => c.mkt),
        filasDeLaVenta: filasVenta,
        copias: mios.length > 1 ? mios.slice(1).map(r => r.__fila) : [],
        ignorados: fuera
      });
    }

    // ---------- revisar / jalar ----------
    const ven = await leer('ventas_registro');
    const cot = await leer('cotizaciones');
    const Hv = ven.headers, Hc = cot.headers;
    const cRefV = col(Hv, 'No. de Referencia', 'Folio');
    const cCliV = col(Hv, 'Cliente');
    const cFecV = col(Hv, 'Fecha del Cierre', 'Fecha');
    const cTotV = col(Hv, 'Total Pedido', 'Total');
    const cEnvV = col(Hv, 'Envio', 'Envío');

    const anio = body.anio ? +body.anio : (new Date()).getFullYear();

    // Lo que ya está capturado en la propia venta
    const deVenta = indice(ven, CAMPOS);
    // Lo que está en la cotización que se marcó "Vendida <folio>"
    const deCot = {};
    if (Hc.length) {
      const cSt = col(Hc, 'Status', 'Estatus');
      cot.rows.forEach(r => {
        const m = txt(cSt ? r[cSt] : '').match(/^\s*vendida\s*[: ]\s*(.+)$/i);
        if (!m) return;
        const f = txt(m[1]).toUpperCase();
        const dest = deCot[f] = deCot[f] || { folio: f, cot: '', datos: {} };
        if (!dest.cot) {
          const cR = col(Hc, 'No. de Referencia', 'Folio');
          dest.cot = cR ? txt(r[cR]) : '';
        }
        CAMPOS.forEach(c => {
          if (dest.datos[c.mkt]) return;
          const h = col(Hc, ...c.hoja);
          if (h && txt(r[h])) dest.datos[c.mkt] = txt(r[h]);
        });
      });
    }

    // Una línea por venta del año: qué le falta y de dónde se puede sacar
    const ventasDelAnio = {};
    if (cRefV) ven.rows.forEach(r => {
      const f = txt(r[cRefV]).toUpperCase();
      if (!f || anioDe(r[cFecV]) !== anio) return;
      const v = ventasDelAnio[f] = ventasDelAnio[f] || {
        folio: f, cliente: cCliV ? txt(r[cCliV]) : '', fecha: txt(r[cFecV]), monto: 0
      };
      v.monto += (cTotV ? num(r[cTotV]) : 0) + (cEnvV ? num(r[cEnvV]) : 0);
    });

    const faltan = [], duplicados = [], huerfanos = [];
    const plan = [];
    Object.keys(ventasDelAnio).forEach(f => {
      const v = ventasDelAnio[f];
      const mios = grupos[f] || [];
      const mejor = mios[0] || null;
      if (mios.length > 1) {
        duplicados.push({ folio: f, cliente: v.cliente, se_queda: mejor.__fila,
                          copias: mios.slice(1).map(r => r.__fila) });
      }
      const vacios = CAMPOS.filter(c => !mejor || !txt(mejor[c.mkt])).map(c => c.mkt);
      if (!vacios.length) return;
      // ¿De dónde se puede recuperar lo que falta?
      const fuentes = {};
      vacios.forEach(k => {
        const dv = (deVenta[f] && deVenta[f].datos[k]) || '';
        const dc = (deCot[f] && deCot[f].datos[k]) || '';
        if (dv) fuentes[k] = { valor: dv, de: 'la venta' };
        else if (dc) fuentes[k] = { valor: dc, de: 'la cotización ' + (deCot[f].cot || '') };
      });
      const recuperables = Object.keys(fuentes);
      faltan.push({
        folio: f, cliente: v.cliente, fecha: v.fecha,
        monto: Math.round(v.monto * 100) / 100,
        fila: mejor ? mejor.__fila : null,
        vacios, recuperables,
        hay_que_preguntar: vacios.filter(k => !fuentes[k]),
        // "De dónde llegó" es el que pidió Camila: se marca aparte
        falta_como_llego: vacios.indexOf('Cómo Llego') !== -1,
        se_recupera_como_llego: !!fuentes['Cómo Llego']
      });
      if (recuperables.length) {
        const datos = {};
        recuperables.forEach(k => { datos[k] = fuentes[k].valor; });
        plan.push({ folio: f, fila: mejor ? mejor.__fila : null, cliente: v.cliente,
                    fecha: v.fecha, monto: v.monto, datos });
      }
    });
    // Renglones de Marketing con un folio que no existe en Ventas: ahí hay un
    // folio mal escrito, y el reporte los está contando como ventas.
    Object.keys(grupos).forEach(f => {
      if (ventasDelAnio[f]) return;
      grupos[f].forEach(r => {
        if (anioDe(r[col(Hm, 'Fecha del Cierre', 'Fecha')]) !== anio) return;
        huerfanos.push({ folio: f, fila: r.__fila,
                         cliente: txt(r[col(Hm, 'Cliente')]),
                         monto: num(r[col(Hm, 'Total Pedido', 'Total')]) +
                                num(r[col(Hm, 'Envio', 'Envío')]) });
      });
    });

    faltan.sort((a, b) => b.monto - a.monto);
    plan.sort((a, b) => norm(a.folio) < norm(b.folio) ? -1 : 1);

    // ---------- aplicar la recuperación ----------
    let escritas = 0;
    if (que === 'jalar' && body.aplicar) {
      const soloFolio = txt(body.folio).toUpperCase();
      for (const p of plan) {
        if (soloFolio && p.folio !== soloFolio) continue;
        // La venta no tenía renglón en Marketing: se le crea uno con lo que se
        // sabe de la venta. addRecord escribe al final de la tabla de verdad,
        // nunca en un hueco de media hoja.
        if (!p.fila) {
          const rec = {};
          rec[cRefM] = p.folio;
          Object.keys(p.datos).forEach(k => { rec[k] = p.datos[k]; });
          const cFecM = col(Hm, 'Fecha del Cierre', 'Fecha');
          const cCliM = col(Hm, 'Cliente');
          const cTotM = col(Hm, 'Total Pedido', 'Total');
          if (cFecM && p.fecha) rec[cFecM] = p.fecha;
          if (cCliM && p.cliente) rec[cCliM] = p.cliente;
          if (cTotM && p.monto) rec[cTotM] = p.monto;
          await core.addRecord('marketing', rec);
          escritas++;
          continue;
        }
        const data = [];
        Object.keys(p.datos).forEach(k => {
          const i = Hm.findIndex(h => norm(h) === norm(k));
          if (i === -1) return;
          const L = colLetter(i);
          data.push({ range: "'" + mk.sheetName + "'!" + L + p.fila + ':' + L + p.fila,
                      values: [[p.datos[k]]] });
        });
        if (data.length) { await core.writeCells(mk.cfg.id, data); escritas++; }
      }
    }

    return res.status(200).json({
      ok: true, anio,
      pestana: mk.sheetName,
      ventas: Object.keys(ventasDelAnio).length,
      faltan, duplicados, huerfanos,
      plan: plan.map(p => ({ folio: p.folio, cliente: p.cliente, fila: p.fila,
                             campos: Object.keys(p.datos).length,
                             datos: p.datos })),
      aplicado: que === 'jalar' && !!body.aplicar,
      escritas,
      campos: CAMPOS.map(c => c.mkt),
      nota: 'Los duplicados no se borran desde aquí: la hoja es del cliente. ' +
            'Se enseñan con su número de renglón para que alguien los revise.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
