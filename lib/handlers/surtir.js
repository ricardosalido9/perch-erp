// Surtir ventas: de dónde sale cada pieza que todavía se debe.
//
// Es "Mandar a venta" al revés. Hoy se empieza por el pedido —llegó esto, ¿a
// quién se lo doy?— y así se piensa en producción. Pero quien vende lo piensa al
// contrario: tengo esta venta, ¿de dónde la surto?
//
// Para cada pieza pendiente dice si hay en bodega —y deja asignarla de un clic— o
// qué proveedores ya la han hecho, con su costo y sus días de entrega, para
// mandarles el pedido sin salir de aquí.
//
//   ?action=surtir                      lista lo pendiente
//   ?action=surtir  { hacer:'stock' }   asigna de bodega
//   ?action=surtir  { hacer:'pedido' }  manda pedido al proveedor
const core = require('../core');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
// Los saltos de línea dentro de una celda se aplanan a un espacio. Una celda de
// la hoja puede traer dos renglones y, sin esto, el valor arrastra el salto: en
// HTML se ve como un espacio pero al comparar es otro texto, así que el mismo
// proveedor aparecía dos veces en la lista.
const txt = (v) => String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...n) {
  for (const x of n) { const c = H.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
function hoyLargo() {
  const d = new Date();
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}
// La fecha del cierre llega de tres formas distintas según quién capturó el
// renglón: número de serie de Sheets, "7 octubre 2026" o 07/10/2026. Para
// ordenar hay que volverlas todas un número.
function fechaNum(v) {
  const t = txt(v);
  if (!t) return 0;
  if (/^\d{5}$/.test(t)) {
    const n = Number(t);
    if (n > 20000 && n < 80000) return Date.UTC(1899, 11, 30) + n * 86400000;
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { let a = +m[3]; if (a < 100) a += 2000; return Date.UTC(a, +m[2] - 1, +m[1]); }
  m = norm(t).match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de\s+)?(\d{4})/);
  if (m) { const i = MESES.indexOf(m[2]); if (i >= 0) return Date.UTC(+m[3], i, +m[1]); }
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function fechaTexto(v) {
  const t = txt(v);
  if (!/^\d{5}$/.test(t)) return t;
  const n = fechaNum(v);
  if (!n) return t;
  const d = new Date(n);
  return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
// La columna de C.P. de la Lista de Clientes tiene formato de moneda, así que
// llega "$ 11,000.00". Quitarle lo que no es dígito daría 1100000: hay que
// leerlo como número y volverlo cinco dígitos.
function limpiaCP(v) {
  const t = txt(v);
  if (!t) return '';
  if (/[a-zA-Z]/.test(t)) return t;
  const n = parseFloat(t.replace(/[$\s,]/g, ''));
  if (!isFinite(n)) return t;
  const d = String(Math.round(n));
  return d.length < 5 ? ('00000' + d).slice(-5) : d;
}
async function leer(key) {
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
    // El renglón de la hoja, para poder volver a él y corregirlo —apartar para
    // una venta unas piezas que se habían pedido para Stock, por ejemplo—.
    Object.defineProperty(o, '__fila', { value: i + 1, enumerable: false });
    rows.push(o);
  }
  return { headers: H, rows, cfg };
}
// "A", "N", "AA": la letra de la columna número i
function colLetra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const pieza = (prod, mat) => norm(prod) + '|' + norm(mat);
// "NA", "N/A", "No aplica", "-": el catálogo las usa para decir que ese producto
// no lleva segundo material. No son cosas que haya que conseguir.
const NO_ES_MATERIAL = /^(n\/?a|no aplica|ninguno|ninguna|sin|-+|\.+)$/i;
const esMaterial = (v) => { const t = txt(v); return !!t && !NO_ES_MATERIAL.test(t); };
const esSoloSaldo = (n) => /^\s*saldo inicial del corte/i.test(String(n || ''));

module.exports = async (req, res) => {
  try {
    const body = Object.assign({}, req.query || {}, await core.readBody(req));
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    // ---- Apartar piezas de un pedido que se pidió para Stock ----
    //
    // Lo de Nico con la AG10-26: el PCH-T-053 trae 6 Sillas Chara en Nogal que
    // se pidieron para Stock y todavía no llegan. Como no están en bodega, la
    // pantalla solo ofrecía pedir otras seis —y TANDEM habría fabricado doce—.
    // Aquí esas piezas se le apartan a la venta sin pedir nada: si se toman
    // todas, al renglón se le cambia el destino; si se toman unas cuantas, se
    // parte en dos y el resto se queda para Stock. Nunca se borra un renglón.
    if (body.hacer === 'apartar') {
      if (core.verifyWriter && !core.verifyWriter(body.token)) {
        return res.status(403).json({ error: 'Tu usuario no puede registrar movimientos.' });
      }
      const cant = Math.round(num(body.cantidad));
      const fila = Math.round(num(body.fila));
      if (!txt(body.folio) || !fila || cant <= 0) {
        return res.status(400).json({ error: 'Falta el folio, el renglón o la cantidad.' });
      }
      const ped2 = await leer('prov_pedidos');
      if (!ped2.headers.length) {
        return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });
      }
      const r0 = ped2.rows.filter(r => r.__fila === fila)[0];
      if (!r0) return res.status(404).json({ error: 'Ese renglón del pedido ya no existe.' });

      const H2 = ped2.headers;
      const hProd = col(H2, 'Productos', 'Producto', 'Item');
      const hMat = col(H2, 'Material');
      const hCant = col(H2, 'Cantidad');
      const hDest = col(H2, 'Destino');
      const hFol = col(H2, 'Folio cliente', 'Folio');
      const hCli = col(H2, 'Cliente');
      const hCU = col(H2, 'Costo Unitario');
      const hCT = col(H2, 'Costo Total');
      const hCTI = col(H2, 'Costo Total + IVA');
      const hNo = col(H2, 'Pedido Proveedor', 'Pedido');
      if (!hCant || !hDest) {
        return res.status(400).json({ error: 'La hoja de pedidos no tiene Cantidad o Destino.' });
      }
      // Que sea la pieza que se está surtiendo y que de verdad esté libre
      if (txt(body.producto) && hProd &&
          pieza(r0[hProd], hMat ? r0[hMat] : '') !== pieza(body.producto, body.material)) {
        return res.status(409).json({ error: 'Ese renglón no es de esa pieza.' });
      }
      const dest0 = txt(r0[hDest]);
      if (dest0 && !/^(stock|bodega|showroom|exhibici)/i.test(dest0)) {
        return res.status(409).json({
          error: 'Ese renglón ya está apartado para ' + dest0 + '.',
          pista: 'Solo se pueden tomar piezas de un pedido hecho para Stock o Bodega.'
        });
      }
      const enFila = Math.round(num(r0[hCant]));
      if (cant > enFila) {
        return res.status(409).json({
          error: 'Ese renglón solo tiene ' + enFila +
                 (enFila === 1 ? ' pieza' : ' piezas') + ' y estás pidiendo ' + cant + '.'
        });
      }

      const cfgP = ped2.cfg;
      const hoja = await core.resolveSheetName(cfgP);
      const costoU = hCU ? num(r0[hCU]) : 0;
      const cel = (h, f, v) => ({
        range: "'" + hoja + "'!" + colLetra(H2.indexOf(h)) + f, values: [[v]]
      });

      if (cant === enFila) {
        // Se va completo: se le cambia el destino al renglón
        const data = [cel(hDest, fila, txt(body.folio))];
        if (hFol) data.push(cel(hFol, fila, txt(body.folio)));
        if (hCli && txt(body.cliente)) data.push(cel(hCli, fila, txt(body.cliente)));
        await core.writeCells(cfgP.id, data);
        return res.status(200).json({ ok: true, hecho: 'apartar', filas: 1, partido: false,
          mensaje: cant + (cant === 1 ? ' pieza apartada' : ' piezas apartadas') + ' de ' +
                   txt(r0[hNo] || '') + ' para ' + txt(body.folio) +
                   '. Ese renglón ya no va a Stock.' });
      }

      // Se toma una parte: el renglón se queda con el resto y se agrega otro
      // con lo apartado. Primero se escribe el nuevo; si algo falla, el
      // original no queda mermado sin que exista su contraparte.
      const quedan = enFila - cant;
      const nuevo = {};
      H2.forEach(h => { if (txt(r0[h]) !== '') nuevo[h] = r0[h]; });
      nuevo[hCant] = cant;
      nuevo[hDest] = txt(body.folio);
      if (hFol) nuevo[hFol] = txt(body.folio);
      if (hCli && txt(body.cliente)) nuevo[hCli] = txt(body.cliente);
      if (hCT) nuevo[hCT] = Math.round(costoU * cant * 100) / 100;
      if (hCTI) nuevo[hCTI] = Math.round(costoU * cant * 1.16 * 100) / 100;
      const r2 = await core.addRecord('prov_pedidos', nuevo);

      const data = [cel(hCant, fila, quedan)];
      if (hCT) data.push(cel(hCT, fila, Math.round(costoU * quedan * 100) / 100));
      if (hCTI) data.push(cel(hCTI, fila, Math.round(costoU * quedan * 1.16 * 100) / 100));
      await core.writeCells(cfgP.id, data);

      return res.status(200).json({ ok: true, hecho: 'apartar', filas: 1, partido: true,
        mensaje: cant + (cant === 1 ? ' pieza apartada' : ' piezas apartadas') + ' de ' +
                 txt(r0[hNo] || '') + ' para ' + txt(body.folio) + '. Quedan ' + quedan +
                 (quedan === 1 ? ' pieza' : ' piezas') + ' para Stock en ese pedido.',
        detalle: r2 });
    }

    // ---- Acciones ----
    if (body.hacer === 'stock' || body.hacer === 'pedido') {
      if (core.verifyWriter && !core.verifyWriter(body.token)) {
        return res.status(403).json({ error: 'Tu usuario no puede registrar movimientos.' });
      }
      const cant = Math.round(num(body.cantidad));
      if (!txt(body.folio) || !txt(body.producto) || cant <= 0) {
        return res.status(400).json({ error: 'Falta el folio, el producto o la cantidad.' });
      }

      if (body.hacer === 'stock') {
        // Sale de bodega hacia esa venta: es una salida de inventario normal
        const r = await core.addRecord('prov_salidas', {
          'Fecha de cierre de venta': hoyLargo(), 'Fecha': hoyLargo(),
          'Folio': txt(body.folio), 'Folio cliente': txt(body.folio),
          'Cliente': txt(body.cliente),
          'Pedido Proveedor': txt(body.pedido), 'Proveedor': txt(body.proveedor),
          'Producto': txt(body.producto), 'Productos': txt(body.producto),
          'Item': txt(body.producto), 'Material': txt(body.material),
          // De qué partida salió. Una venta puede llevar dos renglones del mismo
          // mueble y material que solo se distinguen por la medida —los dos
          // Escritorios Inca de la O15-26—, y sin esto la salida no dice a cuál
          // de las dos se le asignó la pieza.
          'Tela / Especificaciones': txt(body.especificaciones),
          'Especificaciones': txt(body.especificaciones),
          'Cantidad': cant,
          'Costo Unitario': num(body.costo),
          'Costo Total': Math.round(num(body.costo) * cant * 100) / 100,
          'Comentarios': 'Surtido desde bodega por ' + (sesion.u || '')
        });
        return res.status(200).json({ ok: true, hecho: 'stock', filas: 1,
          mensaje: cant + (cant === 1 ? ' pieza asignada' : ' piezas asignadas') +
                   ' a ' + txt(body.folio) + ' desde bodega' +
                   (txt(body.pedido) ? ', del pedido ' + txt(body.pedido) +
                     (txt(body.proveedor) ? ' · ' + txt(body.proveedor) : '') : '') +
                   '.', detalle: r });
      }

      // Pedido al proveedor para esa venta
      if (!txt(body.proveedor)) return res.status(400).json({ error: 'Falta el proveedor.' });

      // Antes de pedir, mirar si de verdad sobra o si todavía falta.
      //
      // El aviso existe porque se podía pedir lo mismo dos veces sin enterarse, y
      // un pedido duplicado es dinero comprometido con el proveedor. Pero avisaba
      // en cuanto hubiera UN pedido previo, aunque la venta siguiera debiendo
      // piezas: la AG10-26 lleva 10 Sillas Chara, 4 ya iban en el PCH-T-070 y al
      // mandar las otras 6 a otro pedido se trababa. Lo que importa es cuántas
      // faltan: vendidas − surtidas − ya pedidas. Mientras lo que se pide quepa
      // ahí, no hay nada que avisar.
      if (!body.forzar) {
        const [yaPed, yaVen, yaSal] = await Promise.all([
          leer('prov_pedidos'), leer('ventas_registro'), leer('prov_salidas')
        ]);
        const quiero = pieza(body.producto, body.material);
        const quieroEsp = norm(body.especificaciones);
        const esDelFolio = (v) => norm(v) === norm(body.folio);

        // Lo vendido: por folio y PRODUCTO, no por material. El diálogo surte un
        // componente a la vez —la madera, la tela— y cada uno necesita tantas
        // piezas como mueble se vendió.
        let vendidas = 0;
        if (yaVen.headers.length) {
          const vR = col(yaVen.headers, 'No. de Referencia', 'Folio');
          const vP = col(yaVen.headers, 'Producto', 'Productos');
          const vQ = col(yaVen.headers, 'Cantidad');
          const vE = col(yaVen.headers, 'Especificaciones');
          const vS = col(yaVen.headers, 'Status');
          if (vR && vP) yaVen.rows.forEach(r => {
            if (!esDelFolio(r[vR])) return;
            if (norm(r[vP]) !== norm(body.producto)) return;
            if (vS && /cancelad|anulad/i.test(txt(r[vS]))) return;
            if (quieroEsp && vE && norm(r[vE]) && norm(r[vE]) !== quieroEsp) return;
            vendidas += vQ ? num(r[vQ]) : 0;
          });
        }

        // Lo que ya salió de bodega para esa venta, por pieza
        let surtidas = 0;
        if (yaSal.headers.length) {
          const sF = col(yaSal.headers, 'Folio', 'Folio cliente');
          const sP = col(yaSal.headers, 'Producto', 'Productos', 'Item');
          const sM = col(yaSal.headers, 'Material');
          const sQ = col(yaSal.headers, 'Cantidad');
          if (sF && sP) yaSal.rows.forEach(r => {
            if (!esDelFolio(r[sF])) return;
            if (pieza(r[sP], sM ? r[sM] : '') !== quiero) return;
            surtidas += sQ ? num(r[sQ]) : 0;
          });
        }

        // Lo ya pedido al proveedor, con la MISMA regla que la lista: un pedido a
        // Stock o Bodega no está apartado para nadie, y un renglón con varios
        // folios no dice cuánto es de cada uno.
        let pedidas = 0; const donde = [];
        if (yaPed.headers.length) {
          const qF = col(yaPed.headers, 'Folio cliente', 'Folio');
          const qD = col(yaPed.headers, 'Destino');
          const qP = col(yaPed.headers, 'Productos', 'Producto', 'Item');
          const qM = col(yaPed.headers, 'Material');
          const qQ = col(yaPed.headers, 'Cantidad');
          const qNo = col(yaPed.headers, 'Pedido Proveedor', 'Pedido');
          const qE = col(yaPed.headers, 'Especificaciones', 'Tela / Especificaciones');
          if (qP) yaPed.rows.forEach(r => {
            if (pieza(r[qP], qM ? r[qM] : '') !== quiero) return;
            const dest = txt(qD ? r[qD] : '');
            if (dest && /^(stock|bodega|showroom|exhibici)/i.test(dest)) return;
            const fuente = txt(qF ? r[qF] : '') || dest;
            const folios = fuente.split(/[,;/]+/).map(txt).filter(Boolean);
            if (folios.length !== 1 || !esDelFolio(folios[0])) return;
            // Dos partidas del mismo mueble y material con medidas distintas no
            // son el mismo pedido: pedir la segunda no es duplicar la primera.
            if (quieroEsp && qE) {
              const esp = norm(r[qE]);
              if (esp && esp !== quieroEsp) return;
            }
            const n = qQ ? num(r[qQ]) : 0;
            if (!(n > 0)) return;
            pedidas += n;
            const p = txt(qNo ? r[qNo] : '') || '(sin número)';
            if (donde.indexOf(p) < 0) donde.push(p);
          });
        }

        // ¿El pedido al que lo va a colgar ya trae esa misma pieza, pero para
        // Stock? Entonces puede que no haga falta pedir nada: esas piezas ya
        // están encargadas y lo que toca es cambiarles el destino, no pedir
        // otras. Al PCH-T-053 —6 Sillas Chara en Nogal para Stock— Nico le iba a
        // agregar otras 6 para la AG10-26: TANDEM habría recibido un pedido de 12.
        const aQuePedido = norm(body.pedidoNuevo);
        if (aQuePedido && yaPed.headers.length) {
          const qNo2 = col(yaPed.headers, 'Pedido Proveedor', 'Pedido');
          const qP2 = col(yaPed.headers, 'Productos', 'Producto', 'Item');
          const qM2 = col(yaPed.headers, 'Material');
          const qQ2 = col(yaPed.headers, 'Cantidad');
          const qD2 = col(yaPed.headers, 'Destino');
          let enStock = 0;
          if (qNo2 && qP2) yaPed.rows.forEach(r => {
            if (norm(r[qNo2]) !== aQuePedido) return;
            if (pieza(r[qP2], qM2 ? r[qM2] : '') !== quiero) return;
            const dest = txt(qD2 ? r[qD2] : '');
            if (!/^(stock|bodega|showroom|exhibici)/i.test(dest)) return;
            enStock += qQ2 ? num(r[qQ2]) : 0;
          });
          if (enStock > 0) {
            const n = Math.round(enStock);
            return res.status(409).json({
              error: 'El ' + txt(body.pedidoNuevo) + ' ya trae ' + n +
                     (n === 1 ? ' pieza' : ' piezas') + ' de ' + txt(body.producto) +
                     ' · ' + txt(body.material) + ', pero para Stock.',
              pista: 'Si son ésas las que vas a usar, NO agregues más: ve a Pedidos a ' +
                     'proveedores, abre ese renglón y cámbiale el Folio cliente y el ' +
                     'Destino a ' + txt(body.folio) + '. Si de verdad son piezas aparte, ' +
                     'confirma y se agregan (el pedido quedaría con ' +
                     (n + cant) + ').',
              enStockEnEsePedido: n, sePuedeForzar: true
            });
          }
        }

        const falta = Math.round(vendidas - surtidas - pedidas);
        // Sin venta que leer no hay con qué comparar: ahí se avisa como antes.
        const sinReferencia = !(vendidas > 0);
        if ((sinReferencia && pedidas > 0) || (!sinReferencia && cant > falta)) {
          const yaP = Math.round(pedidas), sur = Math.round(surtidas);
          const sobra = sinReferencia ? 0 : cant - falta;
          return res.status(409).json({
            error: sinReferencia
              ? ('Esa pieza ya tiene ' + yaP + (yaP === 1 ? ' pieza pedida' : ' piezas pedidas') +
                 ' para ' + txt(body.folio) + ', y no encontré esa venta para comparar.')
              : ('Te pasas por ' + sobra + (sobra === 1 ? ' pieza' : ' piezas') + ': la ' +
                 txt(body.folio) + ' lleva ' + Math.round(vendidas) +
                 (Math.round(vendidas) === 1 ? ' pieza' : ' piezas') + ' de ésta' +
                 (sur ? ', ' + sur + ' ya surtida' + (sur === 1 ? '' : 's') : '') +
                 (yaP ? ' y ' + yaP + ' ya pedida' + (yaP === 1 ? '' : 's') : '') +
                 ', así que falta' + (falta === 1 ? '' : 'n') + ' ' + (falta > 0 ? falta : 0) + '.'),
            pista: (donde.length ? 'Lo pedido va en ' + donde.join(' y ') + '. ' : '') +
                   'Si de verdad hacen falta más, confirma para agregarlas; si no, ' +
                   'ciérralo y corrige la cantidad.',
            yaPedidas: yaP, surtidas: sur, vendidas: Math.round(vendidas),
            faltan: falta > 0 ? falta : 0, pedidos: donde, sePuedeForzar: true
          });
        }
      }

      const costo = num(body.costo);
      const rec = {
        'Fecha': hoyLargo(), 'Mes': new Date().getMonth() + 1, 'Año': new Date().getFullYear(),
        'Status': 'PENDIENTE COMPLETO',
        'Pedido Proveedor': txt(body.pedidoNuevo) || '',
        'Folio cliente': txt(body.folio), 'Cliente': txt(body.cliente),
        'Proveedor': txt(body.proveedor),
        'Productos': txt(body.producto), 'Producto': txt(body.producto),
        'Material': txt(body.material), 'Cantidad': cant,
        'Costo Unitario': costo,
        'Costo Total': Math.round(costo * cant * 100) / 100,
        'Costo Total + IVA': Math.round(costo * cant * 1.16 * 100) / 100,
        'Destino': txt(body.folio),
        'Especificaciones': txt(body.especificaciones)
      };
      const r2 = await core.addRecord('prov_pedidos', rec);
      return res.status(200).json({ ok: true, hecho: 'pedido', filas: 1,
        mensaje: 'Pedido a ' + txt(body.proveedor) + ' por ' + cant +
                 (cant === 1 ? ' pieza' : ' piezas') + ' para ' + txt(body.folio) + '.',
        detalle: r2 });
    }

    // ---- Lo pendiente ----
    const [ven, ped, ent, sal, provs, cat, cli] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('prov_entradas'),
      leer('prov_salidas'), leer('compras_proveedores'), leer('inventario'),
      leer('ventas_clientes')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer las ventas.' });

    const vF = col(ven.headers, 'No. de Referencia', 'Folio');
    const vC = col(ven.headers, 'Cliente');
    const vP = col(ven.headers, 'Producto', 'Productos');
    const vM = col(ven.headers, 'Material');
    const vME = col(ven.headers, 'Material Extra', 'Material extra', 'Material 2');
    const vQ = col(ven.headers, 'Cantidad');
    const vS = col(ven.headers, 'Status');
    const vE = col(ven.headers, 'Especificaciones');
    const vFe = col(ven.headers, 'Fecha del Cierre', 'Fecha');
    // Quien surte también despacha: necesita a quién le entrega y dónde
    const vTel = col(ven.headers, 'Telefono', 'Teléfono', 'Tel');
    const vDir = col(ven.headers, 'Direccion de envio', 'Dirección de envío',
                     'Dirección de envio', 'Direccion de envío', 'Dirección', 'Direccion');
    const vEnt = col(ven.headers, 'Fecha de entrega acordada', 'Fecha de Entrega Acordada',
                     'Fecha de entrega', 'Fecha Entrega');
    const vDes = col(ven.headers, 'Despacho');
    const vVen = col(ven.headers, 'Vendedor');
    if (!vF || !vP) return res.status(400).json({ error: 'La hoja de ventas no tiene folio o producto.' });

    // La ficha del cliente, para el que despacha.
    //
    // La venta trae teléfono y dirección porque se copian al capturarla, pero el
    // resto —correo, ciudad, C.P.— solo vive en la Lista de Clientes, y una
    // dirección vieja en la venta se corrige en la lista. Así que manda la lista
    // y la venta es el respaldo.
    const fichas = {};
    if (cli.headers.length) {
      const cNom = col(cli.headers, 'Nombre/Razón Social', 'Nombre', 'Cliente');
      const cTel = col(cli.headers, 'Teléfono', 'Telefono', 'Celular', 'Teléfono 1');
      const cDir = col(cli.headers, 'Dirección de envío', 'Direccion de envio',
                       'Dirección', 'Direccion', 'Domicilio');
      const cMail = col(cli.headers, 'Correo', 'Correo electrónico', 'Email', 'E-mail');
      const cCiu = col(cli.headers, 'Ciudad', 'Municipio');
      const cEdo = col(cli.headers, 'Estado');
      const cCP = col(cli.headers, 'C.P.', 'CP', 'Código Postal', 'Codigo Postal');
      const cCon = col(cli.headers, 'Contacto', 'Nombre Comercial');
      const cDesp = col(cli.headers, 'Despacho');
      const cNot = col(cli.headers, 'Comentarios', 'Notas', 'Observaciones');
      if (cNom) cli.rows.forEach(r => {
        const k = norm(r[cNom]);
        if (!k || fichas[k]) return;
        fichas[k] = {
          telefono: txt(cTel ? r[cTel] : ''), direccion: txt(cDir ? r[cDir] : ''),
          correo: txt(cMail ? r[cMail] : ''), ciudad: txt(cCiu ? r[cCiu] : ''),
          estado: txt(cEdo ? r[cEdo] : ''), cp: limpiaCP(cCP ? r[cCP] : ''),
          contacto: txt(cCon ? r[cCon] : ''), despacho: txt(cDesp ? r[cDesp] : ''),
          notas: txt(cNot ? r[cNot] : '')
        };
      });
    }

    // Lo que ya salió de bodega hacia cada venta.
    //
    // Se guarda dos veces: por folio+pieza (como siempre) y, si la salida dice
    // de qué medida es, también por folio+pieza+especificación. Hace falta
    // porque una venta puede llevar dos partidas del mismo mueble y material
    // que solo se distinguen por la medida —la O15-26 y sus dos Escritorios
    // Inca—: sin esto, surtir una daba por surtidas las dos.
    const surtido = {}, surtidoConEspec = {}, salSinEspec = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio', 'Folio cliente');
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      const sE = col(sal.headers, 'Tela / Especificaciones', 'Especificaciones',
                     'Tela/Especificaciones');
      if (sF && sP) sal.rows.forEach(r => {
        const k = norm(r[sF]) + '||' + pieza(r[sP], sM ? r[sM] : '');
        const q = sQ ? num(r[sQ]) : 0;
        surtido[k] = (surtido[k] || 0) + q;
        const e = norm(txt(sE ? r[sE] : ''));
        if (e) surtidoConEspec[k + '||' + e] = (surtidoConEspec[k + '||' + e] || 0) + q;
        else salSinEspec[k] = (salSinEspec[k] || 0) + q;
      });
    }

    // Lo que YA SE LE PIDIÓ AL PROVEEDOR para esa venta.
    //
    // Faltaba. La pantalla solo restaba lo que había salido de bodega, así que
    // un pedido hecho desde aquí no se veía por ningún lado: la pieza seguía
    // diciendo "Faltan 4" y quien surte lo volvía a pedir. Le pasó a Nico con el
    // Taburete de la O10-26: el PCH-T-074 quedó con 8 piezas para una venta de 4.
    // Igual que las salidas: por folio+pieza y, si el pedido dice la medida,
    // también por folio+pieza+medida. Los que no la dicen se guardan aparte
    // para repartirlos entre las partidas que compartan pieza.
    const pedidoPara = {}, pedidoEsp = {}, pedSinEspec = {};
    const meter = (mapa, k, n, info) => {
      const o = mapa[k] = mapa[k] || { cantidad: 0, pedidos: [] };
      o.cantidad += n;
      const ya = o.pedidos.find(x => norm(x.pedido) === norm(info.pedido) &&
                                     norm(x.proveedor) === norm(info.proveedor));
      if (ya) ya.cantidad += n;
      else o.pedidos.push(Object.assign({ cantidad: n }, info));
    };
    const tocaPedido = (folio_, kc, n, info, espec) => {
      const k = norm(folio_) + '||' + kc;
      meter(pedidoPara, k, n, info);
      const e = norm(espec);
      if (e) meter(pedidoEsp, k + '||' + e, n, info);
      else meter(pedSinEspec, k, n, info);
    };
    if (ped.headers.length) {
      const qF = col(ped.headers, 'Folio cliente', 'Folio');
      const qD = col(ped.headers, 'Destino');
      const qP = col(ped.headers, 'Productos', 'Producto', 'Item');
      const qM = col(ped.headers, 'Material');
      const qQ = col(ped.headers, 'Cantidad');
      const qNo = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const qPr = col(ped.headers, 'Proveedor');
      const qSt = col(ped.headers, 'Status');
      const qFe = col(ped.headers, 'Fecha');
      const qEnt = col(ped.headers, 'Fecha Estimada de Entrega');
      const qEsp = col(ped.headers, 'Especificaciones', 'Tela / Especificaciones');
      if (qP) ped.rows.forEach(r => {
        const prod = txt(r[qP]);
        if (!prod || esSoloSaldo(prod)) return;
        const n = qQ ? num(r[qQ]) : 0;
        if (!(n > 0)) return;
        // Un pedido a Stock o a Bodega entra al inventario: NO está apartado
        // para una venta. Ahí "Folio cliente" es una nota de por qué se pidió
        // —"lo pedí porque la O1-26 lo llevaba"— y las piezas se reparten luego
        // desde bodega. Contarlo como apartado hacía que la O1-26 dijera "15 de
        // más" por un pedido de 30 aceros que ya se habían surtido.
        const dest = txt(qD ? r[qD] : '');
        if (dest && /^(stock|bodega|showroom|exhibici)/i.test(dest)) return;
        const fuente = txt(qF ? r[qF] : '') || dest;
        if (!fuente) return;
        // Varios folios en un mismo renglón —"O1-26, S27-26"— no dicen cuánto
        // es de cada uno. Repartirlo por igual inventaba el número, así que no
        // se aparta nada: esas piezas se ven cuando llegan a bodega.
        const folios = fuente.split(/[,;/]+/).map(txt).filter(Boolean);
        if (folios.length !== 1) return;
        const info = {
          pedido: txt(qNo ? r[qNo] : ''), proveedor: txt(qPr ? r[qPr] : ''),
          status: txt(qSt ? r[qSt] : ''), fecha: fechaTexto(qFe ? r[qFe] : ''),
          llega: fechaTexto(qEnt ? r[qEnt] : '')
        };
        tocaPedido(folios[0], pieza(prod, qM ? r[qM] : ''), n, info,
                   txt(qEsp ? r[qEsp] : ''));
      });
    }

    // Lo que hay en bodega: entradas menos salidas, por pieza
    const bodega = {};
    if (ent.headers.length) {
      const eI = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eQ = col(ent.headers, 'Cantidad');
      if (eI) ent.rows.forEach(r => {
        const k = pieza(r[eI], eM ? r[eM] : '');
        bodega[k] = (bodega[k] || 0) + (eQ ? num(r[eQ]) : 0);
      });
    }
    if (sal.headers.length) {
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      if (sP) sal.rows.forEach(r => {
        const k = pieza(r[sP], sM ? r[sM] : '');
        bodega[k] = (bodega[k] || 0) - (sQ ? num(r[sQ]) : 0);
      });
    }

    // Lo que hay en bodega, pedido por pedido.
    //
    // Una pieza en bodega no es anónima: llegó en un pedido concreto, de un
    // proveedor concreto y con su costo. Al sacarla hay que decir de cuál sale,
    // o el estado de cuenta del proveedor y la trazabilidad quedan cojos.
    const lotes = {};
    const tocaLote = (pieza_, pedido, n) => {
      if (!pedido) return;
      const l = lotes[pieza_] = lotes[pieza_] || {};
      const k = norm(pedido);
      const o = l[k] = l[k] || { pedido: txt(pedido), cantidad: 0, proveedor: '', costo: 0, fecha: '' };
      o.cantidad += n;
    };
    if (ent.headers.length) {
      const eP = col(ent.headers, 'Pedido Proveedor', 'Pedido');
      const eI = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM = col(ent.headers, 'Material');
      const eQ = col(ent.headers, 'Cantidad');
      const eF = col(ent.headers, 'Fecha');
      if (eP && eI) ent.rows.forEach(r => {
        const k = pieza(r[eI], eM ? r[eM] : '');
        tocaLote(k, r[eP], eQ ? num(r[eQ]) : 0);
        const o = (lotes[k] || {})[norm(r[eP])];
        if (o && eF && !o.fecha) o.fecha = txt(r[eF]);
      });
    }
    if (sal.headers.length) {
      const sPP = col(sal.headers, 'Pedido Proveedor', 'Pedido');
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      if (sPP && sP) sal.rows.forEach(r => {
        tocaLote(pieza(r[sP], sM ? r[sM] : ''), r[sPP], -(sQ ? num(r[sQ]) : 0));
      });
    }
    // El proveedor y el costo de cada pedido, para que la salida los herede.
    //
    // OJO: el costo es del RENGLÓN, no del pedido. Un pedido trae varios
    // productos —el S-JUL-06-26 de Sergio trae Mesa Cuco Chica y Grande a $2,250
    // y Percheros a $485— y antes se le pegaba a todas las piezas del pedido el
    // costo del primer renglón que apareciera. El Perchero salía en $2,250.
    if (ped.headers.length) {
      const pNo = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const pIt2 = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pMa2 = col(ped.headers, 'Material');
      const pPr2 = col(ped.headers, 'Proveedor');
      const pCU2 = col(ped.headers, 'Costo Unitario');
      if (pNo && pIt2) ped.rows.forEach(r => {
        const k = norm(r[pNo]);
        if (!k || esSoloSaldo(r[pIt2])) return;
        // Solo la pieza de ESTE renglón
        const o = (lotes[pieza(r[pIt2], pMa2 ? r[pMa2] : '')] || {})[k];
        if (!o) return;
        if (!o.proveedor && pPr2) o.proveedor = txt(r[pPr2]);
        if (!o.costo && pCU2) o.costo = num(r[pCU2]);
      });
    }
    // El último costo conocido de una pieza, venga de donde venga. Al sacar de
    // bodega hay que escribir el costo, y hasta ahora si el lote no lo traía
    // había que salirse de la pantalla a buscarlo en el pedido.
    const costoConocido = (k) => {
      const q = quienLoHace[k] || {};
      const c1 = Object.keys(q).map(x => q[x].costo).filter(Boolean)[0];
      if (c1) return c1;
      return costoCatalogo[k] || 0;
    };

    // Lo disponible de una pieza, lote por lote, lo más viejo primero
    const lotesDe = (k) => Object.keys(lotes[k] || {})
      .map(x => lotes[k][x])
      .filter(x => Math.round(x.cantidad) > 0)
      .map(x => ({ pedido: x.pedido, proveedor: x.proveedor,
                   costo: x.costo || costoConocido(k),
                   costoDelPedido: !!x.costo,
                   fecha: fechaTexto(x.fecha), disponibles: Math.round(x.cantidad),
                   _o: fechaNum(x.fecha) }))
      .sort((a, b) => (a._o || 9e15) - (b._o || 9e15))
      .map(x => { delete x._o; return x; });

    // Lo que se pidió para STOCK y todavía no llega.
    //
    // Son piezas ya encargadas al proveedor que no están en bodega —porque no
    // han llegado— y que no son de nadie. Se le pueden apartar a una venta sin
    // pedir nada nuevo. Es lo que le faltaba a Nico: el PCH-T-053 traía 6 Sillas
    // Chara en Nogal para Stock y la pantalla solo le ofrecía pedir otras seis.
    const recibido = {};
    if (ent.headers.length) {
      const eP2 = col(ent.headers, 'Pedido Proveedor', 'Pedido');
      const eI2 = col(ent.headers, 'Item', 'Productos', 'Producto');
      const eM2 = col(ent.headers, 'Material');
      const eQ2 = col(ent.headers, 'Cantidad');
      if (eP2 && eI2) ent.rows.forEach(r => {
        const k = norm(r[eP2]) + '||' + pieza(r[eI2], eM2 ? r[eM2] : '');
        recibido[k] = (recibido[k] || 0) + (eQ2 ? num(r[eQ2]) : 0);
      });
    }
    const stockEnCamino = {};
    if (ped.headers.length) {
      const pN = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pM = col(ped.headers, 'Material');
      const pQ = col(ped.headers, 'Cantidad');
      const pD = col(ped.headers, 'Destino');
      const pPr = col(ped.headers, 'Proveedor');
      const pCU = col(ped.headers, 'Costo Unitario');
      const pSt = col(ped.headers, 'Status');
      const pFe = col(ped.headers, 'Fecha');
      const pEnt = col(ped.headers, 'Fecha Estimada de Entrega');
      const yaLlego = Object.assign({}, recibido);
      if (pI) ped.rows.forEach(r => {
        const prod = txt(r[pI]);
        if (!prod || esSoloSaldo(prod)) return;
        const dest = txt(pD ? r[pD] : '');
        if (!/^(stock|bodega|showroom|exhibici)/i.test(dest)) return;
        const n = pQ ? num(r[pQ]) : 0;
        if (!(n > 0)) return;
        const kp = pieza(prod, pM ? r[pM] : '');
        // Lo que de ese pedido y esa pieza ya entró a bodega deja de estar en
        // camino: ahí ya lo ofrece "De bodega", con su lote.
        const kk = norm(pN ? r[pN] : '') + '||' + kp;
        const llegado = Math.min(n, Math.max(0, yaLlego[kk] || 0));
        yaLlego[kk] = Math.max(0, (yaLlego[kk] || 0) - llegado);
        const libres = Math.round(n - llegado);
        if (libres <= 0) return;
        (stockEnCamino[kp] = stockEnCamino[kp] || []).push({
          pedido: txt(pN ? r[pN] : '') || '(sin número)',
          proveedor: txt(pPr ? r[pPr] : ''),
          fila: r.__fila,
          enElRenglon: Math.round(n),
          disponibles: libres,
          costo: pCU ? num(r[pCU]) : 0,
          status: txt(pSt ? r[pSt] : ''),
          fecha: fechaTexto(pFe ? r[pFe] : ''),
          llega: fechaTexto(pEnt ? r[pEnt] : ''),
          _o: fechaNum(pFe ? r[pFe] : '')
        });
      });
      // Lo más viejo primero: es lo que lleva más tiempo esperando dueño.
      Object.keys(stockEnCamino).forEach(k => {
        stockEnCamino[k].sort((a, b) => (a._o || 9e15) - (b._o || 9e15));
        stockEnCamino[k].forEach(x => { delete x._o; });
      });
    }

    // Quién ha hecho cada pieza, con su último costo. Es mejor lista que la de
    // todos los proveedores: el que ya la hizo sabe cómo se hace.
    const quienLoHace = {};
    if (ped.headers.length) {
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pM = col(ped.headers, 'Material');
      const pPr = col(ped.headers, 'Proveedor');
      const pCU = col(ped.headers, 'Costo Unitario');
      const pFe = col(ped.headers, 'Fecha');
      if (pI && pPr) ped.rows.forEach(r => {
        const prod = txt(r[pI]);
        if (!prod || esSoloSaldo(prod)) return;
        const prov = txt(r[pPr]);
        if (!prov) return;
        const k = pieza(prod, pM ? r[pM] : '');
        quienLoHace[k] = quienLoHace[k] || {};
        const a = quienLoHace[k][prov] = quienLoHace[k][prov] || { proveedor: prov, veces: 0, costo: 0 };
        a.veces++;
        const c = pCU ? num(r[pCU]) : 0;
        if (c) a.costo = c;                       // el último costo conocido
        if (pFe) a.ultimaVez = txt(r[pFe]);
      });
    }
    // Qué materiales alguien ha surtido alguna vez, como material por su cuenta.
    //
    // Es lo que distingue un segundo componente de un acabado que viene con la
    // pieza: la Piel, el Espejo, la Tapicería, el Acero y el Mármol aparecen como
    // Material de algún pedido, con su proveedor; el Kraft y la Piola, nunca.
    const seHaPedido = {};
    if (ped.headers.length) {
      const mM = col(ped.headers, 'Material');
      const mP = col(ped.headers, 'Productos', 'Producto', 'Item');
      if (mM) ped.rows.forEach(r => {
        if (mP && esSoloSaldo(r[mP])) return;
        const m = norm(r[mM]);
        if (m) seHaPedido[m] = (seHaPedido[m] || 0) + 1;
      });
    }
    // Y lo mismo con lo que ha entrado a bodega: un material puede llegar sin
    // que su pedido esté capturado.
    if (ent.headers.length) {
      const nM = col(ent.headers, 'Material');
      if (nM) ent.rows.forEach(r => {
        const m = norm(r[nM]);
        if (m) seHaPedido[m] = (seHaPedido[m] || 0) + 1;
      });
    }

    // Los días de entrega que cada proveedor declara
    const dias = {};
    if (provs.headers.length) {
      // OJO: manda el NOMBRE COMERCIAL, no la razón social. Es el que el equipo
      // escribe en Pedidos a Proveedores, así que es el que tiene que salir aquí.
      // Leyendo la razón social, el renglón de MARTIN MONROY —cuya celda trae dos
      // nombres separados por un salto de línea— aparecía como un proveedor más,
      // "MARTIN MONROY MONROY GENARO MARTINEZ MONROY", que no existe.
      const nP = col(provs.headers, 'Proveedor', 'Nombre Comercial',
                     'Nombre/Razón Social', 'Razón Social');
      const nD = col(provs.headers, 'Días de Entrega', 'Dias de Entrega', 'Días de entrega');
      if (nP && nD) provs.rows.forEach(r => {
        const d = txt(r[nD]);
        if (d) dias[norm(r[nP])] = d;
      });
    }

    // Para poder elegir: todos los proveedores, no solo los que ya hicieron la
    // pieza. El que la hizo antes sale primero porque sabe cómo se hace, pero a
    // veces hay que estrenar proveedor.
    const proveedoresTodos = [];
    if (provs.headers.length) {
      // OJO: manda el NOMBRE COMERCIAL, no la razón social. Es el que el equipo
      // escribe en Pedidos a Proveedores, así que es el que tiene que salir aquí.
      // Leyendo la razón social, el renglón de MARTIN MONROY —cuya celda trae dos
      // nombres separados por un salto de línea— aparecía como un proveedor más,
      // "MARTIN MONROY MONROY GENARO MARTINEZ MONROY", que no existe.
      const nP = col(provs.headers, 'Proveedor', 'Nombre Comercial',
                     'Nombre/Razón Social', 'Razón Social');
      if (nP) {
        const vistos = {};
        provs.rows.forEach(r => {
          const n = txt(r[nP]);
          if (!n || vistos[norm(n)]) return;
          vistos[norm(n)] = 1;
          proveedoresTodos.push({ proveedor: n, dias: dias[norm(n)] || '' });
        });
      }
    }
    // Y los que aparecen en pedidos pero no están en la Lista de Proveedores: el
    // desplegable nunca debe quedarse corto por una lista sin actualizar.
    if (ped.headers.length) {
      const pPr4 = col(ped.headers, 'Proveedor');
      if (pPr4) ped.rows.forEach(r => {
        const n = txt(r[pPr4]);
        if (!n) return;
        if (proveedoresTodos.some(x => norm(x.proveedor) === norm(n))) return;
        proveedoresTodos.push({ proveedor: n, dias: dias[norm(n)] || '' });
      });
    }
    proveedoresTodos.sort((a, b) => norm(a.proveedor) < norm(b.proveedor) ? -1 : 1);

    // Los pedidos abiertos de cada proveedor, para poder colgar la pieza de uno
    // que ya existe en vez de abrir otro. Un pedido por pieza multiplica los
    // números de pedido y luego nadie cuadra el estado de cuenta.
    const pedidosAbiertos = {};
    let pedidoSugerido = '';
    if (ped.headers.length) {
      const pNo = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const pPr3 = col(ped.headers, 'Proveedor');
      const pSt3 = col(ped.headers, 'Status');
      const pFe3 = col(ped.headers, 'Fecha');
      const pQ3 = col(ped.headers, 'Cantidad');
      const pIt3 = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pMa3 = col(ped.headers, 'Material');
      if (pNo && pPr3) {
        const acum = {};
        ped.rows.forEach(r => {
          const no = txt(r[pNo]);
          const pr = txt(r[pPr3]);
          if (!no || !pr) return;
          if (/entregad|cancelad/i.test(txt(pSt3 ? r[pSt3] : ''))) return;
          const k = norm(pr) + '||' + norm(no);
          const o = acum[k] = acum[k] ||
            { pedido: no, proveedor: pr, piezas: 0, fecha: txt(pFe3 ? r[pFe3] : ''),
              status: txt(pSt3 ? r[pSt3] : ''), piezasDentro: [] };
          o.piezas += pQ3 ? num(r[pQ3]) : 0;
          // Qué lleva dentro: sin esto el panel preseleccionaba el primer pedido
          // abierto del proveedor aunque fuera de otro mueble, y el Sillón
          // Alondra se iba a colgar del pedido del Taburete.
          if (pIt3) {
            const kp = pieza(r[pIt3], pMa3 ? r[pMa3] : '');
            if (kp !== '|' && o.piezasDentro.indexOf(kp) < 0) o.piezasDentro.push(kp);
          }
        });
        Object.keys(acum).forEach(k => {
          const o = acum[k];
          const lista = pedidosAbiertos[o.proveedor] = pedidosAbiertos[o.proveedor] || [];
          lista.push({ pedido: o.pedido, piezas: Math.round(o.piezas),
                       fecha: fechaTexto(o.fecha), status: o.status,
                       piezasDentro: o.piezasDentro });
        });
        Object.keys(pedidosAbiertos).forEach(k => {
          pedidosAbiertos[k].sort((a, b) => fechaNum(b.fecha) - fechaNum(a.fecha));
        });

        // El siguiente número, deducido de los que ya hay: se respeta el prefijo
        // más usado y se le suma uno al mayor. Es una sugerencia, se puede pisar.
        const prefijos = {};
        ped.rows.forEach(r => {
          const m = txt(r[pNo]).match(/^(.*?)(\d+)\s*$/);
          if (!m) return;
          const pre = m[1];
          const o = prefijos[pre] = prefijos[pre] || { pre, veces: 0, max: 0, largo: m[2].length };
          o.veces++;
          const n = parseInt(m[2], 10);
          if (n > o.max) { o.max = n; o.largo = m[2].length; }
        });
        const mejor = Object.keys(prefijos).map(k => prefijos[k])
          .sort((a, b) => b.veces - a.veces)[0];
        if (mejor) {
          pedidoSugerido = mejor.pre + String(mejor.max + 1).padStart(mejor.largo, '0');
        }
      }
    }

    // De qué está hecho cada mueble.
    //
    // Un mueble puede llevar DOS componentes: la madera y la tela, o la madera y
    // el mármol. En el catálogo son Material y Material Extra, y cada uno lo hace
    // un proveedor distinto, en su propio pedido. Mirando solo el Material, la
    // pantalla decía que la pieza estaba surtida cuando faltaba la mitad.
    // Qué ofrece el catálogo para cada producto + material.
    //
    // El Material Extra significa dos cosas distintas según el producto, y
    // confundirlas es lo que hacía que un Set de 3 Velas Fénix saliera como tres
    // velas grandes:
    //
    //   · Si el catálogo trae UNA sola opción, es un SEGUNDO COMPONENTE: el
    //     sillón es madera Y tela, y cada una la hace otro proveedor.
    //   · Si trae VARIAS, son VARIANTES del mismo producto: la vela es grande
    //     O mediana O chica. Cuál de ellas la tiene que decir la venta.
    //
    // Antes, al no decirlo la venta, se tomaba la primera del catálogo. Eso es
    // inventar: ahora se dice que falta, con las opciones que hay.
    const extrasDe = {}, costoCatalogo = {};
    if (cat.headers.length) {
      const kP = col(cat.headers, 'Productos', 'Producto');
      const kM = col(cat.headers, 'Material');
      const kE = col(cat.headers, 'Material Extra');
      if (kP) cat.rows.forEach(r => {
        const m = txt(kM ? r[kM] : '');
        const k = pieza(r[kP], m);
        const extra = txt(kE ? r[kE] : '');
        if (!extrasDe[k]) extrasDe[k] = [];
        const kC = col(cat.headers, 'Costos Total', 'Costo Unitario', 'Costo');
        if (kC && !costoCatalogo[k]) costoCatalogo[k] = num(r[kC]);
        if (!esMaterial(extra)) return;
        if (norm(extra) === norm(m)) return;
        if (!extrasDe[k].some(x => norm(x) === norm(extra))) extrasDe[k].push(extra);
      });
    }

    // La demanda se agrupa igual que lo surtido.
    //
    // Esto era un hoyo serio: lo que sale de bodega se guarda por folio +
    // producto + material, sin número de renglón. Una venta con tres renglones
    // idénticos —las tres Velas Fénix capturadas como "grande"— se comparaba
    // renglón por renglón contra ese total, así que UNA salida de 1 pieza dejaba
    // los tres renglones en cero y la venta entera desaparecía de la lista. Por
    // eso no salían las ventas de octubre. Agrupando y sumando, tres renglones
    // de 1 son 3 por surtir, se saca 1 y quedan 2.
    const grupos = {};
    // Lo que se queda fuera de la lista, dicho por su nombre. Un folio que no
    // aparece y no se sabe por qué manda a buscarlo a la hoja; así se ve aquí.
    const fuera = {};
    const dejarFuera = (folio, porque) => {
      const k = txt(folio) || '(sin folio)';
      if (!fuera[k]) fuera[k] = { folio: k, porque: [] };
      if (fuera[k].porque.indexOf(porque) < 0) fuera[k].porque.push(porque);
    };
    ven.rows.forEach((r, i) => {
      const status = txt(vS ? r[vS] : '');
      const folio = txt(r[vF]);
      const prod = txt(r[vP]);
      if (/cancelad/i.test(status)) { dejarFuera(folio, 'cancelada'); return; }
      // Una venta ENTREGADA ya no se surte: el mueble está en casa del cliente.
      //
      // El panel solo dejaba fuera las canceladas, así que a Nico le pedía
      // surtir medio año de ventas entregadas desde enero —cientos de piezas—
      // nada más porque su salida de inventario nunca se capturó. Esas salidas
      // faltan, sí, pero eso es un corte de inventario, no trabajo por hacer.
      if (/entregad/i.test(status)) { dejarFuera(folio, 'ya entregada'); return; }
      if (!folio && !prod) return;                 // renglón en blanco, no cuenta
      if (!folio) { dejarFuera('', 'el renglón no trae folio'); return; }
      if (!prod) { dejarFuera(folio, 'hay un renglón sin producto'); return; }
      const mat = txt(vM ? r[vM] : '');
      let extra = txt(vME ? r[vME] : '');
      // Rescate del segundo material escrito en Especificaciones.
      //
      // La hoja de COTIZACIONES no tuvo columna "Material Extra" hasta el 22 de
      // octubre, así que durante meses Ursula lo escribió donde sí cabía: en
      // Especificaciones ("VELA CHICA", "Piel Dollaro Negro"). Al pasar a venta
      // la columna llegaba vacía y el panel pedía un dato que ya estaba ahí.
      //
      // No se adivina nada: tiene que estar escrita UNA de las variantes que el
      // catálogo reconoce para ese producto y esa madera. Si aparecen dos, o
      // ninguna, se sigue pidiendo que la venta lo diga.
      let extraDeEsp = false;
      if (!esMaterial(extra)) {
        const esp = norm(txt(vE ? r[vE] : ''));
        if (esp) {
          const ops = extrasDe[pieza(prod, mat)] || [];
          const hits = ops.filter(o => norm(o).length >= 3 && esp.indexOf(norm(o)) >= 0);
          if (hits.length === 1) { extra = hits[0]; extraDeEsp = true; }
        }
      }
      const vendidas = vQ ? num(r[vQ]) : 0;
      if (vendidas <= 0) { dejarFuera(folio, 'hay un renglón sin cantidad'); return; }
      // Las especificaciones separan partidas.
      //
      // La O15-26 lleva dos Escritorios Inca en Rosamorada de 130x70 y uno de
      // 143x60: mismo producto, mismo material, y costaban $43,700 y $44,900.
      // Agrupando solo por producto y material se volvían "3 escritorios" y no
      // había forma de pedirlos por separado ni de cargarles su costo. Si dos
      // renglones dicen cosas distintas, son dos partidas distintas.
      const espec = txt(vE ? r[vE] : '');
      const gk = norm(folio) + '|' + norm(prod) + '|' + norm(mat) + '|' + norm(extra) +
                 '|' + norm(espec);
      const g = grupos[gk] = grupos[gk] || {
        folio, cliente: txt(vC ? r[vC] : ''),
        fecha: fechaTexto(vFe ? r[vFe] : ''),
        _orden: fechaNum(vFe ? r[vFe] : ''), _fila: i,
        _ficha: (function () {
          const f = fichas[norm(txt(vC ? r[vC] : ''))] || {};
          // La dirección de LA VENTA manda sobre la del cliente: el mueble se va
          // a donde diga la venta —la obra, otra casa, una bodega— y la ficha del
          // cliente es nada más el respaldo cuando la venta no dice nada.
          const dirVenta = txt(vDir ? r[vDir] : '');
          const telVenta = txt(vTel ? r[vTel] : '');
          return {
            telefono: telVenta || f.telefono || '',
            direccion: dirVenta || f.direccion || '',
            // Para que quien entrega vea que no es la de siempre
            especial: !!(dirVenta && f.direccion && norm(dirVenta) !== norm(f.direccion)),
            direccionCliente: f.direccion || '',
            correo: f.correo || '', ciudad: f.ciudad || '', estado: f.estado || '',
            cp: f.cp || '', contacto: f.contacto || '',
            despacho: f.despacho || txt(vDes ? r[vDes] : ''),
            notas: f.notas || '',
            entrega: fechaTexto(vEnt ? r[vEnt] : ''),
            vendedor: txt(vVen ? r[vVen] : '')
          };
        })(),
        producto: prod, material: mat, materialExtra: extra,
        extraDeEsp: extraDeEsp,
        especificaciones: txt(vE ? r[vE] : ''),
        vendidas: 0, renglones: 0
      };
      g.vendidas += vendidas;
      g.renglones++;
      if (!g.especificaciones) g.especificaciones = txt(vE ? r[vE] : '');
      if (i > g._fila) g._fila = i;
      const o = fechaNum(vFe ? r[vFe] : '');
      if (o > g._orden) { g._orden = o; g.fecha = fechaTexto(vFe ? r[vFe] : ''); }
    });

    // Dos partidas de la misma pieza en una misma venta
    //
    // La O15-26 lleva dos renglones de Escritorio Inca en Rosamorada que solo se
    // distinguen por la medida. Lo surtido y lo pedido se contaban por
    // folio+pieza, así que surtir una daba por surtidas las dos y pedir la
    // segunda parecía un pedido duplicado. Cuando la misma pieza se repite en la
    // venta, se cuenta lo que diga la medida; lo que no la diga —todo lo
    // capturado antes de hoy— se reparte entre las partidas en el orden de la
    // hoja, que es lo más parecido a cómo se surtió.
    const partidasPorPieza = {};
    const claveSinMedida = (g2) =>
      norm(g2.folio) + '|' + norm(g2.producto) + '|' + norm(g2.material) +
      '|' + norm(g2.materialExtra);
    Object.keys(grupos).forEach(gk2 => {
      const c2 = claveSinMedida(grupos[gk2]);
      partidasPorPieza[c2] = (partidasPorPieza[c2] || 0) + 1;
    });
    const tomaSalidas = (k, falta) => {
      const hay = salSinEspec[k] || 0;
      const toma = Math.max(0, Math.min(hay, falta));
      salSinEspec[k] = hay - toma;
      return toma;
    };
    const tomaPedidos = (k, falta) => {
      const out = { cantidad: 0, pedidos: [] };
      const o = pedSinEspec[k];
      if (!o) return out;
      o.pedidos.forEach(p => {
        const toma = Math.max(0, Math.min(p.cantidad, falta - out.cantidad));
        if (toma <= 0) return;
        p.cantidad -= toma;
        out.cantidad += toma;
        out.pedidos.push(Object.assign({}, p, { cantidad: toma }));
      });
      o.cantidad -= out.cantidad;
      o.pedidos = o.pedidos.filter(p => p.cantidad > 0);
      return out;
    };

    const filas = Object.keys(grupos).map(gk => {
      const g = grupos[gk];
      const prod = g.producto, mat = g.material, extra = g.materialExtra;
      const variasPartidas = (partidasPorPieza[claveSinMedida(g)] || 1) > 1;
      const medida = norm(g.especificaciones);

      // Manda lo que diga la VENTA, no el catálogo.
      //
      // Un "Set de 3 Velas Fénix" son tres renglones que solo se distinguen por
      // el Material Extra —grande, mediana, chica—. Como las tres variantes del
      // catálogo comparten producto y material, quedarse con la primera volvía
      // las tres "vela grande". El catálogo solo entra cuando la venta no dijo
      // nada, que es donde sigue sirviendo: el mueble de madera y tela.
      // ¿El material extra se consigue aparte, o viene con la pieza?
      //
      // En el catálogo, Material Extra son las dos cosas. La Piel de la Silla
      // Nara la hace TENERIA AZTECA mientras AYDIA hace la madera: son dos
      // pedidos de verdad. El Kraft de la "Banca Coa Tejida/Kraft" no: TANDEM la
      // entrega tejida y cobra $12,705, que es el costo completo del catálogo.
      //
      // El panel NO lo adivina. Esconder un material que sí hay que comprar es
      // peor que mostrar una línea de más, así que se muestran los dos y se
      // marca el sospechoso: el que el nombre del producto ya dice y que nadie
      // ha surtido nunca por separado. Quien surte decide, y si viene con la
      // pieza se arregla de raíz poniendo NA en el catálogo —como ya está la
      // "Banca Coa Tejida/ Kraft 120"—.
      const enElNombre = (c) => {
        const t = norm(c);
        return t.length >= 3 && norm(prod).indexOf(t) >= 0;
      };
      const vieneConLaPieza = (c) => enElNombre(c) && !seHaPedido[norm(c)];
      const comps = [];
      if (esMaterial(mat)) comps.push(mat);
      if (esMaterial(extra) && norm(extra) !== norm(mat)) comps.push(extra);

      // Si la venta no dijo el extra, el catálogo decide qué significa:
      // una sola opción es el segundo componente; varias son variantes y falta
      // que la venta diga cuál.
      const opciones = extrasDe[pieza(prod, mat)] || [];
      let faltaVariante = null;
      if (!esMaterial(extra)) {
        if (opciones.length === 1) {
          if (!comps.some(x => norm(x) === norm(opciones[0]))) comps.push(opciones[0]);
        } else if (opciones.length > 1) {
          faltaVariante = opciones.slice(0, 8);
        }
      }
      if (!comps.length) comps.push(mat || prod);

      const partes = comps.map(c => {
        const kc = pieza(prod, c);
        const k = norm(g.folio) + '||' + kc;
        // Pedido al proveedor para esta venta: no está en la mano, pero ya no
        // hay nada que hacer con ello hasta que llegue.
        let ya2, q;
        if (variasPartidas) {
          ya2 = surtidoConEspec[k + '||' + medida] || 0;
          ya2 += tomaSalidas(k, g.vendidas - ya2);
          const conMedida = pedidoEsp[k + '||' + medida] || { cantidad: 0, pedidos: [] };
          const resto = tomaPedidos(k, g.vendidas - ya2 - conMedida.cantidad);
          q = { cantidad: conMedida.cantidad + resto.cantidad,
                pedidos: conMedida.pedidos.concat(resto.pedidos) };
        } else {
          ya2 = surtido[k] || 0;
          q = pedidoPara[k] || { cantidad: 0, pedidos: [] };
        }
        const pedidas = Math.round(q.cantidad);
        const falta2 = Math.round(g.vendidas - ya2 - pedidas);
        const hay2 = Math.max(0, Math.round(bodega[kc] || 0));
        const lista2 = Object.keys(quienLoHace[kc] || {})
          .map(x => Object.assign({}, quienLoHace[kc][x], { dias: dias[norm(x)] || '' }))
          .sort((a, b) => b.veces - a.veces);
        return {
          componente: c, surtidas: ya2, falta: falta2 > 0 ? falta2 : 0,
          // Sospechoso de venir con la pieza: el nombre ya lo dice y nadie lo
          // ha surtido nunca por su cuenta. No se esconde, se marca.
          quizaVieneIncluido: comps.length > 1 && vieneConLaPieza(c),
          // Lo ya encargado, con su pedido y su proveedor, para no pedirlo dos veces
          pedidas: pedidas,
          pedidos: q.pedidos.map(x => Object.assign({}, x,
            { cantidad: Math.round(x.cantidad) })),
          sobran: falta2 < 0 ? -falta2 : 0,
          enBodega: hay2, puedeDeStock: Math.min(hay2, falta2 > 0 ? falta2 : 0),
          // De qué pedido puede salir: la bodega no es un montón anónimo
          lotes: lotesDe(kc),
          // Pedido para Stock y todavía sin llegar: se puede apartar a esta
          // venta sin encargar nada nuevo.
          enCaminoStock: (stockEnCamino[kc] || []).slice(0, 8),
          proveedores: lista2.slice(0, 6),
          // El costo que se propone al pedir: lo último que cobró quien la hizo,
          // y si nadie la ha hecho, el del catálogo. Un producto de línea tiene
          // costo en el catálogo aunque sea la primera vez que se le pide a ese
          // proveedor, y el campo se quedaba vacío.
          costoSugerido: costoConocido(kc),
          costoCatalogo: costoCatalogo[kc] || 0,
          // Lo ya conseguido se queda a la vista en vez de desaparecer
          listo: falta2 <= 0
        };
      });

      return Object.assign({}, g, {
        variosComponentes: comps.length > 1,
        // La venta lleva otra partida del mismo mueble y material: lo único que
        // las distingue es lo que dicen las especificaciones, así que hay que
        // verlo en la tarjeta o las dos se ven iguales.
        mismaPieza: variasPartidas,
        // Qué variante es, cuando la venta no lo dice y el catálogo ofrece varias
        faltaVariante: faltaVariante,
        completa: !partes.some(x => x.falta > 0),
        // Pedida al proveedor pero todavía sin llegar: quien surte ya no tiene
        // nada que hacer, pero tiene que poder verla y saber cuándo llega.
        enCamino: partes.some(x => x.pedidas > 0 && x.surtidas < g.vendidas),
        // Se pidió más de lo vendido. Casi siempre es un pedido duplicado.
        sobran: partes.some(x => x.sobran > 0),
        partes
      });
    });

    // Una venta se va de la lista cuando ya no le falta nada. Mientras le falte
    // algo se queda entera, con lo conseguido marcado.
    const porFolio = {};
    filas.forEach(p => {
      const g = porFolio[p.folio] = porFolio[p.folio] ||
        { folio: p.folio, cliente: p.cliente, fecha: p.fecha,
          ficha: p._ficha || {},
          _orden: p._orden, _fila: p._fila, piezas: [] };
      if (p._orden > g._orden) { g._orden = p._orden; g.fecha = p.fecha; }
      if (p._fila > g._fila) g._fila = p._fila;
      g.piezas.push(p);
    });
    // De la más reciente a la más vieja: la lista arrancaba en enero y lo que se
    // surte es lo que acaba de cerrarse. Si la fecha no se puede leer, el orden
    // de la hoja hace de desempate, que también va de lo viejo a lo nuevo.
    const todas = Object.keys(porFolio).map(k => porFolio[k])
      .map(v => Object.assign(v, {
        pendiente: v.piezas.some(p => !p.completa),
        enCamino: v.piezas.some(p => p.enCamino),
        sobran: v.piezas.some(p => p.sobran),
        surtida: v.piezas.every(p => p.completa && !p.enCamino)
      }))
      // Primero lo que necesita que alguien haga algo; lo ya pedido, después;
      // lo ya surtido hasta abajo.
      .sort((a, b) => (Number(b.pendiente) - Number(a.pendiente)) ||
                      (Number(a.surtida) - Number(b.surtida)) ||
                      (b._orden - a._orden) || (b._fila - a._fila));

    // Se queda mientras falte algo, mientras venga en camino, o mientras haya
    // de más. Una venta ya pedida se queda a la vista —marcada— en vez de
    // desaparecer: quien la pidió necesita confirmar que quedó registrada.
    const activas = todas.filter(v => v.pendiente || v.enCamino || v.sobran);
    // Lo ya surtido no se borra, solo se guarda: con ?todas=1 vuelve a salir,
    // que es como se consulta qué se le mandó a una venta de hace dos meses.
    const ventas = (body.todas && String(body.todas) !== '0') ? todas : activas;

    // Los contadores de arriba cuentan SIEMPRE lo que falta por hacer, aunque
    // se esté viendo también lo ya surtido: si no, "ver todas" los inflaría.
    const pendientes = [];
    activas.forEach(v => v.piezas.forEach(p => pendientes.push(p)));

    return res.status(200).json({
      ok: true,
      ventas,
      viendoTodas: ventas !== activas,
      yaSurtidas: todas.filter(v => v.surtida).length,
      // Las que no están en la lista, con el motivo. Un folio que falta deja de
      // ser un misterio: o está cancelado, o le falta un dato en la hoja.
      fuera: Object.keys(fuera)
        .filter(k => !todas.some(v => norm(v.folio) === norm(k)))
        .map(k => fuera[k])
        .sort((a, b) => a.folio.localeCompare(b.folio, 'es')),
      proveedoresTodos, pedidosAbiertos, pedidoSugerido,
      totales: {
        // Lo mismo que la pestaña "Por surtir": dos números distintos para
        // la misma cosa hacen dudar de los dos.
        ventas: todas.filter(v => v.pendiente).length,
        piezas: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.falta, 0), 0),
        deStock: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.puedeDeStock, 0), 0),
        porPedir: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + (y.falta - y.puedeDeStock), 0), 0),
        sinVariante: pendientes.filter(x => x.faltaVariante).length,
        sinProveedor: pendientes.reduce((a, x) =>
          a + x.partes.filter(y => y.falta > 0 && !y.proveedores.length && !y.puedeDeStock).length, 0),
        // Ya encargadas al proveedor, y las que se pidieron de más
        yaPedidas: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.pedidas, 0), 0),
        deMas: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.sobran, 0), 0)
      },
      // Para no volver a adivinar cuando algo "no sale": dice qué se leyó.
      diagnostico: {
        renglonesDeVenta: ven.rows.length,
        gruposDePieza: filas.length,
        foliosConPendiente: ventas.length,
        foliosYaSurtidos: Object.keys(porFolio).length - ventas.length,
        masReciente: ventas.length ? ventas[0].folio + ' · ' + ventas[0].fecha : '',
        sinFechaLegible: filas.filter(x => !x._orden).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
