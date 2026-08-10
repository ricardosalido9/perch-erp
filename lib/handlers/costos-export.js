// Escribe el comparativo de costos en el archivo de Operación, en dos pestañas:
//   "Comparativas"          -> un renglón por folio de venta
//   "Comparativas detalle"  -> un renglón por pieza, con de dónde salió cada costo
const core = require('../core');
const costos = require('./costos');

function fmt(v) { return (v === null || v === undefined) ? '' : v; }

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyWriter(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // Se reutiliza el mismo cálculo que muestra el ERP
    const datos = await new Promise((resolve, reject) => {
      const fake = { status() { return fake; }, json(o) { resolve(o); return fake; } };
      req._body = { token: body.token };
      costos(req, fake).catch(reject);
    });
    if (datos.error) return res.status(400).json({ error: datos.error });

    const cfg = core.areaCfg ? await core.areaCfg('prov_pedidos') : core.SHEETS.prov_pedidos;
    if (!cfg || !cfg.id) return res.status(400).json({ error: 'No está configurado el archivo de Operación.' });

    const F = datos.folios || [];
    const cab = ['Folio', 'Fecha', 'Año', 'Cliente', 'Piezas', 'Proveedores',
      'Venta sin IVA', 'Costo real', 'Margen real', 'Costo Ventas', 'Margen Ventas',
      'Costo Catálogo', 'Margen Catálogo', 'Real vs Ventas', 'Real vs Catálogo',
      'Piezas estimadas', 'Piezas sin costear', 'De dónde salieron los costos', 'Renglones'];
    const filas = [cab];
    F.forEach(r => {
      const red = (x) => (x === null ? null : Math.round(x * 100) / 100);
      const dv = red((r.costoReal !== null && r.costoVentas) ? (r.costoReal - r.costoVentas) : null);
      const dc = red((r.costoReal !== null && r.costoCatalogo) ? (r.costoReal - r.costoCatalogo) : null);
      // Qué fuentes se usaron. Si un folio mezcla "pedido directo" con otra cosa,
      // ahí está la pieza que no se pudo costear con su propio pedido.
      const cuenta = {};
      (r.detalle || []).forEach(p => { cuenta[p.fuente] = (cuenta[p.fuente] || 0) + 1; });
      const fuentes = Object.keys(cuenta).map(k => k + ' x' + cuenta[k]).join(' · ');
      filas.push([r.folio, r.fecha, fmt(r.anio), r.cliente, r.piezas, r.proveedores,
        fmt(r.venta), fmt(r.costoReal), fmt(r.margenReal), fmt(r.costoVentas), fmt(r.margenVentas),
        fmt(r.costoCatalogo), fmt(r.margenCatalogo), fmt(dv), fmt(dc),
        r.aproximados || 0, r.sinCostear || 0, fuentes, (r.detalle || []).length]);
    });

    const cab2 = ['Folio', 'Fecha', 'Cliente', 'Pieza', 'Material', 'Proveedor',
      'Pedido usado', 'Cantidad', 'Costo unitario', 'Importe', 'De dónde salió el costo', 'Costo catálogo'];
    const det = [cab2];
    F.forEach(r => {
      (r.detalle || []).forEach(p => {
        det.push([r.folio, r.fecha, r.cliente, p.producto, p.material, p.proveedor,
          p.pedido, p.cantidad, fmt(p.costoUnitario),
          (p.costoUnitario === null ? '' : Math.round(p.costoUnitario * p.cantidad * 100) / 100),
          p.fuente, fmt(p.catalogo)]);
      });
    });

    // ── Tercera pestaña: dónde está la diferencia, producto por producto ──
    const norm = (x) => String(x == null ? '' : x).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    const cab3 = ['Folio', 'Fecha', 'Cliente', 'Producto', 'Cant. vendida', 'Cant. de producción',
      'Costo en Ventas', 'Costo real', 'Diferencia', 'Piezas de producción', 'Motivo'];
    const dif = [cab3];
    F.forEach(r => {
      if (r.costoReal === null) return;
      const porProd = {};
      (r.lineasVenta || []).forEach(l => {
        const k = norm(l.producto);
        const d = porProd[k] = porProd[k] || { nombre: l.producto, vend: 0, costoV: 0, prod: 0, costoR: 0, piezas: [] };
        d.vend += l.cantidad || 0; d.costoV += l.costo || 0;
      });
      (r.detalle || []).forEach(p => {
        const k = norm(p.producto);
        const d = porProd[k] = porProd[k] || { nombre: p.producto, vend: 0, costoV: 0, prod: 0, costoR: 0, piezas: [] };
        d.prod += p.cantidad || 0;
        d.costoR += (p.costoUnitario || 0) * (p.cantidad || 0);
        d.piezas.push(p.material + ' ' + (p.proveedor ? '(' + p.proveedor + ')' : ''));
      });
      Object.keys(porProd).forEach(k => {
        const d = porProd[k];
        const delta = Math.round((d.costoR - d.costoV) * 100) / 100;
        let motivo = '';
        if (!d.prod) motivo = 'Vendido pero sin piezas en producción';
        else if (!d.vend) motivo = 'Piezas asignadas a un producto que no está en la venta';
        else if (Math.abs(delta) < 0.5) motivo = 'Cuadra';
        else if (d.piezas.length > 1) motivo = 'Se arma con ' + d.piezas.length + ' componentes';
        else motivo = 'Mismo producto, costo distinto';
        dif.push([r.folio, r.fecha, r.cliente, d.nombre, d.vend, d.prod,
          Math.round(d.costoV * 100) / 100, Math.round(d.costoR * 100) / 100, delta,
          d.piezas.join(' + '), motivo]);
      });
    });

    const a = await core.escribirTabla(cfg.id, 'Comparativas', filas);
    const b = await core.escribirTabla(cfg.id, 'Comparativas detalle', det);
    const c = await core.escribirTabla(cfg.id, 'Comparativas diferencias', dif);
    return res.status(200).json({
      ok: true, folios: filas.length - 1, piezas: det.length - 1, diferencias: dif.length - 1,
      archivo: 'https://docs.google.com/spreadsheets/d/' + cfg.id + '/edit'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
