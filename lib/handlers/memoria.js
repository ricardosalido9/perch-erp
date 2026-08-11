// Memoria del proyecto: las decisiones técnicas que ya se tomaron, escritas en Drive.
// Sirve para que nadie — ni el ERP, ni quien lo mantenga — tenga que volver a preguntarlas.
//   /api/erp?action=memoria           -> las lee
//   POST { action:'memoria', escribir:true } -> las escribe en el archivo consolidado
const core = require('../core');

// Cada renglón: área, qué se decidió, y el detalle técnico exacto.
const DECISIONES = [
  ['Pedidos a proveedores', 'Costo unitario',
   'Sale de la pestaña "Costos Unitarios" del archivo de Operación. Llave: Productos + Material 1 + Proveedor, y se toma el del Año en curso (si no hay, el más reciente). Es editable.'],
  ['Pedidos a proveedores', 'Producto y Material',
   'Cascada desde "Lista de Precios {AAAA}" del catálogo. El Material ofrece también el Material Extra, porque al proveedor se le puede pedir la madera o el tejido por separado.'],
  ['Pedidos a proveedores', 'Campos del formulario',
   'Fecha (hoy, fija) · Fecha Estimada de Entrega · Pedido Proveedor · Proveedor · Producto · Material · Tela · Especificaciones · Cantidad · Costo Unitario · Costo Total · Costo Total + IVA. NO se piden Folio cliente, Cliente ni Dirección de Entrega: el destino se decide al dar salida.'],
  ['Pedidos a proveedores', 'Lo que no se pregunta',
   'Mes, Año y Status se ponen solos. Status arranca en PENDIENTE COMPLETO. No hay paso de facturación ni cuentas por cobrar.'],
  ['Pedidos a proveedores', 'Varios productos',
   'Un pedido lleva varios productos, cada uno su renglón en la hoja con el mismo Pedido Proveedor. El total de abajo se muestra CON IVA.'],

  ['Producción', 'Reparto a ventas',
   'Un pedido se reparte entre VARIAS ventas desde "Mandar a venta". Solo se ofrecen las ventas que pidieron ese producto y no tienen salida. Lo que no se reparte se queda en stock del proveedor.'],
  ['Producción', 'Aviso al proveedor',
   'Al registrar el reparto se genera un texto listo para copiar con cuántas piezas van a cada folio y cuántas se quedan en su stock.'],
  ['Producción', 'Inventario del proveedor',
   'Disponible = entregadas menos salidas. Por fabricar = pedidas menos entregadas.'],

  ['Estado de cuenta proveedores', 'Corte de año',
   'Solo cuentan pedidos y pagos de 2026 en adelante. Lo anterior se congela en la pestaña "Saldos iniciales proveedores" (Proveedor | Saldo inicial), porque los pedidos viejos se migraron incompletos (solo el stock que servía) mientras que los pagos sí están completos.'],
  ['Estado de cuenta proveedores', 'Pagos a pedidos viejos',
   'Un pago de 2026 a un pedido anterior al corte SÍ cuenta y baja la deuda. Se muestra aparte en la tarjeta del proveedor.'],
  ['Estado de cuenta proveedores', 'Pagado',
   'Es todo lo que EGRESOS tenga con ese número de pedido, ajustes incluidos: también son dinero a favor del proveedor. Los ajustes se marcan pero no se restan aparte.'],
  ['Estado de cuenta proveedores', 'Llave de los pagos',
   'Se indexa por PEDIDO. Si ese número lo usa un solo proveedor, se le asignan sus pagos aunque el nombre esté escrito distinto. Si lo comparten varios, se exige que coincida el proveedor.'],
  ['Estado de cuenta proveedores', 'Qué se muestra',
   'Por defecto solo los proveedores con saldo, y TODOS los pedidos (no solo los abiertos): un pedido entregado se sigue debiendo hasta que se paga.'],

  ['Costo real de una venta', 'De dónde sale',
   'Manda la columna Costo de la hoja "Salidas de Inventario", que ya la calcula la fórmula de la hoja. Se suman los renglones del folio. Si a un renglón le falta el costo, se busca en Pedidos por pedido + producto + material.'],
  ['Costo real de una venta', 'Pedidos directos',
   'Las piezas que el pedido ya asignó a un folio cuentan primero. Después las que salieron de stock, descontando por cantidad para no contar dos veces (incluido el caso del mueble comprado por partes que sale entero).'],
  ['Costo real de una venta', 'Cero es cero',
   'Si la hoja dice 0 es porque la pieza no ha llegado o no se ha costeado. NO se completa con promedios ni estimaciones: se marca como pendiente de costear.'],
  ['Costo real de una venta', 'Histórico',
   'Los folios anteriores a 2026 se congelan con el costo que trae la hoja de VENTAS y no se recalculan.'],
  ['Costo real de una venta', 'Fórmula recomendada en VENTAS',
   'SUMAR.SI.CONJUNTO por folio + producto, SIN el material como criterio: así entran los muebles de tres o más componentes (madera + tela + pino). Nunca PROMEDIO.SI.CONJUNTO: no pondera por cantidad.'],

  ['Cotizaciones', 'Encuesta',
   'En la cotización solo se preguntan: Tipo de cliente, Cómo llegó, ¿Visitó el showroom? y Notas.'],
  ['Cotizaciones', 'Folio', 'Prefijo COT-, independiente del folio de ventas.'],
  ['Cotizaciones', 'Fecha de entrega',
   'No es obligatoria: se estima a 8 semanas y es editable. La real se pide al convertir en venta.'],
  ['Cotizaciones', 'Conversión',
   'Vendidas entre TODAS las cotizaciones, no solo las cerradas.'],

  ['Ventas', 'Preguntas de marketing',
   'Al cerrar la venta se preguntan Ciudad, Tipo de Proyecto, Línea de Negocio, Tipo de Línea de Negocio y Happening. Las respuestas salen de la pestaña "Categorías". No necesitan existir como columna en VENTAS.'],
  ['Ventas', 'Pestaña Marketing',
   'Se escribe un renglón por venta. Los nombres cambian entre hojas: Tipo de Proyecto→Proyecto, Tipo de Línea de Negocio→Tipo de Línea, HAPPENING→Happening.'],
  ['Ventas', 'Fecha de entrega real',
   'Se sella sola el día que el Status pasa a Entregado. La fecha acordada NO se pisa: se conservan las dos para medir puntualidad.'],
  ['Ventas', 'Envío', 'Es del pedido completo, no de cada producto. Se captura al pie, junto al total, y se escribe solo en la primera fila.'],

  ['Clientes', 'Datos obligatorios',
   'Teléfono, Despacho y Dirección de envío. Se piden al guardar una cotización o venta si faltan.'],
  ['Clientes', 'Datos fiscales',
   'Se leen solos de la CSF en PDF al subirla en el paso de facturación: Razón Social, RFC, Tipo de Persona y Régimen fiscal. NO se piden en el modal de datos del cliente.'],
  ['Clientes', 'Duplicados',
   'El combo deduplica ignorando mayúsculas y acentos. Gana la escritura de la Lista de Clientes, que es la que autocompleta.'],
  ['Clientes', 'Visita al showroom',
   'Es un atributo del cliente, no un evento de la cotización. Si ya tiene visitas, se elige a cuál corresponde en vez de crear otra.'],

  ['Catálogo', 'Precio', 'Es la columna "Precio Unitario". No "Precio de Venta".'],
  ['Catálogo', 'Margen mínimo', '20%. Avisa en rojo si baja, y en ámbar si con el descuento del 15% se hunde.'],

  ['General', 'Archivo de Producción',
   'Al 11 de agosto: Pedidos a Proveedores se captura en el CONSOLIDADO. Entradas y Salidas siguen en OPERACIÓN 2026 (1cbRHK4_-WxCd8q7hemw-PYrt3opZ5GSn5tzghGpByV4), porque ahí está la historia completa de todos los proveedores. Stock y Revisar los calcula el ERP y van al consolidado (11kiRhoY0r6EG3Iq0aMwW7m5zYEaltz1nJcHNRmF3moc), junto con Comparativas y Proveedores. NO cambiar sin avisar: mueve dónde caen los registros nuevos.'],
  ['General', 'Otros archivos',
   'Ventas, Cotizaciones, Leads, Showroom, Marketing y CxC en el Dashboard Comercial. Clientes, Proveedores y Catálogo en los suyos. Ingresos y Egresos en el histórico de finanzas.'],
  ['General', 'Dónde se guarda cada área',
   'Debajo del título de cada área el ERP muestra el nombre de la pestaña con link al archivo. Si hay duda de dónde quedó un registro, ahí está.'],
  ['General', 'Nombres de columna',
   'Se resuelven con alias: Producto = Productos = Item; Cliente = Nombre/Razón Social = Contacto. Nunca se exige un nombre exacto.'],
  ['General', 'Filas de fórmula arrastrada',
   'Una fila cuenta como venta solo si tiene folio o importe distinto de cero. Los #DIV/0! en filas vacías son ruido normal y se ignoran.']
];

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const body = req._body || {};
    const escribir = q.escribir === '1' || body.escribir === true;

    if (!escribir) {
      return res.status(200).json({
        ok: true, total: DECISIONES.length,
        decisiones: DECISIONES.map(d => ({ area: d[0], tema: d[1], decision: d[2] }))
      });
    }

    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });
    const cfg = core.areaCfg ? await core.areaCfg('op_stock') : core.SHEETS.op_stock;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'No está configurado el archivo consolidado.' });

    const filas = [['Área', 'Tema', 'Cómo quedó decidido']].concat(DECISIONES);
    await core.escribirTabla(cfg.id, 'Decisiones del ERP', filas);
    return res.status(200).json({
      ok: true, escritas: DECISIONES.length,
      archivo: 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
