import { defineMiddleware } from 'astro:middleware';
import { identity } from './lib/security';
import { event, run, syncTools, migrateDatabase } from './lib/db';
import { apps } from './lib/apps';
let ready: Promise<void> | undefined;
function initialize() {
  return (ready ??= (async () => {
    await migrateDatabase();
    await syncTools(apps);
  })().catch((error) => {
    ready = undefined;
    throw error;
  }));
}
export const onRequest = defineMiddleware(async (ctx, next) => {
  let response: Response;
  try {
    await initialize();
    await identity(ctx);
    response = await next();
  } catch (error) {
    console.error('request_failed', ctx.url.pathname, (error as Error).name);
    response = new Response(
      '<!doctype html><html lang="ko"><meta charset="utf-8"><title>잠시 문제가 생겼어요</title><h1>잠시 문제가 생겼어요</h1><p>잠시 후 다시 시도해 주세요.</p><a href="/">홈으로</a></html>',
      { status: 500, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
    );
  }
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
    response.status < 300 &&
    response.headers.get('Content-Type')?.includes('text/html') &&
    !/^\/(api|admin|me|login|signup|reset|forgot|verify-email|onboarding|unsubscribe|notifications)/.test(
      ctx.url.pathname,
    )
  )
    await event('pageview', ctx.routePattern || '/');
  if (Date.now() % 97 === 0) {
    await run('DELETE FROM sessions WHERE expires<?', Date.now());
    await run('DELETE FROM auth_tokens WHERE expires<?', Date.now());
    await run("DELETE FROM analytics WHERE day<(CURRENT_DATE - INTERVAL '90 days')");
  }
  return response;
});
