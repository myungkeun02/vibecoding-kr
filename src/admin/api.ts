import type { APIRoute } from 'astro';
import { z } from 'zod';
import sharp from 'sharp';
import { one, run, rate, transaction } from '../lib/db';
import { readLimited } from '../lib/request';
import { id, hash } from '../lib/security';
import { readImage, saveImage } from '../lib/storage';
import { requireAdmin } from './auth';
import { adminSiteUrl, adminUrl, adminFail as fail, adminCookie, adminCookieOptions } from './config';
import { dashboard, listRecords, serviceRecord, adminMembers } from './data';
import { saveService, reviewService, reviewServiceEdit } from './services';
import {
  createUser,
  userStatus,
  grantAdmin,
  revokeAdmin,
  moderate,
  saveNotice,
  siteSettings,
  updateSettings,
  logAdmin,
} from './operations';
const lists = ['services', 'service-edits', 'users', 'posts', 'comments', 'reports', 'suggestions', 'audit'];
function errorResponse(error: any) {
  const status = error.status || (error instanceof z.ZodError ? 400 : error.code === '23505' ? 409 : 500);
  if (status >= 500) console.error('admin_api_failed', error.code || error.name);
  return Response.json(
    {
      ok: false,
      error:
        status >= 500
          ? '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'
          : error.code === '23505'
            ? '이미 등록된 정보입니다.'
            : error instanceof z.ZodError
              ? /[가-힣]/.test(error.issues[0]?.message)
                ? error.issues[0].message
                : '입력 항목과 글자 수를 확인해 주세요.'
              : error.message,
    },
    { status },
  );
}
export const GET: APIRoute = async (ctx) => {
  try {
    if (!ctx.locals.adminSurface) fail('페이지를 찾을 수 없습니다.', 404);
    const actor = requireAdmin(ctx),
      parts = (ctx.params.action || '').split('/'),
      kind = parts[0];
    if (kind === 'me' && parts.length === 1)
      return Response.json({ id: actor.id, email: actor.email, role: actor.role, csrf: actor.csrf });
    if (kind === 'overview' && parts.length === 1)
      return Response.json(await dashboard(ctx.url.searchParams));
    if (kind === 'admins' && parts.length === 1) return Response.json({ items: await adminMembers() });
    if (kind === 'settings' && parts.length === 1) return Response.json(await siteSettings());
    if (kind === 'services' && parts[1] && parts.length === 2)
      return Response.json(await serviceRecord(parts[1]));
    if (kind === 'media' && parts[1] && parts.length === 2) {
      if (!/^[a-f0-9]{36}$/.test(parts[1])) fail('이미지를 찾을 수 없습니다.', 404);
      const f = await one('SELECT id,storage FROM uploads WHERE id=?', parts[1]);
      if (!f) fail('이미지를 찾을 수 없습니다.', 404);
      return new Response(new Uint8Array(await readImage(f.id, f.storage)), {
        headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' },
      });
    }
    if (lists.includes(kind) && parts.length === 1)
      return Response.json(await listRecords(kind, ctx.url.searchParams));
    fail('기능을 찾을 수 없습니다.', 404);
  } catch (error) {
    return errorResponse(error);
  }
};
export const POST: APIRoute = async (ctx) => {
  try {
    if (!ctx.locals.adminSurface) fail('페이지를 찾을 수 없습니다.', 404);
    const actor = requireAdmin(ctx);
    if (ctx.request.headers.get('origin') !== new URL(adminSiteUrl).origin)
      fail('관리자 화면에서 다시 요청해 주세요.', 403);
    if (!(await rate('admin:' + actor.id, 300, 3600)))
      fail('요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429);
    const action = ctx.params.action || '',
      parts = action.split('/'),
      type = ctx.request.headers.get('content-type') || '',
      json = type.includes('application/json');
    let b: any = {};
    if (action === 'uploads') {
      if (ctx.request.headers.get('x-csrf-token') !== actor.csrf) fail('페이지를 새로고침해 주세요.', 403);
      const body = await readLimited(ctx.request, Math.ceil(5.1 * 1024 * 1024));
      const request = new Request(ctx.request.url, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: body as any,
      });
      const file = (await request.formData()).get('file');
      if (
        !(file instanceof File) ||
        file.size > 5 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      )
        fail('5MB 이하의 PNG·JPEG·WebP 이미지를 선택해 주세요.');
      const image = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20_000_000 })
        .rotate()
        .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      const imageId = id(),
        storage = await saveImage(imageId, image);
      await run(
        'INSERT INTO uploads(id,user_id,mime,size,storage) VALUES(?,?,?,?,?)',
        imageId,
        actor.user_id,
        'image/webp',
        image.length,
        storage,
      );
      return Response.json({ ok: true, url: '/media/' + imageId, preview: '/api/admin/v1/media/' + imageId });
    }
    const text = new TextDecoder().decode(await readLimited(ctx.request, 256 * 1024));
    try {
      b = json ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
    } catch {
      fail('입력 형식을 확인해 주세요.');
    }
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail('입력 형식을 확인해 주세요.');
    if ((ctx.request.headers.get('x-csrf-token') || b.csrf) !== actor.csrf)
      fail('페이지를 새로고침해 주세요.', 403);
    let redirect = '/',
      result: Record<string, unknown> = { ok: true };
    await transaction(async () => {
      const active = await one(
        "SELECT m.id FROM admin_members m JOIN admin_sessions s ON s.member_id=m.id WHERE m.id=? AND m.status='active' AND s.token=? AND s.expires>? FOR SHARE OF m",
        actor.id,
        hash(ctx.cookies.get(adminCookie)?.value || ''),
        Date.now(),
      );
      if (!active) fail('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.', 401);
      if (action === 'logout') {
        await run(
          'DELETE FROM admin_sessions WHERE token=?',
          hash(ctx.cookies.get(adminCookie)?.value || ''),
        );
        await logAdmin(actor.id, 'logout', 'admin', actor.id);
        redirect = '/login';
      } else if (parts[0] === 'services' && parts.length <= 2) {
        const sid = await saveService({ ...b, id: parts[1] }, actor.user_id);
        await logAdmin(actor.id, 'service-save', 'service', sid);
        result.id = sid;
        redirect = '/services/' + sid;
      } else if (parts[0] === 'services' && parts.length === 3 && parts[2] === 'review') {
        await reviewService({ ...b, id: parts[1] }, actor.user_id);
        await logAdmin(actor.id, 'service-' + b.operation, 'service', parts[1], {
          note: String(b.note || ''),
        });
        redirect = '/services?status=pending';
      } else if (parts[0] === 'service-edits' && parts.length === 3 && parts[2] === 'review') {
        await reviewServiceEdit({ ...b, id: parts[1] }, actor.user_id);
        await logAdmin(actor.id, 'service-edit-' + b.operation, 'service-edit', parts[1], {
          note: String(b.note || ''),
        });
        redirect = '/edits';
      } else if (action === 'users') {
        result.id = await createUser(b, actor);
        redirect = '/users';
      } else if (parts[0] === 'users' && parts.length === 3 && parts[2] === 'status') {
        await userStatus(parts[1], b.status, actor);
        redirect = '/users';
      } else if (parts[0] === 'users' && parts.length === 3 && parts[2] === 'sessions') {
        if (!(await one('SELECT id FROM users WHERE id=?', parts[1]))) fail('회원을 찾을 수 없습니다.', 404);
        await run('DELETE FROM sessions WHERE user_id=?', parts[1]);
        await logAdmin(actor.id, 'user-sessions-revoke', 'user', parts[1]);
        redirect = '/users';
      } else if (action === 'admins') {
        result.id = await grantAdmin(b, actor);
        redirect = '/access';
      } else if (parts[0] === 'admins' && parts.length === 3 && parts[2] === 'revoke') {
        await revokeAdmin(parts[1], actor);
        redirect = '/access';
      } else if (action === 'notices') {
        result.id = await saveNotice(b, actor);
        redirect = '/community?tab=posts&board=notice';
      } else if (
        ['posts', 'comments', 'reports', 'suggestions'].includes(parts[0]) &&
        parts.length === 3 &&
        parts[2] === 'moderate'
      ) {
        await moderate(parts[0], parts[1], b.operation, actor);
        redirect = '/community?tab=' + (b.context === 'reports' ? 'reports' : parts[0]);
      } else if (action === 'settings') {
        await updateSettings(b, actor);
        redirect = '/settings';
      } else fail('기능을 찾을 수 없습니다.', 404);
    });
    if (action === 'logout') ctx.cookies.delete(adminCookie, adminCookieOptions);
    result.redirect = adminUrl(redirect);
    if (!json && ctx.request.headers.get('accept')?.includes('text/html'))
      return ctx.redirect(String(result.redirect), 303);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
};
