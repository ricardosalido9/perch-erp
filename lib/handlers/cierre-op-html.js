// El cierre operativo como tablero, para imprimirlo o guardarlo en PDF.
//
// La pantalla sirve para revisar renglón por renglón. Esto sirve para mandarlo:
// cómo se movió el mes en producción, qué quedó atrasado y qué falta capturar
// antes de dar el mes por cerrado.
//
//   ?action=cierre-op-html&mes=10&anio=2026
const cierreOp = require('./cierre-op');
const CFG = require('../config');
const T = require('../tablero');

// "1 piezas" se lee mal en un documento que se manda al proveedor o al jefe
const pl = (n, uno, varios) => T.numero(n || 0) + ' ' + ((n === 1) ? uno : varios);

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await cierreOp({ _body: { token: q.token, mes: +q.mes || 0, anio: +q.anio || 0 } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d) {
    return res.status(200).send(T.tableroError('No se pudo armar el cierre operativo',
      (err && err.error) || '', (err && err.pista) || ''));
  }

  const ped = d.pedidos || {}, ent = d.entradas || {}, sal = d.salidas || {};
  const atr = d.atrasados || {}, eg = d.entregas || {}, pen = eg.pendientes || {};
  const din = d.dinero || {}, inv = d.inventario || {};

  const kpis = [
    { k: 'Pedido a proveedores', v: T.numero(ped.piezas || 0),
      f: pl(ped.n || 0, 'pedido', 'pedidos') + ' · ' + T.dinero(ped.importe || 0) },
    { k: 'Llegó a bodega', v: T.numero(ent.piezas || 0),
      f: ent.aExhibicion ? T.numero(ent.aExhibicion) + ' a exhibición' : 'piezas' },
    { k: 'Entregado a clientes', v: T.numero(eg.folios || 0),
      f: pl(eg.piezas || 0, 'pieza', 'piezas') +
         (eg.tarde ? ' · ' + T.numero(eg.tarde) + ' fuera de fecha' : ''),
      mal: !!eg.tarde },
    { k: 'Pagado a proveedores', v: T.dinero(din.pagado || 0),
      f: pl(din.nPagos || 0, 'pago', 'pagos') },
    { k: 'Por pagar a hoy', v: din.deuda ? T.dinero(din.deuda.total) : '—',
      f: din.deuda ? 'mismo número del estado de cuenta' : 'no se pudo leer' },
    { k: 'Atrasado al cierre', v: T.numero(atr.piezas || 0),
      f: 'piezas que ya debían haber llegado', mal: !!atr.piezas }
  ];

  const bloques = [];

  if (inv.aviso) {
    bloques.push({ tipo: 'avisos', titulo: 'Antes de dar el mes por cerrado', grave: true,
      puntos: [inv.aviso] });
  }
  if ((d.faltan || []).length) {
    bloques.push({ tipo: 'avisos', titulo: 'Columnas que faltan en las hojas',
      puntos: d.faltan.map(f => 'Falta ' + f + ': ese bloque sale incompleto.') });
  }

  if ((ped.porProveedor || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Lo que se pidió, por proveedor',
      nota: 'con IVA, por la fecha en que se colocó el pedido',
      filas: ped.porProveedor.map(p => ({
        nombre: p.proveedor, valor: p.importe,
        detalle: pl(p.pedidos, 'pedido', 'pedidos'),
        extra: pl(p.piezas, 'pieza', 'piezas')
      })) });
  }

  if ((ent.porProveedor || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Lo que llegó, por proveedor',
      nota: 'por la fecha de entrada', formato: 'numero',
      filas: ent.porProveedor.map(p => ({
        nombre: p.proveedor, valor: p.piezas,
        texto: pl(p.piezas, 'pieza', 'piezas')
      })) });
  }

  if ((atr.detalle || []).length) {
    bloques.push({ tipo: 'tabla', titulo: 'Pedidos atrasados al cierre',
      nota: 'prometidos para esa fecha o antes y todavía sin llegar',
      columnas: ['Pedido', 'Proveedor', 'Producto', 'Faltan', 'Prometido para'],
      filas: atr.detalle.map(p => ({
        concepto: p.pedido || '(sin número)',
        celdas: [p.proveedor, (p.producto + (p.material ? ' · ' + p.material : '')),
                 T.numero(p.piezas), p.estimada]
      })),
      pie: 'Son ' + pl(atr.piezas || 0, 'pieza', 'piezas') + ' en ' +
           pl(atr.renglones || 0, 'renglón de pedido', 'renglones de pedido') + '.' });
  }

  if ((eg.detalle || []).length) {
    bloques.push({ tipo: 'tabla', titulo: 'Lo que se entregó',
      nota: 'por la fecha de entrega real',
      columnas: ['Folio', 'Cliente', 'Piezas', 'Se entregó', 'Se había acordado', 'Días'],
      filas: eg.detalle.map(p => ({
        concepto: p.folio,
        celdas: [p.cliente, T.numero(p.piezas), p.fecha, p.acordada || '',
                 (p.dias === null || p.dias === undefined) ? ''
                   : (p.dias > 0 ? '+' + p.dias : String(p.dias))]
      })) });
  }

  if ((pen.detalle || []).length) {
    bloques.push({ tipo: 'tabla', titulo: 'Lo que quedó pendiente de entregar',
      nota: 'acordado para este mes o antes y sin fecha de entrega real',
      columnas: ['Folio', 'Cliente', 'Piezas', 'Se había acordado'],
      filas: pen.detalle.map(p => ({
        concepto: p.folio,
        celdas: [p.cliente, T.numero(p.piezas), p.acordada]
      })),
      pie: 'Son ' + pl(pen.piezas || 0, 'pieza', 'piezas') + ' en ' +
           pl(pen.folios || 0, 'venta', 'ventas') + '.' });
  }

  if ((din.porProveedor || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'Lo que se pagó, por proveedor',
      nota: 'pagos del mes, de banco y de la hoja de operación',
      filas: din.porProveedor.map(p => ({
        nombre: p.proveedor, valor: p.monto,
        detalle: pl(p.pagos, 'pago', 'pagos')
      })) });
  }

  if (din.deuda && (din.deuda.proveedores || []).length) {
    bloques.push({ tipo: 'seccion', titulo: 'A quién se le debe, a hoy',
      nota: 'tomado del estado de cuenta de proveedores, sin recalcular',
      filas: din.deuda.proveedores.map(p => ({ nombre: p.proveedor, valor: p.porPagar })) });
  }

  return res.status(200).send(T.tablero({
    eyebrow: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
    titulo: 'Cierre operativo · ' + (d.etiqueta || ''),
    subtitulo: 'Cómo se movió el mes en producción',
    kpis, bloques,
    pie: 'Cada bloque se corta con su propia fecha: los pedidos por la fecha en que se ' +
         'colocaron, las entradas por la de llegada, las salidas por la de salida y las ' +
         'entregas por la fecha de entrega real. La deuda con proveedores es la del ' +
         'estado de cuenta, a hoy.'
  }));
};
