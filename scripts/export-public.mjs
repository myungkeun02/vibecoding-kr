// Export into a new directory only. Never copy local history, credentials or runtime records.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const dest = process.argv[2] && resolve(process.argv[2]);
if (!dest || existsSync(dest)) throw new Error('Provide a new, non-existing export directory');
const files = [
  'src',
  'data/apps',
  'data/categories.json',
  'data/icons.json',
  'data/exchange.json',
  'migrations',
  'scripts',
  'test',
  'public',
  '.github',
  '.githooks',
  '.gitignore',
  '.dockerignore',
  '.env.example',
  '.prettierrc.json',
  'README.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'astro.config.mjs',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
  'Dockerfile',
  'compose.yaml',
  'railway.toml',
];
mkdirSync(dest, { recursive: true });
for (const file of files) cpSync(file, join(dest, file), { recursive: true });
cpSync('docs', join(dest, 'docs'), {
  recursive: true,
  filter: (p) => !p.includes('superpowers') && !p.endsWith('playwright-results.json'),
});
const forbidden =
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{20,}/;
let count = 0;
function scan(path) {
  for (const f of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, f.name);
    if (f.isDirectory()) {
      if (['private', 'outbox', '.git', 'node_modules', 'test-results'].includes(f.name))
        throw new Error('Forbidden export path');
      scan(p);
    } else {
      if (/\.db(?:-|$)|^\.env$|\.session-secret/.test(f.name)) throw new Error('Forbidden export file');
      count++;
      if (/\.(md|json|ts|astro|js|mjs|txt|yml|yaml|toml|sql)$/.test(f.name)) {
        let s = readFileSync(p, 'utf8');
        if (forbidden.test(s)) throw new Error('Possible secret in ' + p);
        s = s.replaceAll(process.cwd(), '<workspace>');
        writeFileSync(p, s);
      }
    }
  }
}
scan(dest);
console.log(
  `Exported ${count} reviewed source and artifact files. Existing local history and runtime data were excluded.`,
);
