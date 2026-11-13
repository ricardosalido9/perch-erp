// ===== Comisiones de los representantes de venta =====
//
// Val, 12 nov: *"me gustaría que en este apartado de ventas se incluyan las
// comisiones a los representantes de venta… es importante que este despliegue
// solo lo puedan visualizar los admin, ya que es info sensible"*.
//
// **Úrsula**, al mes:
//   de $1 a $1,100,000 → 1%
//   al alcanzar $1,100,000 → 2%
//   al superar $1,500,000 → 3%
// El escalón se aplica **sobre todas sus ventas del mes**, no solo sobre el
// excedente (confirmado por Val). O sea que vender $1,100,000 paga $22,000 y
// vender $1,099,999 paga $11,000: cruzar la raya vale $11,000. Está hecho así
// a propósito.
//
// **Nico**: 1% de **las ventas que él cerró**, y se le paga por trimestre. Más
// un bono trimestral que captura un admin, topado a $15,000.
//
// La base de cálculo es el **total sin IVA y sin envío**: lo que de verdad entra
// a la empresa por el mueble. Sale de `Total Pedido − Impuestos`, que ya viene
// con el descuento aplicado.
//
// Las cotizaciones y las ventas canceladas no cuentan.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const txt = (v) => String(v == null ? '' : v).trim();
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function fechaMs(v) {
  const t = txt(v);
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    if (n > 20000 && n < 80000) return Date.UTC(1899, 11, 30) + n * 86400000;
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) { let a = +m[3]; if (a < 100) a += 2000; return Date.UTC(a, +m[2] - 1, +m[1]); }
  m = norm(t).match(/^(\d{1,2})\s*(?:de\s+)?([a-z]+)\s*(?:de\s+)?(\d{4})/);
  if (m) { const i = MESES.indexOf(m[2]); if (i >= 0) return Date.UTC(+m[3], i, +m[1]); }
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ===== Quién cobra comisión y con qué regla =====
//
// Se identifica por el nombre que trae la columna Vendedor, sin acentos ni
// mayúsculas, y por cualquier apodo con el que lo capturen. Si mañana entra
// alguien más, se agrega aquí y en ningún otro lado.
// `usuarios` son las cuentas del ERP con las que esa persona entra. Sirven para
// que cada quien vea SOLO lo suyo cuando se prenda COMISIONES_CADA_QUIEN.
//
// Hoy Úrsula y Nico entran con cuentas **compartidas** (`comercialperch`,
// `operativoperch`), y Camila usa la misma que Úrsula. Con un usuario compartido
// no hay manera de saber quién está del otro lado, así que esas cuentas NO se
// listan aquí a propósito: haría que Camila viera las comisiones de Úrsula.
// Cuando cada quien tenga su usuario, se agrega aquí y ya.
const REGLAS = [
  {
    quien: 'Ursula Garcia',
    comoLoEscriben: ['ursula garcia', 'ursula', 'úrsula', 'ursula g', 'ursula garcía'],
    usuarios: ['ursula', 'ursula.garcia', 'ursulaperch'],
    periodo: 'mes',
    // Se evalúan de abajo hacia arriba: gana el último que se cumpla.
    escalones: [
      { desde: 0, pct: 1 },
      { desde: 1100000, pct: 2 },                  // "al ALCANZAR": entra en 1,100,000
      { desde: 1500000, pct: 3, estricto: true }   // "al SUPERAR": entra arriba de 1,500,000
    ]
  },
  {
    quien: 'Nico Mendez',
    comoLoEscriben: ['nico mendez', 'nico', 'nicolas mendez', 'nico méndez'],
    usuarios: ['nico', 'nico.mendez', 'nicoperch'],
    periodo: 'trimestre',
    escalones: [{ desde: 0, pct: 1 }],
    bonoTope: 15000
  }
];

function reglaDe(vendedor) {
  const v = norm(vendedor);
  if (!v) return null;
  for (const r of REGLAS) {
    if (r.comoLoEscriben.some(x => norm(x) === v)) return r;
  }
  return null;
}

// ¿De quién es esta cuenta del ERP? Null si es una cuenta compartida o de
// cualquier otra persona: entonces no ve comisiones de nadie.
function vendedorDeUsuario(usuario) {
  const u = norm(usuario);
  if (!u) return null;
  for (const r of REGLAS) {
    if ((r.usuarios || []).some(x => norm(x) === u)) return r.quien;
  }
  return null;
}

// El porcentaje que toca, según cuánto vendió en el periodo
function pctDe(regla, total) {
  let pct = 0;
  for (const e of regla.escalones) {
    const entra = e.estricto ? total > e.desde : total >= e.desde;
    if (entra) pct = e.pct;
  }
  return pct;
}

