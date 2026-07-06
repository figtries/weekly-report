import { promises as fs } from 'fs';
import path from 'path';

const IS_VERCEL = !!process.env.VERCEL;
const UPLOAD_ROOT = IS_VERCEL ? '/tmp/uploads' : path.join(process.cwd(), 'public', 'uploads');

export async function saveUploadedPhoto(
  file: File,
  subdir: string,
  key: string,
  slot: number
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || '.jpg';
  const dir = path.join(UPLOAD_ROOT, subdir, key);
  await fs.mkdir(dir, { recursive: true });
  const filename = `slot-${slot}-${Date.now()}${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return `/uploads/${subdir}/${key}/${filename}`;
}

export async function deleteUploadedPhoto(relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  const abs = IS_VERCEL
    ? path.join('/tmp', relativePath)
    : path.join(process.cwd(), 'public', relativePath);
  await fs.rm(abs, { force: true });
}
