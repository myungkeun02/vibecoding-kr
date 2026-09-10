import { migrateDatabase, closeDatabase } from '../src/lib/db';
import { all, run, postSelect } from '../src/lib/db';
import { absolute, dataDir } from '../src/lib/config';
import { sendMail } from '../src/lib/mail';
import { writeFileSync, mkdirSync } from 'node:fs';
await migrateDatabase();
const posts = await all(
  postSelect +
    " WHERE p.status='active' AND p.created_at>=(CURRENT_TIMESTAMP - INTERVAL '7 days') ORDER BY likes DESC,p.created_at DESC LIMIT 8",
);
const subject = '이번 주, 직접 만든 이야기 · 바이브코딩가능?';
const body =
  '이번 주 빌더들이 나눈 제작 과정입니다.\n\n' +
  posts.map((p) => p.title + '\n' + absolute('/community/' + p.id)).join('\n\n') +
  '\n\n새 도구 탐색: ' +
  absolute('/');
if (!process.argv.includes('--send')) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataDir + '/newsletter-preview.txt', subject + '\n\n' + body);
  console.log('미리보기 저장: data/private/newsletter-preview.txt. 발송하려면 --send 옵션을 명시하세요.');
} else {
  if (!posts.length) {
    console.log('이번 주 공개 글이 없어 발송하지 않습니다.');
    process.exit(0);
  }
  await run(
    'CREATE TABLE IF NOT EXISTS mail_deliveries(campaign TEXT,email TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(campaign,email))',
  );
  const campaign = process.argv.find((x) => x.startsWith('--campaign='))?.slice(11);
  if (!campaign) throw new Error('--campaign=YYYY-WNN 캠페인 식별자를 지정하세요.');
  const audience = await all(
    "SELECT email,token FROM waitlist WHERE status='active' AND email NOT IN (SELECT email FROM mail_deliveries WHERE campaign=?)",
    campaign,
  );
  let n = 0;
  for (const w of audience) {
    await sendMail(w.email, subject, body + '\n\n수신 거부: ' + absolute('/unsubscribe?token=' + w.token));
    await run('INSERT INTO mail_deliveries(campaign,email) VALUES(?,?)', campaign, w.email);
    n++;
  }
  console.log(`${n}건 발송 처리. 로컬 어댑터는 실제 이메일을 보내지 않습니다.`);
}

await closeDatabase();
