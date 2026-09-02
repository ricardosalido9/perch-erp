// Escribe en INGRESOS y EGRESOS los movimientos que una persona ya aprobó,
// y guarda lo aprendido en "Reglas del banco" para la próxima vez.
//
// Este es el único punto donde el ERP escribe movimientos del banco. Nada llega
// aquí sin haber pasado por la pantalla de aprobación.
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

// El texto que se guarda como regla: el concepto del banco más la referencia que
// escribieron al transferir, recortado. Es lo que se va a reconocer la próxima vez.
function textoDeRegla(p) {
  const base = txt(p.descripcion) || txt(p.concepto);
  return base.slice(0, 60);
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const lista = Array.isArray(body.aprobados) ? body.aprobados : [];
    if (!lista.length) return res.status(400).json({ error: 'No mandaste ningún movimiento.' });

    const quien = txt(sesion && sesion.nombre) || txt(sesion && sesion.usuario) || '';
    const hoy = new Date();
    const sello = hoy.getDate() + ' ' + MESES[hoy.getMonth()] + ' ' + hoy.getFullYear();

    const idFin = CFG.ARCHIVOS.FINANZAS;
    const armar = async (pestana, tipo) => {
      const values = await core.readRange(idFin, pestana);
      const H = (values[0] || []).map(h => String(h).trim());
      const c = {
        fecha: col(H, 'Fecha'), mes: col(H, 'Mes'),
        concepto: col(H, 'Concepto'), descripcion: col(H, 'Descripción', 'Descripcion'),
        total: col(H, 'Total'),
        metodo: col(H, 'Método de cobro', 'Metodo de cobro', 'Método de pago', 'Metodo de pago'),
        cuenta: col(H, 'Cuenta'),
        contraparte: col(H, 'Cliente', 'Proveedor'),
        pedido: col(H, 'Pedido'),
        conceptoEC: col(H, 'Concepto Estado de cuenta', 'Concepto estado de cuenta'),
        categoria: col(H, 'Categoría', 'Categoria'),
        subcategoria: col(H, 'Subcategoría', 'Subcategoria'),
        comentarios: col(H, 'Comentarios')
      };
      const faltan = Object.keys(c).filter(k => !c[k]);
      return { H, c, faltan, pestana, tipo };
    };

    const [hIng, hEgr] = await Promise.all([
      armar(CFG.PESTANAS.ingresos, 'INGRESO'),
      armar(CFG.PESTANAS.egresos, 'EGRESO')
    ]);
    if (!hIng.c.fecha || !hIng.c.total) {
      return res.status(400).json({ error: 'No se pudo leer la pestaña de INGRESOS.' });
    }

    const filas = { INGRESO: [], EGRESO: [] };
    lista.forEach(p => {
      const h = (p.tipo === 'INGRESO') ? hIng : hEgr;
      const c = h.c;
      const rec = {};
      const poner = (columna, valor) => {
        if (columna && valor !== '' && valor != null) rec[columna] = valor;
      };
      poner(c.fecha, txt(p.fechaTexto));
      poner(c.mes, p.mes);
      poner(c.concepto, txt(p.concepto));
      poner(c.descripcion, txt(p.descripcion));
      poner(c.total, p.total);
      poner(c.metodo, txt(p.metodo) || 'Transferencia');
      poner(c.cuenta, txt(p.cuenta));
      poner(c.contraparte, txt(p.contraparte));
      poner(c.pedido, txt(p.pedido));
      poner(c.conceptoEC, txt(p.conceptoEstadoDeCuenta));
      poner(c.categoria, txt(p.categoria));
      poner(c.subcategoria, txt(p.subcategoria));
      // Queda escrito de dónde salió y quién lo aprobó: sin eso nadie sabría
      // si un renglón lo capturó una persona o lo propuso el sistema.
      poner(c.comentarios, (txt(p.comentarios) ? txt(p.comentarios) + ' · ' : '') +
        'Del estado de cuenta, aprobado por ' + (quien || 'el ERP') + ' el ' + sello);
      filas[p.tipo].push(rec);
    });

    let escritos = 0;
    if (filas.INGRESO.length) {
      await core.addRecordsBatch('ingresos', filas.INGRESO);
      escritos += filas.INGRESO.length;
    }
    if (filas.EGRESO.length) {
      await core.addRecordsBatch('egresos', filas.EGRESO);
      escritos += filas.EGRESO.length;
    }

    // ---- Lo aprendido ----
    // Cada aprobación refuerza la regla. Si ya existía, se le suma una vez;
    // si la categoría cambió, gana la última, porque es la corrección más reciente.
    let reglasNuevas = 0, reglasReforzadas = 0;
    try {
      const vr = await core.readRange(idFin, 'Reglas del banco').catch(() => []);
      const Hr = (vr[0] || []).map(h => String(h).trim());
      if (Hr.length) {
        const rT = col(Hr, 'Texto', 'Concepto', 'Contiene');
        const rTipo = col(Hr, 'Tipo');
        const rCat = col(Hr, 'Categoría', 'Categoria');
        const rSub = col(Hr, 'Subcategoría', 'Subcategoria');
        const rCon = col(Hr, 'Contraparte', 'Cliente', 'Proveedor');
        const rN = col(Hr, 'Veces', 'Veces usada');
        const rU = col(Hr, 'Última vez', 'Ultima vez');
        if (rT && rCat) {
          const iT = Hr.indexOf(rT), iTipo = Hr.indexOf(rTipo);
          const existentes = {};
          for (let i = 1; i < vr.length; i++) {
            const f = vr[i] || [];
            const k = norm(f[iT]) + '|' + norm(iTipo === -1 ? '' : f[iTipo]);
            if (norm(f[iT])) existentes[k] = i + 1;   // número de fila en la hoja
          }
          const nuevas = [], updates = [];
          const letra = (i) => {
            let s = '', n = i + 1;
            while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
            return s;
          };
          lista.forEach(p => {
            if (!txt(p.categoria)) return;          // sin categoría no hay nada que aprender
            const t = textoDeRegla(p);
            if (!t) return;
            const k = norm(t) + '|' + norm(p.tipo);
            const fila = existentes[k];
            if (fila) {
              const prev = vr[fila - 1] || [];
              const veces = (parseInt(txt(rN ? prev[Hr.indexOf(rN)] : '0'), 10) || 0) + 1;
              const set = [];
              if (rCat) set.push({ range: "'Reglas del banco'!" + letra(Hr.indexOf(rCat)) + fila,
                                   values: [[txt(p.categoria)]] });
              if (rSub) set.push({ range: "'Reglas del banco'!" + letra(Hr.indexOf(rSub)) + fila,
                                   values: [[txt(p.subcategoria)]] });
              if (rN) set.push({ range: "'Reglas del banco'!" + letra(Hr.indexOf(rN)) + fila,
                                 values: [[veces]] });
              if (rU) set.push({ range: "'Reglas del banco'!" + letra(Hr.indexOf(rU)) + fila,
                                 values: [[sello]] });
              updates.push.apply(updates, set);
              reglasReforzadas++;
            } else {
              const rec = {};
              rec[rT] = t;
              if (rTipo) rec[rTipo] = p.tipo;
              rec[rCat] = txt(p.categoria);
              if (rSub) rec[rSub] = txt(p.subcategoria);
              if (rCon) rec[rCon] = txt(p.contraparte);
              if (rN) rec[rN] = 1;
              if (rU) rec[rU] = sello;
              nuevas.push(rec);
              existentes[k] = -1;                   // para no repetirla en el mismo lote
              reglasNuevas++;
            }
          });
          if (updates.length) await core.writeCells(idFin, updates);
          if (nuevas.length) {
            const filasNuevas = nuevas.map(r => Hr.map(h => (r[h] == null ? '' : r[h])));
            await core.appendRows(idFin, 'Reglas del banco', filasNuevas, Hr);
          }
        }
      }
    } catch (e) { /* si la pestaña no existe, se escribe igual y no se aprende */ }

    return res.status(200).json({
      ok: true,
      escritos: escritos,
      ingresos: filas.INGRESO.length,
      egresos: filas.EGRESO.length,
      reglasNuevas, reglasReforzadas,
      columnasQueFaltan: [].concat(hIng.faltan.map(x => 'INGRESOS: ' + x),
                                   hEgr.faltan.map(x => 'EGRESOS: ' + x)),
      mensaje: escritos + (escritos === 1 ? ' movimiento capturado.' : ' movimientos capturados.')
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
