import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { deleteUploadedPhoto, saveUploadedPhoto } from '@/lib/upload';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const formData = await request.formData();
  const slot = Number(formData.get('slot'));
  const file = formData.get('file');

  if (!(file instanceof File) || Number.isNaN(slot) || slot < 0 || slot > 5) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  try {
    const relPath = await saveUploadedPhoto(file, 'daily', date, slot);
    const updated = await mutateDb((db) => {
      const report = db.daily.find((d) => d.date === date);
      if (!report) throw new Error(`Daily report for ${date} not found`);
      report.photos[slot] = relPath;
      return report;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const slot = Number(new URL(request.url).searchParams.get('slot'));

  try {
    let removedPath: string | null = null;
    const updated = await mutateDb((db) => {
      const report = db.daily.find((d) => d.date === date);
      if (!report) throw new Error(`Daily report for ${date} not found`);
      removedPath = report.photos[slot] ?? null;
      report.photos[slot] = null;
      return report;
    });
    await deleteUploadedPhoto(removedPath);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
