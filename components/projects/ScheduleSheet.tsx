'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { m } from 'framer-motion';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react';

import type { SheetRow } from '@/lib/sheet';
import {
  updateRowDatesAction,
  updateRowTargetAction,
  updateRowTextAction,
} from '@/lib/sheet-actions';
import {
  addRowAction,
  deleteRowAction,
  indentRowAction,
  outdentRowAction,
} from '@/lib/sheet-structure';
import GanttChart, { GanttLegend, planColor } from './GanttChart';
import { formatMoney } from '@/lib/currency';
import PasteRows, { ClipboardPaste } from './PasteRows';
import RowMenu from './RowMenu';
import SheetToolbar from './SheetToolbar';
import { pressMotion } from '@/components/motion/Press';

/**
 * The schedule sheet, and the timeline beside it.
 *
 * **A row is SELECTED, and the toolbar acts on it.** Everything used to hide
 * behind a `⋯` per row, so the answer to "how do I put a task under this one"
 * was invisible until you went hunting. Selection plus a visible toolbar is how
 * every outliner works, and it is the single change that makes this learnable.
 *
 * **Rows are divs on a CSS grid, not a `<table>`.** Measured, not preferred:
 * `height` on a `<tr>` was ADDED to the content rather than acting as a floor,
 * producing rows of 60, 60 and 68px against 28px of content. A Gantt bar is
 * placed by `index × ROW_H`, so rows that are not exactly ROW_H tall put every
 * bar below the first progressively out of line.
 *
 * **One input exists at a time.** 285 rows × six columns is seventeen hundred
 * form controls. A cell is text until you enter it; the active one becomes a
 * native `<input>` and hands it back on blur.
 *
 * **A summary row has no inputs at all.** Its dates are its children's span,
 * computed on read — the one MS Project behaviour deliberately removed, because
 * there you can type over a summary and it quietly stops rolling up.
 *
 * **Motion is framer-motion because it is state-triggered** — presses, panels,
 * a bar changing length. Entry-on-load animation stays CSS keyframes; see
 * `components/motion/Reveal.tsx` for why.
 */

const ROW_H = 44;
const HEAD_H = 36;
// A SHARE of the shell, not a pixel width. Stored as pixels it was 720 on
// every screen, so a 1240px laptop gave the timeline 290px — a quarter of the
// window, which is what "the Gantt is cut off" meant.
const SPLIT_KEY = 'figtries:sheet-split-ratio';
// The sheet's nine columns come to 39.75rem, plus eight 6px gaps and 12px of
// padding either side: 708px before anything starts scrolling. The default is
// that width where the window allows it and a share of the window where it does
// not — a fixed ratio cut the price column off at 1240px and wasted half the
// timeline at 1920, and 634 (the eight-column figure) clipped Weight the moment
// Target arrived.
const SHEET_NATURAL = 712;
/** Neither pane is useful below this, so the drag stops there. */
const MIN_PANE = 300;

// Under 640px only the outline, the name, the duration and the row menu fit;
// dates and price move into the row's own panel. Above it, the full sheet.
// Under 640px the first column is the colour chip alone. A six-level outline
// code needs ~60px and truncates to nonsense in less, while indentation already
// carries the structure — and the full code is one tap away in the row panel.
const GRID_SM = 'grid-cols-[0.75rem_minmax(6rem,1fr)_3.25rem_2.25rem]';
const GRID_LG =
  'sm:grid-cols-[4.25rem_minmax(8rem,1fr)_3.5rem_4.5rem_4.5rem_4.5rem_5rem_3.25rem_2.25rem]';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, mo, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(Date.UTC(y, mo - 1, d));
}

const MS_PER_DAY = 86_400_000;

/**
 * Days the finish lands past the target, or null when it does not.
 *
 * Null rather than 0 or a negative number, so "is there a value here" and "is
 * this row late" are the same question — the same shape `lib/sheet.ts` returns
 * on the server, because an optimistic edit that disagreed with the next read
 * would make the marking flicker.
 */
function lateBy(target: string | null, finish: string | null): number | null {
  if (!target || !finish || finish <= target) return null;
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(finish) - day(target)) / MS_PER_DAY);
}

type Field = 'name' | 'duration' | 'start' | 'finish' | 'target' | 'price';
interface Edit {
  rowId: string;
  field: Field;
  before: string;
}

