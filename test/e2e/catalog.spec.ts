import { fixtureAdmin, adminBrowser, adminOrigin, adminGet, reviewAction } from './admin-fixtures';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connectE2EDatabase } from '../../scripts/test-database.mjs';
const origin = 'http://127.0.0.1:8096';
const key = () => randomBytes(5).toString('hex');
async function action(api: APIRequestContext, path: string, body: any) {
  const review = reviewAction(api, path, body);
  if (review) return review;
  const csrf = (await (await api.get('/login')).text()).match(/name="csrf-token" content="([^"]+)"/)![1];
  return api.post('/api/' + path, { headers: { Origin: origin, 'x-csrf-token': csrf }, data: body });
}
async function member(api: APIRequestContext, admin = false) {
  const salt = key(),
    password = randomBytes(20).toString('hex');
  const email = salt + '@example.test';
  expect(
    (
      await action(api, 'auth/register', { email, nickname: '수정자_' + salt, password, terms: true })
    ).status(),
  ).toBe(200);
  const db = connectE2EDatabase();
  const u = await db.one('SELECT id FROM users WHERE email=?', email);
  if (admin) await fixtureAdmin(api, u);
  await db.close();
  return { ...u, email, password };
}
const data = (s: any) => ({
  name: s.name,
  website: s.website_url,
  category: s.category,
  tagline: s.tagline,
  description: s.description,
  pricing: s.pricing,
  relationship: s.relationship,
  image: s.image_id ? '/media/' + s.image_id : '',
  id: s.id,
  revision: s.revision,
  change_reason: '공식 자료를 확인해 설명을 보완합니다.',
});
const revisionId = async (r: any) => (await r.json()).redirect.split('/').pop();
test.beforeEach(async () => {
  const db = connectE2EDatabase();
  await db.run('DELETE FROM rate_limits');
  await db.close();
});

test('seeded SaaS supports member guide edits, private comparison, admin approval and shared search', async ({
  page,
  browser,
}) => {
  await member(page.request);
  const admin = await browser.newContext();
  await member(admin.request, true);
  await adminBrowser(admin);
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  const db = connectE2EDatabase();
  const original = await db.one("SELECT * FROM services WHERE catalog_slug='trello'");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trello');
    await page.getByRole('link', { name: '정보 수정', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp('/services/' + original.id + '/edit$'));
    await page.getByLabel('서비스 이름', { exact: true }).fill('트렐로 공동 수정 시험');
    await page
      .getByLabel('상세 소개', { exact: true })
      .fill('누구나 기존 도구의 소개와 제작 가이드를 함께 수정할 수 있는지 확인하기 위한 서비스 설명입니다.');
    await page
      .getByLabel('제작 범위', { exact: true })
      .fill('개인용 보드와 작업 카드, 마감일 알림을 직접 만드는 범위입니다.');
    await page
      .getByLabel('수정 이유·출처')
      .fill('공식 기능 설명을 확인하고 개인용 제작 범위를 보완했습니다.');
    await page.getByLabel('서비스 이미지 첨부').setInputFiles({
      name: 'proposal.png',
      mimeType: 'image/png',
      buffer: readFileSync('public/brand/vibepan-robot-256.png'),
    });
    await expect(page.locator('input[name=image]')).toHaveValue(/\/media\/[a-f0-9]{36}/);
    const media = await page.locator('input[name=image]').inputValue();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'docs/qa/screenshots/shared-saas-editor-390.png', fullPage: true });
    await page.getByRole('button', { name: '수정 제안 보내기' }).click();
    await expect(page).toHaveURL(/\/services\/edits\/[a-f0-9]{36}$/);
    const eid = new URL(page.url()).pathname.split('/').pop();
    await expect(page.locator('[data-edit-status]')).toHaveText('검토 중');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'docs/qa/screenshots/shared-saas-proposal-390.png', fullPage: true });
    expect((await visitor.request.get(origin + media)).status()).toBe(404);
    expect((await adminGet(admin.request, '/api/admin/v1' + media)).status()).toBe(200);
    expect((await visitor.request.get(page.url(), { maxRedirects: 0 })).status()).toBe(302);
    await visitorPage.goto(origin + '/trello');
    await expect(visitorPage.getByRole('heading', { level: 1 })).toHaveText(original.name);
    const adminPage = await admin.newPage();
    await adminPage.goto(adminOrigin + '/edits');
    const row = adminPage.locator(`[data-edit-id="${eid}"]`);
    await row.getByText('수정 전·후 비교', { exact: true }).click();
    await expect(row).toContainText('트렐로 공동 수정 시험');
    const approval = adminPage.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/v1/service-edits/' + eid + '/review') &&
        response.request().method() === 'POST',
    );
    await row.getByRole('button', { name: '수정 검토 결과 적용' }).click();
    expect((await approval).status()).toBe(200);
    await expect(adminPage).toHaveURL(/\/edits$/);
    await visitorPage.reload();
    await expect(visitorPage.getByRole('heading', { level: 1 })).toHaveText('트렐로 공동 수정 시험');
    await expect(visitorPage.locator('main')).toContainText('마감일 알림을 직접 만드는 범위');
    expect((await visitor.request.get(origin + media)).status()).toBe(200);
    await visitorPage.goto(origin + '/?q=' + encodeURIComponent('트렐로 공동 수정 시험'));
    await expect(visitorPage.locator('.tool-row')).toHaveCount(1);
    await expect(visitorPage.locator('.tool-row')).toHaveAttribute('href', '/trello');
    await expect(visitorPage.locator('.catalog-switch')).toHaveCount(0);
    await page.goto('/me#my-service-edits');
    await expect(page.locator('main')).toContainText('반영 완료');
  } finally {
    await db.run('DELETE FROM service_edits WHERE service_id=?', original.id);
    await db.run(
      'UPDATE services SET name=?,description=?,guide=?::jsonb,image_id=?,revision=?,updated_at=? WHERE id=?',
      original.name,
      original.description,
      JSON.stringify(original.guide),
      original.image_id,
      original.revision,
      original.updated_at,
      original.id,
    );
    await db.close();
    await admin.close();
    await visitor.close();
  }
});

