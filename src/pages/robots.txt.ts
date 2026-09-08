import type { APIRoute } from 'astro';
import { absolute } from '../lib/config';
export const GET: APIRoute = () =>
  new Response(
    'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /me\nDisallow: /notifications\nDisallow: /auth/\nDisallow: /login\nDisallow: /signup\nDisallow: /onboarding\nDisallow: /verify-email\nDisallow: /reset\nDisallow: /forgot\nDisallow: /unsubscribe\nDisallow: /community/new\nDisallow: /suggest\nSitemap: ' +
      absolute('/sitemap.xml') +
      '\n',
    { headers: { 'Content-Type': 'text/plain;charset=utf-8' } },
  );
