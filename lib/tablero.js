// El tablero: el molde visual que usan todos los reportes.
//
// Cada reporte arma un objeto con lo que quiere mostrar —cuatro cifras arriba,
// una barra partida, barras por mes, avisos, y secciones de renglones— y este
// módulo lo dibuja. El diseño vive en un solo lugar: cambiar un color o un
// tamaño lo cambia en todos los reportes, y un reporte nuevo no vuelve a
// inventar la hoja de estilos.
//
// El HTML sale completo y sin depender de nada externo salvo las tipografías, así
// que se puede mandar por correo, guardar, o imprimir a PDF desde el navegador
// conservando el diseño.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dinero(v) {
  const n = Number(v) || 0;
  return (n < 0 ? '\u2212' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
}
function numero(v) { return (Number(v) || 0).toLocaleString('en-US'); }
function pct(v, d) {
  if (v === null || v === undefined) return '\u2014';
  return (v * 100).toFixed(d === undefined ? 1 : d) + '%';
}

const MES3 = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const CSS = `
:root{--ink:#141414;--paper:#f2f0ea;--card:#fff;--line:#e4dfd3;--acc:#2f4f3e;
      --mal:#9d3427;--bien:#2f6b4f;--amb:#a8791f;--muted:#857e70}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--paper);color:var(--ink);
     line-height:1.5;padding:38px 24px 60px}
.mono{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1040px;margin:0 auto}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{font-family:Fraunces,Georgia,serif;font-size:40px;font-weight:600;margin-top:4px}
.sub{color:var(--muted);font-size:13px;margin-top:6px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:30px 0 22px}
.kpis.tres{grid-template-columns:repeat(3,1fr)}
.kpis.dos{grid-template-columns:repeat(2,1fr)}
.kpi{background:var(--card);border:1px solid var(--line);padding:16px 18px}
.kpi.hi{border:1.5px solid var(--acc)}
.kpi.mal{border:1.5px solid var(--mal)}
.kpi .k{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}
.kpi .v{font-family:"IBM Plex Mono",monospace;font-size:25px;font-weight:500;margin-top:7px}
.kpi .f{font-size:11px;color:var(--muted);margin-top:5px}
.up{color:var(--bien)}.down{color:var(--mal)}.amb{color:var(--amb)}
.split{background:var(--card);border:1px solid var(--line);padding:18px 20px;margin-bottom:26px}
.split h3{font-size:14px;display:flex;justify-content:space-between;align-items:baseline}
.split h3 span{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);font-weight:400}
.sbar{display:flex;height:40px;margin-top:12px;overflow:hidden}
.sbar b{display:flex;align-items:center;padding:0 12px;font-size:11.5px;font-weight:500;
        white-space:nowrap;overflow:hidden}
h2{font-family:Fraunces,Georgia,serif;font-size:21px;font-weight:600;margin:32px 0 3px;
   border-bottom:1.5px solid var(--ink);padding-bottom:9px;display:flex;
   justify-content:space-between;align-items:baseline;gap:14px}
h2 em{font-family:Inter,sans-serif;font-size:11px;font-style:normal;color:var(--muted);
      text-align:right;font-weight:400}
.card{background:var(--card);border:1px solid var(--line);padding:16px 20px;margin-top:14px}
.row{padding:10px 0;border-bottom:1px solid #f0ece2}
.row:last-child{border-bottom:none}
.rt{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:12px}
.rn{font-size:13.5px;font-weight:500}
.rn i{color:var(--muted);font-style:normal;font-size:11.5px}
.rv{font-size:11.5px;color:var(--muted);white-space:nowrap}
.rv b{font-size:12.5px;color:var(--ink);font-weight:500}
.bar{height:7px;background:#efece3;overflow:hidden}
.bar i{display:block;height:7px;background:var(--acc)}
.bar i.neg{background:var(--mal)}
.meses{display:flex;align-items:flex-end;gap:5px;height:112px;margin-top:14px}
.meses div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%}
.meses u{display:block;background:var(--acc);text-decoration:none;min-height:1px}
.meses u.neg{background:var(--mal)}
.meses span{font-size:9.5px;color:var(--muted);text-align:center;margin-top:5px}
.rev{background:#fdf6e3;border:1px solid #e6cf93;padding:14px 18px;margin-top:14px}
.rev li{font-size:12.5px;margin:5px 0 5px 16px}
.rev.mal{background:#fdf0ee;border-color:#e0b3ab}
.lista{list-style:none}
.lista li{font-size:12.5px;padding:7px 0;border-bottom:1px solid #f0ece2;display:flex;
          justify-content:space-between;gap:12px}
.lista li:last-child{border-bottom:none}
.pie{margin-top:34px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);
     padding-top:12px}
@media print{body{background:#fff;padding:0}.wrap{max-width:none}
  h2{page-break-after:avoid}.card,.split,.kpi,.rev{break-inside:avoid}}
`;

// ---- las piezas ----

function kpis(lista) {
  if (!lista || !lista.length) return '';
  const clase = lista.length === 3 ? ' tres' : (lista.length === 2 ? ' dos' : '');
  return '<div class="kpis' + clase + '">' + lista.map(k =>
    '<div class="kpi' + (k.mal ? ' mal' : (k.hi ? ' hi' : '')) + '">' +
    '<div class="k">' + esc(k.k) + '</div>' +
    '<div class="v">' + esc(k.v) + '</div>' +
    (k.f ? '<div class="f">' + esc(k.f) + '</div>' : '') + '</div>').join('') + '</div>';
}

