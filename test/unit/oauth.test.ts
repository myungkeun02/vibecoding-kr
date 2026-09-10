import { test, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIContext } from 'astro';

const dir = mkdtempSync(join(tmpdir(), 'vibecoding-oauth-'));
vi.stubEnv('DATA_DIR', dir);
vi.stubEnv('APP_ENV', 'test');
vi.stubEnv('SITE_URL', 'http://localhost:4321');
for (const provider of ['GITHUB', 'GOOGLE']) {
  vi.stubEnv(provider + '_CLIENT_ID', 'test-client');
  vi.stubEnv(provider + '_CLIENT_SECRET', 'test-secret');
}
let auth: typeof import('../../src/pages/auth/[...path]');
let callback: typeof import('../../src/pages/api/auth/callback/[provider]');
let security: typeof import('../../src/lib/security');
let db: typeof import('../../src/lib/db');
beforeAll(async () => {
  auth = await import('../../src/pages/auth/[...path]');
  callback = await import('../../src/pages/api/auth/callback/[provider]');
  security = await import('../../src/lib/security');
  db = await import('../../src/lib/db');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => {
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function context(path: string, jar = new Map<string, string>()) {
  const url = new URL(path, 'http://localhost:4321');
  return {
    url,
    params: { path: url.pathname.slice('/auth/'.length), provider: url.pathname.split('/').at(-1) },
    cookies: {
      get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
      set: (key: string, value: string) => jar.set(key, value),
      delete: (key: string) => jar.delete(key),
    },
    redirect: (location: string) => new Response(null, { status: 302, headers: { Location: location } }),
  } as unknown as APIContext;
}

test.each(['github', 'google'])(
  '%s uses the registered callback for authorization and token exchange',
  async (provider) => {
    const jar = new Map<string, string>();
    const start = await auth.GET(context('/auth/' + provider + '?returnTo=%2Fsuggest%3Fslug%3Dslack', jar));
    const destination = new URL(start.headers.get('Location')!);
    const redirect = 'http://localhost:4321/api/auth/callback/' + provider;
    expect(destination.searchParams.get('redirect_uri')).toBe(redirect);
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
    expect(destination.searchParams.has('client_secret')).toBe(false);
    const state = JSON.parse(Buffer.from(security.verified(jar.get('oauth'))!, 'base64url').toString());
    expect(state.provider).toBe(provider);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'stub-token' }))
      .mockResolvedValueOnce(
        Response.json({ id: '1', sub: '1', email: 'oauth@example.test', email_verified: true }),
      )
      .mockResolvedValueOnce(Response.json([{ email: 'oauth@example.test', verified: true, primary: true }]));
    vi.stubGlobal('fetch', fetcher);
    const response = await callback.GET(
      context('/api/auth/callback/' + provider + '?state=' + state.state + '&code=stub-code', jar),
    );
    expect(response.headers.get('Location')).toBe('/onboarding');
    expect(fetcher.mock.calls[0][1].body.get('redirect_uri')).toBe(redirect);
    expect(fetcher.mock.calls[0][1].body.get('code_verifier')).toBe(state.verifier);
    expect(jar.has('oauth')).toBe(false);
    const pending = JSON.parse(
      Buffer.from(security.verified(jar.get('oauth_pending'))!, 'base64url').toString(),
    );
    expect(pending.returnTo).toBe('/suggest?slug=slack');
    expect(pending.provider).toBe(provider);
    expect(db.one('SELECT id FROM users WHERE email=?', pending.email)).toBeUndefined();
  },
);

test.each(['missing', 'tampered', 'expired', 'wrong-provider', 'wrong-state', 'denied'])(
  'callback rejects %s authorization before contacting a provider',
  async (problem) => {
    const jar = new Map<string, string>();
    await auth.GET(context('/auth/google', jar));
    const state = JSON.parse(Buffer.from(security.verified(jar.get('oauth'))!, 'base64url').toString());
    if (problem === 'expired') state.expires = Date.now() - 1;
    if (problem === 'wrong-provider') state.provider = 'github';
    jar.set('oauth', security.sign(Buffer.from(JSON.stringify(state)).toString('base64url')));
    if (problem === 'missing') jar.delete('oauth');
    if (problem === 'tampered') jar.set('oauth', jar.get('oauth')! + 'x');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = new URLSearchParams({ state: problem === 'wrong-state' ? 'invalid' : state.state });
    query.set(problem === 'denied' ? 'error' : 'code', problem === 'denied' ? 'access_denied' : 'stub-code');
    const response = await callback.GET(context('/api/auth/callback/google?' + query, jar));
    expect(response.headers.get('Location')).toBe('/login?error=oauth');
    expect(fetcher).not.toHaveBeenCalled();
    expect(jar.has('oauth')).toBe(false);
    expect(jar.has('oauth_pending')).toBe(false);
  },
);

test('unknown OAuth routes return 404', async () => {
  expect((await callback.GET(context('/api/auth/callback/unknown'))).status).toBe(404);
  expect((await auth.GET(context('/auth/google/callback/extra'))).status).toBe(404);
});
