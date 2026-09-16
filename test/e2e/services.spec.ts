import { fixtureAdmin, adminBrowser, adminOrigin, adminGet, reviewAction } from './admin-fixtures';
import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { connectE2EDatabase } from '../../scripts/test-database.mjs';
const origin = 'http://127.0.0.1:8096';
const salt = () => randomBytes(5).toString('hex');
const fields = (key = salt()) => ({
  name: '데일리보드 ' + key,
  website: `https://${key}.example.com`,
  category: 'projects',
  tagline: '하루의 할 일을 가볍게 정리하는 서비스',
  description:
    '오늘 해야 할 일과 진행 중인 작업을 한 화면에서 관리합니다. 팀과 작업 상태를 공유하고 매일 완료한 기록을 돌아볼 수 있습니다.',
  pricing: 'freemium',
  relationship: 'maker',
  image: '',
});
async function csrf(api: APIRequestContext) {
  return (await (await api.get('/login')).text()).match(/name="csrf-token" content="([^"]+)"/)![1];
}
async function action(api: APIRequestContext, path: string, body: any) {
  const review = reviewAction(api, path, body);
  if (review) return review;
  return api.post('/api/' + path, {
    headers: { Origin: origin, 'x-csrf-token': await csrf(api) },
    data: body,
  });
}
async function register(api: APIRequestContext, admin = false) {
  const key = salt(),
    password = randomBytes(20).toString('hex');
  expect(
    (
      await action(api, 'auth/register', {
        email: key + '@example.test',
        nickname: '등록자_' + key,
        password,
        terms: true,
      })
    ).status(),
  ).toBe(200);
  const db = connectE2EDatabase();
  const user = await db.one('SELECT id FROM users WHERE email=?', key + '@example.test');
  if (admin) await fixtureAdmin(api, user);
  await db.close();
  return { ...user, password };
}
async function record(id: string) {
  const db = connectE2EDatabase();
  try {
    return await db.one('SELECT * FROM services WHERE id=?', id);
  } finally {
    await db.close();
  }
}
const serviceId = (redirect: string) => redirect.split('/').pop()!.split('?')[0];
test.beforeEach(async () => {
  const db = connectE2EDatabase();
  await db.run('DELETE FROM rate_limits');
  await db.close();
});

