// La quincena, en cuatro pasos:
//
//   1. Replicar: se copian los renglones de la quincena anterior como PROPUESTA.
//   2. Buscar: se buscan los recibos timbrados del periodo que se va a pagar.
//   3. Ligar: al que tiene recibo se le ponen el bruto y el neto REALES.
//   4. Lo que queda: pagos en efectivo o gente sin recibo, editables a mano.
//
// La regla que sostiene todo: el recibo timbrado manda. Una propuesta es una
// intención de pago; el CFDI es lo que de verdad se pagó. Si los dos conviven sin
// distinguirse, en tres meses nadie sabe cuál mirar. Por eso cada renglón dice de
// dónde viene, y el que ya está timbrado no se edita.
const core = require('../core');
const CFG = require('../config');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const t = String(v == null ? '' : v).trim();
  if (!t) return 0;
  const contable = /^-/.test(t) && /-$/.test(t);
  const m = t.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return 0;
  let n = parseFloat(m[0].replace(/,/g, ''));
  if (isNaN(n)) return 0;
  if (!contable && (/^\(.*\)$/.test(t) || /^-/.test(t))) n = -n;
  return n;
}
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
  sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
  junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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
  if (m && MESES_N[m[2]]) return +m[3] * 10000 + MESES_N[m[2]] * 100 + +m[1];
  return null;
}
const red = (n) => Math.round((n || 0) * 100) / 100;
const aTexto = (d) => d === null ? '' :
  (d % 100) + ' ' + MESES[Math.floor(d / 100) % 100 - 1] + ' ' + Math.floor(d / 10000);

