// El PDF de un estado financiero. Reusa el handler que ya lo arma, así que el
// papel y la pantalla no pueden desviarse: salen del mismo cálculo.
//
//   ?action=estado-pdf  { estado, anio, desde, hasta, vacios }
const core = require('../core');
const CFG = require('../config');
const armar = require('./estados');
const { reporteEstado } = require('../pdf-estado');

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

module.exports = async (req, res) => {
  try {
    const body = await core.readBody(req);
    if (!core.verifyToken(body.token)) return res.status(401).json({ error: 'Sesión no válida.' });

    // Se llama al handler de siempre y se le atrapa la respuesta
    let datos = null, error = null;
    const falso = {
      status: (code) => ({
        json: (o) => { if (code === 200) datos = o; else error = o; return o; }
      })
    };
    await armar({ _body: Object.assign({}, body, { pdf: undefined }) }, falso);
    if (error) return res.status(400).json(error);
    if (!datos) return res.status(500).json({ error: 'No se pudo armar el estado.' });

    // Los renglones vacíos no van al papel salvo que se pidan
    const verVacios = !!body.vacios;
    datos.filas.forEach(f => { f.oculta = f.vacio && !verVacios; });

    const hoy = new Date();
    const periodo = (datos.desde === datos.hasta)
      ? cap(MESES[datos.desde - 1]) + ' ' + datos.anio
      : cap(MESES[datos.desde - 1]) + ' a ' + MESES[datos.hasta - 1] + ' de ' + datos.anio;

    const buf = await reporteEstado(datos, {
      titulo: datos.titulo,
      anio: datos.anio,
      periodo: periodo + '  ·  comparado contra el mismo periodo de ' + (datos.anio - 1),
      empresa: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
      generado: 'Generado el ' + hoy.getDate() + ' de ' + MESES[hoy.getMonth()] +
                ' de ' + hoy.getFullYear(),
      lectura: datos.lectura || []
    });

    return res.status(200).json({
      ok: true,
      pdf: buf.toString('base64'),
      nombre: ((CFG.EMPRESA && CFG.EMPRESA.nombre) || 'Perch') + ' - ' + datos.titulo +
              ' ' + periodo + '.pdf',
      lectura: datos.lectura || []
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
