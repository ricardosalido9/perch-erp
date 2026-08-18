// ===== LA ÚNICA CONFIGURACIÓN POR CLIENTE =====
//
// Aquí viven los IDs de los archivos de Google. Nada más en el código debe
// tenerlos escritos: si hay que cambiar de cliente, se cambia solo esto.
//
// Cada uno se puede definir de dos formas:
//   1. Variable de entorno en Vercel (recomendado): SHEET_VENTAS=1abc...
//   2. El valor por defecto de abajo, para desarrollo local
//
// Para montar un cliente nuevo: se crean sus archivos de Google, se comparten
// con la cuenta de servicio, y se cargan sus IDs como variables de entorno.
// El código no se toca.

const E = process.env;

// El id se saca de la variable de entorno; si no existe, del valor por defecto.
// Un id vacío significa "esta área todavía no está conectada", y el ERP lo
// muestra en pantalla en vez de fallar.
function id(variable, porDefecto) {
  const v = String(E[variable] || '').trim();
  return v || (porDefecto || '');
}

const ARCHIVOS = {
  // Comercial: ventas, cotizaciones, leads, showroom, cuentas por cobrar
  VENTAS:        id('SHEET_VENTAS',        '1ex3bs65tKxcDECzn1PnUZf2NRG2qgxkeMyp8IVueGuU'),
  // Producción: pedidos a proveedores, entradas, salidas, stock, envíos
  PRODUCCION:    id('SHEET_PRODUCCION',    '11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc'),
  // Finanzas: INGRESOS y EGRESOS. Es la única fuente de flujo de dinero
  FINANZAS:      id('SHEET_FINANZAS',      '1cacFpLcoSwTnWNFc6LgRo1Fb3qJa-qZl0HYhpExUWO4'),
  // Operación: gastos capturados a mano, para conciliar contra el banco
  OPERACION:     id('SHEET_OPERACION',     '1cbRHK4_-WxCd8q7hemw-PYrt3opZ5GSn5tzghGpByV4'),
  // Catálogo de productos con precios y costos
  CATALOGO:      id('SHEET_CATALOGO',      '16VC0xiAPF4rOqirbDfTOju0tVb0sr9R6OKzCeWXytoA'),
  CLIENTES:      id('SHEET_CLIENTES',      '1w7AmzcuO1iKY7hti5sTqhGqLsLIhf-e9rs2FiYgS5jM'),
  PROVEEDORES:   id('SHEET_PROVEEDORES',   '1zf_j6V-Wr_a7-0MGyntaPPvYRo-tPL4BSmtKOlyZJe8'),
  // Los CFDIs descargados del SAT
  CFDI_EMITIDOS: id('SHEET_CFDI_EMITIDOS', '1j3kcOl9l4EXZtcG2HTFWLy1AqfCHaIyCuayR0E1k35A'),
  CFDI_RECIBIDOS:id('SHEET_CFDI_RECIBIDOS','1Wi_jw3X93myP7sXPF-lT7yK0Pzsz5Ks5Zmew0AHqDbk'),
  COLABORADORES: id('SHEET_COLABORADORES', '1OE5Pm9eCqlq3CUmt8m8sm0lgL_lTQbBt-PHIKCqoE2M'),
  NOMINA:        id('SHEET_NOMINA',        '1F8VTHJiLuBRt4kgAN2gbDxwmenKSouPZESI5x6qwltI'),
  EFECTIVO:      id('SHEET_EFECTIVO',      '12dKkf2D2biXACIyGgp3-6-QKbGjk3-T91GOq80ADPsY'),
  // Los catálogos de conceptos, categorías y listas de todos los menús
  CATEGORIAS:    id('SHEET_CATEGORIAS',    '1cKns85GvnfM3Himu_a9AdwFEenP0ofTu8ou4jyiLNoI'),
  FUNNEL:        id('SHEET_FUNNEL',        '18b4A-fHoJtSio0cmy3cBaYbWJQ3zHlQAmSzGiQuhk3A'),
  // Donde se guardan los PDFs y exportaciones
  DRIVE:         id('DRIVE_CARPETA',       '')
};

