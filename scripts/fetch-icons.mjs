// Editorial, offline asset import only. Browsers never contact a favicon aggregation service.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';
import { decodeIco, isIco } from 'icojs';
const apps = readdirSync('data/apps')
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync('data/apps/' + f)))
  .filter((a) => a.published);
const overrides = JSON.parse(readFileSync('scripts/icons/overrides.json', 'utf8'));
const manifest = existsSync('data/icons.json') ? JSON.parse(readFileSync('data/icons.json', 'utf8')) : {};
const only = process.argv
  .find((x) => x.startsWith('--only='))
  ?.slice(7)
  .split(',');
const refresh = process.argv.includes('--refresh');
mkdirSync('public/icons', { recursive: true });
mkdirSync('data/private/icon-research', { recursive: true });
const requests = new Map();
const publicHost = async (u) => {
  const url = new URL(u);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password)
    throw new Error('HTTPS_PUBLIC_ONLY');
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) =>
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::|f[cd]|fe[89ab])/i.test(
        address,
      ),
    )
  )
    throw new Error('PRIVATE_ADDRESS_REJECTED');
};
async function download(input, max = 4 * 1024 * 1024) {
  if (requests.has(input)) return requests.get(input);
  const task = (async () => {
    let url = input;
    for (let redirects = 0; redirects < 5; redirects++) {
      await publicHost(url);
      const r = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VibecodingKRIconImporter/1.0)',
          Accept: 'image/avif,image/webp,image/png,image/svg+xml,text/html,*/*;q=0.8',
        },
      });
      if (r.status >= 300 && r.status < 400 && r.headers.has('location')) {
        url = new URL(r.headers.get('location'), url).href;
        await r.body?.cancel();
        continue;
      }
      if (!r.ok) throw new Error('HTTP_' + r.status);
      if (Number(r.headers.get('content-length')) > max) {
        await r.body?.cancel();
        throw new Error('TOO_LARGE');
      }
      const parts = [];
      let length = 0;
      for await (const part of r.body) {
        length += part.length;
        if (length > max) throw new Error('TOO_LARGE');
        parts.push(part);
      }
      return { bytes: Buffer.concat(parts), url, type: r.headers.get('content-type') || '' };
    }
    throw new Error('TOO_MANY_REDIRECTS');
  })();
  requests.set(input, task);
  return task;
}
const attrs = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [
      m[1].toLowerCase(),
      (m[2] ?? m[3] ?? m[4]).replaceAll('&amp;', '&'),
    ]),
  );
async function normalize(bytes) {
  if (isIco(bytes)) {
    const list = await decodeIco(bytes, 'image/png');
    const best = list.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!best) throw new Error('EMPTY_ICO');
    bytes = Buffer.from(best.buffer);
  }
  const head = bytes.subarray(0, 150).toString();
  if (/<svg|<\?xml/i.test(head)) {
    const xml = bytes.toString();
    if (/<!DOCTYPE|<script|<foreignObject|(?:xlink:)?href\s*=\s*["'](?!#|data:)/i.test(xml))
      throw new Error('UNSAFE_SVG');
  }
  let img = sharp(bytes, { limitInputPixels: 4096 * 4096, animated: false });
  const meta = await img.metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width < 12 ||
    meta.height < 12 ||
    meta.width / meta.height > 3 ||
    meta.height / meta.width > 3
  )
    throw new Error('NOT_AN_ICON');
  // Render vectors at sufficient density before resizing, including 24 px navigation SVGs.
  if (meta.format === 'svg')
    img = sharp(bytes, { density: 288, limitInputPixels: 4096 * 4096, animated: false });
  const output = await img
    .resize(96, 96, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .webp({ quality: 90 })
    .toBuffer();
  return { output, originalWidth: meta.width, originalHeight: meta.height };
}
let cursor = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (cursor < apps.length) {
      const a = apps[cursor++];
      if (only && !only.includes(a.slug)) continue;
      if (!refresh && manifest[a.slug]?.src && existsSync('public' + manifest[a.slug].src) && !only) continue;
      const candidates = [],
        failures = [];
      let pageUrl = a.officialUrl;
      if (overrides[a.slug])
        candidates.push({
          url: overrides[a.slug].url || overrides[a.slug].foundOn,
          path: overrides[a.slug].path,
          kind: 'official-product-asset',
          score: 1000,
          foundOn: overrides[a.slug].foundOn,
        });
      try {
        const page = await download(a.officialUrl);
        pageUrl = page.url;
        const html = page.bytes.toString();
        writeFileSync('data/private/icon-research/' + a.slug + '.html', html);
        for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
          const at = attrs(tag);
          if (
            !at.href ||
            !/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(at.rel || '')
          )
            continue;
          candidates.push({
            url: new URL(at.href, pageUrl).href,
            kind: 'official-page-icon',
            score: at.rel.includes('apple')
              ? 85
              : at.href.includes('.svg')
                ? 90
                : Math.min(parseInt(at.sizes) || 32, 128) / 4 + 45,
            foundOn: pageUrl,
          });
        }
      } catch (e) {
        failures.push('page:' + e.message);
      }
      const origin = new URL(pageUrl).origin;
      for (const [path, score] of [
        ['/apple-touch-icon.png', 40],
        ['/favicon.svg', 35],
        ['/favicon.ico', 30],
      ])
        candidates.push({ url: origin + path, kind: 'official-origin-icon', score, foundOn: pageUrl });
      const seen = new Set();
      const unique = candidates
        .sort((a, b) => b.score - a.score)
        .filter((c) => {
          if (seen.has(c.url)) return false;
          seen.add(c.url);
          return true;
        });
      let imported = false;
      for (const candidate of unique) {
        try {
          if (candidate.path && !/^scripts\/icons\/[a-z0-9-]+\.svg$/.test(candidate.path))
            throw new Error('INVALID_LOCAL_ICON_PATH');
          const asset = candidate.path
            ? { bytes: readFileSync(candidate.path), url: candidate.foundOn }
            : await download(candidate.url, 2 * 1024 * 1024);
          const { output, originalWidth, originalHeight } = await normalize(asset.bytes);
          const hash = createHash('sha256').update(output).digest('hex').slice(0, 12),
            src = '/icons/' + a.slug + '-' + hash + '.webp';
          writeFileSync('public' + src, output);
          manifest[a.slug] = {
            src,
            sourceUrl: asset.url,
            foundOn: candidate.foundOn,
            kind: candidate.kind,
            checkedOn: new Date().toISOString().slice(0, 10),
            originalWidth,
            originalHeight,
            sha256: createHash('sha256').update(output).digest('hex'),
          };
          imported = true;
          console.log(a.slug, 'IMPORTED', originalWidth + 'x' + originalHeight);
          break;
        } catch (e) {
          failures.push(candidate.url + ':' + e.message);
          if (candidate.kind === 'official-product-asset')
            console.warn(a.slug, 'PRODUCT_OVERRIDE_FAILED', e.message);
        }
      }
      if (!imported) {
        manifest[a.slug] ??= { src: null, checkedOn: new Date().toISOString().slice(0, 10) };
        manifest[a.slug].failures = failures;
        console.log(a.slug, 'FALLBACK');
      }
      writeFileSync(
        'data/icons.json',
        JSON.stringify(
          Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))),
          null,
          2,
        ) + '\n',
      );
    }
  }),
);
console.log(`${apps.filter((a) => manifest[a.slug]?.src).length}/${apps.length} local icons`);
