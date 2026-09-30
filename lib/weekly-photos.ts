import type { Database } from './types';

/** Slots per printed photograph sheet. The grid, the print sheet and the API share it. */
export const WEEKLY_PHOTO_PAGE_SIZE = 6;

/**
 * One week's photo slots for a project: what it has saved, or one empty page.
 * Always a fresh array, so a caller can edit it without touching the record.
 */
export function weeklyPhotosOf(json: Database, week: number): (string | null)[] {
  const saved = json.weeklyPhotos?.[String(week)];
  return saved ? [...saved] : Array<string | null>(WEEKLY_PHOTO_PAGE_SIZE).fill(null);
}
