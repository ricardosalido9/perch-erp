const core = require('../lib/core');
const u = require('../lib/util');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });

    const admin = core.esAdmin(ses);
    // Alcance: colaborador → siempre él mismo; admin → lo que elija (default: él mismo)
    let verComo = admin ? (body.verComo || ses.nombre) : ses.nombre;
    const todos = admin && verComo === '__todos__';

    const pend = await u.leer(core.AREA_PENDIENTES);
    let P = u.mapear(pend.headers, pend.rows);
    if (!todos) P = P.filter(p => u.perteneceA(p, verComo));

    const hoy = u.hoyNum();
    const mesActual = Math.floor(hoy / 100);
    const abiertos = P.filter(p => !p.cerrado);
    const vencidos = abiertos.filter(p => p.dComp !== null && p.dComp < hoy);
    const deHoy = abiertos.filter(p => p.dComp === hoy);
    const semana = abiertos.filter(p => { const d = u.dias(hoy, p.dComp); return d !== null && d > 0 && d <= 7; });
    const sinRevisar = P.filter(p => p.cerrado && !p.revisado);
    const cerradosMes = P.filter(p => p.cerrado && p.dReal !== null && Math.floor(p.dReal / 100) === mesActual);

    const out = { esAdmin: admin, verComo: todos ? '__todos__' : verComo, avisos: [] };
    out.resumen = {
      abiertos: abiertos.length, vencidos: vencidos.length, hoy: deHoy.length,
      semana: semana.length, sinRevisar: sinRevisar.length, cerradosMes: cerradosMes.length, total: P.length
    };

    if (vencidos.length) out.avisos.push({ tipo:'danger', area:'pend_abiertos', filtro:'vencidos', titulo:'Vencidos',
      detalle: 'Pasó la fecha de entrega y siguen abiertos', n: vencidos.length });
    if (deHoy.length) out.avisos.push({ tipo:'warn', area:'pend_abiertos', filtro:'hoy', titulo:'Vencen hoy', detalle:'Cierran hoy', n: deHoy.length });
    if (semana.length) out.avisos.push({ tipo:'info', area:'pend_abiertos', filtro:'semana', titulo:'Esta semana', detalle:'Vencen en los próximos 7 días', n: semana.length });
    if (sinRevisar.length) out.avisos.push({ tipo:'warn', area:'pend_norev', filtro:'norev', titulo:'Terminados sin revisar', detalle:'Esperan revisión', n: sinRevisar.length });

    const fila = p => ({ titulo:p.titulo, resp:p.resp, cliente:p.cliente, pri:p.pri,
      fecha:p.fComp, dias:u.dias(hoy, p.dComp), estatus:p.estatus });
    out.vencidos = vencidos.sort((a,b)=>(a.dComp||0)-(b.dComp||0)).slice(0,8).map(fila);
    out.proximos = abiertos.filter(p=>p.dComp!==null && p.dComp>=hoy).sort((a,b)=>a.dComp-b.dComp).slice(0,8).map(fila);

    // Carga por responsable (útil sobre todo en vista "Todos")
    const porResp = {};
    abiertos.forEach(p => {
      const gente = u.personas(p);
      const lista = gente.length ? gente : ['Sin asignar'];
      lista.forEach(k => {
        if (!porResp[k]) porResp[k] = { nombre:k, n:0, vencidos:0 };
        porResp[k].n++;
        if (p.dComp !== null && p.dComp < hoy) porResp[k].vencidos++;
      });
    });
    out.porResponsable = Object.keys(porResp).map(k=>porResp[k]).sort((a,b)=>b.n-a.n).slice(0,8);

    // Lista para el calendario (todo el alcance elegido, con su fecha de entrega)
    out.pendientes = P.map(p => ({
      t: p.titulo, cl: p.cliente, r: p.resp, rs: u.personas(p),
      pri: p.pri, e: p.estatus, dc: p.dComp, cerr: p.cerrado, rev: p.revisado
    }));

    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
