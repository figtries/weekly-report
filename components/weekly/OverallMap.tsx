'use client';

import { m } from 'framer-motion';
import { memo, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Clock, TriangleAlert } from 'lucide-react';

import ActivityPanel from '@/components/weekly/ActivityPanel';
import { deriveShape } from '@/components/weekly/ProgressEntry';
import { type WorkKindPeer } from '@/components/weekly/WorkKindPicker';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Expand } from '@/components/motion/Expand';
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

/**
 * The one filter the map applies to itself. `'due'` is the pre-existing
 * "this week" queue-as-a-lens; `'manual'` is Task 8's admission — the Check
 * screen's "N of M figures were typed by hand" line links here rather than
 * inventing a second filtering concept, because `matchingIds` already keeps
 * a node's whole ancestor chain for anything it keeps, whatever the
 * predicate checks. `'blocking'` is the Check screen's "Back to Fill in":
 * the items that stop the week being issued, and nothing else.
 */
type Lens = 'due' | 'manual' | 'blocking' | null;

/**
 * The reminders (23 Sep 2026): past their finish and still short, or finishing
 * within the next few weeks and still short — the worklist's answers, carried
 * onto the row as `lateBy` / `dueIn`. They open a LIST, not a filter: the
 * first cut filtered the map, and "3 late" pressed read as a button that did
 * nothing, because a filtered map says which rows and never why.
 */
type Reminder = 'late' | 'soon' | null;

/** How many reminder rows show before "Show all". */
const REMINDER_ROWS = 6;

