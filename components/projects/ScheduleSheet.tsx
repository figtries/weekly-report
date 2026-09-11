'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { m } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  MoreHorizontal,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react';

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
  undoDeleteRowAction,
} from '@/lib/sheet-structure';
import BarStyleEditor from './BarStyleEditor';
import ShiftPreviewBar from './ShiftPreview';
import {
  inferChains,
  shiftPreview,
  type ChainNode,
  type ShiftPreview as Shift,
  type WeekSpan,
} from '@/lib/chains';
import GanttChart, { BarStylesButton, GanttLegend, paintColor } from './GanttChart';
import { DEFAULT_BAR_STYLES, resolveBar, type BarPreset, type BarStyle } from '@/lib/bar-styles';
import { formatMoney, groupAmount, stripAmount } from '@/lib/currency';
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
/** Rows mounted by the first render, before the scroller can be measured. */
const INITIAL_WINDOW = 30;
// A SHARE of the shell, not a pixel width. Stored as pixels it was 720 on
// every screen, so a 1240px laptop gave the timeline 290px — a quarter of the
// window, which is what "the Gantt is cut off" meant.
const SPLIT_KEY = 'figtries:sheet-split-ratio';
// The eight fixed columns come to 30.75rem, plus eight 6px gaps and 12px of
// padding either side: 564px of furniture. The default leaves the NAME about
// 225px on top of that, which is what "Detail Engineering" needs — at 712 the
// name was down to its 8rem floor and every branch read "Detail…". The divider
// still moves; this is only where it starts. A fixed ratio instead of a width
// cut the price column off at 1240px and wasted half the timeline at 1920.
const SHEET_NATURAL = 800;
/** Neither pane is useful below this, so the drag stops there. */
const MIN_PANE = 300;
/**
 * What the nine declared columns actually need: 40.25rem of columns, eight
 * 0.375rem gaps, and the sheet's own 0.75rem either side. 716px.
 *
 * Both numbers that should have respected it were short. The scrolling body
 * was floored at 43.75rem, sixteen pixels under, so the grid compressed its
 * last column instead of scrolling; and the default split handed the sheet
 * 62% of the shell, which on a 1105px shell is 685px, so Weight opened cut in
 * half and Row actions opened off-screen entirely with no scrollbar in sight
 * to say so. The divider still moves wherever you want it; drag under this and
 * the pane scrolls honestly rather than clipping.
 */
const FULL_GRID = 716;

// Under 640px only the outline, the name, the duration and the row menu fit;
// dates and price move into the row's own panel. Above it, the full sheet.
// Under 640px the first column is the colour chip alone. A six-level outline
// code needs ~60px and truncates to nonsense in less, while indentation already
// carries the structure — and the full code is one tap away in the row panel.
const GRID_SM = 'grid-cols-[0.75rem_minmax(5rem,1fr)_2.75rem_4.5rem_2.75rem]';
/**
 * Two headers for one column, one of them always display:none.
 *
 * A grid child that is hidden leaves the grid, so exactly one of these is in
 * flow at any width and the column count still matches GRID_SM and GRID_LG.
 * See the note on the hash cell for what happens when that arithmetic slips.
 */
const GRID_LG =
  'sm:grid-cols-[4.25rem_minmax(8rem,1fr)_4.25rem_4.25rem_4.25rem_4.25rem_5.25rem_3.5rem_2.25rem]';

/**
 * `04 Sep 26` — and every one of them exactly that wide.
 *
 * en-GB abbreviates September to "Sept", four letters where every other month
 * has three, so one row in twelve came out a character longer and a column of
 * dates read ragged however it was aligned. The 't' goes; nothing else about
 * the format changes.
 */
/**
 * The formatter is built ONCE, and every date it has already rendered is kept.
 *
 * `new Intl.DateTimeFormat(...)` used to run on every call, and this is called
 * five times per visible row — start, finish, target, twice over for the read
 * and edit faces. Forty rows of sheet plus the chart's own copy came to a few
 * hundred formatter constructions per render, and a CPU profile of one scroll
 * put 14% of the whole main thread inside `fmtDate` alone. Constructing an
 * Intl formatter is the expensive part; formatting with one is not.
 *
 * The cache is unbounded on purpose: a plan's dates are bounded by its own
 * span, so this holds a few hundred short strings at the very most.
 */
const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const dateCache = new Map<string, string>();
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const hit = dateCache.get(iso);
  if (hit !== undefined) return hit;
  const [y, mo, d] = iso.split('-').map(Number);
  const out = DATE_FMT.format(Date.UTC(y, mo - 1, d)).replace('Sept', 'Sep');
  dateCache.set(iso, out);
  return out;
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

