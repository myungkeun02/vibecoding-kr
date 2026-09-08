import { readFileSync, readdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { dataDir } from './config';
export const db = new Database(join(dataDir, 'site.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
export const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
export const one = <T = any>(sql: string, ...args: any[]) => db.prepare(sql).get(...args) as T | undefined;
export const all = <T = any>(sql: string, ...args: any[]) => db.prepare(sql).all(...args) as T[];
db.exec(
  'CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)',
);
for (const file of readdirSync('migrations')
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()) {
  const version = Number(file.split('-')[0]);
  if (!one('SELECT version FROM migrations WHERE version=?', version))
    db.transaction(() => {
      db.exec(readFileSync(join('migrations', file), 'utf8'));
      run('INSERT INTO migrations(version) VALUES(?)', version);
    })();
}

export function syncTools(apps: any[]) {
  db.transaction(() => {
    run('UPDATE tools SET active=0');
    for (const a of apps)
      run(
        'INSERT INTO tools(slug,name,price,metadata) VALUES(?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,price=excluded.price,metadata=excluded.metadata,active=1',
        a.slug,
        a.name,
        a.priceMonthly,
        JSON.stringify(a),
      );
  })();
}
export const voteCounts = () =>
  Object.fromEntries(
    all(
      'SELECT v.slug,COUNT(*) AS n FROM votes v JOIN tools t ON t.slug=v.slug WHERE t.active=1 GROUP BY v.slug',
    ).map((x) => [x.slug, x.n]),
  );
export const totals = () =>
  one(
    'SELECT COALESCE(SUM(COALESCE(t.price,0)),0) AS monthly,COUNT(*) AS votes,COALESCE(SUM(CASE WHEN t.price IS NULL THEN 1 ELSE 0 END),0) AS excluded FROM votes v JOIN tools t ON t.slug=v.slug WHERE t.active=1',
  )!;
export function event(name: string, path = '/') {
  run(
    'INSERT INTO analytics(day,event,path) VALUES(?,?,?) ON CONFLICT(day,event,path) DO UPDATE SET count=count+1',
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
    name,
    path,
  );
}
export function rate(key: string, limit = 30, seconds = 60) {
  const now = Date.now();
  return db.transaction(() => {
    run('DELETE FROM rate_limits WHERE expires < ?', now);
    const r = one('SELECT * FROM rate_limits WHERE key=?', key);
    if (r && r.count >= limit) return false;
    run(
      'INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
      key,
      now + seconds * 1000,
    );
    return true;
  })();
}
export function mergeVotes(user: string, anon: string) {
  db.transaction(() => {
    run(
      'DELETE FROM votes WHERE anonymous=? AND slug IN (SELECT slug FROM votes WHERE user_id=?)',
      anon,
      user,
    );
    run('UPDATE votes SET user_id=?,anonymous=NULL WHERE anonymous=?', user, anon);
  })();
}
export function vote(slug: string, user: string | null, anon: string, remove = false) {
  db.transaction(() => {
    if (remove)
      run('DELETE FROM votes WHERE slug=? AND ' + (user ? 'user_id=?' : 'anonymous=?'), slug, user || anon);
    else
      run(
        'INSERT OR IGNORE INTO votes(slug,user_id,anonymous) VALUES(?,?,?)',
        slug,
        user,
        user ? null : anon,
      );
  })();
  return { count: voteCounts()[slug] || 0, ...totals() };
}
export const postSelect = `SELECT p.*,u.nickname, (SELECT COUNT(*) FROM reactions r WHERE r.post_id=p.id AND r.kind='like') AS likes,(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.status='active') AS comments FROM posts p LEFT JOIN users u ON u.id=p.user_id`;
export function posts(params: URLSearchParams) {
  const q = (params.get('q') || '').slice(0, 100),
    board = params.get('board') || '',
    tool = params.get('tool') || '';
  const args = [`%${q}%`, `%${q}%`, board, board, tool, tool];
  const where =
    " WHERE p.status='active' AND (p.title LIKE ? OR p.body LIKE ?) AND (?='' OR p.board=?) AND (?='' OR p.tool_slug=?)";
  const count = one('SELECT COUNT(*) AS n FROM posts p' + where, ...args)!.n;
  const page = Math.min(Math.max(1, Number(params.get('page')) || 1), Math.max(1, Math.ceil(count / 15)));
  return {
    items: all(
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
export const getPost = (id: string) => one(postSelect + " WHERE p.id=? AND p.status='active'", id);
export const getComments = (id: string) =>
  all(
    'SELECT c.*,u.nickname FROM comments c LEFT JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at,c.id',
    id,
  );
export function audit(actor: string | null, action: string, target: string) {
  run('INSERT INTO audit(actor,action,target) VALUES(?,?,?)', actor, action, target);
}
