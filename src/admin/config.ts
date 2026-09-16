import { production, siteUrl } from '../lib/config';
export const adminSiteUrl = (
  process.env.ADMIN_SITE_URL || (production ? '' : 'http://localhost:4322')
).replace(/\/$/, '');
export const appSurface = process.env.APP_SURFACE || 'combined';
if (!['combined', 'public', 'admin'].includes(appSurface)) throw new Error('Invalid APP_SURFACE');
if (
  adminSiteUrl &&
  (new URL(adminSiteUrl).origin === new URL(siteUrl).origin ||
    (production && !adminSiteUrl.startsWith('https://')))
)
  throw new Error('ADMIN_SITE_URL must use a separate origin and HTTPS in production');
if (process.env.ADMIN_PROXY_SECRET && process.env.ADMIN_PROXY_SECRET.length < 32)
  throw new Error('ADMIN_PROXY_SECRET must have at least 32 characters');
export const adminCookie = production ? '__Host-vibepan-admin' : 'vibepan-admin';
export const adminOAuthCookie = production ? '__Host-vibepan-admin-oauth' : 'vibepan-admin-oauth';
export const adminCookieOptions = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: production };
export const adminUrl = (path = '/') => new URL(path, adminSiteUrl).href;
export function isAdminOrigin(url: URL) {
  return Boolean(adminSiteUrl) && url.origin === new URL(adminSiteUrl).origin && appSurface !== 'public';
}
export function adminOAuthConfig() {
  return {
    clientId: process.env.ADMIN_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.ADMIN_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    redirect: adminSiteUrl ? adminUrl('/api/admin/auth/callback') : '',
  };
}
export function adminFail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
