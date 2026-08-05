const core = require('../lib/core');
function nm(s){ return String(s==null?'':s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function hrs(v){ const n = parseFloat(String(v==null?'':v).replace(/[^0-9.,\-]/g,'').replace(',','.')); return isNaN(n)?0:n; }

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const ses = core.verifyToken(body.token);
    if (!ses) return res.status(401).json({ error: 'Sesión no válida.' });

    const values = await core.readBitacora();
    const headers = (values[0] || []).map(String);
    const idx = name => headers.findIndex(h => nm(h) === nm(name));
    const iF=idx('Fecha'), iCo=idx('Colaborador'), iCl=idx('Cliente'), iP=idx('Pendiente'),
          iA=idx('Actividad'), iH=idx('Horas'), iR=idx('Registrado por');

    let ent = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      const act = iA!==-1 ? String(r[iA]||'') : '';
      const h = iH!==-1 ? r[iH] : '';
      if (!act.trim() && !String(h).trim()) continue;
      ent.push({
        fecha: iF!==-1?String(r[iF]||''):'', colaborador: iCo!==-1?String(r[iCo]||''):'',
        cliente: iCl!==-1?String(r[iCl]||''):'', pendiente: iP!==-1?String(r[iP]||''):'',
        actividad: act, horas: hrs(h), por: iR!==-1?String(r[iR]||''):''
      });
    }

    const admin = core.esAdmin(ses);
    let verComo = admin ? (body.verComo || '__todos__') : ses.nombre;
    if (verComo && verComo !== '__todos__') ent = ent.filter(e => nm(e.colaborador) === nm(verComo));

    const porCliente = {}, porColab = {}, porCC = {};
    let totalHoras = 0;
    ent.forEach(e => {
      totalHoras += e.horas;
      if (e.cliente) porCliente[e.cliente] = (porCliente[e.cliente] || 0) + e.horas;
      if (e.colaborador) porColab[e.colaborador] = (porColab[e.colaborador] || 0) + e.horas;
      const cli = e.cliente || 'Sin cliente', col = e.colaborador || 'Sin asignar';
      const k = cli + '||' + col;
      porCC[k] = (porCC[k] || 0) + e.horas;
    });
    const round = o => { Object.keys(o).forEach(k => o[k] = Math.round(o[k]*100)/100); return o; };
    const clienteColab = Object.keys(porCC).map(k => {
      const [cliente, colaborador] = k.split('||');
      return { cliente, colaborador, horas: Math.round(porCC[k]*100)/100 };
    }).sort((a,b) => a.cliente.localeCompare(b.cliente,'es') || b.horas - a.horas);

    return res.status(200).json({
      esAdmin: admin, verComo, total: ent.length, totalHoras: Math.round(totalHoras*100)/100,
      clientes: Object.keys(porCliente).length,
      porCliente: round(porCliente), porColab: round(porColab), clienteColab,
      entries: ent.slice(-300).reverse()
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
