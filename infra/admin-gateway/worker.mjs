// This gateway only connects the admin hostname to the current origin.
// Google authentication and all authorization remain mandatory in the admin API.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.ADMIN_ORIGIN || !env.ADMIN_PROXY_SECRET)
      return new Response(null, { status: 404 });
    if (url.protocol !== 'https:')
      return Response.redirect(env.ADMIN_ORIGIN + url.pathname + url.search, 308);
    const asset = /^\/(?:_astro\/|brand\/|icons\/|favicon)/.test(url.pathname);
    const target = new URL(env.PUBLIC_ORIGIN);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers(request.headers);
    for (const name of [
      'host',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-vibepan-admin-proxy',
      'authorization',
    ])
      headers.delete(name);
    if (!asset) {
      headers.set('x-vibepan-admin-proxy', env.ADMIN_PROXY_SECRET);
      headers.set('x-forwarded-host', new URL(env.ADMIN_ORIGIN).host);
    }
    headers.set('x-forwarded-proto', 'https');
    const response = await fetch(target.href, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', 'private, no-store');
    result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    result.headers.set('X-Frame-Options', 'DENY');
    return result;
  },
};