/** Anything a server action can answer with, as far as the undo stack cares. */
type ActionResult = { ok: boolean; error?: string; gone?: true; newId?: string; undoId?: string };

/**
 * One step back.
 *
 * A cell edit remembers the value it replaced. A structural change remembers
 * the MOVE that puts it back instead, because there is no local shape to
 * restore to: adding a row renumbers the whole outline.
 *
 * The two used to be one type and only cell edits were ever pushed, so the
 * toolbar advertised "Undo Ctrl+Z" beside Add, Indent and Delete and then
 * quietly undid a rename from ten minutes ago. An undo stack that skips
 * actions is worse than no undo at all, because nobody can see which step it
 * is standing on.
 */
type Edit =
  | { kind: 'field'; rowId: string; field: Field; before: string }
  | { kind: 'structure'; run: () => Promise<ActionResult> };

export default function ScheduleSheet({
  rows: initialRows,
  spanStart,
  spanFinish,
  projectStart,
  projectFinish,
  currency,
  projectId,
  barStyles = DEFAULT_BAR_STYLES,
  barStyleSource = 'type',
  barStyleAuto = true,
  barStylePruned = [],
  weeks = [],
}: {
  rows: SheetRow[];
  spanStart: string | null;
  spanFinish: string | null;
  projectStart: string | null;
  projectFinish: string | null;
  currency: string;
  projectId: string;
  /** The project's ordered rule list; a ready-made one until someone edits it. */
  barStyles?: BarStyle[];
  barStyleSource?: 'custom' | BarPreset;
  barStyleAuto?: boolean;
  barStylePruned?: string[];
  /** Reporting weeks and their status, for the affected-weeks warning. */
  weeks?: WeekSpan[];
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
  const [menuMode, setMenuMode] = useState<'menu' | 'delete'>('menu');
  const [splitRatio, setSplitRatio] = useState<number | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [fitTimeline, setFitTimeline] = useState(false);
  const [shift, setShift] = useState<{ rowId: string; rowName: string; preview: Shift } | null>(null);
  // The last delete, for as long as it can still be taken back. See UndoBar.
  const [undoDelete, setUndoDelete] = useState<{ id: string; name: string } | null>(null);
  const [query, setQuery] = useState('');
  // The window of rows actually mounted. All 285 at once was 7,980 DOM nodes
  // and 2,162 buttons; only what fits on screen, plus a margin, is built now.
  //
  // THE FIRST WINDOW IS NOT THE SCROLLING ONE, and the initial 60 was paying
  // for a scroll nobody had done yet. Nothing can be measured during the first
  // render — no scroller exists — so this number is what the very first paint
  // mounts, in BOTH panes, before `recomputeRange` replaces it. On Gundih that
  // was 120 mounted rows against the thirteen a phone can show, and it cost
  // 470 ms of the wait to open the project: measured at 4x CPU throttle,
  // 2,252 ms to the plan on screen at 60, 1,780 ms at 30.
  //
  // 30 rather than fewer because of one straight-edged fact: 30 x 44px is
  // 1,320px of sheet, which is taller than the sheet pane on any viewport up
  // to about 1,570px. Below that the widening to the real window happens
  // entirely under the fold and is invisible; above it there would be one
  // frame of a short list, which is why this is not tuned down to the twenty a
  // phone would prefer.
  const [range, setRange] = useState({ start: 0, end: INITIAL_WINDOW });
  // Read after mount, never at render: this page prerenders into the static
  // shell, so a build-time clock would drift a day further from the truth every
  // day and "running today" would quietly stop being true.
  const [today, setToday] = useState('');
  useEffect(() => setToday(new Date().toISOString().slice(0, 10)), []);
  // Declared here rather than beside the mirror below, because the window
  // arithmetic reads the scroller's own height.
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
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

  /**
   * Search keeps the OUTLINE, not just the hits.
   *
   * A flat list of matching leaves is unreadable in a plan six levels deep —
   * "IFR" appears forty times and every one of them looks identical without the
   * branch above it. So a row survives if it matches or if anything under it
   * does, and collapse is ignored while searching: hiding a hit inside a folded
   * branch is the one thing a search must never do.
   */
  const term = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (term.length >= 2) {
      const hit = (r: SheetRow) =>
        r.name.toLowerCase().includes(term) || r.code.includes(term) || r.wbsCode.toLowerCase().includes(term);
      const keep = new Set<string>();
      // Backwards, so a matched row can mark the ancestors already behind it.
      const stack: SheetRow[] = [];
      for (const r of rows) {
        while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
        if (hit(r)) {
          keep.add(r.id);
          for (const a of stack) keep.add(a.id);
        }
        stack.push(r);
      }
      return rows.filter((r) => keep.has(r.id));
    }
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
  }, [rows, collapsed, term]);

  const matchCount = useMemo(
    () => (term.length >= 2 ? visible.filter((r) => r.name.toLowerCase().includes(term)).length : 0),
    [visible, term]
  );

  /**
   * Which rows are mounted, from the scroller's own position.
   *
   * OVERSCAN is generous on purpose: the two panes mirror each other's scroll,
   * and a window that ends exactly at the fold shows a blank strip for one frame
   * whenever a flick outruns the state update.
   */
  const OVERSCAN = 16;
  /**
   * The window moves in BLOCKS, not row by row.
   *
   * Measured, not guessed. With the window recomputed on every scroll tick, one
   * flick of sixty wheel notches down this plan took 7.7 SECONDS of wall clock
   * on a desktop and 54 on a 4x-throttled CPU — median frame gap 88ms, worst
   * 1.3s, 113 frames over 50ms. Each tick set state, and each state change
   * rebuilt forty `Row`s and the chart's slice; the rows carry eight inline
   * callbacks apiece so they cannot be memoised into standing still.
   *
   * Quantising the boundaries to a block means a scroll only re-renders when it
   * crosses one, so the same flick costs seven renders instead of sixty. The
   * floor/ceil are the right way round on purpose: `start` rounds DOWN and
   * `end` rounds UP, so the real overscan is never less than OVERSCAN — the
   * blank strip the overscan exists to prevent cannot come back through this.
   */
  const BLOCK = 12;
  const recomputeRange = useCallback((from?: HTMLDivElement | null) => {
    // Whichever pane is actually scrolling, because below 768px the two take
    // turns and the hidden one reports a height of zero — reading the sheet
    // while the timeline is on screen windowed the chart down to fourteen bars.
    const el =
      from && from.clientHeight > 0
        ? from
        : (leftRef.current?.clientHeight ? leftRef.current : rightRef.current);
    if (!el) return;
    const first = Math.floor(el.scrollTop / ROW_H);
    const fits = Math.ceil(el.clientHeight / ROW_H);
    setRange((prev) => {
      const start = Math.max(0, Math.floor((first - OVERSCAN) / BLOCK) * BLOCK);
      const end = Math.ceil((first + fits + OVERSCAN) / BLOCK) * BLOCK;
      return prev.start === start && prev.end === end ? prev : { start, end };
    });
  }, []);

  /**
   * ...and it is never computed ON the scroll event.
   *
   * A trackpad fires scroll far faster than the screen refreshes, so the
   * handler ran several times per frame and every one of them read
   * `scrollTop` — a forced layout — before deciding it had nothing to do.
   * Coalescing into one rAF gives at most one measurement per painted frame,
   * which is the most a window can usefully move anyway.
   */
  const rangeRaf = useRef(0);
  const scheduleRange = useCallback(
    (el: HTMLDivElement | null) => {
      if (rangeRaf.current) return;
      rangeRaf.current = requestAnimationFrame(() => {
        rangeRaf.current = 0;
        recomputeRange(el);
      });
    },
    [recomputeRange]
  );
  useEffect(() => () => cancelAnimationFrame(rangeRaf.current), []);

  // A new filter or a fresh set of rows can leave the window pointing past the
  // end of the list, which renders nothing at all.
  useEffect(() => {
    recomputeRange();
  }, [recomputeRange, visible.length, pane]);

  const windowed = useMemo(
    () => visible.slice(range.start, Math.min(range.end, visible.length)),
    [visible, range]
  );

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  // The chain, inferred on the client from the same rows the sheet is drawing.
  // Nothing is stored and nothing is fetched — see lib/chains.ts — so a preview
  // is instant and can never disagree with the dates on screen.
  const chainNodes = useMemo<ChainNode[]>(
    () =>
      rows.map((r, i) => ({
        id: r.id,
        parentId: r.parentId,
        order: i,
        isLeaf: r.isLeaf,
        startDate: r.startDate,
        finishDate: r.finishDate,
      })),
    [rows]
  );
  const chainLinks = useMemo(() => inferChains(chainNodes), [chainNodes]);

  /**
   * The colour a row's bar came out, so the sheet can use the SAME one.
   *
   * The stripe beside each outline code used to read `planColor(colorGroup)`
   * directly, which meant it kept saying "which package" while the timeline had
   * moved on to saying "critical" or "summary" — two colours for one row, in
   * two panes six inches apart. It asks the rule engine now, like the chart.
   */
  const paintOf = useCallback(
    (row: SheetRow) => paintColor(resolveBar(row, barStyles, today).paint, row),
    [barStyles, today]
  );
  const nameById = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);

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
          // Decision ④: the edit has already landed. What appears now is what
          // the person could not have known — what follows this row, and which
          // reported weeks the change lands in.
          const delta =
            row.startDate && res.startDate
              ? Math.round(
                  (Date.parse(res.startDate + 'T00:00:00Z') -
                    Date.parse(row.startDate + 'T00:00:00Z')) /
                    MS_PER_DAY
                )
              : 0;
          if (delta !== 0) {
            setShift({
              rowId: row.id,
              rowName: row.name,
              preview: shiftPreview(chainNodes, chainLinks, nameById, row.id, delta),
            });
          }
        }
        if (recordUndo)
          setUndoStack((s) => [...s.slice(-49), { kind: 'field', rowId: row.id, field, before }]);
      });
    },
    [patch, chainNodes, chainLinks, nameById]
  );

  /**
   * Structural edits are NOT optimistic and NOT on the undo stack. Adding a row
   * renumbers the whole outline and can reshape every row below it; guessing
   * that locally means reimplementing the server's tree walk in the browser and
   * hoping the two agree. One refresh is always right.
   */
  const structure = useCallback(
    (p: Promise<ActionResult>, onOk?: (res: ActionResult) => void) => {
      setError(null);
      startTransition(async () => {
        const res = await p;
        if (!res.ok) {
          // A row the server says is gone is not something to put in front of
          // anybody: this sheet is simply behind. Go and get the current rows.
          if (res.gone) {
            router.refresh();
            return;
          }
          setError(res.error ?? 'Something went wrong');
          return;
        }
        onOk?.(res);
        router.refresh();
      });
    },
    [router]
  );

  /**
   * A structural change, and the move that takes it back.
   *
   * The inverse is built from the RESULT rather than named up front, because
   * the row an add creates has no id until the server answers.
   */
  const structureUndoable = useCallback(
    (
      p: Promise<ActionResult>,
      inverse: (res: ActionResult) => (() => Promise<ActionResult>) | null
    ) => {
      structure(p, (res) => {
        const back = inverse(res);
        if (back) setUndoStack((s) => [...s.slice(-49), { kind: 'structure', run: back }]);
      });
    },
    [structure]
  );

  /** Ctrl+Z and the Undo bar are two doors onto the same step back. */
  const rememberUndo = useCallback((undoId: string) => {
    setUndoStack((s) => [
      ...s.slice(-49),
      { kind: 'structure', run: () => undoDeleteRowAction(undoId) },
    ]);
  }, []);

  /**
   * Delete, and say so afterwards instead of asking first.
   *
   * A leaf goes straight away and leaves an Undo behind it; a row with children
   * still gets the confirmation panel, because what it takes is more than the
   * row being pointed at. That asymmetry is the point — the dialog is spent
   * where it buys something, and nowhere else.
   */
  const dismissUndo = useCallback(() => setUndoDelete(null), []);
  const runUndo = useCallback(
    (id: string) => {
      structure(undoDeleteRowAction(id));
      setUndoDelete(null);
    },
    [structure]
  );

  const removeRow = useCallback(
    (row: SheetRow) => {
      if (row.childCount > 0) {
        setMenuMode('delete');
        setMenuRow(row);
        return;
      }
      structure(deleteRowAction(row.id), (res) => {
        if (!res.undoId) return;
        setUndoDelete({ id: res.undoId, name: row.name });
        rememberUndo(res.undoId);
      });
    },
    [structure, rememberUndo]
  );

  /**
   * ONE handler object for every row, and it never changes identity.
   *
   * `Row` is memoised, and a memoised component given a freshly built arrow
   * function on each render is just a slower unmemoised one. The eight
   * callbacks each row needs used to be written inline in the `.map()`, closing
   * over that row — so nudging the window by one block re-rendered all forty
   * mounted rows instead of the twelve that actually entered it.
   *
   * The row is passed BACK to the handler rather than captured, which is what
   * lets this object stand still. `commit` and `structure` are already stable
   * (`commit` re-forms only when the rows themselves do, and a row change has
   * to re-render anyway), and every `setState` setter is stable by contract.
   */
  const rowHandlers = useMemo<RowHandlers>(
    () => ({
      select: (id) => setSelectedId(id),
      toggle: (id) =>
        setCollapsed((c) => {
          const next = new Set(c);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      edit: (id, field) => {
        setSelectedId(id);
        setEditing({ rowId: id, field });
      },
      done: () => setEditing(null),
      commit: (row, field, value) => commit(row, field, value),
      menu: (row) => {
        setMenuMode('menu');
        setMenuRow(row);
      },
      indent: (id, shift) =>
        structureUndoable(shift ? outdentRowAction(id) : indentRowAction(id), () =>
          shift ? () => indentRowAction(id) : () => outdentRowAction(id)
        ),
      enter: (id) =>
        structureUndoable(addRowAction(projectId, { afterNodeId: id }), ({ newId }) =>
          newId ? () => deleteRowAction(newId) : null
        ),
    }),
    [commit, structure, structureUndoable, projectId]
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // The stack, reachable without going through a state updater — see `undo`.
  const undoRef = useRef(undoStack);
  undoRef.current = undoStack;
  /**
   * Undo, with the work done OUTSIDE the state updater.
   *
   * It used to call `commit` from inside `setUndoStack`'s updater, and an
   * updater has to be pure — React runs it during the update phase, so the
   * `startTransition` inside `commit` was illegal and the write never left the
   * browser. Ctrl+Z printed "Cannot call startTransition while rendering" and
   * the cell simply kept its new value. The stack is read from a ref, the send
   * happens in the handler, and the pop is the only thing the updater does.
   */
  const undo = useCallback(() => {
    const last = undoRef.current[undoRef.current.length - 1];
    if (!last) return;
    setUndoStack((stack) => stack.slice(0, -1));
    if (last.kind === 'structure') {
      structure(last.run());
      return;
    }
    const row = rowsRef.current.find((r) => r.id === last.rowId);
    if (row) commit(row, last.field, last.before, false);
  }, [commit, structure]);

  // Keyboard: move with the arrows, act with Tab, undo with Ctrl+Z. Ignored
  // while a cell is being typed into, where those keys belong to the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      // Asked of the EVENT's target as well as the focused element. A cell
      // editor commits on Enter and blurs itself doing it, so by the time this
      // window listener runs the focus has already moved to the body and the
      // key looked like it had been pressed on the sheet. Enter then added the
      // row twice: once from the cell, once from here.
      const from = e.target;
      const typing =
        from instanceof HTMLInputElement ||
        from instanceof HTMLTextAreaElement ||
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
      // The row menu has "Add row below" and the toolbar has Add row, but a
      // plan is typed one line after another and reaching for either of those
      // between every line is the reason people go back to Excel. Enter from
      // inside a cell already did this; a selected row had nothing.
      if (e.key === 'Enter') {
        e.preventDefault();
        structureUndoable(addRowAction(projectId, { afterNodeId: selectedId }), ({ newId }) =>
          newId ? () => deleteRowAction(newId) : null
        );
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const shift = e.shiftKey;
        structureUndoable(
          shift ? outdentRowAction(selectedId) : indentRowAction(selectedId),
          () => (shift ? () => indentRowAction(selectedId) : () => outdentRowAction(selectedId))
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, selectedId, visible, structureUndoable, projectId]);

  const syncing = useRef(false);
  const mirror = (from: 'l' | 'r') => () => {
    const a = from === 'l' ? leftRef.current : rightRef.current;
    const b = from === 'l' ? rightRef.current : leftRef.current;
    // The mirror stays on the event itself. It is one property write and it has
    // to land in the SAME frame the wheel moved the other pane, or the two
    // halves of one table visibly drift apart while you scroll.
    if (!syncing.current && a && b && a.scrollTop !== b.scrollTop) {
      syncing.current = true;
      b.scrollTop = a.scrollTop;
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    }
    // The window does not. Every scroll of either pane asks for a recompute,
    // mirrored or not, but they collapse into one per frame.
    scheduleRange(a);
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
            splitRatio != null
              ? shellWidth * splitRatio
              : Math.min(SHEET_NATURAL, Math.max(shellWidth * 0.62, FULL_GRID)),
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
        onAdd={() =>
          structureUndoable(addRowAction(projectId, { afterNodeId: anchor }), ({ newId }) =>
            newId ? () => deleteRowAction(newId) : null
          )
        }
        onAddChild={() =>
          selectedId &&
          structureUndoable(
            addRowAction(projectId, { afterNodeId: selectedId, asChild: true }),
            ({ newId }) => (newId ? () => deleteRowAction(newId) : null)
          )
        }
        onIndent={() =>
          selectedId &&
          structureUndoable(indentRowAction(selectedId), () => () => outdentRowAction(selectedId))
        }
        onOutdent={() =>
          selectedId &&
          structureUndoable(outdentRowAction(selectedId), () => () => indentRowAction(selectedId))
        }
        onDelete={() => selected && removeRow(selected)}
        allCollapsed={collapsed.size > 0}
        onToggleAll={() =>
          setCollapsed((c) =>
            c.size > 0 ? new Set() : new Set(rows.filter((r) => r.isSummary).map((r) => r.id))
          )
        }
        pane={pane}
        setPane={setPane}
        query={query}
        onQuery={setQuery}
        matchCount={matchCount}
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
                title="Read the plan from a workbook, or paste rows copied out of one"
                className="flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-200 ease-ios hover:bg-muted"
              >
                <ClipboardPaste className="size-4" />
                <span className="hidden sm:inline">Import</span>
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
            style={{ background: paintOf(selected) }}
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
          {/* This strip REPLACES the legend, and the legend is where the bar
              rules are reached from — so without this the way in disappears
              the moment anyone touches a row, which is most of the time. */}
          <BarStylesButton onClick={() => setStylesOpen(true)} className="ml-auto sm:ml-1" />
        </m.div>
      ) : (
        // Under 768px the two panes take turns, so on the List tab this row was
        // 60px of vertical space spent naming colours that are not on screen —
        // and vertical space is exactly what the first row of the plan was
        // waiting for. The way into the bar rules is not lost: select any row
        // and the strip above carries it.
        <div className={`shrink-0 ${pane === 'sheet' ? 'hidden md:block' : ''}`}>
          <GanttLegend rows={rows} styles={barStyles} onEdit={() => setStylesOpen(true)} />
        </div>
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

      {shift && (
        <ShiftPreviewBar
          projectId={projectId}
          rowId={shift.rowId}
          rowName={shift.rowName}
          shift={shift.preview}
          weeks={weeks}
          onApplied={() => {
            setShift(null);
            router.refresh();
          }}
          onDismiss={() => setShift(null)}
        />
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
          <div className="min-w-[19rem] sm:min-w-[44.75rem]">
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
              {/* Everything that is a number or a date is RIGHT-aligned, header
                  and value alike, so each column ends on one straight edge. The
                  header used to sit left of figures that sat right, which is
                  what made "DAYS  START" and "PRICE WEIGHT" read as one word
                  each with a hole beside them. */}
              <span className="text-right sm:hidden">Days</span>
              <span className="hidden text-right sm:block">Duration</span>
              <span className="hidden text-right sm:block">Start</span>
              <span className="text-right">Finish</span>
              <span className="hidden text-right sm:block">Target</span>
              <span className="hidden text-right sm:block">Price</span>
              <span className="hidden text-right sm:block">Weight</span>
              <span className="sr-only">Row actions</span>
            </div>

            {/* A search that matches nothing used to fall through to the
                first-run empty state below: "Nothing planned yet", with Import
                from Excel as the loudest thing on screen. Typing three letters
                made a 285-row plan look deleted and offered the one button that
                could overwrite it. The plan is still there; say so, and say how
                to get back to it. */}
            {visible.length === 0 && query.trim() !== '' && (
              <div className="animate-enter px-6 py-10 text-center">
                <p className="text-sm font-semibold">Nothing matches that search</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  All {rows.length} rows are still here. Clear the search to see them again.
                </p>
                <div className="mt-4 flex justify-center">
                  <m.button
                    type="button"
                    {...pressMotion}
                    onClick={() => setQuery('')}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium"
                  >
                    <X className="size-4" />
                    Clear search
                  </m.button>
                </div>
              </div>
            )}

            {visible.length === 0 && query.trim() === '' && (
              <div className="animate-enter px-6 py-10 text-center">
                <p className="text-sm font-semibold">Nothing planned yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Read the plan out of the workbook itself, or add the first row and use{' '}
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
                        className="btn-primary inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-medium"
                      >
                        <ClipboardPaste className="size-4" />
                        Import from Excel
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

            {/* Only the window is mounted; the rows above and below it are two
                spacers of exactly their own height, so the scrollbar and the
                Gantt's absolute row positions both stay honest. */}
            <div style={{ height: range.start * ROW_H }} aria-hidden />

            {/* Every prop here is a scalar or the one standing handler object —
                nothing is built fresh per render, which is the whole reason
                `Row` can be memoised. Adding an inline arrow to this list
                undoes it silently. */}
            {windowed.map((r) => (
              <Row
                key={r.id}
                highlight={term}
                row={r}
                currency={currency}
                selected={r.id === selectedId}
                collapsed={collapsed.has(r.id)}
                editing={editing?.rowId === r.id ? editing.field : null}
                paint={paintOf(r)}
                on={rowHandlers}
              />
            ))}

            <div
              aria-hidden
              style={{
                height:
                  Math.max(0, visible.length - Math.min(range.end, visible.length)) * ROW_H,
              }}
            />
          </div>
        </div>

        <div
          onPointerDown={onDragDivider}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the sheet"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-border transition-colors duration-200 hover:bg-foreground md:block"
        />

        <div className={`relative min-h-0 min-w-0 flex-1 ${pane === 'sheet' ? 'max-md:hidden' : ''}`}>
          {/* Outside the scroller on purpose: a control that scrolls away with
              the calendar is a control you have to go and find. */}
          {ganttStart && ganttFinish && (
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => setFitTimeline((f) => !f)}
              aria-pressed={fitTimeline}
              className={`absolute right-2 top-1.5 z-30 flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-medium shadow-sm ${
                fitTimeline ? 'bg-foreground text-background' : 'bg-card text-muted-foreground'
              }`}
            >
              <Maximize2 className="size-3" />
              Fit
            </m.button>
          )}
          <div
            ref={rightRef}
            onScroll={mirror('r')}
            className="h-full min-h-0 min-w-0 overflow-auto"
          >
          {/* The FULL list, plus the window. The surface has to keep its true
              height or every bar below the fold sits on the wrong line. */}
          <GanttChart
            rows={visible}
            spanStart={ganttStart}
            spanFinish={ganttFinish}
            rowH={ROW_H}
            headH={HEAD_H}
            selectedId={selectedId}
            onSelect={setSelectedId}
            styles={barStyles}
            range={range}
            fit={fitTimeline}
          />
          </div>
        </div>
      </div>

      {menuRow && (
        <RowMenu
          // Keyed on the mode as well as the row: `initialMode` is only read
          // when the panel mounts, so asking an already-open panel to show its
          // delete step did nothing at all until the key made it a new panel.
          key={`${menuRow.id}:${menuMode}`}
          row={menuRow}
          projectId={projectId}
          initialMode={menuMode}
          onClose={() => {
            setMenuRow(null);
            setMenuMode('menu');
          }}
          onChanged={() => router.refresh()}
          onDeleted={(undoId, name) => {
            if (!undoId) return;
            setUndoDelete({ id: undoId, name });
            rememberUndo(undoId);
          }}
          onUndoable={(run: () => Promise<ActionResult>) =>
            setUndoStack((s) => [...s.slice(-49), { kind: 'structure', run }])
          }
        />
      )}

      {undoDelete && (
        <UndoBar
          key={undoDelete.id}
          id={undoDelete.id}
          name={undoDelete.name}
          onUndo={runUndo}
          onDismiss={dismissUndo}
        />
      )}

      <BarStyleEditor
        projectId={projectId}
        styles={barStyles}
        source={barStyleSource}
        auto={barStyleAuto}
        pruned={barStylePruned}
        // Only the units this plan actually has, and by ID — a rule that says
        // "inside SPK-007" has to survive another unit being marked above it.
        units={rows
          .filter((r) => r.isReportingUnit)
          .map((r) => ({ id: r.id, name: r.unitLabel || r.name }))}
        open={stylesOpen}
        onClose={() => setStylesOpen(false)}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

/**
 * What stands in for the confirmation dialog on a leaf row.
 *
 * It has to be reachable with a thumb, so it sits at the foot of the viewport
 * above the home indicator rather than up beside the toolbar, and Undo is a
 * full 44px target. Ten seconds rather than the four a toast library defaults
 * to: this is the only way back, and the person who wants it is usually the one
 * who has just looked away from the screen.
 *
 * Keyed on the delete it belongs to, and handed callbacks that never change
 * identity: this sheet re-renders on every scroll tick, and a timer that
 * restarted with its parent would be a bar that never went away.
 */
function UndoBar({
  id,
  name,
  onUndo,
  onDismiss,
}: {
  id: string;
  name: string;
  onUndo: (id: string) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="animate-fade-in-up pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border bg-card py-2 pl-4 pr-2 shadow-lg">
        <p className="min-w-0 flex-1 truncate text-sm">
          Deleted <span className="font-semibold">{name}</span>
        </p>
        <button
          type="button"
          onClick={() => onUndo(id)}
          className="h-11 shrink-0 rounded-lg border px-4 text-sm font-semibold"
        >
          Undo
        </button>
      </div>
    </div>
  );
}

/**
 * What a row can ask the sheet to do. One object, shared by every row, built
 * once — see `rowHandlers`. Each call names the row it is about instead of the
 * handler having been closed over it.
 */
type RowHandlers = {
  select: (id: string) => void;
  toggle: (id: string) => void;
  edit: (id: string, field: Field) => void;
  done: () => void;
  commit: (row: SheetRow, field: Field, value: string) => void;
  menu: (row: SheetRow) => void;
  indent: (id: string, shift: boolean) => void;
  enter: (id: string) => void;
};

const Row = memo(function Row({
  row: r,
  currency,
  selected,
  collapsed,
  editing,
  highlight,
  paint,
  on,
}: {
  row: SheetRow;
  currency: string;
  selected: boolean;
  collapsed: boolean;
  editing: Field | null;
  /** The live search term, marked inside the name. */
  highlight?: string;
  /** Whatever colour the rule engine gave this row's bar. */
  paint: string;
  on: RowHandlers;
}) {
  // Bound to THIS row, inside the memo boundary — so they are rebuilt only when
  // this row re-renders, which is the point.
  const onSelect = () => on.select(r.id);
  const onToggle = () => on.toggle(r.id);
  const onEdit = (f: Field) => on.edit(r.id, f);
  const onDone = on.done;
  const onCommit = (f: Field, v: string) => on.commit(r, f, v);
  const onMenu = () => on.menu(r);
  const onIndent = (shift: boolean) => on.indent(r.id, shift);
  const onEnter = () => on.enter(r.id);

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
          style={{ background: paint }}
        />
        <span className="hidden sm:inline">{r.code}</span>
      </span>

      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: r.depth * 12 }}>
        {r.isSummary ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? `Expand ${r.name}` : `Collapse ${r.name}`}
            className="grid h-11 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background"
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
            style={{ background: paint }}
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
          highlight={highlight}
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

      {/* The unit travels with the number — `97 d`, the way MS Project writes
          it — so the column can be called Duration without leaving the reader
          to guess what it is measured in. The input still holds the bare
          number: a unit you have to delete before you can type is a unit that
          gets typed over. */}
      <div className="text-right tabular-nums">
        {locked ? (
          <span className="text-muted-foreground">
            {r.durationDays == null ? '—' : `${r.durationDays} d`}
          </span>
        ) : r.isMilestone ? (
          <span className="text-[11px] text-muted-foreground">—</span>
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

      <div className="hidden text-right tabular-nums sm:block">
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
            className="text-right text-[11px]"
          />
        )}
      </div>

      <div className="text-right tabular-nums">
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
            className="text-right text-[11px]"
          />
        )}
      </div>

      {/* Typed on EVERY row, summaries included — the one date a branch owns,
          because it is a promise rather than an observation about its children.
          `locked` deliberately does not gate it. */}
      <div className="hidden text-right tabular-nums sm:block">
        <EditableCell
          value={r.targetDate ?? ''}
          display={fmtDate(r.targetDate) || '—'}
          active={editing === 'target'}
          onEdit={() => onEdit('target')}
          onDone={onDone}
          onCommit={(v) => onCommit('target', v)}
          type="date"
          className={`text-right text-[11px] ${r.daysLate != null ? 'font-medium text-warn' : ''}`}
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
            group
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
        className="grid h-11 w-9 place-items-center justify-self-end rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  );
});

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
  highlight,
  group,
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
  /** The search term, marked inside the text while the cell is not being typed in. */
  highlight?: string;
  /** Money: group the digits as they are typed, and hand back a raw string. */
  group?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, active]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`block w-full truncate rounded px-1 py-[11px] text-left leading-[22px] decoration-dotted underline-offset-4 transition-colors hover:bg-background group-hover:underline ${className}`}
      >
        <Marked text={display ?? value} term={highlight} />
      </button>
    );
  }

  // Money keeps its separators on screen and loses them on the way out, so
  // every action that already strips them is untouched.
  const shown = group ? groupAmount(draft) : draft;
  const send = (v: string) => onCommit(group ? stripAmount(v) : v);

  return (
    <input
      autoFocus
      type={type}
      inputMode={inputMode}
      value={shown}
      onChange={(e) => setDraft(group ? stripAmount(e.target.value) : e.target.value)}
      onBlur={() => {
        send(draft);
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          send(draft);
          onDone();
          onEnterKey?.();
        }
        if (e.key === 'Escape') onDone();
        if (e.key === 'Tab' && onTab) {
          // Taken from the browser: Tab would walk to the next control, and in a
          // sheet shaped like an outline Tab means "one level in".
          e.preventDefault();
          send(draft);
          onDone();
          onTab(e.shiftKey);
        }
      }}
      className={`w-full rounded border-2 border-foreground bg-background px-1 py-1 leading-[22px] outline-none ${className}`}
    />
  );
}

/**
 * The search term, marked where it appears.
 *
 * Filtering alone tells you which rows matched but not WHERE — in a name like
 * "Detail Engineering Piping" a search for "pip" is invisible until it is
 * painted. Case-insensitive, first occurrence only: a second mark in the same
 * cell buys nothing and costs a render.
 */
function Marked({ text, term }: { text: string; term?: string }) {
  if (!term || term.length < 2) return <>{text}</>;
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-warn/25 text-foreground">
        {text.slice(at, at + term.length)}
      </mark>
      {text.slice(at + term.length)}
    </>
  );
}
