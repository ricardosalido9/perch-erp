// El tablero de la venta: cada venta con todo lo suyo junto.
//
// Hoy una venta se revisa en cuatro pantallas: Ventas (qué se vendió y a quién),
// Surtir ventas (quién la está haciendo y en qué va), Envíos (cómo se manda) y
// el Comparativo de costos (cuánto costó y cuánto deja). Nico y Pau pidieron
// verla en un solo lugar, tarjeta por tarjeta.
//
// NADA se vuelve a calcular aquí. Los números se le piden a los mismos handlers
// que pintan esas pantallas —`costos`, `ventas-folios` y `surtir`— para que el
// tablero no pueda decir una cosa y el Comparativo otra. Por eso también viene
// en dos partes: la LISTA trae lo que se ve de cada tarjeta cerrada, y el
// DETALLE de una venta se pide al abrirla. Traer el detalle de 300 ventas de
// golpe sería cruzar seis hojas trescientas veces.
const core = require('../core');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
               'septiembre','octubre','noviembre','diciembre'];
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9,
  oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };

const txt = (v) => String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^#(VALUE|REF|DIV|N\/A|NAME|NUM|NULL)/i.test(t)) return 0;
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.replace(/,/g, ' ').replace(/\s+/g, ' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  return null;
}
function fechaTxt(n) {
  if (!n) return '';
  const a = Math.floor(n / 10000), me = Math.floor((n % 10000) / 100), d = n % 100;
  return d + ' ' + (MESES[me - 1] || '') + ' ' + a;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
function redondea(n) { return Math.round((n || 0) * 100) / 100; }
function colLetra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [] }; }
  if (!values || !values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    // El número de fila REAL de la hoja. Contar los renglones leídos no sirve:
    // las filas vacías se saltan, así que el renglón 40 de la lista puede ser
    // el 46 de la hoja y se escribiría sobre otra cosa.
    Object.defineProperty(o, '__fila', { value: i + 1, enumerable: false });
    rows.push(o);
  }
  return { headers, rows, cfg };
}

// Se le pide el número a quien ya lo calcula, en vez de volver a calcularlo.
async function preguntar(modulo, cuerpo) {
  try {
    const h = require('./' + modulo);
    const r = await new Promise((resolve) => {
      const res = {
        status(c) { this._c = c; return this; },
        json(o) { resolve({ codigo: this._c || 200, cuerpo: o }); return this; }
      };
      h({ _body: cuerpo, query: {}, body: cuerpo }, res);
    });
    return r.codigo === 200 ? r.cuerpo : null;
  } catch (e) { return null; }
}

