'use client';

import { m } from 'framer-motion';
import {
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  ListTree,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react';

import { pressMotion } from '@/components/motion/Press';
import type { SheetRow } from '@/lib/sheet';

/**
 * The operations, out in the open.
 *
 * They used to live only behind a `⋯` on each row, which meant the answer to
 * "how do I add a task under this one" was invisible until you went looking.
 * That is the single biggest reason the sheet was hard to learn. Now they sit
 * in a bar that acts on the SELECTED row, the way every outliner and every
 * spreadsheet works, and each one shows its keyboard shortcut so using it once
 * teaches the shortcut.
 *
 * Buttons disable rather than disappear: a control that vanishes when it does
 * not apply teaches nothing, while one that greys out says "this exists, but
 * not here". Every hit target is 44px.
 */
export default function SheetToolbar({
  rowCount,
  selected,
  canUndo,
  onUndo,
  onAdd,
  onAddChild,
  onIndent,
  onOutdent,
  onDelete,
  allCollapsed,
  onToggleAll,
  pane,
  setPane,
  slot,
}: {
  rowCount: number;
  selected: SheetRow | null;
  canUndo: boolean;
  onUndo: () => void;
  onAdd: () => void;
  onAddChild: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onDelete: () => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  pane: 'sheet' | 'gantt';
  setPane: (p: 'sheet' | 'gantt') => void;
  /** Paste-from-Excel sits here rather than being wired through six props. */
  slot?: React.ReactNode;
}) {
  const has = selected !== null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5 sm:px-3">
      <Action onClick={onAdd} icon={<Plus className="size-4" />} label="Add row" primary />
      <Action
        onClick={onAddChild}
        icon={<CornerDownRight className="size-4" />}
        label="Add inside"
        title="Add a row under the selected one"
        disabled={!has}
      />

      {slot}

      <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />

      <Action
        onClick={onIndent}
        icon={<ChevronsRight className="size-4" />}
        label="Indent"
        hint="Tab"
        disabled={!has}
        compact
      />
      <Action
        onClick={onOutdent}
        icon={<ChevronsLeft className="size-4" />}
        label="Outdent"
        hint="Shift+Tab"
        disabled={!has || selected.depth === 0}
        compact
      />
      <Action
        onClick={onDelete}
        icon={<Trash2 className="size-4" />}
        label="Delete"
        disabled={!has}
        compact
        danger
      />

      <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />

      <Action
        onClick={onToggleAll}
        icon={<ListTree className="size-4" />}
        label={allCollapsed ? 'Expand all' : 'Collapse all'}
        compact
      />
      <Action
        onClick={onUndo}
        icon={<Undo2 className="size-4" />}
        label="Undo"
        hint="Ctrl+Z"
        disabled={!canUndo}
        compact
      />

      <span className="ml-auto flex items-center gap-2">
        <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
          {rowCount} rows
        </span>
        {/* Below 768px the two panes cannot share a screen, so they take turns. */}
        <span className="flex rounded-lg border p-0.5 md:hidden">
          {(['sheet', 'gantt'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              className={`h-9 rounded-md px-3 text-xs font-medium transition-colors ${
                pane === p ? 'bg-foreground text-background' : 'text-muted-foreground'
              }`}
            >
              {p === 'sheet' ? 'List' : 'Timeline'}
            </button>
          ))}
        </span>
      </span>
    </div>
  );
}

function Action({
  onClick,
  icon,
  label,
  hint,
  title,
  disabled,
  primary,
  danger,
  compact,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** A real keyboard shortcut, and the ONLY thing drawn as a `<kbd>` — a sentence
   *  in that slot reads as a key you are supposed to press. */
  hint?: string;
  /** Plain explanation for the tooltip, when the label alone is not enough. */
  title?: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Label hides under 640px — the icon and the tooltip carry it there. */
  compact?: boolean;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? (hint ? `${label} · ${hint}` : label)}
      aria-label={label}
      {...(disabled ? {} : pressMotion)}
      className={`flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-200 ease-ios disabled:pointer-events-none disabled:opacity-35 ${
        primary
          ? 'bg-foreground text-background'
          : danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'hover:bg-muted'
      }`}
    >
      {icon}
      <span className={compact ? 'hidden sm:inline' : ''}>{label}</span>
      {hint && (
        <kbd className="ml-0.5 hidden rounded border px-1 py-px text-[10px] font-normal text-muted-foreground lg:inline">
          {hint}
        </kbd>
      )}
    </m.button>
  );
}
