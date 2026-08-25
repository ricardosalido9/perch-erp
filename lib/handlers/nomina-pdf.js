// Reporte mensual de nómina en PDF.
//
// Replica el resumen que se manda hoy, pero con los comparativos que faltaban:
// contra el mes anterior y contra el mismo mes del año pasado. El detalle por
// persona va al final, para que quien lo firme pueda verificar renglón por renglón.
const core = require('../core');
const CFG = require('../config');
const { reporteNomina } = require('../pdf-nomina');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  // Formato contable: "-$ 4,788.61-" no es negativo, los guiones son de alineación
  const contable = /^-/.test(t) && /-$/.test(t);
  const m = t.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return 0;
  let n = parseFloat(m[0].replace(/,/g, ''));
  if (isNaN(n)) return 0;
  if (!contable && (/^\(.*\)$/.test(t) || /^-/.test(t))) n = -n;
  return n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
  sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
  junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };

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
const red = (n) => Math.round((n || 0) * 100) / 100;

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
    const o = {}; headers.forEach((h, j) => { o[h] = f[j]; });
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
    let mes = +body.mes;
    if (!mes) { mes = hoy.getMonth(); if (mes === 0) { mes = 12; } }

    const [nom, gente] = await Promise.all([leer('rh_nomina'), leer('rh_personal')]);
    if (!nom.headers.length) {
      return res.status(400).json({
        error: 'No se pudo leer la nómina.',
        pista: 'Revisa SHEET_NOMINA y que la pestaña se llame NOMINA.'
      });
    }

    const H = nom.headers;
    const cIni = col(H, 'Fecha Inicio', 'Fecha de Inicio', 'Fecha');
    const cTim = col(H, 'Fecha Timbrado', 'Fecha de Timbrado');
    const cNom = col(H, 'Nombre');
    const cTipoPago = col(H, 'Tipo de Pago', 'Tipo de pago');
    const cPue = col(H, 'Puesto');
    const cArea = col(H, 'Área', 'Area');
    const cDep = col(H, 'Departamento');
    const cSub = col(H, 'Subtotal', 'Bruto', 'Percepciones');
    const cTot = col(H, 'Total', 'Neto');
    if (!cNom || !cTot) {
      return res.status(400).json({ error: 'La pestaña de nómina no tiene Nombre o Total.' });
    }

    // El mes se decide por la fecha de timbrado: es la que dice cuándo se pagó
    const mesDe = (r) => {
      const d = fechaNum(cTim ? r[cTim] : (cIni ? r[cIni] : ''));
      return d === null ? null : { mes: Math.floor(d / 100) % 100, anio: Math.floor(d / 10000), d };
    };
    const delPeriodo = (a, m) => nom.rows.filter(r => {
      const x = mesDe(r);
      return x && x.anio === a && x.mes === m;
    });

    const resumen = (filas) => {
      let bruto = 0, neto = 0;
      const personas = {};
      filas.forEach(r => {
        bruto += cSub ? num(r[cSub]) : 0;
        neto += num(r[cTot]);
        const n = txt(r[cNom]);
        if (n) personas[n] = 1;
      });
      return { bruto: red(bruto), neto: red(neto),
               colaboradores: Object.keys(personas).length, recibos: filas.length };
    };

    const mesAnterior = mes === 1 ? 12 : mes - 1;
    const anioMesAnterior = mes === 1 ? anio - 1 : anio;
    const f0 = delPeriodo(anio, mes);
    const f1 = delPeriodo(anioMesAnterior, mesAnterior);
    const f2 = delPeriodo(anio - 1, mes);
    const fAnio = nom.rows.filter(r => { const x = mesDe(r); return x && x.anio === anio; });
    const fAnioAnt = nom.rows.filter(r => { const x = mesDe(r); return x && x.anio === anio - 1; });

    // Por área, y dentro de cada área por puesto o departamento
    const porArea = (() => {
      const g = {};
      f0.forEach(r => {
        const a = txt(cArea ? r[cArea] : '') || 'Sin área';
        const p = txt(cPue ? r[cPue] : '') || txt(cDep ? r[cDep] : '') || 'Sin puesto';
        const ga = g[a] = g[a] || { area: a, bruto: 0, neto: 0, personas: {}, puestos: {} };
        ga.bruto += cSub ? num(r[cSub]) : 0;
        ga.neto += num(r[cTot]);
        const n = txt(r[cNom]); if (n) ga.personas[n] = 1;
        const gp = ga.puestos[p] = ga.puestos[p] || { puesto: p, bruto: 0, neto: 0, personas: {} };
        gp.bruto += cSub ? num(r[cSub]) : 0;
        gp.neto += num(r[cTot]);
        if (n) gp.personas[n] = 1;
      });
      return Object.keys(g).map(k => {
        const a = g[k];
        return {
          area: a.area, bruto: red(a.bruto), neto: red(a.neto),
          colaboradores: Object.keys(a.personas).length,
          puestos: Object.keys(a.puestos).map(x => ({
            puesto: a.puestos[x].puesto,
            bruto: red(a.puestos[x].bruto), neto: red(a.puestos[x].neto),
            colaboradores: Object.keys(a.puestos[x].personas).length
          })).sort((x, y) => y.neto - x.neto)
        };
      }).sort((x, y) => y.neto - x.neto);
    })();

    // Por tipo de pago: nómina contra honorarios y asimilados
    const porTipoPago = (() => {
      const g = {};
      f0.forEach(r => {
        const t = txt(cTipoPago ? r[cTipoPago] : '') || 'Sin especificar';
        const gt = g[t] = g[t] || { tipo: t, bruto: 0, neto: 0, personas: {} };
        gt.bruto += cSub ? num(r[cSub]) : 0;
        gt.neto += num(r[cTot]);
        const n = txt(r[cNom]); if (n) gt.personas[n] = 1;
      });
      return Object.keys(g).map(k => ({
        tipo: g[k].tipo, bruto: red(g[k].bruto), neto: red(g[k].neto),
        colaboradores: Object.keys(g[k].personas).length
      })).sort((a, b) => b.neto - a.neto);
    })();

    // Altas y bajas del mes, de la lista de colaboradores
    let altas = [], bajas = [], plantilla = 0;
    if (gente.headers.length) {
      const Hg = gente.headers;
      const gN = col(Hg, 'Nombre');
      const gEnt = col(Hg, 'Fecha de entrada', 'Fecha de Inicio', 'Fecha entrada IMSS');
      const gSal = col(Hg, 'Fecha de salida');
      const gSt = col(Hg, 'Status');
      const gPue = col(Hg, 'Puesto');
      gente.rows.forEach(r => {
        const nombre = txt(gN ? r[gN] : '');
        if (!nombre) return;
        const e = gEnt ? fechaNum(r[gEnt]) : null;
        const s = gSal ? fechaNum(r[gSal]) : null;
        if (e !== null && Math.floor(e / 10000) === anio && Math.floor(e / 100) % 100 === mes) {
          altas.push({ nombre, puesto: txt(gPue ? r[gPue] : '') });
        }
        if (s !== null && Math.floor(s / 10000) === anio && Math.floor(s / 100) % 100 === mes) {
          bajas.push({ nombre, puesto: txt(gPue ? r[gPue] : '') });
        }
        const st = norm(gSt ? r[gSt] : '');
        const activo = s === null && (!st || /activ/.test(st));
        if (activo) plantilla++;
      });
    }

    const r0 = resumen(f0), r1 = resumen(f1), r2 = resumen(f2);
    const datos = {
      empresa: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
      mes: MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1),
      anio: anio,
      mesAnteriorNombre: MESES[mesAnterior - 1],
      resumen: r0,
      mesAnterior: r1,
      mismoMesAnioAnterior: r2,
      anioAcumulado: resumen(fAnio),
      anioAnterior: resumen(fAnioAnt),
      promedio: r0.colaboradores ? red(r0.neto / r0.colaboradores) : 0,
      plantilla: plantilla || r0.colaboradores,
      altas, bajas,
      rotacion: (plantilla || r0.colaboradores)
        ? red((bajas.length / (plantilla || r0.colaboradores)) * 100) : 0,
      porArea, porTipoPago,
      detalle: f0.map(r => ({
        inicio: txt(cIni ? r[cIni] : ''),
        timbrado: txt(cTim ? r[cTim] : ''),
        nombre: txt(r[cNom]),
        tipoPago: txt(cTipoPago ? r[cTipoPago] : ''),
        puesto: txt(cPue ? r[cPue] : ''),
        area: txt(cArea ? r[cArea] : ''),
        departamento: txt(cDep ? r[cDep] : ''),
        bruto: cSub ? red(num(r[cSub])) : 0,
        neto: red(num(r[cTot]))
      })).sort((a, b) => {
        const x = fechaNum(a.timbrado) || 0, y = fechaNum(b.timbrado) || 0;
        return x - y || a.nombre.localeCompare(b.nombre, 'es');
      })
    };

    if (body.soloDatos) return res.status(200).json({ ok: true, datos });

    const buf = await reporteNomina(datos, {
      generado: hoy.getDate() + ' de ' + MESES[hoy.getMonth()] + ' de ' + hoy.getFullYear(),
      notas: txt(body.notas)
    });
    return res.status(200).json({
      ok: true, pdf: buf.toString('base64'),
      nombre: 'Perch - Nomina de ' + MESES[mes - 1] + ' ' + anio + '.pdf',
      resumen: { colaboradores: r0.colaboradores, recibos: r0.recibos, neto: r0.neto }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
