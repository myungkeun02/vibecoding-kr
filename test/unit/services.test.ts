import { test, expect } from 'vitest';
import { normalizeServiceUrl, serviceSchema } from '../../src/lib/service-schema';

test('service addresses reject executable/private destinations and normalize tracking duplicates', () => {
  for (const address of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.com',
    'https://name:secret@example.com',
    'http://127.0.0.1',
    'http://2130706433',
    'http://[::1]',
    'http://localhost',
    'https://app.localhost',
    'https://demo.internal',
  ])
    expect(normalizeServiceUrl(address), address).toBeNull();
  expect(normalizeServiceUrl('https://www.Example.com/?utm_source=test#section')?.key).toBe(
    normalizeServiceUrl('http://example.com')?.key,
  );
  expect(normalizeServiceUrl('https://example.com/product-a/')?.key).not.toBe(
    normalizeServiceUrl('https://example.com/product-b')?.key,
  );
  expect(normalizeServiceUrl('https://example.com/path?utm_source=share')?.url).toBe(
    'https://example.com/path',
  );
});

test('submission schema rejects remote images, invalid categories and excessive text', () => {
  const valid = {
    name: '새로운 서비스',
    website: 'https://example.com',
    category: 'notes',
    tagline: '메모를 편하게 모아두는 서비스입니다.',
    description: '매일 남기는 메모와 자료를 한 곳에 모으고 검색해 다시 찾아볼 수 있는 서비스입니다.',
    pricing: 'free',
    relationship: 'user',
    image: '',
  };
  expect(serviceSchema.safeParse(valid).success).toBe(true);
  for (const extra of [
    { image: 'https://example.com/logo.svg' },
    { category: 'not-a-category' },
    { name: 'A'.repeat(81) },
    { description: '짧음' },
    { relationship: 'admin' },
    { pricing: 'made-up' },
  ])
    expect(serviceSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
});