// La barra partida: en qué se convierte un total. Los tramos con muy poco peso se
// dibujan igual pero sin rótulo, porque el texto no cabe y se ve como basura.
function split(s) {
  if (!s || !(s.tramos || []).length) return '';
  const tramos = s.tramos.filter(t => (Number(t.v) || 0) > 0);
  const suma = tramos.reduce((a, t) => a + t.v, 0) || 1;
  return '<div class="split"><h3>' + esc(s.titulo || '') +
    (s.nota ? '<span class="mono">' + esc(s.nota) + '</span>' : '') + '</h3>' +
    '<div class="sbar">' + tramos.map(t => {
      const w = t.v / suma * 100;
      return '<b style="width:' + w.toFixed(1) + '%;background:' + (t.color || '#8a7f6a') +
        ';color:' + (t.texto || '#231b04') + '" title="' + esc(t.n + ' · ' + dinero(t.v)) + '">' +
        (w > 7 ? esc(t.n) : '') + '</b>';
    }).join('') + '</div></div>';
}

function barrasMes(b) {
  if (!b || !(b.valores || []).length) return '';
  const desde = b.desde || 1, hasta = b.hasta || 12;
  const max = Math.max.apply(null, b.valores.map(v => Math.abs(Number(v) || 0)).concat([1]));
  let h = '<div class="meses">';
  for (let m = desde; m <= hasta; m++) {
    const v = Number(b.valores[m - 1]) || 0;
    h += '<div><u class="' + (v < 0 ? 'neg' : '') + '" style="height:' +
      Math.max(1, Math.round(Math.abs(v) / max * 90)) + 'px" title="' +
      esc(MES3[m - 1] + ': ' + (b.formato === 'numero' ? numero(v) : dinero(v))) +
      '"></u><span>' + MES3[m - 1] + '</span></div>';
  }
  return h + '</div>';
}

// Una sección de renglones con su barra. Es lo que hace que se vea el peso de
// cada cosa sin tener que comparar cifras a mano.
function seccion(s) {
  const filas = s.filas || [];
  if (!filas.length && !s.barrasMes) return '';
  const max = Math.max.apply(null, filas.map(f => Math.abs(Number(f.valor) || 0)).concat([1]));

  let h = '<h2>' + esc(s.titulo) + (s.nota ? '<em>' + esc(s.nota) + '</em>' : '') + '</h2>' +
          '<div class="card">';
  if (s.barrasMes) h += barrasMes(s.barrasMes);
  filas.forEach(f => {
    const v = Number(f.valor) || 0;
    h += '<div class="row"><div class="rt">' +
      '<span class="rn">' + esc(f.nombre) +
        (f.detalle ? ' <i>' + esc(f.detalle) + '</i>' : '') + '</span>' +
      '<span class="rv mono"><b>' +
        esc(f.texto || (s.formato === 'numero' ? numero(v) : dinero(v))) + '</b>' +
        (f.extra ? ' · ' + (f.extraClase
          ? '<span class="' + esc(f.extraClase) + '">' + esc(f.extra) + '</span>'
          : esc(f.extra)) : '') +
      '</span></div>' +
      (s.sinBarra ? '' :
        '<div class="bar"><i class="' + (v < 0 ? 'neg' : '') + '" style="width:' +
        Math.max(1, Math.round(Math.abs(v) / max * 100)) + '%"></i></div>') +
      '</div>';
  });
  return h + '</div>';
}

function avisos(a) {
  if (!a || !(a.puntos || []).length) return '';
  return '<h2>' + esc(a.titulo || 'Lo que hay que revisar') +
    '<em>' + a.puntos.length + (a.puntos.length === 1 ? ' cosa' : ' cosas') + '</em></h2>' +
    '<div class="rev' + (a.grave ? ' mal' : '') + '"><ul>' +
    a.puntos.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div>';
}

// ---- la página ----
function tablero(d) {
  const bloques = (d.bloques || []).map(b => {
    if (b.tipo === 'split') return split(b);
    if (b.tipo === 'avisos') return avisos(b);
    if (b.tipo === 'seccion') return seccion(b);
    if (b.tipo === 'html') return b.html || '';
    return '';
  }).join('');

  return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(d.titulo) + (d.subtitulo ? ' · ' + esc(d.subtitulo) : '') + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600' +
    '&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">' +
    '<style>' + CSS + '</style></head><body><div class="wrap">' +
    (d.eyebrow ? '<div class="eyebrow">' + esc(d.eyebrow) + '</div>' : '') +
    '<h1>' + esc(d.titulo) + '</h1>' +
    (d.subtitulo ? '<div class="sub">' + esc(d.subtitulo) + '</div>' : '') +
    kpis(d.kpis) + bloques +
    '<div class="pie">' + esc(d.pie || '') +
    ' Para guardarlo en PDF: imprimir y elegir "Guardar como PDF".</div>' +
    '</div></body></html>';
}

// Página de error con el mismo aire, para no mandar al usuario a un HTML pelón
function tableroError(titulo, mensaje, pista) {
  return tablero({
    titulo: titulo || 'No se pudo armar el reporte',
    subtitulo: mensaje || '',
    bloques: pista ? [{ tipo: 'avisos', titulo: 'Qué revisar', grave: true, puntos: [pista] }] : [],
    pie: ''
  });
}

module.exports = { tablero, tableroError, esc, dinero, numero, pct, MES3, CSS };
