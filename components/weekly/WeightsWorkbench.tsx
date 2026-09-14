'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { m } from 'framer-motion';

import { pressMotion } from '@/components/motion/Press';
import { updateRowTextAction } from '@/lib/sheet-actions';
import {
  allocationOf,
  deriveWeights,
  topLevelPricedTotal,
  type Allocation,
  type WeightNode,
} from '@/lib/weights';
import type { WeightsRow, WeightsScreen, WeightsUnit } from '@/lib/weights-screen';
import { formatMoney } from '@/lib/currency';
import MoneyInput from '@/components/ui/MoneyInput';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Loaded on demand: nobody opens this on the way past, and the field crew's
// connection is what the initial bundle is measured against.
const MeasurePanel = dynamic(() => import('./MeasurePanel'), { ssr: false });
const DeriveWeightsDialog = dynamic(() => import('./DeriveWeightsDialog'), { ssr: false });

/**
 * Where a project says what its work is worth.
 *
 * The whole screen rests on one thing being true, and it is worth saying out
 * loud because it is what makes the screen usable at all: **you only type the
 * prices you actually have.** A contract figure alone weights every row evenly.
 * A price on the SPK spreads inside that SPK. A price on a row is exact. Rows
 * nobody priced are never blank — they take a share of what is left, and they
 * say so. The total closes at 100 in every one of those states, by
 * construction rather than by luck, because `deriveWeights` does the spreading.
 *
 * **The live figures come from that same function**, called again in the
 * browser over a copy of the rows with the typed price patched in.
 * `lib/weights.ts` imports nothing, so this is not a second formula written to
 * approximate the first — it IS the first. A preview that drifts from the
 * report is worse than no preview.
 *
 * **One level at a time**, the pattern `DataOverallWorkbench` already proved on
 * a phone: SPK cards, tap one, see its rows. A full tree of 285 rows with a
 * price box on each is the Excel sheet this product exists to replace.
 *
 * **The price box is `MoneyInput`**, which is a plain `<input>`. That matters
 * twice: this list can run past 20 rows and Radix costs are per mounted
 * instance, and the caret arithmetic for grouped digits was already solved in
 * there. It commits on BLUR, not on a timer — three other screens already
 * commit that way, and a timer is a write that can still be in flight when the
 * person navigates away.
 */
