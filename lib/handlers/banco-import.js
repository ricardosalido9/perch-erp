// Subir un estado de cuenta o un detalle de movimientos y proponer la captura.
//
// El ERP NUNCA escribe solo: este endpoint solo propone. La escritura pasa por
// 'banco-aprobar', y ahí sí queda registrado quién aprobó cada renglón.
//
// De dónde sale cada cosa:
//   fecha, concepto, total, cuenta   -> del PDF
//   descripción                      -> de la referencia que ustedes escriben al transferir
//   cliente / proveedor              -> se busca en las listas y en las ventas
//   categoría y subcategoría         -> del catálogo, con lo aprendido en "Reglas del banco"
//   factura, UUID, concepto CFDI     -> se dejan vacíos: eso lo liga el paso de CFDIs
const core = require('../core');
const CFG = require('../config');
const lector = require('../banco-lector');

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
const MESES_N = { ene:1, feb:2, mar:3, abr:4, may:5, jun:6, jul:7, ago:8, sep:9,
  sept:9, oct:10, nov:11, dic:12, enero:1, febrero:2, marzo:3, abril:4, mayo:5,
  junio:6, julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fechaNum(v) {
  if (v instanceof Date) return v.getFullYear()*10000 + (v.getMonth()+1)*100 + v.getDate();
  const s = norm(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return +m[1]*10000 + +m[2]*100 + +m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return +m[3]*10000 + +m[2]*100 + +m[1];
  m = s.replace(/,/g,' ').replace(/\s+/g,' ')
       .match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (m && MESES_N[m[2]]) return +m[3]*10000 + MESES_N[m[2]]*100 + +m[1];
  return null;
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

async function leerHoja(id, pestana) {
  if (!id) return { headers: [], rows: [] };
  let values;
  try { values = await core.readRange(id, pestana); } catch (e) { return { headers: [], rows: [] }; }
  if (!values.length) return { headers: [], rows: [] };
  const headers = (values[0] || []).map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const f = values[i] || [];
    if (!headers.some((_, j) => txt(f[j]) !== '')) continue;
    const o = {}; headers.forEach((h, j) => { o[h] = f[j]; });
    rows.push(o);
  }
  return { headers, rows, matriz: values.slice(1) };
}

// Los movimientos que NO son ingreso ni egreso de la empresa, pero que sí se
// capturan con su propia categoría porque el dinero sí se movió de cuenta.
const TRASPASO = /traspaso cuentas propias|traspaso entre cuentas/i;
const DEVUELTO = /devuelto|devolucion|devolución/i;
const IMPUESTO = /\bsat\b|imss|infonavit|afore|sipare/i;
const COMISION = /serv banca|iva com serv|comision|comisión/i;

// El catálogo viene en bloques paralelos dentro de la misma pestaña: uno para
// ingresos y otro para egresos, cada uno con Concepto, Método, Cuenta, la lista
// de clientes o proveedores, y Categoría y Subcategoría.
//
// La relación es: se elige un CONCEPTO y de ahí salen la categoría y la
// subcategoría. No se eligen las tres por separado.
function leerCatalogo(cats) {
  const vacio = { hay: false, ingresos: [], egresos: [], cuentas: [], metodos: {} };
  if (!cats.headers.length) return vacio;
  const H = cats.headers;
  // Las columnas se repiten con el mismo nombre en los dos bloques, así que se
  // localizan por posición: la primera "Concepto" es la de ingresos y la segunda
  // la de egresos.
  const posiciones = (nombre) => H.map((h, i) => norm(h) === norm(nombre) ? i : -1)
                                  .filter(i => i !== -1);
  const iConcepto = posiciones('Concepto');
  const iCat = posiciones('Categoría').concat(posiciones('Categoria'));
  const iSub = posiciones('Subcategoría').concat(posiciones('Subcategoria'));
  const iCuenta = posiciones('Cuenta');
  const iMetCobro = posiciones('Método de cobro').concat(posiciones('Metodo de cobro'));
  const iMetPago = posiciones('Método de pago').concat(posiciones('Metodo de pago'));

  // Los encabezados se repiten entre bloques, así que los renglones se leen por
  // POSICIÓN. Por eso el handler guarda también la matriz cruda.
  const M = cats.matriz || [];
  const bloque = (ci, cati, subi) => {
    if (ci == null || cati == null) return [];
    const out = [], vistos = {};
    M.forEach(f => {
      const concepto = txt(f[ci]);
      if (!concepto || vistos[norm(concepto)]) return;
      vistos[norm(concepto)] = 1;
      out.push({
        concepto: concepto,
        categoria: txt(cati == null ? '' : f[cati]),
        subcategoria: txt(subi == null ? '' : f[subi])
      });
    });
    return out;
  };
  const columna = (i) => {
    if (i == null) return [];
    const out = [], vistos = {};
    M.forEach(f => {
      const v = txt(f[i]);
      if (v && !vistos[norm(v)]) { vistos[norm(v)] = 1; out.push(v); }
    });
    return out;
  };

  return {
    hay: true,
    ingresos: bloque(iConcepto[0], iCat[0], iSub[0]),
    egresos: bloque(iConcepto[1], iCat[1], iSub[1]),
    cuentas: columna(iCuenta[0]).concat(columna(iCuenta[1]))
      .filter((v, i, a) => a.map(norm).indexOf(norm(v)) === i),
    metodos: {
      INGRESO: columna(iMetCobro[0]),
      EGRESO: columna(iMetPago[0])
    },
    // Las listas del propio catálogo: para ingresos se sugiere un CLIENTE y para
    // egresos un PROVEEDOR. No es lo mismo y no deben mezclarse.
    clientes: columna(posiciones('Lista de Clientes_Perch')[0]),
    proveedores: columna(
      H.map((h, i) => /lista de proveedores/i.test(String(h)) ? i : -1)
       .filter(i => i !== -1)[0])
  };
}

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    if (!body.pdf) return res.status(400).json({ error: 'No llegó el archivo.' });

    // ---- 1. Sacar el texto del PDF ----
    let texto = '';
    try {
      // Se extrae conservando las columnas: sin eso no se puede saber si un
      // número es cargo o abono, porque el PDF no lo dice, solo lo alinea.
      const { extraer } = require('../pdf-texto');
      texto = await extraer(Buffer.from(body.pdf, 'base64'));
    } catch (e) {
      return res.status(400).json({
        error: 'No se pudo leer el PDF.',
        pista: 'Si el archivo es un escaneo (una foto del estado de cuenta), no trae ' +
               'texto y no se puede leer. Descárgalo de la banca en línea.',
        detalle: (e && e.message) || ''
      });
    }
    if (!/\d/.test(texto)) {
      return res.status(400).json({
        error: 'El PDF no trae texto, parece un escaneo.',
        pista: 'Descarga el estado de cuenta directo de BBVA en vez de escanearlo.'
      });
    }

    const cuenta = txt(body.cuenta);
    const anio = +body.anio || new Date().getFullYear();
    const movs = lector.leer(texto, { cuenta: cuenta, anio: anio });
    if (!movs.length) {
      return res.status(400).json({
        error: 'No se encontraron movimientos en el archivo.',
        pista: 'Revisa que sea el estado de cuenta o el detalle de movimientos, ' +
               'no la carátula ni el comprobante fiscal.'
      });
    }

    // ---- 2. Lo que el ERP ya sabe ----
    const idFin = CFG.ARCHIVOS.FINANZAS;
    const [ing, egr, cats, reglas, clientes, provs] = await Promise.all([
      leerHoja(idFin, CFG.PESTANAS.ingresos),
      leerHoja(idFin, CFG.PESTANAS.egresos),
      // El catálogo está en su propio archivo. Si ahí no está, se busca en Finanzas.
      leerHoja(CFG.ARCHIVOS.CATALOGO_CUENTAS || idFin, CFG.PESTANAS.categorias)
        .then(x => x.headers.length ? x : leerHoja(idFin, CFG.PESTANAS.categorias)),
      leerHoja(idFin, 'Reglas del banco'),
      leerHoja(CFG.ARCHIVOS.CLIENTES, CFG.PESTANAS.clientes),
      leerHoja(CFG.ARCHIVOS.PROVEEDORES, CFG.PESTANAS.proveedores)
    ]);

    // ---- Lo ya capturado, para no duplicar y para cuadrar ----
    // No se compara solo por fecha exacta: el banco tiene fecha de operación y de
    // liquidación, y ustedes pueden haber capturado cualquiera de las dos. Se busca
    // el mismo monto en la misma cuenta dentro de una ventana de días.
    const VENTANA = 4;
    const capturados = [];
    const indexar = (hoja, tipo) => {
      if (!hoja.headers.length) return;
      const cF = col(hoja.headers, 'Fecha');
      const cT = col(hoja.headers, 'Total');
      const cC = col(hoja.headers, 'Cuenta');
      const cCon = col(hoja.headers, 'Concepto');
      const cDes = col(hoja.headers, 'Descripción', 'Descripcion');
      if (!cF || !cT) return;
      hoja.rows.forEach((r, i) => {
        const monto = Math.abs(parseFloat(String(r[cT]).replace(/[^0-9.\-]/g, '')) || 0);
        if (!monto) return;
        capturados.push({
          fila: i + 2, tipo: tipo, monto: monto,
          fecha: fechaNum(r[cF]),
          cuenta: txt(cC ? r[cC] : ''),
          concepto: txt(cCon ? r[cCon] : ''),
          descripcion: txt(cDes ? r[cDes] : ''),
          usado: false
        });
      });
    };
    indexar(ing, 'INGRESO');
    indexar(egr, 'EGRESO');

    // La cuenta del banco se escribe como en el catálogo: "BBVA 0117441789"
    const cuentaLarga = cuenta
      ? (/^bbva/i.test(cuenta) ? cuenta : 'BBVA ' + cuenta.replace(/\D/g, '').padStart(10, '0'))
      : '';
    const mismaCuenta = (a, b) => {
      const da = String(a || '').replace(/\D/g, ''), db = String(b || '').replace(/\D/g, '');
      if (!da || !db) return true;             // si no se sabe, no descarta
      return da.slice(-8) === db.slice(-8);
    };
    // Busca ese movimiento entre lo ya capturado y lo marca como usado
    const buscarCapturado = (m) => {
      const dias = (f) => {
        if (f === null || m.fecha === null) return 99;
        const a = new Date(Math.floor(m.fecha / 10000), Math.floor(m.fecha / 100) % 100 - 1, m.fecha % 100);
        const b = new Date(Math.floor(f / 10000), Math.floor(f / 100) % 100 - 1, f % 100);
        return Math.abs((a - b) / 86400000);
      };
      const cands = capturados.filter(c => !c.usado && c.tipo === m.tipo &&
        Math.abs(c.monto - m.monto) < 0.01 && mismaCuenta(c.cuenta, cuentaLarga) &&
        dias(c.fecha) <= VENTANA);
      if (!cands.length) return null;
      cands.sort((a, b) => dias(a.fecha) - dias(b.fecha));
      cands[0].usado = true;
      return cands[0];
    };

    // Las reglas aprendidas: texto -> categoría, subcategoría, contraparte
    const aprendidas = [];
    if (reglas.headers.length) {
      const rT = col(reglas.headers, 'Texto', 'Concepto', 'Contiene');
      const rTipo = col(reglas.headers, 'Tipo');
      const rCat = col(reglas.headers, 'Categoría', 'Categoria');
      const rSub = col(reglas.headers, 'Subcategoría', 'Subcategoria');
      const rCon = col(reglas.headers, 'Contraparte', 'Cliente', 'Proveedor');
      const rN = col(reglas.headers, 'Veces', 'Veces usada');
      if (rT) reglas.rows.forEach(r => {
        const t = norm(r[rT]);
        if (!t) return;
        aprendidas.push({
          texto: t,
          tipo: txt(rTipo ? r[rTipo] : ''),
          categoria: txt(rCat ? r[rCat] : ''),
          subcategoria: txt(rSub ? r[rSub] : ''),
          contraparte: txt(rCon ? r[rCon] : ''),
          veces: parseInt(txt(rN ? r[rN] : '0'), 10) || 0
        });
      });
      // Primero las reglas más específicas y las más usadas
      aprendidas.sort((a, b) => (b.texto.length - a.texto.length) || (b.veces - a.veces));
    }

    // Nombres de clientes y proveedores, para reconocerlos en la referencia
    const nombres = [];
    const cargarNombres = (hoja, tipo) => {
      if (!hoja.headers.length) return;
      const c = col(hoja.headers, 'Cliente', 'Proveedor', 'Nombre', 'Nombre/Razón Social');
      if (!c) return;
      hoja.rows.forEach(r => {
        const n = txt(r[c]);
        if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo });
      });
    };
    cargarNombres(clientes, 'CLIENTE');
    cargarNombres(provs, 'PROVEEDOR');
    // Las listas del catálogo también cuentan
    const cat0 = leerCatalogo(cats);
    (cat0.clientes || []).forEach(n => {
      if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo: 'CLIENTE' });
    });
    (cat0.proveedores || []).forEach(n => {
      if (n && n.length >= 4) nombres.push({ nombre: n, clave: norm(n), tipo: 'PROVEEDOR' });
    });
    nombres.sort((a, b) => b.clave.length - a.clave.length);

    // ---- 3. Proponer ----
    const propuestas = movs.map(m => {
      const donde = (m.concepto + ' ' + m.descripcion + ' ' + m.referencia);
      const clave = norm(donde);
      const p = {
        fecha: m.fecha,
        fechaTexto: (m.fecha % 100) + ' ' + MESES[Math.floor(m.fecha / 100) % 100 - 1] +
                    ' ' + Math.floor(m.fecha / 10000),
        mes: Math.floor(m.fecha / 100) % 100,
        tipo: m.tipo,
        total: m.monto,
        cuenta: m.cuenta,
        concepto: m.concepto,
        descripcion: m.descripcion || m.referencia,
        conceptoEstadoDeCuenta: (m.concepto + ' ' + m.referencia).trim().slice(0, 180),
        rfc: m.rfc,
        contraparte: '',
        categoria: '',
        subcategoria: '',
        confianza: 'nueva',
        porQue: '',
        cuentaLarga: cuentaLarga,
        // Método: si el cargo viene de tarjeta (código A15) es tarjeta; si no,
        // transferencia, que es como se captura casi todo.
        metodo: /^A1\d|^P3\d/.test(m.codigo || '') ? 'Tarjeta Crédito/Débito'
                                                    : 'Depósito/Transferencia electrónica',
        yaCapturado: false, capturadoEn: null
      };
      const yaEsta = buscarCapturado(m);
      if (yaEsta) {
        p.yaCapturado = true;
        p.capturadoEn = { fila: yaEsta.fila, concepto: yaEsta.concepto,
                          descripcion: yaEsta.descripcion };
      }

      // Los casos que se reconocen solos, sin necesidad de regla
      if (TRASPASO.test(donde)) {
        p.categoria = 'Traspaso entre cuentas';
        p.confianza = 'segura';
        p.porQue = 'El banco lo marca como traspaso entre cuentas propias.';
      } else if (DEVUELTO.test(donde)) {
        p.categoria = 'Traspaso entre cuentas';
        p.confianza = 'revisar';
        p.porQue = 'Es una devolución. Si el envío original sí se hizo después, ' +
                   'ese sí se categoriza como el gasto que era.';
      } else if (IMPUESTO.test(donde)) {
        p.confianza = 'revisar';
        p.porQue = 'Parece pago de impuestos o seguridad social.';
      } else if (COMISION.test(donde)) {
        p.confianza = 'revisar';
        p.porQue = 'Parece comisión bancaria.';
      }

      // Lo aprendido manda sobre lo anterior
      const regla = aprendidas.filter(r =>
        clave.indexOf(r.texto) !== -1 && (!r.tipo || norm(r.tipo) === norm(m.tipo)))[0];
      if (regla) {
        p.categoria = regla.categoria || p.categoria;
        p.subcategoria = regla.subcategoria || p.subcategoria;
        p.contraparte = regla.contraparte || p.contraparte;
        p.confianza = regla.veces >= 3 ? 'segura' : 'probable';
        p.porQue = 'Ya lo categorizaste así ' + regla.veces +
                   (regla.veces === 1 ? ' vez.' : ' veces.');
      }

      // El nombre del cliente o proveedor, si aparece escrito en la referencia
      if (!p.contraparte) {
        // En un ingreso la contraparte es un CLIENTE; en un egreso, un PROVEEDOR
        const buscarEn = (m.tipo === 'INGRESO') ? 'CLIENTE' : 'PROVEEDOR';
        const hit = nombres.filter(n => n.tipo === buscarEn && clave.indexOf(n.clave) !== -1)[0]
                 || nombres.filter(n => clave.indexOf(n.clave) !== -1)[0];
        if (hit) {
          p.contraparte = hit.nombre;
          if (!p.porQue) p.porQue = 'El nombre aparece en la referencia.';
        }
      }
      return p;
    });

    const cuenta_ = (f) => propuestas.filter(f).length;
    // Lo que está capturado en la hoja de esas fechas y NO aparece en el banco.
    // Es la otra mitad del cuadre: no basta con no duplicar, hay que saber si
    // sobra algo capturado que el banco nunca cobró.
    const fechas = propuestas.map(p => p.fecha).filter(x => x);
    const desde = Math.min.apply(null, fechas), hasta = Math.max.apply(null, fechas);
    const sobran = capturados.filter(c => !c.usado && c.fecha !== null &&
      c.fecha >= desde && c.fecha <= hasta && mismaCuenta(c.cuenta, cuentaLarga))
      .map(c => ({ fila: c.fila, tipo: c.tipo, fecha: c.fecha,
                   monto: c.monto, concepto: c.concepto, descripcion: c.descripcion }));

    return res.status(200).json({
      ok: true,
      cuenta: cuentaLarga || cuenta,
      periodo: { desde, hasta },
      movimientos: propuestas.length,
      yaCapturados: cuenta_(x => x.yaCapturado),
      nuevos: cuenta_(x => !x.yaCapturado),
      seguras: cuenta_(x => !x.yaCapturado && x.confianza === 'segura'),
      probables: cuenta_(x => !x.yaCapturado && x.confianza === 'probable'),
      porRevisar: cuenta_(x => !x.yaCapturado && x.confianza !== 'segura' && x.confianza !== 'probable'),
      // El cuadre: lo del banco que falta capturar y lo capturado que el banco no tiene
      cuadre: {
        enBancoSinCapturar: cuenta_(x => !x.yaCapturado),
        capturadoSinBanco: sobran.length,
        detalleCapturadoSinBanco: sobran.slice(0, 40)
      },
      totalIngresos: Math.round(propuestas.filter(x => x.tipo === 'INGRESO')
        .reduce((a, x) => a + x.total, 0) * 100) / 100,
      totalEgresos: Math.round(propuestas.filter(x => x.tipo === 'EGRESO')
        .reduce((a, x) => a + x.total, 0) * 100) / 100,
      catalogo: cat0,
      reglasAprendidas: aprendidas.length,
      lectura: {
        ingresosLeidos: ing.rows.length,
        egresosLeidos: egr.rows.length,
        catalogoLeido: cats.rows.length,
        conceptosIngreso: (cat0.ingresos || []).length,
        conceptosEgreso: (cat0.egresos || []).length,
        clientesEnCatalogo: (cat0.clientes || []).length,
        proveedoresEnCatalogo: (cat0.proveedores || []).length
      },
      propuestas: propuestas
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
