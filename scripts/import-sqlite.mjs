import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createDatabase } from '../src/lib/postgres.mjs';
import { resolve } from 'node:path';

export const importTables = [
  'tools',
  'users',
  'sessions',
  'identities',
  'votes',
  'posts',
  'comments',
  'reactions',
  'bookmarks',
  'notifications',
  'reports',
  'suggestions',
  'audit',
  'waitlist',
  'rate_limits',
  'analytics',
  'auth_tokens',
  'uploads',
  'consents',
  'mail_deliveries',
];
const sequenceTables = ['votes', 'notifications', 'reports', 'suggestions', 'audit'];
const dateFields = new Set([
  'created_at',
  'updated_at',
  'applied_at',
  'accepted_at',
  'withdrawn_at',
  'email_verified_at',
]);
function canonical(row, columns) {
  return JSON.stringify(
    columns.map((column) => {
      const value = row[column];
      return value && dateFields.has(column)
        ? new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z').toISOString()
        : value;
    }),
  );
}
function digest(rows, columns) {
  return createHash('sha256')
    .update(
      rows
        .map((row) => canonical(row, columns))
        .sort()
        .join('\n'),
    )
    .digest('hex');
}

export async function importSqlite(source, target) {
  const sqlite = new Database(resolve(source), { readonly: true, fileMustExist: true });
  try {
    if (
      sqlite.pragma('integrity_check', { simple: true }) !== 'ok' ||
      sqlite.pragma('foreign_key_check').length
    )
      throw new Error('SQLite backup failed integrity checks');
    await target.migrate();
    return await target.transaction(async () => {
      await target.query('SELECT pg_advisory_xact_lock(81260422)');
      for (const table of importTables) {
        if ((await target.one(`SELECT COUNT(*) AS n FROM "${table}"`)).n !== 0)
          throw new Error('Import requires an empty PostgreSQL database; existing data was not overwritten');
      }
      const summary = {};
      for (const table of importTables) {
        if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
        const columns = sqlite
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .map((column) => column.name);
        if (columns.some((column) => !/^[a-z_]+$/.test(column))) throw new Error('Unsupported source column');
        const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
        let ordered = rows;
        if (table === 'comments') {
          const done = new Set();
          ordered = [];
          while (ordered.length < rows.length) {
            const ready = rows.filter(
              (row) => !done.has(row.id) && (!row.parent_id || done.has(row.parent_id)),
            );
            if (!ready.length) throw new Error('Comment parent cycle detected');
            for (const row of ready) {
              done.add(row.id);
              ordered.push(row);
            }
          }
        }
        for (const row of ordered)
          await target.query(
            `INSERT INTO "${table}" (${columns.map((column) => '"' + column + '"').join(',')}) VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')})`,
            columns.map((column) => row[column]),
          );
        const copied = await target.all(
          `SELECT ${columns.map((column) => '"' + column + '"').join(',')} FROM "${table}"`,
        );
        if (digest(rows, columns) !== digest(copied, columns))
          throw new Error('Import verification failed for ' + table);
        summary[table] = rows.length;
      }
      for (const table of sequenceTables)
        await target.query(
          `SELECT setval(pg_get_serial_sequence('"${target.schema}"."${table}"','id'), COALESCE((SELECT MAX(id) FROM "${table}"),0)+1, false)`,
        );
      return summary;
    });
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/import-sqlite.mjs')) {
  const source = process.argv[2];
  if (!source || !process.argv.includes('--apply'))
    throw new Error('Use a consistent SQLite backup: pnpm db:import <backup.db> --apply');
  const target = createDatabase(process.env.DATABASE_URL, {
    schema: process.env.DATABASE_SCHEMA || 'public',
  });
  try {
    const summary = await importSqlite(source, target);
    console.log(
      JSON.stringify({
        imported: summary,
        verified: 'all source row values matched',
        sqliteSource: 'unchanged',
      }),
    );
  } finally {
    await target.close();
  }
}
