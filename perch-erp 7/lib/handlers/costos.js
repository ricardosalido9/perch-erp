// Comparativo de costos por folio de venta.
// Cruza cuatro fuentes:
//   VENTAS   -> cuánto se vendió y qué costo trae hoy la hoja
//   Salidas  -> qué piezas salieron a ese folio
//   Pedidos  -> cuánto costó realmente cada pieza (por pedido de proveedor)
//   Catálogo -> cuánto dice la lista de precios que cuesta
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.replace(/,/g, ' ').replace(/\s+/g, ' ')
        .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  m = s.match(/^([a-z]+)[-\s](\d{4})$/);            // "noviembre-2025"
  if (m && MESES_N[m[1]]) return +m[2] * 10000 + MESES_N[m[1]] * 100;
  return null;
}
function col(headers, ...nombres) {
  for (const n of nombres) {
    const h = headers.filter(x => norm(x) === norm(n))[0];
    if (h) return h;
  }
  return null;
}
// Quita filas idénticas (misma salida cargada desde dos archivos distintos)
function sinRepetidos(rows, campos) {
  const vistos = {}, out = [];
  rows.forEach(r => {
    const k = campos.map(c => norm(r[c])).join('|');
    if (vistos[k]) return;
    vistos[k] = 1; out.push(r);
  });
  return out;
}

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

