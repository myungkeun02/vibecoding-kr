import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import https from 'node:https';
import { request, expect } from '@playwright/test';
mkdirSync('data/test', { recursive: true });
const dir = mkdtempSync(resolve('data/test/https-')),
  origin = 'https://127.0.0.1:8099';
const cert = join(dir, 'cert.pem'),
  key = join(dir, 'key.pem');
if (
  spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  ).status !== 0
)
  throw new Error('OpenSSL is required for the isolated TLS test');
const env = {
  ...process.env,
  APP_ENV: 'production',
  DATA_DIR: dir,
  SITE_URL: origin,
  SESSION_SECRET: randomBytes(48).toString('hex'),
  HOST: '127.0.0.1',
  PORT: '8098',
  SMTP_URL: '',
  RESEND_API_KEY: '',
  MAIL_FROM: '',
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  TRUST_PROXY: '0',
};
let child = spawn(process.execPath, ['dist/server/entry.mjs'], { env, stdio: 'ignore' });
const proxy = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (req, res) => {
  try {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts);
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    const upstream = await fetch('http://127.0.0.1:8098' + req.url, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
      redirect: 'manual',
    });
    const out = Object.fromEntries(upstream.headers);
    out['set-cookie'] = upstream.headers.getSetCookie();
    delete out['transfer-encoding'];
    delete out['content-encoding'];
    delete out['content-length'];
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502);
    res.end();
  }
});
const api = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
try {
  await new Promise((r) => proxy.listen(8099, '127.0.0.1', r));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await api.get('/api/health')).ok()) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Production server failed');
  const html = await (await api.get('/signup')).text(),
    csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
  const salt = randomBytes(5).toString('hex');
  const register = await api.post('/api/auth/register', {
    headers: { Origin: origin, 'x-csrf-token': csrf },
    data: {
      email: salt + '@example.test',
      nickname: 'TLS_' + salt,
      password: randomBytes(20).toString('hex'),
      terms: true,
    },
  });
  expect(register.status()).toBe(200);
  const cookies = (await api.storageState()).cookies;
  expect(cookies.find((c) => c.name === 'session')?.secure).toBe(true);
  expect(cookies.find((c) => c.name === 'session')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'session')?.sameSite).toBe('Lax');
  expect((await api.get('/me')).url()).toBe(origin + '/me');
  const missing = await api.post('/api/auth/send-verification', {
    headers: { Origin: origin, 'x-csrf-token': csrf },
    data: {},
  });
  expect(missing.status()).toBe(503);
  expect(existsSync(join(dir, 'outbox'))).toBe(false);
  expect(await (await api.get('/sitemap.xml')).text()).toContain(origin + '/slack');
  writeFileSync(
    'docs/qa/production-results.json',
    JSON.stringify(
      {
        status: 'PASS',
        checkedAt: new Date().toISOString(),
        environment: 'production bundle + APP_ENV=production + isolated self-signed HTTPS proxy',
        checks: [
          'Secure HttpOnly SameSite=Lax session',
          'authenticated request over HTTPS',
          'canonical origin',
          'unconfigured email returns 503',
          'no development outbox in production',
        ],
        publicDeployment: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('PASS: production HTTPS session and absent-mail policy (local self-signed TLS only)');
} finally {
  await api.dispose();
  await new Promise((r) => proxy.close(r));
  child.kill('SIGTERM');
}
