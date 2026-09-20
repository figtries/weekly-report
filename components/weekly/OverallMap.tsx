'use client';

import { m } from 'framer-motion';
import { memo, useMemo, useState, type ReactNode } from 'react';

import ActivityPanel from '@/components/weekly/ActivityPanel';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import { pressMotion } from '@/components/motion/Press';
import { MOTION, verdictFill, verdictOf } from '@/lib/design';
import { findNode, matchingIds, trailOf, withOptimistic, type MapNode, type OverallMap as MapModel } from '@/lib/overall-map';
import { cn } from '@/lib/utils';

/**
 * The project as one map: contract → group → activity, opened where you stand.
 *
 * THE THING THIS SCREEN IS NOT IS A TABLE. Two earlier cuts of Data Overall
 * were built outward from the workbook it replaces, and both were rejected the
 * same day for reading as a spreadsheet with the gridlines taken out. The
 * giveaway was never the data — it was the COLUMN: a header row across the top
 * and eight figures per line is a grid whatever it is painted like. So there
 * are no column headers anywhere here, and a row carries three things: its
 * name, one bar, one number. Everything else about it lives one press away, in
 * `ActivityPanel`.
 *
 * The weekly queue was not thrown away — `lib/worklist.ts` still decides what
 * the schedule puts in this week, and it is still the most useful eight rows on
 * the screen. It stopped being a SEPARATE LIST and became a LENS over the map,
 * because the brief was explicit: the map comes first, and the week is a way of
 * looking at it.
 */

const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);

/**
 * Indent per level, capped at four. The rail moves with the text rather than
 * staying pinned to the card's edge — a stripe in the same place on every row
 * says nothing about what sits inside what, and depth is the one thing a map
 * has that a list does not.
 */
const INDENT = ['pl-3', 'pl-7', 'pl-11', 'pl-12'];
const RAIL = ['left-0', 'left-4', 'left-8', 'left-9'];

/**
 * One fact about a row, in the shape the row already used for its status chip.
 *
 * What was here before was a sentence of 12.5px muted text — "6 activities ·
 * weight 69.72%" — and on this screen muted reads as absent: the figure a
 * heading is WORTH was the hardest thing on the map to find, sitting in the
 * lightest grey on the row. The pill is not decoration. It gives the number a
 * ground, and a ground is what makes it survive a glance down two hundred rows.
 *
 * `plain` takes --meta, which is the one hue this app owns that means nothing
 * on this screen — blue is actual, red is plan, emerald done, amber at risk.
 * `due` and `warn` keep their own colours because they SAY something; the rest
 * are facts, and facts share one theme.
 *
 * Upper case, and that is the point rather than a flourish: at this size it is
 * the shape of the word that carries, and small lower-case grey was invisible
 * to the person who has to read two hundred of these.
 */
const PILL_TONE = {
  plain: 'bg-meta-soft text-meta',
  ok: 'bg-ok-soft text-ok',
  due: 'bg-chart-1/10 text-chart-1',
  warn: 'bg-warn/10 text-warn',
} as const;

function Pill({
  tone = 'plain',
  children,
}: {
  tone?: keyof typeof PILL_TONE;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold tracking-[0.045em] uppercase tabular-nums',
        PILL_TONE[tone]
      )}
    >
      {children}
    </span>
  );
}

/** The number inside a pill, which is the part anyone is actually reading. */
const Figure = ({ children }: { children: ReactNode }) => (
  <span className="text-meta-strong">{children}</span>
);

/**
 * A weight of zero is not a weight of zero. It is a row nobody has priced yet,
 * and printing "0.00%" states it as a decision — the same confident nothing
 * that made a fully priced heading read "No value yet" beside 69.72%. Say which
 * one it is.
 */
const WeightPill = ({ weight }: { weight: number }) =>
  weight > 0.0001 ? (
    <Pill>
      <Figure>{fmt2(weight)}%</Figure> weight
    </Pill>
  ) : (
    <Pill tone="warn">no weight yet</Pill>
  );

