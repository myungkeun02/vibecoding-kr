import { beforeAll, afterAll, beforeEach, afterEach, test, expect, vi } from 'vitest';
import { createTestDatabase } from '../../scripts/test-database.mjs';
import type { APIContext } from 'astro';
vi.stubEnv('APP_ENV', 'test');
vi.stubEnv('SITE_URL', 'http://localhost:4321');
vi.stubEnv('ADMIN_SITE_URL', 'http://localhost:4322');
vi.stubEnv('APP_SURFACE', 'combined');
vi.stubEnv('ADMIN_BOOTSTRAP_EMAIL', 'owner@example.test');
vi.stubEnv('ADMIN_GOOGLE_CLIENT_ID', 'test-client');
vi.stubEnv('ADMIN_GOOGLE_CLIENT_SECRET', 'test-secret');
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof import('../../src/lib/db');
let auth: typeof import('../../src/admin/auth');
let ops: typeof import('../../src/admin/operations');
let gateway: typeof import('../../src/admin/gateway');
let security: typeof import('../../src/lib/security');
beforeAll(async () => {
  database = await createTestDatabase('admin_unit');
  process.env.DATABASE_URL = database.connectionString;
  process.env.DATABASE_SCHEMA = database.schema;
  db = await import('../../src/lib/db');
  auth = await import('../../src/admin/auth');
  ops = await import('../../src/admin/operations');
  gateway = await import('../../src/admin/gateway');
  security = await import('../../src/lib/security');
});
beforeEach(async () => {
  await db.run(
    'TRUNCATE admin_members,admin_sessions,admin_oauth_states,admin_audit,users,rate_limits CASCADE',
  );
  await auth.bootstrapAdmin();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ADMIN_PROXY_SECRET;
});
afterAll(async () => {
  await db.closeDatabase();
  await database.cleanup();
  vi.unstubAllEnvs();
});
function context(path: string, jar = new Map<string, string>(), headers = {}) {
  const url = new URL(path, 'http://localhost:4322');
  return {
    url,
    request: new Request(url, { headers }),
    clientAddress: '127.0.0.1',
    locals: {},
    cookies: {
      get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
      set: (k: string, v: string) => jar.set(k, v),
      delete: (k: string) => jar.delete(k),
    },
    redirect: (location: string) => new Response(null, { status: 302, headers: { Location: location } }),
  } as unknown as APIContext;
}
async function begin() {
  const jar = new Map<string, string>();
  const r = await auth.adminOAuth(context('/api/admin/auth/google', jar));
  return { jar, destination: new URL(r.headers.get('location')!) };
}
function provider(profile = {}) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'provider-test-token' }))
    .mockResolvedValueOnce(
      Response.json({ sub: 'owner-subject', email: 'owner@example.test', email_verified: true, ...profile }),
    );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function owner() {
  const session = await auth.establishAdmin({
    subject: 'owner-subject',
    email: 'owner@example.test',
    name: 'Owner',
  });
  const ctx = context('/', new Map([['vibepan-admin', session.token]]));
  await auth.adminIdentity(ctx);
  return ctx.locals.admin!;
}
test('bootstrap is idempotent and cannot silently replace the initial owner', async () => {
  await auth.bootstrapAdmin();
  const original = process.env.ADMIN_BOOTSTRAP_EMAIL;
  process.env.ADMIN_BOOTSTRAP_EMAIL = 'replacement@example.test';
  await auth.bootstrapAdmin();
  process.env.ADMIN_BOOTSTRAP_EMAIL = original;
  expect(await db.all('SELECT email,role FROM admin_members')).toEqual([
    { email: 'owner@example.test', role: 'owner' },
  ]);
});
test('Google PKCE callback binds browser and identity and creates only a hashed admin session', async () => {
  const { jar, destination } = await begin();
  expect(destination.origin).toBe('https://accounts.google.com');
  expect(destination.searchParams.get('redirect_uri')).toBe('http://localhost:4322/api/admin/auth/callback');
  expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
  expect(destination.searchParams.has('client_secret')).toBe(false);
  const state = destination.searchParams.get('state')!;
  const record = await db.one('SELECT * FROM admin_oauth_states WHERE state=?', security.hash(state));
  const fetcher = provider();
  const r = await auth.adminOAuth(
    context('/api/admin/auth/callback?state=' + state + '&code=verified', jar),
    true,
  );
  expect(r.headers.get('location')).toBe('http://localhost:4322/');
  expect(fetcher.mock.calls[0][1].body.get('redirect_uri')).toBe(
    'http://localhost:4322/api/admin/auth/callback',
  );
  expect(fetcher.mock.calls[0][1].body.get('code_verifier')).toBe(record.verifier);
  expect(jar.has('session')).toBe(false);
  expect(jar.has('vibepan-admin-oauth')).toBe(false);
  const session = await db.one('SELECT * FROM admin_sessions');
  expect(session.token).toBe(security.hash(jar.get('vibepan-admin')!));
  expect((await db.one('SELECT role FROM users'))!.role).toBe('user');
  const ctx = context('/', jar);
  await auth.adminIdentity(ctx);
  expect(ctx.locals.admin?.role).toBe('owner');
  const copiedJar = new Map([['vibepan-admin-oauth', 'original-browser']]);
  await auth.adminOAuth(context('/api/admin/auth/callback?state=' + state + '&code=replay', copiedJar), true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test.each(['missing-cookie', 'wrong-cookie', 'expired', 'wrong-state', 'missing-code'])(
  'admin callback rejects %s before contacting Google',
  async (problem) => {
    const { jar, destination } = await begin();
    let state = destination.searchParams.get('state')!;
    if (problem === 'missing-cookie') jar.clear();
    if (problem === 'wrong-cookie') jar.set('vibepan-admin-oauth', 'attacker');
    if (problem === 'expired') await db.run('UPDATE admin_oauth_states SET expires=0');
    if (problem === 'wrong-state') state = 'attacker';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const r = await auth.adminOAuth(
      context(
        '/api/admin/auth/callback?state=' + state + (problem === 'missing-code' ? '' : '&code=test'),
        jar,
      ),
      true,
    );
    expect(r.headers.get('location')).toContain('/login?error=oauth');
    expect(fetcher).not.toHaveBeenCalled();
    expect((await db.one('SELECT COUNT(*) AS n FROM admin_sessions'))!.n).toBe(0);
  },
);
test.each([{ email_verified: false }, { email: 'stranger@example.test' }, { sub: '' }])(
  'unverified or uninvited Google identity is denied: %j',
  async (profile) => {
    const { jar, destination } = await begin();
    provider(profile);
    const r = await auth.adminOAuth(
      context('/api/admin/auth/callback?state=' + destination.searchParams.get('state') + '&code=test', jar),
      true,
    );
    expect(r.headers.get('location')).toContain('/login?error=');
    expect(jar.has('vibepan-admin')).toBe(false);
    expect((await db.one('SELECT COUNT(*) AS n FROM admin_sessions'))!.n).toBe(0);
  },
);
test('first verified Google subject remains pinned and public password sessions never authenticate an admin', async () => {
  await owner();
  await expect(
    auth.establishAdmin({ subject: 'changed-subject', email: 'owner@example.test', name: 'Owner' }),
  ).rejects.toMatchObject({ status: 403 });
  await db.run("UPDATE users SET role='admin'");
  const ctx = context('/', new Map([['session', 'public-session']]));
  await auth.adminIdentity(ctx);
  expect(ctx.locals.admin).toBeNull();
});
test('only owner grants admins, owner cannot be revoked, revocation invalidates existing sessions', async () => {
  const actor = await owner();
  const mid = await db.transaction(() =>
    ops.grantAdmin({ email: 'operator@example.test', role: 'owner' }, actor),
  );
  expect((await db.one('SELECT role FROM admin_members WHERE id=?', mid))!.role).toBe('admin');
  const session = await auth.establishAdmin({
    subject: 'operator-subject',
    email: 'operator@example.test',
    name: 'Operator',
  });
  const ctx = context('/', new Map([['vibepan-admin', session.token]]));
  await auth.adminIdentity(ctx);
  await expect(
    db.transaction(() => ops.grantAdmin({ email: 'third@example.test' }, ctx.locals.admin!)),
  ).rejects.toMatchObject({ status: 403 });
  await expect(db.transaction(() => ops.revokeAdmin(actor.id, actor))).rejects.toMatchObject({ status: 409 });
  await db.transaction(() => ops.revokeAdmin(mid, actor));
  await auth.adminIdentity(ctx);
  expect(ctx.locals.admin).toBeNull();
  await expect(
    auth.establishAdmin({ subject: 'operator-subject', email: 'operator@example.test', name: 'Operator' }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (await db.one("SELECT COUNT(*) AS n FROM admin_audit WHERE action IN ('admin-grant','admin-revoke')"))!.n,
  ).toBe(2);
});
test('admin gateway ignores forged forwarded host and malformed secret bytes', async () => {
  expect(
    gateway.adminRequest(
      context('http://localhost:4321/', new Map(), { 'x-forwarded-host': 'localhost:4322' }),
    ),
  ).toBe(false);
  expect(gateway.adminRequest(context('/'))).toBe(true);
  process.env.ADMIN_PROXY_SECRET = 'a'.repeat(40);
  expect(gateway.adminRequest(context('/'))).toBe(false);
  expect(gateway.adminRequest(context('/', new Map(), { 'x-vibepan-admin-proxy': 'é'.repeat(40) }))).toBe(
    false,
  );
  expect(
    gateway.adminRequest(
      context('http://localhost:4321/', new Map(), {
        'x-vibepan-admin-proxy': 'a'.repeat(40),
      }),
    ),
  ).toBe(true);
});
