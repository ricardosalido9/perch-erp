// Cómo se escribe el material de un mueble en una sola línea.
//
// Camila, 10 nov: "agrego la tela, pero me sigue sin aparecer en el PDF de las
// cotizaciones". No era que no se guardara: la columna **Tela** nunca entraba
// en el texto que arma `quote.js`, que solo juntaba Material + Material Extra.
// Así que la cotización decía "Rosamorada · Tela" —el tipo— y nunca "Floriana
// Beige" —cuál—, que es justo el dato que el cliente aprueba y que producción
// necesita para pedir la pieza.
//
// Y al revés, en la tarjeta del panel se pegaban los dos a lo bruto, así que una
// tela que YA se llama "Tela Marsa Beige" salía como "Tela Tela Marsa Beige".
//
// Esta función es la única manera de escribirlo, y la usan el servidor y el
// panel para que la pantalla y el PDF no puedan decir cosas distintas.

// "NA", "no aplica", "ninguno", "-" quieren decir que no hay segundo material.
const VACIO = /^(n\/?a|no aplica|ninguno|ninguna|no|-|)$/i;

// Lo que se captura en la columna Tela a veces viene como "Sí - Floriana Beige".
function limpiaTela(tela) {
  return String(tela == null ? '' : tela).trim().replace(/^s[ií]\s*[-–—:]\s*/i, '').trim();
}

// Igual que el `norm` del panel, espacios dobles incluidos: las dos copias de
// esta cuenta tienen que dar lo mismo.
const plano = (s) => String(s == null ? '' : s).trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

// "Tela" + "Floriana Beige"      → "Tela Floriana Beige"
// "Tela" + "Tela Marsa Beige"    → "Tela Marsa Beige"   (no se repite la palabra)
// "Piel" + ""                    → "Piel"
// ""     + "Floriana Beige"      → "Floriana Beige"     (el dato no se tira)
function juntaExtra(extra, tela) {
  const ext = String(extra == null ? '' : extra).trim();
  const tel = limpiaTela(tela);
  const hayExt = ext && !VACIO.test(ext);
  const hayTel = tel && !VACIO.test(tel);
  if (hayExt && hayTel) {
    // Si el nombre de la tela ya empieza con la palabra del segundo material,
    // esa palabra ya está dicha.
    const pe = plano(ext), pt = plano(tel);
    if (pt === pe || pt.indexOf(pe + ' ') === 0) return tel;
    return ext + ' ' + tel;
  }
  if (hayExt) return ext;
  if (hayTel) return tel;
  return '';
}

// "Rosamorada" + "Tela" + "Floriana Beige" → "Rosamorada · Tela Floriana Beige"
function juntaMaterial(material, extra, tela) {
  const mat = String(material == null ? '' : material).trim();
  const ext = juntaExtra(extra, tela);
  return [mat && !VACIO.test(mat) ? mat : '', ext].filter(Boolean).join(' · ');
}

// ¿Dice que lleva tela pero no dice cuál? Es lo que el panel marca en ámbar.
function faltaDecirCual(extra, tela) {
  const ext = String(extra == null ? '' : extra).trim();
  return /^(tela|piel|textil)$/i.test(ext) && !limpiaTela(tela);
}

module.exports = { juntaMaterial, juntaExtra, limpiaTela, faltaDecirCual };