test('members upload SaaS, admins publish, owners revise and delete; media follows visibility', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page.request);
  const adminContext = await browser.newContext();
  await register(adminContext.request, true);
  await adminBrowser(adminContext);
  const adminPage = await adminContext.newPage();
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const publicPage = await visitor.newPage();
  const data = fields();
  try {
    await page.goto('/services/new');
    await page.getByLabel('서비스 이름', { exact: true }).fill(data.name);
    await page.getByLabel('서비스 주소', { exact: true }).fill(data.website);
    await page.getByLabel('분야', { exact: true }).selectOption(data.category);
    await page.getByLabel('요금 방식', { exact: true }).selectOption(data.pricing);
    await page.getByLabel('제가 만든 서비스').check();
    await page.getByLabel('한 줄 소개', { exact: true }).fill(data.tagline);
    await page.getByLabel('상세 소개', { exact: true }).fill(data.description);
    await page.getByLabel('서비스 이미지 첨부').setInputFiles({
      name: 'service.png',
      mimeType: 'image/png',
      buffer: readFileSync('public/brand/vibepan-robot-256.png'),
    });
    await expect(page.locator('input[name=image]')).toHaveValue(/\/media\/[a-f0-9]{36}/);
    const media = await page.locator('input[name=image]').inputValue();
    await expect(page.locator('[data-service-image-preview]')).toBeVisible();
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    mkdirSync('docs/qa/screenshots', { recursive: true });
    await page.screenshot({
      path: 'docs/qa/screenshots/saas-registration-390.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '등록 요청하기', exact: true }).click();
    await expect(page).toHaveURL(/\/services\/[a-f0-9]{36}\?submitted=1$/);
    const sid = serviceId(page.url());
    await expect(page.locator('.service-review-status')).toContainText('검토 중');
    expect((await visitor.request.get(origin + '/services/' + sid)).status()).toBe(404);
    expect((await visitor.request.get(origin + media)).status()).toBe(404);
    expect(await (await visitor.request.get(origin + '/sitemap.xml')).text()).not.toContain(
      '/services/' + sid,
    );
    await page.goto('/me');
    await expect(page.locator('#my-services').locator('..').locator('..')).toContainText(data.name);
    await adminPage.goto(adminOrigin + '/services/' + sid);
    await expect(adminPage.locator('[data-service-image-preview]')).toBeVisible();
    expect((await adminGet(adminContext.request, '/api/admin/v1' + media)).status()).toBe(200);
    await adminPage.getByRole('button', { name: '검토 결과 적용' }).click();
    await expect(adminPage).toHaveURL(adminOrigin + '/services?status=pending');
    await publicPage.goto(origin + '/?q=' + encodeURIComponent(data.name));
    await expect(publicPage.locator('.tool-row')).toHaveCount(1);
    await publicPage.goto(origin + '/?q=' + encodeURIComponent(data.name) + '&category=notes');
    await expect(publicPage.locator('.tool-row')).toHaveCount(0);
    await publicPage.goto(origin + '/services/' + sid);
    await expect(publicPage.getByRole('heading', { name: data.name, exact: true })).toBeVisible();
    await expect(publicPage.locator('.service-review-status')).toHaveCount(0);
    await expect(publicPage.locator('.service-detail-image')).toBeVisible();
    expect((await visitor.request.get(origin + media)).status()).toBe(200);
    await publicPage.screenshot({
      path: 'docs/qa/screenshots/saas-published-390.png',
      fullPage: true,
      animations: 'disabled',
    });
    const published = await record(sid);
    await page.goto('/services/' + sid + '/edit');
    await page
      .getByLabel('상세 소개', { exact: true })
      .fill(data.description + ' 변경한 내용을 다시 확인해 주세요.');
    await page.getByLabel('수정 이유·출처').fill('소개 내용을 실제 사용 결과에 맞게 보완합니다.');
    await page.getByRole('button', { name: '수정 제안 보내기' }).click();
    await expect(page).toHaveURL(/\/services\/edits\/[a-f0-9]{36}$/);
    const editId = serviceId(page.url());
    await expect(page.locator('[data-edit-status]')).toContainText('검토 중');
    expect((await visitor.request.get(origin + '/services/' + sid)).status()).toBe(200);
    expect((await visitor.request.get(origin + media)).status()).toBe(200);
    expect(await (await visitor.request.get(origin + '/services/' + sid)).text()).not.toContain(
      '변경한 내용을 다시 확인',
    );
    expect(
      (
        await action(adminContext.request, 'services/edits/review', { id: editId, operation: 'accept' })
      ).status(),
    ).toBe(200);
    expect(await (await visitor.request.get(origin + '/services/' + sid)).text()).toContain(
      '변경한 내용을 다시 확인',
    );
    expect(
      (
        await action(page.request, 'services/update', {
          ...data,
          id: sid,
          revision: published.revision,
          change_reason: '오래된 화면에서의 수정 제안입니다.',
        })
      ).status(),
    ).toBe(409);
    await page.goto('/services/' + sid);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '등록 삭제' }).click();
    await expect(page).toHaveURL(/\/me#my-services$/);
    expect(await record(sid)).toBeUndefined();
    expect((await visitor.request.get(origin + '/services/' + sid)).status()).toBe(404);
    expect((await visitor.request.get(origin + media)).status()).toBe(404);
  } finally {
    await adminContext.close();
    await visitor.close();
  }
});

