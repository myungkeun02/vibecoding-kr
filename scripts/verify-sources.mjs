import fs from 'node:fs';
const files = fs.readdirSync('data/apps').filter((x) => x.endsWith('.json'));
const out = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++],
        a = JSON.parse(fs.readFileSync('data/apps/' + file));
      try {
        const r = await fetch(a.officialUrl, {
          signal: AbortSignal.timeout(20000),
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; CatalogReview/1.0)' },
        });
        const html = await r.text();
        const title =
          html
            .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
            ?.replace(/<[^>]+>/g, ' ')
            .trim() || '';
        const text = html
          .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const result = {
          slug: a.slug,
          url: a.officialUrl,
          finalUrl: r.url,
          status: r.status,
          title,
          excerpt: text.slice(0, 4500),
          checkedOn: '2026-09-08',
        };
        out.push(result);
        console.log(a.slug, r.status, title.slice(0, 100));
      } catch (e) {
        out.push({ slug: a.slug, url: a.officialUrl, status: 0, error: e.message, checkedOn: '2026-09-08' });
        console.log(a.slug, 'FETCH_FAILED');
      }
    }
  }),
);
fs.writeFileSync(
  'docs/source-evidence.json',
  JSON.stringify(
    out.sort((a, b) => a.slug.localeCompare(b.slug)),
    null,
    2,
  ),
);
