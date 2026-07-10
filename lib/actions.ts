'use server';

import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
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
    // No refresh() here: the redirect below already renders the destination
    // fresh in this same request — refreshing the origin page too would
    // double the server render work and the response payload.
    updateTag('db');
  } catch (err) {
    return fail(err);
  }
  // Navigate server-side, inside this request: the destination page renders
  // with the freshly-expired cache, so it always sees the new report. A
  // client-side push after the action can race tag propagation on Vercel and
  // permanently cache a stale "not found" render for the new date.
  redirect(`/daily/${date}`);
}

export async function deleteDailyAction(date: string): Promise<ActionResult> {
  try {
    // applyDeleteDaily is idempotent: deleting a report that is already gone
    // (a stale list can show rows that no longer exist) is treated as done,
    // and the redirect below re-renders the list fresh — healing the staleness
    // instead of surfacing a "not found" error.
    const removed = await mutateDb((db) => applyDeleteDaily(db, date));
    if (removed) {
      // Best-effort cleanup of the report's stored photos.
      await Promise.all(removed.photos.map((p) => deleteUploadedPhoto(p).catch(() => undefined)));
    }
    updateTag('db');
  } catch (err) {
    return fail(err);
  }
  // Same server-side navigation as createDailyAction — the list re-renders
  // fresh in this request (from the list it acts as an in-place refresh).
  redirect('/daily');
}

// Read-your-own-writes refresh for mutations that go through the /api photo
// routes: re-renders the current page inside this action request, where the
// expired 'db' tag is guaranteed visible (router.refresh() from the client
// can race tag propagation and cache a stale render instead).
export async function refreshDbAction(): Promise<void> {
  updateTag('db');
  refresh();
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
