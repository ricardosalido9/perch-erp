// Gastos operativos: cuánto cuesta operar cada mes y qué se salió del promedio.
//
// "Sueldos y salarios" sale del BRUTO de la nómina (devengado: lo que costó ese mes,
// se haya pagado o no). Las demás categorías salen de EGRESOS (flujo: cuándo salió
// el dinero). Es una mezcla a propósito, porque del resto no hay dato devengado.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
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
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

// Las categorías de gasto operativo. El orden es el que se muestra.
const CATEGORIAS = [
  'Sueldos y salarios',
  'Honorarios profesionales',
  'Materiales y suministros de oficina',
  'Cuotas y suscripciones',
  'Seguros y fianzas',
  'Arrendamiento de oficinas',
  'Gastos de viaje',
  'Otros gastos administrativos y generales',
  'Marketing y publicidad',
  'Comisiones bancarias y comerciales'
];
const NO_ES_GASTO = /traspaso|transferencia entre cuentas|entre cuentas|movimiento interno/i;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();
    const hoy = new Date();
    const mesActual = (hoy.getFullYear() === anio) ? hoy.getMonth() + 1 : 12;

    const [egr, nom] = await Promise.all([leer('fin_egresos'), leer('rh_nomina')]);
    if (!egr.headers.length) return res.status(400).json({ error: 'No se pudo leer EGRESOS.' });

    // categoría -> mes -> { monto, n, detalle }
    const datos = {};
    const guarda = (categoria, mes, monto, mov) => {
      if (!datos[categoria]) datos[categoria] = {};
      if (!datos[categoria][mes]) datos[categoria][mes] = { monto: 0, n: 0, detalle: [] };
      datos[categoria][mes].monto += monto;
      datos[categoria][mes].n++;
      if (mov && datos[categoria][mes].detalle.length < 25) datos[categoria][mes].detalle.push(mov);
    };

    // --- 1) Sueldos: del bruto de la nómina ---
    let sueldosDeNomina = false;
    if (nom.headers.length) {
      const nH = nom.headers;
      const nBruto = col(nH, 'Bruto', 'Subtotal');
      const nNeto = col(nH, 'Neto', 'Total');
      const nIni = col(nH, 'Fecha Inicio');
      const nMes = col(nH, 'Mes');
      const nNombre = col(nH, 'Nombre');
      const nArea = col(nH, 'Área', 'Area');
      if (nBruto || nNeto) {
        nom.rows.forEach(r => {
          const m = nBruto ? num(r[nBruto]) : 0;
          const mn = nNeto ? num(r[nNeto]) : 0;
          const monto = m || mn;
          if (!monto) return;
          const d = nIni ? fechaNum(r[nIni]) : null;
          let mes = null;
          if (d) {
            if (Math.floor(d / 10000) !== anio) return;
            mes = Math.floor(d / 100) % 100;
          } else {
            mes = parseInt(txt(nMes ? r[nMes] : ''), 10) || null;
          }
          if (!mes) return;
          guarda('Sueldos y salarios', mes, monto, {
            fecha: txt(nIni ? r[nIni] : ''), monto,
            concepto: txt(nNombre ? r[nNombre] : ''),
            proveedor: txt(nArea ? r[nArea] : '')
          });
        });
        sueldosDeNomina = true;
      }
    }

    // --- 2) Las demás categorías: de EGRESOS ---
    const H = egr.headers;
    const eCat = col(H, 'Categoría', 'Categoria');
    const eSub = col(H, 'Subcategoría', 'Subcategoria');
    const eCon = col(H, 'Concepto');
    const eTot = col(H, 'Total', 'Monto', 'Importe');
    const eFec = col(H, 'Fecha');
    const eDes = col(H, 'Descripción', 'Descripcion');
    const eProv = col(H, 'Proveedor');
    if (!eTot) return res.status(400).json({ error: 'EGRESOS no tiene columna de total.' });

    const catsNorm = {};
    CATEGORIAS.forEach(c => { catsNorm[norm(c)] = c; });
    const otrasCategorias = {};
    let sinCategoria = { n: 0, monto: 0 };
    const vistos = {};
    let repetidos = 0;

    egr.rows.forEach(r => {
      const monto = num(r[eTot]);
      if (!monto) return;
      const d = eFec ? fechaNum(r[eFec]) : null;
      if (d === null || Math.floor(d / 10000) !== anio) return;
      const texto = txt(eCon ? r[eCon] : '') + ' ' + txt(eDes ? r[eDes] : '');
      if (NO_ES_GASTO.test(texto)) return;
      const mes = Math.floor(d / 100) % 100;
      const cat = txt(eCat ? r[eCat] : '');
      const k = norm(cat);
      const oficial = catsNorm[k];
      const mov = {
        fila: r._fila, fecha: txt(r[eFec]), monto,
        concepto: txt(eCon ? r[eCon] : '') || txt(eSub ? r[eSub] : ''),
        proveedor: txt(eProv ? r[eProv] : ''),
        descripcion: txt(eDes ? r[eDes] : '').slice(0, 60)
      };
      // No se duplica el mismo movimiento capturado dos veces
      const huella = d + '|' + monto.toFixed(2) + '|' + norm(texto).slice(0, 50);
      if (vistos[huella]) { repetidos++; return; }
      vistos[huella] = true;

      if (oficial) {
        // Si los sueldos ya vinieron de la nómina, no se cuentan otra vez desde el banco
        if (oficial === 'Sueldos y salarios' && sueldosDeNomina) return;
        guarda(oficial, mes, monto, mov);
      } else if (!cat) {
        sinCategoria.n++; sinCategoria.monto += monto;
      } else {
        if (!otrasCategorias[cat]) otrasCategorias[cat] = { categoria: cat, monto: 0, n: 0 };
        otrasCategorias[cat].monto += monto;
        otrasCategorias[cat].n++;
      }
    });

    // --- 3) Se arma la tabla: una fila por categoría, una columna por mes ---
    const meses = [];
    for (let m = 1; m <= mesActual; m++) meses.push(m);

    const filas = CATEGORIAS.map(cat => {
      const porMes = meses.map(m => {
        const x = (datos[cat] || {})[m];
        return { mes: m, monto: x ? Math.round(x.monto * 100) / 100 : 0,
                 movimientos: x ? x.n : 0, detalle: x ? x.detalle : [] };
      });
      const conGasto = porMes.filter(x => x.monto > 0);
      const total = porMes.reduce((a, x) => a + x.monto, 0);
      // El promedio se saca solo de los meses en que hubo gasto: si un servicio
      // empezó en abril, no tiene sentido promediarlo contra enero.
      const promedio = conGasto.length ? total / conGasto.length : 0;
      // Recurrente: aparece en más de la mitad de los meses transcurridos
      const recurrente = conGasto.length >= Math.max(2, Math.ceil(mesActual * 0.5));
      // Contra el promedio, mes por mes
      const conDesvio = porMes.map(x => ({
        mes: x.mes, monto: x.monto, movimientos: x.movimientos, detalle: x.detalle,
        desvio: promedio ? Math.round(((x.monto - promedio) / promedio) * 100) : 0,
        sinGasto: x.monto === 0
      }));
      // El último mes con gasto, contra el promedio
      const ultimo = conGasto.length ? conGasto[conGasto.length - 1] : null;
      // ¿Dejó de aparecer? Recurrente pero sin gasto en el último mes cerrado
      const mesPrevio = mesActual > 1 ? mesActual - 1 : mesActual;
      const faltaEsteMes = recurrente &&
        !porMes.filter(x => x.mes === mesPrevio && x.monto > 0).length;
      return {
        categoria: cat,
        deNomina: cat === 'Sueldos y salarios' && sueldosDeNomina,
        porMes: conDesvio,
        total: Math.round(total * 100) / 100,
        promedio: Math.round(promedio * 100) / 100,
        mesesConGasto: conGasto.length,
        recurrente, faltaEsteMes,
        ultimoMonto: ultimo ? ultimo.monto : 0,
        ultimoDesvio: (ultimo && promedio) ? Math.round(((ultimo.monto - promedio) / promedio) * 100) : 0,
        // Tendencia: los últimos 3 meses contra los 3 anteriores
        tendencia: (() => {
          const c = conGasto.slice(-6);
          if (c.length < 4) return null;
          const mitad = Math.floor(c.length / 2);
          const viejos = c.slice(0, mitad).reduce((a, x) => a + x.monto, 0) / mitad;
          const nuevos = c.slice(mitad).reduce((a, x) => a + x.monto, 0) / (c.length - mitad);
          if (!viejos) return null;
          return Math.round(((nuevos - viejos) / viejos) * 100);
        })()
      };
    }).filter(f => f.total > 0);

    const totalPorMes = meses.map(m => ({
      mes: m,
      monto: Math.round(filas.reduce((a, f) => {
        const x = f.porMes.filter(y => y.mes === m)[0];
        return a + (x ? x.monto : 0);
      }, 0) * 100) / 100
    }));
    const totalAnio = Math.round(totalPorMes.reduce((a, x) => a + x.monto, 0) * 100) / 100;
    const mesesConGastoTotal = totalPorMes.filter(x => x.monto > 0).length;
    const promedioMensual = mesesConGastoTotal ? Math.round((totalAnio / mesesConGastoTotal) * 100) / 100 : 0;
    // El gasto fijo: solo las categorías recurrentes
    const fijas = filas.filter(f => f.recurrente);
    const gastoFijo = Math.round(fijas.reduce((a, f) => a + f.promedio, 0) * 100) / 100;

    const mesPrevio = mesActual > 1 ? mesActual - 1 : mesActual;
    const delMesPrevio = totalPorMes.filter(x => x.mes === mesPrevio)[0];

    return res.status(200).json({
      ok: true, anio, mesActual, mesPrevio,
      sueldosDeNomina,
      filas, meses, totalPorMes,
      totales: {
        totalAnio, promedioMensual, gastoFijo,
        categoriasRecurrentes: fijas.length,
        categoriasTotales: filas.length,
        ultimoMes: delMesPrevio ? delMesPrevio.monto : 0,
        desvioUltimoMes: (delMesPrevio && promedioMensual)
          ? Math.round(((delMesPrevio.monto - promedioMensual) / promedioMensual) * 100) : 0,
        repetidosIgnorados: repetidos
      },
      // Lo que quedó fuera, para que se pueda corregir la hoja
      sinCategoria: { n: sinCategoria.n, monto: Math.round(sinCategoria.monto * 100) / 100 },
      otrasCategorias: Object.keys(otrasCategorias).map(k => ({
        categoria: otrasCategorias[k].categoria,
        monto: Math.round(otrasCategorias[k].monto * 100) / 100,
        n: otrasCategorias[k].n
      })).sort((a, b) => b.monto - a.monto),
      // Avisos: lo que subió mucho y lo que dejó de aparecer
      avisos: [].concat(
        filas.filter(f => f.tendencia !== null && f.tendencia >= 15)
          .map(f => ({ tipo: 'subio', categoria: f.categoria, pct: f.tendencia,
                       texto: 'subió ' + f.tendencia + '% en los últimos meses' })),
        filas.filter(f => f.tendencia !== null && f.tendencia <= -15)
          .map(f => ({ tipo: 'bajo', categoria: f.categoria, pct: f.tendencia,
                       texto: 'bajó ' + Math.abs(f.tendencia) + '% en los últimos meses' })),
        filas.filter(f => f.faltaEsteMes)
          .map(f => ({ tipo: 'falta', categoria: f.categoria,
                       texto: 'no aparece este mes y suele ser recurrente' }))
      )
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
