// Copia el menú (partials/header.html) y el pie (partials/footer.html) en las 5 páginas
// y marca la página actual con aria-current="page".
// Uso, desde la carpeta del proyecto:  node tools/sync.mjs   (sin dependencias)
// Edita solo los archivos de partials/; lo que esté entre <!-- @header --> y <!-- /@header -->
// (o @footer) en cada página se reemplaza.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n').trim();

// página → href con el que la enlaza el menú
const PAGES = {
  'index.html': './',
  'servicios.html': 'servicios.html',
  'sobre-roxana.html': 'sobre-roxana.html',
  'charlas.html': 'charlas.html',
  'reservar.html': 'reservar.html',
};
const PARTS = ['header', 'footer'];
const parts = Object.fromEntries(PARTS.map((n) => [n, read(`partials/${n}.html`)]));

for (const [page, href] of Object.entries(PAGES)) {
  let html = read(page) + '\n';
  for (const name of PARTS) {
    const re = new RegExp(`<!-- @${name} -->[\\s\\S]*?<!-- /@${name} -->`);
    if (!re.test(html)) throw new Error(`${page}: faltan los marcadores <!-- @${name} --> … <!-- /@${name} -->`);
    const body = parts[name].replaceAll(`href="${href}"`, `href="${href}" aria-current="page"`);
    html = html.replace(re, () => `<!-- @${name} -->\n${body}\n<!-- /@${name} -->`);
  }
  writeFileSync(new URL(page, root), html);
  console.log('ok', page);
}
