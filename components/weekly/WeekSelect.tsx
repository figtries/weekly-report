'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';

export default function WeekSelect({
  weeks,
  selectedWeek,
  projectCurrentWeek,
  activeTab,
  basePath = '/weekly',
  hrefPattern,
  prefetch = true,
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIdx, setActiveIdx] = useState(() => weeks.indexOf(selectedWeek));
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
      setActiveIdx(weeks.indexOf(selectedWeek));
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

  // Centre the selected/active row each time the panel opens or the cursor moves.
  useEffect(() => {
    if (!open || !listRef.current) return;
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
      setActiveIdx((i) => Math.min(weeks.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
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
        className="flex min-h-11 items-center gap-2 rounded-lg border bg-card py-2 pr-2.5 pl-3 text-sm font-medium tabular-nums text-foreground shadow-sm transition-colors duration-200 ease-ios hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <span>Week {displayedWeek}</span>
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
              minWidth: anchor.width,
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
              className="scrollbar-none space-y-0.5 overflow-y-auto"
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
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm tabular-nums transition-colors duration-150 ${
                      isCurrent
                        ? 'bg-ok-soft font-semibold text-ok'
                        : isSelected
                          ? 'bg-chart-1/10 font-semibold text-chart-1'
                          : isActive
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground'
                    }`}
                    title={isCurrent ? 'Current week' : undefined}
                  >
                    <span>Week {w}</span>
                    {isSelected && (
                      <svg
                        className={`h-4 w-4 shrink-0 ${isCurrent ? 'text-ok' : 'text-chart-1'}`}
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
