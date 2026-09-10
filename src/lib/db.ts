import { createDatabase } from './postgres.mjs';

let connection: ReturnType<typeof createDatabase> | undefined;
export function database() {
  return (connection ??= createDatabase(process.env.DATABASE_URL, {
    schema: process.env.DATABASE_SCHEMA || 'public',
    max: Number(process.env.DATABASE_POOL_MAX || 5),
  }));
}
export const run = (sql: string, ...args: any[]) => database().run(sql, ...args);
export const one = async <T = any>(sql: string, ...args: any[]): Promise<T | undefined> =>
  database().one(sql, ...args);
export const all = async <T = any>(sql: string, ...args: any[]): Promise<T[]> => database().all(sql, ...args);
export const transaction = <T>(work: () => Promise<T>): Promise<T> => database().transaction(work);
export const migrateDatabase = () => database().migrate();
export const closeDatabase = () => connection?.close();

export async function syncTools(apps: any[]) {
  await transaction(async () => {
    await one('SELECT pg_advisory_xact_lock(81260422)');
    await run('UPDATE tools SET active=0');
    for (const a of apps)
      await run(
        'INSERT INTO tools(slug,name,price,metadata) VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,price=excluded.price,metadata=excluded.metadata,active=1',
        a.slug,
        a.name,
        a.priceMonthly,
        JSON.stringify(a),
      );
  });
}
export const voteCounts = async () =>
  Object.fromEntries(
    (
      await all(
        'SELECT v.slug,COUNT(*) AS n FROM votes v JOIN tools t ON t.slug=v.slug WHERE t.active=1 GROUP BY v.slug',
      )
    ).map((x) => [x.slug, x.n]),
  );
export const totals = async () =>
  (await one(
    'SELECT COALESCE(SUM(COALESCE(t.price,0)),0) AS monthly,COUNT(*) AS votes,COALESCE(SUM(CASE WHEN t.price IS NULL THEN 1 ELSE 0 END),0) AS excluded FROM votes v JOIN tools t ON t.slug=v.slug WHERE t.active=1',
  ))!;
export async function event(name: string, path = '/') {
  await run(
    'INSERT INTO analytics(day,event,path) VALUES(?,?,?) ON CONFLICT(day,event,path) DO UPDATE SET count=analytics.count+1',
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
    name,
    path,
  );
}
export async function rate(key: string, limit = 30, seconds = 60) {
  const now = Date.now();
  const result = await one(
    `INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.expires<=? THEN 1 ELSE rate_limits.count+1 END,
      expires=CASE WHEN rate_limits.expires<=? THEN EXCLUDED.expires ELSE rate_limits.expires END
    WHERE rate_limits.expires<=? OR rate_limits.count<? RETURNING count`,
    key,
    now + seconds * 1000,
    now,
    now,
    now,
    limit,
  );
  return Boolean(result);
}
export async function mergeVotes(user: string, anon: string) {
  await transaction(async () => {
    for (const key of ['vote:' + user, 'vote:' + anon].sort())
      await one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', key);
    await run(
      'DELETE FROM votes WHERE anonymous=? AND slug IN (SELECT slug FROM votes WHERE user_id=?)',
      anon,
      user,
    );
    await run('UPDATE votes SET user_id=?,anonymous=NULL WHERE anonymous=?', user, anon);
  });
}
export async function vote(slug: string, user: string | null, anon: string, remove = false) {
  await transaction(async () => {
    await one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', 'vote:' + (user || anon));
    if (remove)
      await run(
        'DELETE FROM votes WHERE slug=? AND ' + (user ? 'user_id=?' : 'anonymous=?'),
        slug,
        user || anon,
      );
    else
      await run(
        'INSERT INTO votes(slug,user_id,anonymous) VALUES(?,?,?) ON CONFLICT DO NOTHING',
        slug,
        user,
        user ? null : anon,
      );
  });
  return { count: (await voteCounts())[slug] || 0, ...(await totals()) };
}
export const postSelect = `SELECT p.*,u.nickname, (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id AND r.kind='like') AS likes,(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.status='active') AS comments FROM posts p LEFT JOIN users u ON u.id=p.user_id`;
export async function posts(params: URLSearchParams) {
  const q = (params.get('q') || '').slice(0, 100),
    board = params.get('board') || '',
    tool = params.get('tool') || '';
  const args = [`%${q}%`, `%${q}%`, board, board, tool, tool];
  const where =
    " WHERE p.status='active' AND (p.title ILIKE ? OR p.body ILIKE ?) AND (?='' OR p.board=?) AND (?='' OR p.tool_slug=?)";
  const count = (await one('SELECT COUNT(*) AS n FROM posts p' + where, ...args))!.n;
  const page = Math.min(Math.max(1, Number(params.get('page')) || 1), Math.max(1, Math.ceil(count / 15)));
  return {
    items: await all(
      postSelect +
        where +
        ' ORDER BY p.pinned DESC,' +
        (params.get('sort') === 'popular' ? 'likes DESC,' : '') +
        'p.created_at DESC LIMIT 15 OFFSET ?',
      ...args,
      (page - 1) * 15,
    ),
    total: count,
    page,
    pages: Math.max(1, Math.ceil(count / 15)),
  };
}
export const getPost = async (id: string) =>
  await one(postSelect + " WHERE p.id=? AND p.status='active'", id);
export const getComments = async (id: string) =>
  await all(
    'SELECT c.*,u.nickname FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at,c.id',
    id,
  );
export async function audit(actor: string | null, action: string, target: string) {
  await run('INSERT INTO audit(actor,action,target) VALUES(?,?,?)', actor, action, target);
}
