// Anular una cotización o una venta capturada por error.
//
// Por qué no se borra el renglón: en una hoja de cálculo borrar una fila corre
// todas las de abajo, y el ERP guarda números de fila en varios lados. Borrar
// también deja un hueco en los folios que nadie puede explicar después.
//
// En vez de eso se marca como CANCELADA. Deja de contar en el dashboard, en el
// cierre, en el comparativo de costos y en la conversión, pero se puede ver qué
// pasó y quién lo canceló. Si de verdad hay que borrarla, hay una opción aparte
// y solo para el administrador.
//
// Y lo que no es obvio: si ya se había sacado algo de bodega para esa venta, el
// status por sí solo no lo devuelve. La salida sigue escrita, la pieza sigue
// contando como fuera del almacén, y como la venta cancelada desaparece de
// Surtir Ventas, la pieza se vuelve invisible: afuera, apartada para una venta
// que ya no existe. Por eso al cancelar se escribe el movimiento contrario —una
// salida en negativo, que es como se deshace un movimiento sin borrar nada— y la
// pieza regresa al stock sola, en todas las pantallas a la vez.
//
// Los pedidos que ya están con el proveedor NO se tocan: el carpintero ya está
// trabajando. Se avisan, y cuando lleguen entran a bodega sin destino.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const letra = (i) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
async function leerArea(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers: H, rows };
}

// Lo que salió de bodega para esta venta, en neto.
//
// Se suma en vez de contar renglones para que sea idempotente: si alguien
// cancela dos veces, la segunda ya encuentra el neto en cero y no devuelve nada
// de más.
async function salidasDe(folio) {
  const sal = await leerArea('prov_salidas');
  if (!sal.headers.length) return { ok: false, piezas: [] };
  const sF = col(sal.headers, 'Folio', 'Folio cliente');
  const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
  const sM = col(sal.headers, 'Material');
  const sQ = col(sal.headers, 'Cantidad');
  if (!sF || !sP || !sQ) return { ok: false, piezas: [] };
  const neto = {};
  sal.rows.forEach(r => {
    if (norm(r[sF]) !== norm(folio)) return;
    const k = norm(r[sP]) + '|' + norm(sM ? r[sM] : '');
    const g = neto[k] = neto[k] ||
      { producto: txt(r[sP]), material: txt(sM ? r[sM] : ''), cantidad: 0, plantilla: null };
    const q = num(r[sQ]);
    g.cantidad += q;
    if (q > 0 && !g.plantilla) g.plantilla = r;
  });
  return {
    ok: true, headers: sal.headers, cQ: sQ,
    piezas: Object.keys(neto).map(k => neto[k])
      .filter(x => Math.round(x.cantidad) > 0 && x.plantilla)
  };
}

