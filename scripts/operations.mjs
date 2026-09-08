// Operational commands run in the production image without a TypeScript toolchain.
import Database from 'better-sqlite3';
import { resolve, join, isAbsolute } from 'node:path';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
const [command, argument, flag] = process.argv.slice(2);
const dir = resolve(process.env.DATA_DIR || 'data/private'),
  file = join(dir, 'site.db');
mkdirSync(dir, { recursive: true, mode: 0o700 });
if (command === 'restore') {
  if (!argument || flag !== '--server-stopped')
    throw new Error('restore <backup.db> --server-stopped: stop the server first');
  const source = resolve(argument);
  if (source === file) throw new Error('Source and destination must differ');
  const input = new Database(source, { readonly: true, fileMustExist: true });
  if (input.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Invalid backup');
  input.close();
  if (existsSync(file)) {
    const previous = new Database(file);
    previous.pragma('wal_checkpoint(TRUNCATE)');
    previous.close();
    copyFileSync(file, file + '.before-restore-' + Date.now());
  }
  for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix);
  copyFileSync(source, file);
  console.log('Database restored. Restore uploads from the same backup and restart.');
} else {
  const db = new Database(file, { fileMustExist: true });
  db.pragma('foreign_keys=ON');
  db.pragma('busy_timeout=5000');
  if (command === 'backup') {
    if (!argument || !isAbsolute(argument) || resolve(argument) === file)
      throw new Error('backup <absolute-new-backup.db>');
    if (existsSync(argument)) throw new Error('Backup already exists; choose a new filename');
    await db.backup(argument);
    console.log('Consistent database backup created. Copy uploads separately.');
  } else if (command === 'admin') {
    const user = db
      .prepare("SELECT id FROM users WHERE email=? AND status='active'")
      .get(argument?.trim().toLowerCase());
    if (!user) throw new Error('Create the intended account before granting admin');
    db.transaction(() => {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      db.prepare('INSERT INTO audit(actor,action,target) VALUES(?,?,?)').run(
        user.id,
        'cli-grant-admin',
        user.id,
      );
    })();
    console.log('Admin granted; log in again.');
  } else if (command === 'integrity')
    console.log({
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeyErrors: db.pragma('foreign_key_check').length,
    });
  else
    throw new Error(
      'Commands: admin <email>, backup <absolute-file>, restore <file> --server-stopped, integrity',
    );
  db.close();
}
