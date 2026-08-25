// Arma el reporte de cierre de un mes con los datos de todas las áreas.
const core = require('../core');
const { reporteMensual } = require('../pdf-cierre');

const MESES_N = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','octubre','noviembre','diciembre'];
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
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
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
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
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const hoy = new Date();
    const anio = +body.anio || hoy.getFullYear();
    // Por defecto, el mes pasado: es el que se cierra
    let mes = +body.mes;
    if (!mes) { mes = hoy.getMonth(); if (mes === 0) mes = 12; }

    const [ven, sal, mkt, leads, show, cot, ped, ent, pag] = await Promise.all([
      leer('ventas_registro'), leer('prov_salidas'), leer('marketing'),
      leer('leads'), leer('showroom'), leer('cotizaciones'),
      // Para la hoja de Operación: qué se pidió, qué llegó y qué se pagó en el mes
      leer('prov_pedidos'), leer('prov_entradas'), leer('pagos_pedidos')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });

    const H = ven.headers;
    const cFec = col(H, 'Fecha del Cierre', 'Fecha');
    const cRef = col(H, 'No. de Referencia', 'Folio');
    const cCli = col(H, 'Cliente');
    const cDes = col(H, 'Despacho');
    const cProd = col(H, 'Producto');
    const cCant = col(H, 'Cantidad');
    const cTot = col(H, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
    const cEnv = col(H, 'Envio', 'Envío');
    const cDesc = col(H, 'Descuentos');
    const cVend = col(H, 'Vendedor');
    if (!cFec || !cTot) return res.status(400).json({ error: 'VENTAS no tiene fecha o total.' });

    // El costo real: de las salidas de inventario, por folio y producto
    const costoDe = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio cliente', 'Folio');
      const sI = col(sal.headers, 'Item', 'Producto', 'Productos');
      const sC = col(sal.headers, 'Costo', 'Costo Total');
      const sCU = col(sal.headers, 'Costo Unitario');
      const sCant = col(sal.headers, 'Cantidad');
      if (sF) sal.rows.forEach(r => {
        const k = norm(r[sF]) + '|' + norm(sI ? r[sI] : '');
        let c = sC ? num(r[sC]) : 0;
        if (!c && sCU && sCant) c = num(r[sCU]) * num(r[sCant]);
        if (!c) return;
        costoDe[k] = (costoDe[k] || 0) + c;
      });
    }

    // --- Las ventas del mes ---
    const porMesAnio = {};
    const delMes = [];
    const folios = {}, clientes = {}, productos = {};
    let total = 0, envios = 0, descuentos = 0, piezas = 0, costo = 0;

    ven.rows.forEach(r => {
      const d = fechaNum(r[cFec]);
      if (d === null) return;
      const a = Math.floor(d / 10000), m = Math.floor(d / 100) % 100;
      const t = num(r[cTot]);
      if (a === anio) porMesAnio[m] = (porMesAnio[m] || 0) + t;
      if (a !== anio || m !== mes) return;
      delMes.push(r);
      total += t;
      envios += cEnv ? num(r[cEnv]) : 0;
      descuentos += cDesc ? num(r[cDesc]) : 0;
      const q = cCant ? num(r[cCant]) : 0;
      piezas += q;
      const folio = txt(cRef ? r[cRef] : '');
      if (folio) folios[folio] = 1;
      const prod = txt(cProd ? r[cProd] : '');
      if (prod) {
        if (!productos[prod]) productos[prod] = { nombre: prod, total: 0, piezas: 0 };
        productos[prod].total += t;
        productos[prod].piezas += q;
      }
      const cli = txt(cCli ? r[cCli] : '');
      if (cli) {
        if (!clientes[cli]) clientes[cli] = { nombre: cli, despacho: txt(cDes ? r[cDes] : ''),
                                              total: 0, folios: {} };
        clientes[cli].total += t;
        if (folio) clientes[cli].folios[folio] = 1;
      }
      // Costo de esa línea
      const k = norm(folio) + '|' + norm(prod);
      if (costoDe[k]) { costo += costoDe[k]; delete costoDe[k]; }
    });

    // Clientes que compran por primera vez
    let nuevos = 0;
    const primeraVezDe = {};
    ven.rows.forEach(r => {
      const cli = norm(cCli ? r[cCli] : '');
      const d = fechaNum(r[cFec]);
      if (!cli || d === null) return;
      if (primeraVezDe[cli] == null || d < primeraVezDe[cli]) primeraVezDe[cli] = d;
    });
    Object.keys(clientes).forEach(c => {
      const p = primeraVezDe[norm(c)];
      if (p && Math.floor(p / 10000) === anio && Math.floor(p / 100) % 100 === mes) nuevos++;
    });

    // --- El mes anterior, para comparar ---
    let mesPrev = mes - 1, anioPrev = anio;
    if (mesPrev < 1) { mesPrev = 12; anioPrev = anio - 1; }
    let totalPrev = 0;
    ven.rows.forEach(r => {
      const d = fechaNum(r[cFec]);
      if (d === null) return;
      if (Math.floor(d / 10000) === anioPrev && Math.floor(d / 100) % 100 === mesPrev) {
        totalPrev += num(r[cTot]);
      }
    });

    // --- Marketing: de dónde llegaron ---
    const canales = {};
    if (mkt.headers.length) {
      const mF = col(mkt.headers, 'Fecha del Cierre', 'Fecha');
      const mC = col(mkt.headers, 'Cómo llegó', 'Como llego', 'Canal', 'Cómo nos conoció');
      const mRef = col(mkt.headers, 'No. de Referencia', 'Folio');
      if (mC) mkt.rows.forEach(r => {
        const d = mF ? fechaNum(r[mF]) : null;
        if (d !== null && (Math.floor(d / 10000) !== anio || Math.floor(d / 100) % 100 !== mes)) return;
        const folio = txt(mRef ? r[mRef] : '');
        if (folio && !folios[folio]) return;
        const canal = txt(r[mC]) || 'Sin especificar';
        if (!canales[canal]) canales[canal] = { canal, total: 0, n: 0 };
        canales[canal].n++;
        // Se le atribuye lo vendido de ese folio
        if (folio) {
          ven.rows.forEach(v2 => {
            if (norm(v2[cRef]) === norm(folio)) canales[canal].total += num(v2[cTot]);
          });
        }
      });
    }

    // --- El embudo del mes ---
    const cuentaMes = (hoja, campoFecha) => {
      if (!hoja.headers.length) return 0;
      const c = col(hoja.headers, ...(campoFecha || ['Fecha']));
      if (!c) return 0;
      const vistos = {};
      let n = 0;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[c]);
        if (d === null) return;
        if (Math.floor(d / 10000) !== anio || Math.floor(d / 100) % 100 !== mes) return;
        n++;
      });
      return n;
    };
    const nCot = (() => {
      if (!cot.headers.length) return 0;
      const c = col(cot.headers, 'Fecha del Cierre', 'Fecha');
      const rf = col(cot.headers, 'No. de Referencia', 'Folio');
      if (!c) return 0;
      const vistos = {};
      cot.rows.forEach(r => {
        const d = fechaNum(r[c]);
        if (d === null) return;
        if (Math.floor(d / 10000) !== anio || Math.floor(d / 100) % 100 !== mes) return;
        vistos[txt(rf ? r[rf] : r._fila)] = 1;
      });
      return Object.keys(vistos).length;
    })();

    const red = (n) => Math.round(n * 100) / 100;
    const nVentas = Object.keys(folios).length;
    const utilidad = costo > 0 ? red(total - costo) : null;

    // ===== Hoja de Operación: qué se pidió, qué llegó, qué salió y qué se pagó =====
    // Es el reporte que presenta Nico. Todo del mes que se está cerrando.
    const esDelMes = (d) => d !== null && Math.floor(d / 10000) === anio &&
                          Math.floor(d / 100) % 100 === mes;
    const operacion = (() => {
      const o = { pedido: { piezas: 0, monto: 0, pedidos: 0 },
                  recibido: { piezas: 0 }, entregado: { piezas: 0, folios: 0 },
                  pagado: { monto: 0, n: 0 }, porProveedor: [], sinFecha: 0 };
      const provs = {};
      // Lo pedido
      if (ped.headers.length) {
        const Hp = ped.headers;
        const f = col(Hp, 'Fecha'), c = col(Hp, 'Cantidad');
        const cu = col(Hp, 'Costo Unitario'), p = col(Hp, 'Proveedor');
        const pd = col(Hp, 'Pedido Proveedor', 'Pedido');
        const folios = {};
        ped.rows.forEach(r => {
          const d = f ? fechaNum(r[f]) : null;
          if (d === null) { o.sinFecha++; return; }
          if (!esDelMes(d)) return;
          const piezas = c ? num(r[c]) : 0;
          const monto = piezas * (cu ? num(r[cu]) : 0);
          o.pedido.piezas += piezas;
          o.pedido.monto += monto;
          if (pd && txt(r[pd])) folios[txt(r[pd])] = 1;
          const quien = txt(p ? r[p] : '') || 'Sin proveedor';
          const g = provs[quien] = provs[quien] || { proveedor: quien, piezas: 0, monto: 0, recibidas: 0 };
          g.piezas += piezas; g.monto += monto;
        });
        o.pedido.pedidos = Object.keys(folios).length;
      }
      // Lo que llegó
      if (ent.headers.length) {
        const He = ent.headers;
        const f = col(He, 'Fecha'), c = col(He, 'Cantidad'), p = col(He, 'Proveedor');
        ent.rows.forEach(r => {
          const d = f ? fechaNum(r[f]) : null;
          if (!esDelMes(d)) return;
          const piezas = c ? num(r[c]) : 0;
          o.recibido.piezas += piezas;
          const quien = txt(p ? r[p] : '');
          if (quien && provs[quien]) provs[quien].recibidas += piezas;
        });
      }
      // Lo que salió a clientes
      if (sal.headers.length) {
        const Hs = sal.headers;
        const f = col(Hs, 'Fecha'), c = col(Hs, 'Cantidad');
        const fol = col(Hs, 'Folio cliente', 'Folio');
        const folios = {};
        sal.rows.forEach(r => {
          const d = f ? fechaNum(r[f]) : null;
          if (!esDelMes(d)) return;
          o.entregado.piezas += c ? num(r[c]) : 0;
          const k = txt(fol ? r[fol] : '');
          if (k) folios[k] = 1;
        });
        o.entregado.folios = Object.keys(folios).length;
      }
      // Lo que se pagó a proveedores
      if (pag.headers.length) {
        const Hg = pag.headers;
        const f = col(Hg, 'Fecha de pago', 'Fecha pago', 'Fecha');
        const t = col(Hg, 'Total con IVA', 'Total', 'Monto');
        const pgd = col(Hg, 'Pagado');
        pag.rows.forEach(r => {
          if (pgd) {
            const v = norm(r[pgd]);
            if (!(v === 'true' || v === 'si' || v === 'sí' || v === 'x' || v === '1' ||
                  v === 'verdadero' || v === 'pagado')) return;
          }
          const d = f ? fechaNum(r[f]) : null;
          if (!esDelMes(d)) return;
          o.pagado.monto += t ? num(r[t]) : 0;
          o.pagado.n++;
        });
      }
      o.pedido.monto = red(o.pedido.monto);
      o.pagado.monto = red(o.pagado.monto);
      o.porProveedor = Object.keys(provs).map(k => provs[k])
        .map(g => ({ proveedor: g.proveedor, piezas: Math.round(g.piezas),
                     monto: red(g.monto), recibidas: Math.round(g.recibidas) }))
        .sort((a, b) => b.monto - a.monto)
        .slice(0, 12);
      return o;
    })();

    // ===== Reporte de Ventas: las nueve secciones =====
    // Todo se calcula tres veces: el mes, el mismo mes del año pasado y el acumulado
    // de cada año. Así cada número trae con qué compararse.
    const cTipo = col(H, 'Tipo de producto', 'Tipo de Producto', 'Categoria', 'Categoría');
    const cCliTipo = col(H, 'Tipo de cliente', 'Tipo de Cliente');
    const cCanal = col(H, 'Cómo llegó', 'Como llego', 'Cómo nos encontró', 'Canal');
    const cCostoU = col(H, 'Costo Unitario');
    const cCostoT = col(H, 'Costo total', 'Costo Total');

    const esDe = (r, a, m) => {
      const d = fechaNum(r[cFec]);
      if (d === null) return false;
      if (Math.floor(d / 10000) !== a) return false;
      return m == null ? true : Math.floor(d / 100) % 100 === m;
    };
    // Se rearma el índice de costos porque el de arriba se va vaciando al usarse
    const costoTodo = {};
    if (sal.headers.length) {
      const sF = col(sal.headers, 'Folio cliente', 'Folio');
      const sI = col(sal.headers, 'Producto', 'Productos', 'Item');
      const sC = col(sal.headers, 'Costo Total', 'Costo');
      const sCU = col(sal.headers, 'Costo Unitario');
      const sCant = col(sal.headers, 'Cantidad');
      if (sF) sal.rows.forEach(r => {
        const k = norm(r[sF]) + '|' + norm(sI ? r[sI] : '');
        let c = sC ? num(r[sC]) : 0;
        if (!c && sCU && sCant) c = num(r[sCU]) * num(r[sCant]);
        if (!c) return;
        costoTodo[k] = (costoTodo[k] || 0) + c;
      });
    }

    // El costo de un renglón: primero el real de Salidas, si no el de la hoja
    const costoLinea = (r) => {
      const folio = txt(cRef ? r[cRef] : '');
      const prod = txt(cProd ? r[cProd] : '');
      const k = norm(folio) + '|' + norm(prod);
      if (costoTodo[k]) return costoTodo[k];
      if (cCostoT && num(r[cCostoT])) return num(r[cCostoT]);
      if (cCostoU && cCant) return num(r[cCostoU]) * num(r[cCant]);
      return 0;
    };
    // Un bloque de números para un conjunto de renglones
    const resumenDe = (filas) => {
      let v = 0, c = 0, p = 0;
      const fol = {};
      filas.forEach(r => {
        v += num(r[cTot]);
        c += costoLinea(r);
        p += cCant ? num(r[cCant]) : 0;
        const f = txt(cRef ? r[cRef] : '');
        if (f) fol[f] = 1;
      });
      return { venta: red(v), costo: red(c), utilidad: red(v - c),
               margen: v ? red(((v - c) / v) * 100) : null,
               piezas: Math.round(p), operaciones: Object.keys(fol).length };
    };
    // Lo mismo pero partido por una columna (tipo de mueble, canal, etc.)
    const porColumna = (filas, columna) => {
      const g = {};
      filas.forEach(r => {
        const k = txt(columna ? r[columna] : '') || 'Sin clasificar';
        (g[k] = g[k] || []).push(r);
      });
      return Object.keys(g).map(k => Object.assign({ nombre: k }, resumenDe(g[k])));
    };

    const filasMes = ven.rows.filter(r => esDe(r, anio, mes));
    const filasMesAnt = ven.rows.filter(r => esDe(r, anio - 1, mes));
    const filasAnio = ven.rows.filter(r => esDe(r, anio, null));
    const filasAnioAnt = ven.rows.filter(r => esDe(r, anio - 1, null));

    // Tipo de mueble: el mes contra el mismo mes del año pasado, y año contra año
    const tiposVistos = {};
    [filasMes, filasMesAnt, filasAnio, filasAnioAnt].forEach(lista => {
      porColumna(lista, cTipo).forEach(x => { tiposVistos[x.nombre] = 1; });
    });
    const buscaTipo = (lista, nombre) => {
      const x = porColumna(lista, cTipo).filter(y => y.nombre === nombre)[0];
      return x || { venta: 0, costo: 0, utilidad: 0, margen: null, piezas: 0, operaciones: 0 };
    };
    const porTipo = Object.keys(tiposVistos).sort().map(t => {
      const m0 = buscaTipo(filasMes, t), m1 = buscaTipo(filasMesAnt, t);
      const a0 = buscaTipo(filasAnio, t), a1 = buscaTipo(filasAnioAnt, t);
      return {
        nombre: t,
        mes: m0, mesAnterior: m1,
        anio: a0, anioAnterior: a1,
        cambioMes: m1.venta ? red(((m0.venta - m1.venta) / m1.venta) * 100) : null,
        cambioAnio: a1.venta ? red(((a0.venta - a1.venta) / a1.venta) * 100) : null,
        cambioMargen: (m0.margen != null && m1.margen != null)
          ? red(m0.margen - m1.margen) : null
      };
    }).sort((a, b) => b.mes.venta - a.mes.venta);

    // La meta: sale de una pestaña "Metas" si existe (Mes | Año | Meta)
    let meta = null;
    try {
      const cfgM = core.SHEETS.ventas_registro;
      if (cfgM && cfgM.id) {
        const vm = await core.readRange(cfgM.id, 'Metas').catch(() => []);
        if (vm && vm.length) {
          const Hm = (vm[0] || []).map(x => String(x).trim());
          const iM = Hm.findIndex(x => norm(x) === 'mes');
          const iA = Hm.findIndex(x => norm(x) === 'ano' || norm(x) === 'año');
          const iV = Hm.findIndex(x => /meta/.test(norm(x)));
          if (iM !== -1 && iV !== -1) {
            for (let i = 1; i < vm.length; i++) {
              const f = vm[i] || [];
              const mm = parseInt(String(f[iM]).replace(/[^0-9]/g, ''), 10);
              const aa = iA === -1 ? anio : parseInt(String(f[iA]).replace(/[^0-9]/g, ''), 10);
              if (mm === mes && aa === anio) { meta = num(f[iV]); break; }
            }
          }
        }
      }
    } catch (e) { meta = null; }

    // Cotizaciones y el embudo, con su comparativo
    const cuentaDe = (hoja, a, m) => {
      if (!hoja.headers.length) return { n: 0, monto: 0 };
      const c = col(hoja.headers, 'Fecha');
      const t = col(hoja.headers, 'Total con envio sin impuestos', 'Total', 'Total Pedido');
      if (!c) return { n: 0, monto: 0 };
      const fol = {};
      let monto = 0;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[c]);
        if (d === null) return;
        if (Math.floor(d / 10000) !== a) return;
        if (m != null && Math.floor(d / 100) % 100 !== m) return;
        const ref = col(hoja.headers, 'No. de Referencia', 'Folio');
        const f = ref ? txt(r[ref]) : String(Math.random());
        fol[f] = 1;
        if (t) monto += num(r[t]);
      });
      return { n: Object.keys(fol).length, monto: red(monto) };
    };

    const ventasReporte = {
      mes: resumenDe(filasMes),
      mesAnterior: resumenDe(filasMesAnt),
      anio: resumenDe(filasAnio),
      anioAnterior: resumenDe(filasAnioAnt),
      meta: meta,
      vsMeta: meta ? red((resumenDe(filasMes).venta / meta) * 100) : null,
      porTipo: porTipo,
      marketingCanal: porColumna(filasMes, cCanal).sort((a, b) => b.venta - a.venta),
      marketingTipoCliente: porColumna(filasMes, cCliTipo).sort((a, b) => b.venta - a.venta),
      cotizaciones: {
        mes: cuentaDe(cot, anio, mes), mesAnterior: cuentaDe(cot, anio - 1, mes),
        anio: cuentaDe(cot, anio, null), anioAnterior: cuentaDe(cot, anio - 1, null)
      },
      // Leads y showroom son de este año: no hay contra qué compararlos todavía
      nuevos: {
        leads: cuentaMes(leads), visitas: cuentaMes(show),
        leadsAnio: cuentaDe(leads, anio, null).n,
        visitasAnio: cuentaDe(show, anio, null).n
      }
    };

    const datos = {
      mesNumero: mes,
      anio: anio,
      ventasReporte,
      operacion,
      ventas: {
        total: red(total), operaciones: nVentas, piezas: Math.round(piezas),
        ticket: nVentas ? red(total / nVentas) : 0,
        envios: red(envios), descuentos: red(descuentos),
        costo: costo > 0 ? red(costo) : null,
        utilidad,
        margenPct: (utilidad != null && total) ? (utilidad / total) * 100 : null
      },
      comparacion: {
        ventasPrev: red(totalPrev),
        ventasPct: totalPrev ? ((total - totalPrev) / totalPrev) * 100 : null
      },
      productos: Object.keys(productos).map(k => productos[k])
        .sort((a, b) => b.total - a.total)
        .map(p => ({ nombre: p.nombre, total: red(p.total), piezas: Math.round(p.piezas) })),
      clientes: Object.keys(clientes).map(k => {
        const c = clientes[k];
        return { nombre: c.nombre, despacho: c.despacho, total: red(c.total),
                 n: Object.keys(c.folios).length };
      }).sort((a, b) => b.total - a.total),
      clientesNuevos: nuevos,
      marketing: Object.keys(canales).map(k => ({
        canal: canales[k].canal, total: red(canales[k].total), n: canales[k].n
      })).sort((a, b) => b.total - a.total),
      embudo: {
        leads: cuentaMes(leads), visitas: cuentaMes(show),
        cotizaciones: nCot, ventas: nVentas,
        conversion: nCot ? (nVentas / nCot) * 100 : null
      },
      historico: Array.from({ length: 12 }, (_, i) => ({
        mes: i + 1, nombre: MESES_N[i], total: red(porMesAnio[i + 1] || 0)
      })).filter(x => x.total > 0 || x.mes <= mes),
      acumulado: red(Object.keys(porMesAnio).reduce((a, k) => a + porMesAnio[k], 0))
    };

    if (body.soloDatos) return res.status(200).json({ ok: true, datos, mes, anio });

    const buf = await reporteMensual(datos, {
      mes: MESES_N[mes - 1].charAt(0).toUpperCase() + MESES_N[mes - 1].slice(1) + ' ' + anio,
      subtitulo: 'Generado el ' + hoy.getDate() + ' de ' + MESES_N[hoy.getMonth()] +
                 ' de ' + hoy.getFullYear(),
      // 'ventas' = solo lo comercial, para que Ventas lo revise y lo firme.
      // Cualquier otra cosa = el reporte completo, con producción incluida.
      alcance: txt(body.alcance) === 'ventas' ? 'ventas' : 'todo',
      notas: txt(body.notas)
    });

    const esVentas = txt(body.alcance) === 'ventas';
    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      nombre: 'Perch - ' + (esVentas ? 'Ventas de ' : 'Cierre de ') +
              MESES_N[mes - 1] + ' ' + anio + '.pdf',
      resumen: { ventas: datos.ventas.total, operaciones: nVentas,
                 productos: datos.productos.length, clientes: datos.clientes.length }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
