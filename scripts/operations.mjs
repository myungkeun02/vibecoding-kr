// These commands run in the production image without a TypeScript toolchain.
import { createDatabase } from '../src/lib/postgres.mjs';
import { resolve, isAbsolute } from 'node:path';
import { existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [command, argument, flag] = process.argv.slice(2);
const schema = process.env.DATABASE_SCHEMA || 'public';
const db = createDatabase(process.env.DATABASE_URL, { schema });
const url = new URL(process.env.DATABASE_URL);
const pgEnv = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  PGSSLMODE: url.searchParams.get('sslmode') || process.env.PGSSLMODE || 'prefer',
};
function backup(filename) {
  if (!filename || !isAbsolute(filename)) throw new Error('backup requires an absolute new .dump filename');
  const fd = openSync(filename, 'wx', 0o600);
  let result;
  try {
    result = spawnSync(
      process.env.PG_DUMP_BIN || 'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--schema', schema],
      { env: pgEnv, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' },
    );
  } finally {
    closeSync(fd);
  }
  if (result.error || result.status !== 0) {
    unlinkSync(filename);
    throw new Error(
      'PostgreSQL backup failed. Install pg_dump matching the server major version or newer. ' +
        (result.error?.code || result.stderr),
    );
  }
}
try {
  if (command === 'backup') {
    backup(argument);
    console.log('Consistent PostgreSQL backup created. Back up uploaded files separately.');
  } else if (command === 'restore') {
    if (!argument || flag !== '--server-stopped' || !existsSync(argument))
      throw new Error('restore <backup.dump> --server-stopped');
    const before = resolve(argument) + '.before-restore-' + Date.now() + '.dump';
    backup(before);
    const result = spawnSync(
      process.env.PG_RESTORE_BIN || 'pg_restore',
      [
        '--clean',
        '--if-exists',
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-acl',
        '--dbname',
        pgEnv.PGDATABASE,
        resolve(argument),
      ],
      { env: pgEnv, encoding: 'utf8' },
    );
    if (result.error || result.status !== 0)
      throw new Error('Restore rolled back. ' + (result.error?.code || result.stderr));
    console.log(
      'PostgreSQL restored. Previous data was backed up before restore. Restore uploads from the same backup and restart.',
    );
  } else if (command === 'admin') {
    await db.transaction(async () => {
      const user = await db.one(
        "SELECT id FROM users WHERE lower(email)=lower(?) AND status='active' FOR UPDATE",
        argument?.trim(),
      );
      if (!user) throw new Error('Create the intended account before granting admin');
      await db.run("UPDATE users SET role='admin' WHERE id=?", user.id);
      await db.run('DELETE FROM sessions WHERE user_id=?', user.id);
      await db.run(
        'INSERT INTO audit(actor,action,target) VALUES(?,?,?)',
        user.id,
        'cli-grant-admin',
        user.id,
      );
    });
    console.log('Admin granted; log in again.');
  } else if (command === 'integrity') {
    const ready = await db.one('SELECT 1 AS ready');
    const constraints = await db.one(
      'SELECT COUNT(*) AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=? AND NOT c.convalidated',
      schema,
    );
    if (!ready || constraints.n) throw new Error('Database connection or constraint validation failed');
    console.log({ database: 'PostgreSQL', connection: 'ok', unvalidatedConstraints: 0 });
  } else
    throw new Error(
      'Commands: admin <email>, backup <absolute-new.dump>, restore <backup.dump> --server-stopped, integrity',
    );
} finally {
  await db.close();
}
