import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { redisConfigured, redisGet } from '@/lib/storage';
import { photoRedisKey } from '@/lib/upload';

const IS_VERCEL = !!process.env.VERCEL;

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : ext === '.gif' ? 'image/gif'
    : 'image/jpeg';
}

// Filenames are timestamped and never reused, so aggressive caching is safe.
const CACHE_HEADER = 'public, max-age=31536000, immutable';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path;

  if (redisConfigured) {
    const relPath = `/uploads/${segments.join('/')}`;
    const raw = await redisGet(photoRedisKey(relPath));
    if (!raw) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { mime, data } = JSON.parse(raw) as { mime: string; data: string };
    return new NextResponse(new Uint8Array(Buffer.from(data, 'base64')), {
      headers: { 'Content-Type': mime || mimeFor(relPath), 'Cache-Control': CACHE_HEADER },
    });
  }

  if (!IS_VERCEL) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filePath = path.join('/tmp/uploads', ...segments);
  if (!filePath.startsWith('/tmp/uploads')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const buffer = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': mimeFor(filePath), 'Cache-Control': CACHE_HEADER },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
