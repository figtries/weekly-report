'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { m } from 'framer-motion';
import { Pencil, Sigma } from 'lucide-react';

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
  type Allocation,
  type OverGiving,
  type Overrun,
  type WeightNode,
} from '@/lib/weights';
import type { WeightsRow, WeightsScreen, WeightsUnit } from '@/lib/weights-screen';
import { formatMoney, groupAmount } from '@/lib/currency';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Spinner from '@/components/ui/Spinner';
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

  /**
   * The one row whose budget is open. PRESS FIRST, THEN CHANGE (24 Sep 2026):
   * nothing about a budget moves until somebody opens it, and nothing is saved
   * until they press Save. The boxes used to save on blur, so a stray tap and a
   * scroll could rewrite a figure every row beneath it is carved out of.
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  function openEdit(rowId: string) {
    if (editing && editing !== rowId) putBack(editing);
    setRowError(null);
    setEditing(rowId);
  }

  function cancelEdit(rowId: string) {
    putBack(rowId);
    setRowError((e) => (e?.id === rowId ? null : e));
    setEditing((e) => (e === rowId ? null : e));
  }

  async function saveEdit(rowId: string) {
    const raw = typed[rowId];
    // Opened and closed without a change: nothing to write.
    if (raw === undefined || raw === (saved.current[rowId] ?? storedBudget(rowId))) {
      cancelEdit(rowId);
      return;
    }
    setFailed(null);
    const refusal = refusalFor(rowId, raw);
    if (refusal) {
      setRowError({ id: rowId, message: refusal });
      return;
    }
    setSaving(rowId);
    const res = await updateRowTextAction(rowId, 'price', raw);
    setSaving(null);
    if (!res.ok) {
      setRowError({ id: rowId, message: res.error });
      return;
    }
    saved.current[rowId] = raw;
    setRowError((e) => (e?.id === rowId ? null : e));
    setEditing((e) => (e === rowId ? null : e));
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

  /** What a card calls its own figure: an SPK's budget, or a top-level heading's. */
  const budgetLabel = screen.hasUnits ? 'Work package budget' : 'Budget';

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
    storedBudget,
    editing,
    saving,
    onEdit: openEdit,
    onCancel: cancelEdit,
    onSave: (rowId: string) => void saveEdit(rowId),
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
          label={budgetLabel}
          hidden={hidden}
          alloc={liveAlloc.get(unit.id) ?? null}
          list={listProps}
          onBack={() => setOpenUnit(null)}
        />
      ) : (
        <>
          {!screen.hasUnits && screen.units.length > 0 && (
            <p className="px-1 text-[13px] text-muted-foreground">
              No work package marked yet, so the top level of the WBS stands in. Mark one in the
              planner to give it its own section in the report.
            </p>
          )}

          {screen.units.map((u) => (
            <UnitCard
              key={u.id}
              unit={u}
              label={budgetLabel}
              live={live}
              currency={screen.summary.currency}
              alloc={liveAlloc.get(u.id) ?? null}
              overInside={overInUnit.get(u.id) ?? 0}
              onOpen={() => setOpenUnit(u.id)}
            />
          ))}

          {/* Rows no card holds. On a flat plan this IS the plan, and it is the
              only place a price can be typed. */}
          {looseShown.length > 0 && <LooseHeading hasUnits={screen.units.length > 0} />}

          {looseShown.length > 0 && (
            <RowList rows={looseShown} {...listProps} />
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
 * The project's budget, what reached the activities, and how it compares with
 * the contract.
 *
 * **The project budget IS its work packages added up** (24 Sep 2026). Raising
 * a package raises the project; nothing at this level refuses. The contract
 * value typed on the project is what that total is compared with, and when the
 * packages run past it the strip says by how much and sends you to Project
 * details to change it, because a budget that really grew has to be changed
 * where the project keeps it, by somebody deciding to.
 *
 * **Weights total is the one figure that must reach 100**: a leaf's weight is
 * its budget over the project budget, so anything short of 100 is budget still
 * sitting in a heading that has not handed it to its activities. Under 100 is a
 * reminder, and over 100 (inherited data only, since new edits are refused
 * past a heading) is red with every heading that caused it listed.
 */
function PricingHero({
  screen,
  live,
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
  const currency = screen.summary.currency;
  const locked = screen.locked;
  const budget = live.projectBudget;
  const contract = live.signedContract;

  // A locked project's stored weights are what its report uses, so its total
  // is the stored one; the derived one is told separately as drift.
  const governing = locked ? screen.summary.storedTotal : live.total;
  const over = governing > 100.5;
  const under = budget > 0 && governing < 99.5;
  const priceDrift = locked && Math.abs(live.total - 100) > 0.5;

  const diff = contract > 0 ? budget - contract : 0;
  const pastContract = diff > 0.5;
  const shortOfContract = diff < -0.5;

  return (
    <Card className="gap-3 rounded-2xl bg-gradient-to-br from-chart-1/10 to-transparent shadow-sm ring-chart-1/20">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Project budget
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
              {budget > 0 ? formatMoney(budget, currency) : 'No budget yet'}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {screen.hasUnits ? 'The work packages added up' : 'The headings added up'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Weights total
            </p>
            <p
              className={cn(
                'mt-0.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl',
                over ? 'text-destructive' : under ? 'text-warn' : budget > 0 ? 'text-ok' : 'text-muted-foreground'
              )}
            >
              {governing.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* How much of the budget has reached an activity: the weights total
            as a length, one colour, full when every budget is handed down. */}
        <div className="h-3 w-full overflow-hidden rounded-full bg-foreground/8">
          <div
            className="animate-bar-grow h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-out-expo"
            style={{ width: `${Math.max(0, Math.min(100, governing))}%` }}
          />
        </div>

        {/* THE CONTRACT, compared, never capping. Past it is the one case with
            somewhere to send you: a budget that really grew is changed on the
            project, by somebody deciding to. */}
        {contract > 0 &&
          (pastContract ? (
            <div className="animate-fade-in-up flex flex-col gap-2 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-warn">
                  The budget is {formatMoney(diff, currency)} over the contract value
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  The {screen.hasUnits ? 'work packages' : 'headings'} add up to{' '}
                  <strong className="tabular-nums text-foreground">{formatMoney(budget, currency)}</strong>
                  ; the contract value is{' '}
                  <strong className="tabular-nums text-foreground">{formatMoney(contract, currency)}</strong>. If
                  the budget really changed, update the contract value on the project.
                </p>
              </div>
              <PressLink
                {...pressMotion}
                href={`/projects/${projectId}`}
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-background px-4 py-2 text-sm font-medium ring-1 ring-foreground/12"
              >
                Update the contract value
              </PressLink>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contract value{' '}
              <strong className="tabular-nums text-foreground">{formatMoney(contract, currency)}</strong>
              {' · '}
              {shortOfContract ? (
                <span className="font-semibold text-warn">
                  {formatMoney(-diff, currency)} not in any {screen.hasUnits ? 'work package' : 'heading'} yet
                </span>
              ) : (
                <span className="font-semibold text-ok">matches the budget</span>
              )}
            </p>
          ))}

        {over ? (
          <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-destructive/8 p-3 ring-1 ring-destructive/25">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-destructive">
                The weights add up to {governing.toFixed(2)}%, and they have to be 100%
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {overrun.branches} headings hand out more than they hold,{' '}
                <strong className="tabular-nums text-foreground">
                  {formatMoney(overrun.amount, currency)}
                </strong>{' '}
                over between them. Every one of them is listed below — tap one to go straight to it.
              </p>
            </div>
            <OverList headings={overrun.headings} labelOf={labelOf} currency={currency} onGo={onGoToRow} />
          </div>
        ) : priceDrift ? (
          // Locked, so the report is safe and this is not an alarm — but the
          // prices and the weights are telling different stories.
          <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warn">The budgets no longer add up to these weights</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The weights are locked at{' '}
                <strong className="tabular-nums text-foreground">{governing.toFixed(2)}%</strong> and the report
                uses them. Deriving from the budgets would give{' '}
                <strong className="tabular-nums text-foreground">{live.total.toFixed(2)}%</strong>.
              </p>
            </div>
            <OverList headings={overrun.headings} labelOf={labelOf} currency={currency} onGo={onGoToRow} />
          </div>
        ) : null}

        {/* A REMINDER, NOT AN ALARM. The activities with no budget are the whole
            message, so they are named and one tap away. */}
        {unbudgeted.length > 0 && (
          <div className="animate-fade-in-up flex flex-col gap-3 rounded-xl bg-warn-soft p-3 ring-1 ring-warn/25">
            <p className="text-sm text-muted-foreground">
              <strong className="text-warn">
                {unbudgeted.length} {unbudgeted.length === 1 ? 'activity has' : 'activities have'} no budget
              </strong>
              , so {unbudgeted.length === 1 ? 'it weighs' : 'they weigh'} nothing in the report. Give each one a
              budget, or its share of the heading.
            </p>
            <RowButtons ids={unbudgeted} labelOf={labelOf} onGo={onGoToRow} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-muted-foreground">
            <strong className="tabular-nums text-foreground">
              {priced} of {total}
            </strong>{' '}
            activities have a budget
            {under && (
              <>
                {' · '}
                <span className="font-semibold text-warn">
                  {(100 - governing).toFixed(2)}% still in headings, not yet handed to activities
                </span>
              </>
            )}
          </p>

          {/* The LOCK. Recalculating needs no button: an unlocked project's
              weights follow its budgets on every edit. What needs one is
              DECLARING them authoritative. */}
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
        {hasUnits ? 'Outside every work package' : 'The plan'}
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
        {hasUnits
          ? 'Rows that no work package above holds.'
          : 'No work package is marked, so every row is budgeted here.'}
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
 * The face of a heading, on the list and on the header you land on after
 * tapping one: the same zones, in the same places, every time.
 *
 * **Its budget is the headline, and on the header it is the box you type
 * in** (24 Sep 2026). A heading's budget is what every row beneath it is carved
 * out of, so it is the one figure this screen is organised around. It used to
 * sit read-only, labelled "From its rows", with no way on this screen to set
 * it; the question it drew was "where is the budget of the work itself?".
 *
 * ONE BAR, ONE MEANING: how much of this heading's budget its rows have taken.
 * Drawn on every card; hatched where there is no budget to take from, because
 * a bar missing from some cards reads as a defect. The share of the contract
 * is a number beside the name, never a second length. Severity goes on pills
 * and the card ground, never on the bar's colour.
 */
function UnitFace({
  code,
  name,
  label,
  value,
  budget,
  alloc,
  contract,
  currency,
  priced,
  total,
  overInside = 0,
  pressable,
  editor,
}: {
  code: string;
  name: string;
  /** "SPK budget" where SPK are marked, "Budget" where the WBS roots stand in. */
  label: string;
  /** What the heading is worth: its own budget, or its rows added up. */
  value: number;
  /** Its own budget, 0 where it has none. */
  budget: number;
  alloc: Allocation | null;
  contract: number;
  currency: string;
  priced: number;
  total: number;
  /** Over-giving headings somewhere beneath this one. */
  overInside?: number;
  pressable?: boolean;
  /** The budget box, on the header you type into. The list shows the figure. */
  editor?: React.ReactNode;
}) {
  const hasBudget = budget > 0;
  // A HEADING WITHOUT A BUDGET OF ITS OWN IS STILL WORTH ITS ROWS, and that
  // figure is its budget until somebody types one. Showing an empty box above
  // five priced rows read as "the work package's budget has gone" (24 Sep
  // 2026): nothing had been deleted, the headline had simply stopped saying
  // what the rows add up to, which the card before this one always did.
  const fromRows = !hasBudget && value > 0;
  const shown = hasBudget ? budget : value;
  const given = alloc ? alloc.claimed : value;
  const left = alloc ? alloc.left : null;
  const over = left != null && left < -0.5;
  const taken = shown > 0 ? Math.max(0, Math.min(100, (given / shown) * 100)) : 0;
  const ofContract = contract > 0 ? (value / contract) * 100 : 0;
  const empty = Math.max(0, total - priced);

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-7 min-w-8 shrink-0 items-center justify-center rounded-lg bg-chart-1/10 px-2 text-[13px] font-semibold tabular-nums text-chart-1">
          {code || '—'}
        </span>
        <p className="min-w-0 flex-1 pt-0.5 text-[15px] leading-snug font-semibold">{name}</p>
        <div className="shrink-0 text-right">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Of project
          </p>
          <p className="text-lg leading-tight font-semibold tabular-nums text-chart-1">
            {ofContract.toFixed(2)}%
          </p>
        </div>
        {pressable && (
          <svg
            className="mt-1 h-5 w-5 shrink-0 text-foreground/30 transition-transform duration-300 ease-ios group-hover:translate-x-0.5"
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

      <div className="mt-3.5 flex items-center gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {fromRows && <Pill tone="quiet">From its rows</Pill>}
      </div>
      {editor ?? (
        <p
          className={cn(
            'mt-1 truncate text-2xl font-semibold tabular-nums',
            shown > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {shown > 0 ? formatMoney(shown, currency) : 'No budget yet'}
        </p>
      )}

      <div
        className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-foreground/8 text-foreground/25"
        style={
          shown > 0
            ? undefined
            : { backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 6px)' }
        }
      >
        <div
          className="animate-bar-grow h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-out-expo"
          style={{ width: `${taken}%` }}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* SHORT OR OVER, as a figure against the budget it is measured by.
            "Left" read as money to spare; what it is, is budget the rows have
            not been given yet. Taken from the rows, the headline already IS
            what they hold, so there is nothing to compare. */}
        {hasBudget && <Pill tone="info">Rows hold {formatMoney(given, currency)}</Pill>}
        {hasBudget &&
          (over ? (
            <Pill tone="bad">Over by {formatMoney(-(left ?? 0), currency)}</Pill>
          ) : (left ?? 0) > 0.5 ? (
            <Pill tone="warn">Short by {formatMoney(left ?? 0, currency)}</Pill>
          ) : (
            <Pill tone="ok">Balanced</Pill>
          ))}
        {empty > 0 ? (
          <Pill tone="warn">
            {empty} {empty === 1 ? 'activity' : 'activities'} without a budget
          </Pill>
        ) : (
          total > 0 && <Pill tone="ok">Every activity has a budget</Pill>
        )}
        {overInside > 0 && (
          <Pill tone="bad">
            {overInside} {overInside === 1 ? 'heading' : 'headings'} over inside
          </Pill>
        )}
      </div>
    </>
  );
}

function UnitCard({
  unit,
  label,
  live,
  currency,
  alloc,
  overInside,
  onOpen,
}: {
  unit: WeightsUnit;
  label: string;
  live: ReturnType<typeof deriveWeights>;
  currency: string;
  alloc: Allocation | null;
  /** Headings INSIDE this card that hand out more than they hold. */
  overInside: number;
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
        label={label}
        value={live.valueOf.get(unit.id) ?? 0}
        budget={live.budgetOf.get(unit.id) ?? 0}
        alloc={alloc}
        contract={live.projectBudget}
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
  label,
  hidden,
  alloc,
  list,
  onBack,
}: {
  unit: WeightsUnit;
  label: string;
  /** Rows this screen does not offer. See the rule where it is built. */
  hidden: Set<string>;
  alloc: Allocation | null;
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
          Back to all work packages
        </m.button>
      </div>

      {/* The budget being divided stays in front of you while you divide it,
          and it is typed right here: walking into a heading and losing the
          figure you are spending is how rows get typed until they look
          plausible rather than until they add up. */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/10">
        <UnitFace
          code={unit.code}
          name={unit.name}
          label={label}
          value={live.valueOf.get(unit.id) ?? 0}
          budget={live.budgetOf.get(unit.id) ?? 0}
          alloc={alloc}
          contract={live.projectBudget}
          currency={currency}
          priced={unit.budgetedLeaves}
          total={unit.leafCount}
          editor={<BudgetHeader unitId={unit.id} name={`${unit.code} ${unit.name}`.trim()} list={list} />}
        />
      </div>

      <RowList rows={unit.rows.filter((r) => !hidden.has(r.id))} {...list} />

      <p className="px-1 text-[13px] text-muted-foreground">
        Press a row to change its budget, or its share and the budget follows. A row with no
        budget weighs nothing in the report, and no row can take more than its heading has left.
      </p>
    </div>
  );
}

/**
 * A heading's budget on its header: shown, and changed only on purpose.
 *
 * PRESS FIRST, THEN CHANGE (24 Sep 2026). The box used to be live, so a stray
 * tap and a few digits rewrote the budget every row beneath it is carved out
 * of. Now the figure is read-only and "Change budget" opens a dialog that says
 * what the new figure does before anything is saved: what its rows hold and
 * whether it would be short or over, what the project budget becomes, and
 * whether that passes the contract value.
 */
function BudgetHeader({
  unitId,
  name,
  list,
}: {
  unitId: string;
  name: string;
  list: ListProps;
}) {
  const { live, currency, typed, setTyped, reseed, editing, saving, rowError, liveRefusal, onEdit, onCancel, onSave, storedBudget, allocs } =
    list;
  const open = editing === unitId;
  const own = live.budgetOf.get(unitId) ?? 0;
  const value = live.valueOf.get(unitId) ?? 0;
  const shown = own > 0 ? own : value;

  // The figures as they stood when the dialog opened, so the dialog can say
  // what changes as someone types.
  const [before, setBefore] = useState<{ project: number; value: number } | null>(null);
  const start = () => {
    setBefore({ project: live.projectBudget, value });
    onEdit(unitId);
  };

  const stored = storedBudget(unitId);
  const seed = (typed[unitId] ?? stored) || (value > 0 ? String(Math.round(value)) : '');
  const pooled = allocs.get(unitId);
  const rowsHold = pooled ? pooled.claimed : value;
  const left = pooled ? pooled.left : 0;
  const error = rowError?.id === unitId ? rowError.message : liveRefusal(unitId);
  const contract = live.signedContract;
  const projectNow = live.projectBudget;
  const pastContract = contract > 0 ? projectNow - contract : 0;

  return (
    <>
      {/* The button wraps under the figure rather than cutting it: at 390px
          'IDR 400 000 000' beside 'Change budget' came out 'IDR 400 000...'. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          className={cn(
            'shrink-0 text-2xl font-semibold whitespace-nowrap tabular-nums',
            shown > 0 ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {shown > 0 ? formatMoney(shown, currency) : 'No budget yet'}
        </p>
        <m.button
          {...pressMotion}
          onClick={start}
          className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-background px-3.5 text-sm font-semibold text-chart-1 ring-1 ring-chart-1/30 transition-colors duration-300 ease-ios hover:bg-chart-1/8"
        >
          <Pencil className="size-4" aria-hidden />
          {shown > 0 ? 'Change budget' : 'Set a budget'}
        </m.button>
      </div>

      <ConfirmDialog
        open={open}
        title={`Budget of ${name}`}
        confirmLabel="Save budget"
        busyLabel="Saving…"
        busy={saving === unitId}
        destructive={false}
        onConfirm={() => onSave(unitId)}
        onCancel={() => onCancel(unitId)}
        message={
          <div
            className="mt-2 flex flex-col gap-3"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(unitId);
            }}
          >
            <label
              className={cn(
                'flex h-12 items-center gap-2.5 rounded-xl bg-background px-3.5 ring-[1.5px] focus-within:ring-2',
                error ? 'ring-destructive/60 focus-within:ring-destructive' : 'ring-chart-1/30 focus-within:ring-chart-1'
              )}
            >
              <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">{symbolOf(currency)}</span>
              <MoneyInput
                autoFocus
                defaultValue={seed}
                resetKey={reseed[unitId] ?? 0}
                placeholder="Set a budget"
                className="w-full min-w-0 bg-transparent text-xl font-semibold text-foreground tabular-nums outline-none placeholder:text-base placeholder:font-medium placeholder:text-muted-foreground"
                onValueChange={(raw) => setTyped((t) => ({ ...t, [unitId]: raw }))}
              />
            </label>

            {error ? (
              <p role="alert" className="text-[13px] font-semibold text-destructive">
                {error}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                <li className="flex justify-between gap-3">
                  <span>Its rows hold</span>
                  <strong className="tabular-nums text-foreground">{formatMoney(rowsHold, currency)}</strong>
                </li>
                <li className="flex justify-between gap-3">
                  <span>Against this budget</span>
                  <strong
                    className={cn(
                      'tabular-nums',
                      left > 0.5 ? 'text-warn' : left < -0.5 ? 'text-destructive' : 'text-ok'
                    )}
                  >
                    {left > 0.5
                      ? `Short by ${formatMoney(left, currency)}`
                      : left < -0.5
                        ? `Over by ${formatMoney(-left, currency)}`
                        : 'Balanced'}
                  </strong>
                </li>
                <li className="flex flex-col gap-0.5">
                  <span>Project budget</span>
                  <strong className="tabular-nums text-foreground">
                    {before && Math.abs(before.project - projectNow) > 0.5
                      ? `${formatMoney(before.project, currency)} → ${formatMoney(projectNow, currency)}`
                      : formatMoney(projectNow, currency)}
                  </strong>
                </li>
                {pastContract > 0.5 && (
                  <li className="rounded-lg bg-warn-soft px-2.5 py-2 font-medium text-warn">
                    {formatMoney(pastContract, currency)} over the contract value ({formatMoney(contract, currency)}).
                    If the budget really changed, update the contract value on the project after saving.
                  </li>
                )}
              </ul>
            )}
          </div>
        }
      />
    </>
  );
}

/**
 * The currency's symbol, OUT of the formatter rather than from a second table
 * of currencies beside it — the same reason `formatMoney` exists at all.
 */
function symbolOf(currency: string): string {
  return (
    [...formatMoney(0, currency)]
      .filter((ch) => !/[0-9]/.test(ch) && ch.trim() !== '' && ch !== '.' && ch !== ',')
      .join('') || currency
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
  /** A row's budget as the server last sent it. */
  storedBudget: (rowId: string) => string;
  /** The row whose budget is open, and the one being saved. */
  editing: string | null;
  saving: string | null;
  onEdit: (rowId: string) => void;
  onCancel: (rowId: string) => void;
  onSave: (rowId: string) => void;
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
 * The rows, as one ledger: a single card, one line per row, the money and its
 * share in one joined control at the right.
 *
 * Shared between a card's contents and the rows no card holds, because a flat
 * plan needs exactly the same list on its first screen that a nested one gets
 * after a tap. Writing it twice is how the two would drift.
 *
 * **One control, two readings of the same fact** (chosen from three rendered
 * variants, 24 Sep 2026). The left half is the budget; the right half is that
 * budget over the POOL it is carved out of (`poolOf`), and typing there types
 * the money. They were two separate boxes with a caption under them, and the
 * caption ("of 5 · 2.00% of project") was the part called ugly: it said the
 * pool twice and a project share nobody was deciding here. The pool is now a
 * two-word label beside the one bar, and the project share lives on the card.
 *
 * Nesting is said by a small indent on the NAME only. The controls stay in one
 * column, so the list does not become the staircase of card widths that made
 * the 23 Sep version drop indentation altogether.
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
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  onTypeMoney,
  lockRoot = false,
}: ListProps & {
  rows: WeightsRow[];
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
  // walks up to whichever one it finds.
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusRow) focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusRow]);

  // How many rows sit directly inside each branch, for its caption.
  const childrenOf = new Map<string, number>();
  const stack: WeightsRow[] = [];
  for (const r of rows) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= r.depth) stack.pop();
    const up = stack[stack.length - 1];
    if (up) childrenOf.set(up.id, (childrenOf.get(up.id) ?? 0) + 1);
    stack.push(r);
  }

  const symbol = symbolOf(currency);

  return (
    <>
      <div className="mt-1 hidden items-center gap-4 px-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase sm:grid sm:grid-cols-[minmax(0,1fr)_15rem]">
        <span>Activity</span>
        <span className="flex">
          <span className="flex-1 text-right">Budget</span>
          <span className="w-[5.5rem] text-right">Weight</span>
        </span>
      </div>

      <div className="divide-y divide-foreground/[0.07] overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10">
        {rows.map((row) => {
          const value = live.valueOf.get(row.id) ?? 0;
          const own = live.budgetOf.get(row.id) ?? 0;
          const decided = own > 0;
          const pool = poolOf(row.id, live);
          const base = poolAmount(pool, live);
          const share = base > 0 ? (value / base) * 100 : 0;
          const canShare = base > 0 && (pool != null || signed);
          const poolName = pool == null ? 'contract' : (codeOf.get(pool) ?? 'its heading');
          const over = overOf.get(row.id);
          const focused = focusRow === row.id;
          const error = rowError?.id === row.id ? rowError.message : liveRefusal(row.id);
          const isEditing = editing === row.id;
          const branchAlloc = !row.isLeaf && decided ? allocs.get(row.id) : undefined;

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
          const inside = childrenOf.get(row.id) ?? 0;

          return (
            <div
              key={row.id}
              ref={focused ? focusRef : undefined}
              className={cn(
                'px-4 py-3 transition-colors duration-300 ease-ios',
                (over || error) && 'bg-destructive/[0.04]',
                focused && !over && !error && 'bg-chart-1/[0.06]'
              )}
            >
              <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-4">
                <div className="min-w-0" style={{ paddingLeft: `${Math.min(row.depth, 3) * 14}px` }}>
                  <p className="text-[12px] font-semibold tabular-nums text-muted-foreground">
                    {row.code}
                  </p>
                  <p className="line-clamp-2 text-[14.5px] leading-[21px] font-medium">{row.name}</p>
                  {!row.isLeaf ? (
                    over ? (
                      <p className="mt-0.5 truncate text-[12px] leading-5 text-muted-foreground">
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
                      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] leading-5 text-muted-foreground">
                        <Sigma className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {inside
                            ? `${inside} ${inside === 1 ? 'row' : 'rows'} inside`
                            : 'Its figure is the rows beneath it'}
                          {!decided && ` · rows take ${formatMoney(value, currency)}`}
                          {branchAlloc &&
                            (branchAlloc.left > 0.5
                              ? ` · short by ${formatMoney(branchAlloc.left, currency)}`
                              : ' · balanced')}
                        </span>
                      </p>
                    )
                  ) : (
                    // The schedule, read only: the budget decides how much a
                    // row counts, the dates decide WHEN.
                    <p className="mt-0.5 truncate text-[12px] leading-5 tabular-nums text-muted-foreground">
                      {row.start && row.finish
                        ? `${fmtDay(row.start)} to ${fmtDay(row.finish)}${row.durationDays ? ` · ${row.durationDays}d` : ''}`
                        : 'Not scheduled yet'}
                      {!decided && <span className="font-semibold text-warn"> · no budget</span>}
                    </p>
                  )}
                </div>

                {lockRoot && !row.isLeaf && row.depth === 0 ? (
                  <p className="mt-2 text-right text-[12.5px] text-muted-foreground sm:mt-0">
                    The whole project. Its value is the contract above.
                  </p>
                ) : (
                  <div className="mt-2.5 sm:mt-0">
                    {isEditing ? (
                      <div
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onSave(row.id);
                          }
                          if (e.key === 'Escape') onCancel(row.id);
                        }}
                      >
                        <div
                          className={cn(
                            'flex h-10 overflow-hidden rounded-[10px] bg-background ring-2',
                            error ? 'ring-destructive/60' : 'ring-chart-1'
                          )}
                        >
                          <label className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                              {symbol}
                            </span>
                            <MoneyInput
                              autoFocus
                              defaultValue={typed[row.id] ?? stored}
                              resetKey={reseed[row.id] ?? 0}
                              placeholder="Budget"
                              className="w-full min-w-0 bg-transparent text-right text-sm tabular-nums outline-none placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground"
                              onValueChange={(raw) => setTyped((t) => ({ ...t, [row.id]: raw }))}
                            />
                          </label>
                          <ShareBox
                            share={share}
                            disabled={!canShare}
                            onType={(raw) => {
                              const money = shareToMoney(raw);
                              if (money != null) onTypeMoney(row.id, money);
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      // LOCKED UNTIL PRESSED. The figures are shown in the same
                      // joined shape, so nothing moves when a row opens; only a
                      // press makes them editable.
                      <m.button
                        {...pressMotion}
                        type="button"
                        onClick={() => onEdit(row.id)}
                        aria-label={`Change the budget of ${row.code} ${row.name}`}
                        className="group/ctl flex h-10 w-full overflow-hidden rounded-[10px] bg-background text-left ring-1 ring-foreground/15 transition-shadow duration-300 ease-ios hover:ring-chart-1/50"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                            {symbol}
                          </span>
                          <span
                            className={cn(
                              'ml-auto truncate tabular-nums',
                              decided ? 'text-sm text-foreground' : 'text-xs text-muted-foreground'
                            )}
                          >
                            {decided ? groupAmount(String(Math.round(own))) : 'Add budget'}
                          </span>
                          <Pencil
                            className="size-3.5 shrink-0 text-muted-foreground transition-colors duration-300 ease-ios group-hover/ctl:text-chart-1"
                            aria-hidden
                          />
                        </span>
                        <span
                          className={cn(
                            'flex w-[5.5rem] shrink-0 items-center justify-end border-l px-2.5 text-sm font-semibold tabular-nums',
                            share > 0
                              ? 'border-chart-1/15 bg-chart-1/[0.08] text-primary'
                              : 'border-foreground/8 bg-foreground/[0.03] text-muted-foreground'
                          )}
                        >
                          {share.toFixed(2)}%
                        </span>
                      </m.button>
                    )}
                    {/* The share as a length, under the control it belongs to.
                        One colour whatever the figure: severity is said on the
                        row's ground and in words, never by recolouring a scale. */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-foreground/8">
                        <div
                          className="h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-out-expo"
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">
                        {canShare ? `of ${poolName}` : 'no budget above'}
                      </span>
                    </div>
                    {/* Two halves of the box's own width, so both outer edges
                        line up with it. They used to sit loose at the right, a
                        44px Save beside a 40px box with no edge in common. */}
                    {isEditing && (
                      <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <m.button
                          {...pressMotion}
                          type="button"
                          onClick={() => onCancel(row.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-background text-sm font-medium text-muted-foreground ring-1 ring-foreground/15 transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground"
                        >
                          Cancel
                        </m.button>
                        <m.button
                          {...pressMotion}
                          type="button"
                          onClick={() => onSave(row.id)}
                          disabled={saving === row.id}
                          className="btn-primary inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] text-sm font-medium disabled:opacity-60"
                        >
                          {saving === row.id && <Spinner />}
                          {saving === row.id ? 'Saving…' : 'Save'}
                        </m.button>
                      </div>
                    )}
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
 * The share half of a row's control: typed, it becomes money.
 *
 * Shows the live figure to two places whenever it is not being edited, so
 * typing a budget in the money half moves it. While focused it holds what is
 * being typed, and every keystroke is handed up for the parent to turn into
 * money. Native `<input>`, no Radix: this list runs to hundreds of rows and
 * Radix costs are per mounted instance.
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
  /** Called on blur with what was typed. Unused where Save does the saving. */
  onDone?: (raw: string) => void;
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
  const lit = share > 0 || draft !== null;
  return (
    <label
      className={cn(
        'flex w-[5.5rem] shrink-0 items-center justify-end gap-0.5 border-l px-2.5 transition-colors duration-300 ease-ios',
        lit ? 'border-chart-1/15 bg-chart-1/[0.08]' : 'border-foreground/8 bg-foreground/[0.03]',
        disabled && 'opacity-60'
      )}
    >
      <input
        ref={input}
        type="text"
        inputMode="decimal"
        aria-label="Weight, in percent"
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
          if (touched.current && draft !== null) onDone?.(draft);
          touched.current = false;
          setDraft(null);
        }}
        className={cn(
          'w-full min-w-0 bg-transparent text-right text-sm font-semibold tabular-nums outline-none',
          lit ? 'text-primary' : 'text-muted-foreground'
        )}
      />
      <span className={cn('shrink-0 text-sm font-semibold', lit ? 'text-primary' : 'text-muted-foreground')}>
        %
      </span>
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