export default function OverallMap({
  map,
  week,
  canPrice,
  projectHref,
  checkHref,
  weightsHref,
}: {
  map: MapModel;
  week: number;
  canPrice: boolean;
  projectHref: string | null;
  checkHref: string;
  /** The bulk pricing screen, or null for a project that cannot be priced here. */
  weightsHref: string | null;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lens, setLens] = useState(false);
  const [query, setQuery] = useState('');
  /** Branches folded BACK while a filter is showing. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Record<string, number>>({});

  /**
   * An optimistic figure is dropped the moment the server's own agrees with it
   * — worked out DURING RENDER, never in an effect. Clearing it from an effect
   * would be a second render pass on every save, and clearing it on any prop
   * change at all would race the refresh and flick the row back to its old
   * number for a frame.
   */
  const live = useMemo(() => {
    const out: Record<string, number> = {};
    Object.entries(pending).forEach(([id, pct]) => {
      const node = findNode(map.units, id);
      if (!node || Math.abs(node.actualPct - pct) > 0.011) out[id] = pct;
    });
    return out;
  }, [map.units, pending]);

  const units = useMemo(() => withOptimistic(map.units, live), [map.units, live]);

  const needle = query.trim().toLowerCase();
  const filter = useMemo(() => {
    if (!needle && !lens) return null;
    return matchingIds(units, (n) => {
      if (lens && !n.dueCount) return false;
      if (needle && !`${n.code} ${n.name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [units, needle, lens]);

  /**
   * A filter opens the map for you. Leaving it collapsed would show four
   * contract rows and hide the very rows the filter was for, which reads as a
   * search that found nothing.
   */
  const effectiveOpen = useMemo(() => {
    if (!filter) return openIds;
    const next = new Set(filter);
    folded.forEach((id) => next.delete(id));
    return next;
  }, [filter, folded, openIds]);

  const active = findNode(units, activeId);
  const trail = useMemo(() => (activeId ? trailOf(units, activeId) : []), [units, activeId]);

  /**
   * Folding a branch while a filter is showing folds it INSIDE the filter
   * rather than dropping back to the whole project — the lens is a way of
   * looking, and looking closer should not turn it off.
   */
  function toggle(id: string) {
    const flip = (prev: Set<string>, contains: boolean) => {
      const next = new Set(prev);
      if (contains) next.add(id);
      else next.delete(id);
      return next;
    };
    if (filter) setFolded((prev) => flip(prev, !folded.has(id)));
    else setOpenIds((prev) => flip(prev, !openIds.has(id)));
  }

  const weekDone = map.due > 0 && map.filled >= map.due;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* The week, the lens and the search are the map's OWN HEADER rather than
          two more cards stacked above it. Three separate cards pushed the first
          activity most of a phone screen down, and the brief asked for the work
          to be the thing you land on. */}
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-foreground">
              {!map.hasSchedule
                ? 'No schedule yet, so nothing is due'
                : map.due === 0
                  ? 'Nothing is scheduled this week'
                  : weekDone
                    ? `This week · all ${map.due} filled in`
                    : `This week · ${map.filled} of ${map.due} filled in`}
            </p>
            {map.due > 0 && (
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-foreground/8">
                <m.div
                  className="h-full origin-left rounded-full bg-ok"
                  initial={false}
                  animate={{ scaleX: Math.min(1, map.filled / map.due) }}
                  transition={MOTION.spring}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>
          {map.due > 0 && (
            <m.button
              {...pressMotion}
              onClick={() => setLens((v) => !v)}
              aria-pressed={lens}
              className={cn(
                'min-h-11 shrink-0 rounded-xl border px-3.5 text-[13px] font-medium transition-colors duration-200 ease-ios',
                lens
                  ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                  : 'border-input bg-card text-foreground hover:bg-muted/60'
              )}
            >
              {lens ? 'Showing this week' : 'Show only these'}
            </m.button>
          )}
        </div>

        {map.stuck > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-semibold text-warn">{map.stuck} activities</span> are past their
            finish week and still short.{' '}
            <a href={checkHref} className="font-medium text-chart-1 hover:underline">
              See them on Check
            </a>
          </p>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an activity"
          aria-label="Find an activity"
          className="mt-3 h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm text-foreground transition-colors duration-200 ease-ios placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
        />
      </div>

      {units.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          This project has no activities yet.
        </p>
      )}
      {units.map((u, i) => (
        <Branch
          key={u.id}
          node={u}
          first={i === 0}
          open={effectiveOpen}
          onToggle={toggle}
          onOpenRow={setActiveId}
          filter={filter}
        />
      ))}
      {filter && filter.size === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Nothing matches. Clear the search to see the whole project.
        </p>
      )}

      {/* The bulk tool, said quietly. Typing two hundred prices one panel at a
          time is an afternoon nobody should spend, so the screen that does them
          together is still here — it just stopped being a destination in the
          header, which is what made Data Overall three screens to remember. */}
      {weightsHref && (
        <div className="border-t border-border p-3">
          <a
            href={weightsHref}
            className="flex min-h-12 items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chart-1/10 text-chart-1">
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M3.5 5.5h13M3.5 10h13M3.5 14.5h8"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="min-w-0 flex-1">Weights: what each activity is worth</span>
            <svg
              className="h-[18px] w-[18px] shrink-0 text-foreground/35"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7.5 4.5l6 5.5-6 5.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>
      )}

      <ActivityPanel
        key="panel"
        node={active}
        trail={trail}
        week={week}
        canPrice={canPrice}
        projectHref={projectHref}
        onClose={() => setActiveId(null)}
        onSaved={(id, pct) => setPending((prev) => ({ ...prev, [id]: pct }))}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- rows */

function Branch({
  node,
  first,
  open,
  onToggle,
  onOpenRow,
  filter,
}: {
  node: MapNode;
  first: boolean;
  open: Set<string>;
  onToggle: (id: string) => void;
  onOpenRow: (id: string) => void;
  filter: Set<string> | null;
}) {
  if (filter && !filter.has(node.id)) return null;

  if (node.kind === 'leaf') {
    return <Row node={node} first={first} onPress={() => onOpenRow(node.id)} />;
  }

  const isOpen = open.has(node.id);
  return (
    <>
      <Row node={node} first={first} open={isOpen} onPress={() => onToggle(node.id)} />
      {/* No height animation on a branch: there can be dozens open at once and
          `height` is a layout property. The children rise into place instead,
          on the compositor, which is the rule `components/motion/Expand.tsx`
          sets out for anything that lives inside a `.map()`. */}
      {isOpen &&
        node.children.map((c) => (
          <Branch
            key={c.id}
            node={c}
            first={false}
            open={open}
            onToggle={onToggle}
            onOpenRow={onOpenRow}
            filter={filter}
          />
        ))}
    </>
  );
}

const Row = memo(function Row({
  node,
  first,
  open,
  onPress,
}: {
  node: MapNode;
  first?: boolean;
  open?: boolean;
  onPress: () => void;
}) {
  const isBranch = node.kind !== 'leaf';
  const { tag, name } = splitCode(node.name);
  const verdict = verdictOf(-node.behindPct, 0.5);

  return (
    <m.button
      {...pressMotion}
      onClick={onPress}
      aria-expanded={isBranch ? !!open : undefined}
      className={cn(
        'relative flex w-full items-start gap-3 py-3.5 pr-4 text-left transition-colors duration-200 ease-ios hover:bg-muted/40',
        INDENT[Math.min(node.depth, INDENT.length - 1)],
        !first && 'border-t border-border/70',
        node.kind === 'unit' && 'py-5',
        !isBranch && 'animate-fade-in-up'
      )}
    >
      {/* The rail says how this row is doing, and it is the only colour on the
          line that is not the bar. Identity is carried by the code chip — one
          colour per contract would be a second palette, and `AGENTS.md` keeps
          this app to one. */}
      <span
        aria-hidden="true"
        className={cn(
          // Softened on purpose. At full strength a project that is behind
          // paints a solid stripe down the left of every row, and a warning
          // shown on all two hundred rows is wallpaper rather than a warning.
          'absolute top-3 bottom-3 w-[3.5px] rounded-full opacity-70',
          RAIL[Math.min(node.depth, RAIL.length - 1)],
          verdictFill[verdict]
        )}
      />

      <span className="mt-px w-[18px] shrink-0 text-foreground/45">
        {isBranch && (
          <m.span
            className="block"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          >
            <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </m.span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          {tag && <CodeChip className="mt-0.5">{tag}</CodeChip>}
          <span
            className={cn(
              'min-w-0 flex-1 leading-snug text-foreground',
              node.kind === 'unit'
                ? 'text-base font-semibold'
                : node.kind === 'group'
                  ? 'text-[15px] font-medium'
                  : 'text-[14.5px]'
            )}
          >
            {name}
          </span>
          <span className="shrink-0 text-right">
            {/* One decimal, not two. Two is a spreadsheet's precision and the
                reason a wall of rows reads as a ledger; the exact figure is in
                the panel and in the report. */}
            <span
              className={cn(
                'block font-semibold tabular-nums text-foreground',
                node.kind === 'unit' ? 'text-lg' : 'text-base'
              )}
            >
              <AnimatedNumber value={node.actualPct} decimals={1} suffix="%" />
            </span>
            {node.weekPct > 0.004 && (
              <span className="block text-xs font-semibold tabular-nums text-ok">
                +{fmt1(node.weekPct)}
              </span>
            )}
          </span>
        </span>

        <Bar actual={node.actualPct} plan={node.planPct} thick={node.kind === 'unit'} />

        <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {node.dueCount > 0 && node.kind === 'leaf' && (
            <Pill tone={node.filledCount ? 'ok' : 'due'}>
              {node.completeCount
                ? 'Complete'
                : node.filledCount
                  ? 'Filled in'
                  : 'Due this week'}
            </Pill>
          )}
          {isBranch && (
            <>
              <Pill>
                <Figure>{node.leafCount}</Figure>{' '}
                {node.leafCount === 1 ? 'activity' : 'activities'}
              </Pill>
              <WeightPill weight={node.weight} />
              {/* What is still OUTSTANDING, not what was scheduled. A branch
                  reading "1 due" over a row whose own chip says Complete is one
                  card making two statements, and the person checking the week
                  has to open it to find out which is true. */}
              {node.dueCount - node.filledCount > 0 && (
                <Pill tone="due">{node.dueCount - node.filledCount} due</Pill>
              )}
            </>
          )}
          {node.kind === 'leaf' &&
            (node.method === 'qty' ? (
              <Pill>
                <Figure>{(node.qtyDone ?? 0).toLocaleString('en-GB')}</Figure> of{' '}
                {(node.qtyTotal ?? 0).toLocaleString('en-GB')} {node.unit ?? ''}
              </Pill>
            ) : node.method === 'milestone' ? (
              <Pill>
                <Figure>{(node.milestones ?? []).filter((s) => s.done).length}</Figure> of{' '}
                {(node.milestones ?? []).length} steps
              </Pill>
            ) : (
              <WeightPill weight={node.weight} />
            ))}
        </span>
      </span>
    </m.button>
  );
});

/**
 * Actual against plan, in the two colours the S-curve already teaches:
 * `--chart-1` IS actual and `--chart-2` IS plan, everywhere in this app.
 *
 * The fill is a SCALE, not a width. Width is a layout property and a hundred
 * rows re-laying out is what a phone feels; a transform runs on the compositor
 * and lets the spring land the same way a panel does. It is what makes the
 * contract bar visibly grow the moment an activity under it is filled in —
 * which is the whole reason anyone would rather do this here than in Excel.
 */
function Bar({ actual, plan, thick }: { actual: number; plan: number; thick?: boolean }) {
  const a = Math.max(0, Math.min(100, actual)) / 100;
  const p = Math.max(0, Math.min(100, plan));
  return (
    <span
      className={cn(
        'relative mt-2.5 block w-full overflow-hidden rounded-full bg-foreground/8',
        thick ? 'h-2.5' : 'h-2'
      )}
    >
      <m.span
        className="absolute inset-y-0 left-0 block w-full origin-left rounded-full bg-chart-1"
        initial={false}
        animate={{ scaleX: a }}
        transition={MOTION.spring}
      />
      {p > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-[3px] rounded-full bg-chart-2 ring-1 ring-card"
          style={{ left: `calc(${Math.min(99.5, p)}% - 1.5px)` }}
        />
      )}
    </span>
  );
}
