import type { APIContext } from 'astro';
import { one, run, transaction, rate } from '../lib/db';
import { id, hash, email } from '../lib/security';
import { authorizationUrl, exchangeOAuth } from '../lib/oauth';
import {
  adminCookie,
  adminOAuthCookie,
  adminCookieOptions,
  adminOAuthConfig,
  adminUrl,
  adminFail,
} from './config';
export interface AdminIdentity {
  id: string;
  email: string;
  role: 'owner' | 'admin';
  user_id: string;
  google_subject: string;
  csrf: string;
}
export async function bootstrapAdmin() {
  const address = email(process.env.ADMIN_BOOTSTRAP_EMAIL);
  if (!address) return;
  await run(
    "INSERT INTO admin_members(id,email,role) VALUES(?,?,'owner') ON CONFLICT DO NOTHING",
    id(),
    address,
  );
}
export async function adminIdentity(ctx: APIContext) {
  const token = ctx.cookies.get(adminCookie)?.value;
  ctx.locals.admin = token
    ? (await one<AdminIdentity>(
        `SELECT m.id,m.email,m.role,m.user_id,m.google_subject,s.csrf FROM admin_sessions s
    JOIN admin_members m ON m.id=s.member_id JOIN users u ON u.id=m.user_id
    WHERE s.token=? AND s.expires>? AND m.status='active' AND u.status='active' AND s.google_subject=m.google_subject`,
        hash(token),
        Date.now(),
      )) || null
    : null;
  ctx.locals.admin ??= null;
  ctx.locals.csrf = ctx.locals.admin?.csrf || '';
}
export function requireAdmin(ctx: APIContext, owner = false): AdminIdentity {
  if (!ctx.locals.admin) adminFail('관리자 Google 계정으로 로그인해 주세요.', 401);
  if (owner && ctx.locals.admin.role !== 'owner')
    adminFail('최초 관리자만 권한을 부여하거나 회수할 수 있습니다.', 403);
  return ctx.locals.admin;
}
export async function establishAdmin(profile: { subject: string; email: string; name: string }) {
  return transaction(async () => {
    const m = await one(
      "SELECT * FROM admin_members WHERE lower(email)=lower(?) AND status='active' FOR UPDATE",
      profile.email,
    );
    if (!m || (m.google_subject && m.google_subject !== profile.subject))
      adminFail('이 Google 계정에는 관리자 권한이 없습니다.', 403);
    const existingIdentity = await one(
      "SELECT user_id FROM identities WHERE provider='google' AND subject=?",
      profile.subject,
    );
    let user = await one('SELECT * FROM users WHERE lower(email)=lower(?)', profile.email);
    if (user && user.status !== 'active') adminFail('이용이 제한된 계정입니다.', 403);
    if (existingIdentity && existingIdentity.user_id !== user?.id)
      adminFail('Google 계정 연결을 확인해 주세요.', 403);
    if (m.user_id && m.user_id !== user?.id) adminFail('관리자 계정 연결을 확인해 주세요.', 403);
    if (!user) {
      const uid = id();
      await run(
        'INSERT INTO users(id,email,nickname,email_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)',
        uid,
        profile.email,
        '운영자_' + uid.slice(0, 8),
      );
      user = { id: uid };
    }
    await run(
      "INSERT INTO identities(provider,subject,user_id) VALUES('google',?,?) ON CONFLICT DO NOTHING",
      profile.subject,
      user.id,
    );
    await run(
      'UPDATE users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP) WHERE id=?',
      user.id,
    );
    await run(
      'UPDATE admin_members SET google_subject=?,user_id=?,last_login_at=CURRENT_TIMESTAMP WHERE id=?',
      profile.subject,
      user.id,
      m.id,
    );
    const token = id() + id(),
      csrf = id() + id();
    await run(
      'INSERT INTO admin_sessions(token,member_id,google_subject,csrf,expires) VALUES(?,?,?,?,?)',
      hash(token),
      m.id,
      profile.subject,
      csrf,
      Date.now() + 8 * 3600000,
    );
    await run(
      "INSERT INTO admin_audit(actor,action,target_type,target_id) VALUES(?,'login','admin',?)",
      m.id,
      m.id,
    );
    return { token, member: m.id };
  });
}
export async function adminOAuth(ctx: APIContext, callback = false) {
  const config = adminOAuthConfig();
  if (!config.clientId || !config.clientSecret) return ctx.redirect(adminUrl('/login?error=unavailable'));
  try {
    if (!callback) {
      if (!(await rate('admin-oauth:' + hash(ctx.clientAddress || 'unknown'), 40, 3600)))
        return ctx.redirect(adminUrl('/login?error=rate'));
      const state = id() + id(),
        browser = id() + id(),
        verifier = id() + id();
      await run(
        'INSERT INTO admin_oauth_states(state,browser_hash,verifier,expires) VALUES(?,?,?,?)',
        hash(state),
        hash(browser),
        verifier,
        Date.now() + 600000,
      );
      ctx.cookies.set(adminOAuthCookie, browser, { ...adminCookieOptions, maxAge: 600 });
      const url = new URL(authorizationUrl('google', state, verifier, config));
      url.searchParams.set('prompt', 'select_account');
      return ctx.redirect(url.href);
    }
    const state = ctx.url.searchParams.get('state') || '',
      code = ctx.url.searchParams.get('code') || '';
    const browser = ctx.cookies.get(adminOAuthCookie)?.value || '';
    ctx.cookies.delete(adminOAuthCookie, adminCookieOptions);
    if (!state || !code || !browser) adminFail('로그인을 다시 시작해 주세요.', 400);
    const pending = await transaction(async () => {
      const record = await one('SELECT * FROM admin_oauth_states WHERE state=? FOR UPDATE', hash(state));
      if (!record || record.expires < Date.now() || record.browser_hash !== hash(browser))
        adminFail('로그인 확인 정보가 만료되었습니다.', 400);
      await run('DELETE FROM admin_oauth_states WHERE state=?', hash(state));
      return record;
    });
    const profile = await exchangeOAuth('google', code, pending.verifier, fetch, config);
    const session = await establishAdmin(profile);
    const old = ctx.cookies.get(adminCookie)?.value;
    if (old) await run('DELETE FROM admin_sessions WHERE token=?', hash(old));
    ctx.cookies.set(adminCookie, session.token, { ...adminCookieOptions, maxAge: 8 * 3600 });
    return ctx.redirect(adminUrl('/'));
  } catch (error: any) {
    console.error('admin_oauth_failed', error.status || error.name);
    return ctx.redirect(adminUrl('/login?error=' + (error.status === 403 ? 'denied' : 'oauth')));
  }
}