export default function ScheduleSheet({
  rows: initialRows,
  spanStart,
  spanFinish,
  projectStart,
  projectFinish,
  currency,
  projectId,
}: {
  rows: SheetRow[];
  spanStart: string | null;
  spanFinish: string | null;
  projectStart: string | null;
  projectFinish: string | null;
  currency: string;
  projectId: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rowId: string; field: Field } | null>(null);
  const [undoStack, setUndoStack] = useState<Edit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<'sheet' | 'gantt'>('sheet');
  const [menuRow, setMenuRow] = useState<SheetRow | null>(null);
  const [splitRatio, setSplitRatio] = useState<number | null>(null);
  const [shellWidth, setShellWidth] = useState(0);
  const [, startTransition] = useTransition();

  useEffect(() => setRows(initialRows), [initialRows]);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(saved) && saved > 0.15 && saved < 0.85) setSplitRatio(saved);
    } catch {
      /* a private window can throw; no stored preference is a fine answer */
    }
  }, []);

  // A row may legitimately sit outside the contract window; the timeline widens
  // rather than clipping it, because that is exactly the row worth seeing.
  const ganttStart = projectStart ?? spanStart;
  const ganttFinish = projectFinish ?? spanFinish;

  const visible = useMemo(() => {
    if (collapsed.size === 0) return rows;
    const out: SheetRow[] = [];
    let hideBelow: number | null = null;
    for (const r of rows) {
      if (hideBelow !== null && r.depth > hideBelow) continue;
      hideBelow = null;
      out.push(r);
      if (r.isSummary && collapsed.has(r.id)) hideBelow = r.depth;
    }
    return out;
  }, [rows, collapsed]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const patch = useCallback((rowId: string, next: Partial<SheetRow>) => {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...next } : r)));
  }, []);

  const valueOf = (row: SheetRow, field: Field): string =>
    field === 'name'
      ? row.name
      : field === 'price'
        ? row.price == null
          ? ''
          : String(row.price)
        : field === 'duration'
          ? String(row.durationDays ?? '')
          : field === 'start'
            ? (row.startDate ?? '')
            : field === 'target'
              ? (row.targetDate ?? '')
              : (row.finishDate ?? '');

  /**
   * Send one cell. Optimistic for text, because a sheet that waits for the
   * server before showing your own keystroke feels broken on a slow line — and
   * a failure puts the old value straight back. Dates are not guessed at
   * locally: the server owns the duration/start/finish triangle.
   */
  const commit = useCallback(
    (row: SheetRow, field: Field, raw: string, recordUndo = true) => {
      const before = valueOf(row, field);
      if (raw === before) return;
      setError(null);

      startTransition(async () => {
        // The target date moves nothing, so it is safe to show immediately and
        // to work out "late by" here — the same subtraction the server does on
        // the next read.
        if (field === 'target') {
          patch(row.id, { targetDate: raw || null, daysLate: lateBy(raw || null, row.finishDate) });
          const res = await updateRowTargetAction(row.id, raw);
          if (!res.ok) {
            setError(res.error);
            patch(row.id, { targetDate: before || null, daysLate: lateBy(before || null, row.finishDate) });
            return;
          }
        } else if (field === 'name' || field === 'price') {
          patch(row.id, field === 'name' ? { name: raw } : { price: raw === '' ? null : Number(raw) });
          const res = await updateRowTextAction(row.id, field, raw);
          if (!res.ok) {
            setError(res.error);
            patch(
              row.id,
              field === 'name' ? { name: before } : { price: before === '' ? null : Number(before) }
            );
            return;
          }
        } else {
          const res = await updateRowDatesAction(row.id, field, raw);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          patch(row.id, {
            startDate: res.startDate,
            finishDate: res.finishDate,
            durationDays: res.durationDays,
          });
        }
        if (recordUndo) setUndoStack((s) => [...s.slice(-49), { rowId: row.id, field, before }]);
      });
    },
    [patch]
  );

  /**
   * Structural edits are NOT optimistic and NOT on the undo stack. Adding a row
   * renumbers the whole outline and can reshape every row below it; guessing
   * that locally means reimplementing the server's tree walk in the browser and
   * hoping the two agree. One refresh is always right.
   */
  const structure = useCallback(
    (p: Promise<{ ok: boolean; error?: string }>) => {
      setError(null);
      startTransition(async () => {
        const res = await p;
        if (!res.ok) {
          setError(res.error ?? 'Something went wrong');
          return;
        }
        router.refresh();
      });
    },
    [router]
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const last = stack[stack.length - 1];
      if (!last) return stack;
      const row = rowsRef.current.find((r) => r.id === last.rowId);
      if (row) commit(row, last.field, last.before, false);
      return stack.slice(0, -1);
    });
  }, [commit]);

  // Keyboard: move with the arrows, act with Tab, undo with Ctrl+Z. Ignored
  // while a cell is being typed into, where those keys belong to the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      const typing =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (typing || !selectedId) return;

      const i = visible.findIndex((r) => r.id === selectedId);
      if (e.key === 'ArrowDown' && i < visible.length - 1) {
        e.preventDefault();
        setSelectedId(visible[i + 1].id);
      }
      if (e.key === 'ArrowUp' && i > 0) {
        e.preventDefault();
        setSelectedId(visible[i - 1].id);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        structure(e.shiftKey ? outdentRowAction(selectedId) : indentRowAction(selectedId));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, selectedId, visible, structure]);

  // Mirror the panes' vertical scroll. The guard stops the echo — setting one
  // pane's scrollTop fires that pane's own handler.
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const mirror = (from: 'l' | 'r') => () => {
    if (syncing.current) return;
    const a = from === 'l' ? leftRef.current : rightRef.current;
    const b = from === 'l' ? rightRef.current : leftRef.current;
    if (!a || !b || a.scrollTop === b.scrollTop) return;
    syncing.current = true;
    b.scrollTop = a.scrollTop;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setShellWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clamped every render rather than only on drag: a window that shrinks below
  // the stored width used to leave the timeline a sliver with no way back.
  const splitPx =
    shellWidth > 0
      ? Math.min(
          Math.max(
            splitRatio != null ? shellWidth * splitRatio : Math.min(SHEET_NATURAL, shellWidth * 0.62),
            MIN_PANE
          ),
          Math.max(MIN_PANE, shellWidth - MIN_PANE)
        )
      : 0;
  const onDragDivider = (e: React.PointerEvent) => {
    e.preventDefault();
    const shell = shellRef.current;
    if (!shell) return;
    const move = (ev: PointerEvent) => {
      const box = shell.getBoundingClientRect();
      const px = Math.min(Math.max(ev.clientX - box.left, MIN_PANE), box.width - MIN_PANE);
      setSplitRatio(px / box.width);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplitRatio((r) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(r));
        } catch {
          /* storage can be blocked; the split still works for this visit */
        }
        return r;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const anchor = selectedId ?? rows.at(-1)?.id ?? null;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <SheetToolbar
        rowCount={rows.length}
        selected={selected}
        canUndo={undoStack.length > 0}
        onUndo={undo}
        onAdd={() => structure(addRowAction(projectId, { afterNodeId: anchor }))}
        onAddChild={() =>
          selectedId && structure(addRowAction(projectId, { afterNodeId: selectedId, asChild: true }))
        }
        onIndent={() => selectedId && structure(indentRowAction(selectedId))}
        onOutdent={() => selectedId && structure(outdentRowAction(selectedId))}
        onDelete={() => selectedId && structure(deleteRowAction(selectedId))}
        allCollapsed={collapsed.size > 0}
        onToggleAll={() =>
          setCollapsed((c) =>
            c.size > 0 ? new Set() : new Set(rows.filter((r) => r.isSummary).map((r) => r.id))
          )
        }
        pane={pane}
        setPane={setPane}
        slot={
          <PasteRows
            projectId={projectId}
            afterNodeId={selectedId}
            afterLabel={selected?.name ?? null}
            onDone={() => router.refresh()}
            trigger={(open) => (
              <m.button
                type="button"
                onClick={open}
                {...pressMotion}
                title="Paste rows copied from a workbook"
                className="flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-200 ease-ios hover:bg-muted"
              >
                <ClipboardPaste className="size-4" />
                <span className="hidden sm:inline">Paste</span>
              </m.button>
            )}
          />
        }
      />

      {/* Which row the toolbar is about to act on.
          Without this the toolbar was a set of buttons with an invisible
          subject — and on the mobile Timeline tab, where no names are drawn at
          all, tapping a bar gave no sign of what you had touched. */}
      {selected ? (
        <m.div
          key={selected.id}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex shrink-0 items-center gap-2 border-b bg-muted/60 px-3 py-1.5 text-[11px]"
        >
          <span
            aria-hidden
            className="h-3.5 w-1 shrink-0 rounded-full"
            style={{ background: planColor(selected.colorGroup) }}
          />
          <span className="shrink-0 tabular-nums text-muted-foreground">{selected.code}</span>
          <span className="truncate font-medium">{selected.name}</span>
          <span className="ml-auto hidden shrink-0 tabular-nums text-muted-foreground sm:block">
            {selected.isMilestone
              ? fmtDate(selected.startDate)
              : selected.durationDays != null
                ? `${selected.durationDays} d · ${fmtDate(selected.startDate)} → ${fmtDate(selected.finishDate)}`
                : 'no dates yet'}
          </span>
        </m.div>
      ) : (
        <GanttLegend rows={rows} />
      )}

      {error && (
        <m.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </m.p>
      )}

      <div ref={shellRef} className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        <div
          ref={leftRef}
          onScroll={mirror('l')}
          style={splitPx > 0 ? { width: splitPx } : { flex: '1 1 0%' }}
          className={`min-h-0 min-w-0 shrink-0 overflow-auto max-md:!w-full ${
            pane === 'gantt' ? 'max-md:hidden' : ''
          }`}
        >
          <div className="min-w-[19rem] sm:min-w-[44.5rem]">
            <div
              className={`sticky top-0 z-20 grid items-center gap-x-1.5 border-b bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground [&>span]:truncate ${GRID_SM} ${GRID_LG}`}
              style={{ height: HEAD_H }}
            >
              {/* `invisible`, not `hidden`. A display:none grid child leaves the
                  grid entirely, so below `sm` this header shifted one column
                  left and "Task name" was rendered into the 12px colour-stripe
                  cell, where it read "T..". The rows never had that problem —
                  their first cell, the stripe, is always in flow. */}
              <span className="invisible sm:visible">#</span>
              <span>Task name</span>
              <span className="text-right">Days</span>
              <span className="hidden sm:block">Start</span>
              <span className="hidden sm:block">Finish</span>
              <span className="hidden sm:block">Target</span>
              <span className="hidden text-right sm:block">Price</span>
              <span className="hidden text-right sm:block">Weight</span>
              <span className="sr-only">Row actions</span>
            </div>

            {visible.length === 0 && (
              <div className="animate-enter px-6 py-10 text-center">
                <p className="text-sm font-semibold">Nothing planned yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Paste the plan straight out of the workbook, or add the first row and use{' '}
                  <kbd className="rounded border px-1">Tab</kbd> to put a row underneath another.
                </p>
                {/* Paste leads. Every plan that matters already exists somewhere
                    else, and typing 285 rows is not a thing anyone will do. */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <PasteRows
                    projectId={projectId}
                    afterNodeId={null}
                    afterLabel={null}
                    onDone={() => router.refresh()}
                    trigger={(open) => (
                      <m.button
                        type="button"
                        onClick={open}
                        {...pressMotion}
                        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
                      >
                        <ClipboardPaste className="size-4" />
                        Paste from Excel
                      </m.button>
                    )}
                  />
                  <m.button
                    type="button"
                    {...pressMotion}
                    onClick={() => structure(addRowAction(projectId, {}))}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium"
                  >
                    <Plus className="size-4" />
                    Add the first row
                  </m.button>
                </div>
              </div>
            )}

            {visible.map((r) => (
              <Row
                key={r.id}
                row={r}
                currency={currency}
                selected={r.id === selectedId}
                onSelect={() => setSelectedId(r.id)}
                collapsed={collapsed.has(r.id)}
                onToggle={() =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  })
                }
                editing={editing?.rowId === r.id ? editing.field : null}
                onEdit={(field) => {
                  setSelectedId(r.id);
                  setEditing({ rowId: r.id, field });
                }}
                onDone={() => setEditing(null)}
                onCommit={(field, value) => commit(r, field, value)}
                onMenu={() => setMenuRow(r)}
                onIndent={(shift) => structure(shift ? outdentRowAction(r.id) : indentRowAction(r.id))}
                onEnter={() => structure(addRowAction(projectId, { afterNodeId: r.id }))}
              />
            ))}
          </div>
        </div>

        <div
          onPointerDown={onDragDivider}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sheet"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-border transition-colors duration-200 hover:bg-foreground md:block"
        />

        <div
          ref={rightRef}
          onScroll={mirror('r')}
          className={`min-h-0 min-w-0 flex-1 overflow-auto ${pane === 'sheet' ? 'max-md:hidden' : ''}`}
        >
          <GanttChart
            rows={visible}
            spanStart={ganttStart}
            spanFinish={ganttFinish}
            rowH={ROW_H}
            headH={HEAD_H}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      {menuRow && (
        <RowMenu
          row={menuRow}
          projectId={projectId}
          onClose={() => setMenuRow(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function Row({
  row: r,
  currency,
  selected,
  onSelect,
  collapsed,
  onToggle,
  editing,
  onEdit,
  onDone,
  onCommit,
  onMenu,
  onIndent,
  onEnter,
}: {
  row: SheetRow;
  currency: string;
  selected: boolean;
  onSelect: () => void;
  collapsed: boolean;
  onToggle: () => void;
  editing: Field | null;
  onEdit: (f: Field) => void;
  onDone: () => void;
  onCommit: (f: Field, v: string) => void;
  onMenu: () => void;
  onIndent: (shift: boolean) => void;
  onEnter: () => void;
}) {
  const locked = r.isSummary;

  return (
    <div
      onMouseDown={onSelect}
      className={`group grid items-center gap-x-1.5 border-b px-3 transition-colors duration-150 ${GRID_SM} ${GRID_LG} ${
        selected ? 'bg-muted' : 'hover:bg-muted/50'
      } ${r.isSummary ? 'font-semibold' : ''}`}
      style={{ height: ROW_H }}
    >
      <span className="flex items-center gap-1.5 truncate text-[11px] tabular-nums text-muted-foreground">
        {/* The row's own colour, so the sheet and the timeline read as one thing
            rather than two lists that happen to be side by side. */}
        <span
          aria-hidden
          className="h-4 w-1 shrink-0 rounded-full"
          style={{ background: planColor(r.colorGroup) }}
        />
        <span className="hidden sm:inline">{r.code}</span>
      </span>

      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: r.depth * 12 }}>
        {r.isSummary ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? `Expand ${r.name}` : `Collapse ${r.name}`}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        {r.isMilestone && (
          <span
            aria-label="Milestone"
            title="Milestone"
            className="size-2 shrink-0 rotate-45 rounded-[1px]"
            style={{ background: planColor(r.colorGroup) }}
          />
        )}
        <EditableCell
          value={r.name}
          active={editing === 'name'}
          onEdit={() => onEdit('name')}
          onDone={onDone}
          onCommit={(v) => onCommit('name', v)}
          onTab={onIndent}
          onEnterKey={onEnter}
          className="truncate"
        />
        {r.isReportingUnit && (
          <span className="shrink-0 rounded bg-background px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
            {r.unitLabel || 'Unit'}
          </span>
        )}
        {/* Beside the name, not only in the Target column, because that column
            is gone below 640px and this is the row's most important fact when
            it is true. Written as days rather than a colour alone — the app is
            used by people who should never have to decode a hue. */}
        {r.daysLate != null && (
          <span
            title={`${r.daysLate} days past its target date`}
            className="flex shrink-0 items-center gap-0.5 rounded bg-warn/10 px-1 py-px text-[9px] font-semibold tabular-nums text-warn"
          >
            <TriangleAlert className="size-2.5" />
            {r.daysLate}d late
          </span>
        )}
      </div>

      <div className="text-right tabular-nums">
        {locked ? (
          <span className="text-muted-foreground">{r.durationDays ?? '—'}</span>
        ) : r.isMilestone ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          <EditableCell
            value={r.durationDays == null ? '' : String(r.durationDays)}
            display={r.durationDays == null ? '—' : String(r.durationDays)}
            active={editing === 'duration'}
            onEdit={() => onEdit('duration')}
            onDone={onDone}
            onCommit={(v) => onCommit('duration', v)}
            className="text-right"
            inputMode="numeric"
          />
        )}
      </div>

      <div className="hidden tabular-nums sm:block">
        {locked ? (
          <span className="text-[11px] text-muted-foreground">{fmtDate(r.startDate) || '—'}</span>
        ) : (
          <EditableCell
            value={r.startDate ?? ''}
            display={fmtDate(r.startDate) || '—'}
            active={editing === 'start'}
            onEdit={() => onEdit('start')}
            onDone={onDone}
            onCommit={(v) => onCommit('start', v)}
            type="date"
            className="text-[11px]"
          />
        )}
      </div>

      <div className="hidden tabular-nums sm:block">
        {locked ? (
          <span className="text-[11px] text-muted-foreground">{fmtDate(r.finishDate) || '—'}</span>
        ) : (
          <EditableCell
            value={r.finishDate ?? ''}
            display={fmtDate(r.finishDate) || '—'}
            active={editing === 'finish'}
            onEdit={() => onEdit('finish')}
            onDone={onDone}
            onCommit={(v) => onCommit('finish', v)}
            type="date"
            className="text-[11px]"
          />
        )}
      </div>

      {/* Typed on EVERY row, summaries included — the one date a branch owns,
          because it is a promise rather than an observation about its children.
          `locked` deliberately does not gate it. */}
      <div className="hidden tabular-nums sm:block">
        <EditableCell
          value={r.targetDate ?? ''}
          display={fmtDate(r.targetDate) || '—'}
          active={editing === 'target'}
          onEdit={() => onEdit('target')}
          onDone={onDone}
          onCommit={(v) => onCommit('target', v)}
          type="date"
          className={`text-[11px] ${r.daysLate != null ? 'font-medium text-warn' : ''}`}
        />
      </div>

      <div className="hidden text-right tabular-nums sm:block">
        {(() => (
          <EditableCell
            value={r.price == null ? '' : String(r.price)}
            // An empty price is not a warning. Scheduling and pricing are two
            // jobs, often two people — a column of exclamation marks would tell
            // the scheduler they had failed at something they were not doing.
            display={r.price == null ? '—' : formatMoney(r.price, currency)}
            active={editing === 'price'}
            onEdit={() => onEdit('price')}
            onDone={onDone}
            onCommit={(v) => onCommit('price', v)}
            className="text-right text-[11px]"
            inputMode="decimal"
          />
        ))()}
      </div>

      {/* Derived, never typed — and now visible. */}
      <div className="hidden text-right tabular-nums sm:block">
        {r.bobot == null ? (
          <span className="text-[11px] text-muted-foreground">—</span>
        ) : (
          <span className="text-[11px] tabular-nums" title={`${r.bobot.toFixed(4)}% of the contract`}>
            {r.bobot < 0.005 ? '<0.01' : r.bobot.toFixed(2)}%
          </span>
        )}
      </div>

      {/* Always drawn, never hover-only: there is no hover on a phone, and this
          app's rule is that no control lives there. On small screens it is also
          the only way to the dates and the price. */}
      <button
        type="button"
        onClick={onMenu}
        aria-label={`Actions for row ${r.code}`}
        className="grid size-9 place-items-center justify-self-end rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  );
}

/**
 * Text until you enter it, a native input while you are in it.
 *
 * The dotted underline on row hover is the discoverability fix for editing: a
 * cell that looks like plain text tells nobody it can be typed in, and "click
 * the number" was the second thing people could not guess after "how do I add a
 * row".
 */
function EditableCell({
  value,
  display,
  active,
  onEdit,
  onDone,
  onCommit,
  className = '',
  type = 'text',
  inputMode,
  onTab,
  onEnterKey,
}: {
  value: string;
  display?: string;
  active: boolean;
  onEdit: () => void;
  onDone: () => void;
  onCommit: (v: string) => void;
  className?: string;
  type?: 'text' | 'date';
  inputMode?: 'numeric' | 'decimal';
  /** Tab indents the row, Shift+Tab outdents it — the outliner convention. */
  onTab?: (shift: boolean) => void;
  /** Enter on a name adds the next row, so a plan can be typed without the mouse. */
  onEnterKey?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, active]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`block w-full truncate rounded px-1 py-1 text-left leading-[22px] decoration-dotted underline-offset-4 transition-colors hover:bg-background group-hover:underline ${className}`}
      >
        {display ?? value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      inputMode={inputMode}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onCommit(draft);
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit(draft);
          onDone();
          onEnterKey?.();
        }
        if (e.key === 'Escape') onDone();
        if (e.key === 'Tab' && onTab) {
          // Taken from the browser: Tab would walk to the next control, and in a
          // sheet shaped like an outline Tab means "one level in".
          e.preventDefault();
          onCommit(draft);
          onDone();
          onTab(e.shiftKey);
        }
      }}
      className={`w-full rounded border-2 border-foreground bg-background px-1 py-1 leading-[22px] outline-none ${className}`}
    />
  );
}
