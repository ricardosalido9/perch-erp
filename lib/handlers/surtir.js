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
const txt = (v) => String(v == null ? '' : v).trim();
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
    rows.push(o);
  }
  return { headers: H, rows };
}
const pieza = (prod, mat) => norm(prod) + '|' + norm(mat);
const esSoloSaldo = (n) => /^\s*saldo inicial del corte/i.test(String(n || ''));

module.exports = async (req, res) => {
  try {
    const body = Object.assign({}, req.query || {}, await core.readBody(req));
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

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
    const [ven, ped, ent, sal, provs, cat] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('prov_entradas'),
      leer('prov_salidas'), leer('compras_proveedores'), leer('inventario')
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
    if (!vF || !vP) return res.status(400).json({ error: 'La hoja de ventas no tiene folio o producto.' });

    // Lo que ya salió de bodega hacia cada venta
    const surtido = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio', 'Folio cliente');
      const sP = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sM = col(sal.headers, 'Material');
      const sQ = col(sal.headers, 'Cantidad');
      if (sF && sP) sal.rows.forEach(r => {
        const k = norm(r[sF]) + '||' + pieza(r[sP], sM ? r[sM] : '');
        surtido[k] = (surtido[k] || 0) + (sQ ? num(r[sQ]) : 0);
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
    // El proveedor y el costo de cada pedido, para que la salida los herede
    if (ped.headers.length) {
      const pNo = col(ped.headers, 'Pedido Proveedor', 'Pedido');
      const pPr2 = col(ped.headers, 'Proveedor');
      const pCU2 = col(ped.headers, 'Costo Unitario');
      if (pNo) ped.rows.forEach(r => {
        const k = norm(r[pNo]);
        if (!k) return;
        Object.keys(lotes).forEach(pz => {
          const o = lotes[pz][k];
          if (!o) return;
          if (!o.proveedor && pPr2) o.proveedor = txt(r[pPr2]);
          if (!o.costo && pCU2) o.costo = num(r[pCU2]);
        });
      });
    }
    // Lo disponible de una pieza, lote por lote, lo más viejo primero
    const lotesDe = (k) => Object.keys(lotes[k] || {})
      .map(x => lotes[k][x])
      .filter(x => Math.round(x.cantidad) > 0)
      .map(x => ({ pedido: x.pedido, proveedor: x.proveedor, costo: x.costo,
                   fecha: fechaTexto(x.fecha), disponibles: Math.round(x.cantidad),
                   _o: fechaNum(x.fecha) }))
      .sort((a, b) => (a._o || 9e15) - (b._o || 9e15))
      .map(x => { delete x._o; return x; });

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
    // Los días de entrega que cada proveedor declara
    const dias = {};
    if (provs.headers.length) {
      const nP = col(provs.headers, 'Proveedor', 'Nombre/Razón Social', 'Razón Social');
      const nD = col(provs.headers, 'Días de Entrega', 'Dias de Entrega', 'Días de entrega');
      if (nP && nD) provs.rows.forEach(r => {
        const d = txt(r[nD]);
        if (d) dias[norm(r[nP])] = d;
      });
    }

    // De qué está hecho cada mueble.
    //
    // Un mueble puede llevar DOS componentes: la madera y la tela, o la madera y
    // el mármol. En el catálogo son Material y Material Extra, y cada uno lo hace
    // un proveedor distinto, en su propio pedido. Mirando solo el Material, la
    // pantalla decía que la pieza estaba surtida cuando faltaba la mitad.
    const componentesDe = {};
    if (cat.headers.length) {
      const kP = col(cat.headers, 'Productos', 'Producto');
      const kM = col(cat.headers, 'Material');
      const kE = col(cat.headers, 'Material Extra');
      if (kP) cat.rows.forEach(r => {
        const k = pieza(r[kP], kM ? r[kM] : '');
        const extra = txt(kE ? r[kE] : '');
        if (!componentesDe[k]) {
          componentesDe[k] = [txt(kM ? r[kM] : '')].filter(Boolean);
          if (extra && norm(extra) !== norm(txt(kM ? r[kM] : ''))) componentesDe[k].push(extra);
        }
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
    ven.rows.forEach((r, i) => {
      const status = txt(vS ? r[vS] : '');
      if (/cancelad/i.test(status)) return;
      const folio = txt(r[vF]);
      const prod = txt(r[vP]);
      if (!folio || !prod) return;
      const mat = txt(vM ? r[vM] : '');
      const extra = txt(vME ? r[vME] : '');
      const vendidas = vQ ? num(r[vQ]) : 0;
      if (vendidas <= 0) return;
      const gk = norm(folio) + '|' + norm(prod) + '|' + norm(mat) + '|' + norm(extra);
      const g = grupos[gk] = grupos[gk] || {
        folio, cliente: txt(vC ? r[vC] : ''),
        fecha: fechaTexto(vFe ? r[vFe] : ''),
        _orden: fechaNum(vFe ? r[vFe] : ''), _fila: i,
        producto: prod, material: mat, materialExtra: extra,
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

    const filas = Object.keys(grupos).map(gk => {
      const g = grupos[gk];
      const prod = g.producto, mat = g.material, extra = g.materialExtra;

      // Manda lo que diga la VENTA, no el catálogo.
      //
      // Un "Set de 3 Velas Fénix" son tres renglones que solo se distinguen por
      // el Material Extra —grande, mediana, chica—. Como las tres variantes del
      // catálogo comparten producto y material, quedarse con la primera volvía
      // las tres "vela grande". El catálogo solo entra cuando la venta no dijo
      // nada, que es donde sigue sirviendo: el mueble de madera y tela.
      const comps = [];
      if (mat) comps.push(mat);
      if (extra && norm(extra) !== norm(mat)) comps.push(extra);
      if (!extra) {
        (componentesDe[pieza(prod, mat)] || []).forEach(c => {
          if (c && !comps.some(x => norm(x) === norm(c))) comps.push(c);
        });
      }
      if (!comps.length) comps.push(mat);

      const partes = comps.map(c => {
        const kc = pieza(prod, c);
        const ya2 = surtido[norm(g.folio) + '||' + kc] || 0;
        const falta2 = Math.round(g.vendidas - ya2);
        const hay2 = Math.max(0, Math.round(bodega[kc] || 0));
        const lista2 = Object.keys(quienLoHace[kc] || {})
          .map(q => Object.assign({}, quienLoHace[kc][q], { dias: dias[norm(q)] || '' }))
          .sort((a, b) => b.veces - a.veces);
        return {
          componente: c, surtidas: ya2, falta: falta2 > 0 ? falta2 : 0,
          enBodega: hay2, puedeDeStock: Math.min(hay2, falta2 > 0 ? falta2 : 0),
          // De qué pedido puede salir: la bodega no es un montón anónimo
          lotes: lotesDe(kc),
          proveedores: lista2.slice(0, 6),
          // Lo ya conseguido se queda a la vista en vez de desaparecer
          listo: falta2 <= 0
        };
      });

      return Object.assign({}, g, {
        variosComponentes: comps.length > 1,
        completa: !partes.some(x => x.falta > 0),
        partes
      });
    });

    // Una venta se va de la lista cuando ya no le falta nada. Mientras le falte
    // algo se queda entera, con lo conseguido marcado.
    const porFolio = {};
    filas.forEach(p => {
      const g = porFolio[p.folio] = porFolio[p.folio] ||
        { folio: p.folio, cliente: p.cliente, fecha: p.fecha,
          _orden: p._orden, _fila: p._fila, piezas: [] };
      if (p._orden > g._orden) { g._orden = p._orden; g.fecha = p.fecha; }
      if (p._fila > g._fila) g._fila = p._fila;
      g.piezas.push(p);
    });
    // De la más reciente a la más vieja: la lista arrancaba en enero y lo que se
    // surte es lo que acaba de cerrarse. Si la fecha no se puede leer, el orden
    // de la hoja hace de desempate, que también va de lo viejo a lo nuevo.
    const ventas = Object.keys(porFolio).map(k => porFolio[k])
      .filter(v => v.piezas.some(p => !p.completa))
      .sort((a, b) => (b._orden - a._orden) || (b._fila - a._fila));

    const pendientes = [];
    ventas.forEach(v => v.piezas.forEach(p => pendientes.push(p)));

    return res.status(200).json({
      ok: true,
      ventas,
      totales: {
        ventas: ventas.length,
        piezas: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.falta, 0), 0),
        deStock: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + y.puedeDeStock, 0), 0),
        porPedir: pendientes.reduce((a, x) =>
          a + x.partes.reduce((b, y) => b + (y.falta - y.puedeDeStock), 0), 0),
        sinProveedor: pendientes.reduce((a, x) =>
          a + x.partes.filter(y => y.falta > 0 && !y.proveedores.length && !y.puedeDeStock).length, 0)
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
