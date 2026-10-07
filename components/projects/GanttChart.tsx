'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Flag } from 'lucide-react';

import type { SheetRow } from '@/lib/sheet';
import type { Network } from '@/lib/chains';
import { arrowPath, visibleEnd } from '@/lib/gantt-arrows';
import type { LinkType } from '@/lib/links';
import { warmLinkDragCard } from './links-panel-loader';
import { KIND_KEYS, KIND_LABEL, paintCss, paintOf, segmentsOf, type BarView, type ColourBy } from '@/lib/bar-view';
import type { BarFact } from '@/lib/bar-facts';

/**
 * The timeline.
 *
 * **A bar is its plan** (7 Oct 2026, replacing the bar-style rule list). It is
 * drawn from the plan's dates and cut into the stages of its kind of work
 * (IFR / IFA / AFC, PO to On site), solid as each is ticked, so the solid
 * length IS how much is done. What colour says is the planner's one choice
 * (kind of work, package, or nothing; lib/bar-view.ts). Forecast, contract and
 * slack are marks the planner turns on or off in the Bars panel.
 *
 * The palette is `--plan-1..6`, deliberately separate from `--chart-1..5`, which
 * already mean actual / plan / done / at risk / dormant elsewhere in this app.
 * Red is the forecast's and never a bar colour.
 *
 * **Identity is never colour alone.** Every bar is direct-labelled by its own
 * row in the sheet on the same line, shape separates the three kinds (summary
 * bracket, task bar, milestone diamond), and a legend names each colour.
 *
 * **Days-to-pixels is chosen per plan.** At a fixed 3px/day a three-day project
 * drew nine pixels of bar across a thousand-pixel pane.
 */

const MS_PER_DAY = 86_400_000;
const TARGET_PX = 1200;
/** Never thinner than this, or a bar becomes a dot. */
const MIN_PX_PER_DAY = 1.5;
/** Never wider than this, or a two-week plan becomes a ruler nobody can scan. */
const MAX_PX_PER_DAY = 90;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}
/**
 * Same shape as the sheet's, "Sept" trimmed to "Sep" for the same reason — and
 * built once and cached for the same reason too: see `fmtDate` in
 * ScheduleSheet. Three calls per bar, on every bar in the window.
 */
const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const dateCache = new Map<string, string>();
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const hit = dateCache.get(iso);
  if (hit !== undefined) return hit;
  const out = DATE_FMT.format(utc(iso)).replace('Sept', 'Sep');
  dateCache.set(iso, out);
  return out;
}
/**
 * Days to pixels, chosen per plan AND per pane.
 *
 * The ceiling used to be 24px/day, which is why a twelve-day project drew
 * one-day bars 22 pixels wide and looked like nothing at all. A day column can
 * be as wide as MAX_PX_PER_DAY before it stops being a calendar and starts
 * being a ruler; below MIN a bar is a dot.
 *
 * The target is whichever is larger, the pane or ~1200px: a short plan spreads
 * out and becomes legible, a long one stays scrollable at a sane density
 * instead of being crushed into whatever pane it was given.
 */
function pxPerDay(days: number, paneWidth: number): number {
  if (days <= 0) return 8;
  const target = Math.max(TARGET_PX, paneWidth);
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, target / days));
}

