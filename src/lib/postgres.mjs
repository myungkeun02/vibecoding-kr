import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Keep API counts and timestamps compatible with the existing Korean views.
pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range');
  return number;
});
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());
pg.types.setTypeParser(1082, (value) => value);

// The query API uses ? placeholders. Only bind markers outside SQL literals are numbered.
export function bindParameters(sql) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (part) => (part === '?' ? '$' + ++index : part));
}

export function createDatabase(connectionString, { schema = 'public', max = 5 } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required; SQLite fallback is disabled');
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid DATABASE_URL protocol');
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
    options: `-c search_path=${schema},public -c timezone=UTC -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000`,
  });
  pool.on('error', (error) => console.error('postgres_pool_failed', error.code || error.name));
  const context = new AsyncLocalStorage();
  const query = (sql, args = []) => (context.getStore() || pool).query(bindParameters(sql), args);
  const all = async (sql, ...args) => (await query(sql, args)).rows;
  const one = async (sql, ...args) => (await all(sql, ...args))[0];
  const run = async (sql, ...args) => ({ changes: (await query(sql, args)).rowCount || 0 });
  async function transaction(work) {
    if (context.getStore()) return work();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await context.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function migrate() {
    await transaction(async () => {
      await query('SELECT pg_advisory_xact_lock(81260421)');
      await query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await query(
        'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)',
      );
      for (const file of readdirSync('migrations/postgres')
        .filter((f) => /^\d+.*\.sql$/.test(f))
        .sort()) {
        const version = Number(file.split('-')[0]);
        if (await one('SELECT version FROM migrations WHERE version=?', version)) continue;
        await query(readFileSync(join('migrations/postgres', file), 'utf8'));
        await run('INSERT INTO migrations(version) VALUES(?)', version);
      }
    });
  }
  return { query, all, one, run, transaction, migrate, close: () => pool.end(), schema };
}
