import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { dataDir } from './config';
export const r2Enabled = () =>
  Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  );
const client = () =>
  new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
export async function saveImage(id: string, bytes: Buffer) {
  if (r2Enabled()) {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: 'uploads/' + id + '.webp',
        Body: bytes,
        ContentType: 'image/webp',
      }),
    );
    return 'r2';
  }
  mkdirSync(join(dataDir, 'uploads'), { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDir, 'uploads', id + '.webp'), bytes, { mode: 0o600 });
  return 'local';
}
export async function readImage(id: string, storage: string) {
  if (storage === 'r2') {
    const r = await client().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: 'uploads/' + id + '.webp' }),
    );
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFileSync(join(dataDir, 'uploads', id + '.webp'));
}
