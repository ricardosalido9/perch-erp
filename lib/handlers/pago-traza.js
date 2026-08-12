// Por qué un pago de EGRESOS no se está ligando a su pedido.
// Se abre en el navegador, sin sesión:
//   /api/erp?action=pago-traza&pedido=S-JUL-06-26
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normPedido(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leerHoja(id, hoja) {
  let values;
  try { values = await core.readRange(id, hoja); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { o[h] = (f[j] != null) ? f[j] : ''; });
    rows.push(o);
  }
  return { headers, rows };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const buscado = String(q.pedido || q.p || '').trim();
    if (!buscado) return res.status(400).json({ error: 'Falta ?pedido=NUMERO' });

    const ID_EGRESOS = '1cacFpLcoSwTnWNFc6LgRo1Fb3qJa-qZl0HYhpExUWO4';
    const cfgPed = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;

    const eg = await leerHoja(ID_EGRESOS, 'EGRESOS');
    const ped = await leerHoja(cfgPed.id, cfgPed.sheetName);

    const salida = {
      pedidoBuscado: buscado,
      normalizado: normPedido(buscado),
      egresos: {
        archivo: ID_EGRESOS, pestana: 'EGRESOS',
        seLeyo: !!eg.headers.length, error: eg.error || '',
        columnas: eg.headers.filter(Boolean),
        totalFilas: eg.rows.length
      },
      pedidos: {
        archivo: cfgPed.id, pestana: cfgPed.sheetName,
        seLeyo: !!ped.headers.length,
        columnas: ped.headers.filter(Boolean)
      }
    };

    const eP = col(eg.headers, 'Pedido', 'Pedido Proveedor');
    const eT = col(eg.headers, 'Total');
    const ePr = col(eg.headers, 'Proveedor');
    const eF = col(eg.headers, 'Fecha');
    const eD = col(eg.headers, 'Descripción', 'Descripcion');
    salida.egresos.columnaPedido = eP || '(NO ENCONTRADA)';
    salida.egresos.columnaTotal = eT || '(NO ENCONTRADA)';

    if (eP) {
      // Coincidencia exacta y también parecidos, para cazar espacios o mayúsculas
      salida.pagosExactos = eg.rows.filter(r => normPedido(r[eP]) === normPedido(buscado))
        .map(r => ({ fila: r._fila, fecha: txt(r[eF]), pedidoCrudo: JSON.stringify(txt(r[eP])),
                     proveedor: txt(ePr ? r[ePr] : ''), monto: num(r[eT]),
                     descripcion: txt(eD ? r[eD] : '') }));
      salida.pagosParecidos = eg.rows.filter(r => {
        const v = normPedido(r[eP]);
        return v !== normPedido(buscado) &&
               (v.indexOf(normPedido(buscado)) !== -1 || normPedido(buscado).indexOf(v) !== -1);
      }).slice(0, 10).map(r => ({ fila: r._fila, pedidoCrudo: JSON.stringify(txt(r[eP])),
                                  monto: num(r[eT]), proveedor: txt(ePr ? r[ePr] : '') }));
    }

    const pP = col(ped.headers, 'Pedido Proveedor');
    const pPr = col(ped.headers, 'Proveedor');
    if (pP) {
      salida.enPedidos = ped.rows.filter(r => normPedido(r[pP]) === normPedido(buscado))
        .map(r => ({ fila: r._fila, pedidoCrudo: JSON.stringify(txt(r[pP])),
                     proveedor: txt(pPr ? r[pPr] : '') }));
    }

    const nEx = (salida.pagosExactos || []).length;
    const nPed = (salida.enPedidos || []).length;
    salida.diagnostico =
      !eg.headers.length ? 'No se pudo leer EGRESOS: revisa que el archivo esté compartido con la cuenta de servicio.'
      : !eP ? 'EGRESOS no tiene una columna llamada "Pedido".'
      : !nPed ? 'Ese pedido no está en la pestaña de Pedidos a Proveedores, por eso no aparece en el estado de cuenta.'
      : !nEx ? 'El pedido existe pero EGRESOS no tiene ningún pago con ese número exacto. Revisa "pagosParecidos".'
      : 'Hay ' + nEx + ' pago(s) con ese pedido. Si no salen en el estado de cuenta, compara el nombre del proveedor entre las dos hojas.';

    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
