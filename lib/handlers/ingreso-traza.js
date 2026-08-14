// Por qué un folio no encuentra sus pagos en INGRESOS.
// Se abre en el navegador, sin sesión:
//   /api/erp?action=ingreso-traza&folio=MY6-26
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normFolio(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); }
  catch (e) { return { headers: [], rows: [], cfg, error: e.message }; }
  if (!values.length) return { headers: [], rows: [], cfg };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows, cfg };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const buscado = String(q.folio || q.f || '').trim();
    if (!buscado) return res.status(400).json({ error: 'Falta ?folio=MY6-26' });

    const [ing, ven] = await Promise.all([leer('fin_ingresos'), leer('ventas_registro')]);
    const salida = {
      folioBuscado: buscado,
      normalizado: normFolio(buscado),
      ingresos: {
        archivo: ing.cfg ? ing.cfg.id : '(no configurado)',
        pestana: ing.cfg ? ing.cfg.sheetName : '',
        seLeyo: !!ing.headers.length,
        error: ing.error || '',
        columnas: ing.headers.filter(Boolean),
        totalFilas: ing.rows.length
      }
    };
    if (!ing.headers.length) {
      salida.diagnostico = 'No se pudo leer INGRESOS. Revisa el archivo y la pestaña.';
      return res.status(200).json({ ok: true, salida });
    }

    const iRef = col(ing.headers, 'No. de Referencia', 'Folio', 'Pedido');
    const iTot = col(ing.headers, 'Total', 'Monto', 'Importe');
    const iFec = col(ing.headers, 'Fecha');
    const iCon = col(ing.headers, 'Concepto');
    const iDes = col(ing.headers, 'Descripción', 'Descripcion');
    salida.ingresos.columnaFolio = iRef || '(NO ENCONTRADA)';
    salida.ingresos.columnaTotal = iTot || '(NO ENCONTRADA)';

    const b = normFolio(buscado);
    // 1) Coincidencia exacta en la columna de folio
    const exactos = iRef ? ing.rows.filter(r => normFolio(r[iRef]) === b) : [];
    salida.porColumnaFolio = exactos.map(r => ({
      fila: r._fila, fecha: txt(iFec ? r[iFec] : ''),
      folioCrudo: JSON.stringify(txt(iRef ? r[iRef] : '')),
      monto: num(iTot ? r[iTot] : 0), concepto: txt(iCon ? r[iCon] : '')
    }));

    // 2) El folio mencionado en cualquier parte del renglón
    const enTexto = ing.rows.filter(r => {
      const t = ' ' + norm(ing.headers.map(h => txt(r[h])).join(' ')) + ' ';
      return t.indexOf(norm(buscado)) !== -1;
    });
    salida.mencionadoEnElRenglon = enTexto.slice(0, 20).map(r => ({
      fila: r._fila, fecha: txt(iFec ? r[iFec] : ''),
      folioCrudo: JSON.stringify(txt(iRef ? r[iRef] : '')),
      monto: num(iTot ? r[iTot] : 0),
      concepto: txt(iCon ? r[iCon] : ''), descripcion: txt(iDes ? r[iDes] : '')
    }));

    // 3) Cómo se ve la columna de folio en general
    if (iRef) {
      const muestras = [];
      for (let i = 0; i < ing.rows.length && muestras.length < 15; i++) {
        const v = txt(ing.rows[i][iRef]);
        if (v) muestras.push(JSON.stringify(v));
      }
      salida.ingresos.ejemplosDeFolio = muestras;
      salida.ingresos.filasConFolio = ing.rows.filter(r => txt(r[iRef])).length;
      salida.ingresos.filasSinFolio = ing.rows.length - salida.ingresos.filasConFolio;
    }

    // 4) Y del lado de VENTAS
    if (ven.headers.length) {
      const vRef = col(ven.headers, 'No. de Referencia', 'Folio');
      salida.ventas = {
        pestana: ven.cfg ? ven.cfg.sheetName : '',
        columnaFolio: vRef || '(NO ENCONTRADA)',
        renglonesDeEseFolio: vRef ? ven.rows.filter(r => normFolio(r[vRef]) === b).length : 0
      };
    }

    const nE = salida.porColumnaFolio.length, nT = enTexto.length;
    salida.diagnostico =
      !iRef ? 'INGRESOS no tiene una columna de folio. Revisa "columnas".'
      : !iTot ? 'INGRESOS no tiene una columna Total.'
      : nE ? 'Hay ' + nE + ' pagos con ese folio exacto. Si el ERP dice $0, el problema está en el cruce.'
      : nT ? 'El folio no está en la columna de folio, pero SÍ se menciona en ' + nT +
             ' renglones. Revisa "mencionadoEnElRenglon" para ver en qué columna quedó.'
      : 'No se encontró ese folio en ningún renglón de INGRESOS. Revisa "ejemplosDeFolio" ' +
        'para ver cómo vienen escritos.';

    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