export default function OverallMap({
  map,
  week,
  projectId,
  canPrice,
  projectHref,
  currency,
  initialLens = null,
  blockingIds = [],
  initialItem = null,
}: {
  map: MapModel;
  week: number;
  /**
   * The project this page was RENDERED for. Handed to every write the panel
   * makes, because "which project is open" is a different question asked at a
   * different time, and when the two disagree the save goes to the wrong store
   * and reports "Item not found" on a row that is plainly on screen.
   */
  projectId: string | null;
  canPrice: boolean;
  projectHref: string | null;
  /** The project's currency, for the budget the panel shows. */
  currency: string;
  /** Arrived via `?lens=` from the Check screen. Read once, on mount. */
  initialLens?: Lens;
  /** What the `'blocking'` lens keeps. */
  blockingIds?: string[];
  /** Arrived via `?item=` (or the first blocking item): its panel opens on arrival. */
  initialItem?: string | null;
}) {
  // The path down to the item the Check screen pointed at is opened for you,
  // so closing its panel leaves the row itself on screen, not four collapsed
  // contracts with the row somewhere inside one of them.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(initialItem ? trailOf(map.units, initialItem).map((n) => n.id) : [])
  );
  const [activeId, setActiveId] = useState<string | null>(initialItem);
  // The panel is a portal onto `document.body`, which does not exist on the
  // server, so it is held back until the client is live. The same
  // `useSyncExternalStore` Sidebar uses rather than a mounted flag set in an
  // effect: no setState in an effect, and no extra render pass.
  const onClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  // FROZEN AT ARRIVAL. The page works the set out again on every refresh, and
  // an item fixed a moment ago drops out of it — reading it live would make the
  // row you just saved vanish from under you, and the last fix would leave a
  // map saying "Nothing matches". Kept, it stays on screen with its new figure.
  const [blocking] = useState(() => new Set(blockingIds));
  const [reminder, setReminder] = useState<Reminder>(null);
  const [allReminders, setAllReminders] = useState(false);
  const [lens, setLens] = useState<Lens>(initialLens);
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

  /**
   * Every leaf elsewhere in the tree that already has an answer, for the
   * work-kind picker's suggestion. Computed off `map.units` (the server's own
   * tree) rather than the optimistic `units` above: a work kind is never set
   * optimistically, so recomputing this on every in-flight percentage would
   * just be wasted walks over up to 285 rows. `ActivityPanel` cannot see its
   * own siblings — it receives one node — so the peer list is built HERE,
   * once, and handed down as a single prop.
   */
  const peers = useMemo(() => {
    const out: WorkKindPeer[] = [];
    function walk(n: MapNode) {
      if (n.kind === 'leaf' && n.workKind) {
        // All four shapes are suggestable now, 'manual' included: it stopped
        // being only the escape hatch when it became one of the four answers
        // the picker offers. The hatch itself never reaches here, because it
        // leaves the row's stored method alone — a ladder overridden by a
        // typed percent still reads back as 'steps'.
        out.push({ name: n.name, kindId: n.workKind, shape: deriveShape(n) });
      }
      n.children.forEach(walk);
    }
    map.units.forEach(walk);
    return out;
  }, [map.units]);

  const needle = query.trim().toLowerCase();
  const filter = useMemo(() => {
    if (!needle && !lens) return null;
    return matchingIds(units, (n) => {
      if (lens === 'due' && !n.dueCount) return false;
      // `source` is a leaf-only field (branches never carry one), so a branch
      // never matches this arm directly — it is pulled in as an ancestor of a
      // matching leaf instead, same as every branch above a "due" leaf.
      if (lens === 'manual' && n.source !== 'manual') return false;
      if (lens === 'blocking' && !blocking.has(n.id)) return false;
      if (needle && !`${n.code} ${n.name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [units, needle, lens, blocking]);

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

  const active = onClient ? findNode(units, activeId) : null;
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
        {/* Arrived via `?lens=manual` from the Check screen's admission line.
            Its own strip rather than folding into the "this week" row below:
            the two lenses answer different questions and can both be true of
            the same row, so they get their own on/off rather than sharing
            one button that could only ever say one of them. */}
        {/* `'blocking'` wears the Check screen's red, because it is that
            screen's verdict carried over: these are what stop the week. */}
        {(lens === 'manual' || lens === 'blocking') && (
          <div
            className={cn(
              'mb-3 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium',
              lens === 'blocking'
                ? 'border-bad/30 bg-bad-soft text-bad'
                : 'border-chart-1/30 bg-chart-1/10 text-chart-1'
            )}
          >
            <span>
              {lens === 'blocking'
                ? `Showing the ${blocking.size} ${blocking.size === 1 ? 'item' : 'items'} that stop week ${week} being issued`
                : 'Showing the figures typed by hand'}
            </span>
            <m.button
              {...pressMotion}
              type="button"
              onClick={() => setLens(null)}
              className={cn(
                'flex min-h-11 shrink-0 items-center rounded-lg px-2.5 text-[12px] font-semibold',
                lens === 'blocking' ? 'text-bad hover:bg-bad/10' : 'text-chart-1 hover:bg-chart-1/10'
              )}
            >
              Show everything
            </m.button>
          </div>
        )}

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
              onClick={() => setLens((v) => (v === 'due' ? null : 'due'))}
              aria-pressed={lens === 'due'}
              className={cn(
                'min-h-11 shrink-0 rounded-xl border px-3.5 text-[13px] font-medium transition-colors duration-200 ease-ios',
                lens === 'due'
                  ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                  : 'border-input bg-card text-foreground hover:bg-muted/60'
              )}
            >
              {lens === 'due' ? 'Showing this week' : 'Show only these'}
            </m.button>
          )}
        </div>

        {/* THE REMINDERS, as buttons. This was one sentence pointing at the
            Check screen, which told you how many and sent you somewhere else
            to find out which. Pressing one now lists them right here, each
            with the reason and a way straight into its panel. Tinted at rest
            so a phone, which has no hover, still sees a button; solid when
            its list is open. */}
        {(map.stuck > 0 || map.soon > 0) && (
          <div className="mt-3">
            <div className="flex gap-2">
              {map.stuck > 0 && (
                <ReminderLens
                  tone="warn"
                  on={reminder === 'late'}
                  onPress={() => {
                    setAllReminders(false);
                    setReminder((v) => (v === 'late' ? null : 'late'));
                  }}
                >
                  <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {map.stuck} late
                </ReminderLens>
              )}
              {map.soon > 0 && (
                <ReminderLens
                  tone="due"
                  on={reminder === 'soon'}
                  onPress={() => {
                    setAllReminders(false);
                    setReminder((v) => (v === 'soon' ? null : 'soon'));
                  }}
                >
                  <Clock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {map.soon} ending soon
                </ReminderLens>
              )}
            </div>
            <Expand open={reminder !== null}>
              {reminder && (
                <ReminderList
                  kind={reminder}
                  units={units}
                  all={allReminders}
                  onShowAll={() => setAllReminders(true)}
                  onOpen={setActiveId}
                />
              )}
            </Expand>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {reminder ? 'Press it again to close the list' : 'Press one to see which, and why'}
            </p>
          </div>
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
          {lens
            ? 'Nothing matches. Clear the search, or turn off the filter above, to see the whole project.'
            : 'Nothing matches. Clear the search to see the whole project.'}
        </p>
      )}

      <ActivityPanel
        key="panel"
        node={active}
        trail={trail}
        week={week}
        projectId={projectId}
        canPrice={canPrice}
        projectHref={projectHref}
        currency={currency}
        peers={peers}
        onClose={() => setActiveId(null)}
        onSaved={(id, pct) => setPending((prev) => ({ ...prev, [id]: pct }))}
      />
    </div>
  );
}

/**
 * Which activities, and WHY — the list a reminder button opens.
 *
 * Each line says what the plan said, where the activity actually is, and by
 * how much the two are apart, in words, so nobody has to open three panels to
 * find out what "late" was measured against. "Open" goes straight to the
 * activity's panel, where its week-by-week log is the thing to fix it in.
 * Native buttons, like the map's own rows: this can run to forty lines.
 */
function ReminderList({
  kind,
  units,
  all,
  onShowAll,
  onOpen,
}: {
  kind: 'late' | 'soon';
  units: MapNode[];
  all: boolean;
  onShowAll: () => void;
  onOpen: (id: string) => void;
}) {
  const entries = useMemo(() => {
    const out: MapNode[] = [];
    const walk = (n: MapNode) => {
      if (kind === 'late' ? n.lateBy !== undefined : n.dueIn !== undefined) out.push(n);
      n.children.forEach(walk);
    };
    units.forEach(walk);
    return kind === 'late'
      ? out.sort((a, b) => (b.lateBy ?? 0) - (a.lateBy ?? 0) || b.weight - a.weight)
      : out.sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0) || b.weight - a.weight);
  }, [kind, units]);

  const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
  const late = kind === 'late';
  const shown = all ? entries : entries.slice(0, REMINDER_ROWS);

  return (
    <div
      className={cn(
        'mt-3 overflow-hidden rounded-xl border',
        late ? 'border-warn/30 bg-warn-soft' : 'border-chart-1/25 bg-chart-1/8'
      )}
    >
      <p className={cn('px-3.5 pb-2 pt-3 text-[13px] font-semibold', late ? 'text-warn' : 'text-chart-1')}>
        {late
          ? `${entries.length} ${entries.length === 1 ? 'activity has' : 'activities have'} passed the plan and ${entries.length === 1 ? 'is' : 'are'} not finished`
          : `${entries.length} ${entries.length === 1 ? 'activity ends' : 'activities end'} within 3 weeks and ${entries.length === 1 ? 'is' : 'are'} not finished`}
      </p>
      <ul>
        {shown.map((n) => {
          const { tag, name } = splitCode(n.name);
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onOpen(n.id)}
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 border-t px-3.5 py-2.5 text-left transition-colors duration-200 ease-ios',
                  late ? 'border-warn/20 hover:bg-warn/10' : 'border-chart-1/15 hover:bg-chart-1/10'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    {tag && <CodeChip>{tag}</CodeChip>}
                    <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{name}</span>
                  </span>
                  <span className={cn('mt-0.5 block text-[12px] tabular-nums', late ? 'text-warn' : 'text-chart-1')}>
                    {late
                      ? `Plan ended W${n.finishWeek} · ${fmt1(n.actualPct)}% done · ${weeks(n.lateBy ?? 0)} late`
                      : `Plan ends W${n.finishWeek} · ${fmt1(n.actualPct)}% done · ${
                          n.dueIn === 0 ? 'ends this week' : `ends in ${weeks(n.dueIn ?? 0)}`
                        }`}
                  </span>
                </span>
                <span className={cn('shrink-0 text-[13px] font-semibold', late ? 'text-warn' : 'text-chart-1')}>
                  Open ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!all && entries.length > REMINDER_ROWS && (
        <button
          type="button"
          onClick={onShowAll}
          className={cn(
            'flex min-h-11 w-full items-center justify-center border-t text-[13px] font-semibold transition-colors duration-200 ease-ios',
            late ? 'border-warn/20 text-warn hover:bg-warn/10' : 'border-chart-1/15 text-chart-1 hover:bg-chart-1/10'
          )}
        >
          Show all {entries.length}
        </button>
      )}
    </div>
  );
}

/** One of the two reminder counts above the map; it opens the list of them. */
function ReminderLens({
  tone,
  on,
  onPress,
  children,
}: {
  tone: 'warn' | 'due';
  on: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <m.button
      {...pressMotion}
      type="button"
      onClick={onPress}
      aria-pressed={on}
      className={cn(
        'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold tabular-nums transition-colors duration-200 ease-ios',
        tone === 'warn'
          ? on
            ? 'border-warn bg-warn text-card'
            : 'border-warn/30 bg-warn-soft text-warn hover:bg-warn/15'
          : on
            ? 'border-chart-1 bg-chart-1 text-white'
            : 'border-chart-1/30 bg-chart-1/10 text-chart-1 hover:bg-chart-1/15'
      )}
    >
      {children}
    </m.button>
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

  // A row with nothing under it is an activity whatever its depth. A plan
  // with no headings puts its activities at the top, where they are drawn as
  // units — and pressing one used to "open" an empty branch instead of the
  // panel, so on such a project no activity could be filled in from the map.
  if (node.kind === 'leaf' || node.children.length === 0) {
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
  const isBranch = node.children.length > 0;
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
          {node.dueCount > 0 && !isBranch && (
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
              {/* Counted on the branch so a late activity is found with the
                  contract still folded, not only after opening every one. */}
              {node.lateCount > 0 && <Pill tone="warn">{node.lateCount} late</Pill>}
              {node.soonCount > 0 && <Pill tone="due">{node.soonCount} ending soon</Pill>}
            </>
          )}
          {!isBranch && node.lateBy !== undefined && (
            <Pill tone="warn">
              Late {node.lateBy} {node.lateBy === 1 ? 'wk' : 'wks'}
            </Pill>
          )}
          {!isBranch && node.dueIn !== undefined && (
            <Pill tone="due">
              {node.dueIn === 0 ? 'Ends this week' : `Ends in ${node.dueIn} ${node.dueIn === 1 ? 'wk' : 'wks'}`}
            </Pill>
          )}
          {!isBranch &&
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
  const p = Math.max(0, Math.min(100, plan)) / 100;
  // Plan is a bar of its own under the actual one, on the same scale — the
  // app's one way of drawing the pair since 26 Sep 2026 (see
  // components/ui/PlanActualBar.tsx). It was a tick on the fill, which at a
  // plan of 0% sat on the bar's start and read as a stray mark.
  return (
    <span className="mt-2.5 flex w-full flex-col gap-[3px]">
      <span
        className={cn(
          'relative block w-full overflow-hidden rounded-full bg-foreground/8',
          thick ? 'h-2.5' : 'h-2'
        )}
      >
        <m.span
          className="absolute inset-y-0 left-0 block w-full origin-left rounded-full bg-chart-1"
          initial={false}
          animate={{ scaleX: a }}
          transition={MOTION.spring}
        />
      </span>
      <span aria-hidden="true" className="relative block h-1 w-full overflow-hidden rounded-full bg-foreground/8">
        <span
          className="absolute inset-y-0 left-0 block w-full origin-left rounded-full bg-chart-2"
          style={{ transform: `scaleX(${p})` }}
        />
      </span>
    </span>
  );
}
