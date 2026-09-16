import { all, one, run, audit, rate } from './db';
import { id } from './security';
import { categoryName } from './apps';
import {
  normalizeServiceUrl,
  serviceSchema,
  parseGuide,
  servicePricing,
  type ServiceGuide,
} from './service-schema';

export interface Service {
  id: string;
  user_id: string | null;
  catalog_slug: string | null;
  name: string;
  website_url: string;
  url_key: string;
  category: string;
  tagline: string;
  description: string;
  pricing: string;
  relationship: 'maker' | 'user';
  image_id: string | null;
  guide: ServiceGuide | null;
  status: string;
  review_note: string;
  revision: number;
  nickname: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  account_status?: string;
  catalog_active?: number;
}
export type ServiceContent = ReturnType<typeof serviceContent>;
export interface ServiceEdit {
  id: string;
  service_id: string;
  user_id: string;
  base_revision: number;
  before_data: ServiceContent;
  after_data: ServiceContent;
  reason: string;
  status: string;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
  nickname?: string;
  name?: string;
  catalog_slug?: string | null;
}
type Viewer = { id: string; role: string } | null | undefined;
export const serviceSelect =
  'SELECT s.*,u.nickname,u.status AS account_status,t.active AS catalog_active FROM services s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN tools t ON t.slug=s.catalog_slug';
export const publicServiceWhere =
  "s.status='published' AND ((s.catalog_slug IS NOT NULL AND t.active=1) OR (s.catalog_slug IS NULL AND u.status='active'))";
