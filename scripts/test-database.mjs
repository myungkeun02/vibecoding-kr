import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createDatabase } from '../src/lib/postgres.mjs';

export function testConnection() {
  const file = 'data/private/postgres-local/connection.env';
  const local = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const url = process.env.TEST_DATABASE_URL || local.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for real PostgreSQL tests');
  return url;
}
export async function createTestDatabase(label) {
  const schema = 'qa_' + label.replace(/[^a-z0-9_]/g, '_') + '_' + randomBytes(6).toString('hex');
  const connectionString = testConnection();
  const database = createDatabase(connectionString, { schema });
  await database.migrate();
  return {
    ...database,
    connectionString,
    async cleanup() {
      await database.query(`DROP SCHEMA "${schema}" CASCADE`);
      await database.close();
    },
  };
}
export function connectE2EDatabase() {
  const config = JSON.parse(readFileSync('data/test/e2e/postgres.json', 'utf8'));
  return createDatabase(testConnection(), { schema: config.schema });
}
