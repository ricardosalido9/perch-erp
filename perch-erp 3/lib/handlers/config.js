// Qué está conectado y qué falta. Sirve para montar un cliente nuevo.
//   /api/erp?action=config
const CFG = require('../config');
const core = require('../core');

module.exports = async (req, res) => {
  try {
    const estado = CFG.estado();
    const faltan = CFG.faltantes();

    // Se prueba el acceso real a cada archivo conectado
    const revisar = req.query && (req.query.probar === '1' || req.query.probar === 'si');
    let acceso = null;
    if (revisar) {
      acceso = [];
      for (const e of estado) {
        if (!e.conectado) continue;
        const id = CFG.ARCHIVOS[e.archivo];
        const r = { archivo: e.archivo };
        try {
          r.pestanas = await core.listTabs(id);
          r.ok = true;
        } catch (err) {
          r.ok = false;
          r.error = /permission|403/i.test(err.message)
            ? 'No está compartido con la cuenta de servicio'
            : err.message;
        }
        acceso.push(r);
      }
    }

    return res.status(200).json({
      ok: !faltan.length,
      cuentaDeServicio: 'perch-panel@perch-erp.iam.gserviceaccount.com',
      empresa: CFG.EMPRESA,
      archivos: estado,
      pestanas: CFG.PESTANAS,
      faltanObligatorios: faltan,
      acceso,
      comoMontarUnClienteNuevo: [
        '1. Crear los archivos de Google con las pestañas de la plantilla.',
        '2. Compartir cada uno con la cuenta de servicio, con permiso de editor.',
        '3. En Vercel, agregar una variable por archivo: SHEET_VENTAS, SHEET_PRODUCCION, etc.',
        '4. Si alguna pestaña se llama distinto, agregar su variable TAB_: TAB_VENTAS, TAB_CXC…',
        '5. Los datos de la empresa van en EMPRESA_NOMBRE, EMPRESA_CLABE, EMPRESA_BANCO…',
        '6. Volver a desplegar. El código no se toca.'
      ],
      ayuda: 'Agrega &probar=1 para verificar que la cuenta de servicio tenga acceso real a cada archivo.'
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
