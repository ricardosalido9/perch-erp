// Las cuentas que se pueden elegir al subir un estado de cuenta.
//
// Salen de la columna "Cuenta" del catálogo, que es la misma lista que se usa al
// capturar un ingreso o un egreso. Así lo que se escribe desde aquí queda igual
// que lo capturado a mano, sin nombres inventados.
const core = require('../core');
const CFG = require('../config');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const buscar = async (id, pestana) => {
      if (!id) return [];
      let values;
      try { values = await core.readRange(id, pestana); } catch (e) { return []; }
      if (!values.length) return [];
      // Los encabezados pueden estar en la fila 1 o en la 2
      let hr = 0;
      for (let k = 0; k < Math.min(4, values.length); k++) {
        const f = (values[k] || []).map(norm);
        if (f.indexOf('cuenta') !== -1 || f.indexOf('concepto') !== -1) { hr = k; break; }
      }
      const H = (values[hr] || []).map(x => String(x).trim());
      // Puede haber varias columnas "Cuenta": una por bloque. Se juntan todas.
      const cols = H.map((h, i) => norm(h) === 'cuenta' ? i : -1).filter(i => i !== -1);
      if (!cols.length) return [];
      const out = [], vistos = {};
      for (let i = hr + 1; i < values.length; i++) {
        const f = values[i] || [];
        cols.forEach(c => {
          const v = txt(f[c]);
          if (v && !vistos[norm(v)]) { vistos[norm(v)] = 1; out.push(v); }
        });
      }
      return out;
    };

    let cuentas = await buscar(CFG.ARCHIVOS.CATALOGO_CUENTAS, CFG.PESTANAS.categorias);
    let de = 'el catálogo de cuentas';
    if (!cuentas.length) {
      cuentas = await buscar(CFG.ARCHIVOS.FINANZAS, CFG.PESTANAS.categorias);
      de = 'el catálogo dentro de Finanzas';
    }
    // Último recurso: las cuentas que ya aparecen usadas en INGRESOS
    if (!cuentas.length) {
      const cfg = core.SHEETS.ingresos;
      if (cfg && cfg.id) {
        const vals = await core.readRange(cfg.id, cfg.sheetName).catch(() => []);
        if (vals.length) {
          const H = (vals[0] || []).map(x => String(x).trim());
          const i = H.findIndex(h => norm(h) === 'cuenta');
          if (i !== -1) {
            const vistos = {};
            for (let k = 1; k < vals.length; k++) {
              const v = txt((vals[k] || [])[i]);
              if (v && !vistos[norm(v)]) { vistos[norm(v)] = 1; cuentas.push(v); }
            }
            de = 'lo que ya se ha capturado en INGRESOS';
          }
        }
      }
    }

    // De cada nombre se saca el número, que es lo que trae el PDF del banco.
    // "BBVA 0117441789" -> numero 0117441789, nombre completo tal cual.
    const lista = cuentas.map(nombre => {
      const digitos = String(nombre).replace(/\D/g, '');
      return {
        nombre: nombre,
        numero: digitos.length >= 6 ? digitos : '',
        // Las que no traen número no se pueden cruzar con un PDF del banco,
        // pero se dejan por si el archivo es de otra fuente
        esBancaria: digitos.length >= 6
      };
    }).sort((a, b) => (b.esBancaria - a.esBancaria) ||
                      a.nombre.localeCompare(b.nombre, 'es'));

    return res.status(200).json({
      ok: true,
      cuentas: lista,
      deDonde: lista.length ? de : '',
      nota: lista.length ? '' :
        'No se encontró ninguna columna "Cuenta" en el catálogo. Revisa la pestaña ' +
        CFG.PESTANAS.categorias + '.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