// Lo que ya se le pidió al proveedor para esta venta. No se cancela: se avisa.
async function pedidosDe(folio) {
  const ped = await leerArea('prov_pedidos');
  if (!ped.headers.length) return [];
  const campos = ['Folio cliente', 'Destino', 'Folio'].map(n => col(ped.headers, n)).filter(Boolean);
  if (!campos.length) return [];
  const pP = col(ped.headers, 'Productos', 'Producto', 'Item');
  const pM = col(ped.headers, 'Material');
  const pQ = col(ped.headers, 'Cantidad');
  const pPr = col(ped.headers, 'Proveedor');
  const pSt = col(ped.headers, 'Status');
  const pNo = col(ped.headers, 'Pedido Proveedor');
  const out = [];
  ped.rows.forEach(r => {
    if (!campos.some(c => norm(r[c]) === norm(folio))) return;
    if (pSt && /cancelad|anulad/i.test(txt(r[pSt]))) return;
    out.push({
      pedido: txt(pNo ? r[pNo] : ''), proveedor: txt(pPr ? r[pPr] : ''),
      producto: txt(pP ? r[pP] : ''), material: txt(pM ? r[pM] : ''),
      cantidad: pQ ? num(r[pQ]) : 0, status: txt(pSt ? r[pSt] : '')
    });
  });
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const key = txt(body.key) || 'cotizaciones';
    const folio = txt(body.folio);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
    if (['cotizaciones', 'ventas_registro'].indexOf(key) === -1) {
      return res.status(400).json({ error: 'Solo se pueden anular cotizaciones y ventas.' });
    }

    const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'Esa área no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer la hoja.' });
    const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
    const H = (values[hr] || []).map(h => String(h).trim());
    const cRef = col(H, 'No. de Referencia', 'Folio');
    const cSt = col(H, 'Status');
    const cCom = col(H, 'Comentarios', 'Comentario', 'Nota');
    const cCli = col(H, 'Cliente');
    const cProd = col(H, 'Producto', 'Productos');
    const cTot = col(H, 'Total con envío', 'Total', 'Total con IVA');
    if (!cRef) return res.status(400).json({ error: 'La hoja no tiene columna de folio.' });
    if (!cSt) {
      return res.status(400).json({
        error: 'La hoja no tiene columna "Status".',
        pista: 'Sin ella no hay dónde marcar la cancelación.'
      });
    }

    const filas = [];
    for (let i = hr + 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      if (norm(o[cRef]) !== norm(folio)) continue;
      filas.push({ fila: i + 1, cliente: txt(cCli ? o[cCli] : ''),
                   producto: txt(cProd ? o[cProd] : ''),
                   total: txt(cTot ? o[cTot] : ''),
                   status: txt(o[cSt]) });
    }
    if (!filas.length) return res.status(404).json({ error: 'No se encontró ' + folio + '.' });

    // Solo una venta mueve bodega. Una cotización no mueve nada.
    const esVenta = key === 'ventas_registro';
    const sal = esVenta ? await salidasDe(folio) : { ok: false, piezas: [] };
    const pedidos = esVenta ? await pedidosDe(folio) : [];
    const aRegresar = Math.round(sal.piezas.reduce((a, x) => a + x.cantidad, 0));

    // Primera llamada: se dice qué se va a anular y no se toca nada
    if (!body.confirmar) {
      return res.status(200).json({
        ok: true, confirmado: false,
        folio, renglones: filas.length,
        cliente: filas[0].cliente,
        detalle: filas.slice(0, 20),
        yaCancelada: filas.every(f => /cancelad|anulad/i.test(f.status)),
        bodega: { piezas: sal.piezas.map(x =>
                    ({ producto: x.producto, material: x.material, cantidad: Math.round(x.cantidad) })),
                  total: aRegresar },
        pedidos,
        pedidosPiezas: Math.round(pedidos.reduce((a, x) => a + x.cantidad, 0)),
        pregunta: '¿Cancelar ' + folio + '? Son ' + filas.length +
          (filas.length === 1 ? ' renglón' : ' renglones') + '.',
        nota: 'Se marca como CANCELADA: deja de contar en el dashboard, en el cierre, ' +
              'en el comparativo de costos y en la tasa de conversión, pero queda el ' +
              'registro de qué pasó. No se borra el renglón.'
      });
    }

    const quien = txt(sesion && sesion.nombre) || txt(sesion && sesion.usuario) || '';
    const hoy = new Date();
    const sello = hoy.getDate() + ' ' + MESES[hoy.getMonth()] + ' ' + hoy.getFullYear();
    const motivo = txt(body.motivo);

    const celdas = [];
    filas.forEach(f => {
      celdas.push({ range: "'" + cfg.sheetName + "'!" + letra(H.indexOf(cSt)) + f.fila,
                    values: [['Cancelada']] });
      if (cCom) {
        celdas.push({ range: "'" + cfg.sheetName + "'!" + letra(H.indexOf(cCom)) + f.fila,
                      values: [['Cancelada por ' + (quien || 'el ERP') + ' el ' + sello +
                                (motivo ? ' · ' + motivo : '')]] });
      }
    });
    await core.writeCells(cfg.id, celdas);

    // El movimiento contrario: lo que salió de bodega para esta venta regresa.
    // Es una salida en negativo, no un borrón: así queda el rastro de las dos
    // cosas y todas las pantallas que suman entradas menos salidas cuadran solas.
    const regresadas = [];
    const noRegresadas = [];
    for (const p of sal.piezas) {
      try {
        const rec = {};
        sal.headers.forEach(h => { rec[h] = p.plantilla[h]; });
        rec[sal.cQ] = -Math.round(p.cantidad);
        const cCU = col(sal.headers, 'Costo Unitario');
        const cCT = col(sal.headers, 'Costo Total');
        if (cCT) {
          rec[cCT] = cCU
            ? -Math.round(num(p.plantilla[cCU]) * Math.round(p.cantidad) * 100) / 100
            : -num(p.plantilla[cCT]);
        }
        ['Fecha', 'Fecha de cierre de venta'].forEach(n => {
          const c = col(sal.headers, n); if (c) rec[c] = sello;
        });
        const cCo = col(sal.headers, 'Comentarios', 'Comentario', 'Nota');
        if (cCo) {
          rec[cCo] = 'Regreso a bodega por cancelación de ' + folio +
                     ' · ' + (quien || 'el ERP') + ' el ' + sello +
                     (motivo ? ' · ' + motivo : '');
        }
        await core.addRecord('prov_salidas', rec);
        regresadas.push({ producto: p.producto, material: p.material,
                          cantidad: Math.round(p.cantidad) });
      } catch (e) {
        noRegresadas.push({ producto: p.producto, material: p.material,
                            cantidad: Math.round(p.cantidad),
                            porque: (e && e.message) || String(e) });
      }
    }
    const nReg = regresadas.reduce((a, x) => a + x.cantidad, 0);
    const nPed = Math.round(pedidos.reduce((a, x) => a + x.cantidad, 0));

    const notas = ['Ya no cuenta en los análisis. Si la necesitas de vuelta, cámbiale el ' +
                   'status a mano en la hoja.'];
    if (nReg) {
      notas.push((nReg === 1 ? 'Regresó a bodega 1 pieza que ya se había sacado'
                               : 'Regresaron a bodega ' + nReg + ' piezas que ya se habían sacado') +
                 ' para esta venta: ' +
                 regresadas.map(x => x.cantidad + ' × ' + x.producto +
                   (x.material ? ' (' + x.material + ')' : '')).join(', ') + '.');
    }
    if (noRegresadas.length) {
      notas.push('OJO: no se pudo regresar ' +
                 noRegresadas.map(x => x.cantidad + ' × ' + x.producto).join(', ') +
                 '. Hay que darle salida a mano en la hoja de Salidas.');
    }
    if (nPed) {
      notas.push('Esta venta tenía ' +
                 (nPed === 1 ? '1 pieza ya pedida' : nPed + ' piezas ya pedidas') +
                 ' al proveedor (' +
                 pedidos.map(x => x.proveedor).filter((v, i, a) => a.indexOf(v) === i).join(', ') +
                 '). El pedido NO se canceló: eso se habla con el proveedor. Cuando llegue, ' +
                 'entra a bodega sin destino.');
    }

    return res.status(200).json({
      ok: true, confirmado: true,
      renglones: filas.length,
      regresadas, noRegresadas, piezasRegresadas: nReg, pedidos,
      mensaje: folio + ' quedó cancelada en ' + filas.length +
               (filas.length === 1 ? ' renglón.' : ' renglones.') +
               (nReg ? (nReg === 1 ? ' Regresó 1 pieza a bodega.'
                                  : ' Regresaron ' + nReg + ' piezas a bodega.') : ''),
      nota: notas.join(' ')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
