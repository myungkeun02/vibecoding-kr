import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
export const dataDir = resolve(process.env.DATA_DIR || 'data/private');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const localSecret = resolve(dataDir, '.session-secret');
if (!process.env.SESSION_SECRET && !existsSync(localSecret))
  writeFileSync(localSecret, randomBytes(48).toString('hex'), { mode: 0o600 });
export const production = process.env.APP_ENV === 'production';
export const secret = process.env.SESSION_SECRET || readFileSync(localSecret, 'utf8');
export const siteUrl = (process.env.SITE_URL || 'http://localhost:8095').replace(/\/$/, '');
if (
  production &&
  (!process.env.SESSION_SECRET ||
    secret.length < 32 ||
    !siteUrl.startsWith('https://') ||
    !process.env.DATA_DIR?.startsWith('/'))
)
  throw new Error('운영 환경은 HTTPS SITE_URL, 절대 DATA_DIR, 32자 이상 SESSION_SECRET이 필요합니다.');
export const brand = {
  name: '바이브코딩가능?',
  en: 'Can I Vibecode It? KR',
  description:
    '내가 쓰는 기능만, 직접 만들 수 있을까? 도구별 대체 가능성과 제작 프롬프트, 솔직한 제작 후기를 만나보세요.',
};
export const absolute = (path: string) => new URL(path, siteUrl).href;
export const boards: Record<string, string> = {
  builds: '제작 후기·작품',
  questions: '질문·도움',
  prompts: '프롬프트 연구',
  general: '자유 토론',
  notice: '공지',
};
export const verdicts = {
  yes: { label: '대체 가능', en: 'YES', symbol: '↗' },
  kinda: { label: '일부 대체 가능', en: 'KINDA', symbol: '≈' },
  no: { label: '대체 어려움', en: 'NOT REALLY', symbol: '×' },
};
export const money = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');
