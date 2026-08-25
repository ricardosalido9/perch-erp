// Saca los datos fiscales de una Constancia de Situación Fiscal en PDF.
// Los PDFs del SAT traen el texto embebido, así que se puede leer sin OCR:
// se descomprimen los streams del PDF y se extrae el texto de los operadores Tj / TJ.
const zlib = require('zlib');

// Algunos PDFs codifican el stream en ASCII85 antes de comprimirlo
function desAscii85(txt) {
  let s = txt.replace(/\s/g, '');
  const i = s.indexOf('<~'); if (i !== -1) s = s.slice(i + 2);
  const j = s.indexOf('~>'); if (j !== -1) s = s.slice(0, j);
  const out = [];
  let grupo = [];
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === 'z' && grupo.length === 0) { out.push(0, 0, 0, 0); continue; }
    const v = c.charCodeAt(0) - 33;
    if (v < 0 || v > 84) continue;
    grupo.push(v);
    if (grupo.length === 5) {
      let n = 0;
      for (const g of grupo) n = n * 85 + g;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      grupo = [];
    }
  }
  if (grupo.length) {
    const falta = 5 - grupo.length;
    for (let k = 0; k < falta; k++) grupo.push(84);
    let n = 0;
    for (const g of grupo) n = n * 85 + g;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    for (let k = 0; k < 4 - falta; k++) out.push(bytes[k]);
  }
  return Buffer.from(out);
}

function textoDelPdf(buf) {
  const partes = [];
  const bin = buf.toString('latin1');
  const rx = /stream\r?\n?([\s\S]*?)endstream/g;
  let m;
  while ((m = rx.exec(bin)) !== null) {
    let datos = Buffer.from(m[1], 'latin1');
    // Puede venir en ASCII85 y encima comprimido con Flate
    const cabeza = datos.slice(0, 4).toString('latin1');
    if (/^<~/.test(cabeza) || /^[!-u]{4}/.test(cabeza)) {
      const a85 = desAscii85(datos.toString('latin1'));
      if (a85.length) {
        try { datos = zlib.inflateSync(a85); }
        catch (e) { try { datos = zlib.inflateRawSync(a85); } catch (e2) { datos = a85; } }
      }
    }
    if (datos.indexOf('Tj') === -1 && datos.indexOf('TJ') === -1) {
      try { datos = zlib.inflateSync(datos); }
      catch (e) { try { datos = zlib.inflateRawSync(datos); } catch (e2) { /* sin comprimir */ } }
    }
    const t = datos.toString('latin1');
    if (t.indexOf('Tj') === -1 && t.indexOf('TJ') === -1) continue;
    partes.push(t);
  }
  let out = '';
  partes.forEach(p => {
    // (texto) Tj    y    [(a) -2 (b)] TJ
    const r1 = /\((?:\\.|[^\\()])*\)/g;
    let x;
    while ((x = r1.exec(p)) !== null) {
      let s = x[0].slice(1, -1);
      s = s.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' }[c] || c));
      s = s.replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
      out += s + ' ';
    }
    out += '\n';
  });
  // El SAT usa acentos en Latin-1 y a veces UTF-8
  try {
    const utf = Buffer.from(out, 'latin1').toString('utf8');
    if (!/\uFFFD/.test(utf)) out = utf;
  } catch (e) { /* se queda como está */ }
  return out.replace(/[ \t]+/g, ' ');
}

