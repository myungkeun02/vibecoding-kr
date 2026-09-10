import { randomBytes, createHmac, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { secret, production } from './config';
import { one, run, mergeVotes } from './db';
import type { APIContext } from 'astro';
const scrypt = promisify(scryptCallback);
export const id = () => randomBytes(18).toString('hex');
export const hash = (x: string) => createHash('sha256').update(x).digest('hex');
export const sign = (x: string) => x + '.' + createHmac('sha256', secret).update(x).digest('base64url');
export function verified(v: string | undefined) {
  if (!v) return null;
  const parts = v.split('.');
  if (parts.length !== 2) return null;
  const expected = sign(parts[0]);
  return v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected))
    ? parts[0]
    : null;
}
export const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: production };
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return salt + ':' + key.toString('hex');
}
export async function passwordCheck(password: string, stored?: string | null) {
  const [salt, digest] = (stored || '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const target = Buffer.from(digest, 'hex');
  return target.length === key.length && timingSafeEqual(key, target);
}
export async function identity(ctx: APIContext) {
  let anon = verified(ctx.cookies.get('anon')?.value);
  if (!anon) {
    anon = id();
    ctx.cookies.set('anon', sign(anon), { ...cookieOpts, maxAge: 365 * 86400 });
  }
  ctx.locals.anon = anon;
  let csrf = verified(ctx.cookies.get('csrf')?.value);
  if (!csrf) {
    csrf = id();
    ctx.cookies.set('csrf', sign(csrf), { ...cookieOpts, maxAge: 86400 });
  }
  ctx.locals.csrf = csrf;
  const token = ctx.cookies.get('session')?.value;
  ctx.locals.user = token
    ? await one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.status='active'",
        hash(token),
        Date.now(),
      )
    : null;
}
export async function login(ctx: APIContext, user: string) {
  const old = ctx.cookies.get('session')?.value;
  if (old) await run('DELETE FROM sessions WHERE token=?', hash(old));
  const token = id() + id();
  await run(
    'INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',
    hash(token),
    user,
    Date.now() + 30 * 86400000,
  );
  ctx.cookies.set('session', token, { ...cookieOpts, maxAge: 30 * 86400 });
  await mergeVotes(user, ctx.locals.anon);
}
export const safeReturn = (v: unknown) =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !/[\\\r\n]/.test(v) ? v : '/me';
export const email = (v: unknown) =>
  typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
    ? v.trim().toLowerCase()
    : null;
export const safeUrl = (v: unknown) => {
  if (!v) return '';
  try {
    const u = new URL(String(v));
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
};
