'use client';

import { Suspense, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import {
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  Diamond,
  Link2,
  MoveDown,
  MoveUp,
  Plus,
  Shapes,
  Tag,
  Trash2,
} from 'lucide-react';

import type { Sheet, SheetRow } from '@/lib/sheet';
import type { Network } from '@/lib/chains';
import type { BarFact } from '@/lib/bar-facts';
import type { BarView } from '@/lib/bar-view';
import { KIND_LABEL, paintCss } from '@/lib/bar-view';
import { ReadyKindView, warmKindView } from './links-panel-loader';

// Lazy: the planner's first load does not carry the Links panel. ScheduleSheet
// warms the chunk when the page goes idle, so neither opening this menu nor
// pressing Links waits for it.
const LinksPanel = dynamic(() => import('./LinksPanel'), { ssr: false });
import { loadedLinksPanel } from './links-panel-loader';
import {
  predictDelete,
  predictFlags,
  predictIndent,
  predictMove,
  predictOutdent,
} from '@/lib/sheet-predict';
import MoneyInput from '@/components/ui/MoneyInput';
import {
  deleteRowAction,
  indentRowAction,
  moveRowAction,
  outdentRowAction,
  setReportingUnitAction,
} from '@/lib/sheet-structure';

/** Anything a server action can answer with, as far as this panel cares. */
type Res = {
  ok: boolean;
  error?: string;
  gone?: true;
  newId?: string;
  undoId?: string;
  /** The rows as they now stand, straight from the write — see StructureResult. */
  sheet?: Sheet;
};
import {
  setMilestoneAction,
  updateRowDatesAction,
} from '@/lib/sheet-actions';

/**
 * Everything you can do to a row, in one panel shared by the whole sheet.
 *
 * Not a dropdown per row: at 285 rows that is 285 mounted Radix contexts, which
 * is the repo's standing rule. It is also the better answer on a phone, where a
 * list of 44px choices beats a menu pinned to a small button.
 *
 * The two switches at the bottom are not decoration. A milestone is a property
 * of the row rather than a duration someone typed as zero, and a reporting unit
 * — SPK, package, lot, area — is what earns a branch its own section in the
 * client's report. A plan that cannot mark one can never print that report.
 */
export default function RowMenu({
  row,
  initialMode = 'menu',
  onClose,
  onChanged,
  onDeleted,
  onUndoable,
  onPredict,
  onFailed,
  onAdd,
  projectId,
  network,
  rows,
  names,
  suggestions,
  onLinksSaved,
  facts,
  view,
  onKindSaved,
  onLabel,
  onOpenBars,
}: {
  row: SheetRow;
  /** 'delete' when the sheet opened this panel to ask about a row with children; 'links' from the conflict strip; 'kind' from Data Overall's link. */
  initialMode?: 'menu' | 'delete' | 'links' | 'kind';
  /** What each bar has to say (lib/bar-facts.ts), for the kind of work view. */
  facts: Record<string, BarFact>;
  view: BarView;
  /** A kind was saved: the plan and the bars as the server now has them. */
  onKindSaved: (sheet: Sheet, facts: Record<string, BarFact>) => void;
  /** Put one of the user's labels on this row, or none. */
  onLabel: (labelId: string | null) => void;
  /** Where labels are made. */
  onOpenBars: () => void;
  projectId: string;
  /** The links read against the plan, for the Links view. */
  network: Network;
  rows: SheetRow[];
  names: Map<string, string>;
  /** The date-chain guesses for this row (lib/link-suggestions.ts). */
  suggestions: string[];
  onLinksSaved: (sheet: Sheet, touched: string[]) => void;
  onClose: () => void;
  /**
   * Something changed. The SHEET comes with it when the action carried one,
   * so the panel hands back rows the caller would otherwise go and ask for in
   * a second round trip; absent when there is nothing to hand over, such as a
   * row the server says is already gone.
   */
  onChanged: (sheet?: Sheet) => void;
  /** The delete that just happened, and the handle that can take it back. */
  onDeleted?: (undoId: string | undefined) => void;
  /**
   * A structural move this panel just made, and the move that reverses it.
   *
   * Without this the sheet's Ctrl+Z would skip everything done from in here and
   * then undo whatever came before it, which is the failure the undo stack was
   * rebuilt to remove.
   */
  onUndoable?: (run: () => Promise<Res>) => void;
  /**
   * Draw this change now, before the server has heard of it.
   *
   * The panel does not hold the rows — the sheet does — so it hands up a
   * function to run against them. Without this every action in here waited out
   * the full round trip, which on the deployment is a ~2 MB snapshot upload:
   * the confirm panel for a row with children sat under "Deleting…" for a
   * second and a half with the whole subtree still on screen, and the toolbar's
   * own Delete routes INTO that panel for exactly the rows worth deleting.
   */
  onPredict?: (fn: (rows: SheetRow[]) => SheetRow[]) => void;
  /**
   * The server refused a change this panel had already drawn.
   *
   * It cannot report that itself — it closed the moment it guessed — so the
   * sheet owns both halves of putting it right: the message, and going back for
   * the rows as they really are. An empty message means the row was simply gone
   * and there is nothing to accuse anybody of.
   */
  onFailed?: (message: string) => void;
  /**
   * Add a row below this one, or inside it, THROUGH THE SHEET.
   *
   * These two used to run their own `addRowAction` here, with a placeholder the
   * sheet had no record of. So nothing mapped it to the id the server gave: the
   * row was thrown away and rebuilt the moment the answer landed, the name
   * being typed into it went with the input, and a rename sent before then
   * named a row that never existed and was refused. The row appeared, vanished
   * under the cursor, and came back as "New task" (25 Sep 2026). The sheet's
   * own `addRow` already carries all of that, and opens the name for typing.
   */
  onAdd: (asChild: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unitLabel, setUnitLabel] = useState(row.unitLabel ?? '');
  const [unitValue, setUnitValue] = useState('');
  const [mode, setMode] = useState<'menu' | 'unit' | 'delete' | 'links' | 'kind' | 'label'>(initialMode);
  const fact = facts[row.id];
  const kindName = fact?.kindId ? KIND_LABEL[fact.kindId] ?? null : null;
  const ownLabel = view.labels.find((l) => l.id === row.barLabel) ?? null;

  const run = (
    fn: () => Promise<Res>,
    keepOpen = false,
    onOk?: (res: Res) => void,
    /** What the sheet should show at once — see `onPredict`. */
    guess?: (rows: SheetRow[]) => SheetRow[]
  ) => {
    setError(null);
    // A guess moves the sheet NOW, which means this panel has already said
    // everything it has to say and should get out of the way rather than sit
    // over the change under a spinner. It also means the panel will not be
    // mounted to show an error if the server refuses, so the sheet takes the
    // message as well as the rows — see `onFailed`.
    const guessed = Boolean(guess && onPredict);
    if (guess && onPredict) onPredict(guess);
    if (guessed) onClose();

    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        if (guessed) {
          onFailed?.(res.gone ? '' : (res.error ?? 'Something went wrong'));
          return;
        }
        // A row the server says is gone leaves nothing to do here and nothing
        // worth reading: the sheet behind this panel is what is out of date.
        if (res.gone) {
          onChanged();
          onClose();
          return;
        }
        setError(res.error ?? 'Something went wrong');
        return;
      }
      onOk?.(res);
      onChanged(res.sheet);
      // Structural actions close, because the row they acted on may not be
      // where it was. Field edits stay open: people fill start, finish and
      // price one after another, and a panel that shuts each time is a panel
      // they have to reopen three times.
      if (!keepOpen && !guessed) onClose();
    });
  };

  /** Run it, and hand the sheet the move that puts things back. */
  const undoable = (
    fn: () => Promise<Res>,
    inverse: (res: Res) => (() => Promise<Res>) | null,
    guess?: (rows: SheetRow[]) => SheetRow[]
  ) =>
    run(
      fn,
      false,
      (res) => {
        const back = inverse(res);
        if (back) onUndoable?.(back);
      },
      guess
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-enter max-h-[85vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-sm sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Row {row.code}</p>
        <p className="mt-0.5 truncate text-sm font-semibold">{row.name}</p>

        {/* The target date stood here, mirroring the Target column for phones.
            Both are gone: the user's decision was that the target leaves the
            PLANNER, not merely the grid, and leaving the field behind would
            have made the sheet's own removal incoherent — a date creatable in
            the panel, invisible in the row, and driving a lateness warning the
            sheet no longer draws. `updateRowTargetAction` and `targetDate` are
            untouched, and targets still arrive through the importer and
            paste-from-Excel. */}

        {/* Dates live here on small screens because the sheet cannot show all
            four columns and a readable name at 390px: measured on Gundih, the
            fourth column costs the name 70px and turns "Relokasi 2 Unit Ta…"
            into "Relok…". Above `sm` the columns are back and this would be a
            second place to change the same thing. */}
        {mode === 'menu' && !row.isSummary && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
            <label className="text-[11px] font-medium text-muted-foreground">
              Start
              <input
                type="date"
                defaultValue={row.startDate ?? ''}
                onBlur={(e) =>
                  e.target.value !== (row.startDate ?? '') &&
                  run(() => updateRowDatesAction(row.id, 'start', e.target.value), true)
                }
                className="mt-1 h-11 w-full rounded-lg border px-2 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              Finish
              <input
                type="date"
                defaultValue={row.finishDate ?? ''}
                onBlur={(e) =>
                  e.target.value !== (row.finishDate ?? '') &&
                  run(() => updateRowDatesAction(row.id, 'finish', e.target.value), true)
                }
                className="mt-1 h-11 w-full rounded-lg border px-2 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
            {/* Price stood here until 12 Sep 2026, and it was the planner's last
                door into per-row money. It moved to Data Overall along with the
                Price and Weight columns: scheduling a plan and pricing one are
                two jobs, often two people, and this panel belongs to the first.
                `updateRowTextAction(row.id, 'price', …)` is untouched and is
                what Data Overall will call. */}
          </div>
        )}

        {mode === 'menu' && (
          <div className="mt-3 space-y-0.5">
            {/* What the work IS, asked while planning (7 Oct 2026). Data
                Overall reads it and only ticks its stages. */}
            <Item
              icon={<Shapes className="size-4" />}
              onClick={() => void warmKindView().then(() => setMode('kind'))}
              disabled={pending}
            >
              Kind of work:{' '}
              {kindName ?? 'not set'}
            </Item>
            {!row.isSummary && (
              <>
                <Item icon={<Link2 className="size-4" />} onClick={() => setMode('links')} disabled={pending} linksEntry>
                  Links: Waits for {row.links?.length ?? 0} · Holds up{' '}
                  {rows.filter((r) => r.links?.some((l) => l.id === row.id)).length}
                </Item>
                <Divider />
              </>
            )}
            {/* The user's own colour for this bar. On a heading it paints the
                rows under it that have none of their own. */}
            <Item
              icon={<span className="size-4 rounded-[4px] ring-1 ring-border" style={{ background: ownLabel ? paintCss(ownLabel.paint) : 'transparent' }} />}
              onClick={() => setMode('label')}
              disabled={pending}
            >
              Bar label: {ownLabel ? ownLabel.name : 'none'}
            </Item>
            {row.isSummary && <Divider />}
            <Item
              icon={<Plus className="size-4" />}
              onClick={() => {
                onClose();
                onAdd(false);
              }}
              disabled={pending}
            >
              Add row below
            </Item>
            <Item
              icon={<CornerDownRight className="size-4" />}
              onClick={() => {
                onClose();
                onAdd(true);
              }}
              disabled={pending}
            >
              Add row inside
            </Item>

            <Divider />

            <Item
              icon={<ChevronsRight className="size-4" />}
              onClick={() => undoable(
                  () => indentRowAction(row.id),
                  () => () => outdentRowAction(row.id),
                  (rs) => predictIndent(rs, row.id)
                )}
              disabled={pending}
              hint="Tab"
            >
              Indent
            </Item>
            <Item
              icon={<ChevronsLeft className="size-4" />}
              onClick={() => undoable(
                  () => outdentRowAction(row.id),
                  () => () => indentRowAction(row.id),
                  (rs) => predictOutdent(rs, row.id)
                )}
              disabled={pending}
              hint="Shift+Tab"
            >
              Outdent
            </Item>
            <Item
              icon={<MoveUp className="size-4" />}
              onClick={() =>
                undoable(
                  () => moveRowAction(row.id, 'up'),
                  () => () => moveRowAction(row.id, 'down'),
                  (rs) => predictMove(rs, row.id, 'up')
                )
              }
              disabled={pending}
            >
              Move up
            </Item>
            <Item
              icon={<MoveDown className="size-4" />}
              onClick={() =>
                undoable(
                  () => moveRowAction(row.id, 'down'),
                  () => () => moveRowAction(row.id, 'up'),
                  (rs) => predictMove(rs, row.id, 'down')
                )
              }
              disabled={pending}
            >
              Move down
            </Item>

            <Divider />

            {!row.isSummary && (
              <Item
                icon={<Diamond className={`size-4 ${row.isMilestone ? 'fill-foreground' : ''}`} />}
                onClick={() =>
                  run(() => setMilestoneAction(row.id, !row.isMilestone), false, undefined, (rs) =>
                    predictFlags(rs, row.id, { isMilestone: !row.isMilestone })
                  )
                }
                disabled={pending}
              >
                {row.isMilestone ? 'Not a milestone' : 'Make it a milestone'}
              </Item>
            )}
            {/* Any row. The "summaries only" rule was never decided — it fell out
                of how this menu was written. Gundih happens to mark four
                branches, but an SPK whose whole scope is one line is a real
                thing, and a prohibition with no reason is not a rule. */}
            {
              <Item
                icon={<Tag className="size-4" />}
                onClick={() =>
                  row.isReportingUnit
                    ? run(() => setReportingUnitAction(row.id, false), false, undefined, (rs) =>
                        predictFlags(rs, row.id, { isReportingUnit: false, unitLabel: null })
                      )
                    : setMode('unit')
                }
                disabled={pending}
              >
                {row.isReportingUnit ? `Stop being ${row.unitLabel || 'a work package'}` : 'Make it a work package'}
              </Item>
            }

            <Divider />

            {/* A leaf goes on the press and lands on the sheet's undo stack.
                Only a row that would take others with it is worth a question
                first — see deleteRowAction. */}
            <Item
              icon={<Trash2 className="size-4" />}
              onClick={() =>
                row.childCount > 0
                  ? setMode('delete')
                  : run(
                      () => deleteRowAction(row.id),
                      false,
                      (res) => onDeleted?.(res.undoId),
                      (rs) => predictDelete(rs, row.id)
                    )
              }
              disabled={pending}
              danger
            >
              Delete
            </Item>
          </div>
        )}

        {mode === 'links' && (() => {
          // Already warmed: render it straight away, no Suspense, no reveal
          // throttle. Not yet: the lazy one, once.
          const Panel = loadedLinksPanel() ?? LinksPanel;
          return (
          <Suspense fallback={null}>
            <Panel
              projectId={projectId}
              row={row}
              rows={rows}
              network={network}
              names={names}
              suggestions={suggestions}
              onBack={() => (initialMode === 'links' ? onClose() : setMode('menu'))}
              onSaved={(sheet, touched) => {
                onLinksSaved(sheet, touched);
                onClose();
              }}
            />
          </Suspense>
          );
        })()}

        {mode === 'label' && (
          <div className="mt-3 space-y-1">
            <p className="text-[13px] text-muted-foreground">
              {row.isSummary
                ? 'Pick a label. Rows under this heading without their own label take it.'
                : 'Pick a label for this bar.'}
            </p>
            {view.labels.map((l) => (
              <Item
                key={l.id}
                icon={<span className="size-4 rounded-[4px]" style={{ background: paintCss(l.paint) }} />}
                onClick={() => {
                  onLabel(l.id);
                  onClose();
                }}
              >
                {l.name}
                {l.id === row.barLabel ? ' (now)' : ''}
              </Item>
            ))}
            {view.labels.length === 0 && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
                No labels yet. Make them in Bars, then come back.
              </p>
            )}
            {row.barLabel && (
              <Item
                icon={<span className="size-4 rounded-[4px] ring-1 ring-border" />}
                onClick={() => {
                  onLabel(null);
                  onClose();
                }}
              >
                No label
              </Item>
            )}
            <Divider />
            <Item icon={<span className="size-4" />} onClick={onOpenBars}>
              Make or change labels in Bars
            </Item>
            <Item icon={<span className="size-4" />} onClick={() => setMode('menu')}>
              Back
            </Item>
          </div>
        )}

        {mode === 'kind' && (
          <ReadyKindView
            row={row}
            rows={rows}
            facts={facts}
            view={view}
            projectId={projectId}
            onBack={() => (initialMode === 'kind' ? onClose() : setMode('menu'))}
            onSaved={(sheet, next) => {
              onKindSaved(sheet, next);
              onClose();
            }}
          />
        )}

        {mode === 'unit' && (
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              A work package gets its own section in the report, and it is its own contract, even
              when it sits inside another one: a package nested in another keeps its own value,
              apart from the one around it. The app keeps the packages adding up to the contract,
              and says so when they do not.
            </p>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Label
              <input
                autoFocus
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="Package A, Lot 3, WP-02…"
                className="mt-1 h-11 w-full rounded-lg border px-3 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Its own contract value
              <MoneyInput
                defaultValue={unitValue}
                onValueChange={setUnitValue}
                placeholder="Leave empty if not known yet"
                className="mt-1 h-11 w-full rounded-lg border px-3 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    setReportingUnitAction(
                      row.id,
                      true,
                      unitLabel,
                      unitValue.trim() === '' ? null : Number(unitValue.replace(/[^0-9.]/g, ''))
                    )
                  )
                }
                className="btn-primary h-11 flex-1 rounded-lg text-sm font-medium"
              >
                {pending ? 'Saving…' : 'Mark as unit'}
              </button>
              <button
                type="button"
                onClick={() => setMode('menu')}
                className="h-11 rounded-lg border px-4 text-sm font-medium"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {mode === 'delete' && (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {row.childCount > 0 ? (
                <>
                  This row has <strong className="text-foreground">{row.childCount}</strong> rows
                  under it, and they go with it, along with their dates, prices and any progress
                  recorded against them.
                </>
              ) : (
                <>This removes the row, its dates and its price.</>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => deleteRowAction(row.id),
                    false,
                    (res) => onDeleted?.(res.undoId),
                    (rs) => predictDelete(rs, row.id)
                  )
                }
                className="h-11 flex-1 rounded-lg bg-destructive text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setMode('menu')}
                className="h-11 rounded-lg border px-4 text-sm font-medium"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive animate-fade-in-up">{error}</p>}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 border-t" />;
}

function Item({
  children,
  icon,
  onClick,
  disabled,
  danger,
  hint,
  linksEntry,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  /** Marks the Links entry for the perf probe (scripts/verify-projects-perf.mjs). */
  linksEntry?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-links-entry={linksEntry || undefined}
      className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 ${
        danger ? 'text-destructive' : ''
      }`}
    >
      {icon}
      {children}
      {hint && (
        <span className="ml-auto rounded border px-1.5 py-px text-[10px] font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </button>
  );
}
