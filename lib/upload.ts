import { promises as fs } from 'fs';
import path from 'path';
import { redisConfigured, redisSet, redisDel } from './storage';

const IS_VERCEL = !!process.env.VERCEL;
const UPLOAD_ROOT = IS_VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'public', 'uploads');

// Upstash free tier caps a request at ~1MB; base64 adds ~33%, so anything
// above this can't be stored. The client compresses photos well below this —
// the guard is a clear error instead of a cryptic Redis failure.
const MAX_REDIS_PHOTO_BYTES = 700 * 1024;

export function photoRedisKey(relativePath: string): string {
  return `weekly-report:photo:${relativePath}`;
}

export async function saveUploadedPhoto(
  file: File,
  subdir: string,
  key: string,
  slot: number
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || '.jpg';
  const filename = `slot-${slot}-${Date.now()}${ext}`;
  const relPath = `/uploads/${subdir}/${key}/${filename}`;

  if (redisConfigured) {
    if (buffer.byteLength > MAX_REDIS_PHOTO_BYTES) {
      throw new Error('Photo is too large — please use a smaller image (max ~700KB).');
    }
    await redisSet(
      photoRedisKey(relPath),
      JSON.stringify({ mime: file.type || 'image/jpeg', data: buffer.toString('base64') })
    );
    return relPath;
  }

  const dir = path.join(UPLOAD_ROOT, subdir, key);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  return relPath;
}

export async function deleteUploadedPhoto(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  if (redisConfigured) {
    await redisDel(photoRedisKey(relativePath)).catch(() => undefined);
    return;
  }
  const abs = IS_VERCEL
    ? path.join('/tmp', relativePath)
    : path.join(process.cwd(), 'public', relativePath);
  await fs.rm(abs, { force: true });
}
