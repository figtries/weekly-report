import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { deleteUploadedPhoto, saveUploadedPhoto } from '@/lib/upload';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const formData = await request.formData();
  const slot = Number(formData.get('slot'));
  const file = formData.get('file');

  if (!(file instanceof File) || Number.isNaN(slot) || slot < 0 || slot > 5) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  try {
    const relPath = await saveUploadedPhoto(file, 'weekly', String(week), slot);
    const updated = await mutateDb((db) => {
      const meta = db.weeks.find((w) => w.week === week);
      if (!meta) throw new Error(`Week ${week} not found`);
      meta.documentation[slot] = relPath;
      return meta;
    });
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
    await deleteUploadedPhoto(removedPath);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
