// Cierre operativo del mes — lo que Nico necesita para cerrar producción.
//
// El cierre que ya existía es comercial: vive en Ventas y en el Dashboard, dos
// pantallas que el rol Operativo no tiene. Éste es el de su lado: qué se pidió,
// qué llegó, qué salió, qué se entregó y qué se pagó, todo del mes elegido.
//
// Cada bloque se corta con SU PROPIA fecha, que es como se cierra una
// operación: los pedidos por la fecha en que se colocaron, las entradas por la
// fecha en que llegaron, las salidas por la de la salida y las entregas por la
// fecha de entrega real. Nada se cuenta dos veces ni se arrastra de un mes a
// otro.
//
// La deuda con proveedores NO se vuelve a calcular aquí: se pide al mismo
// handler del Estado de cuenta, para que las dos pantallas no puedan dar
// números distintos.
const core = require('../core');
const CFG = require('../config');

const MESES_N = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9,
  oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };

function txt(v) { return String(v == null ? '' : v).trim().replace(/\s*\n\s*/g, ' '); }
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
  if (m && MESES[m[2]]) return +m[3] * 10000 + MESES[m[2]] * 100 + +m[1];
  return null;
}
function fechaTxt(n) {
  if (!n) return '';
  const a = Math.floor(n / 10000), me = Math.floor((n % 10000) / 100), d = n % 100;
  return d + ' ' + (MESES_N[me - 1] || '') + ' ' + a;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
function esSoloSaldo(nombre) {
  return /^\s*saldo inicial del corte/i.test(String(nombre || ''));
}
function redondea(n) { return Math.round((n || 0) * 100) / 100; }

async function leer(key, pestana) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, pestana || cfg.sheetName); }
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
    rows.push(o);
  }
  return { headers, rows };
}