function limpia(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Etiquetas que usa el SAT en la constancia. El valor de un campo termina donde
// empieza la siguiente etiqueta, así que cortar por esta lista es confiable.
const ETIQUETAS_SAT = [
  'RFC', 'CURP', 'Nombre (s)', 'Primer Apellido', 'Segundo Apellido',
  'Denominación o Razón Social', 'Denominacion o Razon Social', 'Régimen Capital', 'Regimen Capital',
  'Nombre Comercial', 'Fecha de inicio de operaciones', 'Estatus en el padrón', 'Estatus en el padron',
  'Fecha de último cambio de estado', 'Situación del contribuyente', 'Situacion del contribuyente',
  'Código Postal', 'Codigo Postal', 'Tipo de Vialidad', 'Nombre de Vialidad',
  'Número Exterior', 'Numero Exterior', 'Número Interior', 'Numero Interior',
  'Nombre de la Colonia', 'Nombre de la Localidad', 'Nombre del Municipio o Demarcación Territorial',
  'Nombre del Municipio', 'Nombre de la Entidad Federativa', 'Entre Calle', 'Y Calle',
  'Correo Electrónico', 'Correo Electronico', 'Al día', 'Régimen', 'Regimen',
  'Fecha de alta', 'Fecha Inicio', 'Fecha Fin', 'Obligación', 'Obligacion', 'Descripción', 'Descripcion',
  'Vencimiento', 'Actividad Económica', 'Actividad Economica', 'Orden', 'Porcentaje',
  'REGIMENES', 'OBLIGACIONES', 'DATOS', 'CONSTANCIA', 'Lugar y Fecha', 'idCIF', 'Página', 'Pagina'
];
function cortaEnSiguienteEtiqueta(v, etiquetaActual) {
  let mejor = -1;
  ETIQUETAS_SAT.forEach(e => {
    if (etiquetaActual && norm2(e) === norm2(etiquetaActual)) return;
    const i = v.toLowerCase().indexOf(e.toLowerCase());
    if (i > 0 && (mejor === -1 || i < mejor)) mejor = i;
  });
  return mejor > 0 ? v.slice(0, mejor) : v;
}
function norm2(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Busca el valor que sigue a una etiqueta, en la misma línea o en la siguiente
function tras(texto, etiquetas, corte) {
  for (const et of etiquetas) {
    const rx = new RegExp(et.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*([^\\n]{2,160})', 'i');
    const m = texto.match(rx);
    if (m) {
      let v = cortaEnSiguienteEtiqueta(limpia(m[1]), et);
      v = limpia(v.replace(/^[:\-–]\s*/, '').replace(/[:\-–]\s*$/, ''));
      if (v) return v;
    }
  }
  return '';
}

function leerCSF(buf) {
  const t = textoDelPdf(buf);
  if (!t || t.length < 40) {
    return { ok: false, motivo: 'El PDF no trae texto (parece escaneado). Captura los datos a mano.' };
  }
  const CORTES = ['RFC', 'CURP', 'Nombre', 'Denominación', 'Régimen', 'Fecha', 'Código Postal',
                  'Tipo de', 'Situación', 'Datos', 'Correo', 'Teléfono', 'Actividad'];

  // RFC: 12 (moral) o 13 (física) caracteres
  let rfc = '';
  const mr = t.match(/\bRFC\s*:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/i) ||
             t.match(/\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/);
  if (mr) rfc = mr[1].toUpperCase();

  const esMoral = rfc.length === 12;
  const razon = limpia(
    tras(t, esMoral ? ['Denominación o Razón Social', 'Denominacion o Razon Social', 'Denominación/Razón Social']
                    : ['Nombre \\(s\\)', 'Nombre'], CORTES) || '');
  // En persona física el SAT parte el nombre en tres campos
  let nombre = razon;
  if (!esMoral) {
    const ap1 = tras(t, ['Primer Apellido'], CORTES);
    const ap2 = tras(t, ['Segundo Apellido'], CORTES);
    const nom = tras(t, ['Nombre \\(s\\)'], CORTES);
    const junto = limpia([nom, ap1, ap2].filter(Boolean).join(' '));
    if (junto.length > 3) nombre = junto;
  }
  // El régimen fiscal aparece en la sección REGIMENES; "Régimen Capital" es otra cosa
  let regimen = '';
  const secc = t.split(/REG[IÍ]MENES/i)[1] || '';
  if (secc) regimen = tras(secc, ['Régimen', 'Regimen'], ['Fecha', 'Obligaciones', 'Situación']);
  if (!regimen) {
    const mr2 = t.match(/R[ée]gimen\s*:?\s*((?:General|Simplificado|Incorporaci[óo]n|Sueldos|Actividades|Arrendamiento|Personas)[^\n]{0,70})/i);
    if (mr2) regimen = limpia(mr2[1]);
  }
  regimen = limpia(regimen.replace(/^Capital\s*:?\s*/i, ''));
  const cp = (t.match(/C[óo]digo Postal\s*:?\s*(\d{5})/i) || [])[1] || '';
  const uno = (etqs) => limpia(tras(t, etqs, CORTES) || '');
  const calle  = uno(['Nombre de Vialidad', 'Vialidad']);
  const numExt = (tras(t, ['Número Exterior', 'Numero Exterior'], CORTES).match(/^[\w-]+/) || [''])[0];
  const numInt = (tras(t, ['Número Interior', 'Numero Interior'], CORTES).match(/^[\w-]+/) || [''])[0];
  const col    = uno(['Nombre de la Colonia', 'Colonia']);
  const mun    = uno(['Nombre del Municipio o Demarcación Territorial', 'Nombre del Municipio', 'Municipio']);
  const edo    = uno(['Nombre de la Entidad Federativa', 'Entidad Federativa']);
  const direccion = limpia([calle, numExt && '#' + numExt, numInt && 'int ' + numInt, col, mun, edo, cp]
    .filter(Boolean).join(', '));

  return {
    ok: !!rfc,
    motivo: rfc ? '' : 'No se encontró un RFC en el PDF.',
    datos: {
      'RFC': rfc,
      'Razón Social': nombre || razon,
      'Tipo de Persona': rfc ? (esMoral ? 'Moral' : 'Física') : '',
      'Régimen fiscal': regimen,
      'Dirección fiscal': direccion,
      'Código Postal': cp
    }
  };
}

module.exports = { leerCSF, textoDelPdf };
