import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';

test('all tool icons load locally, survive filtering and fall back after image failure', async ({
  page,
  request,
}) => {
  const icons = JSON.parse(readFileSync('data/icons.json', 'utf8'));
  const apps = readdirSync('data/apps')
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync('data/apps/' + file, 'utf8')))
    .filter((app) => app.published);
  for (const app of apps) {
    expect(icons[app.slug]?.src, app.slug).toMatch(/^\/icons\/[a-z0-9-]+\.webp$/);
    const response = await request.get(icons[app.slug].src);
    expect(response.status(), app.slug).toBe(200);
    expect(response.headers()['content-type']).toContain('image/webp');
    const metadata = await sharp(await response.body()).metadata();
    expect([metadata.width, metadata.height], app.slug).toEqual([96, 96]);
  }
  // Products from the same vendor must not regress to a shared corporate favicon.
  for (const family of [
    ['microsoft-excel', 'microsoft-word', 'microsoft-powerpoint', 'microsoft-teams', 'onedrive', 'onenote'],
    [
      'google-docs',
      'google-sheets',
      'google-slides',
      'google-drive',
      'google-chat',
      'google-calendar',
      'google-forms',
    ],
    ['photoshop', 'illustrator', 'premiere-pro', 'adobe-audition'],
    ['figma', 'figjam'],
  ])
    expect(new Set(family.map((slug) => icons[slug].sha256)).size).toBe(family.length);

  const externalImages: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'image' && new URL(r.url()).origin !== 'http://127.0.0.1:8096')
      externalImages.push(r.url());
  });
  const loadedIcons = () =>
    page
      .locator('[data-tool-icon-image]')
      .evaluateAll(
        (images) =>
          images.length > 0 && images.every((image) => (image as HTMLImageElement).naturalWidth === 96),
      );
  await page.goto('/');
  await expect.poll(loadedIcons).toBe(true);
  await page.getByLabel('도구 검색', { exact: true }).fill('Excel');
  const excel = page.locator('[data-tool-icon="microsoft-excel"]');
  await expect(excel).toBeVisible();
  await expect(excel.locator('img')).toHaveAttribute('src', icons['microsoft-excel'].src);
  await expect.poll(loadedIcons).toBe(true);
  await page.goto('/microsoft-excel');
  expect(await page.locator('[data-tool-icon-image]').count()).toBeGreaterThan(1);
  await expect.poll(loadedIcons).toBe(true);
  expect(externalImages).toEqual([]);

  await page.route('**/icons/*', (route) => route.abort('failed'));
  await page.goto('/');
  const firstIcon = page.locator('[data-tool-icon]').first();
  await expect(firstIcon.locator('[data-tool-icon-fallback]')).toBeVisible();
  await expect(firstIcon.locator('img')).toBeHidden();
  await expect(firstIcon).not.toHaveClass(/has-image/);
  await page.getByLabel('도구 검색', { exact: true }).fill('Excel');
  await expect(excel.locator('[data-tool-icon-fallback]')).toBeVisible();
  await expect(excel.locator('img')).toBeHidden();
});
