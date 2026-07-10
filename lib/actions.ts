'use server';

import { refresh, updateTag } from 'next/cache';
import { mutateDb } from './db';
import { applyCreateDaily, applyDeleteDaily, applyPatchDaily, applyWeekUpdates } from './mutations';
import { deleteUploadedPhoto } from './upload';
import type { DailyReport, LeafSnapshot } from './types';

// Server Actions replace the old fetch('/api/...') + router.refresh() pattern:
// one round trip that mutates, expires the 'db' cache tag (updateTag = read
// your own writes) and streams the re-rendered page back in the same response.

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

export async function setCurrentWeekAction(week: number): Promise<ActionResult> {
  try {
    await mutateDb((db) => {
      if (!db.weeks.some((w) => w.week === week)) throw new Error(`Week ${week} not found`);
      db.project.currentWeek = week;
    });
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function createDailyAction(date: string): Promise<ActionResult> {
  try {
    await mutateDb((db) => applyCreateDaily(db, date));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteDailyAction(date: string): Promise<ActionResult> {
  try {
    const removed = await mutateDb((db) => applyDeleteDaily(db, date));
    // Best-effort cleanup of the report's stored photos.
    await Promise.all(removed.photos.map((p) => deleteUploadedPhoto(p).catch(() => undefined)));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveDailyAction(
  date: string,
  patch: Partial<Omit<DailyReport, 'date'>>
): Promise<ActionResult> {
  try {
    await mutateDb((db) => applyPatchDaily(db, date, patch));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveWeekUpdatesAction(
  week: number,
  updates: Record<string, Partial<LeafSnapshot>>
): Promise<ActionResult> {
  try {
    await mutateDb((db) => applyWeekUpdates(db, week, updates));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
