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
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || 0;

    const [ven, ped, env] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('op_envios')
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
    // Nico necesita ver la tela y las especificaciones sin abrir cada venta:
    // es lo que define si el mueble se puede producir o está esperando algo.
    const vTela = col(H, 'Tela');
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
      if (pFol) ped.rows.forEach(r => {
        const f = norm(r[pFol]);
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
      g.total += vTot ? num(r[vTot]) : 0;
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
        tela: /^(no|n\/a|na)$/i.test(tela) ? '' : tela.replace(/^s[ií]\s*-\s*/i, ''),
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
      const estado = !p ? 'sin pedir'
                   : (faltan.length ? 'a medias' : 'pedido completo');
      const e = envioPorFolio[k] || null;
      return {
        envio: e,
        detalle: (g.detalle || []).slice(0, 30),
        folio: g.folio, cliente: g.cliente, fecha: g.fecha, status: g.status,
        total: Math.round(g.total * 100) / 100,
        piezas: Math.round(g.piezas * 100) / 100,
        pedidas: Math.round(pedidas * 100) / 100,
        estado: estado,
        proveedores: p ? Object.keys(p.proveedores) : [],
        pedidos: p ? Object.keys(p.pedidos) : [],
        entrega: p ? p.entrega : 0,
        faltan: faltan.slice(0, 12)
      };
    });

    // Lo más nuevo arriba; lo que no tiene fecha, al final
    lista.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
    const filtrada = body.soloSinProveedor
      ? lista.filter(x => x.estado !== 'pedido completo') : lista;

    const cuenta = (e) => lista.filter(x => x.estado === e).length;
    return res.status(200).json({
      ok: true,
      anio: anio || null,
      folios: filtrada,
      resumen: {
        total: lista.length,
        sinPedir: cuenta('sin pedir'),
        aMedias: cuenta('a medias'),
        completos: cuenta('pedido completo'),
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
