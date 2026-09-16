import { one, run, all } from '../lib/db';
import { id, email, passwordHash } from '../lib/security';
import { adminFail as fail } from './config';
import type { AdminIdentity } from './auth';
import { z } from 'zod';
export async function logAdmin(
  actor: string,
  action: string,
  type: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  await run(
    'INSERT INTO admin_audit(actor,action,target_type,target_id,details) VALUES(?,?,?,?,?::jsonb)',
    actor,
    action,
    type,
    target,
    JSON.stringify(details),
  );
}
export async function grantAdmin(input: any, actor: AdminIdentity) {
  if (actor.role !== 'owner') fail('최초 관리자만 권한을 부여할 수 있습니다.', 403);
  await one('SELECT pg_advisory_xact_lock(81260423)');
  const address = email(input.email);
  if (!address) fail('Google 계정 이메일을 확인해 주세요.');
  let member = await one('SELECT * FROM admin_members WHERE lower(email)=lower(?) FOR UPDATE', address);
  if (member?.role === 'owner') fail('최초 관리자 권한은 변경할 수 없습니다.', 409);
  if (member?.status === 'active') fail('이미 관리자 권한이 있습니다.', 409);
  if (member)
    await run(
      "UPDATE admin_members SET status='active',granted_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      actor.id,
      member.id,
    );
  else {
    member = { id: id() };
    await run(
      "INSERT INTO admin_members(id,email,role,granted_by) VALUES(?,?,'admin',?)",
      member.id,
      address,
      actor.id,
    );
  }
  await logAdmin(actor.id, 'admin-grant', 'admin', member.id, { email: address });
  return member.id;
}
export async function revokeAdmin(target: string, actor: AdminIdentity) {
  if (actor.role !== 'owner') fail('최초 관리자만 권한을 회수할 수 있습니다.', 403);
  await one('SELECT pg_advisory_xact_lock(81260423)');
  const m = await one('SELECT * FROM admin_members WHERE id=? FOR UPDATE', target);
  if (!m) fail('관리자를 찾을 수 없습니다.', 404);
  if (m.role === 'owner' || m.id === actor.id) fail('최초 관리자와 본인의 권한은 회수할 수 없습니다.', 409);
  await run("UPDATE admin_members SET status='revoked',updated_at=CURRENT_TIMESTAMP WHERE id=?", target);
  await run('DELETE FROM admin_sessions WHERE member_id=?', target);
  await logAdmin(actor.id, 'admin-revoke', 'admin', target);
}
export async function userStatus(target: string, status: string, actor: AdminIdentity) {
  if (!['active', 'suspended'].includes(status)) fail('회원 상태를 확인해 주세요.');
  if (target === actor.user_id) fail('본인 계정은 제한할 수 없습니다.', 409);
  const u = await one('SELECT id FROM users WHERE id=? FOR UPDATE', target);
  if (!u) fail('회원을 찾을 수 없습니다.', 404);
  if (await one("SELECT id FROM admin_members WHERE user_id=? AND status='active'", target))
    fail('관리자 권한을 먼저 회수해 주세요.', 409);
  await run('UPDATE users SET status=? WHERE id=?', status, target);
  await run('DELETE FROM sessions WHERE user_id=?', target);
  await run(
    'DELETE FROM admin_sessions WHERE member_id IN (SELECT id FROM admin_members WHERE user_id=?)',
    target,
  );
  await logAdmin(actor.id, status === 'active' ? 'user-restore' : 'user-suspend', 'user', target);
}
export async function createUser(input: any, actor: AdminIdentity) {
  const address = email(input.email),
    nickname = String(input.nickname || '').trim();
  if (!address) fail('이메일 형식을 확인해 주세요.');
  if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(nickname)) fail('닉네임은 한글·영문·숫자 2~24자로 입력해 주세요.');
  if (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128)
    fail('초기 비밀번호는 10~128자로 입력해 주세요.');
  const uid = id();
  await run(
    'INSERT INTO users(id,email,nickname,password) VALUES(?,?,?,?)',
    uid,
    address,
    nickname,
    await passwordHash(input.password),
  );
  await logAdmin(actor.id, 'user-create', 'user', uid, { source: 'admin' });
  return uid;
}
export async function moderate(kind: string, target: string, operation: string, actor: AdminIdentity) {
  const table = (
    { posts: 'posts', comments: 'comments', reports: 'reports', suggestions: 'suggestions' } as Record<
      string,
      string
    >
  )[kind];
  if (!table || (['reports', 'suggestions'].includes(kind) && !/^[1-9][0-9]{0,14}$/.test(target)))
    fail('대상을 확인해 주세요.');
  const item = await one(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`, target);
  if (!item) fail('대상을 찾을 수 없습니다.', 404);
  if (['posts', 'comments'].includes(kind)) {
    if (item.status === 'deleted') fail('삭제된 내용은 복구하거나 변경할 수 없습니다.', 409);
    if (kind === 'posts' && ['pin', 'unpin'].includes(operation))
      await run('UPDATE posts SET pinned=? WHERE id=?', operation === 'pin' ? 1 : 0, target);
    else if (['hide', 'restore'].includes(operation))
      await run(
        `UPDATE ${table} SET status=? WHERE id=?`,
        operation === 'hide' ? 'hidden' : 'active',
        target,
      );
    else fail('조치를 확인해 주세요.');
  } else if (kind === 'reports') {
    if (!['resolve', 'dismiss'].includes(operation)) fail('조치를 확인해 주세요.');
    await run(
      'UPDATE reports SET status=? WHERE id=?',
      operation === 'resolve' ? 'resolved' : 'dismissed',
      target,
    );
  } else {
    if (!['accept', 'reject'].includes(operation)) fail('조치를 확인해 주세요.');
    await run(
      'UPDATE suggestions SET status=? WHERE id=?',
      operation === 'accept' ? 'accepted_pending_release' : 'rejected',
      target,
    );
  }
  await logAdmin(actor.id, kind + '-' + operation, kind, target);
}
export async function saveNotice(input: any, actor: AdminIdentity) {
  const data = z
    .object({ title: z.string().trim().min(3).max(140), body: z.string().trim().min(10).max(30000) })
    .parse(input);
  const pid = id();
  await run(
    "INSERT INTO posts(id,user_id,title,body,board,pinned) VALUES(?,?,?,?,'notice',1)",
    pid,
    actor.user_id,
    data.title,
    data.body,
  );
  await logAdmin(actor.id, 'notice-create', 'post', pid);
  return pid;
}
export async function siteSettings() {
  return Object.fromEntries((await all('SELECT key,value FROM site_settings')).map((x) => [x.key, x.value]));
}
export async function updateSettings(input: any, actor: AdminIdentity) {
  if (actor.role !== 'owner') fail('최초 관리자만 운영 설정을 변경할 수 있습니다.', 403);
  for (const key of ['registration_open', 'saas_submissions_open']) {
    if (![true, false, 'true', 'false'].includes(input[key])) fail('가입·등록 설정을 모두 선택해 주세요.');
    const value = input[key] === true || input[key] === 'true';
    await run(
      'UPDATE site_settings SET value=?::jsonb,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE key=?',
      JSON.stringify(value),
      actor.id,
      key,
    );
    await logAdmin(actor.id, 'setting-update', 'setting', key, { value });
  }
}
