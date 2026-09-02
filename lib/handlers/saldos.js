// Cuánto dinero hay en cada cuenta, y de dónde salió ese número.
//
// El saldo no se captura mes a mes: se calcula. Saldo inicial más lo que entró
// menos lo que salió, por cuenta, leyendo INGRESOS y EGRESOS. Capturarlo sería
// una segunda fuente del mismo dato, y cuando dos fuentes se separan no hay forma
// de saber cuál tiene razón.
//
// Lo único que se captura es el saldo de arranque: un renglón por cuenta con
// Mes = 0 en BG Datos, igual que el saldo inicial del flujo.
//
//   ?action=saldos  { anio, desde, hasta }
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
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
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.replace(/,/g,' ').replace(/\s+/g,' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})/);
  if (m && MES[m[2]]) return +m[3]*10000 + MES[m[2]]*100 + +m[1];
  return null;
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
    const o = {}; H.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers: H, rows, cfg };
}
const red = (x) => Math.round(x * 100) / 100;
const ES_TARJETA = /tarjeta|amex|american express|tdc|credito|crédito/i;
const PAGO_TARJETA = /pago de tarjeta/i;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();
    const desde = Math.min(12, Math.max(1, +body.desde || 1));
    const hasta = Math.min(12, Math.max(desde, +body.hasta || 12));

    const [ing, egr, bg] = await Promise.all([
      leer('fin_ingresos'), leer('fin_egresos'), leer('fin_balance')
    ]);
    if (!ing.headers.length && !egr.headers.length) {
      return res.status(400).json({
        error: 'No se pudieron leer INGRESOS ni EGRESOS.',
        pista: 'Revisa con ?action=conexiones&probar=1 que las dos pestañas se abran.'
      });
    }

    // ---- el saldo de arranque, capturado una sola vez ----
    const inicial = {}; let hayInicial = false;
    if (bg.headers.length) {
      const cA = col(bg.headers, 'Año','Anio','Ano'), cM = col(bg.headers, 'Mes');
      const cC = col(bg.headers, 'Concepto'), cV = col(bg.headers, 'Monto','Importe','Total');
      if (cA && cM && cC && cV) {
        bg.rows.forEach(r => {
          if (num(r[cA]) !== anio || num(r[cM]) !== 0) return;
          const k = txt(r[cC]);
          if (!k) return;
          inicial[norm(k)] = { nombre: k, monto: num(r[cV]) };
          hayInicial = true;
        });
      }
    }

    // ---- los movimientos, por cuenta y por mes ----
    const cuentas = {};
    const dame = (nombre) => {
      const k = norm(nombre) || 'sin cuenta';
      if (!cuentas[k]) cuentas[k] = {
        cuenta: nombre || 'Sin cuenta', entradas: 0, salidas: 0, nEnt: 0, nSal: 0,
        porMes: Array.from({ length: 13 }, () => ({ entradas: 0, salidas: 0 })),
        pagoTarjetaEntra: 0, pagoTarjetaSale: 0
      };
      return cuentas[k];
    };
    let sinCuenta = 0, sinFecha = 0;
    const juntar = (hoja, lado) => {
      if (!hoja.headers.length) return;
      const H = hoja.headers;
      const cF = col(H, 'Fecha'), cT = col(H, 'Total','Monto','Importe');
      const cCta = col(H, 'Cuenta'), cCat = col(H, 'Categoría','Categoria');
      if (!cF || !cT) return;
      hoja.rows.forEach(r => {
        const d = fechaNum(r[cF]);
        if (d === null) { sinFecha++; return; }
        if (Math.floor(d / 10000) !== anio) return;
        const m = Math.floor(d / 100) % 100;
        if (m < desde || m > hasta) return;
        const t = num(r[cT]);
        if (!t) return;
        const nombre = txt(cCta ? r[cCta] : '');
        if (!nombre) sinCuenta++;
        const c = dame(nombre);
        if (lado === 'entradas') { c.entradas += t; c.nEnt++; c.porMes[m].entradas += t; }
        else { c.salidas += t; c.nSal++; c.porMes[m].salidas += t; }
        if (PAGO_TARJETA.test(txt(cCat ? r[cCat] : ''))) {
          if (lado === 'entradas') c.pagoTarjetaEntra += t; else c.pagoTarjetaSale += t;
        }
      });
    };
    juntar(ing, 'entradas');
    juntar(egr, 'salidas');

    // Las cuentas que solo tienen saldo inicial también salen: un saldo sin
    // movimiento sigue siendo dinero que existe.
    Object.keys(inicial).forEach(k => { if (!cuentas[k]) dame(inicial[k].nombre); });

    const lista = Object.keys(cuentas).map(k => {
      const c = cuentas[k];
      const ini = inicial[k] ? inicial[k].monto : 0;
      const esTarjeta = ES_TARJETA.test(c.cuenta);
      // En una tarjeta el saldo es lo que se debe, no lo que se tiene: los cargos
      // suman a la deuda y los pagos la bajan. Por eso va con el signo al revés.
      const actual = esTarjeta ? ini + c.salidas - c.entradas : ini + c.entradas - c.salidas;
      return {
        cuenta: c.cuenta, esTarjeta,
        inicial: red(ini), tieneInicial: !!inicial[k],
        entradas: red(c.entradas), salidas: red(c.salidas),
        movimientos: c.nEnt + c.nSal,
        actual: red(actual),
        porMes: c.porMes.map((m, i) => ({ mes: i, entradas: red(m.entradas), salidas: red(m.salidas) }))
                        .filter(m => m.mes >= desde && m.mes <= hasta),
        pagoTarjetaEntra: red(c.pagoTarjetaEntra), pagoTarjetaSale: red(c.pagoTarjetaSale)
      };
    }).sort((a, b) => Math.abs(b.actual) - Math.abs(a.actual));

    // ---- el cuadre de las tarjetas ----
    // Lo que salió del banco como "Pago de tarjeta" tiene que ser lo mismo que
    // entró a la tarjeta con esa categoría. Si no, o falta subir un estado de
    // cuenta, o un pago quedó a caballo entre dos meses.
    const saleDelBanco = lista.filter(x => !x.esTarjeta)
      .reduce((s, x) => s + x.pagoTarjetaSale, 0);
    const entraALaTarjeta = lista.filter(x => x.esTarjeta)
      .reduce((s, x) => s + x.pagoTarjetaEntra, 0);
    const cuadreTarjeta = {
      salioDelBanco: red(saleDelBanco),
      entroALaTarjeta: red(entraALaTarjeta),
      diferencia: red(saleDelBanco - entraALaTarjeta),
      cuadra: Math.abs(saleDelBanco - entraALaTarjeta) < 1
    };

    const efectivo = lista.filter(x => !x.esTarjeta).reduce((s, x) => s + x.actual, 0);
    const deuda = lista.filter(x => x.esTarjeta).reduce((s, x) => s + x.actual, 0);

    return res.status(200).json({
      ok: true, anio, desde, hasta,
      cuentas: lista,
      totales: { efectivo: red(efectivo), deudaTarjetas: red(deuda), neto: red(efectivo - deuda) },
      cuadreTarjeta,
      hayInicial,
      sinInicial: lista.filter(x => !x.tieneInicial && x.movimientos).map(x => x.cuenta),
      sinCuenta, sinFecha,
      dondeVaElInicial: (bg.cfg && bg.cfg.sheetName) || 'BG Datos',
      nota: 'El saldo se calcula: inicial más entradas menos salidas, por cuenta. Lo único ' +
            'que se captura es el arranque, un renglón por cuenta con Mes = 0. En las ' +
            'tarjetas el saldo es lo que se debe, así que los cargos suman y los pagos restan.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