// El envío de cada folio, con lo que cuesta y lo que se cobró.
async function enviosPorFolio() {
  const env = await leer('op_envios');
  const out = {};
  if (!env.headers.length) return out;
  const H = env.headers;
  const eF = col(H, 'Pedido', 'Folio', 'No. de Referencia');
  if (!eF) return out;
  const eS = col(H, 'Status');
  const ePq = col(H, 'Paqueteria', 'Paquetería');
  const eG = col(H, 'Guía', 'Guia');
  const eZ = col(H, 'Zona');
  const eC = col(H, 'Ciudad');
  const eCo = col(H, 'Costo del Envío', 'Costo del Envio');
  const eCoI = col(H, 'Costo del Envío c / IVA', 'Costo del Envío c/IVA');
  const eCob = col(H, 'Cobrado al Cliente');
  const eUt = col(H, 'Utilidad del Envío', 'Utilidad del Envio');
  const eFe = col(H, 'Fecha Estimada de Entrega');
  const eRe = col(H, 'Fecha de Entrega Real');
  const ePz = col(H, 'Piezas');
  env.rows.forEach(r => {
    const f = norm(r[eF]);
    if (!f) return;
    const zona = txt(eZ ? r[eZ] : ''), ciudad = txt(eC ? r[eC] : '');
    // No hay columna que diga foráneo o local: se deduce de la zona, igual que
    // en Ventas por folio, para que las dos pantallas digan lo mismo.
    const local = /cdmx|ciudad de mexico|metropolitana|edomex|estado de mexico|local/
                  .test(norm(zona + ' ' + ciudad));
    out[f] = {
      status: txt(eS ? r[eS] : ''),
      paqueteria: txt(ePq ? r[ePq] : ''),
      guia: txt(eG ? r[eG] : ''),
      zona: zona || ciudad,
      donde: (zona || ciudad) ? (local ? 'local' : 'foráneo') : '',
      costo: eCo ? num(r[eCo]) : 0,
      costoConIva: eCoI ? num(r[eCoI]) : 0,
      cobrado: eCob ? num(r[eCob]) : 0,
      utilidad: eUt ? num(r[eUt]) : 0,
      piezas: ePz ? num(r[ePz]) : 0,
      estimada: fechaTxt(eFe ? fechaNum(r[eFe]) : 0),
      real: fechaTxt(eRe ? fechaNum(r[eRe]) : 0)
    };
  });
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    if (core.puedeVerArea && !core.puedeVerArea(sesion.rol, 'venta_tablero')) {
      return res.status(403).json({ error: 'Tu usuario no tiene el tablero de la venta.' });
    }
    const folio = txt(body.folio);

    // ------------------------------------------------- ESCRIBIR: el pedido
    //
    // El status de la pieza y lo que hay que decirle al proveedor. Las dos cosas
    // viven en el renglón del PEDIDO, no en la venta: el status es el de
    // fabricación y las instrucciones son las que salen impresas en la orden de
    // compra (la columna "Especificaciones"). Se escribe solo esa celda, nunca
    // el renglón entero, para no tocar fórmulas ni pisar lo que capturó alguien.
    if (body.hacer === 'pedido-nota') {
      if (core.verifyWriter && !core.verifyWriter(body.token)) {
        return res.status(403).json({ error: 'Tu usuario no puede editar pedidos.' });
      }
      const no = txt(body.pedido);
      if (!no) return res.status(400).json({ error: 'Falta el número de pedido.' });
      const ped = await leer('prov_pedidos');
      if (!ped.headers.length) {
        return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });
      }
      const H = ped.headers;
      const hNo = col(H, 'Pedido Proveedor', 'Pedido');
      const hProd = col(H, 'Productos', 'Producto', 'Item');
      const hMat = col(H, 'Material');
      const hSt = col(H, 'Status');
      const hEsp = col(H, 'Especificaciones');
      if (!hNo || !hProd) {
        return res.status(400).json({ error: 'La hoja de pedidos no tiene Pedido o Productos.' });
      }
      const quiero = norm(body.producto) + '|' + norm(body.material);
      const hoja = await core.resolveSheetName(ped.cfg);
      const data = [];
      let tocadas = 0;
      ped.rows.forEach(r => {
        if (norm(r[hNo]) !== norm(no)) return;
        if (norm(r[hProd]) + '|' + norm(hMat ? r[hMat] : '') !== quiero) return;
        const fila = r.__fila;
        tocadas++;
        if (body.status !== undefined && hSt) {
          data.push({ range: "'" + hoja + "'!" + colLetra(H.indexOf(hSt)) + fila,
                      values: [[txt(body.status)]] });
        }
        if (body.nota !== undefined && hEsp) {
          data.push({ range: "'" + hoja + "'!" + colLetra(H.indexOf(hEsp)) + fila,
                      values: [[txt(body.nota)]] });
        }
      });
      if (!tocadas) {
        return res.status(404).json({
          error: 'No encontré esa pieza en el pedido ' + no + '.',
          pista: 'Puede que en el pedido esté escrita distinto que en la venta.'
        });
      }
      if (!data.length) {
        return res.status(400).json({ error: 'No hay nada que guardar.' });
      }
      await core.writeCells(ped.cfg.id, data);
      return res.status(200).json({ ok: true, renglones: tocadas,
        mensaje: 'Listo: ' + tocadas + (tocadas === 1 ? ' renglón' : ' renglones') +
                 ' del pedido ' + no + '.' });
    }

    // ------------------------------------------------- ESCRIBIR: el envío
    if (body.hacer === 'envio') {
      if (core.verifyWriter && !core.verifyWriter(body.token)) {
        return res.status(403).json({ error: 'Tu usuario no puede editar envíos.' });
      }
      if (!folio) return res.status(400).json({ error: 'Falta el folio de la venta.' });
      const cfg = core.areaCfg ? await core.areaCfg('op_envios') : core.SHEETS.op_envios;
      if (!cfg || !cfg.id) {
        return res.status(400).json({ error: 'El área de Envíos no está conectada.' });
      }
      const env = await leer('op_envios');
      const H = env.headers;
      if (!H.length) return res.status(400).json({ error: 'No se pudo leer Envíos.' });
      const eF = col(H, 'Pedido', 'Folio', 'No. de Referencia');
      if (!eF) return res.status(400).json({ error: 'La hoja de Envíos no tiene columna de folio.' });
      // Qué se puede cambiar desde la tarjeta. El costo con IVA y la utilidad no
      // se escriben: en la hoja son fórmula.
      const campos = {
        'Status': body.status, 'Paqueteria': body.paqueteria, 'Guía': body.guia,
        'Zona': body.zona, 'Ciudad': body.ciudad,
        'Cobrado al Cliente': body.cobrado, 'Costo del Envío': body.costo,
        'Fecha Estimada de Entrega': body.estimada, 'Cliente': body.cliente,
        'Piezas': body.piezas
      };
      const r0 = env.rows.filter(r => norm(r[eF]) === norm(folio))[0];
      if (!r0) {
        // Todavía no existe: se agrega el renglón con lo que se capturó
        const rec = { [eF]: folio };
        Object.keys(campos).forEach(k => {
          const h2 = col(H, k, k.replace('í', 'i'));
          if (h2 && campos[k] !== undefined && txt(campos[k]) !== '') rec[h2] = campos[k];
        });
        const hFe = col(H, 'Fecha');
        if (hFe && !rec[hFe]) {
          const d = new Date();
          rec[hFe] = d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
        }
        const r2 = await core.addRecord('op_envios', rec);
        return res.status(200).json({ ok: true, creado: true, detalle: r2,
          mensaje: 'Se creó el envío de ' + folio + '.' });
      }
      const hoja = await core.resolveSheetName(cfg);
      const fila = r0.__fila;
      const data = [];
      Object.keys(campos).forEach(k => {
        if (campos[k] === undefined) return;
        const h2 = col(H, k, k.replace('í', 'i'));
        if (!h2) return;
        data.push({ range: "'" + hoja + "'!" + colLetra(H.indexOf(h2)) + fila,
                    values: [[campos[k]]] });
      });
      if (!data.length) return res.status(400).json({ error: 'No hay nada que guardar.' });
      await core.writeCells(cfg.id, data);
      return res.status(200).json({ ok: true, creado: false,
        mensaje: 'Envío de ' + folio + ' actualizado.' });
    }

    // ---------------------------------------------------------------- DETALLE
    if (folio) {
      const [sur, env, ven, ped] = await Promise.all([
        preguntar('surtir', { token: body.token, todas: 1 }),
        enviosPorFolio(),
        leer('ventas_registro'),
        // Las instrucciones que ya trae cada renglón del pedido: son las que
        // salen impresas en la orden de compra, y hay que enseñarlas antes de
        // dejar que alguien las cambie.
        leer('prov_pedidos')
      ]);
      if (!sur || !sur.ventas) {
        return res.status(502).json({
          error: 'No se pudo leer el estado de producción de la venta.',
          pista: 'Es lo mismo que alimenta Surtir ventas. Revisa esa pantalla.'
        });
      }
      const v = sur.ventas.filter(x => norm(x.folio) === norm(folio))[0];

      const instruccionesDe = {};
      if (ped.headers.length) {
        const qNo = col(ped.headers, 'Pedido Proveedor', 'Pedido');
        const qPr = col(ped.headers, 'Productos', 'Producto', 'Item');
        const qMa = col(ped.headers, 'Material');
        const qEs = col(ped.headers, 'Especificaciones');
        if (qNo && qPr && qEs) ped.rows.forEach(r => {
          const k = norm(r[qNo]) + '|' + norm(r[qPr]) + '|' + norm(qMa ? r[qMa] : '');
          const t = txt(r[qEs]);
          if (t && !instruccionesDe[k]) instruccionesDe[k] = t;
        });
      }

      // Lo que dice la hoja de ventas de esa venta: comentarios, envío y fechas
      const H = ven.headers;
      const vFol = col(H, 'No. de Referencia', 'Folio');
      const vCom = col(H, 'Comentarios');
      const vComL = col(H, 'Comentarios de logística', 'Comentarios logistica');
      const vEsp = col(H, 'Especificaciones');
      const vPro = col(H, 'Producto', 'Productos');
      const vMat = col(H, 'Material');
      const vEnv = col(H, 'Envio', 'Envío');
      const vCEnv = col(H, 'Costo Envío', 'Costo Envio');
      const vAco = col(H, 'Fecha de entrega acordada');
      const vReal = col(H, 'Fecha de Entrega Real', 'Fecha de entrega real');
      const vVend = col(H, 'Vendedor');
      const vDesp = col(H, 'Despacho');
      const vSta = col(H, 'Status');
      const comentarios = [];
      const espPorPieza = {};
      let envioVenta = 0, costoEnvioVenta = 0, acordada = '', real = '';
      let vendedor = '', despacho = '', status = '';
      (vFol ? ven.rows : []).forEach(r => {
        if (norm(r[vFol]) !== norm(folio)) return;
        [vCom, vComL].forEach(c => {
          const t = c ? txt(r[c]) : '';
          if (t && comentarios.indexOf(t) === -1) comentarios.push(t);
        });
        const e = vEsp ? txt(r[vEsp]) : '';
        if (e) {
          const k = norm(vPro ? r[vPro] : '') + '|' + norm(vMat ? r[vMat] : '');
          if (espPorPieza[k] && espPorPieza[k] !== e) espPorPieza[k] += ' · ' + e;
          else espPorPieza[k] = e;
        }
        envioVenta += vEnv ? num(r[vEnv]) : 0;
        costoEnvioVenta += vCEnv ? num(r[vCEnv]) : 0;
        if (!acordada && vAco) acordada = fechaTxt(fechaNum(r[vAco]));
        if (!real && vReal) real = fechaTxt(fechaNum(r[vReal]));
        if (!vendedor && vVend) vendedor = txt(r[vVend]);
        if (!despacho && vDesp) despacho = txt(r[vDesp]);
        if (!status && vSta) status = txt(r[vSta]);
      });

      if (!v) {
        // La venta existe en la hoja pero Surtir la dejó fuera (cancelada, sin
        // producto, sin cantidad). Se dice cuál es el motivo en vez de un vacío.
        const porque = (sur.fuera || []).filter(x => norm(x.folio) === norm(folio))[0];
        return res.status(200).json({
          ok: true, folio, vacia: true,
          porque: porque ? porque.porque : [],
          comentarios, status, vendedor, despacho,
          envio: env[norm(folio)] || null
        });
      }

      // Cada renglón con sus componentes: quién lo hace, en qué pedido y cómo va.
      const piezas = (v.piezas || []).map(p => {
        const k = norm(p.producto) + '|' + norm(p.material);
        return {
          producto: p.producto, material: p.material,
          materialExtra: p.materialExtra || '',
          tela: p.tela || '',
          cantidad: p.vendidas,
          especificaciones: p.especificaciones || espPorPieza[k] || '',
          faltaVariante: p.faltaVariante || null,
          // El objeto tal cual lo arma Surtir ventas. Va completo porque el
          // diálogo de surtir es EL MISMO: desde la tarjeta se abre el que ya
          // existe en vez de escribir otro que haga lo mismo peor.
          crudo: p,
          componentes: (p.partes || []).map(q => {
            const ped2 = (q.pedidos || [])[0] || null;
            // En qué va esta parte, en una palabra.
            //
            // "Surtido" es SALIÓ DE BODEGA, no "ya no falta nada por hacer".
            // Surtir ventas da por cerrada una parte cuando lo surtido MÁS lo
            // pedido cubre lo vendido —para no volver a pedir lo mismo—, y el
            // tablero copiaba esa bandera: una pieza apenas encargada al
            // proveedor salía como *Surtido* y Nico preguntaba, con razón, por
            // qué la venta seguía sin costo real. El costo real sale de las
            // salidas registradas; mientras la pieza no salga de bodega no hay
            // costo, y el tablero tiene que decir *Pedido*.
            const yaSalio = Math.round(q.surtidas) >= Math.round(p.vendidas);
            const estado = yaSalio ? 'surtido'
                         : (q.pedidas > 0 ? 'pedido'
                         : (p.faltaVariante ? 'por definir' : 'por surtir'));
            return {
              crudo: q,
              componente: q.componente, estado,
              vendidas: p.vendidas,
              surtidas: q.surtidas, falta: q.falta, pedidas: q.pedidas,
              // El proveedor y el pedido de verdad: el del renglón del pedido.
              // Si todavía no se ha pedido, quién la ha hecho antes.
              proveedor: ped2 ? ped2.proveedor : '',
              pedido: ped2 ? ped2.pedido : '',
              statusPedido: ped2 ? (ped2.status || '') : '',
              llega: ped2 ? (ped2.llega || '') : '',
              pedidoFecha: ped2 ? (ped2.fecha || '') : '',
              otrosPedidos: (q.pedidos || []).slice(1),
              instrucciones: ped2 ? (instruccionesDe[
                norm(ped2.pedido) + '|' + norm(p.producto) + '|' + norm(q.componente)] || '') : '',
              // Lo que hay en bodega para esa pieza, por si se surte de ahí
              enBodega: q.enBodega || 0,
              candidatos: (q.proveedores || []).map(x => x.proveedor).slice(0, 4)
            };
          })
        };
      });

      return res.status(200).json({
        ok: true, folio: v.folio, cliente: v.cliente, fecha: v.fecha,
        status, vendedor, despacho,
        ficha: v.ficha || {},
        comentarios,
        entregada: !!v.entregada,
        faltanSalidas: v.faltanSalidas || 0,
        acordada, entregadaEl: real,
        piezas,
        // Lo que el diálogo de surtir necesita saber de todas las ventas:
        // quiénes son los proveedores, qué pedidos están abiertos y qué número
        // toca proponer para cada uno.
        proveedoresTodos: sur.proveedoresTodos || [],
        pedidosAbiertos: sur.pedidosAbiertos || {},
        pedidoSugerido: sur.pedidoSugerido || '',
        pedidoSugeridoPor: sur.pedidoSugeridoPor || {},
        // El envío: lo cobrado y lo que costó salen de la hoja de Envíos; si esa
        // venta todavía no tiene envío capturado, lo de la venta hace de respaldo.
        envio: Object.assign(
          { cobrado: redondea(envioVenta), costo: redondea(costoEnvioVenta),
            status: '', paqueteria: '', guia: '', donde: '', deLaVenta: true },
          env[norm(folio)] ? Object.assign({}, env[norm(folio)], { deLaVenta: false }) : {})
      });
    }

    // ------------------------------------------------------------------ LISTA
    const [cos, fol, env] = await Promise.all([
      preguntar('costos', { token: body.token }),
      preguntar('ventas-folios', { token: body.token, anio: +body.anio || 0 }),
      enviosPorFolio()
    ]);
    if (!fol || !fol.folios) {
      return res.status(502).json({
        error: 'No se pudieron leer las ventas.',
        pista: 'Es lo mismo que alimenta Ventas por folio.'
      });
    }
    const porFolio = {};
    ((cos || {}).folios || []).forEach(f => { porFolio[norm(f.folio)] = f; });

    const lista = fol.folios.map(f => {
      const c = porFolio[norm(f.folio)] || {};
      const e = env[norm(f.folio)] || null;
      return {
        folio: f.folio, cliente: f.cliente,
        fecha: f.fecha ? fechaTxt(f.fecha) : '',
        fechaNum: f.fecha || 0,
        status: f.status,
        piezas: f.piezas, renglones: (f.detalle || []).length,
        // Lo que se le vendió y lo que costó hacerlo. El costo y el margen son
        // los del Comparativo de costos, tal cual: aquí no se recalculan.
        venta: (c.venta === undefined) ? f.total : c.venta,
        costo: (c.costoReal === undefined) ? null : c.costoReal,
        margen: (c.margenReal === undefined) ? null : c.margenReal,
        descuento: c.descuento || 0,
        totalCalculado: c.totalCalculado || f.totalCalculado || 0,
        // Cómo va la producción, con las mismas palabras de Ventas por folio
        produccion: f.estado,
        // Lo que le falta de REGISTRO, que no es lo mismo que cómo va la
        // producción: una venta entregada y feliz con el cliente puede tener el
        // inventario mal porque nunca se capturó su salida de bodega.
        papeleo: f.papeleo || [],
        sinSalida: f.sinSalida || 0,
        sinPedido: f.sinPedido || 0,
        faltan: (f.faltan || []).reduce((a, x) => a + (x.piezas || 0), 0),
        proveedores: f.proveedores || [],
        pedidos: f.pedidos || [],
        envio: e ? { donde: e.donde, status: e.status, paqueteria: e.paqueteria,
                     guia: e.guia, cobrado: e.cobrado, costo: e.costo }
                 : (f.envio || null)
      };
    }).sort((a, b) => (b.fechaNum || 0) - (a.fechaNum || 0));

    // Exhibición no es una venta: va en su propia área.
    //
    // "Tener un área diferente o sacar de las ventas el apartado de exhibición"
    // (Nico, 6 nov). Esas piezas están capturadas en la hoja de Ventas con folio
    // o cliente "Exhibición", así que entraban en el conteo de ventas y en el
    // margen, donde no tienen nada que hacer: nadie las compró. Se mandan
    // marcadas y el tablero las separa; el resumen se arma solo con las ventas
    // de verdad.
    const esExhibicion = (v) => {
      const f = String(v.folio || '').trim().toLowerCase();
      const c = String(v.cliente || '').trim().toLowerCase();
      return /^(exhibici|showroom)/.test(f) || /^(exhibici|showroom)/.test(c);
    };
    lista.forEach(v => { v.exhibicion = esExhibicion(v); });
    const soloVentas = lista.filter(v => !v.exhibicion);
    const resumenDe = (ls) => ({
      ventas: ls.length,
      sinPedir: ls.filter(x => x.produccion === 'sin pedir').length,
      aMedias: ls.filter(x => x.produccion === 'a medias').length,
      completos: ls.filter(x => x.produccion === 'pedido completo').length,
      entregadas: ls.filter(x => x.produccion === 'entregada').length,
      // Entregadas a las que les falta registro: son las que dejan el
      // inventario sin certeza
      papeleo: ls.filter(x => (x.papeleo || []).length).length,
      piezasSinSalida: redondea(ls.reduce((a, x) => a + (x.sinSalida || 0), 0)),
      sinEnvio: ls.filter(x => !x.envio || !x.envio.donde).length,
      foraneos: ls.filter(x => x.envio && x.envio.donde === 'foráneo').length,
      locales: ls.filter(x => x.envio && x.envio.donde === 'local').length,
      venta: redondea(ls.reduce((a, x) => a + (x.costo !== null ? (x.venta || 0) : 0), 0)),
      costo: redondea(ls.reduce((a, x) => a + (x.costo || 0), 0)),
      sinCosto: ls.filter(x => x.costo === null).length
    });

    return res.status(200).json({
      ok: true,
      anio: fol.anio || null,
      ventas: lista,
      // El resumen de cada área, ya separado
      resumenExhibicion: resumenDe(lista.filter(v => v.exhibicion)),
      // Renglones de venta a los que la hoja no les bajó el total: el tablero
      // los calcula, pero hay que decirlo y hay que arreglar la hoja.
      sinFormulaTotal: (cos && cos.sinFormulaTotal && cos.sinFormulaTotal.length)
        ? cos.sinFormulaTotal : (fol.sinFormulaTotal || []),
      // Las entregadas se ven, pero no son trabajo pendiente; y el costo solo se
      // puede comparar donde hay costo real.
      resumen: resumenDe(soloVentas),
      // Si el comparativo no respondió, el tablero sale sin margen y lo dice,
      // en vez de enseñar ceros que parecen números.
      sinCostos: !cos ? 'No se pudo leer el Comparativo de costos: las tarjetas salen ' +
                        'sin costo de producción ni margen.' : ''
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
