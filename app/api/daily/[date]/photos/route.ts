import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { deleteUploadedPhoto, saveUploadedPhoto } from '@/lib/upload';

const PAGE_SIZE = 6;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const formData = await request.formData();
  const slot = Number(formData.get('slot'));
  const file = formData.get('file');

  if (!(file instanceof File) || Number.isNaN(slot) || slot < 0) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  try {
    const relPath = await saveUploadedPhoto(file, 'daily', date, slot);
    let previousPath: string | null = null;
    const updated = await mutateDb((db) => {
      const report = db.daily.find((d) => d.date === date);
      if (!report) throw new Error(`Daily report for ${date} not found`);
      if (slot >= report.photos.length) throw new Error(`Slot ${slot} out of range`);
      previousPath = report.photos[slot] ?? null;
      report.photos[slot] = relPath;
      return report;
    });
    await deleteUploadedPhoto(previousPath);
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const { action } = (await request.json()) as { action?: string };

  try {
    const updated = await mutateDb((db) => {
      const report = db.daily.find((d) => d.date === date);
      if (!report) throw new Error(`Daily report for ${date} not found`);
      if (action === 'addPage') {
        report.photos.push(...Array<string | null>(PAGE_SIZE).fill(null));
      } else if (action === 'removePage') {
        if (report.photos.length <= PAGE_SIZE) throw new Error('Cannot remove the first page');
        const lastPage = report.photos.slice(-PAGE_SIZE);
        if (lastPage.some((p) => p !== null)) throw new Error('Last page still has photos');
        report.photos.length -= PAGE_SIZE;
      } else {
        throw new Error('Unknown action');
      }
      return report;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
