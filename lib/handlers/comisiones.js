// La pantalla de comisiones. **Solo admin.**
//
// El permiso se valida aquí, en el servidor, no escondiendo el renglón del menú:
// son sueldos de dos personas y los ve el panel de todos.
//
//   ?action=comisiones                  → el cálculo
//   ?action=comisiones&guardarBono=1    → captura el bono trimestral de Nico
const core = require('../core');
const com = require('../comisiones');

const txt = (v) => String(v == null ? '' : v).trim();
const norm = com.norm;
function col(H, ...nombres) {
  for (const n of nombres) {
    const c = H.filter(x => norm(x) === norm(n))[0];
    if (c) return c;
  }
  return null;
}
function esAdmin(rol) {
  const r = norm(rol);
  return r === 'admin' || r === 'administrador';
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

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    const sesion = core.verifyToken(body.token);
    if (!sesion) return res.status(401).json({ error: 'Sesión no válida.' });
    // Admin ve a todos. Un vendedor ve **solo lo suyo**, y solo si está prendido
    // COMISIONES_CADA_QUIEN. Cualquier otro, nada.
    const admin = esAdmin(sesion.rol);
    const quienSoy = core.vendedorDeUsuario
      ? core.vendedorDeUsuario(sesion.usuario || sesion.u) : null;
    const soloLoMio = !admin && core.CADA_QUIEN_VE_LO_SUYO && quienSoy ? quienSoy : null;
    if (!admin && !soloLoMio) {
      return res.status(403).json({ error: 'Las comisiones solo las ve un administrador.' });
    }

    const libreta = await leer('comisiones');

    // ---- Guardar el bono de un trimestre ----
    if (body.guardarBono) {
      // El bono lo captura un admin. Nadie se lo pone a sí mismo.
      if (!admin) {
        return res.status(403).json({ error: 'El bono solo lo captura un administrador.' });
      }
      if (!libreta.cfg) {
        return res.status(400).json({
          error: 'No encuentro la pestaña "Comisiones" en el archivo de Operación.'
        });
      }
      const vendedor = txt(body.vendedor), periodo = txt(body.periodo);
      if (!vendedor || !periodo) {
        return res.status(400).json({ error: 'Falta el vendedor o el periodo.' });
      }
      const regla = com.reglaDe(vendedor);
      const tope = (regla && regla.bonoTope) || 0;
      let bono = Math.max(0, Number(body.bono) || 0);
      let recortado = false;
      if (tope && bono > tope) { bono = tope; recortado = true; }

      const H = libreta.headers;
      const cV = col(H, 'Vendedor'), cP = col(H, 'Periodo'), cB = col(H, 'Bono');
      const cN = col(H, 'Nota'), cU = col(H, 'Última actualización');
      const ya = libreta.rows.filter(r =>
        norm(r[cV]) === norm(vendedor) && txt(r[cP]) === periodo)[0];
      const sello = (sesion.usuario || sesion.u || '') + ' / ' + core.ahoraMx();
      const rec = {};
      rec[cV] = vendedor; rec[cP] = periodo; rec[cB] = bono;
      if (cN) rec[cN] = txt(body.nota);
      if (cU) rec[cU] = sello;
      if (ya) {
        await core.updateRecord('comisiones', ya.__fila, rec, sesion.usuario || sesion.u);
      } else {
        await core.addRecord('comisiones', rec, sesion.usuario || sesion.u);
      }
      return res.status(200).json({ ok: true, bono, recortado, tope });
    }

    // ---- El cálculo ----
    const ven = await leer('ventas_registro');
    if (!ven.headers.length) {
      return res.status(400).json({ error: 'No se pudo leer la hoja de Ventas.' });
    }
    const H = ven.headers;
    const c = {
      vendedor: col(H, 'Vendedor'),
      fecha: col(H, 'Fecha del Cierre', 'Fecha de cierre'),
      status: col(H, 'Status'),
      folio: col(H, 'No. de Referencia', 'Folio'),
      total: col(H, 'Total Pedido'),
      impuestos: col(H, 'Impuestos'),
      sinIva: col(H, 'Precio sin IVA'),
      descuentos: col(H, 'Descuentos'),
      cantidad: col(H, 'Cantidad')
    };
    if (!c.vendedor || !c.total) {
      return res.status(400).json({
        error: 'La hoja de Ventas no tiene las columnas "Vendedor" y "Total Pedido".'
      });
    }

    // Los bonos capturados, por vendedor y periodo
    const bonos = {};
    if (libreta.headers.length) {
      const L = libreta.headers;
      const lV = col(L, 'Vendedor'), lP = col(L, 'Periodo'), lB = col(L, 'Bono'),
            lN = col(L, 'Nota');
      libreta.rows.forEach(r => {
        if (!lV || !lP) return;
        bonos[norm(r[lV]) + '|' + txt(r[lP])] =
          { bono: r[lB], nota: lN ? txt(r[lN]) : '' };
      });
    }

    let filas = com.calcular(ven.rows, c, bonos, { esCotizacion: core.esCotizacion });
    let reglas = com.REGLAS;
    // El recorte se hace **aquí**, no escondiendo renglones en la pantalla: lo
    // que no es suyo no sale del servidor.
    if (soloLoMio) {
      filas = filas.filter(f => f.vendedor === soloLoMio);
      reglas = reglas.filter(r => r.quien === soloLoMio);
    }
    const anios = {};
    filas.forEach(f => { anios[f.anio] = 1; });

    return res.status(200).json({
      ok: true, filas,
      anios: Object.keys(anios).sort().reverse(),
      hayLibreta: !!libreta.cfg,
      puedeBono: admin,
      soloLoMio: soloLoMio || '',
      reglas: reglas.map(r => ({
        quien: r.quien, periodo: r.periodo, bonoTope: r.bonoTope || 0,
        escalones: r.escalones
      })),
      base: 'Total sin IVA y sin envío (Total Pedido menos Impuestos).'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
