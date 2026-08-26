// Guarda los renglones de la quincena que una persona ya revisó.
//
// Solo escribe propuestas. Los renglones timbrados NO se tocan nunca: esos vienen
// del CFDI y son la verdad. Si alguien intenta mandar uno, se ignora y se avisa.
const core = require('../core');
const CFG = require('../config');

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
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
const letra = (i) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    // Es dinero de gente: solo quien lleva la nómina puede tocarla
    const rol = norm(sesion && sesion.rol);
    if (rol && rol !== 'fiscal' && rol !== 'admin' && rol !== 'administrador') {
      return res.status(403).json({
        error: 'Tu usuario no puede modificar la nómina.',
        pista: 'Solo el rol fiscal o el administrador.'
      });
    }

    const lista = Array.isArray(body.renglones) ? body.renglones : [];
    if (!lista.length) return res.status(400).json({ error: 'No mandaste ningún renglón.' });
    const q = body.quincena || {};
    if (!q.anio || !q.mes || !q.mitad) {
      return res.status(400).json({ error: 'Falta decir de qué quincena son.' });
    }

    const cfg = core.areaCfg ? await core.areaCfg('rh_nomina') : core.SHEETS.rh_nomina;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'La nómina no está conectada.' });
    const values = await core.readRange(cfg.id, cfg.sheetName);
    const H = (values[0] || []).map(h => String(h).trim());

    const cNom = col(H, 'Nombre');
    const cIni = col(H, 'Fecha Inicio', 'Fecha de Inicio', 'Fecha');
    const cSub = col(H, 'Subtotal', 'Bruto', 'Percepciones');
    const cTot = col(H, 'Total', 'Neto');
    const cPue = col(H, 'Puesto');
    const cArea = col(H, 'Área', 'Area');
    const cDep = col(H, 'Departamento');
    const cTipo = col(H, 'Tipo de Pago', 'Tipo de pago');
    const cOrigen = col(H, 'Origen', 'Estado', 'Status');
    const cCom = col(H, 'Comentarios', 'Comentario', 'Nota');
    if (!cNom || !cTot) return res.status(400).json({ error: 'La nómina no tiene Nombre o Total.' });
    if (!cOrigen) {
      return res.status(400).json({
        error: 'La hoja no tiene columna "Origen".',
        pista: 'Sin ella no se puede distinguir una propuesta de un recibo timbrado. ' +
               'Agrégale una columna llamada Origen antes de guardar.'
      });
    }

    // La fecha de inicio del periodo: día 1 o día 16
    const dia = q.mitad === 1 ? 1 : 16;
    const fechaInicio = dia + ' ' + MESES[q.mes - 1] + ' ' + q.anio;
    const quien = txt(sesion && sesion.nombre) || txt(sesion && sesion.usuario) || '';
    const hoy = new Date();
    const sello = hoy.getDate() + ' ' + MESES[hoy.getMonth()] + ' ' + hoy.getFullYear();

    const nuevos = [], cambios = [], ignorados = [];
    lista.forEach(r => {
      if (txt(r.estado) === 'timbrado' || txt(r.uuid)) {
        ignorados.push({ nombre: txt(r.nombre),
          porQue: 'Ya está timbrado: ese renglón no se toca.' });
        return;
      }
      const nombre = txt(r.nombre);
      if (!nombre) return;
      const neto = Number(r.neto) || 0;
      const bruto = Number(r.bruto) || 0;
      const nota = (txt(r.comentarios) ? txt(r.comentarios) + ' · ' : '') +
        'Propuesta capturada por ' + (quien || 'el ERP') + ' el ' + sello;

      if (r.fila) {
        // Ya existía la propuesta: se actualizan solo las celdas que cambian
        const set = [];
        const poner = (columna, valor) => {
          if (!columna) return;
          set.push({ range: "'" + cfg.sheetName + "'!" + letra(H.indexOf(columna)) + r.fila,
                     values: [[valor]] });
        };
        poner(cSub, bruto);
        poner(cTot, neto);
        poner(cOrigen, 'Propuesta');
        poner(cCom, nota);
        cambios.push.apply(cambios, set);
      } else {
        const rec = {};
        const poner = (columna, valor) => {
          if (columna && valor !== '' && valor != null) rec[columna] = valor;
        };
        poner(cNom, nombre);
        poner(cIni, fechaInicio);
        poner(cSub, bruto);
        poner(cTot, neto);
        poner(cPue, txt(r.puesto));
        poner(cArea, txt(r.area));
        poner(cDep, txt(r.departamento));
        poner(cTipo, txt(r.tipoPago));
        poner(cOrigen, 'Propuesta');
        poner(cCom, nota);
        nuevos.push(H.map(h => (rec[h] == null ? '' : rec[h])));
      }
    });

    if (cambios.length) await core.writeCells(cfg.id, cambios);
    if (nuevos.length) await core.appendRows(cfg.id, cfg.sheetName, nuevos, H);

    return res.status(200).json({
      ok: true,
      creados: nuevos.length,
      actualizados: lista.filter(r => r.fila && txt(r.estado) !== 'timbrado').length,
      ignorados: ignorados,
      mensaje: (nuevos.length + (cambios.length ? 1 : 0))
        ? 'Quincena guardada como propuesta.' : 'No hubo nada que guardar.',
      nota: 'Cuando lleguen los recibos timbrados, vuelve a esta pantalla: los que ' +
            'ya tengan CFDI van a mostrar el bruto y el neto reales.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
