// Runs the real Worker handler and built Node app against an isolated database. No external OAuth calls.
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createTestDatabase } from './test-database.mjs';
import worker from '../infra/admin-gateway/worker.mjs';
const db = await createTestDatabase('admin_gateway');
const random = () => randomBytes(18).toString('hex');
const local = 'http://127.0.0.1:8100';
const env = {
  ADMIN_ORIGIN: 'https://admin.vibepan.com',
  PUBLIC_ORIGIN: 'https://vibepan.com',
  ADMIN_PROXY_SECRET: random() + random(),
};
const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
  stdio: 'ignore',
  env: {
    ...process.env,
    DATABASE_URL: db.connectionString,
    DATABASE_SCHEMA: db.schema,
    DATA_DIR: mkdtempSync(resolve('data/test/admin-gateway-')),
    APP_ENV: 'production',
    APP_SURFACE: 'combined',
    SESSION_SECRET: random() + random(),
    SITE_URL: env.PUBLIC_ORIGIN,
    ADMIN_SITE_URL: env.ADMIN_ORIGIN,
    ADMIN_BOOTSTRAP_EMAIL: '',
    ADMIN_PROXY_SECRET: env.ADMIN_PROXY_SECRET,
    ADMIN_GOOGLE_CLIENT_ID: 'test-client',
    ADMIN_GOOGLE_CLIENT_SECRET: 'test-secret',
    HOST: '127.0.0.1',
    PORT: '8100',
  },
});
const networkFetch = globalThis.fetch;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await networkFetch(local + '/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, 'test origin started');
  const uid = random(),
    mid = random(),
    token = random(),
    csrf = random();
  await db.run(
    'INSERT INTO users(id,email,nickname) VALUES(?,?,?)',
    uid,
    'gateway@example.test',
    'gateway-test',
  );
  await db.run(
    "INSERT INTO admin_members(id,email,user_id,google_subject,role) VALUES(?,?,?,'gateway-subject','owner')",
    mid,
    'gateway@example.test',
    uid,
  );
  await db.run(
    "INSERT INTO admin_sessions(token,member_id,google_subject,csrf,expires) VALUES(?,?,'gateway-subject',?,?)",
    createHash('sha256').update(token).digest('hex'),
    mid,
    csrf,
    Date.now() + 600000,
  );
  globalThis.fetch = (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, env.PUBLIC_ORIGIN);
    return networkFetch(local + target.pathname + target.search, { ...options, duplex: 'half' });
  };
  const throughGateway = (path, options = {}) =>
    worker.fetch(new Request(env.ADMIN_ORIGIN + path, options), env);
  const headers = { Origin: env.ADMIN_ORIGIN, Cookie: '__Host-vibepan-admin=' + token, 'x-csrf-token': csrf };
  assert.equal((await throughGateway('/api/admin/v1/me')).status, 401);
  assert.equal((await throughGateway('/api/admin/v1/me', { headers })).status, 200);
  assert.equal(
    (
      await networkFetch(local + '/api/admin/v1/me', {
        headers: { ...headers, 'x-forwarded-host': 'admin.vibepan.com', 'x-forwarded-proto': 'https' },
      })
    ).status,
    404,
  );
  const page = await throughGateway('/', { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /운영 현황/);
  const form = await throughGateway('/api/admin/v1/notices', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
    body: new URLSearchParams({
      csrf,
      title: '프록시를 통한 공지 작성',
      body: '관리자 별도 도메인에서 일반 폼 제출을 검증합니다.',
    }),
  });
  assert.equal(form.status, 303);
  assert.equal(new URL(form.headers.get('location')).origin, env.ADMIN_ORIGIN);
  const upload = new FormData();
  upload.set('file', new Blob([readFileSync('public/favicon-32.png')], { type: 'image/png' }), 'test.png');
  const image = await throughGateway('/api/admin/v1/uploads', { method: 'POST', headers, body: upload });
  assert.equal(image.status, 200);
  const uploaded = await image.json();
  assert.equal((await throughGateway(uploaded.preview, { headers })).status, 200);
  assert.equal((await networkFetch(local + uploaded.url)).status, 404);
  const oauth = await throughGateway('/api/admin/auth/google');
  assert.equal(oauth.status, 302);
  assert.equal(
    new URL(oauth.headers.get('location')).searchParams.get('redirect_uri'),
    env.ADMIN_ORIGIN + '/api/admin/auth/callback',
  );
  const cookie = oauth.headers.get('set-cookie');
  assert.match(cookie, /__Host-vibepan-admin-oauth=/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /Domain=/i);
  writeFileSync(
    'docs/qa/admin-gateway-results.json',
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        checks: [
          'real Worker to production-mode Node origin',
          'fixed origin and trusted forwarded host',
          'dedicated admin session required',
          'forged gateway blocked',
          'HTML form and multipart upload through proxy',
          'private media visibility',
          'secure host-only OAuth cookie',
          'dedicated Google callback',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS: admin gateway, forms, uploads, access checks and production OAuth cookie');
} finally {
  globalThis.fetch = networkFetch;
  if (child.exitCode === null) {
    const stopped = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await stopped;
  }
  await db.cleanup();
}
