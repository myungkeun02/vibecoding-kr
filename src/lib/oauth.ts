import { createHash } from 'node:crypto';
import { absolute } from './config';
export type Provider = 'github' | 'google';
export function oauthConfig(provider: Provider) {
  const prefix = provider.toUpperCase();
  return {
    clientId: process.env[prefix + '_CLIENT_ID'],
    clientSecret: process.env[prefix + '_CLIENT_SECRET'],
    redirect: absolute('/auth/' + provider + '/callback'),
  };
}
export const oauthEnabled = (provider: Provider) => {
  const c = oauthConfig(provider);
  return Boolean(c.clientId && c.clientSecret);
};
export function authorizationUrl(provider: Provider, state: string, verifier: string) {
  const c = oauthConfig(provider);
  const u = new URL(
    provider === 'github'
      ? 'https://github.com/login/oauth/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth',
  );
  u.search = new URLSearchParams({
    client_id: c.clientId!,
    redirect_uri: c.redirect,
    response_type: 'code',
    scope: provider === 'github' ? 'read:user user:email' : 'openid email profile',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return u.href;
}
export async function exchangeOAuth(
  provider: Provider,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
) {
  const c = oauthConfig(provider);
  const r = await fetcher(
    provider === 'github'
      ? 'https://github.com/login/oauth/access_token'
      : 'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: c.clientId!,
        client_secret: c.clientSecret!,
        code,
        redirect_uri: c.redirect,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) throw new Error('OAUTH_EXCHANGE');
  const token = await r.json();
  if (!token.access_token) throw new Error('OAUTH_TOKEN');
  const headers = { Authorization: 'Bearer ' + token.access_token, Accept: 'application/json' };
  const ur = await fetcher(
    provider === 'github'
      ? 'https://api.github.com/user'
      : 'https://openidconnect.googleapis.com/v1/userinfo',
    { headers, signal: AbortSignal.timeout(15000) },
  );
  if (!ur.ok) throw new Error('OAUTH_PROFILE');
  const u = await ur.json();
  let address = u.email;
  if (provider === 'github') {
    const er = await fetcher('https://api.github.com/user/emails', {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!er.ok) throw new Error('OAUTH_EMAIL');
    const addresses = await er.json();
    address = addresses.find((e: any) => e.primary && e.verified)?.email;
  } else if (u.email_verified !== true) throw new Error('OAUTH_EMAIL_UNVERIFIED');
  if (!address || !(u.id || u.sub)) throw new Error('OAUTH_IDENTITY');
  return {
    subject: String(u.id || u.sub),
    email: String(address).toLowerCase(),
    name: String(u.name || u.login || '빌더'),
  };
}
