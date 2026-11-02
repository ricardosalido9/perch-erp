// Cambiar el número de un pedido a proveedor, en todas las hojas donde aparece.
//
// Nico: *"había pedidos que se quedaron como 'Pendiente por Aydia' y ahora que
// ya nos pasaron el número de pedido, ya lo necesitamos cambiar"*.
//
// El número de pedido es la llave con la que se amarra todo: lo que se pidió,
// lo que llegó a bodega, lo que salió hacia una venta, lo que se pagó en EGRESOS
// y lo que está en la cola de pagos. Cambiarlo en un solo lado deja al pedido
// partido en dos —el estado de cuenta dejaría de ver sus pagos y la bodega
// perdería su lote—, así que se cambia en las seis hojas de un jalón.
//
//   ?action=pedido-nombre { pedido, nuevo }              dice qué se va a tocar
//   ?action=pedido-nombre { pedido, nuevo, confirmar:1 } lo cambia
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
// Los números de pedido a veces llegan como "3153.0" porque la celda es numérica
function normPedido(v) {
  let t = txt(v);
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  return norm(t);
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
function colLetra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Dónde vive el número de pedido. El orden es el del mensaje que ve el usuario.
const DONDE = [
  { key: 'prov_pedidos',  que: 'Pedidos a proveedores', cols: ['Pedido Proveedor', 'Pedido'] },
  { key: 'prov_entradas', que: 'Entradas de inventario', cols: ['Pedido Proveedor', 'Pedido'] },
  { key: 'prov_salidas',  que: 'Salidas de inventario', cols: ['Pedido Proveedor', 'Pedido'] },
  { key: 'fin_egresos',   que: 'EGRESOS (los pagos del banco)', cols: ['Pedido'] },
  { key: 'pagos_pedidos', que: 'Pagos por hacer', cols: ['Pedido'] },
  { key: 'prov_revision', que: 'Mi hoja', cols: ['Pedidos', 'Pedido', 'Pedido Proveedor'] },
  // Los pagos del arranque viven en una pestaña aparte del mismo archivo de
  // operación. No tiene área propia en el panel, pero el estado de cuenta la
  // lee: si el número cambia aquí y ahí no, esos pagos se quedan huérfanos.
  { key: 'prov_pedidos', hoja: 'Proveedores pagos', que: 'Proveedores pagos (los del corte)',
    cols: ['Pedido', 'Pedidos', 'Pedido Proveedor'] }
];

async function leer(key, hojaFija) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return null;
  let hoja;
  if (hojaFija) hoja = hojaFija;
  else { try { hoja = await core.resolveSheetName(cfg); } catch (e) { return null; } }
  let values;
  try { values = await core.readRange(cfg.id, hoja); } catch (e) { return null; }
  if (!values || !values.length) return null;
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  return { cfg, hoja, H, values, hr };
}

module.exports = async (req, res) => {
  try {
    const body = Object.assign({}, req.query || {}, await core.readBody(req));
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const viejo = txt(body.pedido);
    const nuevo = txt(body.nuevo);
    if (!viejo) return res.status(400).json({ error: 'Falta cuál pedido se va a cambiar.' });
    if (!nuevo) return res.status(400).json({ error: 'Falta el número nuevo.' });
    if (normPedido(viejo) === normPedido(nuevo)) {
      return res.status(400).json({ error: 'El número nuevo es el mismo que el de ahora.' });
    }
    if (body.confirmar && core.verifyWriter && !core.verifyWriter(body.token)) {
      return res.status(403).json({ error: 'Tu usuario no puede cambiar pedidos.' });
    }

    const detalle = [];
    const porEscribir = [];     // { id, data: [{range, values}] }
    let total = 0;
    // Si el número nuevo YA se usa, los dos pedidos se volverían uno solo
    let yaExiste = 0, deQuien = {};

    for (const d of DONDE) {
      const h = await leer(d.key, d.hoja);
      if (!h) { detalle.push({ que: d.que, renglones: 0, nota: 'no se pudo leer' }); continue; }
      const cPed = col(h.H, ...d.cols);
      if (!cPed) { detalle.push({ que: d.que, renglones: 0, nota: 'no tiene columna de pedido' }); continue; }
      const iPed = h.H.indexOf(cPed);
      const cProv = col(h.H, 'Proveedor');
      const iProv = cProv ? h.H.indexOf(cProv) : -1;
      const data = [];
      for (let r = h.hr + 1; r < h.values.length; r++) {
        const f = h.values[r] || [];
        const v = normPedido(f[iPed]);
        if (v === normPedido(viejo)) {
          data.push({
            range: "'" + h.hoja + "'!" + colLetra(iPed) + (r + 1),
            values: [[nuevo]]
          });
        } else if (v === normPedido(nuevo)) {
          yaExiste++;
          if (iProv >= 0 && txt(f[iProv])) deQuien[txt(f[iProv])] = 1;
        }
      }
      detalle.push({ que: d.que, renglones: data.length });
      total += data.length;
      if (data.length) porEscribir.push({ id: h.cfg.id, data });
    }

    if (!total) {
      return res.status(404).json({
        error: 'No encontré ningún renglón con el pedido "' + viejo + '".',
        pista: 'Revisa que esté escrito igual que en la hoja.',
        detalle
      });
    }

    const aviso = yaExiste
      ? ('Ojo: ya hay ' + yaExiste + (yaExiste === 1 ? ' renglón' : ' renglones') +
         ' con el número "' + nuevo + '"' +
         (Object.keys(deQuien).length ? ' (de ' + Object.keys(deQuien).join(', ') + ')' : '') +
         '. Si sigues, los dos pedidos van a quedar como uno solo.')
      : '';

    // Sin confirmar, solo se dice qué se tocaría
    if (!body.confirmar) {
      return res.status(200).json({
        ok: true, previo: true, pedido: viejo, nuevo, total, detalle,
        aviso,
        mensaje: 'Se cambiarían ' + total + (total === 1 ? ' renglón' : ' renglones') +
                 ' de "' + viejo + '" a "' + nuevo + '".'
      });
    }

    for (const w of porEscribir) {
      await core.writeCells(w.id, w.data);
    }

    return res.status(200).json({
      ok: true, pedido: viejo, nuevo, total, detalle, aviso,
      mensaje: 'El pedido "' + viejo + '" ahora es "' + nuevo + '": ' + total +
               (total === 1 ? ' renglón cambiado' : ' renglones cambiados') + ' en ' +
               detalle.filter(x => x.renglones).length +
               (detalle.filter(x => x.renglones).length === 1 ? ' hoja.' : ' hojas.')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
