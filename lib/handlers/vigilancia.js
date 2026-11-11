// ===== La vigilancia: avisar cuando algo DESAPARECE =====
//
// El 11 de noviembre se descubrió que a la venta AG13-26 de Sofía Sáenz le
// faltaba un renglón de **$95,200** — 2 Sofá Matsu Derecho. Llevaba días así.
// Nadie lo vio porque nada lo miraba: una fila borrada a mano en Google Sheets
// no deja rastro, no dispara nada y el folio simplemente vale menos.
//
// Esto es lo que faltaba. Cada vez que alguien entra al panel (una vez al día
// basta), el ERP anota cómo se ve cada folio: cuántos renglones tiene, cuántas
// piezas y cuánto suma. La próxima vez compara. Si un folio **perdió renglones
// o bajó de monto sin que nadie lo cancelara**, lo dice.
//
// Tres decisiones que importan:
//
//   1. **Solo avisa de lo que se encoge.** Crecer es normal: se agregan muebles
//      a una venta todo el tiempo. Encogerse casi nunca lo es.
//
//   2. **Una cancelación no es una alarma.** Si el folio quedó cancelado,
//      bajar de monto es exactamente lo que tiene que pasar.
//
//   3. **La foto de un folio con alarma NO se actualiza.** Si se actualizara,
//      mañana la pérdida sería la nueva normalidad y la alarma desaparecería
//      sola. Se queda congelada en el último estado bueno hasta que el folio
//      vuelva a cuadrar o alguien lo cancele. Una alarma que se borra sola no
//      es una alarma.
//
//   ?action=vigilancia            → revisa y devuelve las alarmas
//   ?action=vigilancia&soloVer=1  → revisa sin escribir la foto nueva
const core = require('../core');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function hoyTexto() {
  const d = core.ahoraMx ? null : null;
  const f = new Date();
  return f.getDate() + ' ' + MESES[f.getMonth()] + ' ' + f.getFullYear();
}

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [], cfg: null }; }
  if (!values || !values.length) return { headers: [], rows: [], cfg };
  const hr = core._hrIdx ? core._hrIdx(cfg, values) : 0;
  const H = (values[hr] || []).map(h => txt(h));
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = {}; let algo = false;
    H.forEach((h, j) => { if (h) { o[h] = f[j] == null ? '' : f[j]; if (txt(f[j])) algo = true; } });
    if (algo) { o.__fila = i + 1; rows.push(o); }
  }
  return { headers: H, rows, cfg };
}

// Cómo se ve HOY cada folio de ventas
async function fotoVentas() {
  const ven = await leer('ventas_registro');
  if (!ven.headers.length) return {};
  const H = ven.headers;
  const cF = col(H, 'No. de Referencia', 'Folio');
  const cC = col(H, 'Cliente');
  const cQ = col(H, 'Cantidad');
  const cS = col(H, 'Status');
  const cT = col(H, 'Total con envío', 'Total con envio', 'Total Pedido');
  if (!cF) return {};
  const out = {};
  ven.rows.forEach(r => {
    const f = txt(r[cF]);
    if (!f) return;
    // Una cotización no es una venta: no se vigila como tal
    if (core.esCotizacion && core.esCotizacion(f, cS ? txt(r[cS]) : '')) return;
    const k = norm(f);
    const g = out[k] = out[k] || { tipo: 'venta', folio: f, cliente: txt(cC ? r[cC] : ''),
                                   renglones: 0, piezas: 0, total: 0, status: '' };
    g.renglones++;
    g.piezas += cQ ? num(r[cQ]) : 0;
    g.total += cT ? num(r[cT]) : 0;
    if (!g.status && cS) g.status = txt(r[cS]);
    if (!g.cliente && cC) g.cliente = txt(r[cC]);
  });
  return out;
}