export default function GanttChart({
  rows,
  spanStart,
  spanFinish,
  rowH,
  headH,
  selectedId,
  onSelect,
  view,
  facts,
  colourBy,
  labels,
  range,
  fit = false,
  network = null,
  parentOf,
  onClear,
  onLink,
}: {
  rows: SheetRow[];
  spanStart: string | null;
  spanFinish: string | null;
  rowH: number;
  headH: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The planner's Bars choices: what colour says, which marks show. */
  view: BarView;
  /** What each bar has to say: kind, stages, done, forecast (lib/bar-facts.ts). */
  facts: Record<string, BarFact>;
  /** What colour says on this plan (`view.colourBy`). */
  colourBy: ColourBy;
  /** Each row's label, its own or its heading's (lib/bar-view.ts `labelsByRow`). */
  labels: Map<string, string | null>;
  /**
   * Draw the whole span inside the pane instead of at a readable day width.
   *
   * `pxPerDay` aims at 1200px of calendar so a week is still a week you can
   * point at, which on a phone means a three-month plan is three screens wide
   * with no sign that there is anything past the right edge. Answering "show
   * me all of it" by scrolling is not answering it.
   */
  fit?: boolean;
  /**
   * The window of rows the sheet has mounted. The surface stays FULL height —
   * every bar is placed at `index × rowH`, so the height is what keeps the two
   * panes on the same line — and only the bars inside the window are built.
   */
  range?: { start: number; end: number };
  /** The links read against the plan (lib/chains.ts). Null or absent draws no arrows. */
  network?: Network | null;
  /** Every row's parent, so an arrow to a collapsed row ends on its group. */
  parentOf?: Map<string, string | null>;
  /** Pressing empty chart lets go of the pressed bar, so every arrow is even again. */
  onClear?: () => void;
  /** A drag from one bar end to another (mouse only): the way the ends imply. */
  onLink?: (fromId: string, toId: string, type: LinkType) => void;
}) {
  const [todayX, setTodayX] = useState<number | null>(null);

  // A mouse, not a finger: on touch a handle is a mis-tap waiting to happen,
  // and the Links panel does the job there.
  const fine = useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia('(pointer: fine)');
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => window.matchMedia('(pointer: fine)').matches,
    () => false
  );
  // A drag never goes through React state while it moves: the pointer fires
  // ~120 times a second and re-rendering every bar that often is the jank the
  // budget forbids. The line and the target ring are written straight into two
  // SVG elements, once per frame. React hears about a drag twice: when it
  // starts (to show the layer) and when it ends (onLink).
  type End = 'start' | 'finish';
  const dragRef = useRef<{ fromId: string; fromEnd: End; x0: number; y0: number; target: { id: string; end: End } | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lineRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const frame = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endDrag = () => {
    dragRef.current = null;
    cancelAnimationFrame(frame.current);
    setDragging(false);
  };
  useEffect(() => {
    if (!dragging) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dragRef.current = null;
        cancelAnimationFrame(frame.current);
        setDragging(false);
      }
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [dragging]);
  function startDrag(e: React.PointerEvent, fromId: string, fromEnd: End, x0: number, y0: number) {
    e.stopPropagation();
    e.preventDefault();
    bodyRef.current?.setPointerCapture(e.pointerId);
    void warmLinkDragCard();
    dragRef.current = { fromId, fromEnd, x0, y0, target: null };
    setDragging(true);
  }
  const wayOf = (a: End, b: End): LinkType | null =>
    a === 'finish' && b === 'start' ? 'FS' : a === 'start' && b === 'start' ? 'SS' : a === 'finish' && b === 'finish' ? 'FF' : null;
  // The pane's own width, so a short plan can fill it. Measured rather than
  // guessed: the split divider moves, and so does the window.
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useLayoutEffect(() => {
    const el = paneRef.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setPaneWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const end = useMemo(() => {
    const last = rows.reduce<string | null>(
      (acc, r) => (r.finishDate && (!acc || r.finishDate > acc) ? r.finishDate : acc),
      null
    );
    if (!spanFinish) return last;
    if (!last) return spanFinish;
    return last > spanFinish ? last : spanFinish;
  }, [rows, spanFinish]);

  const days = spanStart && end ? daysBetween(spanStart, end) + 1 : 0;
  const scale =
    days > 0 ? (fit ? Math.max(MIN_PX_PER_DAY, paneWidth / days) : pxPerDay(days, paneWidth)) : 8;
  // At least as wide as the pane. A plan whose rows all sit on one day inside
  // a two-week project genuinely fills almost none of its calendar — that is
  // true and should look it. What read as broken was the drawing surface
  // STOPPING at 288px, so the month lines and the today line covered a third
  // of the pane and bare white covered the rest.
  const width = days > 0 ? Math.max(days * scale, paneWidth, 240) : Math.max(paneWidth, 240);

  const months = useMemo(() => {
    if (!spanStart || !end) return [];
    const out: { key: string; x: number; label: string }[] = [];
    const first = new Date(utc(spanStart));
    const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    const stop = utc(end);
    for (let i = 0; i < 400 && cursor.getTime() <= stop; i++) {
      const x = ((cursor.getTime() - utc(spanStart)) / MS_PER_DAY) * scale;
      out.push({
        key: cursor.toISOString().slice(0, 7),
        // The month containing the start begins before it — pin its label to the
        // edge rather than dropping it, or a short plan shows no month at all.
        x: Math.max(0, x),
        label: new Intl.DateTimeFormat('en-GB', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(cursor),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    // Two labels closer than their own width collide, and the first is pinned to
    // the edge so it collides most often.
    return out.filter((m, i) => i === 0 || m.x - out[i - 1].x >= 46);
  }, [spanStart, end, scale]);

  useEffect(() => {
    if (!spanStart) return;
    // Today comes from the browser. A server component prerenders into the
    // static shell, so a build-time clock would drift a day further from the
    // truth every day, silently.
    const x = ((Date.now() - utc(spanStart)) / MS_PER_DAY) * scale;
    setTodayX(x >= 0 && x <= width ? x : null);
  }, [spanStart, scale, width]);

  const bodyH = rows.length * rowH;
  const xOf = (iso: string) => (spanStart ? daysBetween(spanStart, iso) * scale : 0);
  const endsOf = (r: SheetRow) => ({ x1: xOf(r.startDate!), x2: xOf(r.finishDate!) + scale });

  // Every arrow in ONE svg, built only when what it draws changes, never on
  // hover or scroll. ALWAYS VISIBLE (7 Oct 2026): an arrow you only see after
  // pressing its bar is one nobody responds to. Pressing a bar thickens its own
  // arrows and fades nothing; the Bars menu can switch them all off.
  const showLinks = view.marks.links;
  const arrowLayer = useMemo(() => {
    if (!showLinks || !network || !spanStart || !network.links.length) return null;
    const visibleIndex = new Map(rows.map((r, i) => [r.id, i]));
    const parents = parentOf ?? new Map<string, string | null>();
    return (
      <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-[6] overflow-visible" width={width} height={bodyH}>
        <defs>
          {(['muted', 'path', 'lit', 'bad'] as const).map((k) => (
            <marker key={k} id={`ah-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill={k === 'bad' ? 'var(--bad)' : k === 'muted' ? 'var(--muted-foreground)' : 'var(--foreground)'} />
            </marker>
          ))}
        </defs>
        {network.links.map((l) => {
          const a = visibleEnd(l.fromId, visibleIndex, parents);
          const b = visibleEnd(l.toId, visibleIndex, parents);
          if (!a || !b || a.index === b.index) return null;
          const ra = rows[a.index];
          const rb = rows[b.index];
          if (!ra.startDate || !ra.finishDate || !rb.startDate || !rb.finishDate) return null;
          const lit = selectedId != null && (l.fromId === selectedId || l.toId === selectedId);
          const bad = l.slack < 0;
          const onPath = Boolean(network.rows.get(l.fromId)?.setsProjectFinish && network.rows.get(l.toId)?.setsProjectFinish);
          const kind = bad ? 'bad' : lit ? 'lit' : onPath ? 'path' : 'muted';
          const to = { ...endsOf(rb), y: b.index * rowH + rowH / 2, milestone: rb.isMilestone && !b.collapsed };
          return (
            <g key={`${l.fromId}>${l.toId}`}>
              <path
                d={arrowPath(l.type, { ...endsOf(ra), y: a.index * rowH + rowH / 2 }, to, rowH)}
                fill="none"
                stroke={bad ? 'var(--bad)' : kind === 'muted' ? 'var(--muted-foreground)' : 'var(--foreground)'}
                strokeOpacity={kind === 'muted' ? 0.85 : 1}
                strokeWidth={lit ? 2.25 : bad ? 1.75 : 1.35}
                strokeDasharray={bad || a.collapsed || b.collapsed ? '4 3' : undefined}
                markerEnd={`url(#ah-${kind})`}
                className="transition-[stroke-width,stroke-opacity] duration-200 ease-ios"
              />
              {l.wait > 0 && (
                // Just above the end the arrow enters, inside that row: never
                // clipped by the chart's edge, never on top of another label.
                <text
                  x={l.type === 'FF' ? to.x2 - 2 : to.x1 + 2}
                  y={to.y - 8}
                  textAnchor={l.type === 'FF' ? 'end' : 'start'}
                  // A halo the colour of the chart, so a line crossing the
                  // label passes behind it instead of through it.
                  stroke="var(--card)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  className="fill-muted-foreground text-[10px] font-medium"
                >
                  +{l.wait} {l.wait === 1 ? 'day' : 'days'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
    // xOf and endsOf are derived from spanStart and scale, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLinks, network, rows, scale, spanStart, selectedId, parentOf, rowH, width, bodyH]);

  if (!spanStart) {
    return (
      <p className="p-6 text-xs text-muted-foreground">
        No dates yet. Give a row a start and a finish and its bar appears here.
      </p>
    );
  }

  // The slice that gets built, with its offset kept so `i` is still the row's
  // real position on the surface.
  const from = range ? Math.max(0, range.start) : 0;
  const to = range ? Math.min(rows.length, range.end) : rows.length;
  const shown = rows.slice(from, to);

  /**
   * What sits beside a bar and is not the bar: where the forecast finishes it
   * past its plan (a red hatched extension with the days written after it),
   * how far it can slip (a dashed tail, only for a row linked through to the
   * finish), the contract's dates (a thin grey bar beneath, once a contract is
   * locked) and a conflict (a red "!" and a pale band over the days the plan
   * breaks its link). The first three are marks the Bars panel turns on/off.
   */
  const extras = (r: SheetRow, x: number, w: number, y: number) => {
    const c = network?.rows.get(r.id)?.conflicts[0];
    const ff = facts[r.id]?.forecastFinish;
    const late =
      view.marks.forecast && !r.isSummary && ff && r.finishDate && ff > r.finishDate ? daysBetween(r.finishDate, ff) : 0;
    return (
      <>
        {late > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-[3] flex items-center"
            style={{ left: xOf(r.finishDate!) + scale, top: y + rowH / 2 - 6, height: 12 }}
          >
            <span
              className="h-3 rounded-r-[3px] border border-l-0 border-[var(--bad)]"
              style={{
                width: Math.max(late * scale, 3),
                background: 'repeating-linear-gradient(135deg, var(--bad) 0 2px, transparent 2px 5px)',
              }}
            />
            <span className="ml-1 whitespace-nowrap text-[10px] font-semibold tabular-nums text-[var(--bad)]">
              +{late} d
            </span>
          </span>
        )}
        {view.marks.slip && late === 0 && r.totalFloat != null && r.totalFloat > 0 && !r.isSummary && (
          <span
            aria-hidden
            className="pointer-events-none absolute z-[3] flex items-center"
            style={{ left: x + w + 2, top: y + rowH / 2 - 4, height: 8 }}
          >
            <span className="border-t-[1.5px] border-dashed border-muted-foreground/60" style={{ width: Math.max(r.totalFloat * scale - 2, 4) }} />
            <span className="h-2 w-[1.5px] bg-muted-foreground/60" />
            <span className="ml-1 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              +{r.totalFloat} {r.totalFloat === 1 ? 'day' : 'days'}
            </span>
          </span>
        )}
        {view.marks.contract && r.contractStart && r.contractFinish && !r.isSummary && (
          <span
            aria-hidden
            title={`Contract ${fmtDate(r.contractStart)} → ${fmtDate(r.contractFinish)}`}
            className="pointer-events-none absolute z-[2] rounded-full bg-muted-foreground/30"
            style={{
              left: xOf(r.contractStart),
              top: y + rowH / 2 + 8,
              height: 4,
              width: Math.max((daysBetween(r.contractStart, r.contractFinish) + 1) * scale, 3),
            }}
          />
        )}
        {c && r.startDate && r.finishDate && (() => {
          const edge = c.type === 'FF' ? xOf(r.finishDate) + scale : x;
          const bound = xOf(c.bound) + (c.type === 'FF' ? scale : 0);
          return (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute z-[1] bg-[var(--bad)]/10"
                style={{ left: Math.min(edge, bound), width: Math.abs(bound - edge), top: y + 4, height: rowH - 8 }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute z-[7] grid size-3.5 place-items-center rounded-full bg-[var(--bad)] text-[9px] font-bold text-white"
                style={{ left: Math.max(0, x - 16), top: y + rowH / 2 - 14 }}
              >
                !
              </span>
            </>
          );
        })()}
      </>
    );
  };

  return (
    <div ref={paneRef} className="relative" style={{ width }}>
      <div
        className="sticky top-0 z-20 border-b bg-card"
        style={{ height: headH }}
        aria-hidden
      >
        {months.map((m) => (
          <span
            key={m.key}
            className="absolute top-0 border-l pl-1 text-[10px] font-medium text-muted-foreground"
            style={{ left: m.x, lineHeight: `${headH}px` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div
        ref={bodyRef}
        className="relative"
        style={{ height: bodyH }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClear?.();
        }}
        // One delegated handler, so nothing inside the bars' map touches a ref
        // (React Compiler bails out of the whole chart if anything does).
        onPointerDown={(e) => {
          const h = (e.target as HTMLElement).closest<HTMLElement>('[data-link-handle]');
          if (!h?.dataset.row) return;
          startDrag(e, h.dataset.row, h.dataset.linkHandle as End, Number(h.dataset.x0), Number(h.dataset.y0));
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || !bodyRef.current) return;
          const box = bodyRef.current.getBoundingClientRect();
          const px = e.clientX - box.left;
          const py = e.clientY - box.top;
          const row = rows[Math.floor(py / rowH)];
          let target: { id: string; end: End } | null = null;
          let tx = 0;
          if (row && row.id !== drag.fromId && !row.isSummary && row.startDate && row.finishDate) {
            const sx = xOf(row.startDate);
            const fx = xOf(row.finishDate) + scale;
            const end: End = Math.abs(px - sx) <= Math.abs(px - fx) ? 'start' : 'finish';
            if (Math.min(Math.abs(px - sx), Math.abs(px - fx)) <= 16 && wayOf(drag.fromEnd, end)) {
              target = { id: row.id, end };
              tx = end === 'start' ? sx : fx;
            }
          }
          drag.target = target;
          const ty = Math.floor(py / rowH) * rowH + rowH / 2;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            lineRef.current?.setAttribute('d', `M${drag.x0} ${drag.y0} L${px} ${py}`);
            if (ringRef.current) {
              ringRef.current.setAttribute('cx', String(tx));
              ringRef.current.setAttribute('cy', String(ty));
              ringRef.current.style.opacity = target ? '1' : '0';
            }
          });
        }}
        onPointerUp={() => {
          const drag = dragRef.current;
          if (!drag) return;
          if (drag.target && onLink) {
            const way = wayOf(drag.fromEnd, drag.target.end);
            if (way) onLink(drag.fromId, drag.target.id, way);
          }
          endDrag();
        }}
      >
        {months.map((m) => (
          <span
            key={m.key}
            aria-hidden
            className="absolute top-0 w-px bg-border"
            style={{ left: m.x, height: bodyH }}
          />
        ))}

        {/* The selected row, lit on this side too — the two panes are one thing. */}
        {selectedId &&
          rows.map((r, i) =>
            r.id === selectedId ? (
              <span
                key="sel"
                aria-hidden
                className="absolute left-0 right-0 bg-muted"
                style={{ top: i * rowH, height: rowH }}
              />
            ) : null
          )}

        {todayX !== null && (
          <span
            aria-hidden
            title="Today"
            className="pointer-events-none absolute top-0 z-10 w-0 border-l-[1.5px] border-dashed border-sky-500"
            style={{ left: todayX, height: bodyH }}
          >
            <span className="absolute left-1 top-0.5 text-[10px] font-semibold text-sky-600">Today</span>
          </span>
        )}

        {/* Deadlines, drawn BEFORE the bars so a bar that runs through one is
            not hidden by it, and drawn independently of them so a row that has
            a promised date but no plan yet still shows the promise. MS Project
            puts an arrow here; so does this, pointing down at the day. */}
        {shown.map((r, k) => {
          const i = k + from;
          if (!r.targetDate) return null;
          const x = daysBetween(spanStart, r.targetDate) * scale;
          if (x < -8 || x > width + 8) return null;
          const late = r.daysLate != null;
          return (
            <span
              key={`t-${r.id}`}
              aria-hidden
              title={
                late
                  ? `Target ${fmtDate(r.targetDate)}, finishes ${r.daysLate} days late`
                  : `Target ${fmtDate(r.targetDate)}`
              }
              className="absolute z-[5]"
              style={{
                left: x - 4,
                top: i * rowH + rowH / 2 - 11,
                width: 0,
                height: 0,
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: `7px solid ${late ? 'var(--warn)' : 'var(--foreground)'}`,
                opacity: late ? 1 : 0.45,
              }}
            />
          );
        })}

        {/* The overrun as LENGTH, not as a colour swap: the days past the target
            are hatched over the bar's tail, so the eye reads how far rather than
            only that. */}
        {shown.map((r, k) => {
          const i = k + from;
          if (r.daysLate == null || !r.targetDate || !r.finishDate) return null;
          const x = daysBetween(spanStart, r.targetDate) * scale;
          const w = Math.max(daysBetween(r.targetDate, r.finishDate) * scale, 2);
          return (
            <span
              key={`o-${r.id}`}
              aria-hidden
              className="absolute z-[4] rounded-[3px]"
              style={{
                left: x,
                top: i * rowH + rowH / 2 - (r.isSummary ? 2 : 6),
                width: w,
                height: r.isSummary ? 5 : 12,
                background:
                  'repeating-linear-gradient(45deg, var(--warn) 0 3px, transparent 3px 6px)',
              }}
            />
          );
        })}

        {shown.map((r, k) => {
          const i = k + from;
          if (!r.startDate || !r.finishDate) return null;
          const x = daysBetween(spanStart, r.startDate) * scale;
          const y = i * rowH;
          const fact = facts[r.id];
          const bracket = r.isSummary;
          const diamond = r.isMilestone && !bracket;
          // A bracket and a diamond are black whatever colour says: their shape
          // is what identifies them, the way every planner already reads them.
          const color =
            bracket || diamond
              ? 'var(--foreground)'
              : paintCss(paintOf(r, fact?.kindId ?? null, view, colourBy, labels.get(r.id) ?? null));
          const title = diamond
            ? `${r.name} · ${fmtDate(r.startDate)}`
            : `${r.name} · ${fmtDate(r.startDate)} → ${fmtDate(r.finishDate)} · ${r.durationDays} d`;

          if (diamond) {
            return (
              <Fragment key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                title={title}
                aria-label={title}
                className="absolute grid place-items-center"
                // Clamped to the surface: a milestone on day one sat at -11 and
                // came out sliced in half against the divider.
                style={{ left: Math.max(0, x - 11), top: y, width: 22, height: rowH }}
              >
                <span
                  className={`size-2.5 rotate-45 rounded-[1px] ${r.isCritical ? 'ring-2 ring-[var(--bad)] ring-offset-1' : ''}`}
                  style={{ background: color }}
                />
              </button>
              {extras(r, x, 0, y)}
              </Fragment>
            );
          }

          const w = Math.max((daysBetween(r.startDate, r.finishDate) + 1) * scale, 3);
          // The plan's own stages, solid where done. With Done switched off the
          // bar is the plan alone, one solid piece.
          const parts =
            bracket || !view.marks.done
              ? [{ label: '', from: 0, to: 1, done: true }]
              : segmentsOf(fact?.rungs ?? [], fact?.donePct ?? 0);
          const staged = (fact?.rungs.length ?? 0) > 1 && view.marks.done;
          const onSite = fact?.kindId === 'procurement' && fact.rungs.at(-1)?.label === 'On site';

          return (
            <Fragment key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              title={title}
              aria-label={title}
              className="group absolute block"
              style={{ left: x, top: y, width: w, height: rowH }}
            >
              {/* A summary is a thin bracket, a task a fuller rounded bar — the
                  shape MS Project uses, so a plan is recognisable to anyone who
                  has seen one, and identity never rests on colour alone. */}
              <span
                className={`absolute left-0 flex w-full overflow-hidden rounded-[3px] ${staged ? 'gap-px' : ''}`}
                style={{ height: bracket ? 5 : 12, top: bracket ? rowH / 2 - 2 : rowH / 2 - 6 }}
              >
                {parts.map((p, n) => (
                  <span
                    key={n}
                    className="relative flex h-full items-center overflow-hidden"
                    style={{ flexBasis: `${(p.to - p.from) * 100}%`, flexGrow: 0, flexShrink: 1 }}
                  >
                    <span
                      className="absolute inset-0"
                      style={{ background: color, opacity: p.done ? (bracket ? 1 : 0.9) : 0.28 }}
                    />
                    {/* Names on the PRESSED bar only: on every bar they buried
                        the late hatch and the red outline under "Installation"
                        and "Conne…" (7 Oct 2026). The cuts and the solid/tint
                        still show the stages on every bar. */}
                    {p.label && r.id === selectedId && (p.to - p.from) * w >= 28 && (
                      <span
                        className={`relative truncate px-1 text-[9px] font-semibold leading-none ${
                          p.done ? 'text-white' : 'text-foreground'
                        }`}
                      >
                        {p.label}
                      </span>
                    )}
                  </span>
                ))}
              </span>
              {onSite && (
                <Flag
                  aria-hidden
                  className="absolute size-3"
                  style={{ right: -5, top: rowH / 2 - 18, color }}
                />
              )}
              {r.isCritical && !bracket && (
                <span
                  aria-hidden
                  className="absolute -inset-x-0.5 rounded-[4px] ring-2 ring-[var(--bad)]"
                  style={{ top: rowH / 2 - 7, height: 14 }}
                />
              )}
              {fine && onLink && !bracket &&
                (['start', 'finish'] as const).map((end) => (
                  <span
                    key={end}
                    aria-hidden
                    data-link-handle={end}
                    data-row={r.id}
                    data-x0={end === 'start' ? x : x + w}
                    data-y0={y + rowH / 2}
                    className="absolute top-1/2 z-[8] size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-card opacity-0 transition-opacity duration-200 ease-ios group-hover:opacity-100"
                    style={{ [end === 'start' ? 'left' : 'right']: -6, borderColor: color }}
                  />
                ))}
            </button>
            {extras(r, x, w, y)}
            </Fragment>
          );
        })}

        {arrowLayer}

        {/* The drag's own layer, apart from the memoised arrows so starting a
            drag does not rebuild them. Written to by the pointer handler. */}
        {dragging && (
          <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-[9] overflow-visible" width={width} height={bodyH}>
            <path ref={lineRef} d="" stroke="var(--primary)" strokeWidth={1.75} strokeDasharray="4 3" fill="none" />
            <circle ref={ringRef} r={7} fill="none" stroke="var(--primary)" strokeWidth={2} style={{ opacity: 0, transition: 'opacity 120ms var(--ease-ios)' }} />
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * The key: what each colour means, then each mark that is switched on AND
 * actually on the chart. A line in the key pointing at nothing on the chart
 * is worse than no line, so nothing is listed that this plan does not show.
 */
export function GanttLegend({
  rows,
  view,
  facts,
  colourBy,
  labels,
  network = null,
  contract = false,
}: {
  rows: SheetRow[];
  view: BarView;
  facts: Record<string, BarFact>;
  colourBy: ColourBy;
  labels: Map<string, string | null>;
  /** The links, so the key names only the marks this plan actually shows. */
  network?: Network | null;
  /** A contract is locked: the grey bar under each task means something. */
  contract?: boolean;
}) {
  const tasks = rows.filter((r) => !r.isSummary && !r.isMilestone);

  const colours = useMemo(() => {
    if (colourBy === 'one') return [];
    if (colourBy === 'package') {
      return rows
        .filter((r) => r.groupLabel !== null)
        .map((g) => ({ key: g.id, label: g.groupLabel!, css: paintCss(paintOf(g, null, view, 'package')) }));
    }
    if (colourBy === 'label') {
      // The user's own words, for the labels this plan actually uses.
      const used = new Set(tasks.map((r) => labels.get(r.id) ?? null));
      const own = view.labels
        .filter((l) => used.has(l.id))
        .map((l) => ({ key: l.id, label: l.name, css: paintCss(l.paint) }));
      return used.has(null) ? [...own, { key: 'none', label: 'No label', css: paintCss('muted') }] : own;
    }
    const present = new Set(tasks.map((r) => facts[r.id]?.kindId ?? 'none'));
    return KIND_KEYS.filter((k) => present.has(k)).map((k) => ({
      key: k,
      label: KIND_LABEL[k],
      css: paintCss(paintOf({ colorGroup: -1, unitId: null }, k === 'none' ? null : k, view, 'kind')),
    }));
    // `tasks` is derived from `rows`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, facts, view, colourBy, labels]);

  const anyDone = view.marks.done && tasks.some((r) => (facts[r.id]?.donePct ?? 0) > 0);
  const anyLate =
    view.marks.forecast &&
    tasks.some((r) => {
      const ff = facts[r.id]?.forecastFinish;
      return ff && r.finishDate && ff > r.finishDate;
    });
  const item = 'flex items-center gap-1.5 text-[11px] text-muted-foreground';

  return (
    // `md:min-h-12`: as tall as the selected-row strip that takes its place,
    // so selecting a row moves nothing under the pointer.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 md:min-h-12">
      {colours.map((c) => (
        <span key={c.key} className={item}>
          <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: c.css }} />
          {c.label}
        </span>
      ))}

      {anyDone && (
        <span className={item}>
          <span aria-hidden className="flex h-2 w-4 overflow-hidden rounded-[2px]">
            <span className="w-1/2 bg-foreground/80" />
            <span className="w-1/2 bg-foreground/25" />
          </span>
          Done so far
        </span>
      )}
      {anyLate && (
        <span className={item}>
          <span
            aria-hidden
            className="h-2 w-3 rounded-r-[2px] border border-l-0 border-[var(--bad)]"
            style={{ background: 'repeating-linear-gradient(135deg, var(--bad) 0 2px, transparent 2px 4px)' }}
          />
          Late, days past the plan
        </span>
      )}

      {rows.some((r) => r.targetDate) && (
        <span className={item}>
          <span
            aria-hidden
            style={{
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '7px solid var(--foreground)',
              opacity: 0.45,
            }}
          />
          Target date
        </span>
      )}

      {view.marks.links && (network?.links.length ?? 0) > 0 && (
        <span className={item}>
          <svg aria-hidden width="16" height="8" viewBox="0 0 16 8">
            <path d="M0 4 H12" stroke="var(--muted-foreground)" strokeWidth="1.5" />
            <path d="M10 1 L15 4 L10 7 z" fill="var(--muted-foreground)" />
          </svg>
          Waits for
        </span>
      )}

      {/* The marks the links add, each named only when the plan shows one. */}
      {rows.some((r) => r.isCritical) && (
        <span className={item}>
          <span aria-hidden className="h-2 w-3 rounded-[2px] bg-muted ring-2 ring-[var(--bad)]" />
          Sets the project finish
        </span>
      )}
      {view.marks.slip && rows.some((r) => r.totalFloat != null && r.totalFloat > 0) && (
        <span className={item}>
          <span aria-hidden className="flex items-center">
            <span className="w-3 border-t-[1.5px] border-dashed border-muted-foreground/60" />
            <span className="h-2 w-[1.5px] bg-muted-foreground/60" />
          </span>
          Can slip
        </span>
      )}
      {view.marks.contract && contract && (
        <span className={item}>
          <span aria-hidden className="h-1 w-3 rounded-full bg-muted-foreground/30" />
          Contract
        </span>
      )}
      {network && [...network.rows.values()].some((r) => r.conflicts.length > 0) && (
        <span className={item}>
          <span aria-hidden className="grid size-3 place-items-center rounded-full bg-[var(--bad)] text-[8px] font-bold text-white">
            !
          </span>
          Starts before what it waits for
        </span>
      )}
      <span className={item}>
        <span aria-hidden className="h-3 border-l-[1.5px] border-dashed border-sky-500" />
        Today
      </span>
    </div>
  );
}
