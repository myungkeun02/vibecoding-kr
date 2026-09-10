import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
  const before = await (await api.get('/api/totals')).json();
  const backup = join(dir, 'backup.dump');
  ops(['backup', backup]);
  await stop();
  await start();
  expect((await api.get('/community/' + p.id)).status()).toBe(200);
  expect(await (await api.get('/api/totals')).json()).toEqual(before);
  expect((await api.get('/me')).url()).toBe(origin + '/me');
  await stop();
  await database.run('DELETE FROM votes');
  ops(['restore', backup, '--server-stopped']);
  await start();
  expect(await (await api.get('/api/totals')).json()).toEqual(before);
  expect((await api.get('/community/' + p.id)).status()).toBe(200);
  ops(['integrity']);
  writeFileSync(
    'docs/qa/persistence-results.json',
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        checks: [
          'real process restart',
          'session persists',
          'posts persist',
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
