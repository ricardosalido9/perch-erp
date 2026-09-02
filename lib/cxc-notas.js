// Escribe en CxC el resultado del cruce contra INGRESOS: si cuadra o no, y por qué.
// Se guarda en dos columnas propias para no tocar lo que ya está capturado.
const core = require('../core');
const ctaClientes = require('./clientes-cuenta');

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normFolio(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const datos = await new Promise((resolve, reject) => {
      const fake = { status() { return fake; }, json(o) { resolve(o); return fake; } };
      req._body = { token: body.token };
      ctaClientes(req, fake).catch(reject);
    });
    if (datos.error) return res.status(400).json({ error: datos.error });

    const cfg = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'No está configurada la hoja de CxC.' });

    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'CxC llegó vacía.' });
    const headers = (values[0] || []).map(h => String(h).trim());

    const idx = (...nombres) => {
      for (const n of nombres) {
        const i = headers.findIndex(h => norm(h) === norm(n));
        if (i !== -1) return i;
      }
      return -1;
    };
    const iRef = idx('No. de Referencia', 'Folio');
    if (iRef === -1) return res.status(400).json({ error: 'CxC no tiene la columna de folio.' });

    // Las dos columnas del ERP: se crean al final si no existen
    let iEstado = idx('Cuadra con Ingresos');
    let iNota = idx('Nota de conciliación', 'Nota de conciliacion');
    const nuevas = [];
    if (iEstado === -1) { iEstado = headers.length + nuevas.length; nuevas.push('Cuadra con Ingresos'); }
    if (iNota === -1) { iNota = headers.length + nuevas.length; nuevas.push('Nota de conciliación'); }
    if (nuevas.length) {
      const letra = (n) => {
        let s = '';
        n = n + 1;
        while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
        return s;
      };
      await core.writeCells(cfg.id, [{
        range: "'" + cfg.sheetName + "'!" + letra(headers.length) + '1:' +
               letra(headers.length + nuevas.length - 1) + '1',
        values: [nuevas]
      }]);
    }

    const letra = (n) => {
      let s = '';
      n = n + 1;
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    const porFolio = datos.porFolio || {};
    const escribir = [];
    let cuadran = 0, noCuadran = 0, sinVenta = 0;

    for (let r = 1; r < values.length; r++) {
      const fila = values[r] || [];
      const folio = String(fila[iRef] == null ? '' : fila[iRef]).trim();
      if (!folio) continue;
      const k = Object.keys(porFolio).filter(f => normFolio(f) === normFolio(folio))[0];
      const d = k ? porFolio[k] : null;
      let estado, nota;
      if (!d) {
        estado = 'SIN VENTA';
        nota = 'Este folio no está en la hoja de VENTAS.';
        sinVenta++;
      } else {
        estado = d.estado;
        nota = d.nota;
        if (estado === 'CUADRA') cuadran++; else noCuadran++;
      }
      escribir.push({
        range: "'" + cfg.sheetName + "'!" + letra(iEstado) + (r + 1) + ':' + letra(iNota) + (r + 1),
        values: [[estado, nota]]
      });
    }

    // Se escribe por bloques, para no saturar
    for (let i = 0; i < escribir.length; i += 200) {
      await core.writeCells(cfg.id, escribir.slice(i, i + 200));
    }

    return res.status(200).json({
      ok: true, filas: escribir.length,
      cuadran, noCuadran, sinVenta,
      columnas: ['Cuadra con Ingresos', 'Nota de conciliación'],
      archivo: 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
