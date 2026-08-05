const core = require('../lib/core');
const rec = require('../lib/recurrentes');
const u = require('../lib/util');

function largoES(num) {
  const M = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const y = Math.floor(num/10000), m = Math.floor(num/100)%100, d = num%100;
  return d + ' ' + M[m-1] + ' ' + y;
}
function nm(s){ return String(s==null?'':s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

// Calcula qué pendientes tocarían para un mes dado (dedup contra los existentes)
async function calcular(y, m, feriados, clientes, existentes) {
  const recs = (await core.readRecurrentes()).filter(r => r.activo);
  const cand = [];
  recs.forEach(r => {
    const fechas = rec.ocurrencias(r, y, m, feriados);
    if (!fechas.length) return;
    const targets = (nm(r.cliente) === 'todos') ? (clientes.length ? clientes : ['']) : [r.cliente || ''];
    targets.forEach(cli => {
      fechas.forEach(f => {
        const key = nm(r.pendiente) + '|' + nm(cli) + '|' + f;
        if (existentes.has(key)) return;
        cand.push({
          pendiente: r.pendiente, cliente: cli, area: r.area, responsable: r.responsable,
          coresp: r.coresp, revision: r.revision, prioridad: r.prioridad,
          descripcion: r.descripcion, fecha: f, fechaTxt: largoES(f)
        });
      });
    });
  });
  cand.sort((a,b) => a.fecha - b.fecha);
  return cand;
}
async function existentesSet() {
  const pend = await u.leer(core.AREA_PENDIENTES);
  const P = u.mapear(pend.headers, pend.rows);
  const set = new Set();
  P.forEach(p => { if (p.dComp) set.add(nm(p.titulo) + '|' + nm(p.cliente) + '|' + p.dComp); });
  return set;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses || !core.esAdmin(ses)) return res.status(403).json({ error: 'Solo administradores.' });
    const accion = body.accion || 'preview';

    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year:'numeric', month:'2-digit' }).format(new Date());
    const [yStr, mStr] = now.split('-');
    const y = parseInt(yStr,10), m = parseInt(mStr,10) - 1;
    const marcador = y + '-' + (m+1);

    // 'auto': solo genera si no se ha hecho este mes (rápido)
    if (accion === 'auto') {
      const marca = await core.recurMarker();
      if (marca === marcador) return res.status(200).json({ ok:true, skip:true });
    }

    const feriados = await core.getFeriados();
    const clientes = await core.getClientes();
    const existentes = await existentesSet();
    const cand = await calcular(y, m, feriados, clientes, existentes);

    if (accion === 'preview') {
      return res.status(200).json({ ok:true, mes: marcador, total: cand.length, items: cand.slice(0, 200) });
    }

    // generate / auto → crea los pendientes que faltan
    let creados = 0;
    for (const c of cand) {
      const record = {
        'Pendiente': c.pendiente, 'Cliente': c.cliente, 'Área': c.area,
        'Responsable': c.responsable, 'Co-Responsable': c.coresp, 'Revisión por:': c.revision,
        'Prioridad': c.prioridad, 'Status': 'SIN EMPEZAR', 'Descripción': c.descripcion,
        'Responsable de solicitud': 'Recurrente',
        'Fecha de Solicitud': largoES(parseInt(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/-/g,''),10)),
        'Fecha de Entrega Estimada': c.fechaTxt, 'Fecha de Entrega': c.fechaTxt
      };
      try { await core.addRecord(core.AREA_PENDIENTES, record); creados++; }
      catch (e) { /* continúa con los demás */ }
    }
    await core.setRecurMarker(marcador);
    return res.status(200).json({ ok:true, mes: marcador, creados, intentados: cand.length });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