test('SaaS permissions, canonical duplicates, stale writes and malicious input are rejected', async ({
  request,
  browser,
}) => {
  const guest = await requestFactory.newContext({ baseURL: origin }),
    other = await requestFactory.newContext({ baseURL: origin });
  try {
    expect((await action(guest, 'services/create', fields())).status()).toBe(401);
    await register(request);
    await register(other);
    expect(
      (
        await request.post('/api/services/create', {
          headers: { Origin: 'https://foreign.example', 'x-csrf-token': await csrf(request) },
          data: fields(),
        })
      ).status(),
    ).toBe(403);
    for (const extra of [
      { website: 'javascript:alert(1)' },
      { website: 'http://127.0.0.1' },
      { category: 'missing' },
      { image: 'https://foreign.example/logo.svg' },
      { description: '짧음' },
    ])
      expect((await action(request, 'services/create', { ...fields(), ...extra })).status()).toBe(400);
    expect(
      (await action(request, 'services/create', { ...fields(), website: 'https://slack.com/' })).status(),
    ).toBe(409);
    const upload = await other.post('/api/upload', {
      headers: { Origin: origin, 'x-csrf-token': await csrf(other) },
      multipart: {
        file: { name: 'logo.png', mimeType: 'image/png', buffer: readFileSync('public/favicon-32.png') },
      },
    });
    const foreignImage = (await upload.json()).url;
    expect((await action(request, 'services/create', { ...fields(), image: foreignImage })).status()).toBe(
      403,
    );
    const data = { ...fields(), name: '<script>alert(1)</script>', status: 'published' };
    const created = await action(request, 'services/create', data);
    expect(created.status()).toBe(200);
    const sid = serviceId((await created.json()).redirect);
    const s = await record(sid);
    expect(s.status).toBe('pending');
    const html = await (await request.get('/services/' + sid)).text();
    expect(html).toContain('&lt;script&gt;');
    const securityPage = await browser.newPage({ storageState: await request.storageState() });
    const dialogs: string[] = [];
    securityPage.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await securityPage.goto(origin + '/services/' + sid);
    await expect(securityPage.getByRole('heading', { name: data.name, exact: true })).toBeVisible();
    expect(
      await securityPage
        .locator('script')
        .evaluateAll((nodes) => nodes.some((n) => n.textContent?.includes('alert(1)'))),
    ).toBe(false);
    expect(dialogs).toEqual([]);
    await securityPage.close();
    expect((await other.get('/services/' + sid)).status()).toBe(404);
    for (const path of ['services/update', 'services/delete'])
      expect((await action(other, path, { ...data, id: sid, revision: s.revision })).status()).toBe(403);
    expect(
      (
        await action(other, 'services/review', { id: sid, revision: s.revision, operation: 'publish' })
      ).status(),
    ).toBe(401);
    expect(
      (
        await action(request, 'services/create', {
          ...data,
          website: data.website.replace('https://', 'http://www.') + '/?utm_source=share',
        })
      ).status(),
    ).toBe(409);
    const edits = await Promise.all([
      action(request, 'services/update', { ...data, id: sid, revision: s.revision, name: '동시 수정 하나' }),
      action(request, 'services/update', { ...data, id: sid, revision: s.revision, name: '동시 수정 둘' }),
    ]);
    expect(edits.map((r) => r.status()).sort()).toEqual([200, 409]);
    const duplicate = fields();
    const results = await Promise.all([
      action(request, 'services/create', duplicate),
      action(other, 'services/create', duplicate),
    ]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  } finally {
    await guest.dispose();
    await other.dispose();
  }
});

test('review feedback, no-JavaScript submission, suspension and account deletion control SaaS visibility', async ({
  browser,
  request,
}) => {
  await register(request, true);
  const plain = await browser.newContext({ javaScriptEnabled: false, baseURL: origin });
  const guest = await requestFactory.newContext({ baseURL: origin });
  try {
    const owner = await register(plain.request);
    const p = await plain.newPage(),
      data = fields();
    await p.goto('/services/new');
    await p.getByLabel('서비스 이름', { exact: true }).fill(data.name);
    await p.getByLabel('서비스 주소', { exact: true }).fill(data.website);
    await p.getByLabel('분야', { exact: true }).selectOption(data.category);
    await p.getByLabel('한 줄 소개', { exact: true }).fill(data.tagline);
    await p.getByLabel('상세 소개', { exact: true }).fill(data.description);
    await p.getByRole('button', { name: '등록 요청하기' }).click();
    await expect(p).toHaveURL(/\/services\/[a-f0-9]{36}\?submitted=1$/);
    const sid = serviceId(p.url());
    let s = await record(sid);
    expect(
      (
        await action(request, 'services/review', {
          id: sid,
          revision: s.revision,
          operation: 'reject',
          note: '',
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await action(request, 'services/review', {
          id: sid,
          revision: s.revision,
          operation: 'reject',
          note: '공식 홈페이지와 소개 내용을 보완해 주세요.',
        })
      ).status(),
    ).toBe(200);
    await p.reload();
    await expect(p.locator('.service-review-status')).toContainText(
      '공식 홈페이지와 소개 내용을 보완해 주세요.',
    );
    s = await record(sid);
    expect(
      (await action(plain.request, 'services/update', { ...data, id: sid, revision: s.revision })).status(),
    ).toBe(200);
    s = await record(sid);
    expect(
      (
        await action(request, 'services/review', { id: sid, revision: s.revision, operation: 'publish' })
      ).status(),
    ).toBe(200);
    expect((await guest.get('/services/' + sid)).status()).toBe(200);
    s = await record(sid);
    expect(
      (
        await action(request, 'services/review', {
          id: sid,
          revision: s.revision,
          operation: 'hide',
          note: '서비스 주소와 내용을 다시 확인할 필요가 있어요.',
        })
      ).status(),
    ).toBe(200);
    expect((await guest.get('/services/' + sid)).status()).toBe(404);
    s = await record(sid);
    expect(
      (
        await action(request, 'services/review', { id: sid, revision: s.revision, operation: 'publish' })
      ).status(),
    ).toBe(200);
    await action(request, 'admin/action', { operation: 'user-suspend', target: owner.id });
    expect((await guest.get('/services/' + sid)).status()).toBe(404);
    expect(await (await guest.get('/services')).text()).not.toContain(data.name);
    const db = connectE2EDatabase();
    await db.run("UPDATE users SET status='active' WHERE id=?", owner.id);
    await db.close();
    // The suspension invalidated the session; log in again before withdrawing the account.
    const ownerDb = connectE2EDatabase();
    const u = await ownerDb.one('SELECT email FROM users WHERE id=?', owner.id);
    await ownerDb.close();
    expect(
      (await action(plain.request, 'auth/login', { email: u.email, password: owner.password })).status(),
    ).toBe(200);
    expect(
      (
        await action(plain.request, 'profile/delete', { confirm: '탈퇴합니다', password: owner.password })
      ).status(),
    ).toBe(200);
    expect(await record(sid)).toBeUndefined();
    expect((await guest.get('/services/' + sid)).status()).toBe(404);
  } finally {
    await plain.close();
    await guest.dispose();
  }
});
