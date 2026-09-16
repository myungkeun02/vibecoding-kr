import { timingSafeEqual } from 'node:crypto';
import type { APIContext } from 'astro';
import { adminSiteUrl, appSurface, isAdminOrigin } from './config';
export function adminRequest(ctx: APIContext) {
  if (appSurface === 'public' || !adminSiteUrl) return false;
  const secret = process.env.ADMIN_PROXY_SECRET || '';
  const supplied = ctx.request.headers.get('x-vibepan-admin-proxy') || '';
  const trusted =
    secret.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(supplied));
  if (trusted) return true;
  // In proxy mode, an incoming forwarded-host header alone never exposes the admin surface.
  return !secret && isAdminOrigin(ctx.url);
}
