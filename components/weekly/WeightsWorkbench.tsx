'use client';

import { useMemo, useState, useTransition } from 'react';

import { m } from 'framer-motion';

import { pressMotion } from '@/components/motion/Press';
import { updateRowTextAction } from '@/lib/sheet-actions';
import { deriveWeights, topLevelPricedTotal, type WeightNode } from '@/lib/weights';
import type { WeightsRow, WeightsScreen, WeightsUnit } from '@/lib/weights-screen';
import { formatMoney } from '@/lib/currency';
import MoneyInput from '@/components/ui/MoneyInput';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
export default function WeightsWorkbench({ screen }: { screen: WeightsScreen }) {
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  /** Prices typed since the page loaded, raw digit strings, keyed by row id. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const signed = screen.summary.contractValue > 0 ? screen.summary.contractValue : undefined;

  /** The rows as they stand on screen right now, typed prices included. */
  const patched = useMemo<WeightNode[]>(
    () =>
      Object.keys(typed).length === 0
        ? screen.nodes
        : screen.nodes.map((n) => {
            const raw = typed[n.id];
            if (raw === undefined) return n;
            const v = raw === '' ? null : Number(raw);
            return { ...n, price: v != null && Number.isFinite(v) && v > 0 ? v : null };
          }),
    [screen.nodes, typed]
  );

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
    startTransition(async () => {
      const res = await updateRowTextAction(rowId, 'price', raw);
      if (!res.ok) setFailed(res.error);
    });
  }

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
      />

      {unit ? (
        <UnitRows
          unit={unit}
          currency={screen.summary.currency}
          live={live}
          unitTotal={unitTotals.get(unit.id) ?? 0}
          typed={typed}
          setTyped={setTyped}
          onCommit={commitPrice}
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
              typed={typed}
              setTyped={setTyped}
              onCommit={commitPrice}
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
}: {
  screen: WeightsScreen;
  live: ReturnType<typeof deriveWeights>;
  gap: number;
  priced: number;
  total: number;
}) {
  const { summary } = screen;
  const signed = summary.contractValue > 0;
  const allocated = Math.max(0, summary.contractValue - gap);
  const pct = signed ? Math.min(100, (allocated / summary.contractValue) * 100) : 0;
  const done = gap <= 0.5 && signed;

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
                  priced, <strong className="tabular-nums text-foreground">
                    {formatMoney(gap, summary.currency)}
                  </strong>{' '}
                  still open · {priced} of {total} activities
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UnitCard({
  unit,
  currency,
  bobot,
  onOpen,
}: {
  unit: WeightsUnit;
  currency: string;
  bobot: number;
  onOpen: () => void;
}) {
  return (
    <m.button
      {...pressMotion}
      onClick={onOpen}
      className="min-h-11 w-full rounded-lg bg-card p-3 text-left ring-1 ring-foreground/10 transition-colors duration-300 ease-ios hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {unit.code} {unit.name}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {unit.unitValue != null ? formatMoney(unit.unitValue, currency) : 'No value yet'} ·{' '}
            {unit.pricedRows} of {unit.totalRows} rows priced
          </p>
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
  unitTotal,
  typed,
  setTyped,
  onCommit,
  onBack,
}: {
  unit: WeightsUnit;
  currency: string;
  live: ReturnType<typeof deriveWeights>;
  unitTotal: number;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (rowId: string, raw: string) => void;
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
        <span className="truncate text-sm font-semibold">
          {unit.code} {unit.name}
        </span>
      </div>

      <RowList
        rows={unit.rows}
        live={live}
        against={unitTotal}
        typed={typed}
        setTyped={setTyped}
        onCommit={onCommit}
        showBoth
        scopeLabel={unit.code || 'this unit'}
      />

      <p className="px-1 text-xs text-muted-foreground">
        {formatMoney(unit.unitValue ?? 0, currency)} spread across {unit.totalRows} rows. Type the
        prices you have; the rest take an even share of what is left.
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
  typed,
  setTyped,
  onCommit,
  showBoth,
  scopeLabel,
}: {
  rows: WeightsRow[];
  live: ReturnType<typeof deriveWeights>;
  /** Denominator for the left figure: this scope's own leaf total. */
  against: number;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onCommit: (rowId: string, raw: string) => void;
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
        <span className="w-36 text-right">Price</span>
        <span className="w-28 text-right">{showBoth ? `Weight in ${scopeLabel}` : 'Weight'}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const overall = row.isLeaf ? (live.bobotOf.get(row.id) ?? 0) : subtreeOf(row.id, rows, live);
          const inScope = against > 0 ? (overall / against) * 100 : 0;
          const priced = (typed[row.id] ?? String(row.price ?? '')) !== '';
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
            row.isLeaf && !priced ? (row.share === 'factor' ? 'set fraction' : 'even share') : '',
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
                priced ? 'ring-chart-1/35' : 'ring-foreground/10'
              )}
              style={{ marginLeft: `${Math.min(row.depth, 4) * 12}px` }}
            >
              <div className="min-w-0 sm:flex-1">
                <p className="line-clamp-2 text-sm font-medium">
                  {row.code} {row.name}
                </p>
                {!row.isLeaf && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Branch. Its figure is the rows beneath it.
                  </p>
                )}
              </div>

              <div className="mt-2 flex items-center gap-3 sm:mt-0 sm:shrink-0">
                <MoneyInput
                  defaultValue={row.price != null ? String(row.price) : ''}
                  placeholder="Add price"
                  className="min-h-11 flex-1 rounded-lg bg-background px-3 text-right text-sm tabular-nums ring-1 ring-foreground/12 transition-shadow duration-300 ease-ios placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground focus:ring-2 focus:ring-chart-1 focus:outline-none sm:w-40 sm:flex-none"
                  onValueChange={(raw) => setTyped((t) => ({ ...t, [row.id]: raw }))}
                  onCommit={(raw) => onCommit(row.id, raw)}
                />

                <div className="w-28 shrink-0">
                  <div className="flex items-baseline justify-end gap-1.5">
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        priced ? 'text-foreground' : 'text-muted-foreground'
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
                        priced ? 'bg-chart-1' : 'text-foreground/30'
                      )}
                      style={{
                        width: `${bar}%`,
                        // HATCHED while the figure is provisional. Solid bars on
                        // an unpriced plan are thirteen identical full blocks
                        // that read as "done" or as a stuck progress bar; the
                        // hatch reads as "placeholder", which is what an even
                        // share is. It turns solid the moment a price decides it.
                        ...(priced
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
