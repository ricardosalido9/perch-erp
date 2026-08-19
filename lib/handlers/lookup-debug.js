// Por qué un menú no trae opciones.
// Se abre en el navegador, sin sesión:  /api/erp?action=lookup-debug&key=prov_pedidos
const core = require('../core');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const key = String(q.key || (req._body && req._body.key) || 'prov_pedidos').trim();

    const cfg = core.SHEETS[key];
    let version = '';
    try { version = require('../version').version; } catch (e) { version = '(no se pudo leer)'; }
    const salida = {
      version: version,
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
        // De dónde se leyó de verdad, y qué columnas encontró y cuáles no
        info.origen = l.origen || null;
        info.ejemplos = (l.filas || []).slice(0, 5).map(f => {
          const o = { llave: f._k };
          if (f._anio != null) o.anio = f._anio;
          (l.fills || []).forEach(x => { o[x] = f[x]; });
          return o;
        });
        // Prueba de una combinación concreta, tal como la buscaría el formulario:
        //   ?action=lookup-debug&key=prov_pedidos&producto=Atril Bisbita Grande
        //     &material=Encino Negro&proveedor=SERGIO NAVARRO VAZQUEZ
        const vals = [q.producto, q.material, q.proveedor].map(x => String(x || '').trim());
        if (vals.some(Boolean)) {
          const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const buscada = vals.slice(0, (l.campos || []).length).map(norm).join('||');
          let cands = (l.filas || []).filter(f => f._k === buscada);
          const hoy = new Date().getFullYear();
          if (l.conAnio && cands.length) {
            const delAnio = cands.filter(f => f._anio === hoy);
            cands = delAnio.length ? delAnio
              : cands.slice().sort((a, b) => (b._anio || 0) - (a._anio || 0));
          }
          info.prueba = {
            buscando: buscada,
            encontradas: cands.length,
            resultado: cands.length ? cands[0] : null,
            // Si no encontró, se ofrecen las llaves más parecidas para ver el typo
            parecidas: cands.length ? [] : (l.filas || [])
              .filter(f => buscada.split('||').filter(Boolean)
                .some(p => p && f._k.indexOf(p) !== -1))
              .slice(0, 10).map(f => f._k)
          };
        }
      } else {
        info.campoLlave = l.keyField;
        info.opciones = (l.options || []).length;
        info.primeras = (l.options || []).slice(0, 8);
      }
      salida.lookups.push(info);
    });

    const tablas = salida.lookups.filter(x => x.tipo === 'tabla');
    salida.diagnostico = !lk || !lk.length
      ? 'No se cargó ningún menú. Revisa que el archivo del catálogo esté compartido con la cuenta de servicio.'
      : (tablas.length && !tablas[0].filas
          ? 'La tabla de costos se configuró pero llegó SIN FILAS. Mira "origen": ahí dice de qué archivo y pestaña trató de leer, y qué columnas no encontró.'
          : (salida.lookups.some(x => x.tipo === 'cascade' && x.variantes)
              ? 'La cascada trae datos. Si el menú sale vacío en pantalla, el problema es de la pantalla, no de la lectura.'
              : 'La cascada se configuró pero llegó sin filas: revisa el nombre de la pestaña y de las columnas.'));

    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