// La quincena de una fecha: la primera va del 1 al 15, la segunda del 16 al fin
function quincenaDe(d) {
  if (d === null) return null;
  const anio = Math.floor(d / 10000), mes = Math.floor(d / 100) % 100, dia = d % 100;
  return { anio, mes, mitad: dia <= 15 ? 1 : 2 };
}
function claveQuincena(q) { return q ? (q.anio * 100 + q.mes) * 10 + q.mitad : ''; }
function nombreQuincena(q) {
  if (!q) return '';
  return (q.mitad === 1 ? 'Del 1 al 15 de ' : 'Del 16 al fin de ') +
    MESES[q.mes - 1] + ' ' + q.anio;
}
// La quincena anterior a una dada
function anteriorA(q) {
  if (q.mitad === 2) return { anio: q.anio, mes: q.mes, mitad: 1 };
  return q.mes === 1 ? { anio: q.anio - 1, mes: 12, mitad: 2 }
                     : { anio: q.anio, mes: q.mes - 1, mitad: 2 };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    const cfg = core.areaCfg ? await core.areaCfg('rh_nomina') : core.SHEETS.rh_nomina;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'La nómina no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    if (!values.length) return res.status(400).json({ error: 'No se pudo leer la nómina.' });

    const H = (values[0] || []).map(h => String(h).trim());
    const cNom = col(H, 'Nombre');
    const cIni = col(H, 'Fecha Inicio', 'Fecha de Inicio', 'Fecha');
    const cTim = col(H, 'Fecha Timbrado', 'Fecha de Timbrado');
    const cSub = col(H, 'Subtotal', 'Bruto', 'Percepciones');
    const cTot = col(H, 'Total', 'Neto');
    const cPue = col(H, 'Puesto');
    const cArea = col(H, 'Área', 'Area');
    const cDep = col(H, 'Departamento');
    const cTipo = col(H, 'Tipo de Pago', 'Tipo de pago');
    const cUUID = col(H, 'UUID');
    const cOrigen = col(H, 'Origen', 'Estado', 'Status');
    const cCom = col(H, 'Comentarios', 'Comentario', 'Nota');
    if (!cNom || !cTot) {
      return res.status(400).json({ error: 'La nómina no tiene Nombre o Total.' });
    }

    // Qué quincena se va a pagar. Si no la mandan, la de hoy.
    const hoy = new Date();
    let destino;
    if (body.anio && body.mes && body.mitad) {
      destino = { anio: +body.anio, mes: +body.mes, mitad: +body.mitad };
    } else {
      destino = quincenaDe(hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate());
    }
    const origen = anteriorA(destino);

    // Todos los renglones, clasificados por quincena
    const filas = [];
    for (let i = 1; i < values.length; i++) {
      const f = values[i] || [];
      const o = {}; H.forEach((h, j) => { o[h] = f[j]; });
      const nombre = txt(o[cNom]);
      if (!nombre) continue;
      // Para saber a qué quincena pertenece manda la fecha de inicio del periodo;
      // si no está, se usa la de timbrado.
      const d = fechaNum(cIni ? o[cIni] : '') || fechaNum(cTim ? o[cTim] : '');
      const q = quincenaDe(d);
      filas.push({
        fila: i + 1, nombre: nombre, quincena: q, clave: claveQuincena(q),
        inicio: txt(cIni ? o[cIni] : ''), timbrado: txt(cTim ? o[cTim] : ''),
        bruto: cSub ? red(num(o[cSub])) : 0,
        neto: red(num(o[cTot])),
        puesto: txt(cPue ? o[cPue] : ''), area: txt(cArea ? o[cArea] : ''),
        departamento: txt(cDep ? o[cDep] : ''),
        tipoPago: txt(cTipo ? o[cTipo] : ''),
        uuid: txt(cUUID ? o[cUUID] : ''),
        origen: txt(cOrigen ? o[cOrigen] : ''),
        comentarios: txt(cCom ? o[cCom] : '')
      });
    }

    const kDestino = claveQuincena(destino), kOrigen = claveQuincena(origen);
    const deLaAnterior = filas.filter(x => x.clave === kOrigen);
    const yaEnDestino = filas.filter(x => x.clave === kDestino);

    // ---- Paso 2: los recibos timbrados del periodo que se va a pagar ----
    // Un renglón cuenta como recibo cuando trae UUID o fecha de timbrado.
    const esRecibo = (x) => !!x.uuid || (!!x.timbrado && !/propuesta/i.test(x.origen));
    const recibos = yaEnDestino.filter(esRecibo);
    const propuestasExistentes = yaEnDestino.filter(x => !esRecibo(x));

    // ---- Pasos 1, 3 y 4: se arma el borrador de la quincena ----
    const usados = {};
    const borrador = [];

    // Primero la gente que ya trae recibo: esos mandan
    recibos.forEach(r => {
      usados[norm(r.nombre)] = true;
      borrador.push({
        nombre: r.nombre, fila: r.fila,
        estado: 'timbrado',
        bruto: r.bruto, neto: r.neto,
        puesto: r.puesto, area: r.area, departamento: r.departamento,
        tipoPago: r.tipoPago, uuid: r.uuid,
        editable: false,
        porQue: 'Tiene recibo timbrado. Este es el dato bueno.'
      });
    });

    // Después la gente de la quincena anterior que todavía no tiene recibo
    deLaAnterior.forEach(a => {
      if (usados[norm(a.nombre)]) return;
      usados[norm(a.nombre)] = true;
      const yaPropuesto = propuestasExistentes
        .filter(p => norm(p.nombre) === norm(a.nombre))[0];
      const enEfectivo = /efectivo/i.test(a.tipoPago);
      borrador.push({
        nombre: a.nombre,
        fila: yaPropuesto ? yaPropuesto.fila : null,
        estado: yaPropuesto ? 'propuesta guardada' : 'por replicar',
        // Se copia el sueldo de la quincena anterior. Bonos y descuentos NO se
        // heredan: si la quincena pasada tuvo un descuento, arrastrarlo sería
        // repetir el castigo sin que nadie lo decida.
        bruto: yaPropuesto ? yaPropuesto.bruto : a.bruto,
        neto: yaPropuesto ? yaPropuesto.neto : a.neto,
        puesto: a.puesto, area: a.area, departamento: a.departamento,
        tipoPago: a.tipoPago, uuid: '',
        editable: true,
        enEfectivo: enEfectivo,
        comentarios: yaPropuesto ? yaPropuesto.comentarios : '',
        deLaQuincena: nombreQuincena(origen),
        porQue: enEfectivo
          ? 'Se paga en efectivo, así que no va a tener recibo timbrado. Ajusta el monto si hubo incidencia.'
          : 'Todavía no tiene recibo. Se copió lo de la quincena anterior; ajusta si hubo incidencia.'
      });
    });

    // Y la gente que trae recibo pero no estaba en la quincena anterior: altas
    borrador.forEach(b => {
      if (b.estado !== 'timbrado') return;
      const estaba = deLaAnterior.some(a => norm(a.nombre) === norm(b.nombre));
      if (!estaba) b.porQue = 'Tiene recibo y no estaba en la quincena anterior: ¿alta nueva?';
    });

    // Quien estaba en la anterior, no tiene recibo y tampoco propuesta: se cayó
    const sinNada = borrador.filter(b => b.estado === 'por replicar' && !b.enEfectivo).length;

    borrador.sort((a, b) => {
      const orden = { 'timbrado': 0, 'propuesta guardada': 1, 'por replicar': 2 };
      return (orden[a.estado] - orden[b.estado]) || a.nombre.localeCompare(b.nombre, 'es');
    });

    // Si ya hay recibo y también propuesta del mismo nombre, se avisa: es un
    // duplicado que inflaría el total del mes.
    const duplicados = [];
    propuestasExistentes.forEach(p => {
      if (recibos.some(r => norm(r.nombre) === norm(p.nombre))) {
        duplicados.push({ nombre: p.nombre, fila: p.fila,
          que: 'Tiene propuesta y recibo timbrado a la vez. Borra la propuesta o el total se cuenta dos veces.' });
      }
    });

    return res.status(200).json({
      ok: true,
      quincena: { clave: kDestino, nombre: nombreQuincena(destino),
                  anio: destino.anio, mes: destino.mes, mitad: destino.mitad },
      quincenaAnterior: { clave: kOrigen, nombre: nombreQuincena(origen),
                          renglones: deLaAnterior.length },
      resumen: {
        gente: borrador.length,
        conRecibo: borrador.filter(b => b.estado === 'timbrado').length,
        porReplicar: borrador.filter(b => b.estado === 'por replicar').length,
        propuestasGuardadas: borrador.filter(b => b.estado === 'propuesta guardada').length,
        enEfectivo: borrador.filter(b => b.enEfectivo).length,
        sinReciboNiEfectivo: sinNada,
        brutoTotal: red(borrador.reduce((a, b) => a + b.bruto, 0)),
        netoTotal: red(borrador.reduce((a, b) => a + b.neto, 0)),
        netoAnterior: red(deLaAnterior.reduce((a, x) => a + x.neto, 0))
      },
      borrador: borrador,
      duplicados: duplicados,
      // Qué columnas hacen falta para poder guardar
      columnas: {
        origen: cOrigen || '(NO ESTÁ)',
        uuid: cUUID || '(NO ESTÁ)',
        comentarios: cCom || '(NO ESTÁ)',
        aviso: cOrigen ? '' :
          'La hoja no tiene columna "Origen". Sin ella no se puede distinguir una ' +
          'propuesta de un recibo timbrado, y al replicar se mezclarían.'
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
