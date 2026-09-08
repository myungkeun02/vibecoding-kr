import { readLimited } from '../../lib/request';
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { id } from '../../lib/security';
import { saveImage } from '../../lib/storage';
import { run, rate } from '../../lib/db';
import { siteUrl } from '../../lib/config';
export const POST: APIRoute = async (ctx) => {
  try {
    if (!ctx.locals.user) return Response.json({ error: '로그인 후 이용해 주세요.' }, { status: 401 });
    if (
      ![ctx.url.origin, siteUrl].includes(ctx.request.headers.get('origin') || '') ||
      ctx.request.headers.get('x-csrf-token') !== ctx.locals.csrf
    )
      return Response.json({ error: '요청을 확인할 수 없어요.' }, { status: 403 });
    if (!rate('upload:' + ctx.locals.user.id, 20, 3600))
      return Response.json({ error: '이미지 업로드는 시간당 20개까지 가능해요.' }, { status: 429 });
    if (Number(ctx.request.headers.get('content-length') || 0) > 5.1 * 1024 * 1024)
      return Response.json({ error: '파일은 5MB 이하로 올려주세요.' }, { status: 413 });
    const bytesIn = await readLimited(ctx.request, Math.ceil(5.1 * 1024 * 1024));
    const bounded = new Request(ctx.request.url, {
      method: 'POST',
      headers: { 'Content-Type': ctx.request.headers.get('Content-Type') || '' },
      body: bytesIn as any,
    });
    const f = (await bounded.formData()).get('file');
    if (
      !(f instanceof File) ||
      f.size > 5 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(f.type)
    )
      return Response.json({ error: '5MB 이하의 PNG·JPEG·WebP 이미지만 올릴 수 있어요.' }, { status: 400 });
    const bytes = await sharp(Buffer.from(await f.arrayBuffer()), { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const uid = id(),
      storage = await saveImage(uid, bytes);
    run(
      'INSERT INTO uploads(id,user_id,mime,size,storage) VALUES(?,?,?,?,?)',
      uid,
      ctx.locals.user.id,
      'image/webp',
      bytes.length,
      storage,
    );
    return Response.json({ ok: true, url: '/media/' + uid });
  } catch {
    return Response.json({ error: '이미지를 처리하지 못했어요. 파일을 확인해 주세요.' }, { status: 400 });
  }
};
