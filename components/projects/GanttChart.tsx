'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { m } from 'framer-motion';
import { SlidersHorizontal } from 'lucide-react';

import { pressMotion } from '@/components/motion/Press';

import type { SheetRow } from '@/lib/sheet';
import {
  DEFAULT_BAR_STYLES,
  resolveBar,
  usedStyles,
  type BarPaint,
  type BarStyle,
  type ResolvedBar,
} from '@/lib/bar-styles';

/**
 * The timeline.
 *
 * **Colour does a job here, it does not decorate.** A bar's hue says which
 * PACKAGE it belongs to — SPK-002, SPK-003 and so on — so a plan of hundreds of
 * rows reads as a handful of streams running alongside each other instead of a
 * wall of identical grey. The grouping comes from the reporting units the report
 * is already built from (see `assignColorGroups`), the hues are assigned in
 * fixed order and never cycled, and a seventh group goes neutral rather than
 * repeating a colour and claiming two packages are one.
 *
 * The palette is `--plan-1..6`, deliberately separate from `--chart-1..5`, which
 * already mean actual / plan / done / at risk / dormant elsewhere in this app.
 * All six passed the lightness, chroma, CVD-separation, normal-vision and
 * contrast checks against this surface.
 *
 * **Identity is never colour alone.** Every bar is direct-labelled by its own
 * row in the sheet on the same line, shape separates the three kinds (summary
 * bracket, task bar, milestone diamond), and a legend names each group.
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

export const PLAN_COLORS = [
  'var(--plan-1)',
  'var(--plan-2)',
  'var(--plan-3)',
  'var(--plan-4)',
  'var(--plan-5)',
  'var(--plan-6)',
];

export function planColor(group: number): string {
  return group >= 0 && group < PLAN_COLORS.length ? PLAN_COLORS[group] : 'var(--muted-foreground)';
}

/**
 * A rule's paint, turned into a colour for THIS row.
 *
 * `unit` is the one that depends on the row: it means "the package's own
 * colour", which is how the old hard-coded behaviour survives as a rule rather
 * than as a law. Everything else is a fixed token.
 */
export function paintColor(paint: BarPaint, row: SheetRow): string {
  switch (paint) {
    case 'unit':
      return planColor(row.colorGroup);
    case 'foreground':
      return 'var(--foreground)';
    case 'warn':
      return 'var(--warn)';
    case 'danger':
      return 'var(--destructive)';
    case 'ok':
      return 'var(--ok)';
    case 'muted':
      return 'var(--muted-foreground)';
    default:
      return `var(--${paint})`;
  }
}

