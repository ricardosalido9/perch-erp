// El Inicio como tablero: lo mismo que se ve en la pantalla, pero en una página
// que se puede mandar por correo o imprimir a PDF.
//
// La pantalla de Inicio sirve para trabajar: se hace clic en un aviso y te lleva
// al área. Esto sirve para enseñar cómo va el negocio, así que ordena distinto:
// primero las cifras del mes, luego lo que urge, y al final lo que solo hay que
// tener presente.
//
//   ?action=inicio-html
const inicio = require('./inicio');
const CFG = require('../config');
const T = require('../tablero');

const MESL = ['enero','febrero','marzo','abril','mayo','junio','julio',
              'agosto','septiembre','octubre','noviembre','diciembre'];

module.exports = async (req, res) => {
  const q = req.query || {};
  let d = null, err = null;
  const captura = { status: (c) => ({ json: (o) => { if (c === 200) d = o; else err = o; return o; } }) };
  await inicio({ _body: { token: q.token } }, captura);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (err || !d) {
    return res.status(200).send(T.tableroError('No se pudo armar el tablero',
      (err && err.error) || '', (err && err.pista) || ''));
  }

  const r = d.resumen || {};
  const hoy = new Date();
  const kpis = [];
  if (r.ventasMes != null) kpis.push({ k: 'Vendido este mes', v: T.dinero(r.ventasMes),
    f: r.opsMes ? T.numero(r.opsMes) + (r.opsMes === 1 ? ' venta' : ' ventas') : '' });
  if (r.utilidadMes != null) kpis.push({ k: 'Utilidad del mes', v: T.dinero(r.utilidadMes),
    hi: r.utilidadMes > 0, mal: r.utilidadMes <= 0,
    f: r.ventasMes ? T.pct(r.utilidadMes / r.ventasMes) + ' de la venta' : '' });
  if (r.comprasMes != null) kpis.push({ k: 'Comprado este mes', v: T.dinero(r.comprasMes),
    f: r.opsCompraMes ? T.numero(r.opsCompraMes) + ' pedidos' : '' });

  // Los avisos se parten por urgencia: lo que detiene el trabajo primero.
  const avisos = d.avisos || [];
  const urge = avisos.filter(a => a.tipo === 'alert');
  const ojo = avisos.filter(a => a.tipo === 'warn');
  const nota = avisos.filter(a => a.tipo !== 'alert' && a.tipo !== 'warn');
  kpis.push({ k: 'Cosas por atender', v: T.numero(avisos.length),
    mal: urge.length > 0,
    f: urge.length ? T.numero(urge.length) + ' urgentes' : 'ninguna urgente' });

  const bloques = [];
  const comoSeccion = (lista, titulo, nota2) => {
    if (!lista.length) return;
    bloques.push({
      tipo: 'seccion', titulo, nota: nota2, formato: 'numero', sinBarra: false,
      filas: lista.map(a => ({
        nombre: a.titulo, valor: a.n || 0,
        detalle: a.detalle || '',
        texto: T.numero(a.n || 0)
      }))
    });
  };
  comoSeccion(urge, 'Urge', 'detienen el trabajo');
  comoSeccion(ojo, 'Ojo con esto', 'datos incompletos o vencidos');
  comoSeccion(nota, 'Para tener presente', '');

  // El desglose folio por folio de los avisos que lo traen: es lo que convierte
  // un número en algo que se puede accionar sin entrar al sistema.
  avisos.filter(a => (a.detalles || []).length).forEach(a => {
    const filas = [];
    a.detalles.slice(0, 12).forEach(v => {
      filas.push({
        nombre: v.folio, valor: v.piezas || 0, texto: T.numero(v.piezas || 0) + ' pzs',
        detalle: (v.muebles || []).map(m => {
          const comps = (m.componentes || []).map(c =>
            c.material + (c.alcanza ? '' : ' (falta)')).join(' + ');
          return T.numero(m.faltan) + ' ' + m.producto + (comps ? ' · ' + comps : '');
        }).join(' | ')
      });
    });
    if (filas.length) {
      bloques.push({ tipo: 'seccion', titulo: a.titulo, nota: a.detalle,
        formato: 'numero', filas });
    }
  });

  return res.status(200).send(T.tablero({
    eyebrow: (CFG.EMPRESA && CFG.EMPRESA.nombre) || '',
    titulo: 'Cómo vamos',
    subtitulo: MESL[hoy.getMonth()] + ' de ' + hoy.getFullYear() + ' · al día ' + hoy.getDate(),
    kpis, bloques,
    pie: 'Sale de lo que hay capturado en este momento.'
  }));
};
