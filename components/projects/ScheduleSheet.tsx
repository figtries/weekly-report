'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Undo2 } from 'lucide-react';

import type { SheetRow } from '@/lib/sheet';
import { updateRowDatesAction, updateRowTextAction } from '@/lib/sheet-actions';
import { addRowAction, indentRowAction, outdentRowAction } from '@/lib/sheet-structure';
import RowMenu from './RowMenu';

/**
 * The schedule sheet, and the Gantt beside it.
 *
 * Five decisions hold this file together. Four of them are things Microsoft
 * Project does that people trip over; the fifth is how the two panes stay in
 * step.
 *
 * **Rows are divs on a CSS grid, not a `<table>`.** This was measured, not
 * preferred: with `height: 40px` on a `<tr>`, Chrome produced rows of 60, 60
 * and 68px against 28px of content — the specified height was added to the
 * content rather than acting as a floor, and the result varied row by row. A
 * Gantt bar is placed by arithmetic (`index × ROW_H`), so rows that are not
 * exactly ROW_H tall make every bar below the first one wrong, and wrong by
 * more the further down you look. One grid template is shared by the header and
 * every row, which also keeps the columns aligned without `table-fixed`.
 *
 * **One input exists at a time.** 285 rows × six columns is seventeen hundred
 * form controls. Cells are text until clicked; the clicked cell becomes a
 * native `<input>` and hands it back on blur. That is the repo's Radix rule
 * taken seriously — the cost is mounted instances, not the library.
 *
 * **A summary row has no inputs at all.** Its dates are its children's span,
 * computed on read. In MS Project you can type over that, it quietly stops
 * rolling up, and the plan starts lying.
 *
 * **The divider is draggable**, because how much sheet versus how much calendar
 * you want depends on what you are doing, and it is the one control everyone
 * recognises from MS Project. Below 768px the two panes cannot share a screen,
 * so they become two tabs instead.
 *
 * **Every edit is undoable.** A schedule change touches rows you are not
 * looking at, and a sheet with no way back is a sheet people are afraid to type
 * in.
 */

const ROW_H = 36;
const HEAD_H = 34;
// Days-to-pixels is chosen per plan, not fixed. At a constant 3px/day a
// three-day project drew nine pixels of bar across a thousand-pixel pane, and a
// five-year one would need scrolling for a week. ~1200px of timeline is the
// target; the clamps stop a one-day plan filling the screen with a single block
// and a decade-long one collapsing into a smear.
const TARGET_PX = 1200;
function pxPerDay(days: number): number {
  if (days <= 0) return 8;
  return Math.min(24, Math.max(1.5, TARGET_PX / days));
}
const MS_PER_DAY = 86_400_000;
// Sized against the widest real content: an outline code six levels deep
// (1.2.1.2.1.1), a date as 'dd MMM yy', and a price in a currency symbol.
// Everything left over goes to the name, which is the column people read.
const GRID = '5.25rem minmax(9rem,1fr) 4rem 4.75rem 4.75rem 5.5rem 2.5rem';
const SPLIT_KEY = 'figtries:sheet-split';

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(utc(iso));
}

