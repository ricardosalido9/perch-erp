// Las ventas folio por folio, y si cada una ya tiene proveedor asignado.
//
// Antes esto se veía por partes: los folios en Ventas por un lado, y en Inicio un
// aviso de cuántos pedidos no tienen proveedor. Nunca folio por folio, que es
// como se trabaja: se cierra una venta y hay que pedirla.
//
// El cruce va por "Folio cliente" de Pedidos a proveedores, que es la columna que
// dice a qué venta pertenece cada renglón pedido.
//
//   ?action=ventas-folios  { anio, soloSinProveedor }
const core = require('../core');
const { totalSinIVADe, indicesTotal } = require('../totales');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function col(H, ...ns) {
  for (const n of ns) { const c = H.filter(x => norm(x) === norm(n))[0]; if (c) return c; }
  return null;
}
const MES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9,
              oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
              junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear()*10000 + (v.getMonth()+1)*100 + v.getDate();
  const s = norm(v);
  if (!s) return 0;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.replace(/,/g,' ').replace(/\s+/g,' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MES[m[2]]) return +m[3]*10000 + MES[m[2]]*100 + +m[1];
  return 0;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const H = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!H.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _row: i + 1 }; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    // Producción necesita ver qué se vendió y qué falta pedir, pero no a qué
    // precio. El total se quita aquí, en el servidor, no escondiendo la columna
    // en la pantalla: lo que no se manda no se puede ver.
    const sinDinero = (sesion.rol || '') === 'operativo';
    const anio = +body.anio || 0;

    const [ven, ped, env, cat, sal] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('op_envios'),
      // El catálogo dice qué muebles llevan tela: la celda vacía de una venta no
      // significa "falta definirla", puede ser que ese mueble no lleve.
      leer('inventario'),
      // Las salidas, para saber si la pieza quedó REGISTRADA al salir.
      //
      // "Ya no me salen las ventas pasadas en 'por surtir', pero al meterme no
      // están surtidas ni tienen pedidos asignados; entonces no tenemos certeza
      // del inventario" (Nico, 6 nov). Tenía razón: desde la 534 una venta
      // entregada deja de contar como trabajo pendiente —y está bien, el mueble
      // ya está con el cliente—, pero si nunca se le registró la salida, el
      // inventario sigue creyendo que esa pieza está en bodega. Dejaba de verse
      // sin haberse arreglado. Esto es lo que faltaba mirar.
      leer('prov_salidas')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });

    const H = ven.headers;
    const vFol = col(H, 'No. de Referencia', 'No de Referencia', 'Referencia', 'Folio');
    const vCli = col(H, 'Cliente');
    const vPro = col(H, 'Productos', 'Producto', 'Item');
    const vMat = col(H, 'Material');
    const vCan = col(H, 'Cantidad');
    const vFec = col(H, 'Fecha del Cierre', 'Fecha');
    const vSta = col(H, 'Status');
    const vTot = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos', 'Total');
    // Los renglones a los que no les bajó la fórmula del total se calculan
    // aparte (lib/totales.js) y se listan en la respuesta.
    const idxTot = indicesTotal(H, col);
    const sinFormula = [];
    // Nico necesita ver la tela y las especificaciones sin abrir cada venta:
    // es lo que define si el mueble se puede producir o está esperando algo.
    const vTela = col(H, 'Tela');

    // Qué productos llevan tela, según el catálogo.
    //
    // Hacía falta porque una celda vacía en la venta no distingue entre "falta
    // definir la tela" y "este mueble no lleva". Esta tabla se arma una vez y se
    // consulta al pintar cada renglón.
    const productosConTela = {};
    if (cat && cat.headers.length) {
      const kP = col(cat.headers, 'Productos', 'Producto');
      const kM = col(cat.headers, 'Material');
      const kE = col(cat.headers, 'Material Extra');
      if (kP) cat.rows.forEach(r => {
        const p2 = norm(txt(r[kP]));
        if (!p2) return;
        const lleva = /tela|tapiz|piel|textil|boucle|bouclé|lino/i.test(
          txt(kM ? r[kM] : '') + ' ' + txt(kE ? r[kE] : ''));
        if (lleva) productosConTela[p2] = true;
        else if (productosConTela[p2] === undefined) productosConTela[p2] = false;
      });
    }
    const vEsp = col(H, 'Especificaciones', 'Especificacion', 'Detalles');
    if (!vFol) return res.status(400).json({ error: 'VENTAS no tiene columna de folio.' });

    // Lo pedido a proveedores, agrupado por folio de cliente
    const pedidoPorFolio = {};
    let sinFolioEnPedidos = 0;
    if (ped.headers.length) {
      const Hp = ped.headers;
      const pFol = col(Hp, 'Folio cliente', 'Folio Cliente', 'Folio', 'Pedido Cliente');
      const pPro = col(Hp, 'Proveedor');
      const pIt  = col(Hp, 'Productos', 'Producto', 'Item');
      const pMat = col(Hp, 'Material');
      const pCan = col(Hp, 'Cantidad');
      const pPed = col(Hp, 'Pedido Proveedor', 'Pedido');
      const pEst = col(Hp, 'Fecha Estimada de Entrega', 'Fecha estimada de entrega');
      const pDes = col(Hp, 'Destino');
      if (pFol) ped.rows.forEach(r => {
        // La venta de un pedido puede estar escrita en "Folio cliente" o en
        // "Destino": quien asigna desde la tarjeta llena las dos, pero quien
        // edita el renglón a mano suele escribir solo el Destino, que es la
        // columna que se ve en la tabla.
        //
        // Surtir ventas ya leía las dos; esta pantalla solo la primera, y por
        // eso la misma venta decía "falta pedir 12" aquí y "pedido completo"
        // allá, con el pedido a la vista y su destino puesto.
        let f = norm(r[pFol]);
        if (!f) {
          const d = txt(pDes ? r[pDes] : '');
          // Stock, bodega, exhibición, directo o proveedor no son una venta
          if (d && !/^(stock|bodega|showroom|exhibici|directo|proveedor)/i.test(norm(d))) {
            f = norm(d);
          }
        }
        if (!f) { sinFolioEnPedidos++; return; }
        const g = pedidoPorFolio[f] = pedidoPorFolio[f] || { piezas: 0, proveedores: {}, items: {}, pedidos: {}, entrega: 0 };
        const c = pCan ? num(r[pCan]) : 0;
        g.piezas += c;
        const prov = txt(pPro ? r[pPro] : '');
        if (prov) g.proveedores[prov] = (g.proveedores[prov] || 0) + c;
        const k = norm(pIt ? r[pIt] : '') + '|' + norm(pMat ? r[pMat] : '');
        g.items[k] = (g.items[k] || 0) + c;
        if (pPed && txt(r[pPed])) g.pedidos[txt(r[pPed])] = 1;
        const fe = pEst ? fechaNum(r[pEst]) : 0;
        if (fe && (!g.entrega || fe > g.entrega)) g.entrega = fe;
      });
    }

    // Cuántas piezas de cada venta tienen su salida registrada.
    //
    // Se cuenta por mueble + material, no por total, porque una venta puede
    // tener la salida de una pieza y no la de otra. Una salida cancelada no
    // cuenta: no registró nada.
    const salidaPorFolio = {};
    if (sal.headers.length) {
      const Hs = sal.headers;
      const sFol = col(Hs, 'Folio', 'Folio cliente', 'Folio Cliente');
      const sIt  = col(Hs, 'Producto', 'Productos', 'Item');
      const sMat = col(Hs, 'Material');
      const sCan = col(Hs, 'Cantidad');
      const sSt  = col(Hs, 'Satus cliente', 'Status cliente', 'Estatus cliente');
      if (sFol && sIt) sal.rows.forEach(r => {
        if (sSt && /cancelad/i.test(txt(r[sSt]))) return;
        const f = norm(r[sFol]);
        if (!f) return;
        const g = salidaPorFolio[f] = salidaPorFolio[f] || { piezas: 0, items: {} };
        const c = sCan ? num(r[sCan]) : 0;
        const kk = norm(r[sIt]) + '|' + norm(sMat ? r[sMat] : '');
        g.items[kk] = (g.items[kk] || 0) + c;
        g.piezas += c;
      });
    }

    // El envío de cada folio. Foráneo o local se decide por la zona: si dice
    // CDMX, Ciudad de México o Metropolitana, es local; cualquier otra cosa es
    // foráneo. No hay una columna que lo diga, así que se deduce de la zona.
    const envioPorFolio = {};
    if (env.headers.length) {
      const eF = col(env.headers, 'Pedido', 'Folio', 'No. de Referencia');
      const eZ = col(env.headers, 'Zona');
      const eC = col(env.headers, 'Ciudad');
      const eS = col(env.headers, 'Status');
      const ePq = col(env.headers, 'Paqueteria', 'Paquetería');
      const eFe = col(env.headers, 'Fecha Estimada de Entrega', 'Fecha');
      if (eF) env.rows.forEach(r => {
        const f = norm(r[eF]);
        if (!f) return;
        const zona = txt(eZ ? r[eZ] : '');
        const ciudad = txt(eC ? r[eC] : '');
        const local = /cdmx|ciudad de mexico|metropolitana|edomex|estado de mexico|local/
                      .test(norm(zona + ' ' + ciudad));
        envioPorFolio[f] = {
          zona: zona || ciudad, ciudad: ciudad,
          donde: (zona || ciudad) ? (local ? 'local' : 'foráneo') : '',
          status: txt(eS ? r[eS] : ''),
          paqueteria: txt(ePq ? r[ePq] : ''),
          fecha: eFe ? fechaNum(r[eFe]) : 0
        };
      });
    }

    // Las ventas, agrupadas por folio
    const folios = {};
    ven.rows.forEach(r => {
      const f = txt(r[vFol]);
      if (!f) return;
      const fe = vFec ? fechaNum(r[vFec]) : 0;
      if (anio && fe && Math.floor(fe / 10000) !== anio) return;
      const k = norm(f);
      const g = folios[k] = folios[k] || {
        folio: f, cliente: '', fecha: 0, status: '', total: 0,
        piezas: 0, items: {}, renglones: 0
      };
      if (!g.cliente && vCli) g.cliente = txt(r[vCli]);
      if (fe && (!g.fecha || fe < g.fecha)) g.fecha = fe;
      if (!g.status && vSta) g.status = txt(r[vSta]);
      // El total sale de la hoja; si a ese renglón no le bajó la fórmula, se
      // rehace con precio × cantidad − descuento y se anota para avisarlo.
      const tt = totalSinIVADe(idxTot, r, num);
      g.total += tt.total;
      if (tt.calculado) {
        g.calculados = (g.calculados || 0) + 1;
        sinFormula.push({ folio: f, producto: txt(vPro ? r[vPro] : ''),
                          material: txt(vMat ? r[vMat] : ''),
                          fila: r.__fila || null, total: tt.total });
      }
      const c = vCan ? num(r[vCan]) : 0;
      g.piezas += c;
      g.renglones++;
      const kk = norm(vPro ? r[vPro] : '') + '|' + norm(vMat ? r[vMat] : '');
      g.items[kk] = (g.items[kk] || 0) + c;
      g.detalle = g.detalle || [];
      const tela = txt(vTela ? r[vTela] : '');
      const esp = txt(vEsp ? r[vEsp] : '');
      g.detalle.push({
        producto: txt(vPro ? r[vPro] : ''), material: txt(vMat ? r[vMat] : ''),
        cantidad: c,
        // Tres estados distintos, no dos: la tela puede estar definida, puede
        // faltar, o el mueble puede no llevar tela. Si la venta dice "No" es
        // claro; si la celda está vacía hay que preguntarle al catálogo, porque
        // un vacío no distingue "falta" de "no aplica".
        llevaTela: /^(no|n\/a|na|-|sin tela)$/i.test(tela) ? false
                   : (tela ? true : productosConTela[norm(txt(vPro ? r[vPro] : ''))] === true),
        tela: /^(no|n\/a|na|-|sin tela)$/i.test(tela) ? '' : tela.replace(/^s[ií]\s*-\s*/i, ''),
        especificaciones: esp
      });
    });

    const lista = Object.keys(folios).map(k => {
      const g = folios[k];
      const p = pedidoPorFolio[k];
      // Se compara pieza por pieza, producto + material: así se ve la venta que
      // está pedida A MEDIAS, que es el caso que de verdad se escapa.
      let pedidas = 0, faltan = [];
      Object.keys(g.items).forEach(kk => {
        const quiere = g.items[kk];
        const tiene = p ? (p.items[kk] || 0) : 0;
        pedidas += Math.min(quiere, tiene);
        if (tiene < quiere) {
          faltan.push({ item: kk.split('|')[0], material: kk.split('|')[1],
                        piezas: Math.round((quiere - tiene) * 100) / 100 });
        }
      });
      // Una venta ENTREGADA no está por surtir: el mueble ya está con el
      // cliente.
      //
      // 5 nov. Nico, con la 532 ya cargada: "me siguen saliendo 179 por surtir".
      // No era la versión: *Surtir ventas* ya sacaba las entregadas desde la 519,
      // pero el **Tablero de la venta** las seguía contando, porque el estado se
      // calcula aquí y solo miraba si había pedido al proveedor. De 224 ventas,
      // 184 están entregadas y casi ninguna tiene su pedido capturado —son de
      // enero en adelante—: por eso salían 179. Se marcan como entregadas, se
      // siguen viendo, y dejan de contar como trabajo pendiente.
      const entregada = /entregad/i.test(txt(g.status));
      const estado = entregada ? 'entregada'
                   : (!p ? 'sin pedir'
                   : (faltan.length ? 'a medias' : 'pedido completo'));

      // Qué le falta de REGISTRO a esta venta, que es distinto de cómo va la
      // producción. Una venta puede estar entregada y bien con el cliente, y
      // aun así tener el inventario mal porque nunca se capturó su salida.
      const s = salidaPorFolio[k];
      let sinSalida = 0;
      Object.keys(g.items).forEach(kk => {
        const quiere = g.items[kk];
        const salio = s ? (s.items[kk] || 0) : 0;
        if (salio < quiere) sinSalida += (quiere - salio);
      });
      sinSalida = Math.round(sinSalida * 100) / 100;
      const sinPedido = faltan.reduce((a, x) => a + (x.piezas || 0), 0);
      // Solo se llama "papeleo pendiente" cuando la venta YA se entregó: antes
      // de entregarla, que falte la salida es lo normal, no un descuido.
      const papeleo = [];
      if (entregada && sinSalida > 0) papeleo.push('sin salida');
      if (entregada && sinPedido > 0) papeleo.push('sin pedido');
      const e = envioPorFolio[k] || null;
      return {
        envio: e,
        detalle: (g.detalle || []).slice(0, 30),
        folio: g.folio, cliente: g.cliente, fecha: g.fecha, status: g.status,
        total: sinDinero ? null : Math.round(g.total * 100) / 100,
        // Cuántos de sus renglones no traían total en la hoja
        totalCalculado: g.calculados || 0,
        piezas: Math.round(g.piezas * 100) / 100,
        pedidas: Math.round(pedidas * 100) / 100,
        estado: estado,
        // El registro, aparte de la producción
        salidas: s ? Math.round(s.piezas * 100) / 100 : 0,
        sinSalida: sinSalida,
        sinPedido: Math.round(sinPedido * 100) / 100,
        papeleo: papeleo,
        proveedores: p ? Object.keys(p.proveedores) : [],
        pedidos: p ? Object.keys(p.pedidos) : [],
        entrega: p ? p.entrega : 0,
        faltan: faltan.slice(0, 12)
      };
    });

    // Lo más nuevo arriba; lo que no tiene fecha, al final
    lista.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
    const filtrada = body.soloSinProveedor
      ? lista.filter(x => x.estado !== 'pedido completo' && x.estado !== 'entregada')
      : lista;

    const cuenta = (e) => lista.filter(x => x.estado === e).length;
    return res.status(200).json({
      ok: true,
      anio: anio || null,
      folios: filtrada,
      // Para avisar en pantalla, con folio y renglón, cuáles hay que arreglar
      sinFormulaTotal: sinDinero ? [] : sinFormula.slice(0, 40),
      resumen: {
        total: lista.length,
        sinFormulaTotal: sinDinero ? 0 : sinFormula.length,
        sinPedir: cuenta('sin pedir'),
        aMedias: cuenta('a medias'),
        completos: cuenta('pedido completo'),
        entregadas: cuenta('entregada'),
        sinEnvio: lista.filter(x => !x.envio).length,
        locales: lista.filter(x => x.envio && x.envio.donde === 'local').length,
        foraneos: lista.filter(x => x.envio && x.envio.donde === 'foráneo').length,
        piezasSinPedir: Math.round(lista.reduce((s, x) => s + (x.piezas - x.pedidas), 0) * 100) / 100
      },
      sinFolioEnPedidos,
      nota: 'Se cruza por la columna "Folio cliente" de Pedidos a proveedores. Un renglón ' +
            'pedido sin folio no se le puede asignar a ninguna venta y por eso no cuenta.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
