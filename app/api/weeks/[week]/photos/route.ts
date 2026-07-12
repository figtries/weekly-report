import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { mutateDb } from '@/lib/db';
import { deleteUploadedPhoto, preparePhotoUpload } from '@/lib/upload';

const PAGE_SIZE = 6;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const formData = await request.formData();
  const slot = Number(formData.get('slot'));
  const file = formData.get('file');

  if (!(file instanceof File) || Number.isNaN(slot) || slot < 0) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  try {
    const { relPath, persist } = await preparePhotoUpload(file, 'weekly', String(week), slot);
    let previousPath: string | null = null;
    // Photo write and db mutation run concurrently — neither needs the
    // other's result, only the precomputed path.
    const [updated] = await Promise.all([
      mutateDb((db) => {
        const meta = db.weeks.find((w) => w.week === week);
        if (!meta) throw new Error(`Week ${week} not found`);
        if (slot >= meta.documentation.length) throw new Error(`Slot ${slot} out of range`);
        previousPath = meta.documentation[slot] ?? null;
        meta.documentation[slot] = relPath;
        return meta;
      }),
      persist(),
    ]);
    // Replaced photo is unreachable once the db points elsewhere — clean it
    // up after the response instead of making the client wait for it.
    after(() => deleteUploadedPhoto(previousPath).catch(() => undefined));
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const slot = Number(new URL(request.url).searchParams.get('slot'));

  try {
    let removedPath: string | null = null;
    const updated = await mutateDb((db) => {
      const meta = db.weeks.find((w) => w.week === week);
      if (!meta) throw new Error(`Week ${week} not found`);
      removedPath = meta.documentation[slot] ?? null;
      meta.documentation[slot] = null;
      return meta;
    });
    after(() => deleteUploadedPhoto(removedPath).catch(() => undefined));
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const { action } = (await request.json()) as { action?: string };

  try {
    const updated = await mutateDb((db) => {
      const meta = db.weeks.find((w) => w.week === week);
      if (!meta) throw new Error(`Week ${week} not found`);
      if (action === 'addPage') {
        meta.documentation.push(...Array<string | null>(PAGE_SIZE).fill(null));
      } else if (action === 'removePage') {
        if (meta.documentation.length <= PAGE_SIZE) throw new Error('Cannot remove the first page');
        const lastPage = meta.documentation.slice(-PAGE_SIZE);
        if (lastPage.some((p) => p !== null)) throw new Error('Last page still has photos');
        meta.documentation.length -= PAGE_SIZE;
      } else {
        throw new Error('Unknown action');
      }
      return meta;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
