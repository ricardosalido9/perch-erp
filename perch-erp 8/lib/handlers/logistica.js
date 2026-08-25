// El calendario de logística: qué se entrega y qué se recoge cada día.
//
// Las entregas salen de VENTAS (fecha acordada, cliente, dirección).
// Las recolecciones salen de Pedidos a Proveedores (fecha estimada).
// Al marcar entregado, la fecha se escribe de vuelta en VENTAS.
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
const MESES = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9, sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7,
  agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
const MESES_N = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','octubre','noviembre','diciembre'];
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
function aTexto(dia) {
  if (!dia) return '';
  return (dia % 100) + ' ' + MESES_N[Math.floor(dia / 100) % 100 - 1] + ' ' + Math.floor(dia / 10000);
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
  return { headers, rows, cfg };
}

// La zona por la dirección: sirve para juntar entregas cercanas en una ruta
const ZONAS = [
  ['Polanco', /polanco|masaryk|campos eliseos|anatole/i],
  ['Lomas', /lomas de chapultepec|palmas|virreyes|bosques de las lomas|vista hermosa/i],
  ['Santa Fe', /santa fe|contadero|bezares|vasco de quiroga/i],
  ['Condesa / Roma', /condesa|roma norte|roma sur|hipodromo|amsterdam|alvaro obregon/i],
  ['Del Valle / Nápoles', /del valle|napoles|insurgentes sur|actipan|xola/i],
  ['Coyoacán / San Ángel', /coyoacan|san angel|chimalistac|altavista|pedregal/i],
  ['Interlomas / Huixquilucan', /interlomas|huixquilucan|tecamachalco|bosque real|magnocentro/i],
  ['Satélite / Naucalpan', /satelite|naucalpan|echegaray|lomas verdes|ciudad satelite/i],
  ['Sur (Tlalpan / Coapa)', /tlalpan|coapa|xochimilco|villa coapa|fuentes brotantes/i],
  ['Norte (GAM / Azcapotzalco)', /gustavo a madero|azcapotzalco|lindavista|vallejo/i],
  ['Oriente (Iztapalapa / Neza)', /iztapalapa|nezahualcoyotl|iztacalco|ecatepec/i],
  ['Querétaro', /queretaro|qro\b/i],
  ['Monterrey', /monterrey|san pedro garza|mty\b/i],
  ['Guadalajara', /guadalajara|zapopan|gdl\b/i],
  ['Foráneo', /puebla|cuernavaca|valle de bravo|merida|cancun|tulum|oaxaca|san miguel/i]
];
function zonaDe(dir) {
  const t = txt(dir);
  if (!t) return 'Sin dirección';
  for (const [nombre, rx] of ZONAS) if (rx.test(t)) return nombre;
  return 'Otra zona';
}
const esSi = (v) => /^(si|sí|true|x|1|verdadero|ok)$/i.test(txt(v));

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });

    const [ven, ped] = await Promise.all([leer('ventas_registro'), leer('prov_pedidos')]);
    if (!ven.headers.length) return res.status(400).json({ error: 'No se pudo leer VENTAS.' });

    const V = ven.headers;
    const vFec = col(V, 'Fecha de entrega acordada');
    const vReal = col(V, 'Fecha de entrega real');
    const vRef = col(V, 'No. de Referencia', 'Folio');
    const vCli = col(V, 'Cliente');
    const vDes = col(V, 'Despacho');
    const vDir = col(V, 'Direccion de envio', 'Dirección de envío', 'Dirección de Entrega');
    const vTel = col(V, 'Telefono', 'Teléfono');
    const vProd = col(V, 'Producto', 'Productos');
    const vCant = col(V, 'Cantidad');
    const vSt = col(V, 'Status');
    const vMat = col(V, 'Material');
    const vRev = col(V, 'Revisado');
    const vComL = col(V, 'Comentarios de logística', 'Comentarios logistica');

    // ---- Marcar algo: entregado, revisado o un comentario ----
    if (body.marcar) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const folio = txt(body.folio);
      if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
      const cambios = [];
      const hoy = new Date();
      const hoyTxt = hoy.getDate() + ' ' + MESES_N[hoy.getMonth()] + ' ' + hoy.getFullYear();
      const fecha = txt(body.fecha) || hoyTxt;

      ven.rows.forEach(r => {
        if (norm(r[vRef]) !== norm(folio)) return;
        // Si viene un producto, solo ese renglón
        if (body.producto && norm(r[vProd]) !== norm(body.producto)) return;
        const poner = (columna, valor) => {
          if (!columna) return;
          const j = V.indexOf(columna);
          if (j === -1) return;
          cambios.push({
            range: "'" + ven.cfg.sheetName + "'!" + letra(j) + r._fila,
            values: [[valor]]
          });
        };
        if (body.marcar === 'entregado') {
          poner(vReal, fecha);
          poner(vSt, 'Entregado');
        } else if (body.marcar === 'revisado') {
          poner(vRev, 'Sí');
        } else if (body.marcar === 'comentario') {
          poner(vComL, txt(body.comentario));
        }
      });
      if (!cambios.length) {
        return res.status(400).json({
          error: 'No se encontró ese folio, o la hoja no tiene la columna necesaria. ' +
                 (body.marcar === 'revisado' && !vRev ? 'Falta la columna "Revisado" en VENTAS.' : '') +
                 (body.marcar === 'comentario' && !vComL
                   ? 'Falta la columna "Comentarios de logística" en VENTAS.' : '')
        });
      }
      await core.writeCells(ven.cfg.id, cambios);
      return res.status(200).json({
        ok: true, cambios: cambios.length,
        mensaje: body.marcar === 'entregado'
          ? folio + ' quedó como entregado el ' + fecha
          : body.marcar === 'revisado' ? folio + ' quedó marcado como revisado'
          : 'Comentario guardado en ' + folio
      });
    }

    // ---- Armar el calendario ----
    const anio = +body.anio || new Date().getFullYear();
    const mes = +body.mes || (new Date().getMonth() + 1);
    const hoy = new Date();
    const hoyN = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();

    // Las entregas, agrupadas por folio
    const porFolio = {};
    ven.rows.forEach(r => {
      const st = txt(vSt ? r[vSt] : '');
      const entregado = /entregado/i.test(st);
      const cancelado = /cancelad/i.test(st);
      if (cancelado) return;
      const d = vFec ? fechaNum(r[vFec]) : null;
      if (d === null) return;
      const folio = txt(vRef ? r[vRef] : '');
      if (!folio) return;
      if (!porFolio[folio]) {
        porFolio[folio] = {
          tipo: 'entrega', folio,
          dia: d, fecha: txt(r[vFec]),
          cliente: txt(vCli ? r[vCli] : ''),
          despacho: txt(vDes ? r[vDes] : ''),
          direccion: txt(vDir ? r[vDir] : ''),
          telefono: txt(vTel ? r[vTel] : ''),
          status: st, entregado,
          fechaReal: txt(vReal ? r[vReal] : ''),
          revisado: vRev ? esSi(r[vRev]) : null,
          comentario: txt(vComL ? r[vComL] : ''),
          piezas: 0, muebles: []
        };
      }
      const f = porFolio[folio];
      const q = vCant ? num(r[vCant]) : 0;
      f.piezas += q;
      if (f.muebles.length < 25) {
        f.muebles.push({
          producto: txt(vProd ? r[vProd] : ''),
          material: txt(vMat ? r[vMat] : ''),
          cantidad: q
        });
      }
    });

    // Las recolecciones en el proveedor
    const recolecciones = [];
    if (ped.headers.length) {
      const P = ped.headers;
      const pEst = col(P, 'Fecha Estimada de Entrega');
      const pPed = col(P, 'Pedido Proveedor');
      const pProv = col(P, 'Proveedor');
      const pSt = col(P, 'Status');
      const pProd = col(P, 'Productos', 'Producto');
      const pCant = col(P, 'Cantidad');
      const pDest = col(P, 'Destino');
      const pFol = col(P, 'Folio cliente');
      const porPedido = {};
      if (pEst) ped.rows.forEach(r => {
        const st = txt(pSt ? r[pSt] : '');
        if (/entregado|cancelad/i.test(st)) return;
        const d = fechaNum(r[pEst]);
        if (d === null) return;
        const k = txt(pPed ? r[pPed] : '') || ('fila' + r._fila);
        if (!porPedido[k]) {
          porPedido[k] = {
            tipo: 'recoleccion', pedido: k, dia: d, fecha: txt(r[pEst]),
            proveedor: txt(pProv ? r[pProv] : ''),
            destino: txt(pDest ? r[pDest] : ''),
            status: st, piezas: 0, muebles: [], folios: {}
          };
        }
        const g = porPedido[k];
        const q = pCant ? num(r[pCant]) : 0;
        g.piezas += q;
        const fc = txt(pFol ? r[pFol] : '');
        if (fc && !/stock|exhibicion/i.test(fc)) g.folios[fc] = 1;
        if (g.muebles.length < 25) {
          g.muebles.push({ producto: txt(pProd ? r[pProd] : ''), cantidad: q });
        }
      });
      Object.keys(porPedido).forEach(k => {
        const g = porPedido[k];
        g.paraFolios = Object.keys(g.folios);
        delete g.folios;
        recolecciones.push(g);
      });
    }

    const entregas = Object.keys(porFolio).map(k => {
      const e = porFolio[k];
      e.zona = zonaDe(e.direccion);
      e.vencida = !e.entregado && e.dia < hoyN;
      return e;
    });

    // Los eventos del mes que se pide
    const delMes = (x) => Math.floor(x.dia / 10000) === anio &&
                          (Math.floor(x.dia / 100) % 100) === mes;
    const eventos = entregas.concat(recolecciones);
    const dias = {};
    eventos.filter(delMes).forEach(x => {
      const d = x.dia % 100;
      if (!dias[d]) dias[d] = [];
      dias[d].push(x);
    });

    // Rutas que conviene juntar: misma zona, dentro de 3 días
    const sugerencias = [];
    const pendientes = entregas.filter(e => !e.entregado && e.dia >= hoyN)
      .sort((a, b) => a.dia - b.dia);
    const porZona = {};
    pendientes.forEach(e => {
      if (e.zona === 'Sin dirección' || e.zona === 'Otra zona') return;
      (porZona[e.zona] = porZona[e.zona] || []).push(e);
    });
    Object.keys(porZona).forEach(z => {
      const lista = porZona[z];
      if (lista.length < 2) return;
      // Se agrupan las que caen dentro de 3 días entre sí
      let grupo = [lista[0]];
      const cerrar = () => {
        if (grupo.length >= 2) {
          const fechas = grupo.map(g => g.dia);
          sugerencias.push({
            zona: z, n: grupo.length,
            piezas: grupo.reduce((a, g) => a + g.piezas, 0),
            desde: Math.min.apply(null, fechas), hasta: Math.max.apply(null, fechas),
            folios: grupo.map(g => ({ folio: g.folio, cliente: g.cliente, dia: g.dia,
                                      fecha: g.fecha, piezas: g.piezas })),
            texto: grupo.length + ' entregas por ' + z + ' entre el ' +
                   (Math.min.apply(null, fechas) % 100) + ' y el ' +
                   (Math.max.apply(null, fechas) % 100) + ': se pueden hacer en una vuelta'
          });
        }
        grupo = [];
      };
      for (let i = 1; i < lista.length; i++) {
        const prev = grupo[grupo.length - 1];
        const f = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
        const dd = Math.round((f(lista[i].dia) - f(prev.dia)) / 86400000);
        if (dd <= 3) grupo.push(lista[i]);
        else { cerrar(); grupo = [lista[i]]; }
      }
      cerrar();
    });

    return res.status(200).json({
      ok: true, anio, mes, hoy: hoyN,
      nombreMes: MESES_N[mes - 1],
      dias,
      // Lo de hoy y lo que viene, para la vista de lista
      deHoy: eventos.filter(x => x.dia === hoyN),
      vencidas: entregas.filter(e => e.vencida).sort((a, b) => a.dia - b.dia),
      proximas: eventos.filter(x => x.dia > hoyN).sort((a, b) => a.dia - b.dia).slice(0, 30),
      sugerencias: sugerencias.sort((a, b) => b.n - a.n),
      totales: {
        entregasDelMes: entregas.filter(delMes).length,
        recoleccionesDelMes: recolecciones.filter(delMes).length,
        vencidas: entregas.filter(e => e.vencida).length,
        piezasDelMes: entregas.filter(delMes).reduce((a, e) => a + e.piezas, 0)
      },
      columnas: {
        revisado: vRev || '(falta la columna Revisado)',
        comentarios: vComL || '(falta la columna Comentarios de logística)',
        fechaReal: vReal || '(falta Fecha de entrega real)'
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
