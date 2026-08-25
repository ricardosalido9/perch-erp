// Resumen de Nómina y RH: plantilla, costo, altas, bajas y rotación.
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
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [], error: e.message }; }
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
const ACTIVO = /activ|alta|vigente/i;
const BAJA = /baja|inactiv|sali/i;

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const anio = +body.anio || new Date().getFullYear();

    const [per, nom] = await Promise.all([leer('rh_personal'), leer('rh_nomina')]);
    if (!per.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer la lista de colaboradores.' });
    }

    const H = per.headers;
    const cSt = col(H, 'Status');
    const cNom = col(H, 'Nombre');
    const cArea = col(H, 'Área', 'Area');
    const cPue = col(H, 'Puesto');
    const cTipo = col(H, 'Tipo de empleado');
    const cReg = col(H, 'Regimen de pago', 'Régimen de pago');
    const cPer = col(H, 'Periodicidad de pago');
    const cImss = col(H, 'Sueldo IMSS');
    const cAdic = col(H, 'Sueldo Adicional');
    const cNeto = col(H, 'Sueldo neto');
    const cCosto = col(H, 'Costo total');
    const cIni = col(H, 'Fecha de Inicio');
    const cEnt = col(H, 'Fecha de entrada');
    const cEntI = col(H, 'Fecha entrada IMSS');
    const cSal = col(H, 'Fecha de salida');
    const cMeses = col(H, 'Meses en la empresa');
    const cVac = col(H, 'Días de vacaciones correspondientes', 'Dias de vacaciones correspondientes');
    const cAnt = col(H, 'Antiguedad', 'Antigüedad');
    const cRfc = col(H, 'RFC'), cCurp = col(H, 'CURP'), cNss = col(H, 'NSS');
    const cCta = col(H, 'Cuenta de banco');
    const cEmer = col(H, 'Contacto de Emergencia');

    const hoy = new Date();
    const hoyN = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();

    const gente = per.rows.map(r => {
      const salida = cSal ? fechaNum(r[cSal]) : null;
      const entrada = fechaNum(cIni ? r[cIni] : '') || fechaNum(cEnt ? r[cEnt] : '');
      const st = txt(cSt ? r[cSt] : '');
      // Está activo si su status lo dice, o si no tiene fecha de salida
      const activo = st ? !BAJA.test(st) : !salida;
      return {
        fila: r._fila,
        nombre: txt(cNom ? r[cNom] : ''),
        area: txt(cArea ? r[cArea] : '') || 'Sin área',
        puesto: txt(cPue ? r[cPue] : ''),
        tipo: txt(cTipo ? r[cTipo] : ''),
        regimen: txt(cReg ? r[cReg] : ''),
        periodicidad: txt(cPer ? r[cPer] : ''),
        status: st, activo: activo,
        sueldoImss: cImss ? num(r[cImss]) : 0,
        sueldoAdicional: cAdic ? num(r[cAdic]) : 0,
        neto: cNeto ? num(r[cNeto]) : 0,
        costo: cCosto ? num(r[cCosto]) : 0,
        entrada: entrada, entradaTxt: txt(cIni ? r[cIni] : '') || txt(cEnt ? r[cEnt] : ''),
        entradaImss: cEntI ? fechaNum(r[cEntI]) : null,
        salida: salida, salidaTxt: txt(cSal ? r[cSal] : ''),
        meses: cMeses ? num(r[cMeses]) : null,
        vacaciones: cVac ? num(r[cVac]) : null,
        antiguedad: txt(cAnt ? r[cAnt] : ''),
        // Datos que suelen faltar y hacen falta para dar de alta o pagar
        faltantes: [
          cRfc && !txt(r[cRfc]) ? 'RFC' : null,
          cCurp && !txt(r[cCurp]) ? 'CURP' : null,
          cNss && !txt(r[cNss]) ? 'NSS' : null,
          cCta && !txt(r[cCta]) ? 'Cuenta de banco' : null,
          cEmer && !txt(r[cEmer]) ? 'Contacto de emergencia' : null,
          !entrada ? 'Fecha de inicio' : null,
          cEntI && activo && !txt(r[cEntI]) ? 'Alta en IMSS' : null
        ].filter(Boolean)
      };
    }).filter(x => x.nombre);

    const activos = gente.filter(x => x.activo);
    const bajas = gente.filter(x => !x.activo);

    // Altas y bajas del año, mes por mes
    const porMes = {};
    const mesDe = (d) => d ? Math.floor(d / 100) : null;
    gente.forEach(x => {
      if (x.entrada && Math.floor(x.entrada / 10000) === anio) {
        const m = mesDe(x.entrada);
        if (!porMes[m]) porMes[m] = { mes: m, altas: 0, bajas: 0, quienEntro: [], quienSalio: [] };
        porMes[m].altas++;
        porMes[m].quienEntro.push(x.nombre);
      }
      if (x.salida && Math.floor(x.salida / 10000) === anio) {
        const m = mesDe(x.salida);
        if (!porMes[m]) porMes[m] = { mes: m, altas: 0, bajas: 0, quienEntro: [], quienSalio: [] };
        porMes[m].bajas++;
        porMes[m].quienSalio.push(x.nombre);
      }
    });
    const movimientos = Object.keys(porMes).map(k => porMes[k]).sort((a, b) => b.mes - a.mes);

    const altasAnio = gente.filter(x => x.entrada && Math.floor(x.entrada / 10000) === anio).length;
    const bajasAnio = gente.filter(x => x.salida && Math.floor(x.salida / 10000) === anio).length;
    // Rotación: bajas del año entre la plantilla promedio
    const plantillaPromedio = (activos.length + (activos.length + bajasAnio - altasAnio)) / 2;
    const rotacion = plantillaPromedio > 0 ? (bajasAnio / plantillaPromedio) * 100 : 0;

    // Por área: cuánta gente y cuánto cuesta
    const areas = {};
    activos.forEach(x => {
      if (!areas[x.area]) areas[x.area] = { area: x.area, gente: 0, costo: 0, neto: 0, puestos: {} };
      areas[x.area].gente++;
      areas[x.area].costo += x.costo || (x.sueldoImss + x.sueldoAdicional);
      areas[x.area].neto += x.neto;
      const p = x.puesto || 'Sin puesto';
      areas[x.area].puestos[p] = (areas[x.area].puestos[p] || 0) + 1;
    });
    const porArea = Object.keys(areas).map(k => {
      const a = areas[k];
      return { area: a.area, gente: a.gente,
               costo: Math.round(a.costo * 100) / 100, neto: Math.round(a.neto * 100) / 100,
               puestos: Object.keys(a.puestos).map(p => ({ puesto: p, n: a.puestos[p] }))
                          .sort((x, y) => y.n - x.n) };
    }).sort((a, b) => b.costo - a.costo);

    // Por tipo de empleado y régimen: cómo está compuesta la plantilla
    const cuenta = (campo) => {
      const o = {};
      activos.forEach(x => { const v = x[campo] || 'Sin especificar'; o[v] = (o[v] || 0) + 1; });
      return Object.keys(o).map(k => ({ valor: k, n: o[k] })).sort((a, b) => b.n - a.n);
    };

    // Lo pagado en nómina este año, por mes
    let nomina = null;
    if (nom.headers.length) {
      const nH = nom.headers;
      const nMes = col(nH, 'Mes');
      const nSem = col(nH, 'Semana');
      const nIni = col(nH, 'Fecha Inicio');
      const nTim = col(nH, 'Fecha Timbrado');
      const nMesT = col(nH, 'Mes Timbrado');
      const nNom = col(nH, 'Nombre');
      const nBruto = col(nH, 'Bruto', 'Subtotal');
      const nNeto = col(nH, 'Neto', 'Total');
      const nArea = col(nH, 'Área', 'Area');
      const nTipo = col(nH, 'Tipo de Pago', 'Tipo de pago');
      const meses = {};
      let total = 0, totalNeto = 0, sinTimbrar = 0, montoSinTimbrar = 0;
      nom.rows.forEach(r => {
        // El bruto es lo que cuesta la nómina; el neto es lo que le llega a la persona
        const t = nBruto ? num(r[nBruto]) : 0;
        const tn = nNeto ? num(r[nNeto]) : 0;
        if (!t && !tn) return;
        const d = nIni ? fechaNum(r[nIni]) : null;
        if (d && Math.floor(d / 10000) !== anio) return;
        total += t || tn;
        totalNeto += tn;
        const m = txt(nMes ? r[nMes] : '') || (d ? String(mesDe(d)) : 'Sin mes');
        if (!meses[m]) meses[m] = { mes: m, monto: 0, neto: 0, personas: {}, semanas: {} };
        meses[m].monto += (t || tn);
        meses[m].neto += tn;
        const q = txt(nNom ? r[nNom] : '');
        if (q) meses[m].personas[q] = true;
        const sem = txt(nSem ? r[nSem] : '');
        if (sem) meses[m].semanas[sem] = true;
        if (nTim && !txt(r[nTim])) { sinTimbrar++; montoSinTimbrar += (t || tn); }
      });
      nomina = {
        total: Math.round(total * 100) / 100,
        totalNeto: Math.round(totalNeto * 100) / 100,
        sinTimbrar: sinTimbrar, montoSinTimbrar: Math.round(montoSinTimbrar * 100) / 100,
        porMes: Object.keys(meses).map(k => ({
          mes: meses[k].mes,
          monto: Math.round(meses[k].monto * 100) / 100,
          neto: Math.round(meses[k].neto * 100) / 100,
          personas: Object.keys(meses[k].personas).length,
          semanas: Object.keys(meses[k].semanas).length
        })).sort((a, b) => (+b.mes || 0) - (+a.mes || 0)),
        tiposDePago: (() => {
          const o = {};
          nom.rows.forEach(r => {
            const v = txt(nTipo ? r[nTipo] : '') || 'Sin especificar';
            const t = nBruto ? num(r[nBruto]) : (nNeto ? num(r[nNeto]) : 0);
            if (!o[v]) o[v] = { tipo: v, n: 0, monto: 0 };
            o[v].n++; o[v].monto = Math.round((o[v].monto + t) * 100) / 100;
          });
          return Object.keys(o).map(k => o[k]).sort((a, b) => b.monto - a.monto);
        })()
      };
    }

    const suma = (a, k) => Math.round(a.reduce((t, x) => t + (x[k] || 0), 0) * 100) / 100;
    // El costo mensual de verdad: el promedio de lo que se ha pagado en nómina.
    // La columna "Costo total" de la lista puede venir anual o traer fórmulas raras,
    // así que si hay nómina real, esa manda.
    let costoReal = null, mesesPagados = 0;
    if (nomina && nomina.porMes.length) {
      const conMonto = nomina.porMes.filter(m => m.monto > 0);
      mesesPagados = conMonto.length;
      if (mesesPagados) {
        costoReal = Math.round((nomina.total / mesesPagados) * 100) / 100;
      }
    }
    return res.status(200).json({
      ok: true, anio,
      totales: {
        activos: activos.length,
        bajas: bajas.length,
        altasAnio, bajasAnio,
        rotacion: Math.round(rotacion * 10) / 10,
        // Si hay nómina pagada, el costo mensual sale de ahí (es el dato real).
        // Si no, se usa la suma de la columna Costo total de la lista.
        costoMensual: costoReal != null ? costoReal : (suma(activos, 'costo') || suma(activos, 'neto')),
        costoDeLaLista: suma(activos, 'costo'),
        costoSegunNomina: costoReal,
        mesesPagados: mesesPagados,
        netoMensual: (nomina && nomina.totalNeto && mesesPagados)
          ? Math.round((nomina.totalNeto / mesesPagados) * 100) / 100
          : suma(activos, 'neto'),
        sueldoImss: suma(activos, 'sueldoImss'),
        sueldoAdicional: suma(activos, 'sueldoAdicional'),
        conDatosFaltantes: activos.filter(x => x.faltantes.length).length,
        nominaPagada: nomina ? nomina.total : null
      },
      porArea, movimientos,
      porTipo: cuenta('tipo'), porRegimen: cuenta('regimen'), porPeriodicidad: cuenta('periodicidad'),
      // Quién cumple años de antigüedad en los próximos 60 días
      aniversarios: activos.filter(x => x.entrada).map(x => {
        const mm = Math.floor(x.entrada / 100) % 100, dd = x.entrada % 100;
        let prox = hoy.getFullYear() * 10000 + mm * 100 + dd;
        if (prox < hoyN) prox += 10000;
        const dias = Math.round((new Date(Math.floor(prox / 10000), mm - 1, dd) - hoy) / 86400000);
        return Object.assign({}, x, { proximo: prox, dias: dias,
          anios: Math.floor(prox / 10000) - Math.floor(x.entrada / 10000) });
      }).filter(x => x.dias >= 0 && x.dias <= 60).sort((a, b) => a.dias - b.dias)
        .map(x => ({ nombre: x.nombre, area: x.area, dias: x.dias, anios: x.anios,
                     vacaciones: x.vacaciones })),
      incompletos: activos.filter(x => x.faltantes.length)
        .map(x => ({ nombre: x.nombre, area: x.area, puesto: x.puesto, faltantes: x.faltantes })),
      nomina,
      // Los que más pesan en la nómina, para ver la concentración
      topCosto: activos.slice().sort((a, b) => (b.costo || 0) - (a.costo || 0)).slice(0, 8)
        .map(x => ({ nombre: x.nombre, area: x.area, puesto: x.puesto,
                     costo: x.costo || (x.sueldoImss + x.sueldoAdicional) })),
      // Cuántos llevan poco y cuánto llevan mucho: dice si la plantilla es nueva
      antiguedades: (() => {
        const g = { 'Menos de 6 meses': 0, '6 meses a 1 año': 0, '1 a 2 años': 0, 'Más de 2 años': 0 };
        activos.forEach(x => {
          let m = x.meses;
          if (m === null && x.entrada) {
            const a1 = Math.floor(x.entrada / 10000), m1 = Math.floor(x.entrada / 100) % 100;
            m = (hoy.getFullYear() - a1) * 12 + (hoy.getMonth() + 1 - m1);
          }
          if (m === null) return;
          if (m < 6) g['Menos de 6 meses']++;
          else if (m < 12) g['6 meses a 1 año']++;
          else if (m < 24) g['1 a 2 años']++;
          else g['Más de 2 años']++;
        });
        return Object.keys(g).map(k => ({ valor: k, n: g[k] }));
      })(),
      gente: activos.sort((a, b) => (a.area || '').localeCompare(b.area || '') ||
                                    (b.costo || 0) - (a.costo || 0)),
      salidas: bajas.sort((a, b) => (b.salida || 0) - (a.salida || 0)).slice(0, 40)
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
