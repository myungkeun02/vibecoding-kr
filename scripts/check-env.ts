import { production, siteUrl, dataDir, secret } from '../src/lib/config';
import { oauthEnabled } from '../src/lib/oauth';
import { mailAvailable } from '../src/lib/mail';
import { r2Enabled } from '../src/lib/storage';
console.log({
  mode: production ? 'production' : 'local',
  siteUrl,
  dataDir,
  sessionSecretConfigured: secret.length >= 32,
  github: oauthEnabled('github'),
  google: oauthEnabled('google'),
  mail: mailAvailable() ? (production ? 'external-configured' : 'local-or-external') : 'disabled',
  kakaoShare: Boolean(process.env.KAKAO_JAVASCRIPT_KEY),
  storage: r2Enabled() ? 'r2' : 'local',
});
