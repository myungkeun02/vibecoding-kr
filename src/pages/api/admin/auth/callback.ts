import type { APIRoute } from 'astro';
import { adminOAuth } from '../../../../admin/auth';
export const GET: APIRoute = (ctx) =>
  ctx.locals.adminSurface ? adminOAuth(ctx, true) : new Response(null, { status: 404 });
