import { test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase } from '../../scripts/test-database.mjs';
import { importSqlite } from '../../scripts/import-sqlite.mjs';

test('SQLite import preserves credentials, relations and timestamps; sequences advance and occupied targets are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibepan-import-'));
  const filename = join(dir, 'old.db');
  const source = new Database(filename);
  for (const file of ['001-initial.sql', '002-consent.sql', '003-email-verification.sql'])
    source.exec(readFileSync('migrations/' + file, 'utf8'));
  source
    .prepare('INSERT INTO users(id,email,nickname,password) VALUES(?,?,?,?)')
    .run('owner', 'owner@example.test', '원래회원', 'unchanged-password-hash');
  source
    .prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)')
    .run('unchanged-session-hash', 'owner', Date.now() + 100000);
  source
    .prepare('INSERT INTO posts(id,user_id,title,body,board) VALUES(?,?,?,?,?)')
    .run('post', 'owner', '보존할 게시글', '기존 본문 내용', 'builds');
  source
    .prepare('INSERT INTO comments(id,post_id,user_id,body) VALUES(?,?,?,?)')
    .run('z-parent', 'post', 'owner', '원래 댓글');
  source
    .prepare('INSERT INTO comments(id,post_id,user_id,parent_id,body) VALUES(?,?,?,?,?)')
    .run('a-reply', 'post', 'owner', 'z-parent', '원래 답글');
  source
    .prepare('INSERT INTO suggestions(id,user_id,title,body) VALUES(?,?,?,?)')
    .run(999, 'owner', '기존 제안', '제안 본문');
  source.close();
  const target = await createTestDatabase('import');
  try {
    const report = await importSqlite(filename, target);
    expect(report.users).toBe(1);
    expect(report.comments).toBe(2);
    expect((await target.one('SELECT password FROM users WHERE id=?', 'owner')).password).toBe(
      'unchanged-password-hash',
    );
    expect((await target.one('SELECT token FROM sessions WHERE user_id=?', 'owner')).token).toBe(
      'unchanged-session-hash',
    );
    expect((await target.one('SELECT parent_id FROM comments WHERE id=?', 'a-reply')).parent_id).toBe(
      'z-parent',
    );
    expect(
      (
        await target.one(
          'INSERT INTO suggestions(user_id,title,body) VALUES(?,?,?) RETURNING id',
          'owner',
          '새 제안',
          '새 내용',
        )
      ).id,
    ).toBe(1000);
    await expect(importSqlite(filename, target)).rejects.toThrow('empty PostgreSQL');
    expect((await target.one('SELECT COUNT(*) AS n FROM suggestions')).n).toBe(2);
  } finally {
    await target.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});