test('any member can propose changes but conflicting reviews, unauthorized edits and private media are protected', async ({
  browser,
}) => {
  const owner = await browser.newContext(),
    first = await browser.newContext(),
    second = await browser.newContext(),
    admin = await browser.newContext();
  await member(owner.request);
  await member(first.request);
  await member(second.request);
  await member(admin.request, true);
  await adminBrowser(admin);
  const db = connectE2EDatabase();
  let sid = '';
  try {
    const salt = key();
    const created = await action(owner.request, 'services/create', {
      name: '공동 SaaS ' + salt,
      website: 'https://' + salt + '.example.com',
      category: 'projects',
      tagline: '여러 사람이 함께 내용을 보완하는 서비스입니다',
      description:
        '한 사람이 등록한 서비스도 다른 사용자가 정보를 수정할 수 있는지 확인하기 위한 설명입니다.',
      pricing: 'free',
      relationship: 'maker',
      image: '',
    });
    expect(created.status()).toBe(200);
    sid = (await created.json()).redirect.split('/').pop().split('?')[0];
    let s = await db.one('SELECT * FROM services WHERE id=?', sid);
    expect(
      (
        await action(first.request, 'services/update', {
          ...data(s),
          description: s.description + ' 다른 사람이 수정합니다.',
        })
      ).status(),
    ).toBe(403);
    await action(admin.request, 'services/review', { id: sid, revision: s.revision, operation: 'publish' });
    s = await db.one('SELECT * FROM services WHERE id=?', sid);
    const before = await (await first.request.get('/api/totals')).json();
    const a = await action(first.request, 'services/update', {
      ...data(s),
      tagline: '첫 번째 편집자가 제안한 서비스의 새로운 한 줄 소개입니다',
    });
    expect(a.status()).toBe(200);
    const aid = await revisionId(a);
    const b = await action(second.request, 'services/update', {
      ...data(s),
      tagline: '두 번째 편집자가 제안한 서비스의 새로운 한 줄 소개입니다',
    });
    expect(b.status()).toBe(200);
    const bid = await revisionId(b);
    expect((await second.request.get('/services/edits/' + aid)).status()).toBe(404);
    expect(
      (await action(first.request, 'services/edits/review', { id: aid, operation: 'accept' })).status(),
    ).toBe(401);
    expect((await action(first.request, 'services/delete', { id: sid, revision: s.revision })).status()).toBe(
      403,
    );
    expect(await (await first.request.get('/api/totals')).json()).toEqual(before);
    expect(
      (await action(admin.request, 'services/edits/review', { id: aid, operation: 'accept' })).status(),
    ).toBe(200);
    expect(
      (await action(admin.request, 'services/edits/review', { id: bid, operation: 'accept' })).status(),
    ).toBe(409);
    expect((await action(second.request, 'services/edits/cancel', { id: bid })).status()).toBe(200);
    expect(
      (await action(admin.request, 'services/edits/review', { id: aid, operation: 'accept' })).status(),
    ).toBe(409);
    const pub = await first.newPage();
    await pub.goto(origin + '/?q=' + encodeURIComponent('공동 SaaS ' + salt));
    await expect(pub.locator('.tool-row')).toHaveCount(1);
    await expect(pub.locator('.tool-row')).toContainText('가이드 없음');
    await pub.goto(origin + '/?q=' + encodeURIComponent('공동 SaaS ' + salt) + '&guide=available');
    await expect(pub.locator('.tool-row')).toHaveCount(0);
    const review = await action(first.request, 'posts/create', {
      title: '공동 서비스의 제작 후기',
      body: '새로 등록된 서비스에 제작 후기를 연결하고 목록에서 확인합니다.',
      board: 'builds',
      tool: 'service:' + sid,
    });
    expect(review.status()).toBe(200);
    const postId = (await review.json()).id;
    await pub.goto(origin + '/?q=' + encodeURIComponent('공동 SaaS ' + salt));
    await expect(pub.locator('.review-count')).toHaveText('후기 1');
    await pub.goto(origin + '/services/' + sid);
    await expect(pub.locator('main')).toContainText('공동 서비스의 제작 후기');
    await db.run('DELETE FROM posts WHERE id=?', postId);
  } finally {
    if (sid) await db.run('DELETE FROM services WHERE id=?', sid);
    await db.close();
    for (const context of [owner, first, second, admin]) await context.close();
  }
});

