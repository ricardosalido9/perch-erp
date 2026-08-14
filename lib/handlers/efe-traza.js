// Cómo se ven de verdad las pestañas de efectivo.
//   /api/erp?action=efe-traza
const core = require('../core');
const ARCHIVO = '12dKkf2D2biXACIyGgp3-6-QKbGjk3-T91GOq80ADPsY';

module.exports = async (req, res) => {
  try {
    const salida = { archivo: ARCHIVO, pestanas: [] };
    try { salida.pestanasDelArchivo = await core.listTabs(ARCHIVO); }
    catch (e) { salida.pestanasDelArchivo = []; salida.errorAlListar = e.message; }

    for (const hoja of ['Caja Chica', 'Efectivo General']) {
      const info = { pestana: hoja };
      let vals;
      try { vals = await core.readRange(ARCHIVO, hoja); }
      catch (e) { info.error = e.message; salida.pestanas.push(info); continue; }
      info.filasTotales = vals.length;
      // Las primeras 8 filas tal cual, para ver dónde empiezan los encabezados
      info.primerasFilas = vals.slice(0, 8).map((f, i) => ({
        fila: i + 1,
        columnas: (f || []).map((v, j) => ({
          letra: String.fromCharCode(65 + j),
          valor: String(v == null ? '' : v).slice(0, 30)
        })).filter(x => x.valor !== '')
      }));
      // Y tres filas de datos de en medio
      const medio = Math.floor(vals.length / 2);
      info.filasDeEjemplo = vals.slice(medio, medio + 3).map((f, i) => ({
        fila: medio + i + 1,
        columnas: (f || []).map((v, j) => ({
          letra: String.fromCharCode(65 + j),
          valor: String(v == null ? '' : v).slice(0, 30)
        })).filter(x => x.valor !== '')
      }));
      salida.pestanas.push(info);
    }
    salida.diagnostico = 'Revisa "primerasFilas": la fila donde aparezca "Fecha" es la de ' +
      'encabezados, y la letra de esa columna dice dónde empieza la tabla.';
    return res.status(200).json({ ok: true, salida });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || String(e) });
  }
};