// La deuda sale del Estado de cuenta de proveedores, tal cual, para que las dos
// pantallas no se contradigan. Si por lo que sea no responde, el cierre sale sin
// ese renglón y lo dice; nunca con una cifra calculada aparte.
async function deudaDeProveedores(token) {
  try {
    const h = require('./proveedores');
    const salida = await new Promise((resolve) => {
      const res = {
        status(c) { this._c = c; return this; },
        json(o) { resolve({ codigo: this._c || 200, cuerpo: o }); return this; }
      };
      h({ _body: { token }, query: {}, body: { token } }, res);
    });
    if (salida.codigo !== 200 || !salida.cuerpo || !salida.cuerpo.proveedores) return null;
    const provs = salida.cuerpo.proveedores;
    return {
      total: redondea(provs.reduce((a, p) => a + ((p.totales || {}).porPagar || 0), 0)),
      proveedores: provs
        .map(p => ({ proveedor: p.proveedor, porPagar: redondea((p.totales || {}).porPagar || 0) }))
        .filter(p => Math.abs(p.porPagar) > 0.5)
        .sort((a, b) => b.porPagar - a.porPagar)
        .slice(0, 12)
    };
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    // El permiso se revisa aquí, no solo escondiendo la entrada del menú: este
    // cierre trae costos y pagos a proveedores.
    if (core.puedeVerArea && !core.puedeVerArea(sesion.rol, 'op_cierre')) {
      return res.status(403).json({ error: 'Tu usuario no tiene el cierre operativo.' });
    }

    const hoy = new Date();
    const mes = +body.mes || (hoy.getMonth() + 1);
    const anio = +body.anio || hoy.getFullYear();
    if (mes < 1 || mes > 12) return res.status(400).json({ error: 'Mes fuera de rango.' });
    const desde = anio * 10000 + mes * 100 + 1;
    const hasta = anio * 10000 + mes * 100 + 31;
    const enElMes = (f) => f != null && f >= desde && f <= hasta;

    const [ped, ent, sal, ven, egr, pagosHoja] = await Promise.all([
      leer('prov_pedidos'), leer('prov_entradas'), leer('prov_salidas'),
      leer('ventas_registro'), leer('fin_egresos'),
      leer('prov_pedidos', 'Proveedores pagos')
    ]);
    if (!ped.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer "Pedidos a Proveedores".' });
    }

    const faltan = [];

    // ---------- 1. Pedidos colocados en el mes ----------
    const pFe = col(ped.headers, 'Fecha');
    const pPed = col(ped.headers, 'Pedido Proveedor', 'Pedido');
    const pProv = col(ped.headers, 'Proveedor');
    const pProd = col(ped.headers, 'Productos', 'Producto', 'Item');
    const pMat = col(ped.headers, 'Material');
    const pCant = col(ped.headers, 'Cantidad');
    const pCT = col(ped.headers, 'Costo Total + IVA', 'Costo Total');
    const pEst = col(ped.headers, 'Fecha Estimada de Entrega', 'Fecha estimada de entrega');
    const pSt = col(ped.headers, 'Status');
    const pFol = col(ped.headers, 'Folio cliente', 'Folio Cliente', 'Folio');
    const pDest = col(ped.headers, 'Destino');
    if (!pFe) faltan.push('"Fecha" en Pedidos a Proveedores');

    const provDePedido = {};             // número de pedido -> proveedor
    const porProvPed = {};
    const pedidosDelMes = {};
    let pedPiezas = 0, pedImporte = 0;
    ped.rows.forEach(r => {
      const prod = txt(pProd ? r[pProd] : '');
      if (!prod || esSoloSaldo(prod)) return;          // deuda del corte, no mueble
      const pedido = txt(pPed ? r[pPed] : '');
      const prov = txt(pProv ? r[pProv] : '') || '(sin proveedor)';
      if (pedido) provDePedido[norm(pedido)] = prov;
      // Un pedido cancelado no se colocó: no infla el mes
      if (/cancelad|anulad/.test(norm(pSt ? r[pSt] : ''))) return;
      if (!enElMes(pFe ? fechaNum(r[pFe]) : null)) return;
      const c = pCant ? num(r[pCant]) : 0;
      const imp = pCT ? num(r[pCT]) : 0;
      pedPiezas += c; pedImporte += imp;
      if (pedido) pedidosDelMes[norm(pedido)] = 1;
      const k = norm(prov);
      const a = porProvPed[k] = porProvPed[k] ||
        { proveedor: prov, pedidos: {}, piezas: 0, importe: 0 };
      if (pedido) a.pedidos[norm(pedido)] = 1;
      a.piezas += c; a.importe += imp;
    });

    // ---------- 2. Lo que llegó en el mes ----------
    const eFe = col(ent.headers, 'Fecha');
    const ePed = col(ent.headers, 'Pedido Proveedor', 'Pedido');
    const eProd = col(ent.headers, 'Item', 'Productos', 'Producto');
    const eCant = col(ent.headers, 'Cantidad');
    const eUbi = col(ent.headers, 'Ubicación', 'Ubicacion');
    const eMat = col(ent.headers, 'Material');
    // Lo recibido HASTA EL CIERRE del mes, no hasta hoy: lo que llegó en
    // diciembre no borra que en noviembre estaba atrasado.
    const recibidoPorPedido = {};        // pedido|producto|material -> piezas
    let entPiezas = 0, entExhibicion = 0;
    const porProvEnt = {};
    ent.rows.forEach(r => {
      const c = eCant ? num(r[eCant]) : 0;
      const f = eFe ? fechaNum(r[eFe]) : null;
      if (f == null || f <= hasta) {
        const k = norm(ePed ? r[ePed] : '') + '|' + norm(eProd ? r[eProd] : '') +
                  '|' + norm(eMat ? r[eMat] : '');
        recibidoPorPedido[k] = (recibidoPorPedido[k] || 0) + c;
      }
      if (!enElMes(f)) return;
      entPiezas += c;
      if (eUbi && /^(exhibici|showroom|piso)/i.test(txt(r[eUbi]))) entExhibicion += c;
      const prov = provDePedido[norm(ePed ? r[ePed] : '')] || '(sin pedido)';
      const a = porProvEnt[norm(prov)] = porProvEnt[norm(prov)] || { proveedor: prov, piezas: 0 };
      a.piezas += c;
    });

    // ---------- 3. Lo que salió de bodega en el mes ----------
    const sFe = col(sal.headers, 'Fecha de cierre de venta', 'Fecha');
    const sFol = col(sal.headers, 'Folio', 'Folio cliente');
    const sCli = col(sal.headers, 'Cliente');
    const sCant = col(sal.headers, 'Cantidad');
    const sCT = col(sal.headers, 'Costo Total');
    let salPiezas = 0, salCosto = 0;
    const porFolioSal = {};
    sal.rows.forEach(r => {
      if (!enElMes(sFe ? fechaNum(r[sFe]) : null)) return;
      const c = sCant ? num(r[sCant]) : 0;
      salPiezas += c; salCosto += sCT ? num(r[sCT]) : 0;
      const f = txt(sFol ? r[sFol] : '').toUpperCase() || '(sin folio)';
      const a = porFolioSal[f] = porFolioSal[f] ||
        { folio: f, cliente: txt(sCli ? r[sCli] : ''), piezas: 0, costo: 0 };
      a.piezas += c; a.costo += sCT ? num(r[sCT]) : 0;
    });

    // ---------- 4. Pedidos atrasados al cierre del mes ----------
    // Lo prometido para esta fecha o antes que a fin de mes todavía no llegaba.
    const atrasados = [];
    ped.rows.forEach(r => {
      const prod = txt(pProd ? r[pProd] : '');
      if (!prod || esSoloSaldo(prod)) return;
      const est = pEst ? fechaNum(r[pEst]) : null;
      if (!est || est > hasta) return;
      const st = norm(pSt ? r[pSt] : '');
      if (/cancelad|anulad/.test(st)) return;
      const pedido = txt(pPed ? r[pPed] : '');
      const mat = txt(pMat ? r[pMat] : '');
      const pedidas = pCant ? num(r[pCant]) : 0;
      const k = norm(pedido) + '|' + norm(prod) + '|' + norm(mat);
      const llegaron = recibidoPorPedido[k] || 0;
      const faltanPzas = Math.round(pedidas - llegaron);
      if (faltanPzas <= 0) return;
      atrasados.push({
        pedido, proveedor: txt(pProv ? r[pProv] : ''), producto: prod, material: mat,
        piezas: faltanPzas, estimada: fechaTxt(est), estimadaNum: est,
        folio: txt(pFol ? r[pFol] : ''), destino: txt(pDest ? r[pDest] : '')
      });
    });
    atrasados.sort((a, b) => a.estimadaNum - b.estimadaNum);

    // ---------- 5. Entregas a clientes ----------
    const vRef = col(ven.headers, 'No. de Referencia', 'Folio');
    const vCli = col(ven.headers, 'Cliente');
    const vCant = col(ven.headers, 'Cantidad');
    const vSt = col(ven.headers, 'Status');
    const vAcor = col(ven.headers, 'Fecha de entrega acordada');
    const vReal = col(ven.headers, 'Fecha de Entrega Real', 'Fecha de entrega real');
    if (!vReal) faltan.push('"Fecha de Entrega Real" en VENTAS');
    const entregados = {}, pendientes = {};
    ven.rows.forEach(r => {
      const f = txt(vRef ? r[vRef] : '').toUpperCase();
      if (!f) return;
      if (/cancelad|anulad/.test(norm(vSt ? r[vSt] : ''))) return;
      const c = vCant ? num(r[vCant]) : 0;
      const real = vReal ? fechaNum(r[vReal]) : null;
      const acor = vAcor ? fechaNum(r[vAcor]) : null;
      if (enElMes(real)) {
        const a = entregados[f] = entregados[f] || {
          folio: f, cliente: txt(vCli ? r[vCli] : ''), piezas: 0,
          fecha: fechaTxt(real), fechaNum: real,
          acordada: acor ? fechaTxt(acor) : '', dias: null
        };
        a.piezas += c;
        if (acor && real && a.dias == null) {
          a.dias = diasEntre(acor, real);      // + llegó tarde, − se adelantó
          if (a.dias > 0) a.tarde = true;
        }
      } else if (!real && acor && acor <= hasta) {
        const a = pendientes[f] = pendientes[f] || {
          folio: f, cliente: txt(vCli ? r[vCli] : ''), piezas: 0,
          acordada: fechaTxt(acor), acordadaNum: acor
        };
        a.piezas += c;
      }
    });
    const listaEntregados = Object.keys(entregados).map(k => entregados[k])
      .sort((a, b) => a.fechaNum - b.fechaNum);
    const listaPendientes = Object.keys(pendientes).map(k => pendientes[k])
      .sort((a, b) => a.acordadaNum - b.acordadaNum);
    const piezasEntregadas = listaEntregados.reduce((a, x) => a + x.piezas, 0);

    // ---------- 6. Dinero: lo pagado en el mes ----------
    const gFe = col(egr.headers, 'Fecha', 'Fecha ');
    const gTot = col(egr.headers, 'Total');
    const gProv = col(egr.headers, 'Proveedor');
    const gPed = col(egr.headers, 'Pedido');
    const porProvPago = {};
    let pagado = 0, nPagos = 0;
    const sumaPago = (prov, pedido, monto, fuente) => {
      if (!monto) return;
      pagado += monto; nPagos++;
      const p = txt(prov) || (pedido ? ('pedido ' + txt(pedido)) : '(sin proveedor)');
      const a = porProvPago[norm(p)] = porProvPago[norm(p)] ||
        { proveedor: p, monto: 0, pagos: 0, fuente: fuente };
      a.monto += monto; a.pagos++;
    };
    egr.rows.forEach(r => {
      if (!enElMes(gFe ? fechaNum(r[gFe]) : null)) return;
      const ped2 = gPed ? txt(r[gPed]) : '';
      const prov = gProv ? txt(r[gProv]) : '';
      // Solo lo de producción: un egreso sin pedido ni proveedor es gasto de oficina
      if (!ped2 && !prov) return;
      sumaPago(prov, ped2, gTot ? num(r[gTot]) : 0, 'banco');
    });
    if (pagosHoja.headers.length) {
      const hFe = col(pagosHoja.headers, 'Fecha del pago', 'Fecha');
      const hMonto = col(pagosHoja.headers, 'Monto');
      const hProv = col(pagosHoja.headers, 'Proveedor');
      const hPed = col(pagosHoja.headers, 'Pedido');
      const hAj = col(pagosHoja.headers, '¿Es ajuste?', 'Es ajuste');
      pagosHoja.rows.forEach(r => {
        if (hAj && /^(s[ií]|x|1|true)$/i.test(txt(r[hAj]))) return;   // ajuste, no salió dinero
        if (!enElMes(hFe ? fechaNum(r[hFe]) : null)) return;
        sumaPago(hProv ? r[hProv] : '', hPed ? r[hPed] : '',
                 hMonto ? num(r[hMonto]) : 0, 'operación');
      });
    }
    const deuda = await deudaDeProveedores(body.token);

    // ---------- 7. El aviso que importa: lo entregado sin salida capturada ----------
    // Es el agujero conocido del inventario: la venta se entrega y la salida no
    // se registra, así que el Stock se queda con piezas que ya no están.
    const sinSalida = Math.round(piezasEntregadas - salPiezas);
    const ordena = (o, k) => Object.keys(o).map(x => o[x])
      .sort((a, b) => (b[k] || 0) - (a[k] || 0));

    return res.status(200).json({
      ok: true,
      mes, anio, etiqueta: (MESES_N[mes - 1] || '') + ' ' + anio,
      faltan,
      pedidos: {
        n: Object.keys(pedidosDelMes).length,
        piezas: pedPiezas, importe: redondea(pedImporte),
        porProveedor: ordena(porProvPed, 'importe').map(a => ({
          proveedor: a.proveedor, pedidos: Object.keys(a.pedidos).length,
          piezas: a.piezas, importe: redondea(a.importe)
        }))
      },
      entradas: {
        piezas: entPiezas, aExhibicion: entExhibicion,
        porProveedor: ordena(porProvEnt, 'piezas')
      },
      salidas: {
        piezas: salPiezas, costo: redondea(salCosto),
        folios: Object.keys(porFolioSal).length,
        porFolio: ordena(porFolioSal, 'piezas').map(a => ({
          folio: a.folio, cliente: a.cliente, piezas: a.piezas, costo: redondea(a.costo)
        }))
      },
      atrasados: {
        piezas: atrasados.reduce((a, x) => a + x.piezas, 0),
        renglones: atrasados.length,
        detalle: atrasados.slice(0, 60)
      },
      entregas: {
        folios: listaEntregados.length, piezas: piezasEntregadas,
        tarde: listaEntregados.filter(x => x.tarde).length,
        detalle: listaEntregados,
        pendientes: {
          folios: listaPendientes.length,
          piezas: listaPendientes.reduce((a, x) => a + x.piezas, 0),
          detalle: listaPendientes.slice(0, 60)
        }
      },
      dinero: {
        comprometido: redondea(pedImporte),
        pagado: redondea(pagado), nPagos,
        porProveedor: ordena(porProvPago, 'monto').map(a => ({
          proveedor: a.proveedor, monto: redondea(a.monto), pagos: a.pagos
        })).slice(0, 12),
        deuda: deuda,
        sinDeuda: deuda ? null : 'No se pudo leer el estado de cuenta de proveedores; el ' +
          'saldo por pagar se consulta en esa pantalla.'
      },
      inventario: {
        entraron: entPiezas, salieron: salPiezas,
        neto: Math.round(entPiezas - salPiezas),
        entregadasSinSalida: sinSalida > 0 ? sinSalida : 0,
        aviso: sinSalida > 0
          ? 'Se entregaron ' + piezasEntregadas + ' piezas y solo ' + salPiezas +
            ' tienen salida capturada: faltan ' + sinSalida + ' por registrar en Salidas. ' +
            'Mientras no se capturen, el Stock sigue contando piezas que ya no están.'
          : '',
        corte: CFG.CORTE_PROVEEDORES || ''
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};

// Días entre dos fechas en formato AAAAMMDD
function diasEntre(a, b) {
  const d = (n) => new Date(Math.floor(n / 10000), Math.floor((n % 10000) / 100) - 1, n % 100);
  return Math.round((d(b) - d(a)) / 86400000);
}
