// Qué pestañas tienen los archivos de Nómina y RH, y qué columnas trae cada una.
//   /api/erp?action=rh-traza
const core = require('../core');

module.exports = async (req, res) => {
  try {
    const salida = { archivos: [] };
    for (const key of ['rh_personal', 'rh_nomina']) {
      const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
      const info = {
        area: key === 'rh_personal' ? 'Colaboradores' : 'Nómina semanal',
        archivo: cfg ? cfg.id : '(no configurado)',
        pestanaConfigurada: cfg ? cfg.sheetName : ''
      };
      if (cfg && cfg.id) {
        try { info.pestanasDelArchivo = await core.listTabs(cfg.id); }
        catch (e) { info.error = e.message; info.pestanasDelArchivo = []; }
        try {
          const v = await core.readRange(cfg.id, cfg.sheetName);
          info.seLeyo = !!(v && v.length);
          info.filas = v ? Math.max(0, v.length - 1) : 0;
          info.columnas = v && v.length ? (v[0] || []).map(x => String(x).trim()).filter(Boolean) : [];
        } catch (e) {
          info.seLeyo = false;
          info.errorAlLeer = e.message;
        }
      }
      salida.archivos.push(info);
    }
    salida.diagnostico = salida.archivos.map(a =>
      a.seLeyo
        ? a.area + ': ' + a.filas + ' renglones desde "' + a.pestanaConfigurada + '".'
        : a.area + ': NO se pudo leer "' + a.pestanaConfigurada + '". Pestañas disponibles: ' +
          (a.pestanasDelArchivo || []).join(' · ')
    );
    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
