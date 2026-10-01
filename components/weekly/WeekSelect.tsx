'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { weekRangeLabel } from '@/lib/daily-week';

export default function WeekSelect({
  weeks: weeksAsGiven,
  selectedWeek,
  projectCurrentWeek,
  activeTab,
  basePath = '/weekly',
  hrefPattern,
  prefetch = true,
  anchorEnd,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
  activeTab: string;
  /** Document Control drives the same control over its own routes. */
  basePath?: string;
  /**
   * For a destination that is not `basePath/week/tab` — the Dashboard is one
   * page and carries its week in the query. A pattern string rather than a
   * function because this is a client component and a function prop cannot
   * cross that boundary. `{week}` is the placeholder.
   */
  hrefPattern?: string;
  /**
   * Warm the router cache for nearby weeks. OFF for the Dashboard: one prefetch
   * is roughly three segment requests and every dashboard week is a whole
   * project rollup — sixty of those speculatively is a storm, not a warm-up.
   */
  prefetch?: boolean;
  /** Week one's end date, so each row can say which seven days it is. */
  anchorEnd?: string;
}) {
  const router = useRouter();
  // Newest first, as the Daily Reports filter lists them, so every week list in the
  // app reads the same way up.
  const weeks = useMemo(() => [...weeksAsGiven].sort((a, b) => b - a), [weeksAsGiven]);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [isPending, startTransition] = useTransition();
  // The picked week shows in the trigger immediately; the server render
  // catches up in the background (and selectedWeek takes over on arrival).
  const [pickedWeek, setPickedWeek] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * The panel is PORTALLED to the body and positioned by hand, because
   * `absolute` leaves it inside whatever stacking context the page has
   * already created around it, and no z-index climbs out of one. Every
   * header that carries this control rides `.animate-enter`, whose `both`
   * fill leaves a transform on the element forever — that IS a stacking
   * context — and so does every `Reveal` below it. Two siblings both at
   * z-index auto paint in DOM order, so the dashboard drew its first card
   * straight over the open week list (reported 8 September 2026). Fixed
   * coordinates measured off the trigger dodge the whole question, and
   * ancestor `overflow` clipping with it.
   */
  const [anchor, setAnchor] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
    flip: boolean;
  } | null>(null);

  const displayedWeek = isPending && pickedWeek !== null ? pickedWeek : selectedWeek;
  const hrefFor = (w: number) =>
    hrefPattern ? hrefPattern.replace('{week}', String(w)) : `${basePath}/${w}/${activeTab}`;

  // Measured off the trigger, clamped to the viewport, and flipped above it
  // when there is more room up there — a fixed panel cannot be scrolled to.
  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const below = window.innerHeight - r.bottom - gap - 8;
    const above = r.top - gap - 8;
    const flip = below < 220 && above > below;
    setAnchor({
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      top: flip ? undefined : r.bottom + gap,
      bottom: flip ? window.innerHeight - r.top + gap : undefined,
      width: r.width,
      maxHeight: Math.max(160, Math.min(288, flip ? above : below)),
      flip,
    });
  }, []);

  // `capture`, because this app does not scroll the document: `<main>`
  // scrolls, and the weekly report has a second scroller inside it. A
  // bubbling listener would never hear either, and the panel would hang in
  // mid-air while the page moved under it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  function close() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
  }

  function toggle() {
    if (open) {
      close();
    } else {
      setActiveIdx(-1);
      // Measured BEFORE the panel mounts, so its first painted frame is
      // already in the right place rather than in the top-left corner.
      measure();
      setOpen(true);
    }
  }

  function pick(w: number) {
    close();
    if (w !== selectedWeek) {
      setPickedWeek(w);
      startTransition(() => router.push(hrefFor(w)));
    }
  }

  // Warm the router cache so picking a week commits instantly. As soon as the
  // control mounts (not only on open — open-then-click can beat a prefetch):
  // the neighbours of the selection plus the project's current week (the
  // likeliest jumps). While browsing: whatever row the cursor/keys are on.
  useEffect(() => {
    if (!prefetch) return;
    const idx = weeks.indexOf(selectedWeek);
    const targets = new Set<number>([
      projectCurrentWeek,
      ...weeks.slice(Math.max(0, idx - 3), idx + 4),
    ]);
    const warm = () =>
      targets.forEach((w) => {
        if (w && w !== selectedWeek) router.prefetch(hrefFor(w));
      });
    // Defer to idle time so warming never competes with rendering this page.
    // (Safari has no requestIdleCallback — fall back to a short timeout.)
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, selectedWeek, projectCurrentWeek, activeTab, basePath, hrefPattern, prefetch, router]);

  useEffect(() => {
    if (!open || !prefetch) return;
    const w = weeks[activeIdx];
    if (w != null && w !== selectedWeek) router.prefetch(hrefFor(w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIdx, weeks, selectedWeek, activeTab, basePath, hrefPattern, prefetch, router]);

  // Prefetch every week row the moment it becomes visible in the open panel
  // (including while scrolling), so whichever week the user can see and click
  // is already in the router cache when the click lands.
  useEffect(() => {
    if (!open || !prefetch || !listRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const w = Number((entry.target as HTMLElement).dataset.week);
          if (w && w !== selectedWeek) router.prefetch(hrefFor(w));
          observer.unobserve(entry.target);
        }
      },
      { root: listRef.current },
    );
    listRef.current.querySelectorAll('[data-week]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, weeks, selectedWeek, activeTab, basePath, hrefPattern, prefetch, router]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The panel lives outside this subtree now, so it has to be asked too
      // — otherwise a mousedown inside it unmounts the row before its click.
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Opens on the week being shown, in the middle and landing on a whole row (the
  // Daily Reports filter does the same), then follows the keyboard cursor.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>(`[data-week="${selectedWeek}"]`);
    if (!list || !target) return;
    const row = target.offsetHeight;
    const above = Math.floor((Math.floor(list.clientHeight / row) - 1) / 2);
    list.scrollTop = target.offsetTop - list.offsetTop - above * row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current || activeIdx < 0) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i < 0 ? Math.max(0, weeks.indexOf(selectedWeek)) : Math.min(weeks.length - 1, i + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i < 0 ? Math.max(0, weeks.indexOf(selectedWeek)) : Math.max(0, i - 1)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(weeks.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const w = weeks[activeIdx];
      if (w != null) pick(w);
    }
  }

  return (
    <div ref={rootRef} className="relative w-fit">
      <m.button
        {...pressMotion}
        type="button"
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-11 w-38 items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2 text-sm font-medium tabular-nums text-foreground shadow-sm transition-colors duration-200 ease-ios hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap">Week {displayedWeek}</span>
        {isPending ? (
          <svg
            className="h-4 w-4 animate-spin text-chart-1"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-90"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : (
          <svg
            className="h-4 w-4 text-muted-foreground transition-transform duration-200 ease-ios"
            style={{
              transform: open && !closing ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </m.button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: anchor.left,
              top: anchor.top,
              bottom: anchor.bottom,
              width: anchor.width,
              // Above the sidebar and the sticky headers, which stop at 50.
              zIndex: 70,
              transformOrigin: anchor.flip ? 'bottom left' : 'top left',
            }}
            className={`overflow-hidden rounded-xl border bg-popover p-1 shadow-xl ring-1 ring-foreground/10 ${
              closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
            }`}
          >
            <div
              ref={listRef}
              style={{ maxHeight: anchor.maxHeight }}
              className="scrollbar-none overflow-y-auto"
            >
              {weeks.map((w, i) => {
                const isSelected = w === selectedWeek;
                const isCurrent = w === projectCurrentWeek;
                const isActive = i === activeIdx;
                return (
                  <button
                    key={w}
                    data-idx={i}
                    data-week={w}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => pick(w)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm tabular-nums transition-colors duration-150 ${
                      isCurrent ? 'bg-ok-soft text-ok' : isActive ? 'bg-muted text-foreground' : 'text-foreground'
                    }`}
                    title={isCurrent ? 'Current week' : undefined}
                  >
                    {/* Two lines, as in the Daily Reports filter: the week, and its
                        seven days under it so every date starts at the same edge. */}
                    <span className="min-w-0 whitespace-nowrap">
                      <span className={`block ${isCurrent ? 'font-semibold' : 'font-medium'}`}>Week {w}</span>
                      {anchorEnd && (
                        <span className={`mt-0.5 block text-xs ${isCurrent ? 'text-ok/80' : 'text-muted-foreground'}`}>
                          {weekRangeLabel(anchorEnd, w)}
                        </span>
                      )}
                    </span>
                    {isCurrent && (
                      <svg
                        className="h-4 w-4 shrink-0 text-ok"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
