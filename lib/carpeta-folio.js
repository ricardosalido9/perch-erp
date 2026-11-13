// ¿Cuál es LA carpeta de un folio?
//
// 12 nov. Camila subió el comprobante de finiquito de la S15-26 y le
// "desaparecieron" la factura y el primer comprobante. No se borró nada: el ERP
// se había creado **otra** carpeta.
//
// La de ella se llama `S15-26 Judith Gonzalez`. El ERP armaba el nombre con el
// cliente como está escrito en Ventas —en MAYÚSCULAS— y buscaba un nombre
// idéntico: `S15-26 JUDITH GONZALEZ`. Para Drive, al crear, no es el mismo
// nombre. Así que no lo encontraba, creaba una carpeta nueva, y a partir de ese
// momento el panel enseñaba la nueva —con un solo archivo— mientras los demás
// seguían en la de siempre. Pasó con S13-26, S15-26 y S19-26 el mismo día.
//
// La carpeta buena ya estaba escrita: la hoja **CxC** tiene una columna **Link**,
// una por folio. En los folios de enero trae la URL completa
// (`drive.google.com/drive/folders/16AfTZ…`); de cierto punto en adelante
// dejaron de pegar el link y quedó solo el nombre, como texto. Y algunas, como
// la S14-26, están vacías.
//
// Entonces el orden para decidir es:
//
//   1. La URL de la columna Link de CxC. Si está, ésa es, sin discusión.
//   2. El nombre de esa columna, comparado **sin acentos y sin mayúsculas**.
//   3. El nombre que arma el ERP (`folio + cliente`), igual de flexible.
//   4. Cualquier carpeta que EMPIECE con el folio.
//   5. Solo si no hay ninguna, se crea — y se anota su link en CxC para que de
//      ahí en adelante todos abran la misma.
const core = require('./core');

