'use client';

import { useState, useTransition } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  Diamond,
  MoveDown,
  MoveUp,
  Plus,
  Tag,
  Trash2,
} from 'lucide-react';

import type { SheetRow } from '@/lib/sheet';
import MoneyInput from '@/components/ui/MoneyInput';
import {
  addRowAction,
  deleteRowAction,
  indentRowAction,
  moveRowAction,
  outdentRowAction,
  setReportingUnitAction,
} from '@/lib/sheet-structure';

/** Anything a server action can answer with, as far as this panel cares. */
type Res = { ok: boolean; error?: string; gone?: true; newId?: string; undoId?: string };
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
  projectId,
  initialMode = 'menu',
  onClose,
  onChanged,
  onDeleted,
  onUndoable,
}: {
  row: SheetRow;
  projectId: string;
  /** 'delete' when the sheet opened this panel to ask about a row with children. */
  initialMode?: 'menu' | 'delete';
  onClose: () => void;
  onChanged: () => void;
  /** The delete that just happened, and the handle that can take it back. */
  onDeleted?: (undoId: string | undefined, name: string) => void;
  /**
   * A structural move this panel just made, and the move that reverses it.
   *
   * Without this the sheet's Ctrl+Z would skip everything done from in here and
   * then undo whatever came before it, which is the failure the undo stack was
   * rebuilt to remove.
   */
  onUndoable?: (run: () => Promise<Res>) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unitLabel, setUnitLabel] = useState(row.unitLabel ?? '');
  const [unitValue, setUnitValue] = useState('');
  const [mode, setMode] = useState<'menu' | 'unit' | 'delete'>(initialMode);

  const run = (fn: () => Promise<Res>, keepOpen = false, onOk?: (res: Res) => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
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
      onChanged();
      // Structural actions close, because the row they acted on may not be
      // where it was. Field edits stay open: people fill start, finish and
      // price one after another, and a panel that shuts each time is a panel
      // they have to reopen three times.
      if (!keepOpen) onClose();
    });
  };

  /** Run it, and hand the sheet the move that puts things back. */
  const undoable = (fn: () => Promise<Res>, inverse: (res: Res) => (() => Promise<Res>) | null) =>
    run(fn, false, (res) => {
      const back = inverse(res);
      if (back) onUndoable?.(back);
    });

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
            <Item
              icon={<Plus className="size-4" />}
              onClick={() =>
                undoable(
                  () => addRowAction(projectId, { afterNodeId: row.id }),
                  ({ newId }) => (newId ? () => deleteRowAction(newId) : null)
                )
              }
              disabled={pending}
            >
              Add row below
            </Item>
            <Item
              icon={<CornerDownRight className="size-4" />}
              onClick={() =>
                undoable(
                  () => addRowAction(projectId, { afterNodeId: row.id, asChild: true }),
                  ({ newId }) => (newId ? () => deleteRowAction(newId) : null)
                )
              }
              disabled={pending}
            >
              Add row inside
            </Item>

            <Divider />

            <Item
              icon={<ChevronsRight className="size-4" />}
              onClick={() => undoable(() => indentRowAction(row.id), () => () => outdentRowAction(row.id))}
              disabled={pending}
              hint="Tab"
            >
              Indent
            </Item>
            <Item
              icon={<ChevronsLeft className="size-4" />}
              onClick={() => undoable(() => outdentRowAction(row.id), () => () => indentRowAction(row.id))}
              disabled={pending}
              hint="Shift+Tab"
            >
              Outdent
            </Item>
            <Item
              icon={<MoveUp className="size-4" />}
              onClick={() =>
                undoable(() => moveRowAction(row.id, 'up'), () => () => moveRowAction(row.id, 'down'))
              }
              disabled={pending}
            >
              Move up
            </Item>
            <Item
              icon={<MoveDown className="size-4" />}
              onClick={() =>
                undoable(() => moveRowAction(row.id, 'down'), () => () => moveRowAction(row.id, 'up'))
              }
              disabled={pending}
            >
              Move down
            </Item>

            <Divider />

            {!row.isSummary && (
              <Item
                icon={<Diamond className={`size-4 ${row.isMilestone ? 'fill-foreground' : ''}`} />}
                onClick={() => run(() => setMilestoneAction(row.id, !row.isMilestone))}
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
                    ? run(() => setReportingUnitAction(row.id, false))
                    : setMode('unit')
                }
                disabled={pending}
              >
                {row.isReportingUnit ? `Stop being ${row.unitLabel || 'a unit'}` : 'Make it a reporting unit'}
              </Item>
            }

            <Divider />

            {/* A leaf goes on the press and leaves an Undo behind it. Only a
                row that would take others with it is worth a question first —
                see deleteRowAction. */}
            <Item
              icon={<Trash2 className="size-4" />}
              onClick={() =>
                row.childCount > 0
                  ? setMode('delete')
                  : run(() => deleteRowAction(row.id), false, (res) =>
                      onDeleted?.(res.undoId, row.name)
                    )
              }
              disabled={pending}
              danger
            >
              Delete
            </Item>
          </div>
        )}

        {mode === 'unit' && (
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              A reporting unit gets its own section in the report, and it is its own contract, even
              when it sits inside another one. SPK-007 lives inside SPK-004 and its value is not
              part of SPK-004&apos;s. The app keeps the units adding up to the contract, and says so
              when they do not.
            </p>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Label
              <input
                autoFocus
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="SPK-002, Package A, Lot 3…"
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
                  run(() => deleteRowAction(row.id), false, (res) =>
                    onDeleted?.(res.undoId, row.name)
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
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
