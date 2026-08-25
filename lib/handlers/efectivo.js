const CFG = require('../config');
// Registro de efectivo: Caja Chica y Efectivo General.
// Se captura una sola vez y el ERP decide en qué pestaña escribe según la caja.
// El saldo se calcula solo: saldo anterior + entradas - salidas.
const core = require('../core');

const ARCHIVO = CFG.ARCHIVOS.EFECTIVO;
const CAJAS = {
  'Caja Chica': 'Caja Chica',
  'Efectivo General': 'Efectivo General'
};

function txt(v) { return String(v == null ? '' : v).trim(); }
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
const ERROR_CELDA = /^#(VALUE|REF|DIV\/0|N\/A|NAME|NUM|NULL)/i;
function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v == null ? '' : v).trim();
  if (ERROR_CELDA.test(t)) return 0;      // #VALUE! y similares no son un número
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

async function leerCaja(hoja) {
  let values;
  try { values = await core.readRange(ARCHIVO, hoja); }
  catch (e) { return { headers: [], rows: [], error: e.message }; }
  if (!values.length) return { headers: [], rows: [] };
  // Se busca la fila y la columna donde está "Fecha": ahí empieza la tabla.
  // No se da por hecho que arranque en la columna D.
  let hr = -1, COL_INICIO = 0;
  for (let i = 0; i < Math.min(15, values.length) && hr === -1; i++) {
    const f = values[i] || [];
    for (let j = 0; j < f.length; j++) {
      if (norm(f[j]) === 'fecha') { hr = i; COL_INICIO = j; break; }
    }
  }
  if (hr === -1) {
    return { headers: [], rows: [],
             error: 'No se encontró la fila de encabezados (no hay ninguna celda que diga "Fecha").' };
  }
  const cab = values[hr] || [];
  const headers = [];
  for (let j = COL_INICIO; j < cab.length; j++) headers.push(String(cab[j] || '').trim());
  const rows = [];
  for (let i = hr + 1; i < values.length; i++) {
    const f = values[i] || [];
    const o = { _fila: i + 1 };
    let vacia = true;
    headers.forEach((h, j) => {
      const v = f[COL_INICIO + j];
      o[h] = (v != null) ? v : '';
      if (txt(v) !== '') vacia = false;
    });
    if (vacia) continue;
    rows.push(o);
  }
  return { headers, rows, filaEncabezados: hr + 1, colInicio: COL_INICIO };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // ---- Guardar un movimiento ----
    if (body.guardar) {
      if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
      const caja = CAJAS[txt(body.caja)] || null;
      if (!caja) return res.status(400).json({ error: 'Elige de qué caja es el movimiento.' });
      const monto = num(body.monto);
      if (!monto) return res.status(400).json({ error: 'Falta el monto.' });
      const esEntrada = norm(body.tipo) === 'entrada';

      const hoja = await leerCaja(caja);
      if (!hoja.headers.length) {
        return res.status(400).json({ error: 'No se pudo leer la pestaña "' + caja + '".' });
      }
      const H = hoja.headers;
      const iFecha = H.indexOf(col(H, 'Fecha') || '');
      const iMes = H.indexOf(col(H, 'Mes') || '');
      const iCon = H.indexOf(col(H, 'Concepto Estado de Cuenta', 'Concepto') || '');
      const iDes = H.indexOf(col(H, 'Descripción', 'Descripcion') || '');
      const iSal = H.indexOf(col(H, 'Salidas') || '');
      const iEnt = H.indexOf(col(H, 'Entradas') || '');
      const iSaldo = H.indexOf(col(H, 'Saldo') || '');

      // El saldo nuevo sale del último renglón que tenga saldo
      // El saldo anterior sale del último renglón con un saldo legible.
      // Los que traen #VALUE! se saltan.
      let saldoPrev = 0;
      for (let i = hoja.rows.length - 1; i >= 0; i--) {
        if (iSaldo === -1) break;
        const crudo = txt(hoja.rows[i][H[iSaldo]]);
        if (!crudo || ERROR_CELDA.test(crudo)) continue;
        const v = num(crudo);
        if (v || crudo === '0' || /^\$?\s*-?\s*$/.test(crudo)) { saldoPrev = v; break; }
      }
      const saldoNuevo = Math.round((saldoPrev + (esEntrada ? monto : -monto)) * 100) / 100;

      const fecha = txt(body.fecha) || '';
      const d = fechaNum(fecha);
      const fila = new Array(H.length).fill('');
      if (iFecha !== -1) fila[iFecha] = fecha;
      if (iMes !== -1 && d) fila[iMes] = Math.floor(d / 100) % 100;
      if (iCon !== -1) fila[iCon] = txt(body.concepto);
      if (iDes !== -1) fila[iDes] = txt(body.descripcion);
      if (esEntrada) { if (iEnt !== -1) fila[iEnt] = monto; }
      else { if (iSal !== -1) fila[iSal] = monto; }
      if (iSaldo !== -1) fila[iSaldo] = saldoNuevo;
      // Columnas extra que existan en la hoja
      ['Categoría', 'Categoria', 'Subcategoría', 'Subcategoria', 'Cuenta',
       'Método de cobro', 'Método de pago', 'Proveedor', 'Cliente', 'Colaborador',
       'Comentarios'].forEach(nombre => {
        const c = col(H, nombre);
        if (!c) return;
        const i = H.indexOf(c);
        const v = body[norm(nombre).replace(/\s+/g, '_')] || body[nombre] || '';
        if (txt(v)) fila[i] = txt(v);
      });

      const destino = hoja.rows.length
        ? hoja.rows[hoja.rows.length - 1]._fila + 1
        : hoja.filaEncabezados + 1;
      const ci = hoja.colInicio || 0;
      const rango = "'" + caja + "'!" + letra(ci) + destino + ':' +
                    letra(ci + H.length - 1) + destino;
      await core.writeCells(ARCHIVO, [{ range: rango, values: [fila] }]);

      return res.status(200).json({
        ok: true, caja, fila: destino,
        saldoAnterior: saldoPrev, saldoNuevo,
        mensaje: (esEntrada ? 'Entrada' : 'Salida') + ' de ' +
          monto.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) +
          ' registrada en ' + caja + '. Saldo: ' +
          saldoNuevo.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
      });
    }

    // ---- El catálogo: qué conceptos hay para entradas y para salidas ----
    const CAT_ARCHIVO = CFG.ARCHIVOS.CATEGORIAS;
    const catalogo = { entrada: {}, salida: {} };
    try {
      let vals;
      try { vals = await core.readRange(CAT_ARCHIVO, 'Categorias'); }
      catch (e) { vals = await core.readRange(CAT_ARCHIVO, 'Categorías'); }
      if (vals && vals.length) {
        // La fila 1 dice "Ingresos" / "Egresos" y la fila 2 los encabezados
        let filaGrupo = -1, filaCab = -1;
        for (let i = 0; i < Math.min(6, vals.length); i++) {
          const f = (vals[i] || []).map(x => norm(x));
          if (f.indexOf('ingresos') !== -1 && f.indexOf('egresos') !== -1) filaGrupo = i;
          if (f.indexOf('concepto') !== -1) { filaCab = i; break; }
        }
        if (filaCab !== -1) {
          const grupos = vals[filaGrupo] || [];
          const cab = vals[filaCab] || [];
          // A qué grupo pertenece cada columna: se arrastra el último título visto
          let actual = '';
          const deColumna = [];
          for (let j = 0; j < cab.length; j++) {
            const g = norm(grupos[j] || '');
            if (g === 'ingresos') actual = 'entrada';
            else if (g === 'egresos') actual = 'salida';
            else if (g === 'colaboradores') actual = 'otros';
            deColumna[j] = actual;
          }
          for (let j = 0; j < cab.length; j++) {
            const nombre = String(cab[j] || '').trim();
            if (!nombre) continue;
            const tipo = deColumna[j];
            if (tipo !== 'entrada' && tipo !== 'salida') continue;
            const lista = [];
            for (let i = filaCab + 1; i < vals.length; i++) {
              const v = String((vals[i] || [])[j] == null ? '' : (vals[i] || [])[j]).trim();
              if (v && lista.indexOf(v) === -1) lista.push(v);
            }
            if (lista.length) catalogo[tipo][nombre] = lista;
          }
        }
      }
    } catch (e) { /* sin catálogo se capturan a mano */ }

    // ---- Leer las dos cajas ----
    const [chica, general] = await Promise.all([
      leerCaja('Caja Chica'), leerCaja('Efectivo General')
    ]);
    const anio = +body.anio || new Date().getFullYear();

    const armar = (hoja, nombre) => {
      if (!hoja.headers.length) return { caja: nombre, error: hoja.error || 'No se pudo leer.', movimientos: [] };
      const H = hoja.headers;
      const cF = col(H, 'Fecha');
      const cCon = col(H, 'Concepto Estado de Cuenta', 'Concepto');
      const cDes = col(H, 'Descripción', 'Descripcion');
      const cSal = col(H, 'Salidas');
      const cEnt = col(H, 'Entradas');
      const cSaldo = col(H, 'Saldo');
      let entradas = 0, salidas = 0, saldo = 0, conError = 0;
      const movimientos = [];
      const porConcepto = {};
      hoja.rows.forEach(r => {
        const e = cEnt ? num(r[cEnt]) : 0;
        const s = cSal ? num(r[cSal]) : 0;
        const crudoSaldo = cSaldo ? txt(r[cSaldo]) : '';
        if (crudoSaldo && ERROR_CELDA.test(crudoSaldo)) conError++;
        const sd = cSaldo ? num(r[cSaldo]) : 0;
        // El saldo solo se actualiza si el renglón trae uno legible
        if (crudoSaldo && !ERROR_CELDA.test(crudoSaldo)) saldo = sd;
        const d = cF ? fechaNum(r[cF]) : null;
        const delAnio = !d || Math.floor(d / 10000) === anio;
        if (delAnio) { entradas += e; salidas += s; }
        const concepto = txt(cCon ? r[cCon] : '');
        if (delAnio && concepto) {
          if (!porConcepto[concepto]) porConcepto[concepto] = { concepto, entradas: 0, salidas: 0, n: 0 };
          porConcepto[concepto].entradas += e;
          porConcepto[concepto].salidas += s;
          porConcepto[concepto].n++;
        }
        // Un renglón sin fecha, sin concepto y sin montos es de relleno
        if (!txt(cF ? r[cF] : '') && !concepto && !e && !s) return;
        movimientos.push({
          fila: r._fila, fecha: txt(cF ? r[cF] : ''), dia: d,
          concepto, descripcion: txt(cDes ? r[cDes] : ''),
          entrada: e, salida: s,
          saldo: (crudoSaldo && !ERROR_CELDA.test(crudoSaldo)) ? sd : null,
          saldoConError: !!(crudoSaldo && ERROR_CELDA.test(crudoSaldo)),
          cliente: txt(r[col(H, 'Cliente') || ''] || ''),
          proveedor: txt(r[col(H, 'Proveedor') || ''] || ''),
          ubicacion: txt(r[col(H, 'UBICACION', 'Ubicación', 'Ubicacion') || ''] || '')
        });
      });
      return {
        caja: nombre, headers: H,
        saldoConError: conError,
        // Si hay saldos rotos, se recalcula: entradas menos salidas de toda la hoja
        saldoCalculado: Math.round(hoja.rows.reduce((a, r) =>
          a + (cEnt ? num(r[cEnt]) : 0) - (cSal ? num(r[cSal]) : 0), 0) * 100) / 100,
        saldo: Math.round(saldo * 100) / 100,
        entradas: Math.round(entradas * 100) / 100,
        salidas: Math.round(salidas * 100) / 100,
        movimientos: movimientos.slice(-120).reverse(),
        conceptos: Object.keys(porConcepto).map(k => {
          const x = porConcepto[k];
          return { concepto: x.concepto, n: x.n,
                   entradas: Math.round(x.entradas * 100) / 100,
                   salidas: Math.round(x.salidas * 100) / 100 };
        }).sort((a, b) => (b.salidas + b.entradas) - (a.salidas + a.entradas))
      };
    };

    const cajas = [armar(chica, 'Caja Chica'), armar(general, 'Efectivo General')];
    return res.status(200).json({
      ok: true, anio, archivo: ARCHIVO, cajas, catalogo,
      totales: {
        saldo: Math.round(cajas.reduce((a, c) => a + (c.saldo || 0), 0) * 100) / 100,
        entradas: Math.round(cajas.reduce((a, c) => a + (c.entradas || 0), 0) * 100) / 100,
        salidas: Math.round(cajas.reduce((a, c) => a + (c.salidas || 0), 0) * 100) / 100
      }
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
