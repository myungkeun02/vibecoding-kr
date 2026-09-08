import { readFileSync, readdirSync } from 'node:fs';
import { AppSchema, type App } from './schema';
export const categories: { slug: string; name: string; emoji: string }[] = JSON.parse(
  readFileSync('data/categories.json', 'utf8'),
);
export const apps: App[] = readdirSync('data/apps')
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const a = AppSchema.parse(JSON.parse(readFileSync('data/apps/' + f, 'utf8')));
    if (f !== a.slug + '.json') throw new Error('slug mismatch');
    return a;
  })
  .filter((a) => a.published);
export const getApp = (slug: string) => apps.find((a) => a.slug === slug);
export const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name || slug;
export const searchKey = (a: App) =>
  [a.name, a.nameKo, ...a.aliases, ...a.tags, a.summary].join(' ').toLowerCase().replace(/\s/g, '');
export function filterApps(params: URLSearchParams, counts: Record<string, number> = {}) {
  const q = (params.get('q') || '').toLowerCase().replace(/\s/g, '');
  const results = apps.filter(
    (a) =>
      (!q || searchKey(a).includes(q)) &&
      (!params.get('category') || a.category === params.get('category')) &&
      (!params.get('verdict') || a.verdict === params.get('verdict')) &&
      (!params.get('type') || a.types.includes(params.get('type') as any)) &&
      (!params.get('price') || a.pricing.model === params.get('price')),
  );
  results.sort((a, b) =>
    params.get('sort') === 'price'
      ? (a.priceMonthly ?? Infinity) - (b.priceMonthly ?? Infinity)
      : params.get('sort') === 'newest'
        ? b.checkedOn.localeCompare(a.checkedOn) || a.name.localeCompare(b.name)
        : (counts[b.slug] || 0) - (counts[a.slug] || 0) ||
          (['notion', 'slack', 'obsidian', 'microsoft-excel'].includes(b.slug) ? 1 : 0) -
            (['notion', 'slack', 'obsidian', 'microsoft-excel'].includes(a.slug) ? 1 : 0) ||
          a.name.localeCompare(b.name),
  );
  const pages = Math.max(1, Math.ceil(results.length / 20));
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1));
  return { items: results.slice((page - 1) * 20, page * 20), total: results.length, page, pages };
}
export const priceLabel = (a: App) =>
  a.pricing.model === 'free'
    ? '무료'
    : a.pricing.billing === 'one-time'
      ? a.pricing.oneTimeNative === null
        ? '한 번 구매 · 가격 확인 필요'
        : `${a.pricing.currency} ${a.pricing.oneTimeNative.toLocaleString()} · 한 번 구매`
      : a.priceMonthly === null
        ? '가격 확인 필요'
        : a.priceMonthly === 0
          ? '무료'
          : `₩${a.priceMonthly.toLocaleString()}/월`;
export const related = (a: App) =>
  [...a.relatedSlugs.map(getApp).filter(Boolean), ...apps.filter((x) => x.category === a.category), ...apps]
    .filter((x, i, arr) => x && x.slug !== a.slug && arr.findIndex((y) => y?.slug === x.slug) === i)
    .slice(0, 3) as App[];
