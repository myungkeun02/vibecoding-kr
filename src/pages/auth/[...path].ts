import type { APIRoute } from 'astro';
import { oauthEnabled, authorizationUrl, exchangeOAuth, type Provider } from '../../lib/oauth';
import { id, sign, verified, cookieOpts, safeReturn, login } from '../../lib/security';
import { one } from '../../lib/db';
export const GET: APIRoute = async (ctx) => {
  const [p, callback] = String(ctx.params.path).split('/');
  if (!['github', 'google'].includes(p)) return new Response('페이지를 찾을 수 없어요.', { status: 404 });
  const provider = p as Provider;
  if (!oauthEnabled(provider))
    return new Response('소셜 로그인은 준비 중이에요. 로그인 화면에서 이메일로 로그인해 주세요.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  try {
    if (!callback) {
      const state = id(),
        verifier = id() + id();
      const payload = Buffer.from(
        JSON.stringify({
          state,
          verifier,
          returnTo: safeReturn(ctx.url.searchParams.get('returnTo')),
          expires: Date.now() + 600000,
        }),
      ).toString('base64url');
      ctx.cookies.set('oauth', sign(payload), { ...cookieOpts, maxAge: 600 });
      return ctx.redirect(authorizationUrl(provider, state, verifier));
    }
    if (callback !== 'callback') return new Response(null, { status: 404 });
    const signed = verified(ctx.cookies.get('oauth')?.value);
    ctx.cookies.delete('oauth', cookieOpts);
    if (!signed) throw new Error('OAUTH_STATE');
    const state = JSON.parse(Buffer.from(signed, 'base64url').toString());
    if (
      state.expires < Date.now() ||
      ctx.url.searchParams.get('state') !== state.state ||
      !ctx.url.searchParams.get('code')
    )
      throw new Error('OAUTH_STATE');
    const profile = await exchangeOAuth(provider, ctx.url.searchParams.get('code')!, state.verifier);
    let u = one(
      "SELECT u.* FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=? AND i.subject=? AND u.status='active'",
      provider,
      profile.subject,
    );
    if (!u) {
      if (one('SELECT id FROM users WHERE email=?', profile.email)) throw new Error('OAUTH_EXISTING_EMAIL');
      const pending = Buffer.from(
        JSON.stringify({ ...profile, provider, returnTo: state.returnTo, expires: Date.now() + 600000 }),
      ).toString('base64url');
      ctx.cookies.set('oauth_pending', sign(pending), { ...cookieOpts, maxAge: 600 });
      return ctx.redirect('/onboarding');
    }
    login(ctx, u.id);
    return ctx.redirect(state.returnTo);
  } catch {
    console.error('oauth_failed', provider);
    return ctx.redirect('/login?error=oauth');
  }
};
