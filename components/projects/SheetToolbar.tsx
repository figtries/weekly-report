'use client';

import { m } from 'framer-motion';
import {
  ChartNoAxesGantt,
  ChevronsLeft,
  ChevronsRight,
  CornerDownRight,
  Link2,
  ListTree,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
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
  canLink,
  onLinks,
  onBars,
  pane,
  setPane,
  slot,
  query,
  onQuery,
  matchCount,
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
  /** A row is selected. On a heading the press explains that links join activities. */
  canLink: boolean;
  /** The selected row's links (the panel the row's ⋯ also opens). */
  onLinks: () => void;
  /** What every bar shows: colours and marks. */
  onBars: () => void;
  pane: 'sheet' | 'gantt';
  setPane: (p: 'sheet' | 'gantt') => void;
  /** Paste-from-Excel sits here rather than being wired through six props. */
  slot?: React.ReactNode;
  query: string;
  onQuery: (q: string) => void;
  /** How many rows carry the term themselves — the branches shown to reach them do not count. */
  matchCount: number;
}) {
  const has = selected !== null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b px-3 py-2 sm:px-6">
      <Action onClick={onAdd} icon={<Plus className="size-4" />} label="Add row" primary />
      <Action
        onClick={onAddChild}
        icon={<CornerDownRight className="size-4" />}
        label="Add inside"
        title="Add a row under the selected one"
        disabled={!has}
        desktopOnly
      />

      {slot}

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

      <Action
        onClick={onIndent}
        icon={<ChevronsRight className="size-4" />}
        label="Indent"
        hint="Tab"
        disabled={!has}
        compact
        desktopOnly
      />
      <Action
        onClick={onOutdent}
        icon={<ChevronsLeft className="size-4" />}
        label="Outdent"
        hint="Shift+Tab"
        disabled={!has || selected.depth === 0}
        compact
        desktopOnly
      />
      <Action
        onClick={onDelete}
        icon={<Trash2 className="size-4" />}
        label="Delete"
        disabled={!has}
        compact
        danger
        desktopOnly
      />

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

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
        iconBelow2xl
      />

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      {/* Links and Bars out in the open: the links lived only behind each
          row's ⋯, which is the hiding place this bar was written to end, and
          the bars had a dialog reached from the legend (7 Oct 2026). */}
      <Action
        onClick={onLinks}
        icon={<Link2 className="size-4" />}
        label="Links"
        title="What the selected activity waits for, and what waits for it"
        disabled={!canLink}
        compact
      />
      <Action
        onClick={onBars}
        icon={<ChartNoAxesGantt className="size-4" />}
        label="Bars"
        title="What colour says on the timeline, and which marks show"
        compact
      />

      {/* Right-aligned only where it shares a line with the buttons. On a
          phone it wraps to its own row, and pushing it right there left a
          hole the width of the screen beside it. */}
      <span className="flex items-center gap-2 sm:ml-auto">
        {/* A native input, not a component: the toolbar is already one row of
            controls and this is the only one people type into. */}
        <span className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Find a row"
            aria-label="Find a row"
            className={`h-11 w-28 rounded-lg border bg-card pl-7 text-[13px] outline-none transition-[width] duration-200 ease-ios focus:w-40 focus:border-foreground sm:h-9 sm:w-28 sm:focus:w-28 2xl:w-36 2xl:focus:w-56 ${query ? 'pr-7' : 'pr-2'}`}
          />
          {query !== '' && (
            <button
              type="button"
              onClick={() => onQuery('')}
              aria-label="Clear the search"
              className="absolute right-0.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
        {/* Only while searching: the row count itself is already in the
            header's facts line, and a number said twice is checked twice. */}
        {query.trim().length >= 2 && (
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
            {matchCount} of {rowCount}
          </span>
        )}
        {/* Below 768px the two panes cannot share a screen, so they take turns. */}
        <span className="flex rounded-lg border p-0.5 md:hidden">
          {(['sheet', 'gantt'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              className={`h-11 rounded-md px-3 text-[13px] font-medium transition-colors sm:h-9 ${
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
  desktopOnly,
  iconBelow2xl,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** A real keyboard shortcut. Said in the tooltip, not drawn: a chip beside
   *  three of the labels made the bar read as noise (8 Oct 2026). */
  hint?: string;
  /** Plain explanation for the tooltip, when the label alone is not enough. */
  title?: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Label hides under 640px — the icon and the tooltip carry it there. */
  compact?: boolean;
  /** Gone entirely under 640px, where the row panel carries it with its name. */
  desktopOnly?: boolean;
  /** Icon alone below 1536px: what lets the bar and the search share one line
   *  on a 1280 screen (8 Oct 2026). Only for an icon everybody reads. */
  iconBelow2xl?: boolean;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? (hint ? `${label} · ${hint}` : label)}
      aria-label={label}
      aria-keyshortcuts={hint}
      {...(disabled ? {} : pressMotion)}
      // A disabled button keeps its colour, and destructive red at 35% is
      // still the most saturated thing in a row of greys: Delete read as the
      // one button you were meant to press when nothing was even selected.
      // Disabled is disabled, whatever the button does when it works.
      className={`${desktopOnly ? 'hidden sm:flex' : 'flex'} h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors sm:h-9 duration-200 ease-ios disabled:pointer-events-none disabled:opacity-35 ${
        disabled
          ? 'text-muted-foreground'
          : primary
            ? 'btn-primary'
            : danger
              ? 'text-destructive hover:bg-destructive/10'
              : 'hover:bg-muted'
      }`}
    >
      {icon}
      <span className={iconBelow2xl ? 'hidden 2xl:inline' : compact ? 'hidden sm:inline' : ''}>{label}</span>
    </m.button>
  );
}