test('a member adds a guide to another member’s SaaS without JavaScript', async ({ browser }) => {
  const owner = await browser.newContext();
  const editor = await browser.newContext({ javaScriptEnabled: false });
  const admin = await browser.newContext();
  await member(owner.request);
  await member(editor.request);
  await member(admin.request, true);
  await adminBrowser(admin);
  const db = connectE2EDatabase();
  let sid = '';
  try {
    const salt = key();
    const created = await action(owner.request, 'services/create', {
      name: '가이드 추가 ' + salt,
      website: 'https://' + salt + '.example.com',
      category: 'notes',
      tagline: '개인 메모를 검색하고 관리하는 서비스입니다',
      description:
        '등록 당시에는 가이드가 없었지만 다른 회원이 제작 방법을 추가할 수 있는 메모 서비스입니다.',
      pricing: 'free',
      relationship: 'user',
      image: '',
    });
    expect(created.status()).toBe(200);
    sid = (await created.json()).redirect.split('/').pop().split('?')[0];
    let s = await db.one('SELECT * FROM services WHERE id=?', sid);
    expect(
      (
        await action(admin.request, 'services/review', {
          id: sid,
          revision: s.revision,
          operation: 'publish',
        })
      ).status(),
    ).toBe(200);
    s = await db.one('SELECT * FROM services WHERE id=?', sid);
    expect((await action(editor.request, 'services/update', data(s))).status()).toBe(400);
    const before = await (await editor.request.get('/api/totals')).json();
    const page = await editor.newPage();
    await page.goto(origin + '/services/' + sid + '/edit');
    await page.getByText('제작 가이드 추가 (선택)', { exact: true }).click();
    await page.getByLabel('가이드 등록').selectOption('present');
    await page
      .getByLabel('제작 범위', { exact: true })
      .fill('개인 메모의 저장과 태그 검색을 구현하는 범위입니다.');
    await page
      .getByLabel('판단 이유', { exact: true })
      .fill('개인 사용 범위에서는 메모 저장과 검색만으로 충분하지만 여러 사용자의 동시 편집은 제외합니다.');
    await page.getByLabel('만들 기능', { exact: true }).fill('메모 저장\n태그로 검색');
    await page.getByLabel('제외할 기능', { exact: true }).fill('여러 사용자의 동시 편집');
    await page.getByLabel('운영 시 필요한 것', { exact: true }).fill('정기 데이터 백업');
    await page
      .getByLabel('제작 프롬프트', { exact: true })
      .fill(
        '사용자가 메모를 만들고 저장하고 검색할 수 있는 개인용 웹 서비스를 만들어 주세요. 메모는 작성자만 읽고 수정할 수 있어야 합니다. 제목과 본문을 입력하고 태그를 붙일 수 있게 해 주세요. '.repeat(
          7,
        ),
      );
    await page.getByLabel('수정 이유·출처').fill('직접 구현한 메모 기능의 범위와 운영 방법을 추가합니다.');
    await page.getByRole('button', { name: '수정 제안 보내기' }).click();
    await expect(page).toHaveURL(/\/services\/edits\/[a-f0-9]{36}$/);
    const eid = new URL(page.url()).pathname.split('/').pop();
    expect(await (await editor.request.get('/api/totals')).json()).toEqual(before);
    expect(
      (await action(admin.request, 'services/edits/review', { id: eid, operation: 'accept' })).status(),
    ).toBe(200);
    expect(await (await editor.request.get('/api/totals')).json()).toEqual({
      ...before,
      guides: before.guides + 1,
    });
    await page.goto(origin + '/services/' + sid);
    await expect(page.locator('main')).toContainText('메모 저장');
    await expect(page.locator('main')).toContainText('정기 데이터 백업');
    await page.goto(origin + '/?guide=available&q=' + encodeURIComponent('가이드 추가 ' + salt));
    await expect(page.locator('.tool-row')).toHaveCount(1);
    await expect(page.locator('.tool-row')).not.toContainText('가이드 없음');
  } finally {
    if (sid) await db.run('DELETE FROM services WHERE id=?', sid);
    await db.close();
    for (const c of [owner, editor, admin]) await c.close();
  }
});
