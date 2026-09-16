import { z } from 'zod';
import { isIP } from 'node:net';
import { categories } from './apps';

export const servicePricing: Record<string, string> = {
  free: '무료',
  freemium: '무료 + 유료',
  subscription: '구독형',
  'one-time': '한 번 구매',
  'usage-based': '사용한 만큼 결제',
  'contact-sales': '견적 문의',
  unknown: '확인 필요',
};
export const serviceStatuses: Record<string, string> = {
  pending: '검토 중',
  published: '공개됨',
  rejected: '보완 필요',
  hidden: '공개 중지',
};

export function normalizeServiceUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isIP(host.replace(/^\[|\]$/g, '')) ||
      !host.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) ||
      !/^[a-z0-9.-]+$/.test(host)
    )
      return null;
    url.hostname = host;
    url.hash = '';
    url.search = '';
    return {
      url: url.href,
      key:
        host.replace(/^www\./, '') +
        (url.port ? ':' + url.port : '') +
        url.pathname.replace(/^\/intl\/[a-z]{2}(?:-[a-z]{2})?\/?$/i, '/').replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

export const serviceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, '서비스 이름은 2자 이상 입력해 주세요.')
    .max(80, '서비스 이름은 80자 이내로 입력해 주세요.'),
  website: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => Boolean(normalizeServiceUrl(v)), '공개된 서비스의 http 또는 https 주소를 입력해 주세요.'),
  category: z.string().refine((v) => categories.some((c) => c.slug === v), '서비스 분야를 선택해 주세요.'),
  tagline: z
    .string()
    .trim()
    .min(10, '한 줄 소개는 10자 이상 입력해 주세요.')
    .max(160, '한 줄 소개는 160자 이내로 입력해 주세요.'),
  description: z
    .string()
    .trim()
    .min(30, '상세 소개는 30자 이상 입력해 주세요.')
    .max(5000, '상세 소개는 5,000자 이내로 입력해 주세요.'),
  pricing: z.string().refine((v) => Object.hasOwn(servicePricing, v), '요금 방식을 선택해 주세요.'),
  relationship: z.enum(['maker', 'user']),
  image: z
    .string()
    .regex(/^(?:\/media\/[a-f0-9]{36})?$/, '첨부 이미지를 다시 확인해 주세요.')
    .default(''),
});
