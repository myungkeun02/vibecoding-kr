import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const origin = 'http://127.0.0.1:8096';
const catalog = readdirSync('data/apps')
  .map((f) => JSON.parse(readFileSync('data/apps/' + f, 'utf8')))
  .filter((a) => a.published);
function testDb() {
  return new Database('data/test/e2e/site.db');
}
async function token(api: APIRequestContext, path = '/login') {
  const r = await api.get(path);
  return (await r.text()).match(/name="csrf-token" content="([^"]+)"/)?.[1] || '';
}
async function action(api: APIRequestContext, path: string, body: any, csrf?: string) {
  return api.post('/api/' + path, {
    headers: { Origin: origin, 'x-csrf-token': csrf || (await token(api)) },
    data: body,
  });
}
async function account(api: APIRequestContext) {
  const salt = randomBytes(6).toString('hex');
  const user = {
    email: salt + '@example.test',
    nickname: '빌더_' + salt,
    password: randomBytes(20).toString('hex'),
    terms: true,
  };
  const r = await action(api, 'auth/register', user);
  expect(r.status()).toBe(200);
  return user;
}
async function post(api: APIRequestContext, extra = {}) {
  const r = await action(api, 'posts/create', {
    title: '나만의 노트 도구 제작 기록',
    body: '## 직접 만들어봤어요\n\nMarkdown 저장과 검색 기능을 구현했습니다.',
    board: 'builds',
    tool: 'notion',
    ...extra,
  });
  expect(r.status()).toBe(200);
  return (await r.json()).id;
}
test.beforeEach(() => {
  const db = testDb();
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
});
test('all catalog pages, key pages, 404, sitemap and metadata render from the production server', async ({
  request,
}) => {
  for (const a of catalog) {
    const r = await request.get('/' + a.slug);
    expect(r.status(), a.slug).toBe(200);
    const html = await r.text();
    expect(html).toContain('build-prompt');
    expect(html).toContain('FAQPage');
    expect(html).toContain(origin + '/' + a.slug);
    const og = await request.get('/og/' + a.slug + '.png');
    expect(og.status()).toBe(200);
    expect(og.headers()['content-type']).toContain('image/png');
  }
  for (const p of [
    '/',
    '/community',
    '/login',
    '/signup',
    '/forgot',
    '/reset',
    '/privacy',
    '/terms',
    '/stats',
    '/rebuild-prompt',
    '/category/notes',
    '/unsubscribe',
  ])
    expect((await request.get(p)).status(), p).toBe(200);
  for (const p of ['/not-a-tool', '/community/not-found', '/category/nope'])
    expect((await request.get(p)).status(), p).toBe(404);
  expect((await request.get('/admin')).status()).toBe(403);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain(origin + '/slack');
  expect(sitemap).not.toContain('/admin');
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /me');
  expect(await (await request.get('/?q=slack')).text()).toContain('noindex,follow');
});
test('live Korean/English search, filters, pagination and browser history restore URL state', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('도구 검색', { exact: true }).fill('옵시디언');
  await expect(page.locator('.tool-row')).toHaveCount(1);
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator('.tool-row')).toContainText('Obsidian');
  await page.getByLabel('도구 검색', { exact: true }).fill('excel');
  await expect(page.locator('.tool-row')).toContainText('Microsoft Excel');
  await page.goBack();
  await expect(page.getByLabel('도구 검색', { exact: true })).toHaveValue('옵시디언');
  await page.getByLabel('도구 검색', { exact: true }).fill('');
  await expect(page.locator('.tool-row')).toHaveCount(20);
  await page.getByLabel('대체 가능성', { exact: true }).selectOption('yes');
  await expect(page).toHaveURL(/verdict=yes/);
  await page.getByLabel('도구 유형', { exact: true }).selectOption('desktop');
  await expect(page).toHaveURL(/type=desktop/);
  await page.reload();
  await expect(page.getByLabel('도구 유형', { exact: true })).toHaveValue('desktop');
  await page.goto('/?page=2');
  await expect(page.locator('.pagination [aria-current=page]')).toHaveText('2');
  await page.goto('/?q=zzzz없는도구');
  await expect(page.getByText('검색 조건에 맞는 도구가 없어요.')).toBeVisible();
  await page.goto('/');
  await page.locator('.category-nav a[href*="category=notes"]').click();
  await expect(page).toHaveURL(/category=notes/);
  await page.getByLabel('요금 방식', { exact: true }).selectOption('one-time');
  await expect(page.locator('.tool-row')).toHaveCount(1);
  await expect(page.locator('.tool-row')).toContainText('UpNote');
  await page.getByLabel('정렬', { exact: true }).selectOption('price');
  await expect(page).toHaveURL(/sort=price/);
  await page.reload();
  await expect(page.getByLabel('요금 방식', { exact: true })).toHaveValue('one-time');
  await page.getByLabel('정렬', { exact: true }).selectOption('newest');
  await expect(page).toHaveURL(/sort=newest/);
});
test('agent-specific clipboard copy, FAQ, sharing and anonymous vote toggle', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/slack');
  for (const [agent, marker] of [
    ['Claude Code', 'Claude Code에서'],
    ['Codex', 'Codex에서'],
    ['Cursor', 'Cursor의'],
  ]) {
    await page.getByRole('button', { name: agent + '용 복사' }).click();
    const content = await page.evaluate(() => navigator.clipboard.readText());
    expect(content).toContain(marker);
    expect(content).toContain('채널별 메시지');
    expect(content).toContain('이번에 만들지 않는 기능');
  }
  await page.getByRole('button', { name: '링크 복사' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(origin + '/slack');
  await expect(page.locator('a[href*="x.com/intent/post"]')).toHaveAttribute('href', /url=http/);
  await page.locator('.faq summary').first().click();
  await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
  const b = page.locator('[data-vote]');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-odometer]')).toHaveAttribute(
    'data-odometer',
    String(catalog.find((a) => a.slug === 'slack').priceMonthly),
  );
  await page.reload();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});
