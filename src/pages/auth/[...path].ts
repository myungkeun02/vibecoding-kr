import type { APIRoute } from 'astro';
import { handleOAuth } from '../../lib/oauth-route';
import type { Provider } from '../../lib/oauth';

export const GET: APIRoute = (ctx) => {
  const [provider, action, extra] = String(ctx.params.path).split('/');
  if (!['github', 'google'].includes(provider) || extra !== undefined || (action && action !== 'callback'))
    return new Response('페이지를 찾을 수 없어요.', { status: 404 });
  return handleOAuth(ctx, provider as Provider, action === 'callback');
};
