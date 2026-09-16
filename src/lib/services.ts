import { all, one, run, audit, rate } from './db';
import { apps } from './apps';
import { id } from './security';
import { normalizeServiceUrl, serviceSchema } from './service-schema';

export interface Service {
  id: string;
  user_id: string;
  name: string;
  website_url: string;
  url_key: string;
  category: string;
  tagline: string;
  description: string;
  pricing: string;
  relationship: string;
  image_id: string | null;
  status: string;
  review_note: string;
  revision: number;
  nickname: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}
type Viewer = { id: string; role: string } | null | undefined;
const select = 'SELECT s.*,u.nickname FROM services s JOIN users u ON u.id=s.user_id';
function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export async function publicServices(params: URLSearchParams, size = 18) {
  const q = (params.get('q') || '')
    .trim()
    .slice(0, 100)
    .replace(/[\\%_]/g, '\\$&');
  const category = params.get('category') || '';
  const where =
    " WHERE s.status='published' AND u.status='active' AND (s.name ILIKE ? OR s.tagline ILIKE ?) AND (?='' OR s.category=?)";
  const args = ['%' + q + '%', '%' + q + '%', category, category];
  const total = (await one(select.replace('s.*,u.nickname', 'COUNT(*) AS n') + where, ...args))!.n;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  return {
    items: await all<Service>(
      select + where + ' ORDER BY s.published_at DESC,s.id LIMIT ? OFFSET ?',
      ...args,
      size,
      (page - 1) * size,
    ),
    total,
    page,
    pages,
  };
}
export async function visibleService(sid: string, user?: Viewer) {
  const service = await one<Service>(select + ' WHERE s.id=?', sid);
  if (!service) return null;
  if (user?.role === 'admin' || user?.id === service.user_id) return service;
  if (
    service.status !== 'published' ||
    !(await one("SELECT id FROM users WHERE id=? AND status='active'", service.user_id))
  )
    return null;
  return service;
}
async function editable(sid: unknown, userId: string, revision: unknown, admin = false) {
  const service = await one<Service>('SELECT * FROM services WHERE id=? FOR UPDATE', String(sid || ''));
  if (!service) fail('등록한 서비스를 찾을 수 없어요.', 404);
  if (!admin && service.user_id !== userId) fail('등록한 사람만 변경할 수 있어요.', 403);
  if (Number(revision) !== service.revision)
    fail('등록 내용이 변경됐어요. 새로고침 후 다시 확인해 주세요.', 409);
  return service;
}
export async function submitService(input: unknown, userId: string, sid?: string, revision?: unknown) {
  if (!(await rate('services:' + userId, 15, 86400)))
    fail('서비스 등록과 수정은 하루 15회까지 가능해요.', 429);
  if (sid) await editable(sid, userId, revision);
  const data = serviceSchema.parse(input);
  const website = normalizeServiceUrl(data.website)!;
  const existing = apps.find((a) => normalizeServiceUrl(a.officialUrl)?.key === website.key);
  if (existing)
    fail(`이미 등록된 도구예요. ${existing.nameKo} 상세 화면에서 정보 수정 제안을 남겨주세요.`, 409);
  if (await one('SELECT id FROM services WHERE url_key=? AND id<>?', website.key, sid || ''))
    fail('이미 접수되거나 공개된 서비스 주소예요. 등록 목록과 내 활동을 확인해 주세요.', 409);
  const image = data.image.slice('/media/'.length) || null;
  if (image && !(await one('SELECT id FROM uploads WHERE id=? AND user_id=?', image, userId)))
    fail('직접 올린 이미지만 첨부할 수 있어요.', 403);
  const values = [
    data.name,
    website.url,
    website.key,
    data.category,
    data.tagline,
    data.description,
    data.pricing,
    data.relationship,
    image,
  ];
  const serviceId = sid || id();
  if (sid)
    await run(
      "UPDATE services SET name=?,website_url=?,url_key=?,category=?,tagline=?,description=?,pricing=?,relationship=?,image_id=?,status='pending',review_note='',reviewed_by=NULL,reviewed_at=NULL,published_at=NULL,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?",
      ...values,
      sid,
    );
  else
    await run(
      'INSERT INTO services(name,website_url,url_key,category,tagline,description,pricing,relationship,image_id,id,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      ...values,
      serviceId,
      userId,
    );
  await audit(userId, sid ? 'service-update' : 'service-submit', serviceId);
  return serviceId;
}
export async function deleteService(sid: unknown, userId: string, revision: unknown) {
  const service = await editable(sid, userId, revision);
  await run('DELETE FROM services WHERE id=?', service.id);
  await audit(userId, 'service-delete', service.id);
}
export async function reviewService(input: any, reviewer: string) {
  const service = await editable(input.id, reviewer, input.revision, true);
  const operation = input.operation;
  const note = String(input.note || '').trim();
  if (!['publish', 'reject', 'hide'].includes(operation) || note.length > 1000)
    fail('검토 내용과 작업을 확인해 주세요.');
  if (operation !== 'publish' && note.length < 5) fail('보완 또는 공개 중지 이유를 5자 이상 적어주세요.');
  if (operation === 'hide' ? service.status !== 'published' : !['pending', 'hidden'].includes(service.status))
    fail('처리 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.', 409);
  const status = operation === 'publish' ? 'published' : operation === 'reject' ? 'rejected' : 'hidden';
  await run(
    "UPDATE services SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE NULL END,revision=revision+1 WHERE id=?",
    status,
    note,
    reviewer,
    status,
    service.id,
  );
  await audit(reviewer, 'service-' + operation, service.id);
}
