import { createTestDatabase } from '../../scripts/test-database.mjs';
import { test, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'vibecoding-test-'));
process.env.DATA_DIR = dir;
process.env.APP_ENV = 'test';
let dbm: any, sec: any, apps: any;
let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  testDatabase = await createTestDatabase('unit');
  process.env.DATABASE_URL = testDatabase.connectionString;
  process.env.DATABASE_SCHEMA = testDatabase.schema;
  dbm = await import('../../src/lib/db');
  sec = await import('../../src/lib/security');
  apps = await import('../../src/lib/apps');
  await dbm.syncTools(apps.apps);
});
afterAll(async () => {
  await dbm?.closeDatabase();
  await testDatabase?.cleanup();
  rmSync(dir, { recursive: true, force: true });
});
test('catalog contains unique 100+ verified tools, 12+ categories and required products', () => {
  expect(apps.apps.length).toBeGreaterThanOrEqual(100);
  expect(apps.categories.length).toBeGreaterThanOrEqual(12);
  expect(new Set(apps.apps.map((a: any) => a.slug)).size).toBe(apps.apps.length);
  for (const s of ['notion', 'slack', 'obsidian', 'microsoft-excel']) expect(apps.getApp(s)).toBeTruthy();
  for (const a of apps.apps) {
    expect(a.faq).toHaveLength(4);
    expect(a.sources.some((s: any) => s.status === 'verified')).toBe(true);
    expect(apps.related(a)).toHaveLength(3);
  }
});
test('Korean aliases, updated names, filters and page bounds', () => {
  expect(apps.filterApps(new URLSearchParams({ q: '옵시디언' })).items[0].slug).toBe('obsidian');
  expect(apps.filterApps(new URLSearchParams({ q: 'excel' })).items[0].slug).toBe('microsoft-excel');
  expect(apps.filterApps(new URLSearchParams({ q: '코다' })).items[0].name).toBe('Superhuman Docs');
  expect(apps.filterApps(new URLSearchParams({ q: '없는도구123' })).total).toBe(0);
  expect(apps.filterApps(new URLSearchParams({ page: '999' })).page).toBeLessThan(999);
});
test('anonymous vote is idempotent and merges with account without double counting', async () => {
  const u = 'test-user';
  await dbm.run('INSERT INTO users(id,email,nickname) VALUES(?,?,?)', u, 'local@example.test', 'tester');
  await dbm.vote('slack', null, 'anon-a');
  await dbm.vote('slack', null, 'anon-a');
  expect((await dbm.voteCounts()).slack).toBe(1);
  await dbm.vote('slack', u, 'anon-b');
  expect((await dbm.voteCounts()).slack).toBe(2);
  await dbm.mergeVotes(u, 'anon-a');
  expect((await dbm.voteCounts()).slack).toBe(1);
  expect((await dbm.totals()).monthly).toBe(apps.getApp('slack').priceMonthly);
  await dbm.vote('slack', u, 'anon-b', true);
  expect((await dbm.voteCounts()).slack || 0).toBe(0);
});
test('free, unknown and one-time tools do not inflate monthly estimate', async () => {
  const start = (await dbm.totals()).monthly;
  for (const slug of ['obsidian', 'upnote', 'microsoft-excel']) await dbm.vote(slug, null, 'cost-test');
  expect((await dbm.totals()).monthly).toBe(start);
  expect((await dbm.totals()).excluded).toBe(2);
});
test('seed is idempotent and preserves operational records', async () => {
  const before = await dbm.totals();
  await dbm.syncTools(apps.apps);
  await dbm.syncTools(apps.apps);
  expect(await dbm.totals()).toEqual(before);
});
test('rate limiter closes limit and reopens on expiry', async () => {
  expect(await dbm.rate('x', 2, 60)).toBe(true);
  expect(await dbm.rate('x', 2, 60)).toBe(true);
  expect(await dbm.rate('x', 2, 60)).toBe(false);
  await dbm.run('UPDATE rate_limits SET expires=? WHERE key=?', Date.now() - 1, 'x');
  expect(await dbm.rate('x', 2, 60)).toBe(true);
});
test('password hashing is salted, verifiable and cookie signatures reject tampering', async () => {
  const a = await sec.passwordHash('correct horse battery staple');
  const b = await sec.passwordHash('correct horse battery staple');
  expect(a).not.toBe(b);
  expect(await sec.passwordCheck('correct horse battery staple', a)).toBe(true);
  expect(await sec.passwordCheck('wrong', a)).toBe(false);
  expect(sec.verified(sec.sign('identifier'))).toBe('identifier');
  expect(sec.verified(sec.sign('identifier') + 'x')).toBe(null);
  expect(sec.safeReturn('//evil.test')).toBe('/me');
  expect(sec.safeUrl('javascript:alert(1)')).toBe('');
});
test('Markdown removes executable HTML, javascript URLs and remote image tracking', async () => {
  const { markdown } = await import('../../src/lib/markdown');
  const html = markdown(
    '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[link](javascript:alert(1))\n![track](https://evil.test/x)\n![local](/media/abc)',
  );
  expect(html).not.toContain('<script');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('href="javascript:');
  const images = markdown('![track](https://evil.test/x)\n\n![local](/media/abc)');
  expect(images).not.toContain('https://evil.test');
  expect(images).toContain('/media/abc');
});
test('OAuth contract validates verified provider email and rejects missing tokens', async () => {
  const { exchangeOAuth } = await import('../../src/lib/oauth');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'stub' }))
    .mockResolvedValueOnce(Response.json({ sub: '1', email: 'test@example.test', email_verified: true }));
  expect((await exchangeOAuth('google', 'code', 'verifier', fetcher)).subject).toBe('1');
  expect(fetcher.mock.calls[0][1].body.get('code_verifier')).toBe('verifier');
  const bad = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'stub' }))
    .mockResolvedValueOnce(Response.json({ sub: '1', email: 'test@example.test', email_verified: false }));
  await expect(exchangeOAuth('google', 'code', 'verifier', bad)).rejects.toThrow();
  await expect(
    exchangeOAuth(
      'github',
      'code',
      'verifier',
      vi.fn().mockResolvedValue(Response.json({ error: 'denied' })),
    ),
  ).rejects.toThrow();
});
test('oversized streaming input is rejected', async () => {
  const { readLimited } = await import('../../src/lib/request');
  await expect(
    readLimited(new Request('http://localhost/', { method: 'POST', body: 'x'.repeat(50) }), 10),
  ).rejects.toThrow();
});
test('catalog contribution opens only a reviewed draft through configured fork (stub contract)', async () => {
  const { createCatalogPR } = await import('../../src/lib/catalog-pr');
  process.env.GITHUB_REPOSITORY = 'test/catalog';
  process.env.GITHUB_BOT_FORK = 'test-bot/catalog';
  process.env.GITHUB_BOT_TOKEN = 'stub-only';
  const f = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ default_branch: 'main' }))
    .mockResolvedValueOnce(Response.json({ object: { sha: 'base' } }))
    .mockResolvedValueOnce(Response.json({ ref: 'new' }))
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(Response.json({ content: { sha: 'new' } }))
    .mockResolvedValueOnce(Response.json({ html_url: 'https://github.com/test/catalog/pull/1' }));
  const url = await createCatalogPR(apps.getApp('slack'), { id: 1, title: '가격 근거 수정' }, f);
  expect(url).toContain('/pull/1');
  const payload = JSON.parse(f.mock.calls.at(-1)![1].body);
  expect(payload.draft).toBe(true);
  expect(payload.head).toContain('test-bot:catalog/');
  delete process.env.GITHUB_BOT_TOKEN;
  await expect(createCatalogPR(apps.getApp('slack'), { id: 1, title: '검증' }, f)).rejects.toThrow(
    'GITHUB_PR_NOT_CONFIGURED',
  );
});
test('R2 upload/read and Resend adapters obey mocked provider contracts and propagate failures', async () => {
  const sdk = await import('@aws-sdk/client-s3');
  process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
  process.env.R2_BUCKET = 'qa';
  process.env.R2_ACCESS_KEY_ID = 'stub';
  process.env.R2_SECRET_ACCESS_KEY = 'stub';
  const send = vi
    .spyOn(sdk.S3Client.prototype, 'send')
    .mockResolvedValueOnce({} as never)
    .mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    } as never);
  const storage = await import('../../src/lib/storage');
  expect(await storage.saveImage('contract', Buffer.from([1, 2, 3]))).toBe('r2');
  expect((send.mock.calls[0][0] as any).input.Key).toBe('uploads/contract.webp');
  expect(Buffer.from(await storage.readImage('contract', 'r2'))).toEqual(Buffer.from([1, 2, 3]));
  send.mockRestore();
  for (const key of ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
    delete process.env[key];
  process.env.RESEND_API_KEY = 'stub';
  process.env.MAIL_FROM = 'qa@example.test';
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ id: 'stub' }))
    .mockResolvedValueOnce(new Response('', { status: 503 }));
  const { sendMail } = await import('../../src/lib/mail');
  expect(await sendMail('to@example.test', '메일 계약', '내용')).toBe('sent');
  expect(fetcher.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  await expect(sendMail('to@example.test', '실패', '내용')).rejects.toThrow('MAIL_DELIVERY_FAILED');
  fetcher.mockRestore();
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
});

