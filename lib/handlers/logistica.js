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

    // También los envíos ya programados: son las entregas que Logística mueve,
    // con su paquetería, su guía y su fecha real. Sin ellos el calendario solo
    // mostraba lo que dice la venta, no lo que de verdad va a salir.
    const [ven, ped, env] = await Promise.all([
      leer('ventas_registro'), leer('prov_pedidos'), leer('op_envios')]);
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
    // El rastro de quién movió qué. Se escribe desde el servidor con la hora de
    // México y el usuario de la sesión firmada: mover una entrega es cambiarle
    // la fecha a un cliente, y tiene que quedar dicho quién lo hizo.
    const vAct = col(V, 'Última actualización', 'Ultima actualizacion');

    // ---- Marcar algo: entregado, revisado o un comentario ----
    if (body.marcar) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const hoy = new Date();
      const hoyTxt = hoy.getDate() + ' ' + MESES_N[hoy.getMonth()] + ' ' + hoy.getFullYear();
      const fecha = txt(body.fecha) || hoyTxt;

      // ---- Mover una RECOLECCIÓN: la fecha que el proveedor nos prometió ----
      //
      // 10 nov: "que el calendario se pueda actualizar con producción, para
      // programar con una semana de anticipación, y que en el calendario directo
      // se puedan mover las fechas".
      //
      // El calendario ya mostraba las dos cosas —las entregas al cliente y lo que
      // hay que recoger del proveedor— pero solo se podía mover la del cliente.
      // La de producción había que ir a cambiarla a Pedidos a Proveedores, que es
      // justo donde no se ve el choque de fechas de la semana.
      //
      // Se mueve el PEDIDO completo: la fecha es del pedido, no de cada mueble,
      // igual que la de la venta es de la venta y no de cada pieza.
      if (body.marcar === 'fecha' && norm(body.tipo) === 'recoleccion') {
        const pedido = txt(body.pedido);
        if (!pedido) return res.status(400).json({ error: 'Falta el número de pedido.' });
        if (!ped.headers.length || !ped.cfg) {
          return res.status(400).json({ error: 'No se pudo leer Pedidos a Proveedores.' });
        }
        const P = ped.headers;
        const pNo2 = col(P, 'Pedido Proveedor', 'No. de Pedido');
        const pEst2 = col(P, 'Fecha Estimada de Entrega', 'Fecha estimada');
        if (!pNo2 || !pEst2) {
          return res.status(400).json({
            error: 'Pedidos a Proveedores no tiene la columna "' +
                   (!pNo2 ? 'Pedido Proveedor' : 'Fecha Estimada de Entrega') + '".' });
        }
        const jEst = P.indexOf(pEst2);
        const cambiosP = [];
        ped.rows.forEach(r => {
          if (norm(r[pNo2]) !== norm(pedido)) return;
          cambiosP.push({
            range: "'" + ped.cfg.sheetName + "'!" + letra(jEst) + r._fila,
            values: [[fecha]]
          });
        });
        if (!cambiosP.length) {
          return res.status(400).json({ error: 'No se encontró el pedido ' + pedido + '.' });
        }
        await core.writeCells(ped.cfg.id, cambiosP);
        return res.status(200).json({
          ok: true, cambios: cambiosP.length,
          mensaje: pedido + ' se movió al ' + fecha + ' (' + cambiosP.length +
                   (cambiosP.length === 1 ? ' renglón)' : ' renglones)')
        });
      }

      const folio = txt(body.folio);
      if (!folio) return res.status(400).json({ error: 'Falta el folio.' });
      const cambios = [];

      // ---- El rastro ----
      //
      // "Que haya uno de edición que también se guarde, pero que puedan modificar
      // la fecha o algo así, pero que sí quede registrado también ese cambio"
      // (Val, 10 nov).
      //
      // Cambiar una fecha de entrega no es acomodar una tarjeta: es mover un
      // compromiso con un cliente. Queda escrito QUÉ cambió, DE QUÉ A QUÉ, QUIÉN
      // lo hizo y CUÁNDO, con la hora del servidor. Si la hoja no tiene las
      // columnas del rastro, el cambio se hace igual y no se pierde nada.
      const quien = txt(sesion && sesion.u) || 'el panel';
      const cuando = core.ahoraMx ? core.ahoraMx() : hoyTxt;
      const sello = quien + ' / ' + cuando;
      const bitacora = [];
      const anota = (t) => { if (t) bitacora.push('[' + cuando + ' · ' + quien + '] ' + t); };

      // Lo que decía antes, para poder contar el cambio
      const antes = ven.rows.filter(r => norm(r[vRef]) === norm(folio))[0] || {};
      const fechaAntes = txt(vFec ? antes[vFec] : '');
      const nuevaFecha = txt(body.fecha);
      const comentario = txt(body.comentario);
      const esEditar = body.marcar === 'editar';
      const cambiaFecha = (body.marcar === 'fecha') ||
                          (esEditar && nuevaFecha && norm(nuevaFecha) !== norm(fechaAntes));

      if (esEditar && !cambiaFecha && !comentario) {
        return res.status(400).json({ error: 'No cambiaste nada.' });
      }
      if (body.marcar === 'comentario' && !comentario) {
        return res.status(400).json({ error: 'El comentario viene vacío.' });
      }
      if (body.marcar === 'entregado') anota('Se marcó entregado el ' + fecha + '.');
      if (body.marcar === 'revisado') anota('Se marcó revisado.');
      if (cambiaFecha) {
        anota('Entrega movida ' + (fechaAntes ? 'del ' + fechaAntes + ' ' : '') +
              'al ' + (nuevaFecha || fecha) + '.');
      }
      if (comentario && body.marcar !== 'comentario') anota(comentario);

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
        // Lo que ya había escrito en la bitácora de ese renglón, más lo de hoy.
        // No se borra nada: se le agrega abajo.
        const apilar = (texto) => {
          if (!vComL || !texto) return;
          const ya = txt(r[vComL]);
          poner(vComL, (ya ? ya + '\n' : '') + texto);
        };
        if (body.marcar === 'entregado') {
          poner(vReal, fecha);
          poner(vSt, 'Entregado');
        } else if (body.marcar === 'revisado') {
          poner(vRev, 'Sí');
        } else if (body.marcar === 'comentario') {
          apilar('[' + cuando + ' · ' + quien + '] ' + comentario);
        } else if (body.marcar === 'fecha') {
          // Mover la entrega desde el calendario, que es donde se ve el choque de
          // fechas. Antes había que entrar a Ventas, abrir el folio y editar el
          // renglón. Toca TODOS los renglones del folio: la fecha es de la venta,
          // no de cada mueble.
          poner(vFec, fecha);
        } else if (esEditar) {
          if (cambiaFecha) poner(vFec, nuevaFecha);
        }
        if (bitacora.length && body.marcar !== 'comentario') apilar(bitacora.join('\n'));
        // El sello va en todos los renglones que se tocaron
        if (vAct) poner(vAct, sello);
      });
      if (!cambios.length) {
        return res.status(400).json({
          error: 'No se encontró ese folio, o la hoja no tiene la columna necesaria. ' +
                 (body.marcar === 'revisado' && !vRev ? 'Falta la columna "Revisado" en VENTAS.' : '') +
                 (body.marcar === 'fecha' && !vFec
                   ? 'Falta la columna "Fecha de entrega acordada" en VENTAS.' : '') +
                 ((body.marcar === 'comentario' || esEditar) && !vComL
                   ? 'Falta la columna "Comentarios de logística" en VENTAS.' : '')
        });
      }
      await core.writeCells(ven.cfg.id, cambios);
      return res.status(200).json({
        ok: true, cambios: cambios.length,
        // Lo que se le dice al usuario es lo mismo que quedó escrito en la hoja
        registro: bitacora.join(' '),
        mensaje: body.marcar === 'entregado'
          ? folio + ' quedó como entregado el ' + fecha
          : body.marcar === 'revisado' ? folio + ' quedó marcado como revisado'
          : body.marcar === 'fecha' ? folio + ' se movió al ' + fecha
          : esEditar
            ? (cambiaFecha ? folio + ' se movió al ' + nuevaFecha + ', y quedó anotado quién y cuándo'
                           : 'Se guardó la nota de ' + folio)
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
          telefono: core.telTexto(vTel ? r[vTel] : ''),
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
      const pFol = col(P, 'Folio cliente', 'Folio');
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

    // Los envíos mandan sobre lo que dice la venta: si Logística ya le puso fecha
    // a un folio, ésa es la que va en el calendario.
    if (env && env.headers.length) {
      const E = env.headers;
      const cE = (...n) => { for (const x of n) { const c = E.filter(y => norm(y) === norm(x))[0]; if (c) return c; } return null; };
      const eFol = cE('Pedido', 'Folio', 'Folio cliente');
      const eEst = cE('Fecha Estimada de Entrega', 'Fecha estimada de entrega');
      const eReal = cE('Fecha de Entrega Real', 'Fecha de entrega real');
      const eSt = cE('Status');
      const ePaq = cE('Paqueteria', 'Paquetería');
      const eGuia = cE('Guía', 'Guia');
      if (eFol) env.rows.forEach(r => {
        const f = txt(r[eFol]);
        if (!f || !porFolio[f]) return;
        const d = fechaNum(eReal && txt(r[eReal]) ? r[eReal] : (eEst ? r[eEst] : ''));
        if (d) porFolio[f].dia = d;
        if (eReal && txt(r[eReal])) porFolio[f].entregado = true;
        if (eSt && txt(r[eSt])) porFolio[f].statusEnvio = txt(r[eSt]);
        if (ePaq && txt(r[ePaq])) porFolio[f].paqueteria = txt(r[ePaq]);
        if (eGuia && txt(r[eGuia])) porFolio[f].guia = txt(r[eGuia]);
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
      // Las que todavía no se vencen. Hasta ahora solo se veían las atrasadas, y
      // debajo no había nada: "que de todas formas salgan todos los demás que
      // siguen pendientes por entregar" (Val, 10 nov). Van TODAS, no solo las
      // del mes que se esté viendo: la lista es para saber qué se debe, y lo que
      // se debe no cambia porque uno pase de mes en el calendario.
      pendientes: entregas.filter(e => !e.entregado && !e.vencida)
                          .sort((a, b) => a.dia - b.dia),
      proximas: eventos.filter(x => x.dia > hoyN).sort((a, b) => a.dia - b.dia).slice(0, 30),
      sugerencias: sugerencias.sort((a, b) => b.n - a.n),
      totales: {
        entregasDelMes: entregas.filter(delMes).length,
        recoleccionesDelMes: recolecciones.filter(delMes).length,
        vencidas: entregas.filter(e => e.vencida).length,
        pendientes: entregas.filter(e => !e.entregado && !e.vencida).length,
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
