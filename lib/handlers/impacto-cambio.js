// Qué más se mueve si cambia la cantidad de un producto en una venta.
//
// Cambiar 3 por 2 en la hoja de VENTAS no es un cambio de un número: si ya se
// pidieron 3 al proveedor, si ya salieron 3 de bodega o si el cliente ya pagó los
// 3, esa venta deja de cuadrar con producción y con cuentas por cobrar.
//
// Este endpoint no cambia nada. Solo dice qué hay del otro lado, para que quien
// edita sepa qué más tiene que ajustar.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = { _row: i + 1 }; headers.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const folio = txt(body.folio);
    const producto = txt(body.producto);
    const material = txt(body.material);
    const cantidadNueva = body.cantidad == null ? null : num(body.cantidad);
    if (!folio) return res.status(400).json({ error: 'Falta el folio.' });

    const [sal, ped, ing] = await Promise.all([
      leer('prov_salidas'), leer('prov_pedidos'), leer('ingresos')
    ]);

    const mismo = (p, m) => norm(p) === norm(producto) &&
      (!material || !m || norm(m) === norm(material));

    // Piezas que ya salieron de bodega para ese folio
    let salieron = 0;
    const detalleSalidas = [];
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio cliente', 'Folio');
      const sI = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sC = col(sal.headers, 'Cantidad');
      const sP = col(sal.headers, 'Pedido Proveedor', 'Numero de pedido', 'Pedido');
      if (sF && sI) sal.rows.forEach(r => {
        if (norm(r[sF]) !== norm(folio)) return;
        if (!mismo(r[sI], sM ? r[sM] : '')) return;
        const c = sC ? num(r[sC]) : 0;
        salieron += c;
        detalleSalidas.push({ fila: r._row, cantidad: c,
                              pedido: txt(sP ? r[sP] : '') });
      });
    }

    // Piezas que se le pidieron al proveedor para ese folio
    let pedidas = 0;
    const detallePedidos = [];
    if (ped.headers.length) {
      const pF = col(ped.headers, 'Folio cliente', 'Folio Cliente', 'Folio');
      const pI = col(ped.headers, 'Producto', 'Productos');
      const pM = col(ped.headers, 'Material');
      const pC = col(ped.headers, 'Cantidad');
      const pP = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const pPr = col(ped.headers, 'Proveedor');
      const pSt = col(ped.headers, 'Status');
      if (pF && pI) ped.rows.forEach(r => {
        if (norm(r[pF]) !== norm(folio)) return;
        if (!mismo(r[pI], pM ? r[pM] : '')) return;
        const c = pC ? num(r[pC]) : 0;
        pedidas += c;
        detallePedidos.push({ fila: r._row, cantidad: c,
                              pedido: txt(pP ? r[pP] : ''),
                              proveedor: txt(pPr ? r[pPr] : ''),
                              status: txt(pSt ? r[pSt] : '') });
      });
    }

    // Dinero ya cobrado de ese folio
    let cobrado = 0, pagos = 0;
    if (ing.headers.length) {
      const iP = col(ing.headers, 'Pedido', 'Folio');
      const iT = col(ing.headers, 'Total');
      if (iP && iT) ing.rows.forEach(r => {
        if (norm(r[iP]) !== norm(folio)) return;
        cobrado += Math.abs(num(r[iT]));
        pagos++;
      });
    }

    const avisos = [];
    if (cantidadNueva !== null) {
      if (salieron > cantidadNueva) {
        avisos.push({
          gravedad: 'alta',
          que: 'Ya salieron ' + salieron + ' piezas de bodega y la venta quedaría en ' +
               cantidadNueva + '.',
          queHacer: 'Si la pieza de más regresó, hay que registrar su entrada. Si se ' +
                    'quedó con el cliente, la venta debería seguir en ' + salieron + '.'
        });
      }
      if (pedidas > cantidadNueva) {
        avisos.push({
          gravedad: 'media',
          que: 'Al proveedor se le pidieron ' + pedidas + ' y la venta quedaría en ' +
               cantidadNueva + '.',
          queHacer: 'La pieza de más se queda como stock, o se cancela el pedido si ' +
                    'todavía no lo fabrica. Avísale al proveedor.'
        });
      }
      if (cobrado > 0) {
        avisos.push({
          gravedad: 'alta',
          que: 'El cliente ya pagó ' + cobrado.toLocaleString('es-MX',
               { style: 'currency', currency: 'MXN' }) + ' de este folio.',
          queHacer: 'Al bajar la cantidad, el saldo en Cuentas por Cobrar cambia y puede ' +
                    'quedar a favor del cliente. Revisa si hay que devolverle o dejarlo a cuenta.'
        });
      }
    }

    return res.status(200).json({
      ok: true,
      folio, producto, material,
      salieron, pedidas, cobrado, pagos,
      detalleSalidas: detalleSalidas.slice(0, 20),
      detallePedidos: detallePedidos.slice(0, 20),
      avisos,
      sinConsecuencias: !avisos.length,
      nota: avisos.length ? '' :
        'Este producto no tiene salidas ni pedidos ni cobros ligados, así que se puede ' +
        'cambiar sin que se mueva nada más.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
