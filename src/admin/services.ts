import { one, run, audit } from '../lib/db';
import { id } from '../lib/security';
import { locked, validateContent, contentValues, type ServiceEdit } from '../lib/services';
import { adminFail as fail } from './config';

function requireRevision(input: any) {
  if (!Number.isInteger(Number(input.revision)) || Number(input.revision) < 1)
    fail('최신 화면에서 다시 요청해 주세요. 수정 버전이 필요합니다.');
}
export async function reviewService(input: any, reviewer: string) {
  requireRevision(input);
  const s = await locked(input.id, input.revision),
    operation = input.operation,
    note = String(input.note || '').trim();
  if (!['publish', 'reject', 'hide'].includes(operation) || note.length > 1000)
    fail('검토 내용과 작업을 확인해 주세요.');
  if (operation !== 'publish' && note.length < 5) fail('보완 또는 공개 중지 이유를 5자 이상 적어주세요.');
  if (operation === 'hide' ? s.status !== 'published' : !['pending', 'hidden', 'rejected'].includes(s.status))
    fail('처리 상태가 바뀌었습니다. 새로고침해 주세요.', 409);
  const status = operation === 'publish' ? 'published' : operation === 'reject' ? 'rejected' : 'hidden';
  await run(
    "UPDATE services SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,published_at=CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE NULL END,revision=revision+1 WHERE id=?",
    status,
    note,
    reviewer,
    status,
    s.id,
  );
  await audit(reviewer, 'service-' + operation, s.id);
}
export async function reviewServiceEdit(input: any, reviewer: string) {
  const ref = await one<{ service_id: string }>(
    'SELECT service_id FROM service_edits WHERE id=?',
    String(input.id || ''),
  );
  if (!ref) fail('이미 처리되었거나 없는 제안입니다.', 409);
  // Match submission/deletion lock order: service first, then its proposal.
  const s = await locked(ref.service_id);
  const e = await one<ServiceEdit>(
    'SELECT * FROM service_edits WHERE id=? FOR UPDATE',
    String(input.id || ''),
  );
  if (!e || e.status !== 'pending') fail('이미 처리되었거나 없는 제안입니다.', 409);
  const operation = input.operation,
    note = String(input.note || '').trim();
  if (!['accept', 'reject'].includes(operation) || note.length > 1000) fail('검토 내용을 확인해 주세요.');
  if (operation === 'reject' && note.length < 5) fail('보완할 내용을 5자 이상 적어주세요.');
  if (operation === 'accept') {
    if (s.revision !== e.base_revision)
      fail('다른 수정이 먼저 반영됐습니다. 최신 내용으로 다시 제안해 주세요.', 409);
    if (s.status !== 'published') fail('서비스 공개 상태가 변경됐습니다. 다시 확인해 주세요.', 409);
    if (!(await one("SELECT id FROM users WHERE id=? AND status='active'", e.user_id)))
      fail('제안자의 계정 상태를 확인해 주세요.', 409);
    if (
      e.after_data.image &&
      !(await one('SELECT id FROM uploads WHERE id=?', e.after_data.image.slice('/media/'.length)))
    )
      fail('제안에 첨부한 이미지가 삭제됐습니다.', 409);
    await run(
      'UPDATE services SET name=?,website_url=?,url_key=?,category=?,tagline=?,description=?,pricing=?,relationship=?,image_id=?,guide=?::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=? WHERE id=?',
      ...contentValues(e.after_data),
      reviewer,
      s.id,
    );
  }
  await run(
    'UPDATE service_edits SET status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?',
    operation === 'accept' ? 'accepted' : 'rejected',
    note,
    reviewer,
    e.id,
  );
  await audit(reviewer, 'service-edit-' + operation, e.id);
}

export async function saveService(input: any, userId: string) {
  if (input.id) requireRevision(input);
  if (!['pending', 'published', 'hidden'].includes(input.publication)) fail('공개 상태를 선택해 주세요.');
  const previous = input.id ? await locked(input.id, input.revision) : undefined;
  const { data } = await validateContent(input, userId, previous);
  const sid = previous?.id || id();
  const status = input.publication;
  if (previous)
    await run(
      `UPDATE services SET name=?,website_url=?,url_key=?,category=?,tagline=?,description=?,pricing=?,relationship=?,image_id=?,guide=?::jsonb,status=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?`,
      ...contentValues(data),
      status,
      userId,
      status,
      sid,
    );
  else
    await run(
      `INSERT INTO services(name,website_url,url_key,category,tagline,description,pricing,relationship,image_id,guide,status,user_id,id,published_at,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,CASE WHEN ?='published' THEN CURRENT_TIMESTAMP END,?,CURRENT_TIMESTAMP)`,
      ...contentValues(data),
      status,
      userId,
      sid,
      status,
      userId,
    );
  await audit(userId, 'admin-service-save', sid);
  return sid;
}