export const serviceHref = (s: Pick<Service, 'id' | 'catalog_slug'>) =>
  s.catalog_slug ? '/' + s.catalog_slug : '/services/' + s.id;
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export const publicServiceRows = () => all<Service>(serviceSelect + ' WHERE ' + publicServiceWhere);
export async function publicServices(params: URLSearchParams, size = 18) {
  const q = (params.get('q') || '').trim().slice(0, 100).toLowerCase();
  const category = params.get('category') || '';
  const items = (await publicServiceRows())
    .filter(
      (s) =>
        (!q || (s.name + ' ' + s.tagline).toLowerCase().includes(q)) &&
        (!category || s.category === category),
    )
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || '') || a.id.localeCompare(b.id));
  const total = items.length,
    pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  return { items: items.slice((page - 1) * size, page * size), total, page, pages };
}
export async function visibleService(sid: string, user?: Viewer) {
  const s = await one<Service>(serviceSelect + ' WHERE s.id=?', sid);
  if (!s) return null;
  if (user?.id === s.user_id) return s;
  return s.status === 'published' && (s.catalog_slug ? s.catalog_active === 1 : s.account_status === 'active')
    ? s
    : null;
}
export async function serviceBySlug(slug: string, user?: Viewer) {
  const s = await one<{ id: string }>('SELECT id FROM services WHERE catalog_slug=?', slug);
  return s ? visibleService(s.id, user) : null;
}
export function serviceContent(s: Service) {
  return {
    name: s.name,
    website: s.website_url,
    category: s.category,
    tagline: s.tagline,
    description: s.description,
    pricing: s.pricing,
    relationship: s.relationship,
    image: s.image_id ? '/media/' + s.image_id : '',
    guide: s.guide,
  };
}
export async function locked(sid: unknown, revision?: unknown) {
  const s = await one<Service>('SELECT * FROM services WHERE id=? FOR UPDATE', String(sid || ''));
  if (!s) fail('서비스를 찾을 수 없습니다.', 404);
  if (revision !== undefined && Number(revision) !== s.revision)
    fail('다른 수정이 먼저 반영됐습니다. 새로고침 후 다시 확인해 주세요.', 409);
  return s;
}
export async function validateContent(input: any, userId: string, previous?: Service) {
  const basic = serviceSchema.parse(input);
  const data = { ...basic, guide: parseGuide(input, previous?.guide || null) };
  if (previous?.catalog_slug && !data.guide)
    fail('기존 제작 가이드는 내용을 수정해 주세요. 전체 삭제는 운영자에게 문의해 주세요.');
  const url = normalizeServiceUrl(data.website)!;
  data.website = url.url;
  const duplicate = await one<Service>(
    'SELECT * FROM services WHERE url_key=? AND id<>?',
    url.key,
    previous?.id || '',
  );
  if (duplicate)
    fail('이미 등록되었거나 검토 중인 주소입니다. 기존 항목에서 정보 수정을 이용해 주세요.', 409);
  const image = data.image.slice('/media/'.length) || null;
  if (
    image &&
    image !== previous?.image_id &&
    !(await one('SELECT id FROM uploads WHERE id=? AND user_id=?', image, userId))
  )
    fail('직접 첨부한 이미지나 현재 공개된 이미지를 사용해 주세요.', 403);
  return { data, url, image };
}
export const contentValues = (data: ServiceContent) => [
  data.name,
  data.website,
  normalizeServiceUrl(data.website)!.key,
  data.category,
  data.tagline,
  data.description,
  data.pricing,
  data.relationship,
  data.image.slice('/media/'.length) || null,
  data.guide ? JSON.stringify(data.guide) : null,
];
export async function submitService(input: any, userId: string, sid?: string, revision?: unknown) {
  if (!(await rate('services:' + userId, 15, 86400)))
    fail('등록과 수정 제안은 하루 15회까지 가능합니다.', 429);
  const previous = sid ? await locked(sid, revision) : undefined;
  if (previous && previous.status !== 'published' && previous.user_id !== userId)
    fail('검토 중인 항목은 등록자만 수정할 수 있습니다.', 403);
  if (previous?.status === 'published' && !(await visibleService(previous.id)))
    fail('현재 공개된 서비스만 수정 제안할 수 있습니다.', 403);
  const { data } = await validateContent(input, userId, previous);
  if (previous?.status === 'published') {
    data.relationship = previous.relationship;
    const reason = String(input.change_reason || '').trim();
    if (reason.length < 5 || reason.length > 1000) fail('수정 이유나 확인한 출처를 5~1,000자로 적어주세요.');
    const before = serviceContent(previous);
    if (contentChanges(before, data).length === 0) fail('변경한 내용이 없습니다.');
    if (
      await one(
        "SELECT id FROM service_edits WHERE service_id=? AND user_id=? AND status='pending'",
        sid,
        userId,
      )
    )
      fail('이미 검토 중인 제안이 있습니다. 내 활동에서 확인하거나 취소해 주세요.', 409);
    const editId = id();
    await run(
      'INSERT INTO service_edits(id,service_id,user_id,base_revision,before_data,after_data,reason) VALUES(?,?,?,?,?::jsonb,?::jsonb,?)',
      editId,
      sid,
      userId,
      previous.revision,
      JSON.stringify(before),
      JSON.stringify(data),
      reason,
    );
    await audit(userId, 'service-edit-submit', editId);
    return { serviceId: sid!, editId };
  }
  const serviceId = sid || id();
  if (previous)
    await run(
      "UPDATE services SET name=?,website_url=?,url_key=?,category=?,tagline=?,description=?,pricing=?,relationship=?,image_id=?,guide=?::jsonb,status='pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,published_at=NULL,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?",
      ...contentValues(data),
      sid,
    );
  else
    await run(
      'INSERT INTO services(name,website_url,url_key,category,tagline,description,pricing,relationship,image_id,guide,id,user_id) VALUES(?,?,?,?,?,?,?,?,?,?::jsonb,?,?)',
      ...contentValues(data),
      serviceId,
      userId,
    );
  await audit(userId, sid ? 'service-update' : 'service-submit', serviceId);
  return { serviceId };
}
export async function deleteService(sid: unknown, userId: string, revision: unknown) {
  const s = await locked(sid, revision);
  if (s.user_id !== userId) fail('등록자만 삭제할 수 있습니다.', 403);
  await run('DELETE FROM services WHERE id=?', s.id);
  await audit(userId, 'service-delete', s.id);
}
export async function visibleServiceEdit(eid: string, user?: Viewer) {
  if (!user) return null;
  const e = await one<ServiceEdit>(
    'SELECT e.*,s.name,s.catalog_slug,u.nickname FROM service_edits e JOIN services s ON s.id=e.service_id JOIN users u ON u.id=e.user_id WHERE e.id=?',
    eid,
  );
  return e && e.user_id === user.id ? e : null;
}
export async function cancelServiceEdit(eid: unknown, userId: string) {
  const e = await one<ServiceEdit>('SELECT * FROM service_edits WHERE id=? FOR UPDATE', String(eid || ''));
  if (!e || e.user_id !== userId) fail('본인의 수정 제안만 취소할 수 있습니다.', 403);
  if (e.status !== 'pending') fail('이미 처리된 제안입니다.', 409);
  await run("UPDATE service_edits SET status='cancelled' WHERE id=?", e.id);
  await audit(userId, 'service-edit-cancel', e.id);
}
export function contentChanges(before: ServiceContent, after: ServiceContent) {
  const fields: Record<string, string> = {
    name: '서비스 이름',
    website: '서비스 주소',
    category: '분야',
    tagline: '한 줄 소개',
    description: '상세 소개',
    pricing: '요금 방식',
    image: '이미지',
  };
  const display = (key: string, v: any) =>
    v === null
      ? '없음'
      : key === 'category'
        ? categoryName(v)
        : key === 'pricing'
          ? servicePricing[v] || v
          : String(v || '없음');
  const result = Object.entries(fields)
    .filter(([key]) => JSON.stringify((before as any)[key]) !== JSON.stringify((after as any)[key]))
    .map(([key, label]) => ({
      key,
      label,
      before: display(key, (before as any)[key]),
      after: display(key, (after as any)[key]),
    }));
  const guideFields: Record<string, string> = {
    scope: '제작 범위',
    verdict: '대체 가능성',
    verdictReason: '판단 이유',
    difficulty: '제작 난이도',
    features: '만들 기능',
    whatYouLose: '제외할 기능',
    operations: '운영 시 필요한 것',
    prompt: '제작 프롬프트',
  };
  const format = (key: string, v: any) =>
    Array.isArray(v)
      ? v.join('\n')
      : key === 'verdict'
        ? ({ yes: '대체 가능', kinda: '일부 대체 가능', no: '대체 어려움' } as any)[v] || '없음'
        : String(v || '없음');
  for (const [key, label] of Object.entries(guideFields)) {
    const b = (before.guide as any)?.[key],
      a = (after.guide as any)?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b))
      result.push({ key: 'guide.' + key, label, before: format(key, b), after: format(key, a) });
  }
  return result;
}