/** The same, for a legend swatch that has no row behind it. */
export function paintSwatch(paint: BarPaint): string {
  switch (paint) {
    case 'unit':
      return 'var(--plan-1)';
    case 'foreground':
      return 'var(--foreground)';
    case 'warn':
      return 'var(--warn)';
    case 'danger':
      return 'var(--destructive)';
    case 'ok':
      return 'var(--ok)';
    case 'muted':
      return 'var(--muted-foreground)';
    default:
      return `var(--${paint})`;
  }
}

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
  styles = DEFAULT_BAR_STYLES,
  range,
}: {
  rows: SheetRow[];
  spanStart: string | null;
  spanFinish: string | null;
  rowH: number;
  headH: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The project's ordered rule list. Falls back to the defaults. */
  styles?: BarStyle[];
  /**
   * The window of rows the sheet has mounted. The surface stays FULL height —
   * every bar is placed at `index × rowH`, so the height is what keeps the two
   * panes on the same line — and only the bars inside the window are built.
   */
  range?: { start: number; end: number };
}) {
  const [todayX, setTodayX] = useState<number | null>(null);
  // Read after mount, never at render: a server component prerenders into the
  // static shell, so a build-time clock would drift a day further from the
  // truth every day and "running today" would quietly stop being true.
  const [today, setToday] = useState('');
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);
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
  const scale = days > 0 ? pxPerDay(days, paneWidth) : 8;
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

  if (!spanStart) {
    return (
      <p className="p-6 text-xs text-muted-foreground">
        No dates yet. Give a row a start and a finish and its bar appears here.
      </p>
    );
  }

  const bodyH = rows.length * rowH;
  // The slice that gets built, with its offset kept so `i` is still the row's
  // real position on the surface.
  const from = range ? Math.max(0, range.start) : 0;
  const to = range ? Math.min(rows.length, range.end) : rows.length;
  const shown = rows.slice(from, to);

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

      <div className="relative" style={{ height: bodyH }}>
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
            className="absolute top-0 z-10 w-0.5 bg-foreground/60"
            style={{ left: todayX, height: bodyH }}
          />
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
            only that. Drawn when the matched RULE asks for hatching — it is a
            property of the rule now, not of the code. */}
        {shown.map((r, k) => {
          const i = k + from;
          if (r.daysLate == null || !r.targetDate || !r.finishDate) return null;
          if (!resolveBar(r, styles, today).hatched) return null;
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
          // The whole of what a bar looks like, decided by the FIRST rule in the
          // project's list that describes this row. Nothing below reads the
          // row's kind again — the rule already answered that.
          const hit: ResolvedBar = resolveBar(r, styles, today);
          const color = paintColor(hit.paint, r);
          const kind =
            hit.label === 'Work' ? '' : ` · ${hit.label}`;
          const title =
            hit.shape === 'diamond'
              ? `${r.name} · ${fmtDate(r.startDate)}${kind}`
              : `${r.name} · ${fmtDate(r.startDate)} → ${fmtDate(r.finishDate)} · ${r.durationDays} d${kind}`;

          if (hit.shape === 'diamond') {
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                title={title}
                aria-label={title}
                className="absolute grid place-items-center"
                // Clamped to the surface: a milestone on day one sat at -11 and
                // came out sliced in half against the divider.
                style={{ left: Math.max(0, x - 11), top: y, width: 22, height: rowH }}
              >
                <span className="size-2.5 rotate-45 rounded-[1px]" style={{ background: color }} />
              </button>
            );
          }

          const w = Math.max((daysBetween(r.startDate, r.finishDate) + 1) * scale, 3);
          const bracket = hit.shape === 'bracket';

          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              title={title}
              aria-label={title}
              className="absolute block"
              style={{ left: x, top: y, width: w, height: rowH }}
            >
              {/* A summary is a thin bracket, a task a fuller rounded bar — the
                  shape MS Project uses, so a plan is recognisable to anyone who
                  has seen one, and identity never rests on colour alone. */}
              <span
                className="absolute left-0 rounded-[3px] transition-[width] duration-300 ease-ios"
                style={{
                  background: color,
                  width: '100%',
                  height: bracket ? 5 : 12,
                  top: bracket ? rowH / 2 - 2 : rowH / 2 - 6,
                  opacity: bracket ? 1 : 0.9,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The key, built from the rules that actually FIRED.
 *
 * Not from the rule list: a rule no row in this plan matches would be a line in
 * the key pointing at nothing on the chart. Not from the colour groups either,
 * which is what it used to be — the groups are only one rule's worth of meaning
 * now, and a project whose planner has put lateness above packages should see
 * that at the top of its key.
 *
 * Packages are still named individually where a `unit`-painted rule fired,
 * because that is the one paint whose colour differs per row, and identity may
 * never rest on a hue alone.
 */
export function GanttLegend({
  rows,
  styles = DEFAULT_BAR_STYLES,
  onEdit,
}: {
  rows: SheetRow[];
  styles?: BarStyle[];
  /** Opens the rule editor. Absent on screens where the list is not editable. */
  onEdit?: () => void;
}) {
  // The same clock rule as the chart: read after mount, never at render.
  const [today, setToday] = useState('');
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);

  const used = useMemo(() => usedStyles(rows, styles, today), [rows, styles, today]);
  const groups = rows.filter((r) => r.groupLabel !== null);
  const showsPackages = used.some((u) => u.style.paint === 'unit') && groups.length >= 2;

  // The key can be empty — one package and no rule firing has nothing to
  // explain. The way IN to the rules must not vanish with it, which is exactly
  // how "where do I change the colours" became unanswerable.
  const hasKey = used.length > 0 || groups.length >= 2;
  if (!hasKey && !onEdit) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
      {showsPackages &&
        groups.map((g) => (
          <span key={g.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{ background: planColor(g.colorGroup) }}
            />
            {g.groupLabel}
          </span>
        ))}

      {used
        // The plain package bar is already explained by the swatches above, so
        // naming it again would be the same key twice. A bracket or a diamond
        // is NOT the same key — those carry shape, which colour cannot say.
        .filter(
          (u) =>
            !(
              u.style.paint === 'unit' &&
              showsPackages &&
              (u.style.shape === 'bar' || u.style.shape === 'auto') &&
              !u.style.hatched
            )
        )
        .map(({ style, count }) => (
          <span
            key={style.id}
            title={`${count} row${count === 1 ? '' : 's'}`}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Swatch style={style} />
            {style.label}
          </span>
        ))}

      {rows.some((r) => r.targetDate) && (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
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

      {/* Stranded at the right of an empty strip it read as a caption, so it
          only takes the right-hand end once there is a key to sit beside. */}
      {onEdit && <BarStylesButton onClick={onEdit} className={hasKey ? 'ml-auto' : ''} />}
    </div>
  );
}

/**
 * The way in to the rules — and the only one, so it is drawn as a control.
 *
 * It used to be muted grey text with no border, and people read it as a label
 * rather than something to press: the answer to "where do I set the bar
 * colours" was on screen the whole time and still could not be found. It now
 * carries a border, a surface and the app's 44px press target, and it LEADS
 * WITH THREE OF THE PLAN COLOURS — the swatches say what is behind it before
 * the label is read, which two words never managed on their own.
 */
export function BarStylesButton({
  onClick,
  className = '',
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      {...pressMotion}
      title="Colours, shapes and rules for the bars"
      className={`flex h-11 shrink-0 items-center gap-2 rounded-lg border bg-background px-3 text-xs font-semibold shadow-xs transition-colors duration-200 ease-ios hover:bg-muted ${className}`}
    >
      <span aria-hidden className="flex items-center">
        {PLAN_COLORS.slice(0, 3).map((c, i) => (
          <span
            key={c}
            className="size-3 rounded-[3px] ring-1 ring-background"
            style={{ background: c, marginLeft: i === 0 ? 0 : -4 }}
          />
        ))}
      </span>
      Bar styles
      <SlidersHorizontal className="size-3.5 text-muted-foreground" />
    </m.button>
  );
}

/** The rule's own drawing, at legend size — shape as well as colour. */
function Swatch({ style }: { style: BarStyle }) {
  const bg = paintSwatch(style.paint);
  if (style.shape === 'diamond') {
    return <span aria-hidden className="size-2 rotate-45 rounded-[1px]" style={{ background: bg }} />;
  }
  return (
    <span
      aria-hidden
      className="w-3 rounded-[1px]"
      style={{
        background: style.hatched
          ? `repeating-linear-gradient(45deg, ${bg} 0 2px, transparent 2px 4px), ${bg}`
          : bg,
        height: style.shape === 'bracket' ? 3 : 8,
      }}
    />
  );
}