// Y cada pedido a proveedor
async function fotoPedidos() {
  const ped = await leer('prov_pedidos');
  if (!ped.headers.length) return {};
  const H = ped.headers;
  const cN = col(H, 'Pedido Proveedor', 'Pedido');
  const cP = col(H, 'Proveedor');
  const cQ = col(H, 'Cantidad');
  const cS = col(H, 'Status');
  const cT = col(H, 'Costo Total + IVA', 'Costo Total');
  if (!cN) return {};
  const out = {};
  ped.rows.forEach(r => {
    const n = txt(r[cN]);
    if (!n) return;
    const k = 'p|' + norm(n);
    const g = out[k] = out[k] || { tipo: 'pedido', folio: n, cliente: txt(cP ? r[cP] : ''),
                                   renglones: 0, piezas: 0, total: 0, status: '' };
    g.renglones++;
    g.piezas += cQ ? num(r[cQ]) : 0;
    g.total += cT ? num(r[cT]) : 0;
    if (!g.status && cS) g.status = txt(r[cS]);
  });
  return out;
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ahoraV, ahoraP, libreta] = await Promise.all([
      fotoVentas(), fotoPedidos(), leer('vigilancia')
    ]);
    const ahora = Object.assign({}, ahoraV, ahoraP);
    if (!libreta.cfg) {
      return res.status(200).json({
        ok: true, alarmas: [], folios: Object.keys(ahora).length, primeraVez: false,
        aviso: 'No encuentro la pestaña "Vigilancia" en el archivo de Operación. ' +
               'Sin ella no puedo acordarme de cómo se veían los folios ayer.'
      });
    }

    const L = libreta.headers;
    const lT = col(L, 'Tipo'), lF = col(L, 'Folio'), lC = col(L, 'Cliente');
    const lR = col(L, 'Renglones'), lQ = col(L, 'Piezas'), lM = col(L, 'Total');
    const lS = col(L, 'Status'), lG = col(L, 'Guardado');
    const antes = {};
    if (lF) libreta.rows.forEach(r => {
      const f = txt(r[lF]);
      if (!f) return;
      const tipo = txt(lT ? r[lT] : '') || 'venta';
      antes[(tipo === 'pedido' ? 'p|' : '') + norm(f)] = {
        tipo, folio: f, cliente: txt(lC ? r[lC] : ''),
        renglones: num(lR ? r[lR] : 0), piezas: num(lQ ? r[lQ] : 0),
        total: num(lM ? r[lM] : 0), status: txt(lS ? r[lS] : ''),
        guardado: txt(lG ? r[lG] : '')
      };
    });

    const primeraVez = Object.keys(antes).length === 0;
    const alarmas = [];
    const cancelado = (s) => /cancelad|anulad/i.test(s || '');

    Object.keys(antes).forEach(k => {
      const a = antes[k], b = ahora[k];
      // Si ahora está cancelado, encogerse es justo lo que debía pasar
      if (b && cancelado(b.status)) return;
      if (!b) {
        if (cancelado(a.status)) return;
        alarmas.push({
          tipo: a.tipo, folio: a.folio, cliente: a.cliente, que: 'desaparecio',
          antes: a, dinero: a.total, desde: a.guardado,
          dice: (a.tipo === 'pedido' ? 'El pedido ' : 'La venta ') + a.folio +
                ' ya no está en la hoja. Tenía ' + a.renglones +
                (a.renglones === 1 ? ' renglón' : ' renglones') +
                (a.total ? ' por ' + a.total.toFixed(2) : '') + '.'
        });
        return;
      }
      const menosRenglones = a.renglones - b.renglones;
      const menosDinero = Math.round((a.total - b.total) * 100) / 100;
      if (menosRenglones > 0 || menosDinero > 1) {
        alarmas.push({
          tipo: a.tipo, folio: a.folio, cliente: b.cliente || a.cliente,
          que: menosRenglones > 0 ? 'perdio-renglones' : 'bajo-de-monto',
          antes: a, ahora: b, renglonesMenos: menosRenglones, dinero: menosDinero,
          desde: a.guardado,
          // El monto NO va en el texto: el panel lo pinta aparte y bien
          // formateado. Decirlo dos veces se lee como un error.
          dice: (a.tipo === 'pedido' ? 'El pedido ' : 'La venta ') + a.folio +
                (menosRenglones > 0
                  ? ' perdió ' + menosRenglones +
                    (menosRenglones === 1 ? ' renglón' : ' renglones')
                  : ' bajó de monto') +
                ', y no está ' + (a.tipo === 'pedido' ? 'cancelado' : 'cancelada') + '.'
        });
      }
    });

    alarmas.sort((x, y) => (y.dinero || 0) - (x.dinero || 0));

    // La foto nueva. Los folios CON alarma se quedan como estaban: si se
    // sobreescribieran, mañana la pérdida sería lo normal y la alarma se
    // borraría sola.
    let guardados = 0;
    if (!body.soloVer && lF) {
      const conAlarma = {};
      alarmas.forEach(x => { conAlarma[(x.tipo === 'pedido' ? 'p|' : '') + norm(x.folio)] = 1; });
      const hoy = hoyTexto();
      const filas = [];
      Object.keys(ahora).forEach(k => {
        if (conAlarma[k]) return;                 // congelado hasta que cuadre
        const g = ahora[k];
        filas.push([g.tipo, g.folio, g.cliente, Math.round(g.renglones),
                    Math.round(g.piezas), Math.round(g.total * 100) / 100, g.status, hoy]);
      });
      Object.keys(antes).forEach(k => {
        if (!conAlarma[k]) return;                // solo los congelados
        const a = antes[k];
        filas.push([a.tipo, a.folio, a.cliente, Math.round(a.renglones),
                    Math.round(a.piezas), Math.round(a.total * 100) / 100, a.status,
                    a.guardado || hoy]);
      });
      const hoja = await core.resolveSheetName(libreta.cfg);
      // Se borra lo viejo y se escribe lo nuevo de un jalón: la libreta es del
      // ERP, no del cliente, y aquí sí se puede reescribir entera.
      await core.clearRange(libreta.cfg.id, "'" + hoja + "'!A2:H");
      if (filas.length) {
        await core.writeCells(libreta.cfg.id,
          [{ range: "'" + hoja + "'!A2", values: filas }]);
      }
      guardados = filas.length;
    }

    return res.status(200).json({
      ok: true, alarmas, primeraVez, guardados,
      folios: Object.keys(ahora).length,
      mensaje: primeraVez
        ? 'Primera foto guardada: ' + Object.keys(ahora).length +
          ' folios. A partir de ahora aviso si alguno pierde renglones o baja de monto.'
        : (alarmas.length
            ? alarmas.length + (alarmas.length === 1 ? ' aviso' : ' avisos')
            : 'Todo cuadra con la última revisión.')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
