const core = require('../lib/core');
const u = require('../lib/util');

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });

    const admin = core.esAdmin(ses);
    // Análisis: colaborador → solo lo suyo; admin → todo (o lo que elija)
    let verComo = admin ? (body.verComo || '__todos__') : ses.nombre;
    const todos = verComo === '__todos__';

    const pend = await u.leer(core.AREA_PENDIENTES);
    let P = u.mapear(pend.headers, pend.rows);
    if (!todos) P = P.filter(p => u.perteneceA(p, verComo));

    const out = {
      hoy: u.hoyNum(), esAdmin: admin, verComo,
      pendientes: P.map(p => ({
        d: p.dSol, dc: p.dComp, dz: p.dReal, sem: p.semana,
        cl: p.cliente || 'Sin cliente', r: p.resp || 'Sin asignar', a: p.area || 'Sin área',
        p: p.pri || 'Sin prioridad', e: p.estatus || 'Sin estatus',
        cerr: p.cerrado, can: p.cancelado, rev: p.revisado, rs: u.personas(p), t: p.titulo, cl2: p.cliente
      }))
    };
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
