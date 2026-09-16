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
    .min(1, '서비스 이름을 입력해 주세요.')
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

export const guideSchema = z.object({
  verdict: z.enum(['yes', 'kinda', 'no']),
  scope: z.string().trim().min(15, '제작 범위는 15자 이상 입력해 주세요.').max(2000),
  verdictReason: z.string().trim().min(30, '판단 이유는 30자 이상 입력해 주세요.').max(3000),
  difficulty: z.enum(['입문', '중급', '고급']),
  features: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  whatYouLose: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  operations: z.array(z.string().trim().min(1).max(500)).max(30),
  prompt: z.string().trim().min(500, '제작 프롬프트는 500자 이상 입력해 주세요.').max(20000),
});
export type ServiceGuide = z.infer<typeof guideSchema>;
export function parseGuide(input: any, previous: ServiceGuide | null = null) {
  if (input.guide_mode === undefined) return previous;
  if (input.guide_mode === 'none') return null;
  if (input.guide_mode !== 'present')
    throw Object.assign(new Error('가이드 입력 방식을 확인해 주세요.'), { status: 400 });
  const lines = (value: unknown) =>
    String(value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  return guideSchema.parse({
    verdict: input.guide_verdict,
    scope: input.guide_scope,
    verdictReason: input.guide_reason,
    difficulty: input.guide_difficulty,
    features: lines(input.guide_features),
    whatYouLose: lines(input.guide_limits),
    operations: lines(input.guide_operations),
    prompt: input.guide_prompt,
  });
}
export const editStatuses: Record<string, string> = {
  pending: '검토 중',
  accepted: '반영 완료',
  rejected: '보완 필요',
  cancelled: '취소됨',
};
