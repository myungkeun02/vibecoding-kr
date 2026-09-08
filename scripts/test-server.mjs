import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const dir = resolve('data/test/e2e');
if (!dir.endsWith('/data/test/e2e')) throw new Error('Unsafe test path');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_ENV: 'test',
    DATA_DIR: dir,
    SESSION_SECRET: randomBytes(48).toString('hex'),
    HOST: '127.0.0.1',
    PORT: '8096',
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
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    child.kill(signal);
    process.exit(0);
  });
child.on('exit', (code) => process.exit(code || 0));