test('PostgreSQL transactions roll back writes and isolate concurrent requests', async () => {
  await expect(
    dbm.transaction(async () => {
      await dbm.run(
        'INSERT INTO users(id,email,nickname) VALUES(?,?,?)',
        'rolled-back',
        'rollback@example.test',
        'rollback',
      );
      throw new Error('intentional rollback');
    }),
  ).rejects.toThrow('intentional rollback');
  expect(await dbm.one('SELECT id FROM users WHERE id=?', 'rolled-back')).toBeUndefined();
  const allowed = await Promise.all(Array.from({ length: 20 }, () => dbm.rate('concurrent-test', 4, 60)));
  expect(allowed.filter(Boolean)).toHaveLength(4);
  await Promise.all(Array.from({ length: 20 }, () => dbm.vote('slack', null, 'parallel-voter')));
  expect((await dbm.one('SELECT COUNT(*) AS n FROM votes WHERE anonymous=?', 'parallel-voter')).n).toBe(1);
});

test('PostgreSQL preserves case-insensitive account uniqueness', async () => {
  await dbm.run(
    'INSERT INTO users(id,email,nickname) VALUES(?,?,?)',
    'case-first',
    'MixedCase@example.test',
    'CaseBuilder',
  );
  await expect(
    dbm.run(
      'INSERT INTO users(id,email,nickname) VALUES(?,?,?)',
      'case-second',
      'mixedcase@example.test',
      'other-name',
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await expect(
    dbm.run(
      'INSERT INTO users(id,email,nickname) VALUES(?,?,?)',
      'case-third',
      'other@example.test',
      'casebuilder',
    ),
  ).rejects.toMatchObject({ code: '23505' });
});
