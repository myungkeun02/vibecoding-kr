import type { APIRoute } from 'astro';
import { one } from '../../lib/db';
import { readImage } from '../../lib/storage';
export const GET: APIRoute = async (ctx) => {
  const id = ctx.params.id || '';
  if (!/^[a-f0-9]{36}$/.test(id)) return new Response(null, { status: 404 });
  const file = await one('SELECT * FROM uploads WHERE id=?', id);
  if (!file) return new Response(null, { status: 404 });
  const publicUse = await one(
    "SELECT id FROM posts WHERE status='active' AND body LIKE ?",
    '%/media/' + id + '%',
  );
  const serviceUse = await one(
    "SELECT s.id FROM services s JOIN users u ON u.id=s.user_id WHERE s.image_id=? AND ((s.status='published' AND u.status='active') OR ?=1)",
    id,
    ctx.locals.user?.role === 'admin' ? 1 : 0,
  );
  if (!publicUse && !serviceUse && ctx.locals.user?.id !== file.user_id)
    return new Response(null, { status: 404 });
  try {
    return new Response(new Uint8Array(await readImage(id, file.storage)), {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
};
