import type { APIRoute } from 'astro';
import { apps, categories } from '../lib/apps';
import { all } from '../lib/db';
import { absolute } from '../lib/config';
export const GET: APIRoute = async () => {
  const urls = [
    '/',
    '/community',
    '/stats',
    '/rebuild-prompt',
    ...apps.map((a) => '/' + a.slug),
    ...categories.map((c) => '/category/' + c.slug),
    ...(await all("SELECT id FROM posts WHERE status='active'")).map((p) => '/community/' + p.id),
  ];
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls.map((path) => '<url><loc>' + absolute(path).replace(/&/g, '&amp;') + '</loc></url>').join('') +
      '</urlset>',
    { headers: { 'Content-Type': 'application/xml;charset=utf-8' } },
  );
};
