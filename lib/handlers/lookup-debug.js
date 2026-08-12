// Por qué un menú no trae opciones.
// Se abre en el navegador, sin sesión:  /api/erp?action=lookup-debug&key=prov_pedidos
const core = require('../core');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const key = String(q.key || (req._body && req._body.key) || 'prov_pedidos').trim();

    const cfg = core.SHEETS[key];
    const salida = {
      area: key,
      archivoDelArea: cfg ? cfg.id : '(no configurada)',
      pestanaDelArea: cfg ? cfg.sheetName : '',
      lookups: []
    };

    let lk;
    try { lk = await core.getLookups(key); }
    catch (e) { return res.status(200).json({ ok: false, error: e.message, salida }); }

    (lk || []).forEach(l => {
      const info = { tipo: l.type || 'simple' };
      if (l.type === 'cascade') {
        info.niveles = l.levels;
        info.rellena = l.fills;
        info.variantes = (l.rows || []).length;
        const prods = {};
        (l.rows || []).forEach(r => {
          const p = String(r[l.levels[0]] || '').trim();
          if (p) prods[p] = (prods[p] || 0) + 1;
        });
        const nombres = Object.keys(prods);
        info.productos_distintos = nombres.length;
        info.primeros_productos = nombres.slice(0, 12);
        // Un ejemplo completo, para ver si el segundo nivel trae opciones
        if (nombres.length) {
          const uno = nombres[0];
          info.ejemplo = {
            producto: uno,
            materiales: (l.rows || []).filter(r => String(r[l.levels[0]] || '').trim() === uno)
              .map(r => String(r[l.levels[1]] || '').trim()).filter((v, i, a) => v && a.indexOf(v) === i)
          };
        }
      } else if (l.type === 'tabla') {
        info.llaves = l.campos;
        info.rellena = l.fills;
        info.filas = (l.filas || []).length;
      } else {
        info.campoLlave = l.keyField;
        info.opciones = (l.options || []).length;
        info.primeras = (l.options || []).slice(0, 8);
      }
      salida.lookups.push(info);
    });

    salida.diagnostico = !lk || !lk.length
      ? 'No se cargó ningún menú. Revisa que el archivo del catálogo esté compartido con la cuenta de servicio.'
      : (salida.lookups.some(x => x.tipo === 'cascade' && x.variantes)
          ? 'La cascada trae datos. Si el menú sale vacío en pantalla, el problema es de la pantalla, no de la lectura.'
          : 'La cascada se configuró pero llegó sin filas: revisa el nombre de la pestaña y de las columnas.');

    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
