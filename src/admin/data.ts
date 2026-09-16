import { all, one } from '../lib/db';
import { publicServiceWhere } from '../lib/services';
import { adminFail } from './config';
export const pageInfo = (params: URLSearchParams) => ({
  page: Math.max(1, Math.floor(Number(params.get('page')) || 1)),
  size: 20,
  q: (params.get('q') || '').trim().slice(0, 100),
  status: params.get('status') || '',
});
export async function listRecords(kind: string, params: URLSearchParams) {
  const p = pageInfo(params),
    args: any[] = [];
  let from = '',
    fields = '',
    where = '1=1',
    order = 'created_at DESC';
  if (kind === 'services') {
    from = 'services s LEFT JOIN users u ON u.id=s.user_id';
    fields = 's.*,u.nickname';
    order = 's.updated_at DESC,s.id';
    if (p.q) {
      where += ' AND (s.name ILIKE ? OR s.website_url ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND s.status=?';
      args.push(p.status);
    }
  } else if (kind === 'service-edits') {
    from = 'service_edits e JOIN services s ON s.id=e.service_id JOIN users u ON u.id=e.user_id';
    fields = 'e.*,s.name,s.catalog_slug,u.nickname';
    order = 'e.created_at DESC,e.id';
    if (p.q) {
      where += ' AND s.name ILIKE ?';
      args.push('%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND e.status=?';
      args.push(p.status);
    }
  } else if (kind === 'users') {
    from = "users u LEFT JOIN admin_members a ON a.user_id=u.id AND a.status='active'";
    fields =
      'u.id,u.email,u.nickname,u.bio,u.role,u.status,u.created_at,u.email_verified_at,a.role AS admin_role';
    order = 'u.created_at DESC,u.id';
    if (p.q) {
      where += ' AND (u.email ILIKE ? OR u.nickname ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND u.status=?';
      args.push(p.status);
    }
  } else if (kind === 'posts') {
    from = 'posts p LEFT JOIN users u ON u.id=p.user_id';
    fields = 'p.*,u.nickname';
    order = 'p.created_at DESC,p.id';
    if (p.q) {
      where += ' AND (p.title ILIKE ? OR u.nickname ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND p.status=?';
      args.push(p.status);
    }
    const board = params.get('board');
    if (board) {
      where += ' AND p.board=?';
      args.push(board);
    }
  } else if (kind === 'comments') {
    from = 'comments c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN posts p ON p.id=c.post_id';
    fields = 'c.*,u.nickname,p.title';
    order = 'c.created_at DESC,c.id';
    if (p.q) {
      where += ' AND (c.body ILIKE ? OR u.nickname ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND c.status=?';
      args.push(p.status);
    }
  } else if (kind === 'reports') {
    from = `reports r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN posts p ON r.target_type='post' AND p.id=r.target_id LEFT JOIN comments c ON r.target_type='comment' AND c.id=r.target_id LEFT JOIN posts cp ON cp.id=c.post_id`;
    fields =
      'r.*,u.nickname,COALESCE(p.title,cp.title) AS target_title,COALESCE(p.body,c.body) AS target_body,COALESCE(p.status,c.status) AS target_status,COALESCE(p.id,c.post_id) AS target_post';
    order = 'r.created_at DESC,r.id';
    if (p.q) {
      where += ' AND (r.reason ILIKE ? OR u.nickname ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND r.status=?';
      args.push(p.status);
    }
  } else if (kind === 'suggestions') {
    from = 'suggestions s LEFT JOIN users u ON u.id=s.user_id';
    fields = 's.*,u.nickname';
    order = 's.created_at DESC,s.id';
    if (p.q) {
      where += ' AND s.title ILIKE ?';
      args.push('%' + p.q + '%');
    }
    if (p.status) {
      where += ' AND s.status=?';
      args.push(p.status);
    }
  } else if (kind === 'audit') {
    from = 'admin_audit a LEFT JOIN admin_members m ON m.id=a.actor';
    fields = 'a.*,m.email AS actor_email';
    order = 'a.created_at DESC,a.id';
    if (p.q) {
      where += ' AND (a.action ILIKE ? OR a.target_id ILIKE ?)';
      args.push('%' + p.q + '%', '%' + p.q + '%');
    }
  } else adminFail('목록을 찾을 수 없습니다.', 404);
  const total = (await one(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`, ...args))!.n;
  const pages = Math.max(1, Math.ceil(total / p.size)),
    page = Math.min(p.page, pages);
  const items = await all(
    `SELECT ${fields} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...args,
    p.size,
    (page - 1) * p.size,
  );
  return { items, total, page, pages, size: p.size };
}
export async function dashboard(params: URLSearchParams) {
  const days = [7, 30, 90].includes(Number(params.get('days'))) ? Number(params.get('days')) : 30;
  const totals = await one(
    `SELECT
    (SELECT COUNT(*) FROM users WHERE status='active') AS members,
    (SELECT COUNT(*) FROM users WHERE created_at>=CURRENT_DATE-(?::integer-1)) AS signups,
    (SELECT COUNT(*) FROM services s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN tools t ON t.slug=s.catalog_slug WHERE ${publicServiceWhere}) AS services,
    (SELECT COUNT(*) FROM services s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN tools t ON t.slug=s.catalog_slug WHERE ${publicServiceWhere} AND s.guide IS NOT NULL) AS guides,
    (SELECT COUNT(*) FROM services WHERE status='pending') AS pending_services,
    (SELECT COUNT(*) FROM service_edits WHERE status='pending') AS pending_edits,
    (SELECT COUNT(*) FROM reports WHERE status='pending') AS pending_reports,
    (SELECT COUNT(*) FROM posts WHERE status='active') AS posts,
    (SELECT COUNT(*) FROM posts WHERE status='active' AND board='builds') AS builds,
    (SELECT COUNT(*) FROM comments WHERE status='active') AS comments,
    (SELECT COALESCE(SUM(count),0) FROM analytics WHERE event='pageview' AND day>=CURRENT_DATE-(?::integer-1)) AS pageviews,
    (SELECT COALESCE(SUM(count),0) FROM analytics WHERE event='copy' AND day>=CURRENT_DATE-(?::integer-1)) AS copies`,
    days,
    days,
    days,
  );
  const daily = await all(
    `SELECT day::date::text AS day,
    COALESCE((SELECT SUM(count) FROM analytics a WHERE a.day=d.day::date AND event='pageview'),0) AS pageviews,
    (SELECT COUNT(*) FROM users u WHERE u.created_at>=d.day AND u.created_at<d.day+INTERVAL '1 day') AS signups,
    (SELECT COUNT(*) FROM services s WHERE s.created_at>=d.day AND s.created_at<d.day+INTERVAL '1 day' AND s.catalog_slug IS NULL) AS services,
    (SELECT COUNT(*) FROM posts p WHERE p.created_at>=d.day AND p.created_at<d.day+INTERVAL '1 day' AND p.status='active') AS posts
    FROM generate_series(CURRENT_DATE-(?::integer-1),CURRENT_DATE,INTERVAL '1 day') d(day) ORDER BY day`,
    days,
  );
  const events = await all(
    'SELECT event,SUM(count) AS count FROM analytics WHERE day>=CURRENT_DATE-(?::integer-1) GROUP BY event ORDER BY count DESC',
    days,
  );
  const pages = await all(
    "SELECT path,SUM(count) AS count FROM analytics WHERE event='pageview' AND day>=CURRENT_DATE-(?::integer-1) GROUP BY path ORDER BY count DESC LIMIT 10",
    days,
  );
  const categories = await all(
    `SELECT s.category,COUNT(*) AS count FROM services s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN tools t ON t.slug=s.catalog_slug WHERE ${publicServiceWhere} GROUP BY s.category ORDER BY count DESC`,
  );
  return { days, totals, daily, events, pages, categories, timezone: 'UTC' };
}
export async function serviceRecord(sid: string) {
  const s = await one('SELECT * FROM services WHERE id=?', sid);
  if (!s) adminFail('서비스를 찾을 수 없습니다.', 404);
  return s;
}
export async function adminMembers() {
  return all(
    'SELECT id,email,role,status,google_subject IS NOT NULL AS linked,created_at,last_login_at FROM admin_members ORDER BY role DESC,created_at',
  );
}
