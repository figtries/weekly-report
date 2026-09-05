'use client';

import { useEffect, useState } from 'react';

/**
 * A project's whole life as one bar, with today crossing it.
 *
 * Microsoft Project has nothing like this — there a project is a filename. The
 * dates are already in the database, so this is the cheapest thing in the app
 * that turns a list into something you can read at a glance: not started, under
 * way, or past due.
 *
 * `today` is read in the BROWSER, deliberately. A server component under
 * `cacheComponents` prerenders into the static shell, so a `Date.now()` up
 * there would be frozen at build time and the marker would drift a little
 * further from the truth every day, silently. Rendering it after mount costs
 * one paint and is simply correct.
 */
export default function MiniGantt({
  startDate,
  finishDate,
  totalWeeks = 0,
  className = '',
}: {
  startDate: string | null;
  finishDate: string | null;
  /** Reporting weeks in the project, so the bar can say where today falls. */
  totalWeeks?: number;
  className?: string;
}) {
  const [todayPct, setTodayPct] = useState<number | null>(null);

  useEffect(() => {
    if (!startDate || !finishDate) return;
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const finish = Date.parse(`${finishDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return;
    const now = Date.now();
    setTodayPct(((now - start) / (finish - start)) * 100);
  }, [startDate, finishDate]);

  if (!startDate || !finishDate) {
    return (
      <div className={`h-1.5 rounded-full bg-muted ${className}`} aria-hidden />
    );
  }

  const clamped = todayPct === null ? null : Math.min(100, Math.max(0, todayPct));
  const state =
    todayPct === null ? 'unknown' : todayPct < 0 ? 'before' : todayPct > 100 ? 'after' : 'during';

  // Nothing is said until the browser has supplied today's date — a caption
  // rendered from a build-time clock would be quietly wrong.
  let caption: string | null = null;
  if (state === 'before') caption = 'Not started';
  else if (state === 'after') caption = 'Past its finish date';
  else if (state === 'during' && todayPct !== null) {
    caption = totalWeeks
      ? `Week ${Math.min(totalWeeks, Math.floor((todayPct / 100) * totalWeeks) + 1)} of ${totalWeeks}`
      : `${Math.round(todayPct)}% of the way through`;
  }

  return (
    <div className={`relative ${className}`}>
      {/* Solid tokens, no `/opacity` modifier — and that is not a style
          preference. In this project `--color-muted: var(--muted)` is an
          indirection, so Tailwind cannot compute the color-mix at build time
          and silently drops the alpha: `.bg-muted\/40` compiles to plain
          `var(--muted)`, and `bg-foreground/15` is not emitted at all, which
          renders transparent. Verified in the built stylesheet.

          Neutral greys on purpose, too: blue and red already mean actual and
          plan everywhere in this app, and nothing here is measured yet. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {state === 'during' && clamped !== null && (
          <div
            className="h-full rounded-full bg-muted-foreground transition-[width] duration-500 ease-ios"
            style={{ width: `${clamped}%` }}
          />
        )}
        {state === 'after' && <div className="h-full w-full rounded-full bg-muted-foreground" />}
      </div>

      {/* Today. Only drawn when it actually falls inside the span — a marker
          pinned to an edge would claim a date it does not mean. */}
      {state === 'during' && clamped !== null && (
        <span
          className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground"
          style={{ left: `calc(${clamped}% - 1px)` }}
          aria-hidden
        />
      )}

      {/* A bar with no caption is decoration. This says where today falls in
          the project's own units — weeks, because that is what every report
          here is counted in. It is CALENDAR position, not progress: nothing on
          this screen claims to know how much work is done. */}
      {caption && <p className="mt-2 text-[11px] font-medium">{caption}</p>}
    </div>
  );
}