// Los nombres de pestaña también cambian entre clientes.
// Se pueden sobreescribir con variables tipo TAB_VENTAS=Ventas 2026
const PESTANAS = {
  ventas:          E.TAB_VENTAS          || 'VENTAS',
  cotizaciones:    E.TAB_COTIZACIONES    || 'COTIZACIONES',
  leads:           E.TAB_LEADS           || 'LEADS',
  showroom:        E.TAB_SHOWROOM        || 'SHOWROOM',
  cxc:             E.TAB_CXC             || 'CxC',
  marketing:       E.TAB_MARKETING       || 'Marketing',
  metas:           E.TAB_METAS           || 'Metas',
  pedidos:         E.TAB_PEDIDOS         || 'Pedidos a Proveedores',
  entradas:        E.TAB_ENTRADAS        || 'Entradas de Inventario',
  salidas:         E.TAB_SALIDAS         || 'Salidas de Inventario',
  stock:           E.TAB_STOCK           || 'Stock',
  revisar:         E.TAB_REVISAR         || 'Revisar',
  envios:          E.TAB_ENVIOS          || 'Envios',
  revision:        E.TAB_REVISION        || 'Mi hoja',
  ingresos:        E.TAB_INGRESOS        || 'INGRESOS',
  egresos:         E.TAB_EGRESOS         || 'EGRESOS',
  gastosManuales:  E.TAB_GASTOS_MANUALES || 'Gastos Manuales',
  catalogo:        E.TAB_CATALOGO        || 'Lista de Precios {AAAA}',
  costosUnitarios: E.TAB_COSTOS          || 'Costos Unitarios',
  clientes:        E.TAB_CLIENTES        || 'Lista de Clientes',
  proveedores:     E.TAB_PROVEEDORES     || 'Lista de Proveedores',
  cfdiVigentes:    E.TAB_CFDI_VIGENTES   || 'VIGENTES',
  cfdiComplementos:E.TAB_CFDI_COMPLEMENTOS || 'COMPLEMENTOS DE PAGO',
  colaboradores:   E.TAB_COLABORADORES   || 'Nomina',
  nomina:          E.TAB_NOMINA          || 'Nómina 2026',
  cajaChica:       E.TAB_CAJA_CHICA      || 'Caja Chica',
  efectivoGeneral: E.TAB_EFECTIVO_GENERAL|| 'Efectivo General',
  categorias:      E.TAB_CATEGORIAS      || 'Categorias',
  funnel:          E.TAB_FUNNEL          || 'Montse 2026',
  usuarios:        E.TAB_USUARIOS        || 'Usuarios ERP'
};

// Datos de la empresa: salen en los PDFs de cotización y estados de cuenta
const EMPRESA = {
  nombre:    E.EMPRESA_NOMBRE    || 'Perch Diseño y Mobiliario',
  sitio:     E.EMPRESA_SITIO     || 'WWW.PERCH.MX',
  ciudad:    E.EMPRESA_CIUDAD    || 'CIUDAD DE MEXICO',
  banco:     E.EMPRESA_BANCO     || 'BBVA',
  clabe:     E.EMPRESA_CLABE     || '012180001174417892',
  titular:   E.EMPRESA_TITULAR   || 'Perch Diseño y Mobiliario',
  correoFacturacion: E.EMPRESA_CORREO_FACTURACION || '',
  iva:       parseFloat(E.EMPRESA_IVA || '0.16')
};

// Qué archivos hacen falta para que el ERP arranque
const OBLIGATORIOS = ['VENTAS', 'PRODUCCION', 'FINANZAS'];

function faltantes() {
  return OBLIGATORIOS.filter(k => !ARCHIVOS[k]);
}
// Para la pantalla de configuración: qué está conectado y qué no
function estado() {
  return Object.keys(ARCHIVOS).map(k => ({
    archivo: k,
    conectado: !!ARCHIVOS[k],
    obligatorio: OBLIGATORIOS.indexOf(k) !== -1,
    variable: 'SHEET_' + k,
    id: ARCHIVOS[k] ? ARCHIVOS[k].slice(0, 10) + '…' : ''
  }));
}

module.exports = { ARCHIVOS, PESTANAS, EMPRESA, faltantes, estado };
