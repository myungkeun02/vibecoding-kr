import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { connectE2EDatabase } from '../../scripts/test-database.mjs';
import { fixtureAdmin, adminBrowser, adminGet, adminPost, adminHeaders, adminOrigin } from './admin-fixtures';
const publicOrigin = 'http://127.0.0.1:8096';
const key = () => randomBytes(6).toString('hex');
async function user(api: APIRequestContext) {
  const salt = key(),
    email = salt + '@example.test';
  const r = await publicPost(api, 'auth/register', {
    email,
    nickname: '관리검증_' + salt,
    password: key() + key(),
    terms: true,
  });
  expect(r.status()).toBe(200);
  return { email };
}
async function publicPost(api: APIRequestContext, path: string, data: any) {
  const csrf = (await (await api.get(publicOrigin + '/login')).text()).match(
    /name="csrf-token" content="([^"]+)"/,
  )![1];
  return api.post(publicOrigin + '/api/' + path, {
    headers: { Origin: publicOrigin, 'x-csrf-token': csrf },
    data,
  });
}
test.beforeEach(async () => {
  const db = connectE2EDatabase();
  await db.run('DELETE FROM rate_limits');
  await db.close();
});
test('community report review retains filters and shows hidden content to administrators', async ({
  page,
}) => {
  const u = await user(page.request);
  await fixtureAdmin(page.request, u);
  await adminBrowser(page.context());
  const post = await publicPost(page.request, 'posts/create', {
    title: '신고 검토용 게시글',
    body: '신고된 본문은 관리자 화면에서 읽고 숨김 처리할 수 있어야 합니다.',
    board: 'general',
  });
  expect(post.status()).toBe(200);
  const pid = (await post.json()).id;
  expect(
    (
      await publicPost(page.request, 'report', {
        type: 'post',
        target: pid,
        reason: '관리자가 확인할 신고 사유입니다',
      })
    ).status(),
  ).toBe(200);
  await page.goto(adminOrigin + '/community?tab=reports');
  await page.getByLabel('커뮤니티 검색').fill('확인할 신고');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('reports');
  await page.getByText('신고 검토용 게시글 보기', { exact: true }).click();
  await expect(
    page.getByText('신고된 본문은 관리자 화면에서 읽고 숨김 처리할 수 있어야 합니다.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '신고 대상 숨김', exact: true }).click();
  await expect(page.getByRole('button', { name: '신고 대상 복구', exact: true })).toBeVisible();
  expect((await page.request.get(publicOrigin + '/community/' + pid)).status()).toBe(404);
  await page.getByRole('button', { name: '신고 대상 복구', exact: true }).click();
  await expect(page.getByRole('button', { name: '신고 대상 숨김', exact: true })).toBeVisible();
  expect((await page.request.get(publicOrigin + '/community/' + pid)).status()).toBe(200);
});
test('public and admin surfaces reject session reuse, legacy escalation, forged hosts and CSRF', async ({
  request,
}) => {
  const u = await user(request),
    db = connectE2EDatabase();
  try {
    await db.run("UPDATE users SET role='admin' WHERE email=?", u.email);
    for (const path of ['/api/admin/v1/me', '/__admin_gateway/api/admin/v1/me', '/api/admin/auth/google'])
      expect(
        (
          await request.get(publicOrigin + path, {
            headers: { 'x-forwarded-host': '127.0.0.1:8098', 'x-vibepan-admin-proxy': 'forged' },
          })
        ).status(),
      ).toBe(404);
    expect((await request.get(adminOrigin + '/api/admin/v1/me')).status()).toBe(401);
    expect(
      (await publicPost(request, 'admin/action', { operation: 'post-hide', target: 'x' })).status(),
    ).toBe(404);
    expect((await publicPost(request, 'services/review', { id: 'x', operation: 'publish' })).status()).toBe(
      404,
    );
    expect(
      (
        await publicPost(request, 'posts/create', {
          title: '권한 없는 공지 작성',
          body: '일반 세션으로 공지를 작성하면 거절되어야 합니다.',
          board: 'notice',
        })
      ).status(),
    ).toBe(403);
    await fixtureAdmin(request, u);
    const notice = await adminPost(request, 'notices', {
      title: '일반 세션으로 변경할 수 없는 공지',
      body: '공지 관리에는 작성자라도 별도의 관리자 인증이 필요합니다.',
    });
    expect(notice.status()).toBe(200);
    const noticeId = (await notice.json()).id;
    expect(
      (
        await publicPost(request, 'posts/update', {
          id: noticeId,
          title: '게시판 변경 우회 시도',
          body: '공지의 게시판을 바꾸더라도 일반 로그인으로 수정할 수 없어야 합니다.',
          board: 'general',
        })
      ).status(),
    ).toBe(403);
    expect((await publicPost(request, 'posts/delete', { id: noticeId })).status()).toBe(403);
    expect((await adminGet(request, '/api/admin/v1/me')).status()).toBe(200);
    expect(
      (await request.get(publicOrigin + '/api/admin/v1/me', { headers: adminHeaders(request) })).status(),
    ).toBe(404);
    for (const headers of [
      { ...adminHeaders(request), Origin: publicOrigin },
      { ...adminHeaders(request), 'x-csrf-token': 'wrong' },
    ]) {
      expect(
        (
          await request.post(adminOrigin + '/api/admin/v1/notices', {
            headers,
            data: { title: '거부될 공지', body: '요청 위조를 검증하는 테스트입니다.' },
          })
        ).status(),
      ).toBe(403);
    }
    expect((await adminGet(request, '/api/totals')).status()).toBe(404);
    expect((await adminGet(request, '/api/admin/v1/me/extra')).status()).toBe(404);
    expect((await adminPost(request, 'reports/invalid/moderate', { operation: 'resolve' })).status()).toBe(
      400,
    );
    const html = await adminGet(request, '/');
    expect(html.headers()['x-robots-tag']).toContain('noindex');
    expect(html.headers()['cache-control']).toContain('no-store');
  } finally {
    await db.close();
  }
});
test('console adds and edits SaaS, manages members, records actions and renders across screen sizes', async ({
  page,
}) => {
  const u = await user(page.request);
  await fixtureAdmin(page.request, u);
  await adminBrowser(page.context());
  const db = connectE2EDatabase(),
    salt = key();
  let sid = '';
  try {
    await page.goto(adminOrigin + '/services/new');
    await page.getByLabel('서비스 이름', { exact: true }).fill('관리자가 등록한 SaaS ' + salt);
    await page.getByLabel('서비스 주소', { exact: true }).fill('https://' + salt + '.example.com');
    await page.getByLabel('분야', { exact: true }).selectOption('notes');
    await page.getByLabel('한 줄 소개', { exact: true }).fill('관리 화면에서 추가하고 수정하는 메모 서비스');
    await page
      .getByLabel('상세 소개', { exact: true })
      .fill('서비스와 제작 가이드를 한곳에서 등록하고 검토하며 운영하는 기능을 확인하는 설명입니다.');
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('/services/[a-f0-9]{36}$'));
    sid = new URL(page.url()).pathname.split('/').pop()!;
    expect((await db.one('SELECT status FROM services WHERE id=?', sid)).status).toBe('published');
    await page.getByLabel('한 줄 소개', { exact: true }).fill('관리 화면에서 바로 수정한 서비스 한 줄 소개');
    await page.getByRole('button', { name: '저장하기', exact: true }).click();
    await expect
      .poll(async () => (await db.one('SELECT tagline FROM services WHERE id=?', sid)).tagline)
      .toBe('관리 화면에서 바로 수정한 서비스 한 줄 소개');
    expect((await page.request.get(publicOrigin + '/services/' + sid)).status()).toBe(200);
    const before = await db.one("SELECT COALESCE(SUM(count),0) AS n FROM analytics WHERE event='pageview'");
    for (const path of [
      '/',
      '/services',
      '/edits',
      '/users',
      '/community',
      '/access',
      '/audit',
      '/settings',
      '/analytics?days=7',
      '/services/' + sid,
    ]) {
      const response = await page.goto(adminOrigin + path);
      expect(response!.status(), path).toBe(200);
      await expect(page.locator('.admin-brand img')).toBeVisible();
      expect(
        await page
          .locator('.admin-brand img')
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
      ).toBe(true);
      for (const width of [360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          path + ' ' + width,
        ).toBe(true);
      }
    }
    expect((await db.one("SELECT COALESCE(SUM(count),0) AS n FROM analytics WHERE event='pageview'")).n).toBe(
      before.n,
    );
    for (const width of [390, 1440])
      for (const path of ['/', '/analytics', '/services/' + sid]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(adminOrigin + path);
        await page.screenshot({
          path:
            'docs/qa/screenshots/admin-' +
            (path === '/' ? 'overview' : path.startsWith('/services') ? 'editor' : 'analytics') +
            '-' +
            width +
            '.png',
          fullPage: true,
        });
      }
    await page.goto(adminOrigin + '/users');
    await page.getByText('회원 직접 추가', { exact: true }).click();
    await page.getByLabel('이메일', { exact: true }).fill('created-' + salt + '@example.test');
    await page.getByLabel('닉네임', { exact: true }).fill('새회원_' + salt);
    const password = key() + key();
    await page.getByLabel('초기 비밀번호', { exact: true }).fill(password);
    await page.getByRole('button', { name: '회원 추가', exact: true }).click();
    await expect
      .poll(async () =>
        Boolean(await db.one('SELECT id FROM users WHERE email=?', 'created-' + salt + '@example.test')),
      )
      .toBe(true);
    const created = await db.one('SELECT * FROM users WHERE email=?', 'created-' + salt + '@example.test');
    expect(created.email_verified_at).toBeNull();
    expect(created.password).not.toBe(password);
    expect(
      (await adminPost(page.request, 'users/' + created.id + '/status', { status: 'suspended' })).status(),
    ).toBe(200);
    const users = await (await adminGet(page.request, '/api/admin/v1/users?q=created-' + salt)).json();
    expect(users.items[0].status).toBe('suspended');
    expect(users.items[0]).not.toHaveProperty('password');
    const audit = await db.all('SELECT * FROM admin_audit');
    expect(JSON.stringify(audit)).not.toContain(password);
    expect(audit.some((a: any) => a.action === 'service-save' && a.target_id === sid)).toBe(true);
    const d = await (await adminGet(page.request, '/api/admin/v1/overview?days=7')).json();
    expect(d.daily).toHaveLength(7);
    expect(d.totals.services).toBe(
      (await (await page.request.get(publicOrigin + '/api/totals')).json()).services,
    );
    expect((await adminGet(page.request, '/services/does-not-exist')).status()).toBe(404);
    expect((await adminPost(page.request, 'services/' + sid, { publication: 'hidden' })).status()).toBe(400);
    expect(
      (
        await adminPost(page.request, 'services/' + sid + '/review', {
          operation: 'hide',
          note: '버전 없는 요청은 거절합니다.',
        })
      ).status(),
    ).toBe(400);
  } finally {
    if (sid) await db.run('DELETE FROM services WHERE id=?', sid);
    await db.close();
  }
});
test('owner manages access and signup settings without giving other admins that permission', async ({
  page,
  browser,
}) => {
  const u = await user(page.request),
    db = connectE2EDatabase();
  const owner = await fixtureAdmin(page.request, u, 'owner');
  await adminBrowser(page.context());
  const other = await browser.newContext();
  const otherUser = await user(other.request);
  const operator = await fixtureAdmin(other.request, otherUser);
  try {
    expect((await adminPost(other.request, 'admins', { email: 'denied@example.test' })).status()).toBe(403);
    expect(
      (
        await adminPost(other.request, 'settings', { registration_open: false, saas_submissions_open: false })
      ).status(),
    ).toBe(403);
    expect((await adminPost(page.request, 'admins/' + owner.id + '/revoke', {})).status()).toBe(409);
    await page.goto(adminOrigin + '/access');
    const invited = key() + '@example.test';
    await page.getByLabel('새 관리자 Google 이메일').fill(invited);
    await page.getByRole('button', { name: '관리자 권한 부여' }).click();
    await expect(page.getByText(invited, { exact: true })).toBeVisible();
    expect((await adminPost(page.request, 'admins/' + operator.id + '/revoke', {})).status()).toBe(200);
    expect((await adminGet(other.request, '/api/admin/v1/me')).status()).toBe(401);
    expect(
      (
        await adminPost(page.request, 'settings', { registration_open: false, saas_submissions_open: false })
      ).status(),
    ).toBe(200);
    const guest = await browser.newContext();
    expect(
      (
        await publicPost(guest.request, 'auth/register', {
          email: key() + '@example.test',
          nickname: '중지확인',
          password: key() + key(),
          terms: true,
        })
      ).status(),
    ).toBe(403);
    expect((await publicPost(other.request, 'services/create', {})).status()).toBe(403);
    await guest.close();
    expect(
      (
        await adminPost(page.request, 'settings', { registration_open: true, saas_submissions_open: true })
      ).status(),
    ).toBe(200);
    expect((await adminPost(page.request, 'settings', {})).status()).toBe(400);
    expect((await adminPost(page.request, 'logout', {})).status()).toBe(200);
    expect((await adminGet(page.request, '/api/admin/v1/me')).status()).toBe(401);
  } finally {
    await db.run("UPDATE site_settings SET value='true'::jsonb");
    await db.run('DELETE FROM admin_members WHERE id=?', owner.id);
    await db.close();
    await other.close();
  }
});
