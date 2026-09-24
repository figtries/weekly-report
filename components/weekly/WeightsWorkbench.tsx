'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';

import { m } from 'framer-motion';
import { CornerDownRight, Sigma } from 'lucide-react';

import { PressLink, pressMotion } from '@/components/motion/Press';
import { updateRowTextAction } from '@/lib/sheet-actions';
import {
  allocationOf,
  checkBudgetEdit,
  CONTRACT_POOL,
  deriveWeights,
  overrunOf,
  poolAmount,
  poolOf,
  topLevelPricedTotal,
  type Allocation,
  type OverGiving,
  type Overrun,
  type WeightNode,
} from '@/lib/weights';
import type { WeightsRow, WeightsScreen, WeightsUnit } from '@/lib/weights-screen';
import { formatMoney } from '@/lib/currency';
import MoneyInput from '@/components/ui/MoneyInput';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Loaded on demand: nobody opens this on the way past, and the field crew's
// connection is what the initial bundle is measured against.
const DeriveWeightsDialog = dynamic(() => import('./DeriveWeightsDialog'), { ssr: false });

/**
 * Where a project says what its work is worth.
 *
 * **A budget is the only thing that gives a row weight** (24 Sep 2026). Each
 * row has one money box, and beside it the row's share of the heading it is
 * carved out of, which can be typed too: a typed share is turned into money
 * here and the money is what is saved. A row nobody budgeted weighs 0 and the
 * strip at the top lists it. A budget may never take more than its heading has
 * left, or push a heading below what its rows already take; the box is refused
 * on the spot, on the row, with the figure.
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
  /**
   * The row the strip sent someone to, highlighted until they touch something.
   *
   * Naming a heading is only half of it. The six worst on Gundih sit four and
   * five levels inside three different SPK, so a list that only NAMES them
   * leaves the reader to open cards one at a time looking for a code. The
   * strip opens the right card and puts the row under the eye instead.
   */
  const [focusRow, setFocusRow] = useState<string | null>(null);
  /** Prices typed since the page loaded, raw digit strings, keyed by row id. */
  const [typed, setTyped] = useState<Record<string, string>>({});
  /**
   * Bumped to put a new figure into a money box from outside it: a typed share
   * turned into money, or a refused budget put back. `MoneyInput` is
   * uncontrolled on purpose (its caret arithmetic), so this is its only way in.
   */
  const [reseed, setReseed] = useState<Record<string, number>>({});
  /** The last budget each row was saved at in this visit, to put back on a refusal. */
  const saved = useRef<Record<string, string>>({});
  /** A refusal belongs on the row it refused, not at the top of a long list. */
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const signed = screen.summary.contractValue > 0 ? screen.summary.contractValue : undefined;

  /** The rows as they stand on screen right now, typed prices included. */
  const patched = useMemo<WeightNode[]>(
    () =>
      Object.keys(typed).length === 0
        ? screen.nodes
        : screen.nodes.map((n) => withBudget(n, typed[n.id])),
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
    () => (signed ? signed - topLevelPricedTotal(patched) : 0),
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

  /** Every row and card by its code and name, for a refusal to say where. */
  const nameOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const u of screen.units) {
      out.set(u.id, `${u.code} ${u.name}`.trim());
      for (const r of u.rows) out.set(r.id, `${r.code} ${r.name}`.trim());
    }
    for (const r of screen.looseRows) out.set(r.id, `${r.code} ${r.name}`.trim());
    return out;
  }, [screen.units, screen.looseRows]);

  const currency = screen.summary.currency;

  /**
   * Why `raw` may not be this row's budget, or null. The SAME rule the action
   * applies before it writes, run over the rows as they stand on screen with
   * this one put back to what it was last saved at.
   */
  function refusalFor(rowId: string, raw: string): string | null {
    const before = screen.nodes.map((n) =>
      withBudget(n, n.id === rowId ? saved.current[rowId] : typed[n.id])
    );
    const next = raw === '' ? null : Number(raw);
    return checkBudgetEdit(
      before,
      signed,
      rowId,
      next != null && Number.isFinite(next) ? next : null,
      (id) => (id == null ? 'the contract' : (nameOf.get(id) ?? 'this heading')),
      (amount) => formatMoney(amount, currency)
    );
  }

  /** A row's budget as the server last sent it, in the digits the money box speaks. */
  function storedBudget(rowId: string): string {
    const n = screen.nodes.find((x) => x.id === rowId);
    return n && (n.price ?? 0) > 0 ? String(n.price) : '';
  }

  /** Put a row's box back to what it was last saved at. */
  function putBack(rowId: string) {
    setTyped((t) =>
      rowId in saved.current ? { ...t, [rowId]: saved.current[rowId] } : omit(t, rowId)
    );
    setReseed((r) => ({ ...r, [rowId]: (r[rowId] ?? 0) + 1 }));
  }

  function commitPrice(rowId: string, raw: string) {
    setFailed(null);
    const refusal = refusalFor(rowId, raw);
    if (refusal) {
      setRowError({ id: rowId, message: `${refusal} Not saved.` });
      putBack(rowId);
      return;
    }
    setRowError((e) => (e?.id === rowId ? null : e));
    startTransition(async () => {
      const res = await updateRowTextAction(rowId, 'price', raw);
      if (res.ok) {
        saved.current[rowId] = raw;
      } else {
        setRowError({ id: rowId, message: `${res.error} Not saved.` });
        putBack(rowId);
      }
    });
  }

  /** A share typed on the right, turned into money and put in the money box. */
  function typeMoney(rowId: string, raw: string) {
    setTyped((t) => ({ ...t, [rowId]: raw }));
    setReseed((r) => ({ ...r, [rowId]: (r[rowId] ?? 0) + 1 }));
  }

  /**
   * What every heading has to give out and what its rows have claimed, run
   * again on the patched rows so a card's "left" figure moves with the box
   * being typed into. Same function the server called — there is no second
   * opinion about money anywhere in this screen.
   */
  const liveAlloc = useMemo(() => allocationOf(live), [live]);

  /**
   * How far past 100 the weights run right now, and how many headings did
   * it. Same function the server called, over the same patched rows, so the
   * warning moves with the box being typed into instead of quoting a figure
   * the screen has already contradicted.
   */
  const overrun = useMemo(() => overrunOf(live), [live]);

  /** Which card a row lives in, so naming a row is enough to reach it. */
  const unitOfRow = useMemo(() => {
    const out = new Map<string, string>();
    for (const u of screen.units) for (const r of u.rows) out.set(r.id, u.id);
    return out;
  }, [screen.units]);

  /** Every row on the screen by id, for the strip to name what it found. */
  const rowOf = useMemo(() => {
    const out = new Map<string, WeightsRow>();
    for (const u of screen.units) for (const r of u.rows) out.set(r.id, r);
    for (const r of screen.looseRows) out.set(r.id, r);
    return out;
  }, [screen.units, screen.looseRows]);

  /**
   * What to call a row, CARDS INCLUDED.
   *
   * A unit's own row is not among `unit.rows` — it is the card — so two of
   * the headings the strip lists on Gundih (SPK-004 at `1.4`, and SPK-007
   * nested at `1.4.4`) had no entry at all and printed as the word "Row".
   */
  const labelOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, r] of rowOf) out.set(id, `${r.code} ${r.name}`.trim());
    for (const u of screen.units) out.set(u.id, `${u.code} ${u.name}`.trim());
    return out;
  }, [rowOf, screen.units]);

  /** The over-giving headings keyed by row, so a row can carry its own pill. */
  const overOf = useMemo(() => {
    const out = new Map<string, OverGiving>();
    for (const h of overrun.headings) out.set(h.id, h);
    return out;
  }, [overrun]);

  /** How many of them are inside each card, so you know which card to open. */
  const overInUnit = useMemo(() => {
    const out = new Map<string, number>();
    for (const h of overrun.headings) {
      const u = unitOfRow.get(h.id);
      if (u) out.set(u, (out.get(u) ?? 0) + 1);
    }
    return out;
  }, [overrun, unitOfRow]);

  /**
   * Rows the pricing list does not offer, because nothing typed on them can
   * move a figure.
   *
   * Two kinds, and both are how a workbook was WRITTEN rather than work
   * anybody does. A leaf with NO derived weight at all is a total row: its
   * price restates the whole contract (Gundih's `1.5 Finish`) and `isTotalRow`
   * throws it away everywhere, so a box on it would change nothing. A leaf
   * with no BUDGET is different and stays: it weighs 0, which is a real state
   * somebody has to fix, and the strip above lists it.
   *
   * The SINGLE unwrapped root goes for the older reason `buildOverallMap`
   * already unwraps it — it is the project, and the project is the figure at
   * the top of this screen. Two top-level branches are a different plan and
   * are both left alone.
   */
  const hidden = useMemo(() => {
    const out = new Set<string>();
    const roots = screen.looseRows.filter((r) => r.depth === 0);
    if (roots.length === 1 && !roots[0].isLeaf) out.add(roots[0].id);
    for (const r of rowOf.values()) {
      if (r.isLeaf && !live.bobotOf.has(r.id)) out.add(r.id);
    }
    return out;
  }, [screen.looseRows, rowOf, live]);

  /** Row and card codes, for a share to say what it is a share OF. */
  const codeOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, r] of rowOf) out.set(id, r.code || r.name);
    for (const u of screen.units) out.set(u.id, u.code || u.name);
    return out;
  }, [rowOf, screen.units]);

  const looseShown = useMemo(
    () => screen.looseRows.filter((r) => !hidden.has(r.id)),
    [screen.looseRows, hidden]
  );

  /**
   * Open whichever card holds this row, then leave it highlighted.
   *
   * TWO OF GUNDIH'S TWENTY-SIX ARE CARDS, not rows inside one: SPK-004 at
   * `1.4` and SPK-007 nested at `1.4.4` both hand out more than they hold. A
   * card's own row is not among its `rows`, so looking one up by row would
   * have closed every card and landed on nothing.
   */
  function goToRow(rowId: string) {
    const isUnit = screen.units.some((u) => u.id === rowId);
    setOpenUnit(isUnit ? rowId : (unitOfRow.get(rowId) ?? null));
    setFocusRow(rowId);
  }

  /** How many activities a budget reaches now, counting what is only typed. */
  const pricedCount = useMemo(
    () => [...live.bobotOf.keys()].filter((id) => (live.valueOf.get(id) ?? 0) > 0).length,
    [live]
  );
  const leafCount = live.bobotOf.size;

  /** Activities no budget reaches, in plan order, for the strip to name. */
  const unbudgeted = useMemo(
    () =>
      screen.nodes
        .filter((n) => live.bobotOf.has(n.id) && (live.valueOf.get(n.id) ?? 0) <= 0)
        .map((n) => n.id),
    [screen.nodes, live]
  );

  const unit = openUnit ? (screen.units.find((u) => u.id === openUnit) ?? null) : null;

  /** What every list of rows needs, whichever list it is. */
  const listProps = {
    live,
    allocs: liveAlloc,
    overOf,
    focusRow,
    currency: screen.summary.currency,
    signed: signed != null,
    codeOf,
    typed,
    setTyped,
    reseed,
    rowError,
    liveRefusal: (rowId: string) =>
      typed[rowId] === undefined || typed[rowId] === (saved.current[rowId] ?? storedBudget(rowId))
        ? null
        : refusalFor(rowId, typed[rowId]),
    onCommit: commitPrice,
    onTypeMoney: typeMoney,
  };

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
        overrun={overrun}
        labelOf={labelOf}
        onGoToRow={goToRow}
        priced={pricedCount}
        total={leafCount}
        unbudgeted={unbudgeted}
        projectId={projectId}
        onLock={() => setDeriving(true)}
      />

      {unit ? (
        <UnitRows
          unit={unit}
          hidden={hidden}
          alloc={liveAlloc.get(unit.id) ?? null}
          unitTotal={unitTotals.get(unit.id) ?? 0}
          list={listProps}
          onBack={() => setOpenUnit(null)}
        />
      ) : (
        <>
          {!screen.hasUnits && screen.units.length > 0 && (
            <p className="px-1 text-[13px] text-muted-foreground">
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
              overInside={overInUnit.get(u.id) ?? 0}
              value={liveValueOf(u, live)}
              onOpen={() => setOpenUnit(u.id)}
            />
          ))}

          {/* Rows no card holds. On a flat plan this IS the plan, and it is the
              only place a price can be typed. */}
          {looseShown.length > 0 && <LooseHeading hasUnits={screen.units.length > 0} />}

          {looseShown.length > 0 && (
            <RowList rows={looseShown} {...listProps} showBoth={false} />
          )}

          {screen.units.length === 0 && looseShown.length === 0 && (
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
 * **The 100.00% is the one figure here that is not negotiable**, and the screen
 * used to state it as though it could not be anything else. It can: Gundih
 * reads 154.58%, and the strip still printed "Every activity has a price" in
 * green over the top of it, because `done` only ever asked whether the contract
 * had been spent and never asked what the weights came to. One flag was telling
 * two different facts. They are separate now — the WEIGHTS are the must,
 * because a plan whose leaves do not add up to 100 measures every percentage in
 * every report against the wrong total, and the BUDGET is the flexible one,
 * where a gap is usually just a project half set up.
 *
 * **Reported, never corrected.** `deriveWeights` is untouched and every figure
 * stands exactly as it did; what changed is that the screen says so. The two
 * things that actually push Gundih past 100 are in `overrunOf`.
 */
function PricingHero({
  screen,
  live,
  gap,
  overrun,
  labelOf,
  onGoToRow,
  priced,
  total,
  unbudgeted,
  projectId,
  onLock,
}: {
  screen: WeightsScreen;
  live: ReturnType<typeof deriveWeights>;
  /** SIGNED: positive is work with no price yet, negative is past the contract. */
  gap: number;
  overrun: Overrun;
  labelOf: Map<string, string>;
  onGoToRow: (rowId: string) => void;
  priced: number;
  total: number;
  /** Activities no budget reaches, in plan order. */
  unbudgeted: string[];
  projectId: string;
  onLock: () => void;
}) {
  const { summary } = screen;
  const signed = summary.contractValue > 0;
  const currency = summary.currency;
  /** What the prices actually add up to, typed boxes included. */
  const allocated = summary.contractValue - gap;
  const locked = screen.locked;

  /**
   * The total the REPORT is built on, which is not always the derived one.
   *
   * A locked project's stored weights are authoritative and the prices stop
   * pushing them around — that is what the lock IS. Gundih stores 176 leaves
   * closing at exactly 100.000000 while deriving from its prices gives
   * 154.58, and this strip printed the 154.58 under a label reading "Weights
   * total". It was answering a question nobody asked: not what this project
   * weighs, but what recalculating would do to it. Both facts matter and
   * they are told separately now.
   */
  const governing = locked ? summary.storedTotal : live.total;
  const over = governing > 100.5;
  const under = governing < 99.5;
  /** Locked, and the prices no longer reproduce the weights they are locked at. */
  const priceDrift = locked && Math.abs(live.total - 100) > 0.5;
  /** The prices themselves run past the signed figure — a contract question. */
  const overContract = gap < -0.5;
  const shortOfContract = gap > 0.5;
  const settled = !over && !under && !shortOfContract && !priceDrift;

  // The bar stops being a progress bar the moment the claims run past the
  // contract, because full-and-tidy is the one thing it must not look like
  // then. Blue is the contract, red is what was claimed beyond it, and the two
  // are drawn against everything claimed so together they fill the bar exactly.
  const bluePct = !signed
    ? 0
    : over
      ? (100 / governing) * 100
      : Math.min(100, (Math.max(0, allocated) / summary.contractValue) * 100);
  const redPct = over ? Math.max(0, ((governing - 100) / governing) * 100) : 0;

  return (
    <Card className="gap-3 rounded-2xl bg-gradient-to-br from-chart-1/10 to-transparent shadow-sm ring-chart-1/20">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Contract value
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
              {signed ? formatMoney(summary.contractValue, currency) : 'No contract value yet'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Weights total
            </p>
            {/* The numeral carries the verdict, because it is the figure people
                look at and it wore chart-1 blue at 154.58% — the same colour it
                wears when it is right, which made a broken total read as a
                normal one. */}
            <p
              className={cn(
                'mt-0.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl',
                over ? 'text-destructive' : under ? 'text-warn' : 'text-ok'
              )}
            >
              {governing.toFixed(2)}%
            </p>
          </div>
        </div>

        {signed && (
          <>
            {/* Priced against the contract. It fills as prices are typed, which
                is the only moving thing on the screen that says "progress". */}
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-foreground/8">
              <div
                className="animate-bar-grow h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-out-expo"
                style={{ width: `${bluePct}%` }}
              />
              {redPct > 0 && (
                <div
                  className="animate-bar-grow h-full rounded-r-full bg-destructive transition-[width] duration-500 ease-out-expo"
                  style={{ width: `${redPct}%` }}
                />
              )}
            </div>

            {/* A WHOLE BLOCK, not a grey line. Muted content is invisible to
                the people who use this app — it has been reported twice in
                those words, about two different screens — and this is the
                block that decides whether a figure in the report can be
                trusted. */}
            {over ? (
              <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-destructive/8 p-3 ring-1 ring-destructive/25">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-destructive">
                      The weights add up to {governing.toFixed(2)}%, and they have to be 100%
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {overContract ? (
                        <>
                          The prices come to{' '}
                          <strong className="tabular-nums text-foreground">
                            {formatMoney(allocated, currency)}
                          </strong>
                          , which is{' '}
                          <strong className="tabular-nums text-foreground">
                            {formatMoney(-gap, currency)}
                          </strong>{' '}
                          more than the contract value. Raise the contract value, or lower a price.
                        </>
                      ) : (
                        <>
                          {overrun.branches} headings hand out more than they hold,{' '}
                          <strong className="tabular-nums text-foreground">
                            {formatMoney(overrun.amount, currency)}
                          </strong>{' '}
                          over between them. Every one of them is listed below — tap one to go
                          straight to it.
                        </>
                      )}
                    </p>
                  </div>
                  {overContract && (
                    <PressLink
                      {...pressMotion}
                      href={`/projects/${projectId}`}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white"
                    >
                      Open project details
                    </PressLink>
                  )}
                </div>
                <OverList
                  headings={overrun.headings}
                  labelOf={labelOf}
                  currency={currency}
                  onGo={onGoToRow}
                />
              </div>
            ) : under && !locked ? (
              // A REMINDER, NOT AN ALARM. Under 100 is what a plan looks like
              // while its budgets are still going in; the rows that are missing
              // are the whole message, so they are named and one tap away.
              <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warn">
                    {(100 - governing).toFixed(2)}% of the contract has not reached an activity yet
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {unbudgeted.length > 0 ? (
                      <>
                        <strong className="text-foreground">
                          {unbudgeted.length} {unbudgeted.length === 1 ? 'activity has' : 'activities have'}{' '}
                          no budget
                        </strong>
                        , so {unbudgeted.length === 1 ? 'it weighs' : 'they weigh'} nothing in the
                        report. Give each one a budget, or its share of the heading.
                      </>
                    ) : (
                      <>
                        Every activity has a budget, and some headings still hold money their rows
                        have not taken. Their cards say how much is left.
                      </>
                    )}
                    {shortOfContract && (
                      <>
                        {' '}
                        <strong className="tabular-nums text-foreground">
                          {formatMoney(gap, currency)}
                        </strong>{' '}
                        of the contract is not in any SPK or activity yet.
                      </>
                    )}
                  </p>
                </div>
                <RowButtons ids={unbudgeted} labelOf={labelOf} onGo={onGoToRow} />
              </div>
            ) : priceDrift ? (
              // Locked, so the report is safe and this is not an alarm — but
              // the prices and the weights are telling different stories and
              // the person pricing rows is the only one who can see it.
              <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warn">
                    The prices no longer add up to these weights
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    The weights are locked at{' '}
                    <strong className="tabular-nums text-foreground">
                      {governing.toFixed(2)}%
                    </strong>{' '}
                    and the report uses them. Deriving from the prices would give{' '}
                    <strong className="tabular-nums text-foreground">
                      {live.total.toFixed(2)}%
                    </strong>
                    , because {overrun.branches} headings hand out more than they hold,{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(overrun.amount, currency)}
                    </strong>{' '}
                    over between them. Every one of them is listed below — tap one to go straight
                    to it.
                  </p>
                </div>
                <OverList
                  headings={overrun.headings}
                  labelOf={labelOf}
                  currency={currency}
                  onGo={onGoToRow}
                />
              </div>
            ) : shortOfContract && total > 0 && priced >= total ? (
              // Every row is in and the contract is still not spent. The report
              // is not wrong here — the leftover is shared out and the total
              // closes at 100 — so this is a reminder, not an alarm.
              <div className="animate-fade-in-up flex flex-col gap-2 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warn">
                    Every activity has a price, and they do not reach the contract value
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    They come to{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(allocated, currency)}
                    </strong>
                    , leaving{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(gap, currency)}
                    </strong>{' '}
                    that no activity carries. Lower the contract value, or a budget is missing.
                  </p>
                </div>
                <PressLink
                  {...pressMotion}
                  href={`/projects/${projectId}`}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-background px-4 py-2 text-sm font-medium ring-1 ring-foreground/12"
                >
                  Open project details
                </PressLink>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted-foreground">
                {settled ? (
                  <span className="font-medium text-ok">
                    Every activity has a budget. These weights come from the money.
                  </span>
                ) : !shortOfContract ? (
                  // Nothing is open, so "US$0 still open" beside a full bar is a
                  // sentence that answers nothing. What is worth saying instead is
                  // how much of the plan was priced by hand, since the block above
                  // has already said what that did to the weights.
                  <>
                    The contract is fully given out ·{' '}
                    <strong className="tabular-nums text-foreground">
                      {priced} of {total}
                    </strong>{' '}
                    activities have a budget
                  </>
                ) : (
                  <>
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(Math.max(0, allocated), currency)}
                    </strong>{' '}
                    given out,{' '}
                    <strong className="tabular-nums text-foreground">
                      {formatMoney(Math.max(0, gap), currency)}
                    </strong>{' '}
                    still open · {priced} of {total} activities have a budget
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

/**
 * The headings that hand out more than they hold, named and reachable.
 *
 * ALL OF THEM, not a sample. The first version of this warning gave a count and
 * a total and told the reader to "open the cards below that say they are over",
 * and there were none: on Gundih the six worst sit four and five levels down
 * inside three different SPK, while every card on that screen reported money
 * LEFT. Being told 26 things are wrong with no way to reach one of them is the
 * same as being told nothing, and it was reported in exactly those words.
 *
 * Each line says the two figures the fix is made of — what the heading was
 * given, and what its rows took — because the number somebody has to type is
 * the second one, and printing only the difference makes them subtract it back.
 *
 * It POINTS, and it changes nothing. `allocationOf`'s note holds here too:
 * scaling the rows back would move figures nobody asked to move, and a price
 * this app invented would travel into every printed report as though it came
 * off a BOQ.
 */
const OVER_SHOWN = 8;

function OverList({
  headings,
  labelOf,
  currency,
  onGo,
}: {
  headings: OverGiving[];
  labelOf: Map<string, string>;
  currency: string;
  onGo: (rowId: string) => void;
}) {
  // EIGHT, then the rest behind one press. Not a sample — the count is on
  // the button and every one of them is one tap away — but twenty-six rows
  // in an opening strip pushes the work itself off the screen, and the first
  // eight already carry most of the money on the project this was reported
  // against.
  const [all, setAll] = useState(false);
  if (headings.length === 0) return null;
  const shown = all ? headings : headings.slice(0, OVER_SHOWN);
  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((h) => {
        const label = labelOf.get(h.id);
        return (
          <li key={h.id}>
            <m.button
              {...pressMotion}
              onClick={() => onGo(h.id)}
              className="flex w-full min-h-11 flex-col gap-0.5 rounded-lg bg-background/70 px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors duration-300 ease-ios hover:bg-background sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                {label ?? 'This heading'}
              </span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                holds {formatMoney(h.budget, currency)} · rows take{' '}
                {formatMoney(h.claimed, currency)}
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-destructive">
                over by {formatMoney(h.over, currency)}
              </span>
            </m.button>
          </li>
        );
      })}
      {headings.length > OVER_SHOWN && (
        <li>
          <m.button
            {...pressMotion}
            onClick={() => setAll((v) => !v)}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-destructive underline underline-offset-2"
          >
            {all
              ? `Show only the ${OVER_SHOWN} biggest`
              : `Show all ${headings.length} headings`}
          </m.button>
        </li>
      )}
    </ul>
  );
}

/**
 * The activities no budget reaches, named and one press away.
 *
 * A reminder only works if it can be acted on: a count of "5 activities" sends
 * someone opening cards to find them. Same shape as `OverList`, eight first
 * and the rest behind one press, because a long list in the opening strip
 * pushes the work itself off the screen.
 */
function RowButtons({
  ids,
  labelOf,
  onGo,
}: {
  ids: string[];
  labelOf: Map<string, string>;
  onGo: (rowId: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (ids.length === 0) return null;
  const shown = all ? ids : ids.slice(0, OVER_SHOWN);
  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((id) => (
        <li key={id}>
          <m.button
            {...pressMotion}
            onClick={() => onGo(id)}
            className="flex w-full min-h-11 items-center gap-3 rounded-lg bg-background/70 px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors duration-300 ease-ios hover:bg-background"
          >
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
              {labelOf.get(id) ?? 'This activity'}
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-warn">No budget</span>
          </m.button>
        </li>
      ))}
      {ids.length > OVER_SHOWN && (
        <li>
          <m.button
            {...pressMotion}
            onClick={() => setAll((v) => !v)}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-warn underline underline-offset-2"
          >
            {all ? `Show only the first ${OVER_SHOWN}` : `Show all ${ids.length} activities`}
          </m.button>
        </li>
      )}
    </ul>
  );
}

/**
 * What the list at the bottom of the screen actually is.
 *
 * It had no heading of any kind, so it read as a stray third list under the
 * cards — "itu activity dibawah itu apa ya?", asked in those words. These are
 * the rows no card contains: the top of the WBS, and anything outside every
 * SPK. On a flat plan this IS the plan and the only place a price can be typed,
 * which is why it is never hidden.
 */
function LooseHeading({ hasUnits }: { hasUnits: boolean }) {
  return (
    <div className="mt-2 px-1">
      <p className="text-[13px] font-semibold">
        {hasUnits ? 'Outside every SPK' : 'The plan'}
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        {hasUnits
          ? 'Rows that no SPK card above holds.'
          : 'No SPK is marked, so every row is priced here.'}
      </p>
    </div>
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
 * One thing a card says about itself, loud enough to be read.
 *
 * Muted eleven-pixel captions are invisible to the people who use this app —
 * it has been reported in those words, twice, about two different screens — so
 * every statement a heading makes sits in a pill with a dot in front of it, at
 * one size, on one line. The dot is what gives the sentence a colour without
 * printing a second palette: the tones are the app's own ok / warn /
 * destructive / chart-1 and nothing else.
 */
function Pill({
  tone,
  children,
}: {
  tone: 'ok' | 'info' | 'warn' | 'bad' | 'quiet';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'info' && 'bg-chart-1/10 text-chart-1',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-destructive/10 text-destructive',
        tone === 'quiet' && 'bg-foreground/6 text-muted-foreground'
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" aria-hidden />
      {children}
    </span>
  );
}

/**
 * The face of a heading: the same four things, in the same places, on every
 * card and on the header you land on after tapping one.
 *
 * THE CARDS USED TO DISAGREE ABOUT THEIR OWN SHAPE. A bar was drawn only where
 * the heading carried a budget of its own, so a list of five read as two cards
 * with a bar and three without — and the eye has to stop and work out whether
 * that difference is saying something about the money or about the screen. It
 * was saying something about the screen. Reported 14 Sep 2026, in one sentence
 * with the other half of the same complaint: the money sat in the same muted
 * grey, at the same size, as the row count beside it, which is how the one
 * figure a pricing screen exists to show ends up being the figure nobody sees.
 *
 * So every heading draws a bar and it is ALWAYS THE SAME BAR — this heading's
 * share of the contract, which is the number printed right beside it. A bar
 * that means one thing on one card and another thing on the next is not a bar,
 * it is a puzzle. The money is a headline under its own label, the way the
 * contract figure is in the hero above, because those two are the same kind of
 * fact one level apart.
 *
 * What a heading has LEFT to hand out did not get quieter, it moved: it is a
 * coloured pill now, said in words and in full. Over-allocation is still
 * REPORTED and never corrected — `allocationOf` decides, this only draws it.
 */
function UnitFace({
  code,
  name,
  bobot,
  alloc,
  value,
  currency,
  priced,
  total,
  overInside = 0,
  big,
  pressable,
}: {
  code: string;
  name: string;
  /** Share of the contract: the bar and the number beside it, one fact. */
  bobot: number;
  alloc: Allocation | null;
  value: number;
  currency: string;
  priced: number;
  total: number;
  /** Over-giving headings somewhere beneath this one. */
  overInside?: number;
  /** The drilled-in header says it one size louder than a card in a list. */
  big?: boolean;
  pressable?: boolean;
}) {
  const over = alloc != null && alloc.left < -0.5;
  const spare = alloc != null && alloc.left > 0.5;
  // A heading's own budget where it has one, otherwise what its rows add up
  // to. The card used to print `unitContractValue ?? price` and say "No value
  // yet" beside a figure of 69.72%; this is where the missing line lands.
  const money = alloc ? alloc.budget : value;
  const share = Math.max(0, Math.min(100, bobot));

  return (
    <>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-lg bg-chart-1/10 font-semibold tabular-nums text-chart-1',
            big ? 'min-w-9 px-2 py-1 text-sm' : 'min-w-8 px-2 py-1 text-[13px]'
          )}
        >
          {code || '—'}
        </span>
        <p
          className={cn(
            'min-w-0 flex-1 leading-snug font-semibold',
            big ? 'text-base sm:text-lg' : 'text-[15px]'
          )}
        >
          {name}
        </p>
        {pressable && (
          <svg
            className="h-5 w-5 shrink-0 text-foreground/30 transition-transform duration-300 ease-ios group-hover:translate-x-0.5"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7.5 4.5l6 5.5-6 5.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Two figures under two labels, exactly the shape of the hero above.
          The money is a HEADLINE here rather than a caption — it is what the
          whole screen is for, and it was grey. */}
      <div className="mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {alloc ? 'Budget' : money > 0 ? 'From its rows' : 'Budget'}
          </p>
          <p
            className={cn(
              'mt-0.5 truncate font-semibold tabular-nums',
              big ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
              money > 0 ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {money > 0 ? formatMoney(money, currency) : 'No budget yet'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Of contract
          </p>
          <p
            className={cn(
              'mt-0.5 font-semibold tabular-nums text-chart-1',
              big ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
            )}
          >
            {bobot.toFixed(2)}%
          </p>
        </div>
      </div>

      <div
        className={cn(
          'mt-2.5 w-full overflow-hidden rounded-full bg-foreground/8 text-foreground/25',
          big ? 'h-2.5' : 'h-2'
        )}
        style={
          share > 0.005
            ? undefined
            : {
                backgroundImage:
                  'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)',
              }
        }
      >
        <div
          className="animate-bar-grow h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-out-expo"
          style={{ width: `${share}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill tone={total > 0 && priced >= total ? 'ok' : priced > 0 ? 'info' : 'quiet'}>
          {priced} of {total} {total === 1 ? 'activity' : 'activities'} budgeted
        </Pill>
        {overInside > 0 && (
          <Pill tone="bad">
            {overInside} {overInside === 1 ? 'heading' : 'headings'} over inside
          </Pill>
        )}
        {alloc ? (
          over ? (
            <Pill tone="bad">Over by {formatMoney(-alloc.left, currency)}</Pill>
          ) : spare ? (
            <Pill tone="info">{formatMoney(alloc.left, currency)} left to give out</Pill>
          ) : (
            <Pill tone="ok">Fully shared out</Pill>
          )
        ) : money > 0 ? null : (
          <Pill tone="warn">Needs a budget</Pill>
        )}
      </div>
    </>
  );
}

function UnitCard({
  unit,
  currency,
  bobot,
  alloc,
  overInside,
  value,
  onOpen,
}: {
  unit: WeightsUnit;
  currency: string;
  bobot: number;
  alloc: Allocation | null;
  /** Headings INSIDE this card that hand out more than they hold. */
  overInside: number;
  value: number;
  onOpen: () => void;
}) {
  // A card can be perfectly in balance at its own level and still hold three
  // headings four levels down that are not. SPK-003 read "IDR 2 506 816 left
  // for 3 rows" — money to spare — while three of the six worst headings in
  // the project were inside it. The card has to carry what is under it or the
  // list above has nowhere to send anyone.
  const over = (alloc != null && alloc.left < -0.5) || overInside > 0;
  return (
    <m.button
      {...pressMotion}
      onClick={onOpen}
      className={cn(
        'group w-full rounded-2xl p-4 text-left shadow-sm ring-1 transition-colors duration-300 ease-ios',
        over
          ? 'bg-destructive/[0.04] ring-destructive/35 hover:bg-destructive/8'
          : 'bg-card ring-foreground/10 hover:bg-accent/40'
      )}
    >
      <UnitFace
        code={unit.code}
        name={unit.name}
        bobot={bobot}
        alloc={alloc}
        value={value}
        currency={currency}
        priced={unit.budgetedLeaves}
        total={unit.leafCount}
        overInside={overInside}
        pressable
      />
    </m.button>
  );
}

function UnitRows({
  unit,
  hidden,
  alloc,
  unitTotal,
  list,
  onBack,
}: {
  unit: WeightsUnit;
  /** Rows this screen does not offer. See the rule where it is built. */
  hidden: Set<string>;
  alloc: Allocation | null;
  unitTotal: number;
  list: ListProps;
  onBack: () => void;
}) {
  const { live, currency } = list;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <m.button
          {...pressMotion}
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-chart-1 transition-colors duration-300 ease-ios hover:bg-chart-1/10"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M12.5 4.5l-6 5.5 6 5.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to all SPK
        </m.button>
      </div>

      {/* The same three figures the card carried, kept in front of you while
          you spend them. Walking into a heading and losing the budget you are
          dividing is how someone ends up typing until the rows look plausible
          rather than until they add up. */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <UnitFace
          code={unit.code}
          name={unit.name}
          bobot={unitTotal}
          alloc={alloc}
          value={liveValueOf(unit, live)}
          currency={currency}
          priced={unit.budgetedLeaves}
          total={unit.leafCount}
          big
        />
      </div>

      <RowList
        rows={unit.rows.filter((r) => !hidden.has(r.id))}
        {...list}
        showBoth
        rootParent={unit.code || unit.name}
      />

      <p className="px-1 text-[13px] text-muted-foreground">
        Type a row&apos;s budget, or its share of the heading and the budget follows. A row with no
        budget weighs nothing in the report. No row can take more than its heading has left.
      </p>
    </div>
  );
}

/** What every list of rows needs, whichever list it is. */
interface ListProps {
  live: ReturnType<typeof deriveWeights>;
  /** Every pool's budget and what draws on it, live. */
  allocs: Map<string, Allocation>;
  /** Headings here that hand out more than they hold, keyed by row id. */
  overOf: Map<string, OverGiving>;
  /** The row the strip sent someone to. Highlighted and scrolled to. */
  focusRow: string | null;
  currency: string;
  /** Whether a signed contract value exists, which is what a top-level share is a share of. */
  signed: boolean;
  /** Row and card codes, for "of 5.2". */
  codeOf: Map<string, string>;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  reseed: Record<string, number>;
  rowError: { id: string; message: string } | null;
  /** Why the budget being typed on this row would be refused, before it is saved. */
  liveRefusal: (rowId: string) => string | null;
  onCommit: (rowId: string, raw: string) => void;
  onTypeMoney: (rowId: string, raw: string) => void;
}

/**
 * A row with a budget typed over it: money above zero, or none. Either way a
 * stored fraction goes, exactly as `updateRowTextAction` writes it.
 */
function withBudget(n: WeightNode, raw: string | undefined): WeightNode {
  if (raw === undefined) return n;
  const v = raw === '' ? null : Number(raw);
  return {
    ...n,
    price: v != null && Number.isFinite(v) && v > 0 ? v : null,
    workstepFactor: null,
  };
}

/**
 * The rows, their budget boxes, and their share of the heading.
 *
 * Shared between a card's contents and the rows no card holds, because a flat
 * plan needs exactly the same list on its first screen that a nested one gets
 * after a tap. Writing it twice is how the two would drift.
 *
 * **One money box and one share, and they are the same fact.** The box is the
 * budget. The share beside it is that budget over the POOL it is carved out of
 * (`poolOf`): the nearest heading above with a budget of its own, or the
 * contract. Typing the share types the money for you, and the money is what is
 * saved. The earlier version had a % / IDR toggle whose percent was a share of
 * the parent while the figure beside it was a share of the whole SPK, so one
 * row carried two percents that never agreed.
 */
function RowList({
  rows,
  live,
  allocs,
  overOf,
  focusRow,
  currency,
  signed,
  codeOf,
  typed,
  setTyped,
  reseed,
  rowError,
  liveRefusal,
  onCommit,
  onTypeMoney,
  showBoth,
  rootParent,
  lockRoot = false,
}: ListProps & {
  rows: WeightsRow[];
  /** Whether the project figure is a different question from the share (inside an SPK). */
  showBoth: boolean;
  /** What the top rows of this list sit inside: the card that was opened. */
  rootParent?: string;
  /**
   * Draw the top of the WBS as a heading rather than as something to price.
   *
   * Row `1` is the project itself said twice. A price on it is the contract
   * restated on a line, which is exactly the shape `isTotalRow` exists to
   * throw away — Gundih already carries one of those at `1.5 Finish`.
   */
  lockRoot?: boolean;
}) {
  // The screen does not scroll the document — `<main>` does, and inside a
  // drilled-in SPK there is a second scroller in there. `scrollIntoView`
  // walks up to whichever one it finds, which is why the browser is left to
  // do it rather than computing against a container this component would
  // otherwise have to know about.
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusRow) focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusRow]);

  // What each row sits inside, and how many rows sit directly inside each
  // branch. Said in words rather than by indenting, so every card can be the
  // same shape (23 Sep 2026).
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, number>();
  const stack: WeightsRow[] = [];
  for (const r of rows) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= r.depth) stack.pop();
    const up = stack[stack.length - 1];
    if (up) {
      parentOf.set(r.id, up.code || up.name);
      childrenOf.set(up.id, (childrenOf.get(up.id) ?? 0) + 1);
    } else if (rootParent) {
      parentOf.set(r.id, rootParent);
    }
    stack.push(r);
  }

  // The symbol comes OUT of the formatter rather than from a second table of
  // currencies beside it — the same reason `formatMoney` exists at all.
  const symbol =
    [...formatMoney(0, currency)]
      .filter((ch) => !/[0-9]/.test(ch) && ch.trim() !== '' && ch !== '.' && ch !== ',')
      .join('') || currency;

  return (
    <>
      {/* Column captions, and only from `sm` up, because below that the row is
          stacked and there are no columns for them to sit over. */}
      <div className="mt-1 hidden items-center gap-3 px-3.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:flex">
        <span className="flex-1">Activity</span>
        <span className="flex w-[20rem] gap-2">
          <span className="flex-1 text-right">Budget</span>
          <span className="w-24 text-right">Share</span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const value = live.valueOf.get(row.id) ?? 0;
          const own = live.budgetOf.get(row.id) ?? 0;
          const decided = own > 0;
          const pool = poolOf(row.id, live);
          const base = poolAmount(pool, live);
          const share = base > 0 ? (value / base) * 100 : 0;
          const ofProject = live.contractValue > 0 ? (value / live.contractValue) * 100 : 0;
          const canShare = base > 0 && (pool != null || signed);
          const poolName = pool == null ? 'contract' : (codeOf.get(pool) ?? 'its heading');
          const over = overOf.get(row.id);
          const focused = focusRow === row.id;
          const error = rowError?.id === row.id ? rowError.message : liveRefusal(row.id);

          // What this row may take at most: what its pool has left, plus what
          // it already holds there.
          const pooled = allocs.get(pool ?? CONTRACT_POOL);
          const room = pooled ? pooled.left + value : Number.POSITIVE_INFINITY;
          /**
           * A share, as money. WHOLE UNITS CANNOT SPLIT EVERY HEADING EXACTLY:
           * 50% and 50% of 22 505 round to 11 253 each and come to 22 506, one
           * more than the heading holds. Where the only thing over is that
           * rounding, the last unit comes off instead of refusing a share that
           * fits. Anything more than a unit over is left for the cap to refuse.
           */
          const shareToMoney = (raw: string): string | null => {
            if (raw === '') return '';
            const pct = Number(raw);
            if (!Number.isFinite(pct)) return null;
            let money = Math.round((pct / 100) * base);
            if (money > room && money - room < 1) money = Math.floor(room);
            return money > 0 ? String(money) : '';
          };

          const stored = row.budget != null && row.budget > 0 ? String(Math.round(row.budget)) : '';
          const caption = !canShare
            ? 'No contract value yet'
            : [
                !row.isLeaf && !decided && value > 0 ? `Rows take ${formatMoney(value, currency)}` : null,
                `of ${poolName}`,
                showBoth && pool != null ? `${ofProject.toFixed(2)}% of project` : null,
              ]
                .filter(Boolean)
                .join(' · ');

          return (
            <div
              key={row.id}
              // ONE SHAPE FOR EVERY ROW, whatever it is (23 Sep 2026). Every
              // card is full width and carries the same lines at fixed heights,
              // so a branch and a leaf come out the same size. What changes
              // between them is the words, never the box. The one exception is
              // a refusal, which is allowed to add a line: it is the thing on
              // the row that most needs reading.
              ref={focused ? focusRef : undefined}
              className={cn(
                'rounded-xl bg-card px-3.5 py-3 shadow-sm ring-1 transition-colors duration-300 ease-ios',
                decided ? 'ring-chart-1/35' : 'ring-foreground/10',
                (over || error) && 'bg-destructive/[0.04] ring-destructive/40',
                focused && (over ? 'ring-2 ring-destructive' : 'ring-2 ring-chart-1')
              )}
            >
              <div className="sm:flex sm:items-center sm:gap-3">
                <div className="min-w-0 sm:flex-1">
                  <div className="flex h-6 items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold tabular-nums text-muted-foreground">
                      {row.code}
                    </span>
                    {/* What the row is counted INSIDE, in place of the indent
                        that used to say it. */}
                    {parentOf.has(row.id) && (
                      <span className="inline-flex h-6 min-w-0 max-w-[70%] shrink-0 items-center gap-1 rounded-full bg-chart-1/10 px-2 text-[12px] font-semibold text-chart-1">
                        <CornerDownRight className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">Part of {parentOf.get(row.id)}</span>
                      </span>
                    )}
                  </div>
                  {/* Name and its one line, in a block always as tall as a
                      two-line name, so a short name never makes a shorter card. */}
                  <div className="mt-0.5 min-h-[68px]">
                    <p className="line-clamp-2 text-[15px] leading-[22px] font-medium">{row.name}</p>
                    {!row.isLeaf ? (
                      over ? (
                        <p className="mt-1 h-5 truncate text-[12.5px] leading-5 text-muted-foreground">
                          <strong className="tabular-nums text-destructive">
                            Over by {formatMoney(over.over, currency)}
                          </strong>
                          {' · holds '}
                          <strong className="tabular-nums text-foreground">
                            {formatMoney(over.budget, currency)}
                          </strong>
                          {', rows take '}
                          <strong className="tabular-nums text-foreground">
                            {formatMoney(over.claimed, currency)}
                          </strong>
                        </p>
                      ) : (
                        <p className="mt-1 flex h-5 min-w-0 items-center gap-1 text-[12.5px] leading-5 text-muted-foreground">
                          <Sigma className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">
                            {childrenOf.get(row.id)
                              ? `Total of the ${childrenOf.get(row.id)} ${childrenOf.get(row.id) === 1 ? 'row' : 'rows'} inside it`
                              : 'Its figure is the rows beneath it'}
                          </span>
                        </p>
                      )
                    ) : (
                      // The schedule, read only: price decides how much a row
                      // counts, the dates decide WHEN.
                      <p className="mt-1 h-5 truncate text-[12.5px] leading-5 tabular-nums text-muted-foreground">
                        {row.start && row.finish
                          ? `${fmtDay(row.start)} to ${fmtDay(row.finish)}${row.durationDays ? ` · ${row.durationDays}d` : ''}`
                          : 'Not scheduled yet'}
                        {!decided && <span className="font-semibold text-warn"> · no budget</span>}
                      </p>
                    )}
                  </div>
                </div>

                {lockRoot && !row.isLeaf && row.depth === 0 ? (
                  <p className="mt-2 w-full text-right text-[12.5px] text-muted-foreground sm:mt-0 sm:w-[20rem]">
                    The whole project. Its value is the contract above.
                  </p>
                ) : (
                  <div className="mt-2 sm:mt-0 sm:w-[20rem] sm:shrink-0">
                    <div className="flex items-stretch gap-2">
                      <label
                        className={cn(
                          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-background px-3 ring-1 transition-shadow duration-300 ease-ios focus-within:ring-2',
                          error
                            ? 'ring-destructive/60 focus-within:ring-destructive'
                            : 'ring-foreground/12 focus-within:ring-chart-1'
                        )}
                      >
                        <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">
                          {symbol}
                        </span>
                        <MoneyInput
                          defaultValue={typed[row.id] ?? stored}
                          resetKey={reseed[row.id] ?? 0}
                          placeholder="Budget"
                          className="w-full min-w-0 bg-transparent text-right text-sm tabular-nums outline-none placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground"
                          onValueChange={(raw) => setTyped((t) => ({ ...t, [row.id]: raw }))}
                          onCommit={(raw) => onCommit(row.id, raw)}
                        />
                      </label>
                      <ShareBox
                        share={share}
                        disabled={!canShare}
                        onType={(raw) => {
                          const money = shareToMoney(raw);
                          if (money != null) onTypeMoney(row.id, money);
                        }}
                        onDone={(raw) => {
                          const money = shareToMoney(raw);
                          if (money != null) onCommit(row.id, money);
                        }}
                      />
                    </div>
                    {/* The share as a shape, under the box it belongs to. On a
                        0-100 scale, because shares of one heading add up to 100
                        and the bar can say so without a second scale. */}
                    <div className="mt-1.5 flex justify-end">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/8">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-500 ease-out-expo',
                            share > 100.05 ? 'bg-destructive' : 'bg-chart-1'
                          )}
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                    </div>
                    <p className="mt-1 h-5 truncate text-right text-[12px] leading-5 tabular-nums text-muted-foreground">
                      {caption}
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="animate-fade-in-up mt-2 text-[12.5px] font-semibold text-destructive sm:text-right"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The share of the heading, as a box you can type into.
 *
 * Shows the live figure to two places whenever it is not being edited, so
 * typing a budget in the money box moves it. While focused it holds what is
 * being typed, and every keystroke is handed up as a share for the parent to
 * turn into money. Native `<input>`, no Radix: this list runs to hundreds of
 * rows and Radix costs are per mounted instance.
 */
function ShareBox({
  share,
  disabled,
  onType,
  onDone,
}: {
  share: number;
  disabled: boolean;
  onType: (raw: string) => void;
  onDone: (raw: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const touched = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // SELECT ON FOCUS, AFTER the focus render and before the next keystroke.
  // A requestAnimationFrame did it first and lost the race to a fast typist:
  // "6" landed, the frame then selected it, and "0" replaced it, so 60% went
  // in as 0% (found by pressing it, 24 Sep 2026). A layout effect runs in the
  // same task as the focus event, so nothing typed can come in between.
  const [focusTick, setFocusTick] = useState(0);
  useLayoutEffect(() => {
    if (focusTick > 0) input.current?.select();
  }, [focusTick]);
  return (
    <label
      className={cn(
        'flex min-h-11 w-24 shrink-0 items-center gap-1 rounded-lg bg-background px-2.5 ring-1 ring-foreground/12 transition-shadow duration-300 ease-ios focus-within:ring-2 focus-within:ring-chart-1',
        disabled && 'opacity-60'
      )}
    >
      <input
        ref={input}
        type="text"
        inputMode="decimal"
        aria-label="Share of the heading, in percent"
        disabled={disabled}
        value={draft ?? share.toFixed(2)}
        onFocus={() => {
          touched.current = false;
          setDraft(share > 0 ? String(+share.toFixed(2)) : '');
          setFocusTick((t) => t + 1);
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          touched.current = true;
          setDraft(raw);
          onType(raw);
        }}
        onBlur={() => {
          if (touched.current && draft !== null) onDone(draft);
          touched.current = false;
          setDraft(null);
        }}
        className={cn(
          'w-full min-w-0 bg-transparent text-right text-sm font-semibold tabular-nums outline-none',
          share > 0 || draft !== null ? 'text-foreground' : 'text-muted-foreground'
        )}
      />
      <span className="shrink-0 text-[12px] font-semibold text-muted-foreground">%</span>
    </label>
  );
}

/** `2026-03-14` as `14 Mar`. en-GB, like every other date in the app. */
function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
