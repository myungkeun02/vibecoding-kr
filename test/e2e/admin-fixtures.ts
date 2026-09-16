// Test database fixtures only. There is deliberately no HTTP route that creates admin sessions.
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { connectE2EDatabase } from '../../scripts/test-database.mjs';
export const adminOrigin = 'http://127.0.0.1:8098';
const random = () => randomBytes(18).toString('hex');
const fixtures = new WeakMap<APIRequestContext, { token: string; csrf: string; id: string }>();
export async function fixtureAdmin(
  api: APIRequestContext,
  user: { id?: string; email?: string },
  role = 'admin',
) {
  const db = connectE2EDatabase();
  try {
    const u = await db.one(
      'SELECT id,email FROM users WHERE id=? OR email=?',
      user.id || '',
      user.email || '',
    );
    const id = random(),
      subject = random(),
      token = random(),
      csrf = random();
    await db.run(
      'INSERT INTO admin_members(id,email,user_id,google_subject,role) VALUES(?,?,?,?,?)',
      id,
      u.email,
      u.id,
      subject,
      role,
    );
    await db.run(
      'INSERT INTO admin_sessions(token,member_id,google_subject,csrf,expires) VALUES(?,?,?,?,?)',
      createHash('sha256').update(token).digest('hex'),
      id,
      subject,
      csrf,
      Date.now() + 3600000,
    );
    const fixture = { id, token, csrf };
    fixtures.set(api, fixture);
    return fixture;
  } finally {
    await db.close();
  }
}
export function adminHeaders(api: APIRequestContext) {
  const f = fixtures.get(api);
  return { Origin: adminOrigin, Cookie: f ? 'vibepan-admin=' + f.token : '', 'x-csrf-token': f?.csrf || '' };
}
export async function adminBrowser(context: BrowserContext) {
  const f = fixtures.get(context.request)!;
  await context.addCookies([
    { name: 'vibepan-admin', value: f.token, url: adminOrigin, httpOnly: true, sameSite: 'Lax' },
  ]);
}
export const adminGet = (api: APIRequestContext, path: string) =>
  api.get(adminOrigin + path, { headers: adminHeaders(api) });
export const adminPost = (api: APIRequestContext, path: string, data: any) =>
  api.post(adminOrigin + '/api/admin/v1/' + path, { headers: adminHeaders(api), data });
// Existing public workflow tests now exercise the separate admin API for their review steps.
export function reviewAction(api: APIRequestContext, path: string, body: any) {
  if (path === 'services/review') return adminPost(api, 'services/' + body.id + '/review', body);
  if (path === 'services/edits/review') return adminPost(api, 'service-edits/' + body.id + '/review', body);
  if (path !== 'admin/action') return;
  const [kind, operation] = body.operation.split('-');
  if (kind === 'user')
    return adminPost(api, 'users/' + body.target + '/status', {
      status: operation === 'suspend' ? 'suspended' : 'active',
    });
  const list = { post: 'posts', comment: 'comments', report: 'reports', suggest: 'suggestions' }[
    kind as string
  ];
  return adminPost(api, list + '/' + body.target + '/moderate', { operation });
}