const txt = (v) => String(v == null ? '' : v).trim();
// Para comparar nombres de carpeta como los compara una persona: sin acentos,
// sin mayúsculas y sin dobles espacios.
function norm(s) {
  return txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
function limpiaNombre(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
// El id de carpeta que viene dentro de un link de Drive
function idDeCarpeta(s) {
  const m = txt(s).match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  // A veces pegan solo el id
  const solo = txt(s);
  return /^[A-Za-z0-9_-]{25,}$/.test(solo) ? solo : '';
}

// Lo que CxC dice de este folio: { valor, fila, col } — valor puede ser una URL
// o un nombre, y la fila sirve para poder escribir el link de vuelta.
async function loQueDiceCxC(folio) {
  try {
    const cfg = core.areaCfg ? await core.areaCfg('fin_cxc') : core.SHEETS.fin_cxc;
    if (!cfg || !cfg.id) return null;
    const hoja = await core.resolveSheetName(cfg);
    const values = await core.readRange(cfg.id, hoja);
    if (!values || !values.length) return null;
    const H = (values[0] || []).map(h => txt(h));
    const iRef = H.findIndex(h => /^(no\.? de referencia|folio)$/i.test(norm(h)));
    const iLink = H.findIndex(h => norm(h) === 'link');
    if (iRef === -1 || iLink === -1) return null;
    const f = norm(folio);
    for (let r = 1; r < values.length; r++) {
      if (norm((values[r] || [])[iRef]) === f) {
        return { valor: txt((values[r] || [])[iLink]), fila: r + 1,
                 col: iLink, id: cfg.id, hoja };
      }
    }
    return null;
  } catch (e) { return null; }
}

// Deja anotado el link de la carpeta en CxC, para que el resto del equipo abra
// la misma. **Solo si la celda está vacía**: si ya dice algo —un nombre, otra
// liga, una fórmula— no se toca.
async function anotarEnCxC(donde, url) {
  if (!donde || !url || txt(donde.valor) !== '') return false;
  try {
    const letra = (i) => {
      let s = '', n = i + 1;
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    const celda = "'" + donde.hoja + "'!" + letra(donde.col) + donde.fila;
    await core.writeCells(donde.id, [{ range: celda, values: [[url]] }]);
    return true;
  } catch (e) { return false; }
}

// Busca carpetas cuyo nombre EMPIECE con el folio y devuelve todas, para poder
// elegir con calma y para poder avisar cuando hay más de una.
async function candidatas(drive, folio) {
  const f = norm(folio);
  const esDelFolio = (nombre) => {
    const n = norm(nombre);
    if (!f || n.indexOf(f) !== 0) return false;
    const sig = n.charAt(f.length);
    return sig === '' || sig === ' ' || sig === '-' || sig === '_';
  };
  try {
    const r = await drive.files.list({
      q: "name contains '" + folio.replace(/'/g, "\\'") + "' and mimeType = " +
         "'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id, name, webViewLink)', pageSize: 50,
      supportsAllDrives: true, includeItemsFromAllDrives: true
    });
    return (r.data.files || []).filter(x => esDelFolio(x.name));
  } catch (e) { return []; }
}

// El corazón: decidir la carpeta. `crear` solo lo pide quien va a subir algo.
async function resolver(drive, folio, cliente, opciones) {
  const op = opciones || {};
  const resultado = { carpeta: null, creada: false, deDonde: '', otras: [], cxc: null };
  if (!folio) return resultado;

  const dice = await loQueDiceCxC(folio);
  resultado.cxc = dice;

  // 1) La URL escrita en CxC manda
  const idEscrito = dice ? idDeCarpeta(dice.valor) : '';
  if (idEscrito) {
    try {
      const r = await drive.files.get({
        fileId: idEscrito, fields: 'id, name, webViewLink, trashed',
        supportsAllDrives: true
      });
      if (r.data && !r.data.trashed) {
        resultado.carpeta = r.data;
        resultado.deDonde = 'el link que trae CxC';
        return resultado;
      }
    } catch (e) { /* el link ya no sirve: se sigue buscando */ }
  }

  const lista = await candidatas(drive, folio);
  resultado.otras = lista;

  const elige = (nombre) => {
    const n = norm(nombre);
    return lista.filter(x => norm(x.name) === n)[0] || null;
  };

  // 2) El NOMBRE que trae CxC, comparado sin mayúsculas ni acentos
  if (dice && txt(dice.valor) && !idEscrito) {
    const porNombre = elige(dice.valor);
    if (porNombre) {
      resultado.carpeta = porNombre;
      resultado.deDonde = 'el nombre que trae CxC';
      return resultado;
    }
  }

  // 3) El nombre que arma el ERP
  const nombreErp = limpiaNombre(folio + ' ' + (cliente || '')) || folio;
  const porErp = elige(nombreErp);
  if (porErp) {
    resultado.carpeta = porErp;
    resultado.deDonde = 'su nombre';
    return resultado;
  }

  // 4) Cualquiera que empiece con el folio. Si hay varias, la que tenga más
  //    archivos: la que la gente ha estado usando.
  if (lista.length) {
    let mejor = lista[0], masArchivos = -1;
    for (const c of lista) {
      let cuantos = 0;
      try {
        const r = await drive.files.list({
          q: "'" + c.id + "' in parents and trashed = false",
          fields: 'files(id)', pageSize: 100,
          supportsAllDrives: true, includeItemsFromAllDrives: true
        });
        cuantos = (r.data.files || []).length;
      } catch (e) { cuantos = 0; }
      if (cuantos > masArchivos) { masArchivos = cuantos; mejor = c; }
    }
    resultado.carpeta = mejor;
    resultado.deDonde = lista.length > 1
      ? 'es la que más archivos tiene de las ' + lista.length + ' que empiezan con ' + folio
      : 'empieza con el folio';
    return resultado;
  }

  // 5) No hay ninguna. Se crea solo si alguien va a subir algo.
  if (!op.crear || !op.parentId) return resultado;
  const creada = await drive.files.create({
    requestBody: {
      name: limpiaNombre(dice && txt(dice.valor) && !idEscrito ? dice.valor : nombreErp),
      mimeType: 'application/vnd.google-apps.folder', parents: [op.parentId]
    },
    fields: 'id, name, webViewLink', supportsAllDrives: true
  });
  resultado.carpeta = creada.data;
  resultado.creada = true;
  resultado.deDonde = 'se acaba de crear';
  // Que quede anotada para todos
  const url = creada.data.webViewLink ||
    ('https://drive.google.com/drive/folders/' + creada.data.id);
  resultado.anotada = await anotarEnCxC(dice, url);
  return resultado;
}

module.exports = { resolver, candidatas, loQueDiceCxC, anotarEnCxC, idDeCarpeta, norm };
