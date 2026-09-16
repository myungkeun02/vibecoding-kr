import { production, siteUrl, dataDir, secret } from '../src/lib/config';
import { oauthEnabled } from '../src/lib/oauth';
import { mailAvailable } from '../src/lib/mail';
import { r2Enabled } from '../src/lib/storage';
import { adminSiteUrl, adminOAuthConfig, appSurface } from '../src/admin/config';
console.log({
  database: process.env.DATABASE_URL ? 'postgresql-configured' : 'missing',
  mode: production ? 'production' : 'local',
  siteUrl,
  dataDir,
  sessionSecretConfigured: secret.length >= 32,
  github: oauthEnabled('github'),
  google: oauthEnabled('google'),
  mail: mailAvailable() ? (production ? 'external-configured' : 'local-or-external') : 'disabled',
  kakaoShare: Boolean(process.env.KAKAO_JAVASCRIPT_KEY),
  storage: r2Enabled() ? 'r2' : 'local',
  admin: {
    surface: appSurface,
    siteConfigured: Boolean(adminSiteUrl),
    bootstrapConfigured: Boolean(process.env.ADMIN_BOOTSTRAP_EMAIL),
    googleConfigured: Boolean(adminOAuthConfig().clientId && adminOAuthConfig().clientSecret),
    gatewayConfigured: Boolean(process.env.ADMIN_PROXY_SECRET),
  },
});
