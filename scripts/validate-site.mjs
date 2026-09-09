import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const articleDirectory = join(root, 'articles');
const articleFiles = (await readdir(articleDirectory)).filter(name => name.endsWith('.html'));

if (articleFiles.length !== 7) {
  throw new Error('Expected 7 public article pages, found ' + articleFiles.length);
}

for (const name of articleFiles) {
  const html = await readFile(join(articleDirectory, name), 'utf8');
  const mainEnd = html.indexOf('</main>');
  const salon = html.indexOf('id="salon"');
  const footer = html.indexOf('<footer>');
  if (mainEnd < 0 || salon < mainEnd || footer < salon) {
    throw new Error(name + ': salon must be visible between the article and footer');
  }
  for (const required of ['article-salon.css', 'article-salon.js', 'article-analytics.js']) {
    if (!html.includes(required)) throw new Error(name + ': missing ' + required);
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(name + ': duplicate ids: ' + [...new Set(duplicates)].join(', '));
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  for (const script of inlineScripts) new Function(script[1]);
}

const index = await readFile(join(root, 'index.html'), 'utf8');
if (!index.includes('articles/will-the-border-close-after-september-15.html')) {
  throw new Error('Homepage is missing the latest article');
}
for (const script of index.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  new Function(script[1]);
}

console.log('Validated ' + articleFiles.length + ' articles, salon placement and inline scripts.');
