import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const report = JSON.parse(readFileSync('docs/qa/playwright-results.json', 'utf8'));
const cases = [];
function walk(s) {
  for (const spec of s.specs || [])
    for (const test of spec.tests || [])
      cases.push({
        title: spec.title,
        status: test.status,
        attempts: test.results.map((r) => ({ status: r.status, durationMs: r.duration })),
      });
  for (const child of s.suites || []) walk(child);
}
walk(report);
writeFileSync(
  'docs/qa/browser-summary.json',
  JSON.stringify(
    {
      startedAt: report.stats.startTime,
      durationMs: report.stats.duration,
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      flaky: report.stats.flaky,
      skipped: report.stats.skipped,
      cases,
    },
    null,
    2,
  ) + '\n',
);
const hash = createHash('sha256');
function tree(path) {
  for (const f of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path + '/' + f.name;
    if (f.isDirectory()) tree(p);
    else {
      hash.update(p);
      hash.update(readFileSync(p));
    }
  }
}
for (const dir of ['src', 'data/apps', 'migrations']) tree(dir);
for (const f of ['package.json', 'pnpm-lock.yaml', 'data/categories.json', 'data/exchange.json']) {
  hash.update(f);
  hash.update(readFileSync(f));
}
writeFileSync(
  'docs/qa/source-revision.json',
  JSON.stringify(
    {
      version: '1.0.0',
      algorithm: 'SHA-256',
      scope: [
        'src/**',
        'data/apps/**',
        'migrations/**',
        'package.json',
        'pnpm-lock.yaml',
        'data/categories.json',
        'data/exchange.json',
      ],
      hash: hash.digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${report.stats.expected} passed, ${report.stats.unexpected} failed; sanitized public QA summary saved`,
);
