// Pagos por hacer: lo que Nico solicita y Pau paga.
//
// Vive en la pestaña "Gastos Manuales" que el equipo ya usa. Al marcar un pago
// como hecho se escribe la fecha y quién lo pagó, PERO no pasa a EGRESOS:
// eso se sigue haciendo al conciliar contra el banco, como hoy.
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (/^#(VALUE|REF|DIV|N\/A|NAME|NUM|NULL)/i.test(t)) return 0;
  if (/^-\s*\$/.test(t)) { t = t.replace(/^-\s*/, '').replace(/-\s*$/, ''); }
  const s = t.replace(/[^0-9.,\-]/g, '').replace(/,/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
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
function letra(n) {
  let s = '';
  n = n + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
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
// "Pagado" puede venir como TRUE, Sí, palomita…
function esPagado(v) {
  const t = norm(v);
  return t === 'true' || t === 'si' || t === 'sí' || t === 'x' || t === '1' ||
         t === 'verdadero' || t === 'pagado';
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const hoja = await leer('pagos_pedidos');
    if (!hoja.headers.length) {
      return res.status(400).json({
        error: 'No se pudo leer la pestaña de pagos.',
        pestana: hoja.cfg ? hoja.cfg.sheetName : ''
      });
    }
    const H = hoja.headers;
    const cFec = col(H, 'Fecha');
    const cPag = col(H, 'Pagado');
    const cCon = col(H, 'Concepto');
    const cDes = col(H, 'Descripción', 'Descripcion');
    const cTot = col(H, 'Total con IVA', 'Total', 'Monto');
    const cProv = col(H, 'Proveedor', 'Proveedores', 'Lista de Proveedores 2024_Perch',
                      'Lista de Proveedores', 'A quién se le paga', 'Beneficiario', 'Nombre');
    const cPed = col(H, 'Pedido');
    const cCom = col(H, 'Comentarios');
    const cFPag = col(H, 'Fecha de pago', 'Fecha pago');
    const cQuien = col(H, 'Pagado por', 'Quién pagó');
    const cCta = col(H, 'Cuenta');
    const cUrg = col(H, 'Urgencia', 'Prioridad');
    const cPara = col(H, 'Para cuándo', 'Fecha requerida');
    const cComp = col(H, 'Comprobante', 'Comprobante de pago', 'Liga del comprobante');

    // ---- Alta: Nico pide un pago nuevo ----
    // Se escribe con las MISMAS columnas que ya tiene la hoja; las que no existan
    // simplemente no se llenan. Nace sin pagar, así que le sale a Pau en la cola.
    if (body.nuevo) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const n = body.nuevo || {};
      if (!txt(n.proveedor)) return res.status(400).json({ error: 'Falta a quién se le paga.' });
      if (!num(n.monto)) return res.status(400).json({ error: 'Falta el monto.' });
      const hoy = new Date();
      const MES_N = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                     'septiembre','octubre','noviembre','diciembre'];
      const hoyTxt = hoy.getDate() + ' ' + MES_N[hoy.getMonth()] + ' ' + hoy.getFullYear();
      const rec = {};
      const poner = (columna, valor) => { if (columna && valor !== '' && valor != null) rec[columna] = valor; };
      poner(cFec, txt(n.fecha) || hoyTxt);
      poner(cProv, txt(n.proveedor));
      poner(cPed, txt(n.pedido));
      poner(cCon, txt(n.concepto));
      poner(cDes, txt(n.descripcion));
      poner(cTot, num(n.monto));
      poner(cUrg, txt(n.urgencia));
      poner(cPara, txt(n.paraCuando));
      poner(cCom, txt(n.comentarios));
      poner(cPag, 'FALSE');
      await core.addRecord('pagos_pedidos', rec);
      return res.status(200).json({
        ok: true,
        mensaje: 'Pago solicitado a ' + txt(n.proveedor) + ' por ' +
                 num(n.monto).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) + '.',
        nota: 'Ya le aparece en la cola de pagos por hacer.'
      });
    }

    // ---- Guardar el comprobante de un pago ----
    // Pau lo adjunta al pagar y Nico lo ve desde la misma pantalla.
    if (body.comprobante) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const fila = parseInt(body.fila, 10);
      if (!fila) return res.status(400).json({ error: 'No se indicó cuál pago.' });
      if (!cComp) {
        return res.status(400).json({
          error: 'La hoja no tiene columna para el comprobante.',
          pista: 'Agrega una columna llamada "Comprobante" en ' + hoja.cfg.sheetName + '.'
        });
      }
      await core.writeCells(hoja.cfg.id, [{
        range: "'" + hoja.cfg.sheetName + "'!" + letra(H.indexOf(cComp)) + fila,
        values: [[txt(body.comprobante)]]
      }]);
      return res.status(200).json({ ok: true, mensaje: 'Comprobante guardado.' });
    }

    // ---- Marcar uno o varios como pagados ----
    if (body.marcarPagado) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const filas = Array.isArray(body.filas) ? body.filas : [body.filas];
      if (!filas.length) return res.status(400).json({ error: 'No se indicó qué pagos marcar.' });
      if (!cPag) return res.status(400).json({ error: 'La hoja no tiene columna "Pagado".' });

      const hoy = new Date();
      const MES_N = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                     'septiembre','octubre','noviembre','diciembre'];
      const fechaHoy = txt(body.fecha) ||
        (hoy.getDate() + ' ' + MES_N[hoy.getMonth()] + ' ' + hoy.getFullYear());
      const escribir = [];
      filas.forEach(f => {
        const fila = parseInt(f, 10);
        if (!fila) return;
        const poner = (columna, valor) => {
          if (!columna) return;
          const i = H.indexOf(columna);
          if (i === -1) return;
          escribir.push({
            range: "'" + hoja.cfg.sheetName + "'!" + letra(i) + fila,
            values: [[valor]]
          });
        };
        poner(cPag, 'TRUE');
        poner(cFPag, fechaHoy);
        poner(cQuien, txt(body.quien));
        poner(cCta, txt(body.cuenta));
      });
      if (!escribir.length) return res.status(400).json({ error: 'No hay nada que escribir.' });
      await core.writeCells(hoja.cfg.id, escribir);
      return res.status(200).json({
        ok: true, marcados: filas.length,
        mensaje: filas.length === 1 ? 'Pago marcado como hecho.'
                                    : filas.length + ' pagos marcados como hechos.',
        nota: 'Se registró el pago. Entra a EGRESOS al conciliar contra el banco, como siempre.'
      });
    }

    // ---- La lista ----
    const hoyN = (() => { const d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); })();
    const pendientes = [], pagados = [];
    hoja.rows.forEach(r => {
      const monto = cTot ? num(r[cTot]) : 0;
      if (!monto) return;
      const pagado = cPag ? esPagado(r[cPag]) : false;
      const dPara = cPara ? fechaNum(r[cPara]) : null;
      const item = {
        fila: r._fila,
        fecha: txt(cFec ? r[cFec] : ''),
        dia: cFec ? fechaNum(r[cFec]) : null,
        proveedor: txt(cProv ? r[cProv] : '') || 'Sin proveedor',
        pedido: txt(cPed ? r[cPed] : ''),
        concepto: txt(cCon ? r[cCon] : ''),
        descripcion: txt(cDes ? r[cDes] : ''),
        monto: Math.round(monto * 100) / 100,
        comentarios: txt(cCom ? r[cCom] : ''),
        urgencia: txt(cUrg ? r[cUrg] : ''),
        paraCuando: txt(cPara ? r[cPara] : ''),
        vencido: dPara !== null && dPara < hoyN,
        fechaPago: txt(cFPag ? r[cFPag] : ''),
        quienPago: txt(cQuien ? r[cQuien] : ''),
        comprobante: txt(cComp ? r[cComp] : '')
      };
      if (pagado) pagados.push(item); else pendientes.push(item);
    });

    // Agrupados por proveedor, que es como se paga
    const porProveedor = {};
    pendientes.forEach(p => {
      const k = norm(p.proveedor);
      if (!porProveedor[k]) porProveedor[k] = {
        proveedor: p.proveedor, total: 0, n: 0, pagos: [], urgentes: 0, vencidos: 0
      };
      porProveedor[k].total += p.monto;
      porProveedor[k].n++;
      porProveedor[k].pagos.push(p);
      if (/urgente|alta/i.test(p.urgencia)) porProveedor[k].urgentes++;
      if (p.vencido) porProveedor[k].vencidos++;
    });

    const red = (n) => Math.round(n * 100) / 100;
    // Cuánto lleva esperando la solicitud más vieja de cada proveedor
    const diasDe = (dia) => {
      if (!dia) return null;
      const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
      return Math.round((f(hoyN) - f(dia)) / 86400000);
    };
    const grupos = Object.keys(porProveedor).map(k => {
      const g = porProveedor[k];
      const conDias = g.pagos.map(p => Object.assign({}, p, { espera: diasDe(p.dia) }));
      const masVieja = conDias.reduce((m, p) =>
        (p.espera !== null && (m === null || p.espera > m)) ? p.espera : m, null);
      return {
        proveedor: g.proveedor, total: red(g.total), n: g.n,
        urgentes: g.urgentes, vencidos: g.vencidos,
        masVieja: masVieja,
        // Más de una semana esperando ya es tarde para el proveedor
        atrasado: masVieja !== null && masVieja >= 7,
        pagos: conDias.sort((a, b) => (a.dia || 0) - (b.dia || 0))
      };
    }).sort((a, b) => (b.masVieja || 0) - (a.masVieja || 0) ||
                      (b.vencidos - a.vencidos) || (b.total - a.total));

    // Los pagados de los últimos días, para ver lo que ya se hizo
    pagados.sort((a, b) => (b.dia || 0) - (a.dia || 0));

    return res.status(200).json({
      ok: true,
      pestana: hoja.cfg.sheetName,
      columnas: {
        proveedor: cProv || '(NO ENCONTRADA)',
        columnasDeLaHoja: H.filter(Boolean),
        pagado: cPag || '(NO ENCONTRADA)',
        fechaDePago: cFPag || '',
        pagadoPor: cQuien || '',
        cuenta: cCta || '',
        comprobante: cComp || '(NO ENCONTRADA)'
      },
      grupos,
      pagadosRecientes: pagados.slice(0, 40),
      totales: {
        pendientes: pendientes.length,
        // Proveedores con solicitudes de más de una semana esperando
        atrasados: grupos.filter(g => g.atrasado).length,
        montoPendiente: red(pendientes.reduce((a, x) => a + x.monto, 0)),
        proveedores: grupos.length,
        vencidos: pendientes.filter(x => x.vencido).length,
        urgentes: pendientes.filter(x => /urgente|alta/i.test(x.urgencia)).length,
        pagadosEsteMes: pagados.filter(x => {
          const d = fechaNum(x.fechaPago) || x.dia;
          return d && Math.floor(d / 100) === Math.floor(hoyN / 100);
        }).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
