import { readFileSync, readdirSync } from 'node:fs';
import { AppSchema } from '../src/lib/schema';
const cats = JSON.parse(readFileSync('data/categories.json', 'utf8'));
const files = readdirSync('data/apps').filter((f) => f.endsWith('.json'));
const reserved = new Set([
  'api',
  'community',
  'login',
  'signup',
  'admin',
  'me',
  'auth',
  'stats',
  'privacy',
  'terms',
  'notifications',
  'reset',
  'onboarding',
  'verify-email',
  'forgot',
  'suggest',
  'unsubscribe',
  'rebuild-prompt',
  'category',
  'profile',
  'media',
]);
const apps = files.map((f) => {
  const a = AppSchema.parse(JSON.parse(readFileSync('data/apps/' + f, 'utf8')));
  if (a.slug + '.json' !== f || reserved.has(a.slug) || !cats.some((c: any) => c.slug === a.category))
    throw new Error('Invalid catalog route ' + f);
  return a;
});
for (const a of apps) {
  for (const s of a.relatedSlugs)
    if (s === a.slug || !apps.some((b) => b.slug === s)) throw new Error('Invalid relation ' + a.slug);
  if (a.published && !a.sources.some((s) => s.status === 'verified'))
    throw new Error('Unverified publication ' + a.slug);
  if (
    a.priceMonthly !== null &&
    a.priceMonthly > 0 &&
    (a.pricing.source.status !== 'verified' ||
      ['one-time', 'usage-based', 'contact-sales'].includes(a.pricing.model))
  )
    throw new Error('Invalid monthly price ' + a.slug);
}
if (apps.filter((a) => a.published).length < 100 || cats.length < 12)
  throw new Error('Catalog below requested scope');
for (const s of ['slack', 'notion', 'obsidian', 'microsoft-excel'])
  if (!apps.some((a) => a.slug === s && a.published)) throw new Error('Required tool missing');
console.log(
  `${apps.filter((a) => a.published).length} published tools, ${apps.length} total entries, ${cats.length} categories validated.`,
);
