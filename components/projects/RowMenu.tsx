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
import { setMilestoneAction } from '@/lib/sheet-actions';

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
  const [mode, setMode] = useState<'menu' | 'unit' | 'delete'>('menu');

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong');
        return;
      }
      onChanged();
      onClose();
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
            {row.isSummary && (
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
            )}

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
              A reporting unit gets its own section in the report and its weights normalise to 100
              inside it. The label is whatever the client calls it.
            </p>
            <input
              autoFocus
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
              placeholder="SPK-002, Package A, Lot 3…"
              className="h-11 w-full rounded-lg border px-3 text-sm outline-none focus:border-foreground"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setReportingUnitAction(row.id, true, unitLabel))}
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
