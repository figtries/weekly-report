import { NextRequest, NextResponse } from 'next/server';
import { after, connection } from 'next/server';
import { mutateProjectDb } from '@/lib/db';
import { getActiveProjectId } from '@/lib/projects';
import type { Database } from '@/lib/types';
import { deleteUploadedPhoto, preparePhotoUpload } from '@/lib/upload';
import { WEEKLY_PHOTO_PAGE_SIZE as PAGE_SIZE, weeklyPhotosOf } from '@/lib/weekly-photos';

// A week's photos belong to the OPEN project's own record (Database.weeklyPhotos),
// the same home its daily reports have. They used to go through `mutateDb`, which
// edits whatever db.json calls active and so refuses while any project is open:
// no project could save a weekly photo.

async function openProject(weekParam: string) {
  const week = Number(weekParam);
  if (!Number.isInteger(week) || week < 1) throw new Error('Invalid week');
  const projectId = await getActiveProjectId();
  if (!projectId) throw new Error('No project is open.');
  return { week, projectId };
}

/** The week's slots inside the record, created on first use. Edits go straight through. */
function slotsFor(db: Database, week: number): (string | null)[] {
  db.weeklyPhotos ??= {};
  return (db.weeklyPhotos[String(week)] ??= weeklyPhotosOf(db, week));
}

const reply = (week: number, documentation: (string | null)[]) =>
  NextResponse.json({ week, documentation });

// Warm-up ping from PhotoUploadGrid, same as the daily route's: the instance
// boots while the file picker is open.
export async function GET() {
  await connection();
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const formData = await request.formData();
  const slot = Number(formData.get('slot'));
  const file = formData.get('file');

  if (!(file instanceof File) || Number.isNaN(slot) || slot < 0) {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }

  try {
    const { week, projectId } = await openProject(weekParam);
    // Named photoExif, not meta: keeps clear of any record the mutation binds.
    // The project id is in the folder so two projects' week 48 never share one.
    const { relPath, meta: photoExif, persist } = await preparePhotoUpload(
      file,
      'weekly',
      `${projectId}/${week}`,
      slot
    );
    let previousPath: string | null = null;
    // Photo write and db mutation run concurrently — neither needs the
    // other's result, only the precomputed path.
    const [documentation] = await Promise.all([
      mutateProjectDb(projectId, (db) => {
        const slots = slotsFor(db, week);
        if (slot >= slots.length) throw new Error(`Slot ${slot} out of range`);
        previousPath = slots[slot] ?? null;

        db.photoMeta ??= {};
        db.photoMeta[relPath] = {
          path: relPath,
          takenAt: photoExif.takenAt,
          lat: photoExif.lat,
          lon: photoExif.lon,
          device: [photoExif.make, photoExif.model].filter(Boolean).join(' ') || undefined,
          uploadedAt: new Date().toISOString(),
          verified: !!photoExif.takenAt,
        };
        if (previousPath && db.photoMeta[previousPath]) delete db.photoMeta[previousPath];
        slots[slot] = relPath;
        return [...slots];
      }),
      persist(),
    ]);
    // Replaced photo is unreachable once the db points elsewhere — clean it
    // up after the response instead of making the client wait for it.
    after(() => deleteUploadedPhoto(previousPath).catch(() => undefined));
    return reply(week, documentation);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const slot = Number(new URL(request.url).searchParams.get('slot'));

  try {
    const { week, projectId } = await openProject(weekParam);
    let removedPath: string | null = null;
    const documentation = await mutateProjectDb(projectId, (db) => {
      const slots = slotsFor(db, week);
      removedPath = slots[slot] ?? null;
      slots[slot] = null;
      return [...slots];
    });
    after(() => deleteUploadedPhoto(removedPath).catch(() => undefined));
    return reply(week, documentation);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const { action, pages } = (await request.json()) as { action?: string; pages?: number };
  // More than one page at once when a multi-photo pick needs more room than is left.
  const count = Math.min(Math.max(Math.floor(Number(pages) || 1), 1), 20);

  try {
    const { week, projectId } = await openProject(weekParam);
    const documentation = await mutateProjectDb(projectId, (db) => {
      const slots = slotsFor(db, week);
      if (action === 'addPage') {
        slots.push(...Array<string | null>(PAGE_SIZE * count).fill(null));
      } else if (action === 'removePage') {
        if (slots.length <= PAGE_SIZE) throw new Error('Cannot remove the first page');
        const lastPage = slots.slice(-PAGE_SIZE);
        if (lastPage.some((p) => p !== null)) throw new Error('Last page still has photos');
        slots.length -= PAGE_SIZE;
      } else {
        throw new Error('Unknown action');
      }
      return [...slots];
    });
    return reply(week, documentation);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
