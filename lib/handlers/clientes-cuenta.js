// Estado de cuenta por cliente: lo que se le vendió contra lo que de verdad entró.
// Mismo criterio que el de proveedores: la venta manda, y los cobros salen SOLO de
// INGRESOS ligados por folio. Nada de tomar el "Pagado" que alguien escribió a mano.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function normFolio(v) { return norm(String(v == null ? '' : v).trim().replace(/\.0+$/, '')); }
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.replace(/,/g, ' ').replace(/\s+/g, ' ')
        .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES[m[2]]) return +m[3] * 10000 + MESES[m[2]] * 100 + +m[1];
  return null;
}
function col(h, ...n) {
  for (const x of n) { const c = h.filter(y => norm(y) === norm(x))[0]; if (c) return c; }
  return null;
}
async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(cfg.id, cfg.sheetName); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const hr = (cfg.headerRow && cfg.headerRow > 1) ? (cfg.headerRow - 1) : 0;
  const headers = (values[hr] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
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
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ven, ing, cxc] = await Promise.all([
      leer('ventas_registro'), leer('fin_ingresos'), leer('fin_cxc')
    ]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });

    const V = ven.headers;
    const vRef = col(V, 'No. de Referencia', 'Folio');
    const vCli = col(V, 'Cliente');
    const vDes = col(V, 'Despacho');
    const vFec = col(V, 'Fecha del Cierre');
    const vTot = col(V, 'Total con envio sin impuestos', 'Total con envío sin impuestos');
    const vTotIva = col(V, 'Total con IVA', 'Total');
    const vSt = col(V, 'Status');
    const vProd = col(V, 'Producto');
    const vCant = col(V, 'Cantidad');
    const vFac = col(V, 'Factura Si / No', 'Factura');
    if (!vRef) return res.status(400).json({ error: 'VENTAS no tiene la columna de folio.' });

    // --- Lo cobrado: SOLO de INGRESOS, ligado por folio ---
    // El folio puede venir dentro de un texto ("Anticipo AG7-26"), así que se busca.
    const cobros = {};
    let sinFolio = { n: 0, monto: 0 };
    if (ing.headers.length) {
      const iRef = col(ing.headers, 'No. de Referencia', 'Folio', 'Pedido');
      const iTot = col(ing.headers, 'Total', 'Monto', 'Importe');
      const iFec = col(ing.headers, 'Fecha');
      const iCon = col(ing.headers, 'Concepto');
      const iDes = col(ing.headers, 'Descripción', 'Descripcion');
      const iMet = col(ing.headers, 'Método de pago', 'Metodo de pago', 'Forma de pago');
      const iCta = col(ing.headers, 'Cuenta');
      if (iTot) {
        // Todos los folios de ventas, para poder buscarlos dentro de un texto
        const folios = [];
        ven.rows.forEach(r => {
          const f = txt(r[vRef]);
          if (f && folios.indexOf(f) === -1) folios.push(f);
        });
        folios.sort((a, b) => b.length - a.length);   // primero los largos: AG7-26 antes que A7-26
        // Índice tolerante: " MY6-26 " con espacios o en minúsculas es el mismo folio
        const porNorm = {};
        folios.forEach(f => { porNorm[normFolio(f)] = f; });

        ing.rows.forEach(r => {
          const m = iTot ? num(r[iTot]) : 0;
          if (!m) return;
          const crudo = txt(iRef ? r[iRef] : '');
          let folio = porNorm[normFolio(crudo)] || '';
          if (!folio) {
            // Se busca el folio dentro del concepto, la descripción o la propia celda
            const texto = ' ' + norm(txt(iCon ? r[iCon] : '') + ' ' + txt(iDes ? r[iDes] : '') +
                                     ' ' + crudo) + ' ';
            folio = folios.filter(f => texto.indexOf(norm(f)) !== -1)[0] || '';
          }
          if (!folio) { sinFolio.n++; sinFolio.monto += m; return; }
          const k = normFolio(folio);
          if (!cobros[k]) cobros[k] = { monto: 0, n: 0, detalle: [] };
          cobros[k].monto += m;
          cobros[k].n++;
          if (cobros[k].detalle.length < 20) {
            cobros[k].detalle.push({
              fila: r._fila, fecha: txt(iFec ? r[iFec] : ''), monto: m,
              concepto: txt(iCon ? r[iCon] : ''), descripcion: txt(iDes ? r[iDes] : ''),
              metodo: txt(iMet ? r[iMet] : ''), cuenta: txt(iCta ? r[iCta] : '')
            });
          }
        });
      }
    }

    // --- Lo que dice CxC, para contrastar ---
    // Solo se revisan las ventas que SIGUEN en CxC con algo por cobrar. Las viejas
    // ya se cerraron en su momento y compararlas contra INGRESOS solo daría ruido.
    const soloActivas = body.soloActivas !== false;
    const enCxc = {};
    const activas = {};
    if (cxc.headers.length) {
      const cRef = col(cxc.headers, 'No. de Referencia', 'Folio');
      const cTot = col(cxc.headers, 'Total con envío', 'Total con envio', 'Total');
      const cPag = col(cxc.headers, 'Pagado', 'Total Cobrado', 'Cobrado');
      const cPor = col(cxc.headers, 'Por Cobrar', 'Saldo');
      const cSt = col(cxc.headers, 'Status', 'Estatus', 'Estado');
      if (cRef) cxc.rows.forEach(r => {
        const k = normFolio(r[cRef]);
        if (!k) return;
        const porC = cPor ? num(r[cPor]) : 0;
        const st = norm(cSt ? r[cSt] : '');
        enCxc[k] = { total: cTot ? num(r[cTot]) : 0, pagado: cPag ? num(r[cPag]) : 0, porCobrar: porC };
        // Activa: tiene saldo por cobrar, o su status no dice que ya se cerró
        const cerrada = /pagad|cerrad|liquidad|cancelad|saldad/.test(st);
        if (porC > 1 || (!cerrada && !cPor)) activas[k] = true;
      });
    }

    // --- Una tarjeta por cliente, con sus ventas dentro ---
    const clientes = {};
    ven.rows.forEach(r => {
      const folio = txt(r[vRef]);
      const total = vTot ? num(r[vTot]) : 0;
      if (!folio && !total) return;                 // fila de fórmula arrastrada
      if (!folio) return;
      // Solo las que siguen abiertas en CxC
      if (soloActivas && !activas[normFolio(folio)]) return;
      const cli = txt(vCli ? r[vCli] : '') || 'Sin cliente';
      const kc = norm(cli);
      if (!clientes[kc]) clientes[kc] = {
        cliente: cli, despacho: txt(vDes ? r[vDes] : ''), ventas: {}
      };
      const c = clientes[kc];
      if (!c.ventas[folio]) c.ventas[folio] = {
        folio: folio, fecha: txt(vFec ? r[vFec] : ''), dia: fechaNum(vFec ? r[vFec] : ''),
        status: txt(vSt ? r[vSt] : ''), factura: txt(vFac ? r[vFac] : ''),
        total: 0, totalConIva: 0, piezas: 0, items: []
      };
      const d = c.ventas[folio];
      d.total += total;
      if (vTotIva) d.totalConIva += num(r[vTotIva]);
      d.piezas += vCant ? num(r[vCant]) : 0;
      if (d.items.length < 40 && vProd && txt(r[vProd])) {
        d.items.push({ producto: txt(r[vProd]), cantidad: vCant ? num(r[vCant]) : 0 });
      }
    });

    const red = (n) => Math.round((n || 0) * 100) / 100;
    const salida = Object.keys(clientes).map(kc => {
      const c = clientes[kc];
      const ventas = Object.keys(c.ventas).map(f => {
        const d = c.ventas[f];
        const cb = cobros[normFolio(f)] || { monto: 0, n: 0, detalle: [] };
        const cx = enCxc[normFolio(f)] || null;
        const porCobrar = red(d.total - cb.monto);
        return Object.assign({}, d, {
          total: red(d.total), totalConIva: red(d.totalConIva),
          cobrado: red(cb.monto), pagos: cb.n, detalleCobros: cb.detalle,
          porCobrar: porCobrar,
          // Se contrasta contra lo que dice CxC: si no coincide, hay algo que revisar
          cxcPagado: cx ? red(cx.pagado) : null,
          difConCxc: cx ? red(cb.monto - cx.pagado) : null,
          saldado: Math.abs(porCobrar) < 1
        });
      }).sort((a, b) => (b.dia || 0) - (a.dia || 0));

      const tot = ventas.reduce((a, x) => a + x.total, 0);
      const cob = ventas.reduce((a, x) => a + x.cobrado, 0);
      return {
        cliente: c.cliente, despacho: c.despacho,
        ventas: ventas,
        totales: {
          ventas: ventas.length,
          vendido: red(tot), cobrado: red(cob), porCobrar: red(tot - cob),
          conSaldo: ventas.filter(x => x.porCobrar > 1).length,
          sinUnSoloPago: ventas.filter(x => !x.pagos && x.porCobrar > 1).length,
          conDiferencia: ventas.filter(x => x.difConCxc !== null && Math.abs(x.difConCxc) > 1).length
        }
      };
    }).filter(x => x.totales.vendido || x.totales.cobrado)
      .sort((a, b) => b.totales.porCobrar - a.totales.porCobrar);

    // Diagnóstico por folio, para poder escribirlo en CxC
    const porFolio = {};
    salida.forEach(c => {
      c.ventas.forEach(v => {
        let estado, nota;
        if (v.porCobrar > 1 && !v.pagos) {
          estado = 'SIN PAGOS';
          nota = 'No hay ningún ingreso con este folio. Faltan ' + v.porCobrar.toLocaleString('es-MX',
                 { style: 'currency', currency: 'MXN' }) + '.';
        } else if (v.porCobrar > 1) {
          estado = 'FALTA COBRAR';
          nota = 'Van ' + v.pagos + (v.pagos === 1 ? ' pago' : ' pagos') + '. Faltan ' +
                 v.porCobrar.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) + '.';
        } else if (v.porCobrar < -1) {
          estado = 'COBRADO DE MÁS';
          nota = 'Entró ' + Math.abs(v.porCobrar).toLocaleString('es-MX',
                 { style: 'currency', currency: 'MXN' }) + ' más de lo vendido. Revisar.';
        } else {
          estado = 'CUADRA';
          nota = 'Lo cobrado en INGRESOS coincide con la venta.';
        }
        // Si CxC dice otra cosa, eso manda en la nota
        if (v.difConCxc !== null && Math.abs(v.difConCxc) > 1) {
          estado = 'NO CUADRA CON CXC';
          nota = 'CxC dice ' + v.cxcPagado.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) +
                 ' cobrado, pero en INGRESOS hay ' + v.cobrado.toLocaleString('es-MX',
                 { style: 'currency', currency: 'MXN' }) + '. Difieren ' +
                 Math.abs(v.difConCxc).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) + '.';
        }
        porFolio[v.folio] = {
          folio: v.folio, cliente: c.cliente, estado: estado, nota: nota,
          vendido: v.total, cobrado: v.cobrado, porCobrar: v.porCobrar, pagos: v.pagos
        };
      });
    });

    return res.status(200).json({
      ok: true,
      clientes: salida,
      porFolio: porFolio,
      sinFolio: { pagos: sinFolio.n, monto: red(sinFolio.monto) },
      soloActivas: soloActivas,
      cxcActivas: Object.keys(activas).length,
      totales: {
        clientes: salida.length,
        vendido: red(salida.reduce((a, x) => a + x.totales.vendido, 0)),
        cobrado: red(salida.reduce((a, x) => a + x.totales.cobrado, 0)),
        porCobrar: red(salida.reduce((a, x) => a + x.totales.porCobrar, 0)),
        conSaldo: salida.filter(x => x.totales.porCobrar > 1).length,
        conDiferencia: salida.reduce((a, x) => a + x.totales.conDiferencia, 0)
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
