// Por qué un proveedor sale sin facturas en el cruce de CFDIs.
// Se abre en el navegador, sin sesión:
//   /api/erp?action=cfdi-traza&proveedor=TANDEM
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
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
    const buscado = String(q.proveedor || q.p || '').trim();
    if (!buscado) return res.status(400).json({ error: 'Falta ?proveedor=NOMBRE' });

    const cfg = core.SHEETS.cfdi_recibidos;
    const cfgP = core.SHEETS.compras_proveedores;
    const cfgE = core.SHEETS.fin_egresos;

    let pestanas = [];
    try { pestanas = await core.listTabs(cfg.id); } catch (e) { pestanas = ['(no se pudo listar)']; }

    const [vig, lista, egr] = await Promise.all([
      leerHoja(cfg.id, cfg.sheetName || 'Vigentes'),
      cfgP && cfgP.id ? leerHoja(cfgP.id, cfgP.sheetName) : Promise.resolve({ headers: [], rows: [] }),
      cfgE && cfgE.id ? leerHoja(cfgE.id, cfgE.sheetName) : Promise.resolve({ headers: [], rows: [] })
    ]);

    const salida = {
      proveedorBuscado: buscado,
      archivoCFDI: cfg.id,
      pestanasDelArchivo: pestanas,
      facturas: {
        pestana: cfg.sheetName || 'Vigentes',
        seLeyo: !!vig.headers.length,
        error: vig.error || '',
        columnas: vig.headers.filter(Boolean),
        totalFilas: vig.rows.length
      }
    };

    const vEm = col(vig.headers, 'Nombre Emisor');
    const vRfc = col(vig.headers, 'RFC Emisor');
    const vTot = col(vig.headers, 'Total');
    const vMet = col(vig.headers, 'Metodo de Pago', 'Método de Pago');
    const vTipo = col(vig.headers, 'Tipo');
    const vEst = col(vig.headers, 'Estado SAT');
    salida.facturas.columnaEmisor = vEm || '(NO ENCONTRADA)';
    salida.facturas.columnaTotal = vTot || '(NO ENCONTRADA)';

    if (vEm) {
      const b = norm(buscado);
      // Emisores cuyo nombre contiene lo buscado
      const suyas = vig.rows.filter(r => norm(r[vEm]).indexOf(b) !== -1);
      const porEmisor = {};
      suyas.forEach(r => {
        const e = txt(r[vEm]);
        if (!porEmisor[e]) porEmisor[e] = { emisor: e, rfc: txt(vRfc ? r[vRfc] : ''), n: 0, monto: 0,
                                            tipos: {}, metodos: {}, estados: {} };
        porEmisor[e].n++;
        porEmisor[e].monto = Math.round((porEmisor[e].monto + num(vTot ? r[vTot] : 0)) * 100) / 100;
        const t = txt(vTipo ? r[vTipo] : '') || '(vacío)';
        const m = txt(vMet ? r[vMet] : '') || '(vacío)';
        const es = txt(vEst ? r[vEst] : '') || '(vacío)';
        porEmisor[e].tipos[t] = (porEmisor[e].tipos[t] || 0) + 1;
        porEmisor[e].metodos[m] = (porEmisor[e].metodos[m] || 0) + 1;
        porEmisor[e].estados[es] = (porEmisor[e].estados[es] || 0) + 1;
      });
      salida.emisoresQueCoinciden = Object.keys(porEmisor).map(k => porEmisor[k]);
      salida.totalFacturasSuyas = suyas.length;

      // Todos los emisores distintos, por si el nombre está muy distinto
      const todos = {};
      vig.rows.forEach(r => {
        const e = txt(r[vEm]);
        if (e) todos[e] = (todos[e] || 0) + 1;
      });
      salida.facturas.emisoresDistintos = Object.keys(todos).length;
      salida.facturas.primerosEmisores = Object.keys(todos).slice(0, 25);
    }

    // Qué dice la Lista de Proveedores de él
    if (lista.headers.length) {
      const lCom = col(lista.headers, 'Proveedor', 'Nombre Comercial');
      const lRaz = col(lista.headers, 'Razón Social', 'Razon Social');
      const lRfc = col(lista.headers, 'RFC');
      salida.listaDeProveedores = {
        columnas: lista.headers.filter(Boolean),
        columnaComercial: lCom || '(NO ENCONTRADA)',
        columnaRazonSocial: lRaz || '(NO ENCONTRADA)',
        suRenglon: lCom ? lista.rows.filter(r => norm(r[lCom]).indexOf(norm(buscado)) !== -1)
          .map(r => ({ fila: r._fila, comercial: txt(r[lCom]),
                       razonSocial: txt(lRaz ? r[lRaz] : '(columna no existe)'),
                       rfc: txt(lRfc ? r[lRfc] : '') })) : []
      };
    } else {
      salida.listaDeProveedores = { error: 'No se pudo leer la Lista de Proveedores.' };
    }

    // Y cuánto se le pagó
    if (egr.headers.length) {
      const eP = col(egr.headers, 'Proveedor');
      const eT = col(egr.headers, 'Total');
      const eF = col(egr.headers, 'Fecha');
      if (eP) {
        const suyos = egr.rows.filter(r => norm(r[eP]).indexOf(norm(buscado)) !== -1);
        salida.egresos = {
          pagos: suyos.length,
          monto: Math.round(suyos.reduce((a, r) => a + num(eT ? r[eT] : 0), 0) * 100) / 100,
          comoLoEscriben: Array.from(new Set(suyos.map(r => txt(r[eP])))).slice(0, 10)
        };
      }
    }

    const n = salida.totalFacturasSuyas || 0;
    salida.diagnostico = !vig.headers.length
      ? 'No se pudo leer la pestaña de facturas. Revisa el nombre en "pestanasDelArchivo".'
      : !vEm ? 'La pestaña no tiene una columna "Nombre Emisor".'
      : !n ? 'Ninguna factura tiene un emisor que contenga "' + buscado + '". Revisa "primerosEmisores" ' +
             'para ver cómo vienen escritos.'
      : 'Se encontraron ' + n + ' facturas suyas. Si el ERP dice $0, compara el nombre de ' +
        '"emisoresQueCoinciden" contra el de la Lista de Proveedores.';

    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
