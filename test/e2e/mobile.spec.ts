import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { connectE2EDatabase } from '../../scripts/test-database.mjs';

const origin = 'http://127.0.0.1:8096';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async () => {
  const db = connectE2EDatabase();
  await db.run('DELETE FROM rate_limits');
  await db.close();
});
async function capture(page: Page, name: string) {
  mkdirSync('docs/qa/screenshots', { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/qa/screenshots/mobile-${name}.png`, animations: 'disabled' });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test('mobile discovery uses cards, filter sheet, cancellation, URL history and reachable pagination', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: '모바일 주요 메뉴' })).toBeVisible();
  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.tool-table-head')).toBeHidden();
  await expect(page.locator('.tool-row').first()).toBeInViewport();
  await expect(page.locator('.tool-row .tool-summary').first()).toBeVisible();
  await capture(page, 'home-dark-390');
  await page.getByLabel('도구 검색', { exact: true }).fill('엑셀');
  await expect(page.locator('.tool-row')).toHaveCount(1);
  await expect(page.locator('.tool-row')).toContainText('Microsoft Excel');
  await page.getByLabel('도구 검색', { exact: true }).fill('');
  await expect(page.locator('.tool-row')).toHaveCount(20);
  await page.getByRole('button', { name: '필터·정렬' }).click();
  const dialog = page.getByRole('dialog', { name: '필터와 정렬' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('대체 가능성 선택', { exact: true }).selectOption('yes');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#mobile-filter-trigger')).toBeFocused();
  await expect(page).not.toHaveURL(/verdict/);
  await page.locator('#mobile-filter-trigger').click();
  await expect(page.getByLabel('대체 가능성 선택', { exact: true })).toHaveValue('');
  await page.getByLabel('대체 가능성 선택', { exact: true }).selectOption('yes');
  await page.getByLabel('요금 방식 선택', { exact: true }).selectOption('free');
  await capture(page, 'filters');
  await page.getByRole('button', { name: '선택한 조건으로 보기' }).click();
  await expect(page).toHaveURL(/verdict=yes/);
  await expect(page).toHaveURL(/price=free/);
  await expect(page.locator('.mobile-active-filters a')).toHaveCount(2);
  await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
  await expect(page.locator('#mobile-filter-trigger')).toBeFocused();
  await page.reload();
  await page.locator('#mobile-filter-trigger').click();
  await expect(page.getByLabel('요금 방식 선택', { exact: true })).toHaveValue('free');
  await page.getByRole('link', { name: '조건 초기화', exact: true }).click();
  await expect(page.locator('.tool-row')).toHaveCount(20);
  await page.goBack();
  await expect(page.locator('.mobile-active-filters a')).toHaveCount(2);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: '도구 목록 페이지' })
    .getByRole('link', { name: '다음' })
    .click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('#mobile-results-title')).toBeInViewport();
  await expect(page.locator('.mobile-pagination strong')).toHaveText('2');
  await page
    .getByRole('navigation', { name: '분야 선택' })
    .getByRole('link', { name: '노트·지식관리' })
    .click();
  await expect(page).toHaveURL(/category=notes/);
  await expect(page.locator('.mobile-pagination strong')).toHaveText('1');
  await page.goto('/category/notes');
  await page
    .getByRole('navigation', { name: '분야 선택' })
    .getByRole('link', { name: '전체', exact: true })
    .click();
  await expect(page).toHaveURL(/\/\??#directory$/);
  await expect(page.locator('.mobile-home-intro')).toBeVisible();
  await noOverflow(page);
});

test('mobile detail switches sections, copies complete agent prompts and restores desktop content', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/slack');
  await expect(page.locator('#tool-overview')).toBeVisible();
  await expect(page.locator('#tool-prompt')).toBeHidden();
  await capture(page, 'tool-overview');
  await page.locator('.mobile-detail-action a').click();
  await expect(page).toHaveURL(/#tool-prompt$/);
  await expect(page.locator('#tool-prompt')).toBeVisible();
  await expect(page.locator('#tool-overview')).toBeHidden();
  await expect(page.locator('.mobile-detail-action')).toBeHidden();
  for (const agent of ['Claude Code', 'Codex', 'Cursor']) {
    await page.getByRole('button', { name: agent + '용 복사' }).click();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain(agent);
    expect(text).toContain('채널별 메시지');
    expect(text).toContain('이번에 만들지 않는 기능');
  }
  await page.goto('/slack#tool-prompt');
  await capture(page, 'tool-prompt');
  await page.locator('.mobile-detail-tabs a[data-detail-view=reference]').click();
  await expect(page.locator('#tool-pricing')).toBeVisible();
  await page.locator('.faq summary').first().click();
  await expect(page.locator('.faq details').first()).toHaveAttribute('open', '');
  await page.goBack();
  await expect(page.locator('#tool-prompt')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const panel of ['#tool-overview', '#tool-prompt', '#tool-pricing'])
    await expect(page.locator(panel)).toBeVisible();
  await expect(page.locator('.mobile-tabbar')).toBeHidden();
  await expect(page.locator('.site-header')).toBeVisible();
  await noOverflow(page);
});

test('mobile navigation, themes, small screens and no-JavaScript filtering remain usable', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [360, 390, 760, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      '/',
      '/slack',
      '/community',
      '/login',
      '/signup',
      '/stats',
      '/suggest',
      '/notifications',
      '/not-a-tool',
    ]) {
      await page.goto(path);
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: '화면 테마 전환' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await capture(page, 'home-light-360');
  await page.locator('.mobile-tabbar').getByRole('link', { name: '이야기', exact: true }).click();
  await capture(page, 'community-light-360');
  await page.getByRole('link', { name: '이야기 쓰기', exact: true }).click();
  await expect(page).toHaveURL(/login\?returnTo=%2Fcommunity%2Fnew/);
  await capture(page, 'login-light-360');
  await page.locator('.mobile-tabbar').getByRole('link', { name: '내 활동' }).click();
  await expect(page).toHaveURL(/login\?returnTo=\/me/);
  await page.goto('/');
  await page.getByLabel('도구 검색', { exact: true }).fill('찾을수없는도구zzz');
  await expect(page.getByText('검색 조건에 맞는 도구가 없어요.')).toBeVisible();
  expect(errors).toEqual([]);
  const plainContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const plain = await plainContext.newPage();
  await plain.goto(origin + '/');
  await plain.getByLabel('요금 방식 선택', { exact: true }).selectOption('one-time');
  await plain.getByRole('button', { name: '선택한 조건으로 보기' }).click();
  await expect(plain).toHaveURL(/price=one-time/);
  await expect(plain.locator('.tool-row[href="/upnote"]')).toBeVisible();
  await noOverflow(plain);
  await plainContext.close();
});

test('mobile writing, editing, bookmarks and profile are usable with a real session', async ({ page }) => {
  const salt = randomBytes(5).toString('hex');
  await page.goto('/signup');
  await page.getByLabel('이메일', { exact: true }).fill(`mobile-${salt}@example.test`);
  await page.getByLabel('닉네임', { exact: true }).fill('모바일제작자_' + salt);
  await page.getByLabel('비밀번호', { exact: true }).fill(randomBytes(20).toString('hex'));
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '가입하기' }).click();
  await expect(page).toHaveURL(/\/me$/);
  await page.goto('/slack');
  await page.locator('[data-bookmark]').click();
  await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/community/new');
  await page.getByLabel('게시판', { exact: true }).selectOption('builds');
  await page.getByLabel('관련 도구 (선택)', { exact: true }).selectOption('slack');
  await page.getByLabel('제목', { exact: true }).fill('휴대폰에서 남긴 제작 이야기');
  await page
    .getByLabel('본문 · 마크다운 지원', { exact: true })
    .fill('작은 화면에서도 도구를 찾고 제작 과정을 편하게 기록했습니다.');
  await noOverflow(page);
  await capture(page, 'editor');
  await page.getByRole('button', { name: '이야기 게시하기' }).click();
  await expect(page.getByRole('heading', { name: '휴대폰에서 남긴 제작 이야기' })).toBeVisible();
  await page.getByRole('link', { name: '글 수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('휴대폰에서 수정한 제작 이야기');
  await page.getByRole('button', { name: '수정 내용 저장' }).click();
  await expect(page.getByRole('heading', { name: '휴대폰에서 수정한 제작 이야기' })).toBeVisible();
  await page.getByLabel('댓글 남기기').fill('모바일에서도 잘 작성됩니다.');
  await page.getByRole('button', { name: '댓글 등록' }).click();
  await expect(page.locator('.comment > p')).toContainText('모바일에서도 잘 작성됩니다.');
  await page.goto('/me');
  await expect(page.locator('#saved-tools')).toBeInViewport();
  await page.getByRole('link', { name: '프로필 설정' }).click();
  await page.getByLabel('소개', { exact: true }).fill('휴대폰에서 만드는 사람');
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/profile/update') && response.status() === 200,
    ),
    page.getByRole('button', { name: '프로필 저장', exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel('소개', { exact: true })).toHaveValue('휴대폰에서 만드는 사람');
  await noOverflow(page);
});
