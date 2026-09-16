import { defineMiddleware } from 'astro:middleware';
import { identity } from './lib/security';
import { event, run, syncTools, migrateDatabase } from './lib/db';
import { apps } from './lib/apps';
import { bootstrapAdmin, adminIdentity } from './admin/auth';
import { adminRequest } from './admin/gateway';
import { adminSiteUrl, adminUrl, appSurface } from './admin/config';
let ready: Promise<void> | undefined;
function initialize() {
  return (ready ??= (async () => {
    await migrateDatabase();
    if (appSurface !== 'admin') await syncTools(apps);
    if (appSurface !== 'public') await bootstrapAdmin();
  })().catch((error) => {
    ready = undefined;
    throw error;
  }));
}
export const onRequest = defineMiddleware(async (ctx, next) => {
  let response: Response;
  try {
    await initialize();
    ctx.locals.admin = null;
    ctx.locals.adminSurface = adminRequest(ctx);
    if (ctx.locals.adminSurface) {
      ctx.locals.user = null;
      ctx.locals.anon = '';
      await adminIdentity(ctx);
      const path = ctx.url.pathname;
      if (path === '/robots.txt') response = new Response('User-agent: *\nDisallow: /\n');
      else if (path === '/api/health') response = Response.json({ ok: true });
      else if (path.startsWith('/api/') && !path.startsWith('/api/admin/'))
        response = new Response(null, { status: 404 });
      else if (path.startsWith('/api/admin/')) response = await next(path + ctx.url.search);
      else if (
        path.startsWith('/_astro/') ||
        path.startsWith('/brand/') ||
        path.startsWith('/icons/') ||
        path.startsWith('/favicon')
      )
        response = await next(path);
      else {
        const internal = path === '/' ? '/admin' : path.startsWith('/admin') ? path : '/admin' + path;
        if (!ctx.locals.admin && internal !== '/admin/login') response = ctx.redirect(adminUrl('/login'));
        else response = await next(internal + ctx.url.search);
      }
    } else if (
      /^\/(api\/admin(?:\/|$)|__admin_gateway(?:\/|$))/.test(ctx.url.pathname) ||
      appSurface === 'admin'
    ) {
      response = new Response(null, { status: 404 });
    } else if (/^\/admin(?:\/|$)/.test(ctx.url.pathname)) {
      response = adminSiteUrl ? ctx.redirect(adminUrl('/')) : new Response(null, { status: 404 });
    } else {
      await identity(ctx);
      response = await next();
    }
  } catch (error) {
    console.error('request_failed', ctx.url.pathname, (error as Error).name);
    response = new Response(
      '<!doctype html><html lang="ko"><meta charset="utf-8"><title>잠시 문제가 생겼어요</title><h1>잠시 문제가 생겼어요</h1><p>잠시 후 다시 시도해 주세요.</p><a href="/">홈으로</a></html>',
      { status: 500, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
    );
  }
  if (ctx.locals.adminSurface || ctx.url.pathname.startsWith('/__admin_gateway'))
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://t1.kakaocdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.kakaocdn.net; connect-src 'self' https://*.kakao.com; frame-src https://*.kakao.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (!['/robots.txt', '/sitemap.xml'].includes(ctx.url.pathname))
    response.headers.set('Cache-Control', 'private, no-store');
  if (
    !ctx.locals.adminSurface &&
    response.status < 300 &&
    response.headers.get('Content-Type')?.includes('text/html') &&
    !/^\/(api|admin|me|login|signup|reset|forgot|verify-email|onboarding|unsubscribe|notifications|services\/new|services\/edits|services\/[^/]+\/edit)/.test(
      ctx.url.pathname,
    )
  )
    await event('pageview', ctx.routePattern || '/');
  if (Date.now() % 97 === 0) {
    await run('DELETE FROM sessions WHERE expires<?', Date.now());
    await run('DELETE FROM auth_tokens WHERE expires<?', Date.now());
    await run('DELETE FROM admin_sessions WHERE expires<?', Date.now());
    await run('DELETE FROM admin_oauth_states WHERE expires<?', Date.now());
    await run("DELETE FROM analytics WHERE day<(CURRENT_DATE - INTERVAL '90 days')");
  }
  return response;
});
