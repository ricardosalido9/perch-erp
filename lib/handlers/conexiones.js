// A qué archivo y a qué pestaña está conectada cada área del ERP.
//
// Existía config (qué archivos hay) y rh-traza (solo nómina), pero nada que
// dijera, área por área, de dónde lee y si de verdad puede leerlo. Cuando algo
// "sale vacío" casi siempre es una de tres: el área no tiene archivo, la pestaña
// se llama distinto, o el archivo no está compartido con la cuenta de servicio.
// Esto las distingue.
//
//   /api/erp?action=conexiones            solo lo configurado, rápido
//   /api/erp?action=conexiones&probar=1   además abre cada hoja y cuenta renglones
//   /api/erp?action=conexiones&grupo=rh   solo un grupo del menú
const core = require('../core');
const CFG = require('../config');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const probar = q.probar === '1' || q.probar === 'si';
    const filtro = norm(q.grupo || '');

    // Se recorre el menú para saber cómo se llama cada área en pantalla y a qué
    // grupo pertenece. Así el diagnóstico habla el idioma del usuario y no el de
    // las claves internas.
    const areas = [];
    (function recorrer(items, camino) {
      items.forEach(it => {
        const ruta = camino.concat([it.label]);
        if (it.children && it.children.length) return recorrer(it.children, ruta);
        areas.push({ key: it.key, label: it.label, menu: ruta.slice(0, -1).join(' › ') });
      });
    })(core.MENU, []);

    // Las que no están en el menú pero sí leen hojas (estructuras, catálogos)
    const enMenu = {};
    areas.forEach(a => { enMenu[a.key] = true; });
    Object.keys(core.SHEETS).forEach(k => {
      if (!enMenu[k]) areas.push({ key: k, label: k, menu: '(no está en el menú)' });
    });

    // De qué variable de entorno salió cada id, para poder cambiarlo sin código
    // Varias variables pueden apuntar al mismo archivo —CFDI_EMITIDOS,
    // CFDI_RECIBIDOS y NOMINA comparten uno— así que se juntan todas en vez de
    // que la última pise a las demás y el diagnóstico mienta.
    const deQuienEs = {};
    Object.keys(CFG.ARCHIVOS).forEach(k => {
      const id = CFG.ARCHIVOS[k];
      if (!id) return;
      (deQuienEs[id] = deQuienEs[id] || []).push('SHEET_' + k);
    });

    const salida = [];
    for (const a of areas) {
      if (filtro && norm(a.key).indexOf(filtro) === -1 &&
          norm(a.menu).indexOf(filtro) === -1 && norm(a.label).indexOf(filtro) === -1) continue;
      const cfg = core.areaCfg ? await core.areaCfg(a.key) : core.SHEETS[a.key];
      const o = {
        menu: a.menu, area: a.label, clave: a.key,
        archivo: (cfg && cfg.id) ? cfg.id : '',
        variable: ((cfg && cfg.id && deQuienEs[cfg.id]) || []).join(' = '),
        pestana: (cfg && cfg.sheetName) || '',
        liga: (cfg && cfg.id) ? 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit' : ''
      };
      if (!cfg) o.estado = 'Esta área no lee ninguna hoja: tiene pantalla propia.';
      else if (!cfg.id) o.estado = 'Sin archivo conectado.';
      else o.estado = 'Configurada.';
      salida.push(o);
    }

    // Probar de verdad: abrir cada archivo una sola vez y ver sus pestañas
    if (probar) {
      const porArchivo = {};
      salida.forEach(o => { if (o.archivo) porArchivo[o.archivo] = null; });
      for (const id of Object.keys(porArchivo)) {
        try { porArchivo[id] = { pestanas: await core.listTabs(id) }; }
        catch (e) {
          porArchivo[id] = { error: /permission|403|not found|404/i.test(e.message)
            ? 'No se pudo abrir. Lo más probable: el archivo no está compartido como editor con ' +
              'perch-panel@perch-erp.iam.gserviceaccount.com'
            : e.message };
        }
      }
      for (const o of salida) {
        if (!o.archivo) continue;
        const info = porArchivo[o.archivo] || {};
        if (info.error) { o.estado = info.error; continue; }
        const existe = (info.pestanas || []).filter(p => norm(p) === norm(o.pestana))[0];
        if (!existe) {
          o.estado = 'La pestaña "' + o.pestana + '" no existe en ese archivo. ' +
                     'Las que hay: ' + (info.pestanas || []).join(' · ');
          o.pestanasDelArchivo = info.pestanas || [];
          continue;
        }
        try {
          const v = await core.readRange(o.archivo, o.pestana);
          o.renglones = v && v.length ? Math.max(0, v.length - 1) : 0;
          o.columnas = (v && v.length ? (v[0] || []) : []).map(x => String(x).trim()).filter(Boolean);
          o.estado = o.renglones ? 'Lee bien.' : 'Se abre pero está vacía.';
        } catch (e) {
          o.estado = 'No se pudo leer: ' + e.message;
        }
      }
    }

    const problemas = salida.filter(o => o.archivo && o.estado !== 'Configurada.' && o.estado !== 'Lee bien.');
    return res.status(200).json({
      ok: true,
      cuentaDeServicio: 'perch-panel@perch-erp.iam.gserviceaccount.com',
      probado: probar,
      resumen: probar
        ? (problemas.length
            ? problemas.length + ' áreas con problema de las ' + salida.length + ' revisadas.'
            : 'Las ' + salida.filter(o => o.archivo).length + ' áreas conectadas leen bien.')
        : 'Agrega &probar=1 para abrir cada hoja de verdad y contar sus renglones.',
      problemas: problemas.map(o => o.area + ' → ' + o.estado),
      areas: salida
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
