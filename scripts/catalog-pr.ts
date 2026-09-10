import { migrateDatabase, closeDatabase } from '../src/lib/db';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createCatalogPR } from '../src/lib/catalog-pr';
import { one, audit } from '../src/lib/db';
await migrateDatabase();
const proposalId = Number(process.argv[2]),
  filename = process.argv[3];
if (!proposalId || !filename)
  throw new Error('pnpm catalog:pr <proposal-id> data/apps/<slug>.json [--publish]');
const p = await one("SELECT * FROM suggestions WHERE id=? AND status='accepted_pending_release'", proposalId);
if (!p) throw new Error('An accepted, unpublished proposal is required');
const app = JSON.parse(readFileSync(filename, 'utf8'));
if (resolve(filename) !== resolve('data/apps/' + app.slug + '.json'))
  throw new Error('Edit the canonical JSON under data/apps first');
execFileSync('pnpm', ['validate'], { stdio: 'inherit' });
if (!process.argv.includes('--publish'))
  console.log(
    '검증 완료. --publish를 명시하면 설정된 봇 fork에 초안 PR을 만듭니다. 제안자 개인정보는 보내지 않습니다.',
  );
else {
  const url = await createCatalogPR(app, p);
  await audit(null, 'suggestion-draft-pr', String(p.id));
  console.log(url);
}

await closeDatabase();