type Field = 'name' | 'duration' | 'start' | 'finish' | 'price';
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
  /** The contract window. The timeline is drawn against this, not against
   *  whichever rows happen to exist — otherwise a plan with two rows in it
   *  shows a two-day calendar. */
  projectStart: string | null;
  projectFinish: string | null;
  currency: string;
  projectId: string;
}) {
  // A row may legitimately sit outside the contract window; the Gantt widens
  // rather than clipping it, because that is exactly the row worth seeing.
  const ganttStart = projectStart ?? spanStart;
  const ganttFinish = projectFinish ?? spanFinish;
  const [rows, setRows] = useState(initialRows);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; field: Field } | null>(null);
  const [undoStack, setUndoStack] = useState<Edit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<'sheet' | 'gantt'>('sheet');
  const [menuRow, setMenuRow] = useState<SheetRow | null>(null);
  const [splitPx, setSplitPx] = useState(780);
  const [, startTransition] = useTransition();

  useEffect(() => setRows(initialRows), [initialRows]);

  // Per-viewer convenience, so localStorage rather than the database — and
  // wrapped, because a private window can throw on read.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(saved) && saved >= 360) setSplitPx(saved);
    } catch {
      /* no stored preference is a fine answer */
    }
  }, []);

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
            : (row.finishDate ?? '');

  /**
   * Send one cell. Optimistic for text, because a sheet that waits for the
   * server before showing your own keystroke feels broken on a slow line — and
   * a failure puts the old value straight back rather than leaving a lie on
   * screen. Dates are not guessed at locally: the server owns the triangle.
   */
  const commit = useCallback(
    (row: SheetRow, field: Field, raw: string, recordUndo = true) => {
      const before = valueOf(row, field);
      if (raw === before) return;
      setError(null);

      startTransition(async () => {
        if (field === 'name' || field === 'price') {
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
   * Structural edits — add, indent, outdent, move, delete.
   *
   * These are NOT optimistic and NOT on the undo stack, unlike a cell. Adding a
   * row renumbers the whole outline and can reshape every row below it, so
   * guessing the result locally would mean reimplementing the server's tree walk
   * in the browser and then hoping the two agree. `router.refresh()` re-reads
   * the sheet instead, which is one round trip and always right.
   */
  const router = useRouter();
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

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
  const onDragDivider = (e: React.PointerEvent) => {
    e.preventDefault();
    const shell = shellRef.current;
    if (!shell) return;
    const move = (ev: PointerEvent) => {
      const next = Math.min(
        Math.max(ev.clientX - shell.getBoundingClientRect().left, 360),
        shell.clientWidth - 240
      );
      setSplitPx(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplitPx((w) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(w));
        } catch {
          /* storage can be blocked; the split still works for this visit */
        }
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        rowCount={rows.length}
        canUndo={undoStack.length > 0}
        onUndo={undo}
        onAdd={() => structure(addRowAction(projectId, { afterNodeId: rows.at(-1)?.id ?? null }))}
        pane={pane}
        setPane={setPane}
        allCollapsed={collapsed.size > 0}
        onToggleAll={() =>
          setCollapsed((c) =>
            c.size > 0 ? new Set() : new Set(rows.filter((r) => r.isSummary).map((r) => r.id))
          )
        }
      />

      {error && (
        <p className="animate-fade-in-up shrink-0 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div ref={shellRef} className="flex min-h-0 flex-1">
        <div
          ref={leftRef}
          onScroll={mirror('l')}
          style={{ width: splitPx }}
          className={`min-h-0 shrink-0 overflow-auto max-md:!w-full ${
            pane === 'gantt' ? 'max-md:hidden' : ''
          }`}
        >
          <div className="min-w-[34rem]">
            <div
              className="sticky top-0 z-20 grid items-center gap-x-2 border-b bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              style={{ gridTemplateColumns: GRID, height: HEAD_H }}
            >
              <span>#</span>
              <span>Task name</span>
              <span className="text-right">Duration</span>
              <span>Start</span>
              <span>Finish</span>
              <span className="text-right">Price</span>
              <span className="sr-only">Row actions</span>
            </div>

            {visible.length === 0 && (
              <div className="animate-enter p-8 text-center">
                <p className="text-sm font-semibold">Nothing planned yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Add the first row, then Tab to put a row under another one. Dates and a price go
                  in the columns beside it, and its bar appears on the right.
                </p>
              </div>
            )}

            {visible.map((r) => (
              <Row
                key={r.id}
                row={r}
                currency={currency}
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
                onEdit={(field) => setEditing({ rowId: r.id, field })}
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
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-foreground md:block"
        />

        <div
          ref={rightRef}
          onScroll={mirror('r')}
          className={`min-h-0 flex-1 overflow-auto ${pane === 'sheet' ? 'max-md:hidden' : ''}`}
        >
          <Gantt
            rows={visible}
            spanStart={ganttStart}
            spanFinish={ganttFinish}
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

function Toolbar({
  rowCount,
  canUndo,
  onUndo,
  onAdd,
  pane,
  setPane,
  allCollapsed,
  onToggleAll,
}: {
  rowCount: number;
  canUndo: boolean;
  onUndo: () => void;
  onAdd: () => void;
  pane: 'sheet' | 'gantt';
  setPane: (p: 'sheet' | 'gantt') => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
      <span className="mr-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {rowCount} rows
      </span>
      <button
        type="button"
        onClick={onAdd}
        className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-xs font-medium text-background"
      >
        <Plus className="size-3.5" />
        Add row
      </button>
      <button
        type="button"
        onClick={onToggleAll}
        className="h-9 rounded-lg px-2.5 text-xs font-medium hover:bg-muted"
      >
        {allCollapsed ? 'Expand all' : 'Collapse all'}
      </button>
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
      >
        <Undo2 className="size-3.5" />
        Undo
      </button>

      <div className="ml-auto flex rounded-lg border p-0.5 md:hidden">
        {(['sheet', 'gantt'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPane(p)}
            className={`h-9 rounded-md px-3 text-xs font-medium ${
              pane === p ? 'bg-foreground text-background' : 'text-muted-foreground'
            }`}
          >
            {p === 'sheet' ? 'List' : 'Timeline'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({
  row: r,
  currency,
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
      className={`grid items-center gap-x-2 border-b px-3 hover:bg-muted/40 ${
        r.isSummary ? 'font-semibold' : ''
      }`}
      style={{ gridTemplateColumns: GRID, height: ROW_H }}
    >
      <span className="truncate text-[11px] tabular-nums text-muted-foreground">{r.code}</span>

      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: r.depth * 12 }}>
        {r.isSummary ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? `Expand ${r.name}` : `Collapse ${r.name}`}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        {r.isMilestone && (
          <span
            aria-label="Milestone"
            className="size-2 shrink-0 rotate-45 bg-foreground"
            title="Milestone"
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
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
            {r.unitLabel || 'Unit'}
          </span>
        )}
      </div>

      <div className="text-right tabular-nums">
        {locked ? (
          <span className="text-muted-foreground">{r.durationDays ?? '—'}</span>
        ) : r.isMilestone ? (
          <span className="text-[11px] text-muted-foreground">milestone</span>
        ) : (
          <EditableCell
            value={r.durationDays == null ? '' : String(r.durationDays)}
            display={r.durationDays == null ? '—' : `${r.durationDays} d`}
            active={editing === 'duration'}
            onEdit={() => onEdit('duration')}
            onDone={onDone}
            onCommit={(v) => onCommit('duration', v)}
            className="text-right"
            inputMode="numeric"
          />
        )}
      </div>

      <div className="tabular-nums">
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

      <div className="tabular-nums">
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

      <div className="text-right tabular-nums">
        {locked ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <EditableCell
            value={r.price == null ? '' : String(r.price)}
            // An empty price is not a warning. Scheduling and pricing are two
            // jobs, often two people — a column of exclamation marks would tell
            // the scheduler they had failed at something they were not doing.
            display={
              r.price == null
                ? '—'
                : new Intl.NumberFormat('en-GB', {
                    style: 'currency',
                    currency,
                    maximumFractionDigits: 0,
                  }).format(r.price)
            }
            active={editing === 'price'}
            onEdit={() => onEdit('price')}
            onDone={onDone}
            onCommit={(v) => onCommit('price', v)}
            className="text-right text-[11px]"
            inputMode="decimal"
          />
        )}
      </div>

      {/* Always drawn, never on hover: there is no hover on a phone, and this
          app's rule is that no information or control lives there. */}
      <button
        type="button"
        onClick={onMenu}
        aria-label={`Actions for row ${r.code}`}
        className="grid size-8 place-items-center justify-self-end rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  );
}

/**
 * Text until clicked, a native input while it is. Enter and blur commit,
 * Escape abandons — the behaviour of every spreadsheet anyone has used.
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
  /** Tab indents the row, Shift+Tab outdents it — MS Project's own shortcut. */
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
        className={`block w-full rounded px-1 text-left leading-[22px] hover:bg-muted ${className}`}
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
          // Taken from the browser: Tab would otherwise walk to the next cell,
          // and in a sheet this shape Tab means "one level in".
          e.preventDefault();
          onCommit(draft);
          onDone();
          onTab(e.shiftKey);
        }
      }}
      className={`w-full rounded border border-foreground bg-background px-1 leading-[22px] outline-none ${className}`}
    />
  );
}

/** Bars placed by arithmetic, which only works because every row is exactly ROW_H. */
function Gantt({
  rows,
  spanStart,
  spanFinish,
}: {
  rows: SheetRow[];
  spanStart: string | null;
  spanFinish: string | null;
}) {
  const [todayX, setTodayX] = useState<number | null>(null);

  // The plan's own window: the project's dates, widened if a row runs outside
  // them. A bar that sits past the contract finish must still be drawable —
  // that is exactly the row someone needs to see.
  const start = spanStart;
  const end = useMemo(() => {
    const last = rows.reduce<string | null>(
      (acc, r) => (r.finishDate && (!acc || r.finishDate > acc) ? r.finishDate : acc),
      null
    );
    if (!spanFinish) return last;
    if (!last) return spanFinish;
    return last > spanFinish ? last : spanFinish;
  }, [rows, spanFinish]);

  const scale = start && end ? pxPerDay(daysBetween(start, end) + 1) : 8;
  const width = start && end ? Math.max((daysBetween(start, end) + 1) * scale, 240) : 240;

  const months = useMemo(() => {
    if (!start || !end) return [];
    const out: { key: string; x: number; label: string }[] = [];
    const first = new Date(utc(start));
    const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    const stop = utc(end);
    for (let i = 0; i < 400 && cursor.getTime() <= stop; i++) {
      const x = ((cursor.getTime() - utc(start)) / MS_PER_DAY) * scale;
      out.push({
        key: cursor.toISOString().slice(0, 7),
        // The month containing the start begins before it — pin its label to
        // the edge instead of dropping it, or a short plan shows no month at all.
        x: Math.max(0, x),
        label: new Intl.DateTimeFormat('en-GB', {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(cursor),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    // Two labels closer than their own width collide, and the first one is
    // pinned to the edge so it collides most often. Drop the crowded one rather
    // than draw them on top of each other.
    return out.filter((m, i) => i === 0 || m.x - out[i - 1].x >= 46);
  }, [start, end, scale]);

  const bodyH = rows.length * ROW_H;

  useEffect(() => {
    if (!start) return;
    // Today comes from the browser: a server component prerenders into the
    // static shell, so a build-time clock would drift a day further from the
    // truth every day, silently.
    const x = ((Date.now() - utc(start)) / MS_PER_DAY) * scale;
    setTodayX(x >= 0 && x <= width ? x : null);
  }, [start, scale, width]);

  if (!spanStart) {
    return (
      <p className="p-6 text-xs text-muted-foreground">
        No dates yet — give a row a start and a finish and its bar appears here.
      </p>
    );
  }

  return (
    <div className="relative" style={{ width }}>
      {/* Exactly HEAD_H so the first bar lines up with the first row. */}
      <div className="sticky top-0 z-20 border-b bg-card" style={{ height: HEAD_H }}>
        {months.map((m) => (
          <span
            key={m.key}
            className="absolute top-0 border-l pl-1 text-[10px] text-muted-foreground"
            style={{ left: m.x, lineHeight: `${HEAD_H}px` }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="relative" style={{ height: bodyH }}>
        {months.map((m) => (
          <span
            key={m.key}
            aria-hidden
            className="absolute top-0 w-px bg-border"
            style={{ left: m.x, height: bodyH }}
          />
        ))}

        {todayX !== null && (
          <span
            aria-hidden
            className="absolute top-0 z-10 w-0.5 bg-foreground/70"
            style={{ left: todayX, height: bodyH }}
          />
        )}

        {rows.map((r, i) => {
          if (!r.startDate || !r.finishDate) return null;
          const x = daysBetween(start!, r.startDate) * scale;
          const y = i * ROW_H;

          if (r.isMilestone) {
            return (
              <span
                key={r.id}
                title={`${r.name} · ${fmtDate(r.startDate)}`}
                className="absolute size-2.5 rotate-45 bg-foreground"
                style={{ left: x - 5, top: y + ROW_H / 2 - 5 }}
              />
            );
          }

          const w = Math.max((daysBetween(r.startDate, r.finishDate) + 1) * scale, 3);
          // A summary is thin and dark, a task fuller and lighter — the visual
          // grammar MS Project uses, so the shape of a plan is recognisable to
          // anyone who has ever seen one.
          return (
            <span
              key={r.id}
              title={`${r.name} · ${fmtDate(r.startDate)} → ${fmtDate(r.finishDate)} · ${r.durationDays} d`}
              className={`absolute rounded-sm ${r.isSummary ? 'bg-foreground' : 'bg-muted-foreground'}`}
              style={{
                left: x,
                width: w,
                top: y + (r.isSummary ? ROW_H / 2 - 2 : ROW_H / 2 - 6),
                height: r.isSummary ? 5 : 12,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