// Cuánto falta para el siguiente escalón. Sirve para que el vendedor sepa qué
// tan cerca está: en esta regla, $1 puede valer $11,000.
function siguienteEscalon(regla, total) {
  for (const e of regla.escalones) {
    const entra = e.estricto ? total > e.desde : total >= e.desde;
    if (!entra) {
      return { desde: e.desde, pct: e.pct, falta: Math.max(0, e.desde - total) +
               (e.estricto ? 0.01 : 0) };
    }
  }
  return null;
}

// La base de una venta: total sin IVA y sin envío
function baseDeVenta(r, col) {
  const total = num(r[col.total]);
  const imp = col.impuestos ? num(r[col.impuestos]) : 0;
  if (total && imp) return total - imp;
  if (total) return total / 1.16;                // sin columna de impuestos
  // Último recurso: precio sin IVA menos descuentos
  const sinIva = col.sinIva ? num(r[col.sinIva]) * num(r[col.cantidad] || 1) : 0;
  const desc = col.descuentos ? num(r[col.descuentos]) : 0;
  return Math.max(0, sinIva - desc);
}

const periodoDe = (ms, tipo) => {
  const d = new Date(ms);
  const a = d.getUTCFullYear(), m = d.getUTCMonth();
  return tipo === 'trimestre'
    ? { clave: a + '-T' + (Math.floor(m / 3) + 1),
        nombre: 'T' + (Math.floor(m / 3) + 1) + ' ' + a, anio: a }
    : { clave: a + '-' + String(m + 1).padStart(2, '0'),
        nombre: MESES[m] + ' ' + a, anio: a };
};

// ===== El cálculo =====
//
// `filas` son los renglones de Ventas ya leídos; `col` dice cómo se llama cada
// columna; `bonos` es lo que el admin capturó, por vendedor y periodo.
function calcular(filas, col, bonos, opciones) {
  const op = opciones || {};
  const esCotizacion = op.esCotizacion || (() => false);
  const porVendedor = {};

  (filas || []).forEach(r => {
    const vendedor = txt(r[col.vendedor]);
    const regla = reglaDe(vendedor);
    if (!regla) return;
    const status = col.status ? txt(r[col.status]) : '';
    const folio = col.folio ? txt(r[col.folio]) : '';
    if (esCotizacion(folio, status)) return;              // una cotización no es venta
    if (/cancelad|anulad/i.test(status)) return;          // lo cancelado no se comisiona
    const ms = fechaMs(r[col.fecha]);
    if (!ms) return;
    const per = periodoDe(ms, regla.periodo);
    const k = regla.quien + '|' + per.clave;
    const g = porVendedor[k] = porVendedor[k] || {
      vendedor: regla.quien, periodo: per.clave, periodoNombre: per.nombre,
      tipo: regla.periodo, anio: per.anio, ventas: 0, base: 0, piezas: 0, folios: {}
    };
    g.base += baseDeVenta(r, col);
    g.ventas += num(r[col.total]);
    g.piezas += col.cantidad ? num(r[col.cantidad]) : 0;
    if (folio) g.folios[folio] = 1;
  });

  const bonoDe = (vendedor, periodo) => {
    const k = norm(vendedor) + '|' + txt(periodo);
    const b = (bonos || {})[k];
    return b ? num(b.bono) : 0;
  };

  const salida = Object.keys(porVendedor).map(k => {
    const g = porVendedor[k];
    const regla = reglaDe(g.vendedor);
    const pct = pctDe(regla, g.base);
    const comision = g.base * pct / 100;
    const tope = regla.bonoTope || 0;
    // Solo cobra bono quien lo tiene en su regla. Si no, un renglón capturado
    // por error en la pestaña Comisiones le pagaría un bono a quien no le toca.
    const bonoCrudo = tope ? bonoDe(g.vendedor, g.periodo) : 0;
    const bono = tope ? Math.min(bonoCrudo, tope) : bonoCrudo;
    return {
      vendedor: g.vendedor, periodo: g.periodo, periodoNombre: g.periodoNombre,
      tipo: g.tipo, anio: g.anio,
      ventas: Math.round(g.ventas * 100) / 100,
      base: Math.round(g.base * 100) / 100,
      folios: Object.keys(g.folios).length,
      piezas: Math.round(g.piezas),
      pct,
      comision: Math.round(comision * 100) / 100,
      bono: Math.round(bono * 100) / 100,
      bonoTope: tope,
      bonoRecortado: tope > 0 && bonoCrudo > tope,
      total: Math.round((comision + bono) * 100) / 100,
      siguiente: siguienteEscalon(regla, g.base)
    };
  });

  salida.sort((a, b) => a.vendedor === b.vendedor
    ? (a.periodo < b.periodo ? 1 : -1)
    : (a.vendedor < b.vendedor ? -1 : 1));
  return salida;
}

module.exports = { calcular, reglaDe, vendedorDeUsuario, pctDe, siguienteEscalon,
                   baseDeVenta, periodoDe, fechaMs, norm, REGLAS, MESES };
