import { test, expect, vi, afterEach } from 'vitest';
import worker from '../../infra/admin-gateway/worker.mjs';
const env = {
  ADMIN_ORIGIN: 'https://admin.example.com',
  PUBLIC_ORIGIN: 'https://example.com',
  ADMIN_PROXY_SECRET: 'test-only-gateway-secret',
};
afterEach(() => vi.unstubAllGlobals());
test('gateway replaces untrusted headers and preserves admin origin, cookies and redirect response', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: {
        Location: 'https://accounts.google.com/',
        'Set-Cookie': '__Host-vibepan-admin-oauth=test; Secure; HttpOnly; Path=/; SameSite=Lax',
      },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const r = await worker.fetch(
    new Request(env.ADMIN_ORIGIN + '/api/admin/auth/google', {
      headers: {
        Origin: env.ADMIN_ORIGIN,
        Cookie: '__Host-vibepan-admin=test',
        'x-vibepan-admin-proxy': 'attacker',
        'x-forwarded-host': 'attacker.example',
        Authorization: 'attacker',
      },
    }),
    env,
  );
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(env.PUBLIC_ORIGIN + '/api/admin/auth/google');
  expect(options.headers.get('x-vibepan-admin-proxy')).toBe(env.ADMIN_PROXY_SECRET);
  expect(options.headers.has('authorization')).toBe(false);
  expect(options.headers.get('x-forwarded-host')).toBe('admin.example.com');
  expect(options.headers.get('origin')).toBe(env.ADMIN_ORIGIN);
  expect(options.headers.get('cookie')).toContain('__Host-vibepan-admin=');
  expect(options.redirect).toBe('manual');
  expect(r.status).toBe(302);
  expect(r.headers.get('set-cookie')).toContain('HttpOnly');
  expect(r.headers.get('cache-control')).toBe('private, no-store');
});
test('gateway does not expose alternate domains or send its secret with public assets', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('css'));
  vi.stubGlobal('fetch', fetcher);
  expect((await worker.fetch(new Request('https://alternate.example/'), env)).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
  await worker.fetch(new Request(env.ADMIN_ORIGIN + '/_astro/app.css'), env);
  expect(fetcher.mock.calls[0][0]).toBe(env.PUBLIC_ORIGIN + '/_astro/app.css');
  expect(fetcher.mock.calls[0][1].headers.has('x-vibepan-admin-proxy')).toBe(false);
});

test('gateway keeps a fixed origin even for protocol-relative request paths', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null));
  vi.stubGlobal('fetch', fetcher);
  await worker.fetch(new Request(env.ADMIN_ORIGIN + '//attacker.example/api'), env);
  expect(new URL(fetcher.mock.calls[0][0]).origin).toBe(env.PUBLIC_ORIGIN);
});