export default function WeightsWorkbench({
  screen,
  projectId,
}: {
  screen: WeightsScreen;
  projectId: string;
}) {
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  /** Prices typed since the page loaded, raw digit strings, keyed by row id. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  /**
   * Percents typed since the page loaded, the other half of the same question.
   *
   * Kept apart from `typed` rather than in one map with a unit beside it,
   * because the two clear each other on the server and a single map would make
   * "this row has no price" and "this row has a price of nothing" the same
   * state while the save is still in flight.
   */
  const [typedPct, setTypedPct] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  /** The row whose measurement panel is open. ONE panel, pointed at a row. */
  const [measuring, setMeasuring] = useState<WeightsRow | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const signed = screen.summary.contractValue > 0 ? screen.summary.contractValue : undefined;

  /** The rows as they stand on screen right now, typed prices included. */
  const patched = useMemo<WeightNode[]>(() => {
    if (Object.keys(typed).length === 0 && Object.keys(typedPct).length === 0) return screen.nodes;
    return screen.nodes.map((n) => {
      const rawMoney = typed[n.id];
      const rawPct = typedPct[n.id];
      if (rawMoney === undefined && rawPct === undefined) return n;
      const next = { ...n };
      // THE TWO CLEAR EACH OTHER, here exactly as they do in the action. A
      // price wins over a stated percent inside `deriveWeights`, so a row left
      // holding both would take its old price and the percent box would sit
      // there changing nothing — the box reading as broken when it is the
      // stale price underneath that is the problem.
      if (rawMoney !== undefined) {
        const v = rawMoney === '' ? null : Number(rawMoney);
        next.price = v != null && Number.isFinite(v) && v > 0 ? v : null;
        if (next.price != null) next.workstepFactor = null;
      }
      if (rawPct !== undefined) {
        const v = rawPct === '' ? null : Number(rawPct);
        next.workstepFactor = v != null && Number.isFinite(v) && v > 0 ? v / 100 : null;
        if (next.workstepFactor != null) next.price = null;
      }
      return next;
    });
  }, [screen.nodes, typed, typedPct]);

  const live = useMemo(() => deriveWeights(patched, signed), [patched, signed]);

  /**
   * What is still unpriced, recomputed as well.
   *
   * Read off the server's summary it went stale the moment anyone typed: two
   * billion entered on the first row and the line above it still read "IDR
   * 4 500 000 000 has no price on it yet". A figure that contradicts the box
   * you just typed into is worse than no figure.
   */
  const gap = useMemo(
    () => (signed ? Math.max(0, signed - topLevelPricedTotal(patched)) : 0),
    [patched, signed]
  );

  /** What each unit's leaves add up to now, so in-unit percentages move too. */
  const unitTotals = useMemo(() => {
    const out = new Map<string, number>();
    for (const u of screen.units) {
      out.set(
        u.id,
        u.rows.filter((r) => r.isLeaf).reduce((s, r) => s + (live.bobotOf.get(r.id) ?? 0), 0)
      );
    }
    return out;
  }, [screen.units, live]);

  /** The same denominator for rows no card holds: the project itself. */
  const looseTotal = useMemo(
    () =>
      screen.looseRows
        .filter((r) => r.isLeaf)
        .reduce((s, r) => s + (live.bobotOf.get(r.id) ?? 0), 0),
    [screen.looseRows, live]
  );

  function commitPrice(rowId: string, raw: string) {
    setFailed(null);
    setTypedPct((p) => (rowId in p ? omit(p, rowId) : p));
    startTransition(async () => {
      const res = await updateRowTextAction(rowId, 'price', raw);
      if (!res.ok) setFailed(res.error);
    });
  }

  function commitPercent(rowId: string, raw: string) {
    setFailed(null);
    setTyped((p) => (rowId in p ? omit(p, rowId) : p));
    startTransition(async () => {
      const res = await updateRowTextAction(rowId, 'percent', raw);
      if (!res.ok) setFailed(res.error);
    });
  }

  /**
   * What every heading has to give out and what its rows have claimed, run
   * again on the patched rows so a card's "left" figure moves with the box
   * being typed into. Same function the server called — there is no second
   * opinion about money anywhere in this screen.
   */
  const liveAlloc = useMemo(() => allocationOf(patched, live), [patched, live]);

  /** How many activities carry a price now, counting what is only typed. */
  const pricedCount = useMemo(
    () => patched.filter((n) => n.isLeaf && (n.price ?? 0) > 0).length,
    [patched]
  );
  const leafCount = useMemo(() => patched.filter((n) => n.isLeaf).length, [patched]);

  const unit = openUnit ? (screen.units.find((u) => u.id === openUnit) ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      {failed && (
        <p className="animate-fade-in-up rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failed}
        </p>
      )}

      <PricingHero
        screen={screen}
        live={live}
        gap={gap}
        priced={pricedCount}
        total={leafCount}
        onLock={() => setDeriving(true)}
      />

      {unit ? (
        <UnitRows
          unit={unit}
          currency={screen.summary.currency}
          live={live}
          alloc={liveAlloc.get(unit.id) ?? null}
          unitTotal={unitTotals.get(unit.id) ?? 0}
          typed={typed}
          setTyped={setTyped}
          typedPct={typedPct}
          setTypedPct={setTypedPct}
          onCommit={commitPrice}
          onCommitPercent={commitPercent}
          onMeasure={setMeasuring}
          onBack={() => setOpenUnit(null)}
        />
      ) : (
        <>
          {!screen.hasUnits && screen.units.length > 0 && (
            <p className="text-sm text-muted-foreground">
              No SPK marked yet, so the top level of the WBS stands in. Mark one in the planner to
              give it its own section in the report.
            </p>
          )}

          {screen.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              currency={screen.summary.currency}
              bobot={unitTotals.get(u.id) ?? 0}
              alloc={liveAlloc.get(u.id) ?? null}
              value={liveValueOf(u, live)}
              onOpen={() => setOpenUnit(u.id)}
            />
          ))}

          {/* Rows no card holds. On a flat plan this IS the plan, and it is the
              only place a price can be typed. */}
          {screen.looseRows.length > 0 && (
            <RowList
              rows={screen.looseRows}
              live={live}
              against={looseTotal}
              currency={screen.summary.currency}
              typed={typed}
              setTyped={setTyped}
              typedPct={typedPct}
              setTypedPct={setTypedPct}
              onCommit={commitPrice}
              onCommitPercent={commitPercent}
              onMeasure={setMeasuring}
              showBoth={false}
              scopeLabel="project"
            />
          )}

          {screen.units.length === 0 && screen.looseRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This project has no work laid out yet. Add rows in the planner first.
            </p>
          )}
        </>
      )}

      {deriving && (
        <DeriveWeightsDialog
          projectId={projectId}
          onClose={() => setDeriving(false)}
          onApplied={() => {
            setDeriving(false);
            router.refresh();
          }}
        />
      )}

      {measuring && (
        <MeasurePanel
          row={measuring}
          onClose={() => setMeasuring(null)}
          onSaved={() => {
            setMeasuring(null);
            // The server owns the method, the quantity and the step list, so
            // the page is re-read rather than patched here. Nothing typed is
            // lost: prices commit on blur and are already saved.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * How far the pricing has got, as a thing with a shape rather than a sentence.
 *
 * The first version of this was one thin line of grey text, and it was the
 * wrong shape for what it says. This screen is a job someone works THROUGH, so
 * the top of it has to answer "how far am I" at a glance and move while they
 * work. A bar does that; a sentence makes you read three numbers and subtract.
 *
 * The 100.00% is not decoration either. It is the screen taking responsibility
 * for the one thing people get wrong by hand, so that closing at 100 stops
 * being something to check. If it ever reads anything else, that is a bug here,
 * not a job for whoever is typing.
 */
function PricingHero({
  screen,
  live,
  gap,
  priced,
  total,
  onLock,
}: {
  screen: WeightsScreen;
  live: ReturnType<typeof deriveWeights>;
  gap: number;
  priced: number;
  total: number;
  onLock: () => void;
}) {
  const { summary } = screen;
  const signed = summary.contractValue > 0;
  const allocated = Math.max(0, summary.contractValue - gap);
  const pct = signed ? Math.min(100, (allocated / summary.contractValue) * 100) : 0;
  const done = gap <= 0.5 && signed;
  const locked = summary.basis === 'boq';

  return (
    <Card className="gap-3 bg-gradient-to-br from-chart-1/8 to-transparent ring-chart-1/20">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Contract value
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
              {signed
                ? formatMoney(summary.contractValue, summary.currency)
                : 'No contract value yet'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Weights total
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-chart-1 sm:text-3xl">
              {live.total.toFixed(2)}%
            </p>
          </div>
        </div>

        {signed && (
          <>
            {/* Priced against the contract. It fills as prices are typed, which
                is the only moving thing on the screen that says "progress". */}
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/8">
              <div
                className="h-full rounded-full bg-chart-1 transition-[width] duration-300 ease-ios"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted-foreground">
                {done ? (
                  <span className="font-medium text-ok">
                    Every activity has a price. These weights come from the money.
                  </span>
                ) : (
                  <>
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(allocated, summary.currency)}
                    </strong>{' '}
                    priced,{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(gap, summary.currency)}
                    </strong>{' '}
                    still open · {priced} of {total} activities
                  </>
                )}
              </p>

              {/* The LOCK, and it belongs here rather than in the planner's
                  money strip, which is where it was stranded when the price
                  column left the planner on 12 Sep. Recalculating needs no
                  button: `syncDerivedWeights` already keeps an unlocked
                  project's weights in step with its prices on every edit. What
                  needs one is DECLARING them authoritative, after which the
                  prices stop pushing them around — and on Gundih that is the
                  difference between 81 correct weights and 81 wrong ones. */}
              {locked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                  Value based, locked
                </span>
              ) : (
                <m.button
                  {...pressMotion}
                  onClick={onLock}
                  className="inline-flex min-h-11 items-center rounded-lg bg-background px-4 text-sm font-medium ring-1 ring-foreground/12 transition-colors duration-300 ease-ios hover:bg-accent"
                >
                  Lock these weights
                </m.button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Drop one key without mutating, so a stale entry cannot outlive its save. */
function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** What a card's rows are worth RIGHT NOW, typed boxes included. */
function liveValueOf(unit: WeightsUnit, live: ReturnType<typeof deriveWeights>): number {
  return unit.rows
    .filter((r) => r.isLeaf)
    .reduce((s, r) => s + (live.valueOf.get(r.id) ?? 0), 0);
}

/**
 * A heading's budget, and how much of it its rows have spoken for.
 *
 * THIS IS THE LINE THAT WAS MISSING. The card used to print the heading ROW's
 * own price and nothing else, so a heading with six fully priced rows beneath
 * it and no price of its own said "No value yet" while the figure beside it
 * read 69.72% — one card, two statements, and they contradicted each other.
 *
 * Over-allocation is SAID, never corrected: the number stands and the card
 * turns. Scaling the rows back to fit would move figures nobody asked to move,
 * and this app's rule is that a screen reports what the derivation found.
 */
function BudgetLine({
  alloc,
  value,
  currency,
  priced,
  total,
  big,
}: {
  alloc: Allocation | null;
  value: number;
  currency: string;
  priced: number;
  total: number;
  /** The drilled-in header says it louder than the card in a list does. */
  big?: boolean;
}) {
  const over = alloc != null && alloc.left < -0.5;
  const spare = alloc != null && alloc.left > 0.5;

  const headline = alloc
    ? `${formatMoney(alloc.budget, currency)} budget`
    : value > 0
      ? `${formatMoney(value, currency)} from the rows below`
      : 'No value yet';

  // Against the BUDGET, not against the biggest sibling: this bar answers "how
  // much of this heading is spoken for", and 100 is a real edge it can cross.
  const filled = alloc && alloc.budget > 0 ? (alloc.claimed / alloc.budget) * 100 : 0;

  return (
    <>
      <p className={cn('text-muted-foreground', big ? 'text-sm' : 'mt-0.5 text-sm')}>
        <span className={cn('tabular-nums', alloc && 'font-medium text-foreground')}>{headline}</span>{' '}
        · {priced} of {total} rows set
      </p>

      {alloc && (
        <>
          <div className={cn('w-full overflow-hidden rounded-full bg-foreground/8', big ? 'mt-2 h-2' : 'mt-1.5 h-1.5')}>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300 ease-ios',
                over ? 'bg-destructive' : 'bg-chart-1'
              )}
              style={{ width: `${Math.min(100, Math.max(0, filled))}%` }}
            />
          </div>
          <p className={cn('mt-1 text-xs tabular-nums', over ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
            {over
              ? `Over by ${formatMoney(-alloc.left, currency)}`
              : spare
                ? `${formatMoney(alloc.left, currency)} left${alloc.openChildren > 0 ? ` for ${alloc.openChildren} ${alloc.openChildren === 1 ? 'row' : 'rows'}` : ' to share out'}`
                : 'Fully shared out'}
            {alloc.statedFraction > 0 && ` · rows state ${(alloc.statedFraction * 100).toFixed(0)}%`}
          </p>
        </>
      )}
    </>
  );
}

function UnitCard({
  unit,
  currency,
  bobot,
  alloc,
  value,
  onOpen,
}: {
  unit: WeightsUnit;
  currency: string;
  bobot: number;
  alloc: Allocation | null;
  value: number;
  onOpen: () => void;
}) {
  const over = alloc != null && alloc.left < -0.5;
  return (
    <m.button
      {...pressMotion}
      onClick={onOpen}
      className={cn(
        'min-h-11 w-full rounded-lg bg-card p-3 text-left ring-1 transition-colors duration-300 ease-ios hover:bg-accent',
        over ? 'ring-destructive/40' : 'ring-foreground/10'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {unit.code} {unit.name}
          </p>
          <BudgetLine
            alloc={alloc}
            value={value}
            currency={currency}
            priced={unit.decidedRows}
            total={unit.totalRows}
          />
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums">{bobot.toFixed(2)}%</span>
      </div>
    </m.button>
  );
}

function UnitRows({
  unit,
  currency,
  live,
  alloc,
  unitTotal,
  typed,
  setTyped,
  typedPct,
  setTypedPct,
  onCommit,
  onCommitPercent,
  onMeasure,
  onBack,
}: {
  unit: WeightsUnit;
  currency: string;
  live: ReturnType<typeof deriveWeights>;
  alloc: Allocation | null;
  unitTotal: number;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  typedPct: Record<string, string>;
  setTypedPct: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (rowId: string, raw: string) => void;
  onCommitPercent: (rowId: string, raw: string) => void;
  onMeasure: (row: WeightsRow) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <m.button
          {...pressMotion}
          onClick={onBack}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-chart-1 transition-colors duration-300 ease-ios hover:bg-accent"
        >
          Back to all SPK
        </m.button>
      </div>

      {/* The same three figures the card carried, kept in front of you while
          you spend them. Walking into a heading and losing the budget you are
          dividing is how someone ends up typing until the rows look plausible
          rather than until they add up. */}
      <div className="rounded-lg bg-card p-3 ring-1 ring-foreground/10">
        <p className="truncate font-semibold">
          {unit.code} {unit.name}
        </p>
        <BudgetLine
          alloc={alloc}
          value={liveValueOf(unit, live)}
          currency={currency}
          priced={unit.decidedRows}
          total={unit.totalRows}
          big
        />
      </div>

      <RowList
        rows={unit.rows}
        live={live}
        against={unitTotal}
        currency={currency}
        typed={typed}
        setTyped={setTyped}
        typedPct={typedPct}
        setTypedPct={setTypedPct}
        onCommit={onCommit}
        onCommitPercent={onCommitPercent}
        onMeasure={onMeasure}
        showBoth
        scopeLabel={unit.code || 'this unit'}
      />

      <p className="px-1 text-xs text-muted-foreground">
        Give a row a share of this heading, or its own price if you have one. Rows you leave alone
        split whatever is still open between them.
      </p>
    </div>
  );
}

/**
 * The rows, their price boxes, and their two weights.
 *
 * Shared between a card's contents and the rows no card holds, because a flat
 * plan needs exactly the same list on its first screen that a nested one gets
 * after a tap. Writing it twice is how the two would drift.
 */
function RowList({
  rows,
  live,
  against,
  currency,
  typed,
  setTyped,
  typedPct,
  setTypedPct,
  onCommit,
  onCommitPercent,
  onMeasure,
  showBoth,
  scopeLabel,
}: {
  rows: WeightsRow[];
  live: ReturnType<typeof deriveWeights>;
  /** Denominator for the left figure: this scope's own leaf total. */
  against: number;
  currency: string;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  typedPct: Record<string, string>;
  setTypedPct: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (rowId: string, raw: string) => void;
  onCommitPercent: (rowId: string, raw: string) => void;
  onMeasure: (row: WeightsRow) => void;
  /** Whether the scope figure and the project figure are different questions. */
  showBoth: boolean;
  scopeLabel: string;
}) {
  const maxScope =
    against > 0
      ? Math.max(
          ...rows
            .filter((r) => r.isLeaf)
            .map((r) => ((live.bobotOf.get(r.id) ?? 0) / against) * 100),
          0
        )
      : 0;

  return (
    <>
      {/* Column captions, and only from `sm` up, because below that the row is
          stacked and there are no columns for them to sit over. Said once here
          so the small figure on each row does not repeat "in SPK-002" three
          hundred times down the page. */}
      <div className="hidden items-center gap-3 px-3 text-xs font-semibold text-muted-foreground sm:flex">
        <span className="flex-1">Activity</span>
        <span className="w-44 text-right">Share or price</span>
        <span className="w-28 text-right">{showBoth ? 'Weight here' : 'Weight'}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const overall = row.isLeaf ? (live.bobotOf.get(row.id) ?? 0) : subtreeOf(row.id, rows, live);
          const inScope = against > 0 ? (overall / against) * 100 : 0;
          const priced = (typed[row.id] ?? String(row.price ?? '')) !== '';
          // DECIDED, not priced. A stated share is somebody's decision just as
          // much as a price is — the comments below draw an undecided row as a
          // placeholder, and drawing a row set to 30% that way would call the
          // one deliberate thing on it a guess.
          const decided =
            priced ||
            (typedPct[row.id] ?? (row.percentOfParent != null ? String(row.percentOfParent) : '')) !== '';
          // Scaled against the BIGGEST row here, not against 100. Thirteen rows
          // of 7.69% drawn on a 0-100 scale are thirteen identical slivers, and
          // a bar that cannot tell two rows apart is worse than no bar. Against
          // the largest, the list becomes a shape you read in one look, and
          // typing one price visibly redraws the whole column.
          const bar = maxScope > 0 ? Math.max(2, (inScope / maxScope) * 100) : 0;

          // At most one line, and never the same number twice. Inside an SPK
          // the project figure is a different question and earns its place;
          // on the project's own list it would be the figure above, restated.
          const note = [
            showBoth ? `${overall.toFixed(2)}% of project` : '',
            row.isLeaf && !decided ? (row.share === 'factor' ? 'set fraction' : 'even share') : '',
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <div
              key={row.id}
              // Stacked below `sm`. The name gets the full width there because
              // it is what someone identifies a row BY: squeezed into a column
              // beside a price box at 390px, "2 Procurement Material" and
              // "3 Procurement Material Solar" both came out as
              // "Procurement ..." and the list became unreadable. Same lesson
              // the planner learned about its own name column.
              className={cn(
                'rounded-lg bg-card px-3 py-2.5 ring-1 transition-colors duration-300 ease-ios sm:flex sm:items-center sm:gap-3',
                // A priced row is visibly settled. Reading down the list you can
                // see how far you got without counting anything.
                decided ? 'ring-chart-1/35' : 'ring-foreground/10'
              )}
              style={{ marginLeft: `${Math.min(row.depth, 4) * 12}px` }}
            >
              <div className="min-w-0 sm:flex-1">
                <p className="line-clamp-2 text-sm font-medium">
                  {row.code} {row.name}
                </p>
                {!row.isLeaf ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Branch. Its figure is the rows beneath it.
                  </p>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* The schedule, read only. It sits here because in the
                        workbook this replaces Duration / Start / Finish are the
                        columns immediately beside Price, and the weekly plan is
                        derived from them. Without it the screen looks like it
                        only does money. */}
                    {row.start && row.finish ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {fmtDay(row.start)} to {fmtDay(row.finish)}
                        {row.durationDays ? ` · ${row.durationDays}d` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not scheduled yet</span>
                    )}
                    <MeasureChip row={row} onOpen={() => onMeasure(row)} />
                  </div>
                )}
              </div>

              <div className="mt-2 flex items-center gap-3 sm:mt-0 sm:shrink-0">
                <ValueField
                  row={row}
                  currency={currency}
                  money={live.valueOf.get(row.id) ?? 0}
                  setTyped={setTyped}
                  setTypedPct={setTypedPct}
                  onCommit={onCommit}
                  onCommitPercent={onCommitPercent}
                />

                <div className="w-28 shrink-0">
                  <div className="flex items-baseline justify-end gap-1.5">
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        decided ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {inScope.toFixed(2)}%
                    </span>
                  </div>
                  {/* The weight as a shape. Everything the digits say, said
                      again in a form you can compare across rows at a glance,
                      and the only part of the row that MOVES while you type. */}
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-foreground/8">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-300 ease-ios',
                        decided ? 'bg-chart-1' : 'text-foreground/30'
                      )}
                      style={{
                        width: `${bar}%`,
                        // HATCHED while the figure is provisional. Solid bars on
                        // an unpriced plan are thirteen identical full blocks
                        // that read as "done" or as a stuck progress bar; the
                        // hatch reads as "placeholder", which is what an even
                        // share is. It turns solid the moment a price decides it.
                        ...(decided
                          ? null
                          : {
                              backgroundImage:
                                'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)',
                            }),
                      }}
                    />
                  </div>
                  {note && (
                    <span className="mt-1 block text-right text-xs tabular-nums text-muted-foreground">
                      {note}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * One box, two units, because a share and a price are the same fact.
 *
 * The screen used to ask for money and only money, and that is the wrong
 * question on most of this work: a heading has a budget, and what people
 * actually decide about the rows inside it is how much of that budget each one
 * is. Asking for rupiah there makes somebody do the multiplication by hand and
 * type the answer, which is a worse version of the number they already had.
 *
 * Both units land in columns that already exist and that `deriveWeights`
 * already honours. A price is exact and is the row's own money; a percent is
 * `workstep_factor`, a stated fraction of the parent's budget, which the
 * Gundih importer has been writing since day one while no screen could.
 *
 * **They clear each other, on purpose.** A price wins over a stated percent
 * inside the derivation, so a row holding both would keep taking its old price
 * while the percent box sat there changing nothing — the field reading as
 * broken when the stale price underneath is the actual problem. Same rule
 * `applyProgressMethod` follows when a method change wipes the other method's
 * evidence: a number nobody can explain later is worse than a blank.
 *
 * Native `<input>` and `<button>`, no Radix: this list runs to hundreds of
 * rows and Radix costs are per mounted instance.
 */
type ValueMode = 'pct' | 'money';

function ValueField({
  row,
  currency,
  money,
  setTyped,
  setTypedPct,
  onCommit,
  onCommitPercent,
}: {
  row: WeightsRow;
  currency: string;
  /** What this row is worth right now, typed boxes included. */
  money: number;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setTypedPct: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (rowId: string, raw: string) => void;
  onCommitPercent: (rowId: string, raw: string) => void;
}) {
  // Percent first where nothing has been decided. It is the unit this screen is
  // for, and the one that stays true when the heading above it is repriced.
  const [mode, setMode] = useState<ValueMode>(
    row.percentOfParent != null ? 'pct' : row.price != null ? 'money' : 'pct'
  );

  const seededPct = row.percentOfParent != null ? String(+row.percentOfParent.toFixed(4)) : '';

  // The symbol comes OUT of the formatter rather than from a second table of
  // currencies beside it — the same reason `formatMoney` exists at all.
  const symbol =
    [...formatMoney(0, currency)]
      .filter((ch) => !/[0-9]/.test(ch) && ch.trim() !== '' && ch !== '.' && ch !== ',')
      .join('') || currency;

  return (
    <div className="mt-2 min-w-0 flex-1 sm:mt-0 sm:w-44 sm:flex-none">
      <div className="flex items-stretch gap-2">
        <div className="inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-foreground/12">
          {(['pct', 'money'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={m === 'pct' ? 'Give this row a share of its heading' : 'Give this row its own price'}
              className={cn(
                'min-h-11 min-w-9 px-2 text-sm font-semibold transition-colors duration-300 ease-ios',
                mode === m
                  ? 'bg-chart-1 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              )}
            >
              {m === 'pct' ? '%' : symbol}
            </button>
          ))}
        </div>

        {mode === 'pct' ? (
          <input
            type="text"
            inputMode="decimal"
            defaultValue={seededPct}
            placeholder="Share"
            className="min-h-11 w-full min-w-0 rounded-lg bg-background px-3 text-right text-sm tabular-nums ring-1 ring-foreground/12 transition-shadow duration-300 ease-ios placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground focus:ring-2 focus:ring-chart-1 focus:outline-none"
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              setTypedPct((t) => ({ ...t, [row.id]: raw }));
            }}
            onBlur={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              if (raw !== seededPct) onCommitPercent(row.id, raw);
            }}
          />
        ) : (
          <MoneyInput
            defaultValue={row.price != null ? String(row.price) : ''}
            placeholder="Price"
            className="min-h-11 w-full min-w-0 rounded-lg bg-background px-3 text-right text-sm tabular-nums ring-1 ring-foreground/12 transition-shadow duration-300 ease-ios placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground focus:ring-2 focus:ring-chart-1 focus:outline-none"
            onValueChange={(raw) => setTyped((t) => ({ ...t, [row.id]: raw }))}
            onCommit={(raw) => onCommit(row.id, raw)}
          />
        )}
      </div>

      {/* The other unit, said back. In money mode the weight column beside this
          one already answers it, so it would be the same number twice. */}
      {mode === 'pct' && (
        <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
          {money > 0 ? `= ${formatMoney(money, currency)}` : 'No budget above it yet'}
        </p>
      )}
    </div>
  );
}

/**
 * How this row will be measured, as a control rather than as a caption.
 *
 * It is a BUTTON on every row, including the rows that are fine, because the
 * thing being said is a decision someone can change and quiet text saying
 * "percent" would read as a label rather than as an offer. The estimated state
 * is the one that has to carry weight: 233 of this database's 236 leaves sit on
 * a typed percent, which is the workbook's own failure reproduced, so it is
 * drawn as something unfinished rather than as a neutral default.
 */
function MeasureChip({ row, onOpen }: { row: WeightsRow; onOpen: () => void }) {
  // Phrased as what the person DOES every week, not as the name of a setting.
  // "Quantity" is a category; "450 m to count" is an instruction, and it also
  // shows the total back so a wrong one is caught here rather than in month
  // three when the percentage stops making sense.
  const label =
    row.method === 'qty'
      ? `${row.qtyTotal ?? '?'} ${row.qtyUnit ?? 'units'} to count`
      : row.method === 'milestone'
        ? `${row.steps} steps to tick`
        : row.method === 'linked'
          ? 'From the document register'
          : 'Percent, typed';

  return (
    <m.button
      {...pressMotion}
      onClick={onOpen}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 transition-colors duration-300 ease-ios',
        row.estimated
          ? 'bg-warn-soft text-warn ring-warn/30 hover:bg-warn/15'
          : 'bg-ok-soft text-ok ring-ok/25 hover:bg-ok/15'
      )}
      title="Choose how this activity is measured"
    >
      {row.estimated && <span aria-hidden>!</span>}
      {label}
    </m.button>
  );
}

/** `2026-03-14` as `14 Mar`. en-GB, like every other date in the app. */
function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A branch's live figure: its own leaves in this list, added up. */
function subtreeOf(branchId: string, rows: WeightsRow[], live: ReturnType<typeof deriveWeights>) {
  const idx = rows.findIndex((r) => r.id === branchId);
  if (idx < 0) return 0;
  const depth = rows[idx].depth;
  let sum = 0;
  for (let i = idx + 1; i < rows.length && rows[i].depth > depth; i += 1) {
    if (rows[i].isLeaf) sum += live.bobotOf.get(rows[i].id) ?? 0;
  }
  return sum;
}
