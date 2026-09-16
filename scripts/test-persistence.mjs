import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { request, expect } from '@playwright/test';
import { createTestDatabase } from './test-database.mjs';
const database = await createTestDatabase('persistence');
mkdirSync('data/test', { recursive: true });
const dir = mkdtempSync(resolve('data/test/restart-')),
  origin = 'http://127.0.0.1:8097';
const env = {
  ...process.env,
  DATABASE_URL: database.connectionString,
  DATABASE_SCHEMA: database.schema,
  DATA_DIR: dir,
  APP_ENV: 'test',
  SESSION_SECRET: randomBytes(48).toString('hex'),
  SITE_URL: origin,
  ADMIN_SITE_URL: 'http://localhost:8097',
  APP_SURFACE: 'combined',
  ADMIN_BOOTSTRAP_EMAIL: '',
  ADMIN_PROXY_SECRET: '',
  HOST: '127.0.0.1',
  PORT: '8097',
  SMTP_URL: '',
  RESEND_API_KEY: '',
  R2_ENDPOINT: '',
  R2_BUCKET: '',
};
let child;
async function start() {
  child = spawn(process.execPath, ['dist/server/entry.mjs'], { env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + '/api/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}
async function stop() {
  if (!child) return;
  const p = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await p;
  child = null;
}
const api = await request.newContext({ baseURL: origin });
async function action(path, body) {
  const t = (await (await api.get('/login')).text()).match(/name="csrf-token" content="([^"]+)"/)[1];
  const r = await api.post('/api/' + path, { headers: { Origin: origin, 'x-csrf-token': t }, data: body });
  expect(r.status()).toBe(200);
  return r.json();
}
function ops(args) {
  const r = spawnSync(process.execPath, ['scripts/operations.mjs', ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}
try {
  await start();
  const salt = randomBytes(6).toString('hex');
  await action('auth/register', {
    email: salt + '@example.test',
    nickname: '재시작_' + salt,
    password: randomBytes(20).toString('hex'),
    terms: true,
  });
  const p = await action('posts/create', {
    title: '서버 재시작 이후 남아야 하는 글',
    body: '새 프로세스에서 실제 DB 데이터와 세션을 읽는지 확인합니다.',
    board: 'builds',
  });
  await action('vote', { slug: 'slack' });
  const submitted = await action('services/create', {
    name: '재시작 후에도 남는 SaaS',
    website: 'https://' + salt + '.example.com',
    category: 'notes',
    tagline: '자료와 메모를 모아두는 SaaS 서비스',
    description:
      '서버를 재시작하거나 백업에서 복원해도 등록한 소개와 검토 상태가 유지되는지 확인하는 서비스입니다.',
    pricing: 'free',
    relationship: 'user',
    image: '',
  });
  const before = await (await api.get('/api/totals')).json();
  const seeded = await database.one("SELECT * FROM services WHERE catalog_slug='slack'");
  const editedDescription =
    '회원이 보완한 소개와 제작 가이드는 서버 재시작이나 백업 복원으로 사라지지 않아야 합니다.';
  const proposal = await action('services/update', {
    id: seeded.id,
    revision: seeded.revision,
    name: seeded.name,
    website: seeded.website_url,
    category: seeded.category,
    tagline: seeded.tagline,
    description: editedDescription,
    pricing: seeded.pricing,
    relationship: seeded.relationship,
    image: '',
    change_reason: '실제 승인한 공동 편집 내용의 보존 여부를 확인합니다.',
  });
  const owner = await database.one('SELECT id,email FROM users WHERE email=?', salt + '@example.test');
  const adminId = randomBytes(18).toString('hex'),
    adminToken = randomBytes(36).toString('hex'),
    adminCsrf = randomBytes(36).toString('hex');
  await database.run(
    "INSERT INTO admin_members(id,email,user_id,google_subject,role) VALUES(?,?,?,'persistence-subject','owner')",
    adminId,
    owner.email,
    owner.id,
  );
  await database.run(
    "INSERT INTO admin_sessions(token,member_id,google_subject,csrf,expires) VALUES(?,?,'persistence-subject',?,?)",
    createHash('sha256').update(adminToken).digest('hex'),
    adminId,
    adminCsrf,
    Date.now() + 3600000,
  );
  const adminHeaders = {
    Origin: env.ADMIN_SITE_URL,
    Cookie: 'vibepan-admin=' + adminToken,
    'x-csrf-token': adminCsrf,
  };
  const approval = await api.post(
    env.ADMIN_SITE_URL + '/api/admin/v1/service-edits/' + proposal.redirect.split('/').pop() + '/review',
    { headers: adminHeaders, data: { operation: 'accept' } },
  );
  expect(approval.status()).toBe(200);
  async function checkSharedEdit() {
    expect((await api.get(env.ADMIN_SITE_URL + '/api/admin/v1/me', { headers: adminHeaders })).status()).toBe(
      200,
    );
    expect(
      (await database.one('SELECT COUNT(*) AS n FROM admin_audit WHERE actor=?', adminId)).n,
    ).toBeGreaterThan(0);
    const current = await database.one('SELECT * FROM services WHERE id=?', seeded.id);
    expect(current.description).toBe(editedDescription);
    expect(current.guide).toEqual(seeded.guide);
    expect(current.revision).toBe(seeded.revision + 1);
    expect((await api.get('/slack')).status()).toBe(200);
    expect(await (await api.get('/slack')).text()).toContain(editedDescription);
    expect((await api.get(proposal.redirect)).status()).toBe(200);
  }
  const backup = join(dir, 'backup.dump');
  ops(['backup', backup]);
  await stop();
  await start();
  await checkSharedEdit();
  expect((await api.get('/community/' + p.id)).status()).toBe(200);
  expect((await api.get(submitted.redirect)).status()).toBe(200);
  expect(await (await api.get('/api/totals')).json()).toEqual(before);
  expect((await api.get('/me')).url()).toBe(origin + '/me');
  await stop();
  await database.run('DELETE FROM votes');
  ops(['restore', backup, '--server-stopped']);
  await start();
  await checkSharedEdit();
  expect(await (await api.get('/api/totals')).json()).toEqual(before);
  expect((await api.get('/community/' + p.id)).status()).toBe(200);
  expect((await api.get(submitted.redirect)).status()).toBe(200);
  ops(['integrity']);
  writeFileSync(
    'docs/qa/persistence-results.json',
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        checks: [
          'real process restart',
          'public and separate admin sessions persist',
          'admin membership and action audit survive restart and restore',
          'posts persist',
          'submitted SaaS and review state persist through restart and restore',
          'approved seeded SaaS edit, guide and proposal survive restart, reseed and restore',
          'votes and totals persist',
          'PostgreSQL live pg_dump backup',
          'restore after stopped server',
          'integrity and foreign keys',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS: restart, sessions, posts, votes, backup and restore');
} finally {
  await api.dispose();
  await stop();
  await database.cleanup();
}
