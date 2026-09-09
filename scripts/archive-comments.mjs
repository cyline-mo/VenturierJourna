import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const siteUrl = (process.env.VJ_SITE_URL || 'https://venturierjournal.com').replace(/\/$/, '');
const outputDirectory = join(process.cwd(), 'data', 'comments');
const articles = [
  ['the-new-farm-to-industry-transfer', '新时代的以农补工：从以农补工到以民补工'],
  ['fourth-fiscal-mobilization', '第四次财政总动员：当未来已经被提前使用'],
  ['july-2026-financial-data', '2026年7月金融数据：社融没有塌，私人信用需求正在退潮'],
  ['money-in-the-bank-consumption-defense', '2026年7月消费数据分析'],
  ['hidden-hunger-in-a-depression', '萧条中的隐性饥饿'],
  ['modern-sang-hongyang-question', '现代桑弘羊之问'],
  ['will-the-border-close-after-september-15', '9月15日以后，国门会不会关闭']
];

await mkdir(outputDirectory, { recursive: true });
const archivedAt = new Date().toISOString();

for (const [slug, title] of articles) {
  const response = await fetch(siteUrl + '/api/articles/' + slug + '/comments');
  if (!response.ok) {
    throw new Error('Cannot archive ' + slug + ': HTTP ' + response.status);
  }
  const payload = await response.json();
  const archive = {
    articleSlug: slug,
    articleTitle: title,
    source: siteUrl + '/articles/' + slug + '.html',
    archivedAt,
    comments: payload.comments || []
  };
  await writeFile(
    join(outputDirectory, slug + '.json'),
    JSON.stringify(archive, null, 2) + '\n',
    'utf8'
  );
}