test('UI signup, logout, login return path and profile update use real sessions', async ({ page }) => {
  const salt = randomBytes(5).toString('hex'),
    password = randomBytes(20).toString('hex');
  await page.goto('/community/new');
  await expect(page).toHaveURL(/login\?returnTo/);
  await page.getByRole('link', { name: '회원가입' }).click();
  await page.getByLabel('이메일', { exact: true }).fill(salt + '@example.test');
  await page.getByLabel('닉네임', { exact: true }).fill('테스터_' + salt);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page).toHaveURL(/community\/new/);
  await page.goto('/me');
  await page.getByLabel('소개', { exact: true }).fill('한국어 프로필 저장 확인');
  await page.getByRole('button', { name: '프로필 저장' }).click();
  await expect(page.getByText('프로필을 저장했어요.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('소개', { exact: true })).toHaveValue('한국어 프로필 저장 확인');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
  await page.goto('/login?returnTo=/community/new');
  await page.getByLabel('이메일', { exact: true }).fill(salt + '@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: false }).click();
  await expect(page).toHaveURL(/community\/new/);
});
test('UI post creation, editing, comment, reply, reaction and image upload', async ({ page }) => {
  await account(page.request);
  await page.goto('/community/new');
  await page.getByLabel('제목', { exact: true }).fill('브라우저에서 작성한 제작 후기');
  await page
    .getByLabel('본문 · 마크다운 지원', { exact: true })
    .fill('## 브라우저 QA\n\n실제 사용자 조작으로 작성과 수정, 댓글을 확인합니다.');
  await page.locator('[data-upload]').setInputFiles({
    name: 'qa.png',
    mimeType: 'image/png',
    buffer: readFileSync('public/og/default.png'),
  });
  await expect(page.getByLabel('본문 · 마크다운 지원', { exact: true })).toHaveValue(/\/media\//);
  await page.getByRole('button', { name: '이야기 게시하기' }).click();
  await expect(
    page.getByRole('heading', { name: '브라우저에서 작성한 제작 후기', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.prose img')).toBeVisible();
  await page.getByRole('link', { name: '글 수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('수정한 제작 후기');
  await page.getByRole('button', { name: '수정 내용 저장' }).click();
  await expect(page.getByRole('heading', { name: '수정한 제작 후기', exact: true })).toBeVisible();
  await page.getByLabel('댓글 남기기').fill('유용한 제작 과정 감사합니다.');
  await page.getByRole('button', { name: '댓글 등록', exact: false }).click();
  await expect(
    page.locator('.comment > p').filter({ hasText: '유용한 제작 과정 감사합니다.' }),
  ).toBeVisible();
  await page.getByText('답글 쓰기', { exact: true }).click();
  await page.getByLabel('답글', { exact: true }).fill('다음에는 내보내기도 추가해 볼게요.');
  await page.getByRole('button', { name: '답글 등록' }).click();
  await expect(page.locator('.comment.reply')).toContainText('다음에는 내보내기도');
  await page.locator('[data-react=like]').click();
  await expect(page.locator('[data-react=like]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-react=bookmark]').click();
  await expect(page.locator('[data-react=bookmark]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/me');
  await expect(page.getByRole('heading', { name: '저장한 글', exact: true })).toBeVisible();
});
test('duplicate identity votes, anonymous-to-member merge, free/one-time/unknown pricing', async ({
  request,
}) => {
  const who = await account(request);
  await action(request, 'vote', { slug: 'trello' });
  await action(request, 'vote', { slug: 'trello' });
  const db = testDb();
  const uid = db.prepare('SELECT id FROM users WHERE email=?').get(who.email) as any;
  expect(
    (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE user_id=? AND slug=?').get(uid.id, 'trello') as any).n,
  ).toBe(1);
  await action(request, 'auth/logout', {});
  await action(request, 'vote', { slug: 'trello' });
  await action(request, 'auth/login', { email: who.email, password: who.password });
  expect(
    (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE user_id=? AND slug=?').get(uid.id, 'trello') as any).n,
  ).toBe(1);
  const before = await (await request.get('/api/totals')).json();
  for (const slug of ['obsidian', 'upnote', 'microsoft-excel']) await action(request, 'vote', { slug });
  const after = await (await request.get('/api/totals')).json();
  expect(after.monthly).toBe(before.monthly);
  expect(after.excluded).toBe(before.excluded + 2);
  db.close();
});
test('ownership enforcement, XSS, notifications, deletion and bookmarks remain consistent', async ({
  request,
}) => {
  await account(request);
  const pid = await post(request, {
    body: '<script>window.pwned=1</script>\n\n안전한 본문 [위험](javascript:alert(1))',
  });
  const other = await requestFactory.newContext({ baseURL: origin });
  await account(other);
  for (const op of ['posts/update', 'posts/delete']) {
    const res = await action(other, op, {
      id: pid,
      title: '다른 사람의 수정 시도',
      body: '수정 권한이 없어야 하는 본문입니다.',
      board: 'general',
    });
    expect(res.status()).toBe(403);
  }
  const cr = await action(other, 'comments/create', { post: pid, body: '다른 빌더가 댓글을 남깁니다.' });
  const cid = (await cr.json()).id;
  expect(cr.status()).toBe(200);
  const notif = await (await request.get('/notifications')).text();
  expect(notif).toContain('댓글');
  expect((await action(request, 'comments/delete', { id: cid })).status()).toBe(403);
  const html = await (await request.get('/community/' + pid)).text();
  expect(html).not.toContain('<script>window.pwned');
  expect(html).not.toContain('href="javascript:');
  await action(other, 'posts/react', { post: pid, kind: 'bookmark' });
  await action(request, 'posts/delete', { id: pid });
  expect((await request.get('/community/' + pid)).status()).toBe(404);
  expect((await action(other, 'comments/create', { post: pid, body: '삭제된 글 댓글' })).status()).toBe(404);
  expect(await (await other.get('/me')).text()).not.toContain('안전한 본문');
  await other.dispose();
});
test('admin permissions, moderation restore, pinned notice, suggestion status and audit', async ({
  request,
}) => {
  const u = await account(request);
  expect((await action(request, 'admin/action', { operation: 'post-hide', target: 'x' })).status()).toBe(403);
  const db = testDb();
  db.prepare("UPDATE users SET role='admin' WHERE email=?").run(u.email);
  const pid = await post(request, { board: 'notice', title: '운영 공지 테스트입니다' });
  await action(request, 'admin/action', { operation: 'post-pin', target: pid });
  expect((db.prepare('SELECT pinned FROM posts WHERE id=?').get(pid) as any).pinned).toBe(1);
  await action(request, 'report', { type: 'post', target: pid, reason: '관리자 신고 처리 흐름 점검' });
  await action(request, 'admin/action', { operation: 'post-hide', target: pid });
  expect((await request.get('/community/' + pid)).status()).toBe(404);
  await action(request, 'admin/action', { operation: 'post-restore', target: pid });
  expect((await request.get('/community/' + pid)).status()).toBe(200);
  await action(request, 'suggest', {
    slug: 'slack',
    title: 'Slack 가격 출처 개선',
    body: '공식 가격 페이지와 비교한 수정 제안입니다.',
  });
  const s = db.prepare('SELECT id FROM suggestions ORDER BY id DESC LIMIT 1').get() as any;
  await action(request, 'admin/action', { operation: 'suggest-accept', target: String(s.id) });
  expect((db.prepare('SELECT status FROM suggestions WHERE id=?').get(s.id) as any).status).toBe(
    'accepted_pending_release',
  );
  expect((await request.get('/admin')).status()).toBe(200);
  expect((db.prepare('SELECT COUNT(*) AS n FROM audit').get() as any).n).toBeGreaterThan(2);
  db.close();
});
test('waitlist normalizes, dedupes, hides existing withdrawal token, honeypot and unsubscribe', async ({
  request,
}) => {
  const address = randomBytes(4).toString('hex') + '@example.test';
  let r = await action(request, 'waitlist', { email: ' ' + address.toUpperCase() + ' ', consent: true });
  expect(r.status()).toBe(200);
  const result = await r.json();
  expect(result.withdrawUrl).toContain('/unsubscribe?token=');
  r = await action(request, 'waitlist', { email: address, consent: true });
  expect((await r.json()).withdrawUrl).toBeUndefined();
  const db = testDb();
  expect((db.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE email=?').get(address) as any).n).toBe(1);
  await action(request, 'waitlist', { email: 'bot@example.test', consent: true, website: 'spam' });
  expect(db.prepare('SELECT 1 FROM waitlist WHERE email=?').get('bot@example.test')).toBeUndefined();
  await action(request, 'waitlist/withdraw', {
    token: new URL(result.withdrawUrl, origin).searchParams.get('token'),
  });
  expect((db.prepare('SELECT status FROM waitlist WHERE email=?').get(address) as any).status).toBe(
    'withdrawn',
  );
  db.close();
});
test('CSRF, origin, input limits, bad passwords, session expiry and local reset delivery', async ({
  request,
}) => {
  const u = await account(request);
  const csrf = await token(request);
  expect(
    (
      await request.post('/api/vote', {
        headers: { Origin: 'https://evil.test', 'x-csrf-token': csrf },
        data: { slug: 'slack' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/vote', {
        headers: { Origin: origin, 'x-csrf-token': 'wrong' },
        data: { slug: 'slack' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await action(request, 'posts/create', { title: 'oversize', body: 'a'.repeat(70000), board: 'general' })
    ).status(),
  ).toBe(413);
  await action(request, 'auth/logout', {});
  expect((await action(request, 'auth/login', { email: u.email, password: 'wrong' })).status()).toBe(401);
  await action(request, 'auth/forgot', { email: u.email });
  const outbox = readdirSync('data/test/e2e/outbox')
    .map((f) => JSON.parse(readFileSync('data/test/e2e/outbox/' + f, 'utf8')))
    .find((m) => m.to === u.email);
  expect(outbox.subject).toContain('비밀번호');
  const resetToken = outbox.text.match(/token=([a-f0-9]+)/)[1];
  const pw = randomBytes(20).toString('hex');
  expect((await action(request, 'auth/reset', { token: resetToken, password: pw })).status()).toBe(200);
  expect((await action(request, 'auth/reset', { token: resetToken, password: pw })).status()).toBe(400);
  await action(request, 'auth/login', { email: u.email, password: pw });
  const db = testDb();
  db.prepare('UPDATE sessions SET expires=0 WHERE user_id=(SELECT id FROM users WHERE email=?)').run(u.email);
  const res = await request.get('/me', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  db.close();
});
test('local production bundle handles absent OAuth, invalid uploads and account withdrawal', async ({
  request,
}) => {
  expect((await request.get('/auth/github')).status()).toBe(503);
  expect((await request.get('/auth/google/callback')).status()).toBe(503);
  expect((await request.get('/api/auth/callback/github')).status()).toBe(503);
  expect((await request.get('/api/auth/callback/google')).status()).toBe(503);
  expect((await request.get('/api/auth/callback/unknown')).status()).toBe(404);
  const u = await account(request);
  await post(request);
  const csrf = await token(request);
  expect(
    (
      await request.post('/api/upload', {
        headers: { Origin: origin, 'x-csrf-token': csrf },
        multipart: {
          file: {
            name: 'bad.svg',
            mimeType: 'image/svg+xml',
            buffer: Buffer.from('<svg onload="alert(1)"/>'),
          },
        },
      })
    ).status(),
  ).toBe(400);
  const result = await action(request, 'profile/delete', { confirm: '탈퇴합니다', password: u.password });
  expect(result.status()).toBe(200);
  expect((await action(request, 'auth/login', { email: u.email, password: u.password })).status()).toBe(401);
  const db = testDb();
  expect(db.prepare('SELECT 1 FROM users WHERE email=?').get(u.email)).toBeUndefined();
  db.close();
});
test('rate limiting rejects excessive anonymous votes', async ({ request }) => {
  let status = 0;
  for (let i = 0; i < 31; i++) status = (await action(request, 'vote', { slug: 'obsidian' })).status();
  expect(status).toBe(429);
});
test('responsive dark/light layouts, reduced motion, keyboard and clean browser console', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push('network: ' + r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push('HTTP ' + r.status() + ': ' + r.url());
  });
  mkdirSync('docs/qa/screenshots', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/notion', '/community', '/login']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page
          .locator('img')
          .evaluateAll((imgs) =>
            imgs.every(
              (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        path + ' ' + width,
      ).toBe(true);
    }
    await page.goto('/');
    await page.screenshot({
      path: `docs/qa/screenshots/home-dark-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: '화면 테마 전환' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: 'docs/qa/screenshots/home-light-1440.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.tape').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('/');
  await expect(page.getByLabel('도구 검색', { exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('email verification tokens expire, are single use and never mark an unverified account verified', async ({
  request,
}) => {
  const u = await account(request),
    db = testDb();
  expect(
    (db.prepare('SELECT email_verified_at FROM users WHERE email=?').get(u.email) as any).email_verified_at,
  ).toBeNull();
  expect((await action(request, 'auth/register', u)).status()).toBe(409);
  expect((await action(request, 'auth/send-verification', {})).status()).toBe(200);
  const readToken = () =>
    readdirSync('data/test/e2e/outbox')
      .map((f) => JSON.parse(readFileSync('data/test/e2e/outbox/' + f, 'utf8')))
      .filter((m) => m.to === u.email && m.subject.includes('이메일 주소'))
      .at(-1)
      .text.match(/token=([a-f0-9]+)/)[1];
  const expired = readToken();
  db.prepare("UPDATE auth_tokens SET expires=0 WHERE kind='verify'").run();
  expect((await action(request, 'auth/verify-email', { token: expired })).status()).toBe(400);
  await action(request, 'auth/send-verification', {});
  const allMail = readdirSync('data/test/e2e/outbox')
    .map((f) => JSON.parse(readFileSync('data/test/e2e/outbox/' + f, 'utf8')))
    .filter((m) => m.to === u.email && m.subject.includes('이메일 주소'));
  const valid = allMail.map((m) => m.text.match(/token=([a-f0-9]+)/)[1]).find((t) => t !== expired);
  expect((await action(request, 'auth/verify-email', { token: valid })).status()).toBe(200);
  expect(
    (db.prepare('SELECT email_verified_at FROM users WHERE email=?').get(u.email) as any).email_verified_at,
  ).toBeTruthy();
  expect((await action(request, 'auth/verify-email', { token: valid })).status()).toBe(400);
  db.close();
});
test('comment update/delete, report resolution, notification read and account suspension', async ({
  request,
}) => {
  const author = await account(request),
    pid = await post(request),
    other = await requestFactory.newContext({ baseURL: origin });
  await account(other);
  const cr = await (await action(other, 'comments/create', { post: pid, body: '수정하기 전 댓글' })).json();
  expect((await action(other, 'comments/update', { id: cr.id, body: '수정한 댓글 내용' })).status()).toBe(
    200,
  );
  expect(await (await request.get('/community/' + pid)).text()).toContain('수정한 댓글 내용');
  expect((await action(request, 'notifications/read', {})).status()).toBe(200);
  const db = testDb(),
    uid = (db.prepare('SELECT id FROM users WHERE email=?').get(author.email) as any).id;
  expect(
    (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND is_read=0').get(uid) as any).n,
  ).toBe(0);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(uid);
  await action(request, 'report', { type: 'comment', target: cr.id, reason: '댓글 관리 기능 검증' });
  await action(request, 'admin/action', { operation: 'comment-hide', target: cr.id });
  expect(await (await request.get('/community/' + pid)).text()).not.toContain('수정한 댓글 내용');
  await action(request, 'admin/action', { operation: 'comment-restore', target: cr.id });
  expect(await (await request.get('/community/' + pid)).text()).toContain('수정한 댓글 내용');
  const report = (db.prepare('SELECT id FROM reports WHERE target_id=?').get(cr.id) as any).id;
  expect(
    (await action(request, 'admin/action', { operation: 'report-resolve', target: String(report) })).status(),
  ).toBe(200);
  expect((db.prepare('SELECT status FROM reports WHERE id=?').get(report) as any).status).toBe('resolved');
  expect((await action(other, 'comments/delete', { id: cr.id })).status()).toBe(200);
  const otherId = (db.prepare('SELECT user_id FROM comments WHERE id=?').get(cr.id) as any).user_id;
  expect(
    (await action(request, 'admin/action', { operation: 'user-suspend', target: otherId })).status(),
  ).toBe(200);
  expect(
    (
      await action(other, 'posts/create', {
        title: '정지 계정의 글',
        body: '이 글은 생성될 수 없어야 합니다.',
        board: 'general',
      })
    ).status(),
  ).toBe(401);
  expect(
    (await action(request, 'admin/action', { operation: 'user-restore', target: otherId })).status(),
  ).toBe(200);
  await other.dispose();
  db.close();
});
test('360px authenticated long text and large totals, and no-JavaScript form submission', async ({
  page,
  browser,
}) => {
  await account(page.request);
  await page.setViewportSize({ width: 360, height: 800 });
  const title = '긴한글제목과공백없는영문LongTitle'.repeat(4);
  const p = await post(page.request, {
    title,
    body:
      '본문에 긴 문자열과 코드가 있어도 페이지가 넘치지 않습니다.\n\n```\n' +
      'LongCode'.repeat(100) +
      '\n```',
  });
  for (const path of ['/me', '/community/' + p, '/notion']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const db = testDb();
  db.prepare("UPDATE tools SET price=987654321098 WHERE slug='slack'").run();
  await page.goto('/slack');
  await page.locator('[data-vote]').click();
  await expect(page.locator('[data-odometer]')).toHaveAttribute('data-odometer', /9876543/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  db.prepare('UPDATE tools SET price=? WHERE slug=?').run(
    catalog.find((a) => a.slug === 'slack').priceMonthly,
    'slack',
  );
  db.close();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto(origin + '/signup');
  const salt = randomBytes(5).toString('hex');
  await plain.getByLabel('이메일', { exact: true }).fill(salt + '@example.test');
  await plain.getByLabel('닉네임', { exact: true }).fill('노스크립트_' + salt);
  await plain.getByLabel('비밀번호', { exact: true }).fill(randomBytes(20).toString('hex'));
  await plain.getByRole('checkbox').first().check();
  await plain.getByRole('button', { name: '가입하기' }).click();
  await expect(plain).toHaveURL(origin + '/me');
  await plain.goto(origin + '/me');
  await expect(plain.getByRole('heading', { name: '프로필', exact: true })).toBeVisible();
  await context.close();
});

test('Korean copy covers every tool page, narrow layouts, form errors and internal labels', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  for (const app of catalog) {
    await page.goto('/' + app.slug);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(app.nameKo);
    await expect(page).toHaveTitle(new RegExp(app.nameKo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ','));
    await expect(page.locator('.verdict-panel .verdict')).toContainText('대체');
    const copy = await page.locator('main').innerText();
    expect(copy, app.slug).not.toMatch(
      /흐름을 설계할 수 있습니다|원통화|최소\s*\d+석|YOUR NEXT BUILD|NOT REALLY|KINDA/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), app.slug).toBe(
      true,
    );
  }
  await account(request);
  for (const invalid of [
    { title: '가'.repeat(141), body: '충분한 길이의 게시글 본문입니다.', board: 'general' },
    { title: '잘못된 게시판 확인', body: '충분한 길이의 게시글 본문입니다.', board: 'unknown' },
    { title: null, body: '충분한 길이의 게시글 본문입니다.', board: 'general' },
  ]) {
    const response = await action(request, 'posts/create', invalid);
    expect(response.status()).toBe(400);
    const { error } = await response.json();
    expect(error).toMatch(/[가-힣]/);
    expect(error).not.toMatch(/Too big|Invalid|expected|received/);
  }
  const u = await account(page.request);
  const db = testDb();
  db.prepare("UPDATE users SET role='admin' WHERE email=?").run(u.email);
  db.close();
  await page.goto('/suggest?slug=slack');
  await expect(page.getByLabel('관련 도구 (선택)', { exact: true })).toHaveValue('slack');
  expect(
    await page.getByLabel('관련 도구 (선택)', { exact: true }).locator('option:checked').innerText(),
  ).toContain('슬랙');
  for (const path of ['/admin', '/me', '/stats', '/community/new']) {
    await page.goto(path);
    expect(await page.locator('main').innerText()).not.toMatch(
      /OPERATIONS|YOUR BUILDER LOG|SELF-REPORTED|SHARE YOUR PROCESS|인증 조작/,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(
      true,
    );
  }
});
