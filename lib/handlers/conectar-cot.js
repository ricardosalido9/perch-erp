// ===== La venta y su cotización, conectadas =====
//
// Val, 19 nov: *"no me guarda la misma información que ingreso de cotización,
// no están conectadas, ahora las ingreso de nuevo a los viejos, pero ayúdame a
// que sí tengan conexión"*.
//
// **El dato no se perdía por un error de copiado.** Las columnas *Tipo de
// Cliente, Forma de Contacto, Visito Showroom, Notas, Tiempo de entrega* y
// *CP destino* se agregaron a *Registros de Venta 2026* el **5 de noviembre**.
// Todo lo cerrado antes de esa fecha se convirtió cuando esas columnas no
// existían: el dato se quedó en la cotización porque en la venta no había a
// dónde ponerlo. Se ve clarísimo en la hoja: de enero a octubre esas columnas
// están en cero, y las primeras llenas son la N4-26 (9 nov) y la N7-26 (12 nov).
//
// `to-sale` sí copia las 35 columnas desde entonces. Lo que falta es (a) llenar
// las viejas y (b) que una venta capturada A MANO también encuentre su
// cotización.
//
//   ?action=conectar-cot&que=revisar        → qué le falta a cada venta y de dónde sale
//   ?action=conectar-cot&que=aplicar        → lo escribe (solo celdas vacías)
//   ?action=conectar-cot&que=del-cliente    → las cotizaciones sin vender de un cliente
const core = require('../core');

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
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
function letra(i) {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const anioDe = (v) => { const m = txt(v).match(/(\d{4})/); return m ? +m[1] : 0; };

// Lo que viaja de la cotización a la venta. A la izquierda, como se llama en
// COTIZACIONES; a la derecha, en VENTAS. Se buscan por nombre con alternativas,
// nunca por letra: los encabezados de Cotizaciones traen espacios al inicio.
const VIAJAN = [
  { de: ['Tipo de Cliente', 'TIPO CLIENTE'],            a: ['Tipo de Cliente', 'Tipo de Línea'] },
  { de: ['Forma de Contacto', 'Cómo Llego'],            a: ['Forma de Contacto', 'Cómo Llego'] },
  { de: ['Visito Showroom', 'Visitó Showroom'],         a: ['Visito Showroom', 'Showroom'] },
  { de: ['Tiempo de entrega', 'Tiempo de fabricación'], a: ['Tiempo de entrega'] },
  { de: ['Notas'],                                      a: ['Notas'] },
  { de: ['CP destino'],                                 a: ['CP destino'] },
  { de: ['Despacho'],                                   a: ['Despacho'] },
  { de: ['Vendedor'],                                   a: ['Vendedor'] },
  { de: ['Direccion de envio', 'Dirección de envío'],   a: ['Dirección de envío', 'Direccion de envio'] },
  { de: ['Telefono', 'Teléfono'],                       a: ['Teléfono', 'Telefono'] }
];

async function leer(key) {
  const cfg = core.areaCfg ? await core.areaCfg(key) : core.SHEETS[key];
  if (!cfg || !cfg.id) return { headers: [], rows: [], cfg: null };
  let values;
  try { values = await core.readRange(cfg.id, await core.resolveSheetName(cfg)); }
  catch (e) { return { headers: [], rows: [], cfg: null, error: e.message }; }
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
  return { headers: H, rows, cfg, sheetName: await core.resolveSheetName(cfg) };
}

module.exports = async (req, res) => {
  try {
    const body = req._body || await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    const que = norm(body.que) || 'revisar';
    if (que === 'aplicar' && !core.verifyWriter(body.token)) {
      return res.status(403).json({ error: 'Tu usuario solo puede consultar.' });
    }

    const cot = await leer('cotizaciones');
    if (!cot.headers.length) {
      return res.status(400).json({
        error: 'No se pudo leer la pestaña de Cotizaciones.' + (cot.error ? ' (' + cot.error + ')' : '')
      });
    }
    const Hc = cot.headers;
    const cRefC = col(Hc, 'No. de Referencia', 'Folio');
    const cStC = col(Hc, 'Status', 'Estatus');
    const cCliC = col(Hc, 'Cliente');
    const cFecC = col(Hc, 'Fecha del Cierre', 'Fecha');
    const cTotC = col(Hc, 'Total con envío', 'Total Pedido');
    const cProdC = col(Hc, 'Producto', 'Productos');
    const cCantC = col(Hc, 'Cantidad');

    // ---- Las cotizaciones de un cliente que todavía NO se venden ----
    //
    // Es lo que hace falta cuando alguien captura la venta a mano: saber que esa
    // venta ya está cotizada y que conviene convertirla en vez de recapturarla.
    if (que === 'del-cliente') {
      const quien = norm(body.cliente);
      if (!quien || quien.length < 3) return res.status(200).json({ ok: true, cotizaciones: [] });
      const porFolio = {};
      cot.rows.forEach(r => {
        const cliente = norm(cCliC ? r[cCliC] : '');
        if (!cliente) return;
        // Coincide si uno contiene al otro: "YARA GONZALEZ" vs "Yara Gonzalez Pérez"
        if (cliente.indexOf(quien) === -1 && quien.indexOf(cliente) === -1) return;
        const st = txt(cStC ? r[cStC] : '');
        if (/vendida|cancelad|anulad|rechazad/i.test(st)) return;
        const f = txt(cRefC ? r[cRefC] : '');
        if (!f) return;
        const g = porFolio[f] = porFolio[f] || {
          folio: f, cliente: txt(cCliC ? r[cCliC] : ''), status: st,
          fecha: txt(cFecC ? r[cFecC] : ''), total: 0, piezas: 0, productos: []
        };
        g.total += cTotC ? num(r[cTotC]) : 0;
        g.piezas += cCantC ? num(r[cCantC]) : 0;
        const p = txt(cProdC ? r[cProdC] : '');
        if (p && g.productos.indexOf(p) === -1) g.productos.push(p);
      });
      const lista = Object.keys(porFolio).map(k => porFolio[k])
        .sort((a, b) => (anioDe(b.fecha) - anioDe(a.fecha)) || (b.total - a.total))
        .slice(0, 6);
      lista.forEach(x => { x.total = Math.round(x.total * 100) / 100; });
      return res.status(200).json({ ok: true, cotizaciones: lista });
    }

    // ---- Revisar / aplicar ----
    const ven = await leer('ventas_registro');
    if (!ven.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer la pestaña de Ventas.' });
    }
    const Hv = ven.headers;
    const cRefV = col(Hv, 'No. de Referencia', 'Folio');
    const cCliV = col(Hv, 'Cliente');
    const cFecV = col(Hv, 'Fecha del Cierre', 'Fecha');
    if (!cRefV) return res.status(400).json({ error: 'La hoja de Ventas no tiene "No. de Referencia".' });

    // Nunca se escribe sobre una columna calculada
    const formulas = (core.FORMULA_FIELDS && core.FORMULA_FIELDS.ventas_registro) || [];
    const esFormula = (h) => formulas.some(x => norm(x) === norm(h));

    // La liga: la cotización dice "Vendida <folio>". Es la única que no se
    // adivina — un cliente puede tener varias cotizaciones y varias ventas.
    const deLaCot = {};
    cot.rows.forEach(r => {
      const m = txt(cStC ? r[cStC] : '').match(/^\s*vendida\s*[: ]\s*(.+)$/i);
      if (!m) return;
      const folioVenta = txt(m[1]).toUpperCase();
      const d = deLaCot[folioVenta] = deLaCot[folioVenta] || {
        cot: txt(cRefC ? r[cRefC] : ''), datos: {}
      };
      VIAJAN.forEach(v => {
        if (d.datos[v.a[0]]) return;
        const h = col(Hc, ...v.de);
        if (h && txt(r[h])) d.datos[v.a[0]] = txt(r[h]);
      });
    });

    const anio = body.anio ? +body.anio : 0;
    const porVenta = {};
    ven.rows.forEach(r => {
      const f = txt(r[cRefV]).toUpperCase();
      if (!f) return;
      if (anio && anioDe(r[cFecV]) !== anio) return;
      (porVenta[f] = porVenta[f] || []).push(r);
    });

    const plan = [], sinCotizacion = [];
    Object.keys(porVenta).forEach(f => {
      const filas = porVenta[f];
      const fuente = deLaCot[f];
      if (!fuente) { sinCotizacion.push(f); return; }
      const falta = {};
      VIAJAN.forEach(v => {
        const valor = fuente.datos[v.a[0]];
        if (!valor) return;
        const h = col(Hv, ...v.a);
        if (!h || esFormula(h)) return;
        // Solo si está vacío en TODOS los renglones del folio: si alguien ya lo
        // corrigió a mano en uno, no se toca nada de esa columna.
        const alguienTiene = filas.some(r => txt(r[h]));
        if (alguienTiene) return;
        falta[h] = valor;
      });
      if (!Object.keys(falta).length) return;
      plan.push({
        folio: f, cot: fuente.cot,
        cliente: txt(filas[0][cCliV] || ''), fecha: txt(filas[0][cFecV] || ''),
        filas: filas.map(r => r.__fila),
        datos: falta
      });
    });
    plan.sort((a, b) => (a.folio < b.folio ? -1 : 1));

    if (que === 'aplicar') {
      const soloFolio = txt(body.folio).toUpperCase();
      const data = [];
      let ventas = 0, celdas = 0;
      plan.forEach(p => {
        if (soloFolio && p.folio !== soloFolio) return;
        ventas++;
        Object.keys(p.datos).forEach(h => {
          const i = Hv.findIndex(x => norm(x) === norm(h));
          if (i === -1) return;
          const L = letra(i);
          p.filas.forEach(fila => {
            data.push({ range: "'" + ven.sheetName + "'!" + L + fila + ':' + L + fila,
                        values: [[p.datos[h]]] });
            celdas++;
          });
        });
      });
      if (data.length) await core.writeCells(ven.cfg.id, data);
      return res.status(200).json({
        ok: true, ventas, celdas,
        mensaje: ventas + (ventas === 1 ? ' venta quedó conectada con su cotización'
                                        : ' ventas quedaron conectadas con su cotización') +
                 ' (' + celdas + (celdas === 1 ? ' celda llenada' : ' celdas llenadas') + ').'
      });
    }

    return res.status(200).json({
      ok: true,
      ventas: Object.keys(porVenta).length,
      conCotizacion: Object.keys(porVenta).length - sinCotizacion.length,
      plan,
      celdas: plan.reduce((a, p) => a + Object.keys(p.datos).length * p.filas.length, 0),
      campos: VIAJAN.map(v => v.a[0]),
      nota: 'Solo se llenan las columnas que están vacías en TODOS los renglones de la venta. ' +
            'Lo que ya tiene algo capturado no se toca, y las columnas de fórmula tampoco.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