// A partir de este año se calcula el costo real desde producción.
// Lo anterior se congela con lo que dice VENTAS: no vale la pena reconstruirlo.
const ANIO_REAL_DESDE = 2026;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ven, sal, ped, cat] = await Promise.all([
      leer('ventas_registro'), leer('prov_salidas'), leer('prov_pedidos'), leer('inventario')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });
    if (!sal.headers.length) return res.status(400).json({ error: 'No se pudo leer la hoja Salidas del archivo de Operación.' });

    // --- Costo del catálogo ---
    const costoCat = {};
    if (cat.headers.length) {
      const cI = col(cat.headers, 'Productos', 'Producto');
      const cM = col(cat.headers, 'Material');
      const cC = col(cat.headers, 'Costos Total', 'Costo Unitario', 'Costo Total');
      if (cI && cC) cat.rows.forEach(r => {
        const k = norm(r[cI]) + '|' + norm(cM ? r[cM] : '');
        if (costoCat[k] === undefined) costoCat[k] = num(r[cC]);
      });
    }

    // ===== Costo real =====
    // Regla única: manda la hoja de Salidas, que ya trae el costo calculado con
    // SUMAR.SI.CONJUNTO sobre Pedidos (pedido + producto + material) x cantidad.
    // Si a un renglón le falta el costo, se hace esa MISMA búsqueda aquí.
    // Si un folio no tiene ninguna salida, se usan los pedidos que ya traen su folio.
    const costoPedido = {};      // pedido|producto|material -> costo unitario
    const costoSinMaterial = {}; // pedido|producto -> costo unitario (null si es ambiguo)
    const costoPedidoExiste = {}; // pedido -> existe en Pedidos a Proveedores
    const pedidosPorFolio = {};  // folio -> renglones del pedido, para cazar nombres mal escritos

    // ¿Dos nombres de producto son "el mismo" escrito distinto?
    function pareceElMismo(a, b) {
      const x = norm(a), y = norm(b);
      if (!x || !y) return false;
      if (x === y) return true;
      if (x.indexOf(y) === 0 || y.indexOf(x) === 0) return true;      // "buro luna" vs "buro luna secreto"
      const tx = x.split(' ').filter(Boolean), ty = y.split(' ').filter(Boolean);
      const comunes = tx.filter(t => ty.indexOf(t) !== -1).length;
      return comunes >= 2 && comunes / Math.min(tx.length, ty.length) >= 0.66;
    }
    if (ped.headers.length) {
      const pP = col(ped.headers, 'Pedido Proveedor');
      const pI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const pM = col(ped.headers, 'Material');
      const pC = col(ped.headers, 'Costo Unitario');
      if (pC && pP) ped.rows.forEach(r => {
        if (txt(r[pP])) costoPedidoExiste[norm(r[pP])] = true;
        const cu = num(r[pC]);
        if (!cu) return;
        const k = norm(r[pP]) + '|' + norm(pI ? r[pI] : '') + '|' + norm(pM ? r[pM] : '');
        if (costoPedido[k] === undefined) costoPedido[k] = cu;
        // Respaldo sin material: es el punto 69 de la lista. El material se escribe
        // distinto entre Salidas y Pedidos ("Encino Entintado" vs "Encino entintado",
        // o de plano vacío) y con eso la llave de tres partes falla. Si un pedido tiene
        // el mismo producto en dos materiales con costos distintos, NO se guarda el
        // respaldo: ahí sí sería adivinar cuál de los dos es.
        const k2 = norm(r[pP]) + '|' + norm(pI ? r[pI] : '');
        if (costoSinMaterial[k2] === undefined) costoSinMaterial[k2] = cu;
        else if (costoSinMaterial[k2] !== cu) costoSinMaterial[k2] = null;   // ambiguo
        const fol = txt(r[col(ped.headers, 'Folio cliente', 'Folio Cliente')]).toUpperCase();
        if (fol) {
          (pedidosPorFolio[fol] = pedidosPorFolio[fol] || []).push({
            producto: txt(pI ? r[pI] : ''), material: txt(pM ? r[pM] : ''),
            pedido: txt(r[pP]), cu: cu,
            cantidad: num(r[col(ped.headers, 'Cantidad')]) || 0
          });
        }
      });
    }

    const sF = col(sal.headers, 'Folio cliente', 'Folio');
    const sI = col(sal.headers, 'Productos', 'Producto', 'Item');
    const sM = col(sal.headers, 'Material');
    const sC = col(sal.headers, 'Cantidad');
    const sP = col(sal.headers, 'Numero de pedido', 'Número de pedido', 'No. de pedido', 'Pedido Proveedor', 'Pedido');
    const sPr = col(sal.headers, 'Proveedor');
    // OJO: la hoja de Salidas NO tiene columna de costo. Sus columnas son
    // Fecha de cierre de venta · Folio · Cliente · Numero de pedido · Proveedor ·
    // Item · Material · Cantidad · Tela/Especificaciones · Status proveedor ·
    // fechas · Destino · Origen. Por eso el costo SIEMPRE sale del cruce contra
    // Pedidos a Proveedores usando "Numero de pedido".
    const sCU = col(sal.headers, 'Costo Unitario');
    const sCo = col(sal.headers, 'Costo', 'Costo Total');

    const salidas = {};
    const conSalida = {};
    const faltanEnSalidas = {};   // piezas que el pedido asignó y no aparecen en Salidas
    // OJO: NO se deduplican las salidas. Dos renglones con el mismo producto, material y
    // cantidad son legítimos cuando salen de lotes distintos: un retrabajo más caro, o
    // piezas de dos pedidos con precios diferentes. Cada renglón es un movimiento real.
    if (sF && sI) {
      sal.rows.forEach(r => {
        const f = txt(r[sF]).toUpperCase();
        if (!f) return;
        const c = sC ? num(r[sC]) : 0;
        if (!c) return;
        conSalida[f] = true;

        const kp = norm(r[sI]) + '|' + norm(sM ? r[sM] : '');
        // La hoja manda. Si el costo está en cero o vacío es porque la pieza todavía
        // no llega o no se ha costeado: NO se completa con nada, se deja pendiente.
        let importe = sCo ? num(r[sCo]) : 0;
        let cu = sCU ? num(r[sCU]) : 0;
        let fuente = 'costo de la salida';
        if (!importe && cu) importe = cu * c;
        // Si la salida no trae costo, se busca en Pedidos a Proveedores con la misma
        // llave que usa la hoja: pedido + producto + material. Este cruce es el que
        // faltaba: el mapa se construía y no se usaba, así que cualquier salida sin
        // costo capturado quedaba en cero aunque su pedido sí tuviera el costo.
        if (!importe && sP) {
          const kPed = norm(r[sP]) + '|' + norm(r[sI]) + '|' + norm(sM ? r[sM] : '');
          const delPedido = costoPedido[kPed];
          if (delPedido) { importe = delPedido * c; fuente = 'costo del pedido'; }
          else {
            // Segundo intento sin el material, que es donde suele romperse la llave
            const k2 = norm(r[sP]) + '|' + norm(r[sI]);
            const sinMat = costoSinMaterial[k2];
            if (sinMat) { importe = sinMat * c; fuente = 'costo del pedido (sin material)'; }
          }
        }
        // Tercer intento: por el FOLIO DEL CLIENTE. Muchas salidas no traen el número
        // de pedido del proveedor, pero el pedido sí trae a qué folio se asignó la
        // pieza. Ese es el otro camino para llegar al mismo costo.
        if (!importe) {
          const delFolio = (pedidosPorFolio[f] || []);
          let m = delFolio.filter(x => norm(x.producto) === norm(r[sI]) &&
                                       norm(x.material) === norm(sM ? r[sM] : ''));
          if (!m.length) m = delFolio.filter(x => norm(x.producto) === norm(r[sI]));
          // Solo si todos los candidatos cuestan lo mismo: si no, sería adivinar
          if (m.length && m.every(x => x.cu === m[0].cu)) {
            importe = m[0].cu * c;
            fuente = 'costo del pedido por folio';
          }
        }
        let pendiente = !importe;
        // Por qué no se pudo costear: sin esto, "pendiente de costear" no dice si
        // el problema es la salida, el pedido o el nombre del producto.
        let motivo = null;
        if (pendiente) {
          const tienePedido = sP && txt(r[sP]);
          const hayFolio = (pedidosPorFolio[f] || []).length;
          motivo = !tienePedido && !hayFolio
            ? 'la salida no dice de qué pedido salió y el folio no tiene pedidos asignados'
            : (!tienePedido
                ? 'la salida no dice de qué pedido salió'
                : (costoPedidoExiste[norm(r[sP])]
                    ? 'el pedido existe pero ese producto no aparece en él con costo'
                    : 'el pedido ' + txt(r[sP]) + ' no aparece en Pedidos a Proveedores'));
        }
        let sugerencia = null;
        if (pendiente) {
          const cands = (pedidosPorFolio[f] || []).filter(x =>
            norm(x.material) === norm(sM ? r[sM] : '') &&
            norm(x.producto) !== norm(r[sI]) &&
            pareceElMismo(x.producto, r[sI]));
          if (cands.length) {
            sugerencia = cands[0];
            fuente = 'nombre no coincide';
          }
        }
        const d = salidas[f] = salidas[f] || { piezas: 0, real: 0, cat: 0, sinCosto: 0, prov: {}, aprox: 0, det: [] };
        d.piezas += c;
        if (pendiente) { d.sinCosto++; if (sugerencia) d.malNombre = (d.malNombre || 0) + 1; }
        else d.real += importe;
        const cc = costoCat[kp];
        if (cc !== undefined) d.cat += cc * c;
        if (sPr && txt(r[sPr])) d.prov[txt(r[sPr])] = 1;
        if (d.det.length < 40) {
          d.det.push({
            producto: txt(r[sI]), material: txt(sM ? r[sM] : ''),
            proveedor: txt(sPr ? r[sPr] : ''), pedido: txt(sP ? r[sP] : ''),
            cantidad: c,
            costoUnitario: importe ? Math.round((importe / c) * 100) / 100 : null,
            fuente: importe ? fuente : (sugerencia ? 'nombre no coincide' : 'pendiente de costear'),
            motivo: importe ? null : motivo,
            sugerencia: sugerencia
              ? { producto: sugerencia.producto, pedido: sugerencia.pedido,
                  costoUnitario: Math.round(sugerencia.cu * 100) / 100,
                  importe: Math.round(sugerencia.cu * c * 100) / 100 }
              : null,
            opciones: [],
            catalogo: (cc === undefined) ? null : Math.round(cc * 100) / 100
          });
        }
      });
    }

    // Solo si un folio NO tiene ninguna salida registrada, se usan sus pedidos
    if (ped.headers.length) {
      const qF = col(ped.headers, 'Folio cliente', 'Folio Cliente');
      const qP = col(ped.headers, 'Pedido Proveedor');
      const qI = col(ped.headers, 'Productos', 'Producto', 'Item');
      const qM = col(ped.headers, 'Material');
      const qC = col(ped.headers, 'Cantidad');
      const qU = col(ped.headers, 'Costo Unitario');
      const qPr = col(ped.headers, 'Proveedor');
      if (qF && qU) ped.rows.forEach(r => {
        const f = txt(r[qF]).toUpperCase();
        if (!f || ['STOCK', 'EXHIBICION', 'EXHIBICIÓN'].indexOf(f) !== -1) return;
        if (conSalida[f]) {
          // Hay salidas, pero puede que falten piezas por registrar
          const c2 = qC ? num(r[qC]) : 0;
          if (c2) faltanEnSalidas[f] = (faltanEnSalidas[f] || 0) + c2;
          return;
        }
        const c = qC ? num(r[qC]) : 0;
        const cu = num(r[qU]);
        if (!c || !cu) return;
        const kp = norm(qI ? r[qI] : '') + '|' + norm(qM ? r[qM] : '');
        const d = salidas[f] = salidas[f] || { piezas: 0, real: 0, cat: 0, sinCosto: 0, prov: {}, aprox: 0, det: [] };
        d.piezas += c; d.real += cu * c;
        const cc = costoCat[kp];
        if (cc !== undefined) d.cat += cc * c;
        if (qPr && txt(r[qPr])) d.prov[txt(r[qPr])] = 1;
        if (d.det.length < 40) {
          d.det.push({
            producto: txt(qI ? r[qI] : ''), material: txt(qM ? r[qM] : ''),
            proveedor: txt(qPr ? r[qPr] : ''), pedido: txt(qP ? r[qP] : ''),
            cantidad: c, costoUnitario: Math.round(cu * 100) / 100,
            fuente: 'pedido sin salida registrada', opciones: [],
            catalogo: (cc === undefined) ? null : Math.round(cc * 100) / 100
          });
        }
      });
    }

    // --- Ventas por folio ---
    const vF = col(ven.headers, 'No. de Referencia', 'Referencia', 'Folio');
    const vC = col(ven.headers, 'Cliente');
    const vT = col(ven.headers, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
    const vCo = col(ven.headers, 'Costo total', 'Costo Total');
    const vFe = col(ven.headers, 'Fecha del Cierre');
    if (!vF || !vT) return res.status(400).json({ error: 'VENTAS no tiene folio o total sin impuestos.' });

    const vPr = col(ven.headers, 'Producto', 'Productos');
    const vMa = col(ven.headers, 'Material');
    const vCa = col(ven.headers, 'Cantidad');
    const folios = {};
    ven.rows.forEach(r => {
      const f = txt(r[vF]).toUpperCase();
      if (!f) return;
      const t = num(r[vT]);
      const co = vCo ? num(r[vCo]) : 0;
      if (!t && !co) return;                       // fila de fórmula arrastrada
      const d = folios[f] = folios[f] || { folio: f, cliente: '', fecha: '', venta: 0, costoVentas: 0, lineas: [] };
      d.venta += t; d.costoVentas += co;
      d.lineas.push({
        producto: vPr ? txt(r[vPr]) : '', material: vMa ? txt(r[vMa]) : '',
        cantidad: vCa ? num(r[vCa]) : 0, costo: co, venta: t
      });
      if (!d.cliente && vC) d.cliente = txt(r[vC]);
      if (!d.fecha && vFe) {
        d.fecha = txt(r[vFe]);
        const m = d.fecha.match(/(20\d{2})/);
        d.anio = m ? +m[1] : null;
      }
    });

    const filas = Object.keys(folios).map(f => {
      const d = folios[f];
      // Histórico: se toma el costo de la hoja de Ventas tal cual y no se recalcula
      if (d.anio && d.anio < ANIO_REAL_DESDE) {
        const cv = Math.round(d.costoVentas * 100) / 100;
        const mgh = d.venta ? Math.round(((d.venta - cv) / d.venta) * 1000) / 10 : null;
        return {
          folio: f, cliente: d.cliente, fecha: d.fecha, anio: d.anio,
          venta: Math.round(d.venta * 100) / 100,
          piezas: (salidas[f] ? salidas[f].piezas : 0),
          proveedores: salidas[f] ? Object.keys(salidas[f].prov).join(' / ') : '',
          costoReal: cv, margenReal: mgh,
          costoVentas: cv, margenVentas: mgh,
          costoCatalogo: null, margenCatalogo: null,
          sinCostear: 0, aproximados: 0, historico: true,
          detalle: [], lineasVenta: d.lineas || []
        };
      }
      const s = salidas[f] || null;
      // Si NINGUNA de las piezas del folio trae costo, el costo real no es cero:
      // es que no se ha costeado. Reportarlo como $0 hacía que el margen saliera
      // en 100%, que es exactamente lo contrario de lo que pasa.
      const todoSinCostear = !!(s && s.piezas && s.sinCosto && s.real === 0);
      const real = (s && !todoSinCostear) ? Math.round(s.real * 100) / 100 : null;
      const cta = (s && s.cat) ? Math.round(s.cat * 100) / 100 : null;
      const mg = (c) => (c === null || !d.venta) ? null : Math.round(((d.venta - c) / d.venta) * 1000) / 10;
      // Costeado a medias: el número sirve, pero hay que decir que está incompleto
      const parcial = !!(s && s.sinCosto && s.real > 0);
      return {
        folio: f, cliente: d.cliente, fecha: d.fecha, anio: d.anio,
        venta: Math.round(d.venta * 100) / 100,
        piezas: s ? s.piezas : 0,
        proveedores: s ? Object.keys(s.prov).join(' / ') : '',
        costoReal: real, margenReal: mg(real),
        // Por qué el costo real no está: para decirlo en pantalla en vez de un cero
        estadoCosto: todoSinCostear ? 'sin costear'
                   : (parcial ? 'parcial' : (real === null ? 'sin salidas' : 'completo')),
        // Igual que el costo real: un costo en cero no es margen del 100%, es que
        // la venta no trae costo capturado. Se distingue de un costo real de cero.
        costoVentas: d.costoVentas ? Math.round(d.costoVentas * 100) / 100 : null,
        margenVentas: d.costoVentas ? mg(d.costoVentas) : null,
        costoCatalogo: cta, margenCatalogo: mg(cta),
        sinCostear: s ? s.sinCosto : 0,
        aproximados: s ? s.aprox : 0,
        faltanSalidas: Math.max(0, Math.round(((faltanEnSalidas[f] || 0) - (s ? s.piezas : 0)) * 100) / 100),
        malNombre: s ? (s.malNombre || 0) : 0,
        detalle: s ? s.det : [],
        lineasVenta: d.lineas || []
      };
    }).filter(x => x.venta > 0)
      .sort((a, b) => (a.folio < b.folio ? 1 : -1));

    return res.status(200).json({
      ok: true,
      folios: filas,
      conSalidas: filas.filter(x => x.costoReal !== null).length,
      catalogoOk: !!Object.keys(costoCat).length,
      pedidosOk: !!Object.keys(costoPedido).length,
      // Qué columnas encontró de verdad en cada hoja. Si el costo sale raro, esto
      // dice si el problema es un nombre de columna y no la lógica.
      columnas: {
        salidas: {
          folio: sF || '(NO ESTÁ)', producto: sI || '(NO ESTÁ)',
          material: sM || '(NO ESTÁ)', cantidad: sC || '(NO ESTÁ)',
          pedido: sP || '(NO ESTÁ)', proveedor: sPr || '(NO ESTÁ)',
          costo: sCo || '(no tiene, se cruza con Pedidos)',
          encabezados: sal.headers.filter(Boolean)
        },
        pedidosConCosto: Object.keys(costoPedido).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
