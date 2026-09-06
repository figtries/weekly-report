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
import {
  addRowAction,
  deleteRowAction,
  indentRowAction,
  moveRowAction,
  outdentRowAction,
  setReportingUnitAction,
} from '@/lib/sheet-structure';
import {
  setMilestoneAction,
  updateRowDatesAction,
  updateRowTargetAction,
  updateRowTextAction,
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
  onClose,
  onChanged,
}: {
  row: SheetRow;
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unitLabel, setUnitLabel] = useState(row.unitLabel ?? '');
  const [unitValue, setUnitValue] = useState('');
  const [mode, setMode] = useState<'menu' | 'unit' | 'delete'>('menu');

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, keepOpen = false) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong');
        return;
      }
      onChanged();
      // Structural actions close, because the row they acted on may not be
      // where it was. Field edits stay open: people fill start, finish and
      // price one after another, and a panel that shuts each time is a panel
      // they have to reopen three times.
      if (!keepOpen) onClose();
    });
  };

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

        {/* The target date is here for EVERY row, summaries included — it is the
            one date a branch owns, and the Target column disappears below
            640px. It sits outside the block below because that block is
            leaf-only. */}
        {mode === 'menu' && (
          <label className="mt-3 block text-[11px] font-medium text-muted-foreground sm:hidden">
            Target date
            <span className="ml-1 font-normal">— should be finished before this</span>
            <input
              type="date"
              defaultValue={row.targetDate ?? ''}
              onBlur={(e) =>
                e.target.value !== (row.targetDate ?? '') &&
                run(() => updateRowTargetAction(row.id, e.target.value), true)
              }
              className={`mt-1 h-11 w-full rounded-lg border px-2 text-sm outline-none focus:border-foreground ${
                row.daysLate != null ? 'border-warn text-warn' : 'text-foreground'
              }`}
            />
            {row.daysLate != null && (
              <span className="mt-1 block font-semibold text-warn">
                Finishes {row.daysLate} days past it
              </span>
            )}
          </label>
        )}

        {/* Dates live here on small screens because the sheet cannot show six
            columns and a readable name at 390px. Above `sm` the columns are
            back and this would be a second place to change the same thing. */}
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
            <label className="col-span-2 text-[11px] font-medium text-muted-foreground">
              Price
              <input
                inputMode="decimal"
                defaultValue={row.price == null ? '' : String(row.price)}
                placeholder="Leave empty until there is a BOQ"
                onBlur={(e) =>
                  e.target.value !== (row.price == null ? '' : String(row.price)) &&
                  run(() => updateRowTextAction(row.id, 'price', e.target.value), true)
                }
                className="mt-1 h-11 w-full rounded-lg border px-2 text-sm text-foreground outline-none focus:border-foreground"
              />
            </label>
          </div>
        )}

        {mode === 'menu' && (
          <div className="mt-3 space-y-0.5">
            <Item
              icon={<Plus className="size-4" />}
              onClick={() => run(() => addRowAction(projectId, { afterNodeId: row.id }))}
              disabled={pending}
            >
              Add row below
            </Item>
            <Item
              icon={<CornerDownRight className="size-4" />}
              onClick={() => run(() => addRowAction(projectId, { afterNodeId: row.id, asChild: true }))}
              disabled={pending}
            >
              Add row inside
            </Item>

            <Divider />

            <Item
              icon={<ChevronsRight className="size-4" />}
              onClick={() => run(() => indentRowAction(row.id))}
              disabled={pending}
              hint="Tab"
            >
              Indent
            </Item>
            <Item
              icon={<ChevronsLeft className="size-4" />}
              onClick={() => run(() => outdentRowAction(row.id))}
              disabled={pending}
              hint="Shift+Tab"
            >
              Outdent
            </Item>
            <Item
              icon={<MoveUp className="size-4" />}
              onClick={() => run(() => moveRowAction(row.id, 'up'))}
              disabled={pending}
            >
              Move up
            </Item>
            <Item
              icon={<MoveDown className="size-4" />}
              onClick={() => run(() => moveRowAction(row.id, 'down'))}
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

            <Item
              icon={<Trash2 className="size-4" />}
              onClick={() => setMode('delete')}
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
              A reporting unit gets its own section in the report, and it is its own contract — even
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
              <input
                inputMode="decimal"
                value={unitValue}
                onChange={(e) => setUnitValue(e.target.value)}
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
                className="h-11 flex-1 rounded-lg bg-foreground text-sm font-medium text-background disabled:opacity-50"
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
                  under it, and they go with it — along with their dates, prices and any progress
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
                onClick={() => run(() => deleteRowAction(row.id))}
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
