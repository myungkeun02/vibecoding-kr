import { getApp, priceLabel } from './apps';
import type { App } from './schema';
import { publicServiceRows, serviceHref, type Service } from './services';
import { servicePricing } from './service-schema';
import { buildCounts } from './db';
export function catalogApp(s: Service): App | null {
  const base = s.catalog_slug ? getApp(s.catalog_slug) : undefined;
  if (!base || !s.guide) return null;
  const samePricing = s.pricing === base.pricing.model;
  return {
    ...base,
    ...s.guide,
    nameKo: s.name,
    officialUrl: s.website_url,
    category: s.category,
    summary: s.tagline,
    priceMonthly: samePricing ? base.priceMonthly : s.pricing === 'free' ? 0 : null,
    pricing: samePricing
      ? base.pricing
      : {
          ...base.pricing,
          model: s.pricing as App['pricing']['model'],
          plan: '확인 필요',
          billing: 'unknown',
          monthlyNative: null,
          annualMonthlyNative: null,
          oneTimeNative: null,
        },
  };
}
export function catalogEntry(s: Service, counts: Record<string, number> = {}) {
  const base = s.catalog_slug ? getApp(s.catalog_slug) : undefined,
    app = catalogApp(s);
  return {
    ...s,
    slug: s.catalog_slug || s.id,
    nameKo: s.name,
    summary: s.tagline,
    href: serviceHref(s),
    originalName: base?.name,
    aliases: base ? [base.name, ...base.aliases, ...base.tags] : [],
    types: base?.types || ['saas'],
    verdict: s.guide?.verdict || null,
    checkedOn: s.revision > 1 ? s.updated_at : base?.checkedOn || s.published_at || s.created_at,
    priceMonthly: app ? app.priceMonthly : s.pricing === 'free' ? 0 : null,
    pricingLabel: app ? priceLabel(app) : servicePricing[s.pricing],
    reviewCount: counts[s.catalog_slug || s.id] || 0,
  };
}
export type CatalogEntry = ReturnType<typeof catalogEntry>;
export async function catalog(params: URLSearchParams = new URLSearchParams(), size = 20) {
  const counts = await buildCounts();
  const entries = (await publicServiceRows()).map((s) => catalogEntry(s, counts));
  const q = (params.get('q') || '').trim().slice(0, 100).toLowerCase().replace(/\s/g, '');
  const results = entries.filter(
    (s) =>
      (!q || [s.name, s.tagline, ...s.aliases].join(' ').toLowerCase().replace(/\s/g, '').includes(q)) &&
      (!params.get('category') || s.category === params.get('category')) &&
      (!params.get('verdict') || s.verdict === params.get('verdict')) &&
      (!params.get('type') || s.types.includes(params.get('type') as any)) &&
      (!params.get('price') || s.pricing === params.get('price')) &&
      (!params.get('guide') ||
        (params.get('guide') === 'available'
          ? Boolean(s.guide)
          : params.get('guide') === 'none'
            ? !s.guide
            : true)),
  );
  results.sort((a, b) =>
    params.get('sort') === 'price'
      ? (a.priceMonthly ?? Infinity) - (b.priceMonthly ?? Infinity) || a.name.localeCompare(b.name, 'ko')
      : params.get('sort') === 'newest'
        ? b.checkedOn.localeCompare(a.checkedOn) || a.name.localeCompare(b.name, 'ko')
        : b.reviewCount - a.reviewCount ||
          b.checkedOn.localeCompare(a.checkedOn) ||
          a.name.localeCompare(b.name, 'ko'),
  );
  const pages = Math.max(1, Math.ceil(results.length / size)),
    page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  return {
    items: results.slice((page - 1) * size, page * size),
    total: results.length,
    page,
    pages,
    all: entries,
    categories: Object.fromEntries(
      entries.map((s) => [s.category, entries.filter((x) => x.category === s.category).length]),
    ),
  };
}
