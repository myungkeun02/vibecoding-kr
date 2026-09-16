import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createTestDatabase } from './test-database.mjs';
const dir = resolve('data/test/e2e');
if (!dir.endsWith('/data/test/e2e')) throw new Error('Unsafe test path');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const database = await createTestDatabase('e2e');
writeFileSync(dir + '/postgres.json', JSON.stringify({ schema: database.schema }), { mode: 0o600 });
const children = ['public', 'admin'].map((surface) =>
  spawn(process.execPath, ['dist/server/entry.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: database.connectionString,
      DATABASE_SCHEMA: database.schema,
      APP_ENV: 'test',
      DATA_DIR: dir,
      SESSION_SECRET: randomBytes(48).toString('hex'),
      HOST: '127.0.0.1',
      PORT: surface === 'public' ? '8096' : '8098',
      APP_SURFACE: surface,
      ADMIN_SITE_URL: 'http://127.0.0.1:8098',
      ADMIN_BOOTSTRAP_EMAIL: '',
      ADMIN_PROXY_SECRET: '',
      ADMIN_GOOGLE_CLIENT_ID: '',
      ADMIN_GOOGLE_CLIENT_SECRET: '',
      SITE_URL: 'http://127.0.0.1:8096',
      TRUST_PROXY: '0',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      SMTP_URL: '',
      MAIL_FROM: '',
      RESEND_API_KEY: '',
      R2_ENDPOINT: '',
      R2_BUCKET: '',
    },
  }),
);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) return resolve();
          child.once('exit', resolve);
          child.kill('SIGTERM');
        }),
    ),
  );
  await database.cleanup();
  process.exit(code);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1);
  });
