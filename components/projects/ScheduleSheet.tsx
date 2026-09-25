'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { m } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react';

import type { Sheet, SheetRow } from '@/lib/sheet';
import {
  isPending,
  predictAdd,
  predictDelete,
  predictIndent,
  predictMoveTo,
  predictOutdent,
  tmpRowId,
} from '@/lib/sheet-predict';
import {
  updateRowDatesAction,
  updateRowTargetAction,
  updateRowTextAction,
} from '@/lib/sheet-actions';
import {
  addRowAction,
  deleteRowAction,
  indentRowAction,
  moveRowToAction,
  readSheetAction,
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
import { groupAmount, stripAmount } from '@/lib/currency';
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
// The five fixed columns come to 19.25rem, plus five 6px gaps and 12px of
// padding either side: 362px of furniture, down from 588px when this sheet
// still carried Target, Price and Weight. The default leaves the NAME about
// 258px on top of that, which is what "Detail Engineering" needs — at 712 the
// name was down to its 8rem floor and every branch read "Detail…". The divider
// still moves; this is only where it starts. A fixed ratio instead of a width
// cut the price column off at 1240px and wasted half the timeline at 1920.
//
// Dropping three columns freed 226px at any given pane width, and this hands
// back rather more than half of it to the TIMELINE (620 rather than 800): the
// name gains 46px and the Gantt gains 180, because a name that reads and a
// timeline you can see are the same screen's two halves and the Gantt was the
// one being starved.
const SHEET_NATURAL = 620;
/** Neither pane is useful below this, so the drag stops there. */
const MIN_PANE = 300;
/**
 * What the six declared columns actually need: 19.25rem of fixed columns plus
 * an 8rem name, five 0.375rem gaps, and the sheet's own 0.75rem either side.
 * 490px, down from 716px when Target, Price and Weight were still here.
 *
 * Both numbers that should have respected the old figure were short of it. The
 * scrolling body was floored at 43.75rem, sixteen pixels under, so the grid
 * compressed its last column instead of scrolling; and the default split handed
 * the sheet 62% of the shell, which on a 1105px shell is 685px, so Weight
 * opened cut in half and Row actions opened off-screen entirely with no
 * scrollbar in sight to say so. The divider still moves wherever you want it;
 * drag under this and the pane scrolls honestly rather than clipping.
 */
const FULL_GRID = 490;

// Under 640px only the outline, the name, the duration and the row menu fit;
// dates and price move into the row's own panel. Above it, the full sheet.
// Under 640px the first column is the colour chip alone. A six-level outline
// code needs ~60px and truncates to nonsense in less, while indentation already
// carries the structure — and the full code is one tap away in the row panel.
// UNCHANGED by the nine-to-four column cut, and that is a measured decision
// rather than an omission. Start was briefly added here too, since the freed
// width made all four columns FIT below 640px: six tracks come to 370px, which
// clears even a 375px iPhone SE. But fitting is not the test. Measured on
// Gundih at 390px, the name column went from 170px to 100px, and "Relokasi 2
// Unit Ta…" became "Relok…" while three branches read "D…", "G.." and "I." —
// the one column you identify a row by, destroyed to show a date that is one
// tap away in the row panel. The phone keeps the name, the duration and the
// finish; Start joins the others below.
const GRID_SM = 'grid-cols-[0.75rem_minmax(5rem,1fr)_2.75rem_4.5rem_2.75rem]';
/**
 * Two headers for one column, one of them always display:none.
 *
 * A grid child that is hidden leaves the grid, so exactly one of these is in
 * flow at any width and the column count still matches GRID_SM and GRID_LG.
 * See the note on the hash cell for what happens when that arithmetic slips.
 */
const GRID_LG =
  'sm:grid-cols-[4.25rem_minmax(8rem,1fr)_4.25rem_4.25rem_4.25rem_2.25rem]';

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
type ActionResult = {
  ok: boolean;
  error?: string;
  gone?: true;
  newId?: string;
  undoId?: string;
  /** The authoritative rows, from the same transaction — see StructureResult. */
  sheet?: Sheet;
};

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
  | {
      kind: 'structure';
      run: () => Promise<ActionResult>;
      /**
       * How the step back looks before the server confirms it. Carried on the
       * stack rather than worked out at undo time, because by then all that is
       * left is an opaque thunk — and a Ctrl+Z that freezes for a second and a
       * half is the same complaint as a button that does.
       *
       * Absent on putting a deleted subtree back: those rows are not held here,
       * so there is nothing honest to draw until the server sends them.
       */
      predict?: (rows: SheetRow[]) => SheetRow[];
    };

export default function ScheduleSheet({
  rows: initialRows,
  spanStart,
  spanFinish,
  projectStart,
  projectFinish,
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
  /* `currency` left with the Price column: the sheet has no money on it now. */
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
  /** The Gantt's own span, which a row added past the end has to be able to widen. */
  const [span, setSpan] = useState({ start: spanStart, finish: spanFinish });

  /**
   * THE PAGE NO LONGER DELIVERS ROWS. This component owns them from mount on.
   *
   * `initialRows` seeds the state and is never adopted again, and that is the
   * whole defence. Rows used to arrive on whatever `router.refresh()` payload
   * came back next, which is fine until two are in flight: measured on 13 Sep
   * 2026 under 400ms of emulated latency, a GET issued before a delete was
   * answered eleven seconds after it and put the deleted row back on screen
   * (`scripts/verify-sheet-optimistic.mjs` caught it as `rows 22 -> 23`).
   * Guarding it with flags only narrowed the window — an arriving payload
   * carries nothing that says which request it answers.
   *
   * So every row that reaches this sheet now comes from a reply it asked for
   * and is holding: a structural action's own `sheet`, or `readSheetAction`
   * when something went wrong. `refreshQuiet` still re-renders the page, for
   * the row count in the header, the weight strip and the bar-style rules,
   * which are the page's and not this component's — and it can no longer race
   * anything, because nothing it returns is read here.
   */
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * A row this browser drew, and the row the server made of it.
   *
   * Everything in the optimistic path hangs off these two maps.
   *
   * `tmpReal` is what lets a SECOND change reach the database at all. The id on
   * screen while a row is arriving is a placeholder, and sending a placeholder
   * is refused with "That row is no longer in the plan" — which `structure`
   * swallows on purpose, because it normally means this sheet is behind. So a
   * second Add row pressed before the first had answered, an Enter typed at the
   * end of a name, a Tab, a Delete: each one was sent against `tmp-4`, refused,
   * and silently rolled back. The row appeared and then vanished, with nothing
   * on screen to say why. That is the bug.
   *
   * `realTmp` is the other direction and is used for ONE thing: the React key.
   * A row keeps the key it was born with when the placeholder becomes real
   * underneath it, so the name input you are typing into is not unmounted and
   * remounted mid-word — it keeps its draft, its focus and its cursor.
   */
  const tmpReal = useRef(new Map<string, string>());
  const realTmp = useRef(new Map<string, string>());
  /** The id the SERVER knows, if it knows one yet. Call it at send time, never earlier. */
  const resolveId = useCallback((id: string) => tmpReal.current.get(id) ?? id, []);
  /** The id this BROWSER first drew — stable across the swap, so React keeps the element. */
  const keyOf = useCallback((id: string) => realTmp.current.get(id) ?? id, []);

  /**
   * Structural writes go one at a time.
   *
   * Two in flight at once broke twice over. A second op could only name the
   * first one's placeholder, which is the GONE above; and two replies each
   * carrying a whole sheet can land in either order, which puts the older plan
   * back on screen. Queued, every op resolves its ids at SEND time — by then
   * every earlier placeholder has a real id — and the last reply is the last
   * word. The wait is not felt: the guess is already drawn.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const queued = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(fn, fn);
    chain.current = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  }, []);

  /**
   * What this browser is showing that the server has not confirmed yet.
   *
   * An action's reply carries the WHOLE sheet, so applying it wiped every other
   * guess still in flight: press Add row twice quickly and the first answer
   * took the second row off the screen — the same disappearance, from the other
   * end. Each pending change leaves its guess here and takes it back when its
   * own answer lands, and whatever is left is replayed on top of every sheet
   * that arrives.
   */
  const overlays = useRef<{ id: number; apply: (rows: SheetRow[]) => SheetRow[] }[]>([]);
  const overlaySeq = useRef(0);
  /** Draw a guess now, and hand back the way to drop it. */
  const overlay = useCallback((apply: (rows: SheetRow[]) => SheetRow[]) => {
    overlaySeq.current += 1;
    const o = { id: overlaySeq.current, apply };
    overlays.current = [...overlays.current, o];
    setRows((rs) => apply(rs));
    return () => {
      overlays.current = overlays.current.filter((x) => x.id !== o.id);
    };
  }, []);

  const applyRows = useCallback((next: SheetRow[], sheet?: Sheet) => {
    setRows(overlays.current.reduce((rs, o) => o.apply(rs), next));
    if (sheet) setSpan({ start: sheet.spanStart, finish: sheet.spanFinish });
  }, []);

  /**
   * Once, after the editing stops. A plan is typed one row after another, and
   * a page render per keystroke is five overlapping server renders for a strip
   * of numbers nobody is looking at yet.
   */
  const refreshQuiet = useCallback(() => {
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => {
      quietTimer.current = null;
      router.refresh();
    }, 700);
  }, [router]);
  useEffect(
    () => () => {
      if (quietTimer.current) clearTimeout(quietTimer.current);
    },
    []
  );

  /**
   * Go and get the plan as it stands.
   *
   * For the writers that live outside this component — paste, the row menu, a
   * date shift — and for putting the sheet right after an edit the server
   * refused. Both used to be `router.refresh()`.
   */
  const syncRows = useCallback(() => {
    startTransition(async () => {
      try {
        const fresh = await readSheetAction(projectId);
        applyRows(fresh.rows, fresh);
      } catch {
        /* nothing to put right if the read itself cannot be made */
      }
    });
    refreshQuiet();
  }, [projectId, applyRows, refreshQuiet]);

  /**
   * A writer that already has the rows hands them over; one that does not sends
   * this to go and get them. The row menu's own actions return a sheet for the
   * same reason the toolbar's do, so going back for it would be a round trip
   * spent on something already in the room.
   */
  const applySheet = useCallback(
    (sheet?: Sheet) => {
      if (!sheet) {
        syncRows();
        return;
      }
      applyRows(sheet.rows, sheet);
      refreshQuiet();
    },
    [applyRows, refreshQuiet, syncRows]
  );

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
  const ganttStart = projectStart ?? span.start;
  const ganttFinish = projectFinish ?? span.finish;

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

  /**
   * Bring a row that was just made onto the screen.
   *
   * With no row selected, Add row puts the new one at the END of the plan. On
   * the nine-row project that is still in front of you; on Gundih's 285 it is
   * twelve thousand pixels below the fold, and it is not even MOUNTED — only
   * the window is — so the button reads as dead no matter how fast the server
   * answers. Drawing the row instantly fixed nothing for that case, which is
   * why this is here and not a separate nicety.
   *
   * Positioned a third down rather than flush against an edge: a row pinned to
   * the top or bottom of a scroller reads as "the list jumped", not "here is
   * the row you asked for". Smooth only when the trip is short — this list is
   * windowed, and a smooth ride across two hundred rows is two hundred rows of
   * blank strip while the range chases it.
   */
  const revealRef = useRef<string | null>(null);
  useEffect(() => {
    const id = revealRef.current;
    if (!id) return;
    // One attempt, cleared either way: a row a live search excludes is not one
    // to go hunting for on some later render.
    revealRef.current = null;
    const i = visible.findIndex((r) => r.id === id);
    if (i < 0) return;
    // Whichever pane is on screen — below 768px they take turns and the hidden
    // one measures zero, the same rule `recomputeRange` follows.
    const el = leftRef.current?.clientHeight ? leftRef.current : rightRef.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top >= el.scrollTop && top + ROW_H <= el.scrollTop + el.clientHeight) return;
    const target = Math.max(0, top - el.clientHeight / 3);
    const far = Math.abs(target - el.scrollTop) > el.clientHeight * 2;
    el.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' });
  }, [visible]);

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

      /**
       * The guess goes up HERE, before the transition, never inside it.
       *
       * A state update made inside `startTransition(async …)` ahead of its
       * first await belongs to that action, and React holds it back until the
       * action has finished. So Enter closed the cell, the cell fell back to
       * the value it had — "New task" on a row just added — and the typed name
       * only came back when the server answered, 1.5 to 3 seconds later on the
       * deployment (25 Sep 2026, "hilang timbul"). `structure` has always put
       * its guess up outside the transition; this does the same.
       *
       * The target date moves nothing, so it is safe to show at once and to
       * work out "late by" here — the same subtraction the server does on the
       * next read. Dates are not guessed (see above).
       */
      const guess: Partial<SheetRow> | null =
        field === 'target'
          ? { targetDate: raw || null, daysLate: lateBy(raw || null, row.finishDate) }
          : field === 'name'
            ? { name: raw }
            : field === 'price'
              ? { price: raw === '' ? null : Number(raw) }
              : null;
      const drop = guess
        ? overlay((rs) => rs.map((r) => (r.id === resolveId(row.id) ? { ...r, ...guess } : r)))
        : () => {};

      startTransition(async () => {
        if (field === 'target') {
          // `.catch` and not a bare await: a throw would skip `drop()` and pin
          // the guess to the screen for good.
          const res = await queued(() => updateRowTargetAction(resolveId(row.id), raw)).catch(
            () => ({ ok: false as const, error: 'Something went wrong' })
          );
          drop();
          if (!res.ok) {
            setError(res.error);
            patch(resolveId(row.id), {
              targetDate: before || null,
              daysLate: lateBy(before || null, row.finishDate),
            });
            return;
          }
          patch(resolveId(row.id), guess!);
        } else if (field === 'name' || field === 'price') {
          /**
           * The typed value is held as an OVERLAY, not written straight into
           * the rows.
           *
           * A name typed into a row that is still on its way would otherwise be
           * painted over by that row's own answer — the server still calls it
           * "New task" until the rename lands — and the word you had just
           * finished typing would vanish under your hands for a second. The
           * overlay survives every sheet that arrives until the server holds
           * the value, and `resolveId` is what sends the rename to the row the
           * database actually made.
           */
          const res = await queued(() =>
            updateRowTextAction(resolveId(row.id), field, raw)
          ).catch(() => ({ ok: false as const, error: 'Something went wrong' }));
          drop();
          if (!res.ok) {
            setError(res.error);
            patch(
              resolveId(row.id),
              field === 'name' ? { name: before } : { price: before === '' ? null : Number(before) }
            );
            return;
          }
          patch(resolveId(row.id), guess!);
        } else {
          const res = await queued(() => updateRowDatesAction(resolveId(row.id), field, raw));
          if (!res.ok) {
            setError(res.error);
            return;
          }
          patch(resolveId(row.id), {
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
          setUndoStack((s) => [
            ...s.slice(-49),
            { kind: 'field', rowId: resolveId(row.id), field, before },
          ]);
      });
    },
    [patch, chainNodes, chainLinks, nameById, overlay, queued, resolveId]
  );

  /**
   * A structural edit: shown at once, settled when the server answers.
   *
   * This used to wait for BOTH a server action and a `router.refresh()` before
   * anything moved, and the comment here argued that one refresh is always
   * right. It is — it was the second trip that was wrong. The action returns
   * the authoritative sheet now (see `StructureResult`), so the rows arrive on
   * the reply this was already awaiting, and `predict` fills the seconds before
   * it with the part the browser genuinely knows.
   *
   * A failure does not restore a snapshot. Another edit may have landed in the
   * meantime, and a saved copy of "before" would then take that one back out
   * too — so the recovery is the same as it always was, one refresh, which is
   * also what a `gone` row needs.
   *
   * Still NOT on the undo stack by itself; `structureUndoable` does that.
   *
   * **The action is handed over as a THUNK, not as a promise already running.**
   * That is what lets it be queued, and being queued is what lets it name rows
   * by the id the server gave them: `resolveId` is read when the thunk is
   * finally called, after every change in front of it has answered.
   */
  const structure = useCallback(
    (
      run: () => Promise<ActionResult>,
      predict?: (rows: SheetRow[]) => SheetRow[],
      onOk?: (res: ActionResult) => void
    ) => {
      setError(null);
      // The guess goes up now and stays up — through other people's replies —
      // until this change's own answer makes it unnecessary.
      const drop = predict ? overlay(predict) : null;
      startTransition(async () => {
        /**
         * `onOk` runs INSIDE the queued call, not after it.
         *
         * It is where a placeholder learns the id the database gave it, and
         * the next change in the queue reads that id the moment the queue
         * advances. Done outside, the two are one microtask apart in the wrong
         * order — measured 14 Sep 2026: four presses of Add row, one row kept.
         * The first add answered, the second was released and sent `tmp-1` as
         * its anchor anyway, and the server refused it as a row that is no
         * longer in the plan. Whatever must be true before the next change is
         * sent belongs in here.
         */
        const res = await queued(async () => {
          const r = await run().catch(
            (): ActionResult => ({ ok: false, error: 'Something went wrong' })
          );
          // Before the sheet arrives, or the guess would be replayed on top of
          // rows that already contain it — the same row twice.
          drop?.();
          if (r.ok) {
            /**
             * `onOk` and the rows land in the SAME TICK, and that is not tidiness.
             *
             * `onOk` re-points the selection and the open editor from the
             * placeholder to the real id; `applyRows` swaps the rows to match.
             * Split across two ticks, React commits a render in between where
             * the editor names a row the sheet does not have yet — the cell goes
             * inactive for one frame, `EditableCell` reseeds its draft from the
             * value, and the half-typed name is gone. Measured 14 Sep 2026:
             * typing "Charlie" into a new row saved "New taskie", the tail of
             * the word landing after the reset.
             */
            onOk?.(r);
            if (r.sheet) applyRows(r.sheet.rows, r.sheet);
          }
          return r;
        });
        if (!res.ok) {
          // A row the server says is gone is not something to put in front of
          // anybody: this sheet is simply behind. Go and get the current rows.
          syncRows();
          if (!res.gone) setError(res.error ?? 'Something went wrong');
          return;
        }
        // The rows are already right; this is for the row count in the header
        // and the weight strip, which are the page's and not this component's.
        refreshQuiet();
      });
    },
    [applyRows, syncRows, refreshQuiet, overlay, queued]
  );

  /**
   * A structural change, and the move that takes it back.
   *
   * The inverse is built from the RESULT rather than named up front, because
   * the row an add creates has no id until the server answers.
   */
  const structureUndoable = useCallback(
    (
      run: () => Promise<ActionResult>,
      inverse: (res: ActionResult) => (() => Promise<ActionResult>) | null,
      predict?: (rows: SheetRow[]) => SheetRow[],
      undoPredict?: (rows: SheetRow[]) => SheetRow[]
    ) => {
      structure(run, predict, (res) => {
        const back = inverse(res);
        if (back)
          setUndoStack((s) => [
            ...s.slice(-49),
            { kind: 'structure', run: back, predict: undoPredict },
          ]);
      });
    },
    [structure]
  );

  /**
   * Add a row, and put it on screen before the network has heard of it.
   *
   * The temporary id is the whole bookkeeping: `isPending` reads it, and the
   * authoritative sheet clears the flag simply by not containing it. When the
   * answer lands, the selection AND the open editor follow the placeholder to
   * the real row — a toolbar whose subject quietly became null, or a cell that
   * closes itself mid-word, are the same silence this change exists to remove.
   *
   * **The new row is selected and its name is opened at once.** A row that
   * appears somewhere below with nothing focused is a row you then have to go
   * and find and click twice, which is what made adding several in a row feel
   * like fighting the sheet. Add row puts the caret straight in the new line's
   * name with the placeholder selected, so the next thing typed is the name.
   *
   * What it does NOT do is chain: Enter inside a cell commits that cell and
   * stops. Adding the next row from the end of a name lasted one day — you
   * finish typing, press Enter to mean "that's the name", and a row you did not
   * ask for appears underneath. Enter on a SELECTED row still adds one, which
   * keeps the keyboard path without putting it behind a key people press to
   * mean "done".
   */
  const addRow = useCallback(
    (anchorId: string | null, asChild = false) => {
      const tmpId = tmpRowId();
      revealRef.current = tmpId;
      // A row put INSIDE a folded branch is a row nobody can see, and the fold
      // was closed before it existed — it is not a preference about this row.
      if (asChild && anchorId)
        setCollapsed((c) => {
          if (!c.has(anchorId)) return c;
          const next = new Set(c);
          next.delete(anchorId);
          return next;
        });
      setSelectedId(tmpId);
      setEditing({ rowId: tmpId, field: 'name' });
      structure(
        // Resolved INSIDE the thunk: by the time the queue reaches this, a row
        // added a moment ago has a real id, and the anchor is that id and not
        // the `tmp-` the browser is still drawing.
        () =>
          addRowAction(projectId, {
            afterNodeId: anchorId ? resolveId(anchorId) : null,
            asChild,
          }),
        (rs) => predictAdd(rs, anchorId ? resolveId(anchorId) : null, asChild, tmpId),
        (res) => {
          const created = res.newId;
          if (!created) return;
          tmpReal.current.set(tmpId, created);
          realTmp.current.set(created, tmpId);
          revealRef.current = created;
          setSelectedId((cur) => (cur === tmpId ? created : cur));
          setEditing((cur) => (cur?.rowId === tmpId ? { rowId: created, field: cur.field } : cur));
          setUndoStack((s) => [
            ...s.slice(-49),
            {
              kind: 'structure',
              run: () => deleteRowAction(created),
              predict: (rs) => predictDelete(rs, created),
            },
          ]);
        }
      );
    },
    [structure, projectId, resolveId]
  );

  /** Ctrl+Z and the toolbar's Undo are two doors onto the same step back. */
  const rememberUndo = useCallback((undoId: string) => {
    setUndoStack((s) => [
      ...s.slice(-49),
      { kind: 'structure', run: () => undoDeleteRowAction(undoId) },
    ]);
  }, []);

  /**
   * Delete, and say so afterwards instead of asking first.
   *
   * A leaf goes straight away and lands on the undo stack, where the toolbar's
   * Undo and Ctrl+Z take it back; a row with children still gets the
   * confirmation panel, because what it takes is more than the row being
   * pointed at. That asymmetry is the point — the dialog is spent where it buys
   * something, and nowhere else.
   *
   * It used to drop a toast at the foot of the screen as well, carrying its own
   * Undo button. Removed 13 Sep 2026: on a phone it covered the bottom rows of
   * the sheet to offer a second copy of a button already in the toolbar.
   */

  const removeRow = useCallback(
    (row: SheetRow) => {
      if (row.childCount > 0) {
        setMenuMode('delete');
        setMenuRow(row);
        return;
      }
      structure(
        () => deleteRowAction(resolveId(row.id)),
        (rs) => predictDelete(rs, resolveId(row.id)),
        (res) => {
          if (res.undoId) rememberUndo(res.undoId);
        }
      );
    },
    [structure, rememberUndo, resolveId]
  );

  /**
   * Drag a row to where it belongs.
   *
   * Asked for on 14 Sep 2026, and the reason is worth keeping: Add inside had
   * put a new line at 3.1 when 3.3 was wanted, and putting it right meant
   * finding Move down in a menu and pressing it twice. Even with the ordering
   * fixed, a plan is shaped by moving things, and every other way of saying
   * "this line goes there" is two decisions — a level and a position — taken
   * one at a time through different controls.
   *
   * **MOUSE AND PEN ONLY.** A touch drag has to win the same gesture the list
   * uses to scroll, and the honest way to do that is a long press that locks
   * scrolling, which is a different job on iOS Safari than anywhere else. The
   * row menu's Move up / Move down is the phone's answer and stays.
   *
   * Three things make it aimable. The drop line is drawn AT THE DEPTH the row
   * will land at, so the one genuinely ambiguous drop — the gap under the last
   * line of a package — shows which side of the fence it is on before the
   * button comes up. The gap is computed from the pointer against `ROW_H` and
   * the scroller, never from whatever element happens to be under the cursor,
   * so it works the same over the mounted window and the two spacers that stand
   * in for the rest. And a drop under an OPEN branch means "first thing inside
   * it", which is the only way to aim at a package with nothing in it yet.
   */
  const [drag, setDrag] = useState<{ id: string; gap: number; depth: number } | null>(null);
  const pressRef = useRef<{
    id: string;
    x: number;
    y: number;
    depth: number;
    started: boolean;
  } | null>(null);
  const dropRef = useRef<{ parentId: string | null; afterId: string | null } | null>(null);
  const swallowClick = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /**
   * Where a drop puts the row: under whom, behind whom, how deep.
   *
   * The gap alone cannot say. Under the last line of a package, "after that
   * line" and "after the package" are the same place on screen and different
   * plans, which is why every outliner reads the HORIZONTAL position too:
   * `want` is a level, taken from how far left or right the pointer has
   * travelled in twelve-pixel steps, and it is clamped to the levels this gap
   * can actually offer — no deeper than a child of the row above, no shallower
   * than the row below, which would otherwise be re-parented behind your back.
   * Dragging left at the end of a package is how a row leaves it.
   */
  const dropAt = useCallback((gap: number, want: number, draggedId: string) => {
    const list = visibleRef.current;
    const above = gap > 0 ? list[gap - 1] : null;
    const below = list[gap] ?? null;
    if (!above) return { parentId: null, afterId: null, depth: 0 };

    const byId = new Map(list.map((r) => [r.id, r]));
    // A row can always become the first line inside the one above it, branch or
    // leaf — that is also the only way to aim at a package with nothing in it
    // yet. Below is the floor: landing shallower than the next row would take
    // that row's parent away from it.
    const max = above.depth + 1;
    const min = below ? below.depth : 0;
    const depth = Math.max(min, Math.min(max, want));

    let parentId: string | null;
    let afterId: string | null;
    if (depth === above.depth + 1) {
      parentId = above.id;
      afterId = null;
    } else {
      // Climb out of `above` until the level matches, and land behind whatever
      // we climbed out of.
      let a: SheetRow | null = above;
      while (a && a.depth > depth) a = a.parentId ? (byId.get(a.parentId) ?? null) : null;
      if (!a) return null;
      parentId = a.parentId;
      afterId = a.id;
    }

    // Behind itself is not a move, and inside itself is not a tree.
    if (afterId === draggedId) return null;
    for (let c = parentId, hops = 0; c && hops < 256; hops += 1) {
      if (c === draggedId) return null;
      c = byId.get(c)?.parentId ?? null;
    }
    return { parentId, afterId, depth };
  }, []);

  const moveTo = useCallback(
    (id: string, parentId: string | null, afterId: string | null) => {
      const rs = rowsRef.current;
      const i = rs.findIndex((r) => r.id === id);
      if (i < 0) return;
      const backParent = rs[i].parentId;
      // The sibling it used to sit behind, so Undo puts it back IN LINE and not
      // merely back under the same parent.
      let backAfter: string | null = null;
      for (let k = i - 1; k >= 0; k -= 1) {
        if (rs[k].depth < rs[i].depth) break;
        if (rs[k].parentId === backParent) {
          backAfter = rs[k].id;
          break;
        }
      }
      // A row dropped INSIDE a folded package is a row nobody can see, and the
      // fold was closed before it went in there — the same reasoning as
      // `addRow`, and the same two lines.
      if (parentId)
        setCollapsed((c) => {
          if (!c.has(parentId)) return c;
          const next = new Set(c);
          next.delete(parentId);
          return next;
        });
      const real = (x: string | null) => (x ? resolveId(x) : null);
      structureUndoable(
        () => moveRowToAction(resolveId(id), real(parentId), real(afterId)),
        () => () => moveRowToAction(resolveId(id), real(backParent), real(backAfter)),
        (rows) => predictMoveTo(rows, resolveId(id), real(parentId), real(afterId)),
        (rows) => predictMoveTo(rows, resolveId(id), real(backParent), real(backAfter))
      );
    },
    [structureUndoable, resolveId]
  );
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;

  /**
   * The whole gesture on two window listeners, bound once.
   *
   * Per-row handlers would have to be rebuilt every time the drop line moved,
   * which is the one thing `rowHandlers` exists to prevent.
   */
  const autoScroll = useRef(0);
  useEffect(() => {
    const gapFrom = (clientY: number) => {
      const el = leftRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const y = clientY - rect.top + el.scrollTop - HEAD_H;
      return Math.max(0, Math.min(visibleRef.current.length, Math.round(y / ROW_H)));
    };

    const edge = (clientY: number) => {
      const el = leftRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + HEAD_H + 44) return -1;
      if (clientY > r.bottom - 44) return 1;
      return 0;
    };
    const tick = () => {
      const el = leftRef.current;
      if (!autoScroll.current || !el) return;
      el.scrollTop += autoScroll.current * 14;
      requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const p = pressRef.current;
      if (!p) return;
      if (!p.started) {
        if (Math.abs(e.clientY - p.y) < 6 && Math.abs(e.clientX - p.x) < 6) return;
        p.started = true;
        document.body.style.cursor = 'grabbing';
      }
      // A drag is not a text selection, whatever the browser thinks.
      e.preventDefault();
      const gap = gapFrom(e.clientY);
      if (gap == null) return;
      // Twelve pixels is one level, the same step the rows are indented by.
      const want = p.depth + Math.round((e.clientX - p.x) / 12);
      const t = dropAt(gap, want, p.id);
      dropRef.current = t ? { parentId: t.parentId, afterId: t.afterId } : null;
      setDrag({ id: p.id, gap: t ? gap : -1, depth: t?.depth ?? 0 });
      const dir = edge(e.clientY);
      if (dir !== autoScroll.current) {
        autoScroll.current = dir;
        if (dir) requestAnimationFrame(tick);
      }
    };

    const stop = () => {
      const p = pressRef.current;
      pressRef.current = null;
      autoScroll.current = 0;
      document.body.style.cursor = '';
      setDrag(null);
      return p;
    };

    const onUp = () => {
      const p = pressRef.current;
      const target = dropRef.current;
      dropRef.current = null;
      stop();
      if (!p?.started) return;
      // The press that ended a drag is not a click on the cell it ended over.
      swallowClick.current = true;
      if (target) moveToRef.current(p.id, target.parentId, target.afterId);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pressRef.current) {
        dropRef.current = null;
        stop();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = '';
    };
  }, [dropAt]);

  /** The row being carried, and everything travelling with it. */
  const dragIds = useMemo(() => {
    if (!drag) return null;
    const i = visible.findIndex((r) => r.id === drag.id);
    if (i < 0) return null;
    const ids = new Set([visible[i].id]);
    for (let k = i + 1; k < visible.length && visible[k].depth > visible[i].depth; k += 1) {
      ids.add(visible[k].id);
    }
    return ids;
  }, [drag, visible]);

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
        structureUndoable(
          () => (shift ? outdentRowAction(resolveId(id)) : indentRowAction(resolveId(id))),
          () =>
            shift
              ? () => indentRowAction(resolveId(id))
              : () => outdentRowAction(resolveId(id)),
          (rs) => (shift ? predictOutdent(rs, resolveId(id)) : predictIndent(rs, resolveId(id))),
          (rs) => (shift ? predictIndent(rs, resolveId(id)) : predictOutdent(rs, resolveId(id)))
        ),
      press: (row, e) => {
        swallowClick.current = false;
        // Mouse and pen only; a touch owns the scroller. Left button only, and
        // never from inside an open cell, where a drag means selecting text.
        if (e.pointerType === 'touch' || e.button !== 0) return;
        if ((e.target as HTMLElement).closest('input')) return;
        // A filtered list has gaps that mean nothing: the row above a gap is
        // not the row a drop would land behind.
        if (queryRef.current.trim().length >= 2) return;
        pressRef.current = {
          id: row.id,
          x: e.clientX,
          y: e.clientY,
          depth: row.depth,
          started: false,
        };
      },
    }),
    [commit, structureUndoable, resolveId]
  );
  const queryRef = useRef(query);
  queryRef.current = query;

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
      structure(last.run, last.predict);
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
      // between every line is the reason people go back to Excel. This is the
      // ONLY Enter that adds a row: inside a cell the same key means "that is
      // the name", and it did both for a day, which cost a delete per row.
      if (e.key === 'Enter') {
        e.preventDefault();
        addRow(selectedId);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const shift = e.shiftKey;
        const id = selectedId;
        structureUndoable(
          () => (shift ? outdentRowAction(resolveId(id)) : indentRowAction(resolveId(id))),
          () =>
            shift ? () => indentRowAction(resolveId(id)) : () => outdentRowAction(resolveId(id)),
          (rs) => (shift ? predictOutdent(rs, resolveId(id)) : predictIndent(rs, resolveId(id))),
          (rs) => (shift ? predictIndent(rs, resolveId(id)) : predictOutdent(rs, resolveId(id)))
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, selectedId, visible, structureUndoable, addRow, resolveId]);

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
  const pasteAnchor = selectedId && !isPending(selectedId) ? selectedId : null;

  return (
    // NO `.animate-enter` HERE, and that is deliberate rather than an omission.
    // It was added so the plan would arrive with the same cascade as the header
    // and the value strip above it, and photographed at 1280 the cost was
    // obvious: PlannerSkeleton had already drawn sixteen rows of frame, the
    // route crossfaded into the real sheet, and the sheet then spent 120ms of
    // stagger plus 550ms of fade climbing from opacity 0 — so a screen that was
    // full of rows went BLANK and refilled. The entrance meant for arriving at
    // an empty page was undoing the skeleton's whole job.
    //
    // The route transition already carries this element: `RouteTransition` in
    // app/projects/[id]/page.tsx fades the page in over 200ms, skeleton and
    // plan alike. The cascade stays on the two bands above, which are small
    // enough that the frame under them is a couple of grey bars.
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <SheetToolbar
        rowCount={rows.length}
        selected={selected}
        canUndo={undoStack.length > 0}
        onUndo={undo}
        onAdd={() => addRow(anchor)}
        onAddChild={() => selectedId && addRow(selectedId, true)}
        onIndent={() =>
          selectedId &&
          structureUndoable(
            () => indentRowAction(resolveId(selectedId)),
            () => () => outdentRowAction(resolveId(selectedId)),
            (rs) => predictIndent(rs, resolveId(selectedId)),
            (rs) => predictOutdent(rs, resolveId(selectedId))
          )
        }
        onOutdent={() =>
          selectedId &&
          structureUndoable(
            () => outdentRowAction(resolveId(selectedId)),
            () => () => indentRowAction(resolveId(selectedId)),
            (rs) => predictOutdent(rs, resolveId(selectedId)),
            (rs) => predictIndent(rs, resolveId(selectedId))
          )
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
            // A row the server has not confirmed cannot anchor a paste, and
            // this dialog has no queue to wait in — so it pastes at the end
            // rather than being refused.
            afterNodeId={pasteAnchor}
            afterLabel={pasteAnchor ? (selected?.name ?? null) : null}
            onDone={syncRows}
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
            syncRows();
          }}
          onDismiss={() => setShift(null)}
        />
      )}

      <div
        ref={shellRef}
        // The press that ended a drag is not a click on whatever cell it ended
        // over: without this, dropping a row onto a name opened that name for
        // editing, which is the sort of thing that teaches people not to drag.
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden"
      >
        <div
          ref={leftRef}
          onScroll={mirror('l')}
          style={splitPx > 0 ? { width: splitPx } : { flex: '1 1 0%' }}
          className={`min-h-0 min-w-0 shrink-0 overflow-auto max-md:!w-full ${
            pane === 'gantt' ? 'max-md:hidden' : ''
          }`}
        >
          {/* 30.625rem is 490px, matching FULL_GRID: the six desktop tracks plus
              their gaps and the sheet's padding. Floor the body under what the
              grid needs and it compresses its last column instead of scrolling,
              with no scrollbar in sight to say so. The 19rem mobile floor is
              unchanged, because the mobile grid is. */}
          <div className={`relative min-w-[19rem] sm:min-w-[30.625rem] ${drag ? 'select-none' : ''}`}>
            {/* WHERE IT WILL LAND, drawn at the depth it will land at.
                The one drop a list like this cannot express by position alone
                is the gap under the last line of a package — inside it, or
                after it? The line's own indent answers that before the button
                comes up, which is what makes the drag aimable instead of
                hopeful. It hides itself over a drop that is not allowed (into
                its own subtree), so nothing has to be explained afterwards. */}
            {drag && drag.gap >= 0 && (
              /* Laid out on the ROW'S OWN GRID, so the line starts exactly where
                 a name starts and one level of indent looks like one level of
                 indent — at both breakpoints, without measuring anything. */
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 z-30 grid items-center gap-x-1.5 px-3 ${GRID_SM} ${GRID_LG}`}
                style={{ top: HEAD_H + drag.gap * ROW_H - 1 }}
              >
                <div
                  className="col-[2/-1] h-0.5 rounded-full bg-foreground"
                  style={{ marginLeft: drag.depth * 12 }}
                />
              </div>
            )}
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
              {/* Desktop only, so GRID_SM stays at five children and GRID_LG at
                  six. See the note on GRID_SM for why the phone does not take
                  this column even though it now fits. */}
              <span className="hidden text-right sm:block">Start</span>
              <span className="text-right">Finish</span>
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
                    onDone={syncRows}
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
                    onClick={() => addRow(null)}
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
                // The id this browser FIRST drew, which for a new row is its
                // `tmp-`. Keying on `r.id` meant the element was thrown away and
                // rebuilt the moment the server answered — in the middle of
                // typing the name, which is the one moment it happens. The cell
                // is a native input holding its own draft, so the word went with
                // it. See `realTmp`.
                key={keyOf(r.id)}
                highlight={term}
                row={r}
                selected={r.id === selectedId}
                collapsed={collapsed.has(r.id)}
                editing={editing?.rowId === r.id ? editing.field : null}
                paint={paintOf(r)}
                pending={isPending(r.id)}
                dragging={dragIds?.has(r.id) ?? false}
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
          initialMode={menuMode}
          onClose={() => {
            setMenuRow(null);
            setMenuMode('menu');
          }}
          onChanged={applySheet}
          onDeleted={(undoId) => {
            if (undoId) rememberUndo(undoId);
          }}
          onUndoable={(run: () => Promise<ActionResult>) =>
            setUndoStack((s) => [...s.slice(-49), { kind: 'structure', run }])
          }
          onPredict={(fn) => {
            setError(null);
            // Straight onto the rows, NOT through `applyRows`: that one replays
            // the overlays, and this guess is already sitting in what it would
            // replay them over.
            setRows((rs) => fn(rs));
          }}
          onFailed={(message) => {
            if (message) setError(message);
            syncRows();
          }}
          onAdd={(asChild) => addRow(menuRow.id, asChild)}
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
        onChanged={applySheet}
      />
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
  /** A press that MIGHT become a drag — see the drag block in the sheet. */
  press: (row: SheetRow, e: ReactPointerEvent) => void;
};

const Row = memo(function Row({
  row: r,
  selected,
  collapsed,
  editing,
  highlight,
  paint,
  pending,
  dragging,
  on,
}: {
  row: SheetRow;
  selected: boolean;
  collapsed: boolean;
  editing: Field | null;
  /** The live search term, marked inside the name. */
  highlight?: string;
  /** Whatever colour the rule engine gave this row's bar. */
  paint: string;
  /**
   * Drawn by this browser, not yet confirmed by the server.
   *
   * It fades in and sits at reduced weight while it arrives. It used to refuse
   * every edit as well, because its id is a placeholder and a rename sent from
   * it would name a row that has never existed — but that made the new row
   * inert for the whole round trip, so the first click on the name you had just
   * asked for did nothing at all. The sheet queues those edits now and sends
   * them against the real id (see `resolveId`), so the row can be typed into
   * from the instant it appears. The row menu is the one thing still held back:
   * it calls the server itself, with the id it was handed.
   */
  pending?: boolean;
  /** Being carried by a drag, or travelling with the row that is. */
  dragging?: boolean;
  on: RowHandlers;
}) {
  // Bound to THIS row, inside the memo boundary — so they are rebuilt only when
  // this row re-renders, which is the point.
  const onSelect = () => on.select(r.id);
  const onToggle = () => on.toggle(r.id);
  const onEdit = (f: Field) => on.edit(r.id, f);
  const onDone = on.done;
  const onCommit = (f: Field, v: string) => on.commit(r, f, v);
  const onMenu = () => !pending && on.menu(r);
  const onIndent = (shift: boolean) => on.indent(r.id, shift);

  /**
   * A SUMMARY ROW'S DATES ARE TYPED, NOT READ-ONLY.
   *
   * They were three grey spans until 14 Sep 2026, because a summary's span was
   * derived from its children and there was nothing for a typed value to mean.
   * On this kind of plan it means the most: the package is awarded with its
   * dates and the work inside is planned to fit them, so the row people most
   * want to type is the one that refused to be typed. `lib/sheet.ts` shows a
   * branch's own dates when it has them, and `updateRowDatesAction` refuses
   * anything that would break the fence in either direction.
   */
  /**
   * An empty cell says "nothing here yet"; a dash says "nothing here". A row
   * that is still arriving has not answered the question, so it does not put
   * three em dashes across the schedule columns on its way in.
   */
  const blank = pending ? '' : '—';

  return (
    <div
      onMouseDown={onSelect}
      onPointerDown={(e) => on.press(r, e)}
      className={`group grid items-center gap-x-1.5 border-b px-3 transition-colors duration-150 ${GRID_SM} ${GRID_LG} ${
        selected ? 'bg-muted' : 'hover:bg-muted/50'
      } ${r.isSummary ? 'font-semibold' : ''} ${
        pending ? 'animate-fade-in-up text-muted-foreground' : ''
      } ${dragging ? 'opacity-40' : ''}`}
      style={{ height: ROW_H }}
    >
      <span className="flex items-center gap-1.5 truncate text-[11px] tabular-nums text-muted-foreground">
        {/* The row's own colour, so the sheet and the timeline read as one thing
            rather than two lists that happen to be side by side. */}
        <span
          aria-hidden
          className="h-4 w-1 shrink-0 rounded-full"
          style={{ background: paint, opacity: pending ? 0.35 : 1 }}
        />
        {/* No outline code while pending: it is the one thing here the browser
            genuinely cannot know, and a guessed 1.3 that becomes 1.4 a second
            later teaches people not to trust the column. A breathing dot says
            "on its way" without claiming a number. */}
        <span className="hidden sm:inline">
          {pending ? <span className="animate-pulse" aria-label="Saving">·</span> : r.code}
        </span>
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
          highlight={highlight}
          className="truncate"
        />
        {r.isReportingUnit && (
          <span className="shrink-0 rounded bg-background px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
            {r.unitLabel || 'Unit'}
          </span>
        )}
        {/* The "Nd late" badge stood here, reading `daysLate`, which is derived
            from `targetDate`. It went with the Target column: an alert nobody
            on this screen can create, clear, or explain is the same problem as
            a 0% bar with no way to move it. */}
      </div>

      {/* The unit travels with the number — `97 d`, the way MS Project writes
          it — so the column can be called Duration without leaving the reader
          to guess what it is measured in. The input still holds the bare
          number: a unit you have to delete before you can type is a unit that
          gets typed over. */}
      <div className="text-right tabular-nums">
        {r.isMilestone ? (
          <span className="text-[11px] text-muted-foreground">{blank}</span>
        ) : (
          <EditableCell
            value={r.durationDays == null ? '' : String(r.durationDays)}
            /* The unit is dropped below 640px, where the column header reads
               DAYS and says it already. It is not a style choice: the track is
               44px and `455 d` measures 46, so a nine-month package on a phone
               read `45…` — a number you cannot trust is worse than a number
               without its unit. Nothing is taken from the name column, which is
               the one you identify a row by. */
            display={
              r.durationDays == null ? (
                blank
              ) : (
                <>
                  {r.durationDays}
                  <span className="hidden sm:inline"> d</span>
                </>
              )
            }
            active={editing === 'duration'}
            onEdit={() => onEdit('duration')}
            onDone={onDone}
            onCommit={(v) => onCommit('duration', v)}
            className="text-right"
            inputMode="numeric"
          />
        )}
      </div>

      {/* Desktop only, matching its header. On a phone the start date lives in
          the row panel, where reading it does not cost the name 70px. */}
      <div className="hidden text-right tabular-nums sm:block">
        <EditableCell
          value={r.startDate ?? ''}
          display={fmtDate(r.startDate) || blank}
          active={editing === 'start'}
          onEdit={() => onEdit('start')}
          onDone={onDone}
          onCommit={(v) => onCommit('start', v)}
          type="date"
          className="text-right text-[11px]"
        />
      </div>

      <div className="text-right tabular-nums">
        <EditableCell
          value={r.finishDate ?? ''}
          display={fmtDate(r.finishDate) || blank}
          active={editing === 'finish'}
          onEdit={() => onEdit('finish')}
          onDone={onDone}
          onCommit={(v) => onCommit('finish', v)}
          type="date"
          className="text-right text-[11px]"
        />
      </div>

      {/* Target, Price and Weight stood here until 12 Sep 2026.
          Scheduling a plan and pricing one are two jobs, and this screen is for
          the first: per-row money and the weights derived from it belong to Data
          Overall. Target went with them because nothing here can create one any
          more, and a date that shows but cannot be typed is worse than a date
          that is somewhere else. The columns are gone; `targetDate`, `price` and
          `bobot` are untouched in the database and still arrive through the
          importer and through paste-from-Excel. */}

      {/* Always drawn, never hover-only: there is no hover on a phone, and this
          app's rule is that no control lives there. */}
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
  highlight,
  group,
}: {
  value: string;
  /**
   * What to show when the cell is not being typed in, if that differs from the
   * value — `97 d` over `97`. A node rather than a string so a part of it can
   * be dropped by CSS at a width where it does not fit; the search mark only
   * runs over a plain string, which is the only kind the name column passes.
   */
  display?: ReactNode;
  active: boolean;
  onEdit: () => void;
  onDone: () => void;
  onCommit: (v: string) => void;
  className?: string;
  type?: 'text' | 'date';
  inputMode?: 'numeric' | 'decimal';
  /** Tab indents the row, Shift+Tab outdents it — the outliner convention. */
  onTab?: (shift: boolean) => void;
  /** The search term, marked inside the text while the cell is not being typed in. */
  highlight?: string;
  /** Money: group the digits as they are typed, and hand back a raw string. */
  group?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  /**
   * The draft follows the value ONLY WHILE THE CELL IS CLOSED.
   *
   * It used to follow it always (`[value, active]`), which reads as harmless
   * and is not: an effect re-runs whenever React decides to, and every run of
   * it overwrote whatever was being typed at that instant. Caught on 14 Sep
   * 2026 by a test that typed "Bravo" into a brand-new row and read back
   * "New taskavo" — the answer to the row's own Add landed mid-word, the effect
   * ran again, the draft went back to "New task" with the caret at its end, and
   * the rest of the word was typed onto that.
   *
   * Seeding on open is not needed and never was: a closed cell has already been
   * kept equal to the value by this same effect, so the draft is right the
   * moment it opens. What it buys is that nothing outside this input can touch
   * the text while the caret is in it.
   */
  useEffect(() => {
    if (!active) setDraft(value);
  }, [value, active]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={`block w-full truncate rounded px-1 py-[11px] text-left leading-[22px] decoration-dotted underline-offset-4 transition-colors hover:bg-background group-hover:underline ${className}`}
      >
        {typeof display === 'string' || display == null ? (
          <Marked text={display ?? value} term={highlight} />
        ) : (
          display
        )}
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
      // Entering a cell selects what is in it, the way a spreadsheet does. A
      // new row opens on the words "New task" with the caret parked after them,
      // and the first thing typed used to come out "New taskPiling" — the fix
      // for that is the same convention that makes retyping any cell one action
      // instead of three. Escape still puts the old value back untouched.
      onFocus={(e) => {
        if (type === 'text') e.currentTarget.select();
      }}
      onChange={(e) => setDraft(group ? stripAmount(e.target.value) : e.target.value)}
      onBlur={() => {
        send(draft);
        onDone();
      }}
      onKeyDown={(e) => {
        /**
         * ENTER COMMITS THE CELL AND STOPS THERE.
         *
         * It used to add the next row as well, the way an outliner does, so a
         * plan could be typed without the mouse. Rejected the same day it
         * shipped: you finish a name, press Enter to mean "that's the name",
         * and a row you did not ask for appears underneath — one to delete for
         * every one you meant. Enter on a row that is SELECTED rather than
         * being typed in still adds a row (see the window listener), so the
         * fast path is two deliberate presses and neither of them surprises
         * anybody.
         */
        if (e.key === 'Enter') {
          send(draft);
          onDone();
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
