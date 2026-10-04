'use client';

import { Suspense, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, ChevronDown, ChevronRight, FilePlus2, FolderPlus, MoreHorizontal, Search,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteCategory } from '@/lib/doc-actions';
import { DURATION, EASE } from '@/components/motion/Reveal';
import {
  STAGE_LABEL, type DocumentCard, type Obstacle, type RegisterNode, type RegisterSource,
} from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';
import type { NumberingRule } from '@/lib/register-numbering';
import { cn } from '@/lib/utils';

import { DocumentEditor } from './DocumentEditor';
import { OutstandingBlock } from './OutstandingBlock';
import { StageWeightsCard } from './StageWeightsCard';
import { verdict } from './verdict';
import { RegisterTools } from './RegisterTools';
import { RegisterBuilder } from './RegisterBuilder';

// The one overlay left: adding a document. It loads on demand.
const loadTransmittal = () => import('./TransmittalDialog');
const preloadTransmittal = () => { void loadTransmittal(); };
const TransmittalDialog = dynamic(loadTransmittal);
const AddDocumentDialog = dynamic(() => import('./AddDocumentDialog').then((m) => m.AddDocumentDialog));
const CategoryDialog = dynamic(() => import('./CategoryDialog').then((m) => m.CategoryDialog));

/**
 * Where the register is worked on.
 *
 * Pick a group, click a document, type. That is the whole interaction — the
 * screen this replaced asked people to tick boxes and then choose between
 * "record submission" and "record return" before they could fix anything, and
 * the modes were the first thing that confused them.
 *
 * No percentage is ever typed here. Dates and letters go in; the figures on
 * every row and on both summary screens are computed from them.
 *
 * **The right-hand column is never empty.** It used to hold a dashed box
 * saying "Pick a group to start" until you clicked something, which on a wide
 * screen left most of the workbench doing no work at all. It now opens on
 * the outstanding card (the summary's own, opening rows in place) and every row jumps into
 * the group it belongs to with that document already open.
 */

type NumberingProps = { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };

interface Group {
  id: string;
  name: string;
  packageName: string;
  node: RegisterNode;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * Every fill in Document Control is blue, and every plan is a thin red bar.
 *
 * Blue actual over a thin red plan bar on the same scale, the app-wide rule
 * (AGENTS.md, "Plan is a bar, not a tick"). This screen kept a red tick inside
 * the track and a pink shortfall until 3 Oct 2026, and the summary beside it
 * drew the plan as a bar, so the same discipline looked two ways.
 *
 * Hand-rolled rather than the shadcn `Progress`, which is a Radix primitive:
 * one per row would put a root, a context and a ref on every card in a column
 * that can run to sixty (AGENTS.md, "Radix per screen, never per row").
 */
function Bar({
  actual,
  plan = null,
  grow = false,
  className,
}: {
  actual: number;
  /** Null on the VDRL, which has no promised dates, so no red is invented. */
  plan?: number | null;
  grow?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {/* The width in the markup is already the true one; the keyframe only
          scales X on the compositor, so a phone that never receives the bundle
          still renders the right bar. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full bg-blue-500', grow && 'animate-bar-grow')}
          style={{ width: `${clamp(actual)}%` }}
        />
      </div>
      {plan !== null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn('block h-full rounded-full bg-red-500', grow && 'animate-bar-grow')}
            style={{ width: `${clamp(plan)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** What is open in a group, in the summary's own words and tones. */
function OpenChips({ node, size = 'sm' }: { node: RegisterNode; size?: 'sm' | 'md' }) {
  const chip = cn(
    'shrink-0 rounded-md font-medium tabular-nums',
    size === 'sm' ? 'px-1.5 py-0.5 text-[0.7rem]' : 'px-2 py-0.5 text-xs',
  );
  return (
    <>
      {node.overdue > 0 && <span className={cn(chip, 'bg-bad-soft text-bad')}>{node.overdue} late</span>}
      {node.returnedOpen > 0 && (
        <span className={cn(chip, 'bg-warn-soft text-warn')}>
          {node.returnedOpen} {node.returnedOpen === 1 ? 'comment' : 'comments'}
        </span>
      )}
    </>
  );
}

export function RegisterWorkbench({
  projectId,
  register,
  tree,
  cards,
  obstacles,
  totalDocuments,
  weekNo,
  asOfDate,
  awaiting,
  longestWait,
  clientName,
  contractorName,
  numbering,
  sources,
  currentCards,
  currentObstacles,
  stageWeights,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  /** Everything stuck, ranked. Feeds the right column before anything is picked. */
  obstacles: Obstacle[];
  totalDocuments: number;
  /** The week being reported. Every figure below is as it stood at its end. */
  weekNo: number;
  /** That week's last day, for the outstanding card's "due by". */
  asOfDate: string;
  /** Documents with the other side, and the longest of those waits. */
  awaiting: number;
  longestWait: number | null;
  /** Passed straight back on import so a file cannot blank them. */
  clientName: string;
  contractorName: string;
  /** The numbering rule and the numbers already spoken for. */
  numbering: NumberingProps;
  /** Other projects whose register the builder can copy. */
  sources: RegisterSource[];
  /** The register as it stands now, for Record transmittal (a letter is today's fact). */
  currentCards: Record<string, DocumentCard[]>;
  currentObstacles: Obstacle[];
  /**
   * What each stage is worth, drawn under the register (never under the
   * builder that replaces it). Plain data, not an element: an element passed
   * down from the page became a postponed PPR segment, S:3, which collided
   * with React's own S:3 and threw #418 on every load (4 Oct 2026, see
   * scripts/verify-hydration.mjs).
   */
  stageWeights: { stage: DocStage; weight: number }[];
}) {
  const reduced = useReducedMotion();

  const groups = useMemo(() => {
    const out: Group[] = [];
    const walk = (node: RegisterNode, packageName: string) => {
      if (node.children.length === 0) {
        // Zero-document groups appear too. `node.documents > 0` was right while
        // a register could only arrive from an importer, but a group somebody
        // just created is born empty — hiding it leaves nowhere to press Add.
        out.push({ id: node.id, name: node.name, packageName, node });
        return;
      }
      // The heading is the group's immediate parent, not the band at the top.
      for (const child of node.children) walk(child, node.name);
    };
    for (const root of tree) walk(root, root.name);
    return out;
  }, [tree]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The paste screen, opened over a register that already has documents. It is
  // the same screen an empty register lands on — there is one way to build a
  // register, not two that drift apart.
  const [building, setBuilding] = useState(false);
  // Record transmittal: mounted on first use and kept, so its choices survive
  // closing and reopening; its code is fetched on pointer down (see below).
  const [transmittalOpen, setTransmittalOpen] = useState(false);
  const [transmittalMounted, setTransmittalMounted] = useState(false);
  // Once the page has loaded and gone quiet, fetch the dialog's code and mount
  // it closed, so the first press only opens it (Export Excel does the same;
  // building it on the press was 82-94 ms at CPU 4x).
  useEffect(() => {
    let live = true;
    const idle = (fn: () => void) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
      else setTimeout(fn, 600);
    };
    const start = () => idle(() => { void loadTransmittal().then(() => { if (live) setTransmittalMounted(true); }); });
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => { live = false; window.removeEventListener('load', start); };
  }, []);
  const [categoryDialog, setCategoryDialog] = useState<
    | { mode: 'add'; parentId: string | null; parentName: string | null }
    | { mode: 'rename'; id: string; name: string }
    | null
  >(null);
  // Phones have no empty right-hand column to fill, so the worklist is a place
  // you go rather than a place you land. Desktop never reads this.
  const [mobileWorklist, setMobileWorklist] = useState(false);

  /**
   * Numbers used more than once. The register accepts them — real ones are like
   * that, and Petrogas' own EDL uses WPP-IN-LAY-003 twice — but accepting
   * without saying so means people meet it when it is already a dispute.
   */
  const duplicateNumbers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of Object.values(cards)) {
      for (const d of list) if (d.docNo) seen.set(d.docNo, (seen.get(d.docNo) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([no]) => no));
  }, [cards]);

  const selected = groups.find((g) => g.id === selectedId) ?? null;
  const outstanding = obstacles.filter((o) => o.kind !== 'untouched').length;
  const q = query.trim().toLowerCase();

  /** One row in the worklist opens both halves of the screen at once. */
  const openFromWorklist = (categoryId: string, documentId: string) => {
    setSelectedId(categoryId);
    setOpenDoc(documentId);
    setMobileWorklist(false);
  };

  /**
   * `?doc=<id>` opens that document, which is how a row under Outstanding on
   * the summary lands here ready to be updated. Read from `location` once on
   * mount rather than `useSearchParams`, which would make this route read a
   * request value at render; the address is then put back without it so a
   * reload does not reopen it.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('doc');
    if (!id) return;
    // In a frame rather than in the effect body, and the address is cleaned
    // there too: Strict Mode runs this twice, and cleaning it in the first run
    // would leave the second (the one that stays) with nothing to open.
    const frame = requestAnimationFrame(() => {
      const card = Object.values(cards).flat().find((d) => d.id === id);
      if (card) openFromWorklist(card.categoryId, card.id);
      const url = new URL(window.location.href);
      url.searchParams.delete('doc');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    });
    return () => cancelAnimationFrame(frame);
    // Once, on arrival: later edits re-render with new cards and must not reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Bring the open group into view in the column beside it.
   *
   * Jumping from a worklist row can land on a group thirty cards down, and
   * without this the picker went on highlighting a card nobody could see — the
   * panel said where you were and the column disagreed by saying nothing.
   *
   * `block: 'nearest'` is what keeps it quiet: a group you clicked yourself is
   * already on screen, so it scrolls by zero. On a phone the column is
   * `display: none` while a group is open, and an element with no box does not
   * scroll anything, so this costs nothing there.
   */
  const groupRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!selectedId) return;
    // Below lg the column is display:none while a group is open, so there is
    // nothing to bring into view, and asking anyway forced a layout of the
    // whole page before the first frame: 46 ms of a 100 ms press at CPU 4x
    // (traced 4 Oct 2026). On a wide screen it waits a frame, so the press
    // paints first and the column follows.
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const frame = requestAnimationFrame(() => {
      groupRefs.current.get(selectedId)?.scrollIntoView({
        block: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, reduced]);

  const matchingGroups = useMemo(
    () => (q === ''
      ? groups
      : groups.filter((g) =>
          g.name.toLowerCase().includes(q) ||
          g.packageName.toLowerCase().includes(q) ||
          (cards[g.id] ?? []).some((d) =>
            (d.docNo ?? '').toLowerCase().includes(q) || d.title.toLowerCase().includes(q)),
        )),
    [groups, cards, q],
  );

  const shown = useMemo(() => {
    const list = selected ? cards[selected.id] ?? [] : [];
    if (q === '') return list;
    return list.filter((d) =>
      (d.docNo ?? '').toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
  }, [selected, cards, q]);

  // The column shows the group list unless a group is open, or unless a phone
  // has gone looking at the worklist.
  const columnHidden = selected !== null || mobileWorklist;

  /**
   * What this register already holds, as the builder's headings: each root,
   * how many documents sit under it, and the leaves below it, so additions
   * land in the headings and sub-headings that exist instead of beside them.
   */
  const existing = useMemo(() => {
    const leaves = (n: RegisterNode): string[] =>
      n.children.flatMap((c) => (c.children.length > 0 ? leaves(c) : [c.name]));
    return tree.map((root) => ({ name: root.name, documents: root.documents, subheadings: leaves(root) }));
  }, [tree]);

  const tools = (
    <RegisterTools
      register={register}
      onAdd={() => setBuilding(true)}
      onTransmittal={() => { setTransmittalMounted(true); setTransmittalOpen(true); }}
      onTransmittalIntent={preloadTransmittal}
    />
  );
  const groupNames = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);

  if (building) {
    return (
      <RegisterBuilder
        projectId={projectId}
        register={register}
        clientName={clientName}
        contractorName={contractorName}
        hasDocuments={totalDocuments > 0}
        existing={existing}
        numbering={numbering}
        sources={sources}
        onClose={() => setBuilding(false)}
      />
    );
  }

  return (
    // On a wide screen this is a master–detail pane, not a page: it is exactly
    // as tall as the scroll port, and each column carries its own scroll. That
    // is what removes the whitespace instead of relocating it. Laid out as one
    // long page the group column ran several screens while the panel beside it
    // ended after fifteen rows, so scrolling blanked the right-hand half — the
    // same hole as the old empty state, reached by scrolling rather than by not
    // clicking. Neither column can now outrun the other.
    //
    // `sticky` was tried first and cannot do this job: a sticky box is held
    // inside its containing block, so once the page's scroll range fell to
    // 178px the column got shoved up out of the port and its search box was
    // clipped. 12rem = the port's own top (8rem) plus this wrapper's padding
    // (4rem, from the section layout's `lg:p-8` top and bottom).
    //
    // Phones keep the ordinary page: one column there, and it should scroll
    // like anything else.
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* ALWAYS here, whatever is open. It used to live inside the worklist,
          which meant opening a group took it off the screen and there was no
          way back to it — the one thing a person hunts for when they want to
          add something. A row of its own cannot be replaced by anything.

          It carries the register's own name and size on the left, because a
          row holding nothing but two right-aligned buttons reads as a band of
          empty space with something stranded in the corner. Paired, it is a
          toolbar: what you are looking at, and what you can do to it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">
            {register === 'edl' ? 'Engineering Drawing List' : 'Vendor Drawing Register List'}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {totalDocuments} document{totalDocuments === 1 ? '' : 's'} · week {weekNo}
          </p>
        </div>
        {tools}
      </div>

    <div className="pb-4 lg:grid lg:h-[calc(100dvh_-_15rem)] lg:grid-cols-[minmax(260px,340px)_1fr] lg:gap-6 lg:pb-0">
      {/* ------------------------------------------------------- categories */}
      {/* The classes go on the aside and the section themselves rather than on
          a `Reveal` wrapper: this is a two-column grid, and a wrapper div would
          become the grid child in their place and collapse the layout. */}
      <aside
        className={cn(
          'animate-enter flex-col gap-3 lg:min-h-0',
          columnHidden ? 'hidden lg:flex' : 'flex',
        )}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 pl-9"
            aria-label="Search documents"
          />
        </div>

        {/* Phones only. On a wide screen the worklist is already open to the
            right of this column, and a band pointing at it would be furniture. */}
        {outstanding > 0 && (
          <button
            type="button"
            onClick={() => setMobileWorklist(true)}
            className="flex min-h-12 items-center gap-2.5 rounded-xl border bg-card px-3.5 text-left transition-colors duration-300 ease-ios active:bg-muted lg:hidden"
          >
            <span className="flex-1 text-sm font-semibold">What has to go out</span>
            <span className="text-sm tabular-nums text-muted-foreground">{outstanding}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        )}

        {/* Only the groups scroll. Search stays put, because a picker whose
            search box scrolls away is a picker you have to scroll back up to
            use. `scrollbar-none` matches the app's own scroller — the classic
            Windows scrollbar reserves width and would pull every card's right
            edge in from the search box above it. */}
        <div className="flex flex-col gap-4 scrollbar-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-2">
          {/* THE CARDS DO NOT ANIMATE THEMSELVES. The column already arrives —
              `.animate-enter` sits on the aside above — and a cascade in here
              put a second translation on the same pixels: the container
              travelling 16px over 0.42s while each of the first twenty cards
              travelled another 8px over 0.26s on its own 40ms delay. Filmed at
              4x CPU throttle, neighbouring cards drifted 3px apart and snapped
              back mid-flight (gaps 94 → 97 → 94, 126 → 129 → 126) while the
              column itself moved 25px. Nothing scrolled — every scroller
              measured 0 the whole way — but a list whose rows stop holding
              their spacing reads as one, and it was reported as exactly that.
              One section, one entrance; see the entry scale in AGENTS.md. */}
          {groupByPackage(matchingGroups).map(([packageName, list]) => (
            <div key={packageName} className="flex flex-col gap-1.5">
              {/* A heading that only repeats the one card under it ("PROCESS"
                  over "Process") says nothing, so it goes. */}
              {!(list.length === 1 && list[0].name.trim().toLowerCase() === packageName.trim().toLowerCase()) && (
                <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {packageName}
                </p>
              )}
              {list.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  ref={(el) => {
                    if (el) groupRefs.current.set(g.id, el);
                    else groupRefs.current.delete(g.id);
                  }}
                  onClick={() => startTransition(() => { setSelectedId(g.id); setOpenDoc(null); })}
                  className={cn(
                    'w-full rounded-xl border px-3.5 py-3 text-left transition-colors duration-300 ease-ios',
                    selectedId === g.id
                      ? 'border-foreground/20 bg-muted'
                      : 'border-transparent bg-card hover:bg-muted/60',
                  )}
                >
                  {/* Three rows, one fact each. They used to be two, with the
                      progress and the document count run together as
                      `70% · 5` in one grey seven-pixel string — two different
                      units at the same weight, in a label whose width changed
                      with the numbers, so no two bars in the column were the
                      same length and the right edge came out ragged. */}
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                      {g.name}
                    </p>
                    {/* Fixed width and tabular figures: this is what makes every
                        percentage in the column land on one right edge, and
                        every bar below it end at the same place. */}
                    <span className="w-16 shrink-0 text-right text-base font-semibold leading-none tabular-nums tracking-tight">
                      {g.node.actual.toFixed(1)}
                      <span className="ml-px text-[0.7rem] font-medium text-muted-foreground">%</span>
                    </span>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>

                  {/* The bar still sweeps. It is a `scaleX` on the compositor,
                      not a layout change, so it cannot move a card the way the
                      removed cascade did — and capping by the column's own
                      length is the same test the document rows below already
                      use. */}
                  <Bar
                    className="mt-2.5"
                    actual={g.node.actual}
                    plan={g.node.plan}
                    grow={matchingGroups.length <= 20}
                  />

                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex-1 truncate text-xs tabular-nums text-muted-foreground">
                      {g.node.documents} document{g.node.documents === 1 ? '' : 's'}
                    </span>
                    {/* Only what is wrong speaks. A healthy group stays quiet,
                        which is the only thing that lets a stuck one carry. */}
                    <OpenChips node={g.node} />
                  </div>
                </button>
              ))}
            </div>
          ))}

          {matchingGroups.length === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">No match.</p>
          )}

          {/* At the foot of the column rather than beside the search box: this
              is where you arrive after reading what is already there, and it
              must not compete with the picker itself. */}
          <Button
            variant="outline"
            className="h-11 w-full"
            onClick={() => setCategoryDialog({ mode: 'add', parentId: null, parentName: null })}
          >
            <FolderPlus className="mr-1.5 h-4 w-4" /> Add group
          </Button>
        </div>
      </aside>

      {/* -------------------------------------------------------- documents */}
      <section
        className={cn(
          'animate-enter stagger-1 scrollbar-none lg:min-h-0 lg:overflow-y-auto lg:pb-8 lg:pr-0.5',
          columnHidden ? 'block' : 'hidden lg:block',
        )}
      >
        {!selected ? (
          <div className="flex flex-col gap-3">
            {mobileWorklist && (
              <Button
                variant="ghost"
                className="h-11 w-fit px-2 lg:hidden"
                onClick={() => setMobileWorklist(false)}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Groups
              </Button>
            )}
            <OutstandingBlock
              obstacles={obstacles}
              register={register}
              week={weekNo}
              asOfDate={asOfDate}
              awaiting={awaiting}
              longestWait={longestWait}
              query={query}
              onOpen={openFromWorklist}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* ------------------------------------------- the group's header */}
            {/* It used to be one grey line — `5 documents · 70.0% · plan
                100.0%` at eleven pixels — under the title. Those are the two
                most important figures on the screen and they were the least
                visible thing on it. */}
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2">
                <Button
                  variant="ghost" size="icon"
                  className="-ml-2 h-11 w-11 shrink-0 lg:hidden"
                  onClick={() => { setSelectedId(null); setOpenDoc(null); }}
                  aria-label="Back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {selected.packageName} · week {weekNo}
                  </p>
                  <h2 className="mt-0.5 text-lg font-semibold leading-tight">{selected.name}</h2>
                </div>
                <Button variant="outline" className="h-11 shrink-0" onClick={() => setAdding(true)}>
                  <FilePlus2 className="mr-1.5 h-4 w-4" /> Add
                </Button>
                {/* ONE menu, for the group that is open — not one per card.
                    The column can render every leaf of a 285-row register at
                    once, and a Radix instance per row is 285 contexts, refs and
                    portals. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost" size="icon" className="h-11 w-11 shrink-0"
                      aria-label="Group actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onSelect={() => setCategoryDialog({
                        mode: 'rename', id: selected.id, name: selected.name,
                      })}
                    >
                      Rename group
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setCategoryDialog({
                        mode: 'add', parentId: selected.id, parentName: selected.name,
                      })}
                    >
                      Add group inside
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={selected.node.documents > 0}
                      onSelect={async () => {
                        const result = await deleteCategory({
                          projectId, register, categoryId: selected.id,
                        });
                        if (result.ok) { setSelectedId(null); setOpenDoc(null); }
                      }}
                    >
                      {selected.node.documents > 0 ? 'Delete group: empty it first' : 'Delete group'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
                <Figure label="actual" value={selected.node.actual} className="text-blue-600" />
                {selected.node.plan !== null && (
                  <Figure label="plan" value={selected.node.plan} className="text-red-500" />
                )}
                {/* Beside the figures, not flung to the far edge. `ml-auto`
                    pushed these to the right margin and left a hole across the
                    middle of the card at any width above a phone; read as one
                    line they are a sentence about the same group. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {selected.node.plan !== null && (() => {
                    const v = verdict(selected.node.actual, selected.node.plan);
                    return (
                      <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium tabular-nums', v.chip)}>
                        {v.label}
                      </span>
                    );
                  })()}
                  <OpenChips node={selected.node} size="md" />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {selected.node.documents} document{selected.node.documents === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <Bar
                className="mt-3"
                actual={selected.node.actual}
                plan={selected.node.plan}
                grow
              />
            </div>

            {/* ---------------------------------------------- the documents */}
            <div className="flex flex-col gap-1.5">
              {/* No cascade here either, for the reason given up in the group
                  column: this list sits inside a `.animate-enter` section, and
                  the two translations together are what made the screen look
                  like it was scrolling itself. The section arrives; the rows
                  arrive with it. */}
              {shown.map((doc) => {
                const open = openDoc === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      // Off-screen rows skip layout and paint until scrolled to:
                      // a discipline of thirty documents laid all thirty out on
                      // the press that opened it (traced at CPU 4x, 4 Oct 2026).
                      'overflow-hidden rounded-xl border bg-card transition-shadow duration-300 ease-ios [content-visibility:auto] [contain-intrinsic-size:auto_68px]',
                      open ? 'shadow-md ring-1 ring-blue-600/30' : 'hover:shadow-sm',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenDoc(open ? null : doc.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-ios',
                          !open && '-rotate-90',
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {doc.docNo
                            ? <span className="font-mono text-xs font-medium">{doc.docNo}</span>
                            : <span className="text-xs text-muted-foreground">no number</span>}
                          {doc.docNo && duplicateNumbers.has(doc.docNo) && (
                            <Badge className="bg-amber-100 font-normal text-amber-800">
                              number used twice
                            </Badge>
                          )}
                          {doc.stage && (
                            <Badge variant="secondary" className="font-normal">{STAGE_LABEL[doc.stage]}</Badge>
                          )}
                          {doc.returnCode && (
                            <Badge className="bg-warn-soft font-normal text-warn">{doc.returnCode}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-sm">{doc.title}</p>
                      </div>

                      {/* Wider where there is room. At a fixed 96px the bar was
                          a stub with half the panel empty to its left — the
                          same hole the worklist had, one level down. */}
                      <div className="flex w-24 shrink-0 items-center gap-2.5 xl:w-56">
                        {/* Gated on the list being short, exactly as the daily
                            list is: one discipline can hold enough documents
                            that every row starting a 1s grow at once is real
                            work on a phone. */}
                        <Bar actual={doc.percent} grow={shown.length <= 20} />
                        <span className="w-8 text-right text-xs font-medium tabular-nums">
                          {doc.percent.toFixed(0)}
                          <span className="text-[0.65rem] text-muted-foreground">%</span>
                        </span>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {open && (
                        <m.div
                          initial={reduced ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: DURATION, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <DocumentEditor projectId={projectId} register={register} doc={doc} />
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {/* A group you just created lands here, and this line is the only
                  thing telling you what comes next — so it is a control, not a
                  grey sentence. Search that matches nothing keeps the plain
                  line: there the answer is to change the search, not to add. */}
              {shown.length === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {q === '' ? 'This group is empty.' : 'No documents match that search.'}
                  </p>
                  {q === '' && (
                    <Button variant="outline" className="h-11" onClick={() => setAdding(true)}>
                      <FilePlus2 className="mr-1.5 h-4 w-4" /> Add the first document
                    </Button>
                  )}
                </div>
              )}
            </div>

          </div>
        )}
      </section>

      {/* Outside the `adding` gate on purpose: a group is renamed, nested into
          or deleted whether or not a document is being added. */}
      {categoryDialog && (
        <CategoryDialog
          open
          onOpenChange={(o) => { if (!o) setCategoryDialog(null); }}
          projectId={projectId}
          register={register}
          editing={categoryDialog.mode === 'rename'
            ? { id: categoryDialog.id, name: categoryDialog.name }
            : undefined}
          parentId={categoryDialog.mode === 'add' ? categoryDialog.parentId : null}
          parentName={categoryDialog.mode === 'add' ? categoryDialog.parentName : null}
        />
      )}

      {/* Its own boundary: a lazy dialog suspends on its first render, and
          without one the suspension reached the page's (see ExportExcelButton). */}
      {transmittalMounted && (
        <Suspense fallback={null}>
          <TransmittalDialog
            open={transmittalOpen}
            onOpenChange={setTransmittalOpen}
            projectId={projectId}
            register={register}
            cards={currentCards}
            obstacles={currentObstacles}
            groupNames={groupNames}
          />
        </Suspense>
      )}

      {adding && selected && (
        <AddDocumentDialog
          open
          onOpenChange={setAdding}
          projectId={projectId}
          register={register}
          categoryId={selected.id}
          categoryName={selected.name}
        />
      )}
    </div>
    {/* A contract setting, moved here from the summary on 3 Oct 2026 because
        a summary reads and this screen writes. Off-screen until scrolled to,
        so its layout waits. */}
    <div className="mt-6 [content-visibility:auto] [contain-intrinsic-size:auto_220px]">
      <StageWeightsCard projectId={projectId} register={register} weights={stageWeights} />
    </div>
    </div>
  );
}

/** One figure, stated once, with its own word under it. */
function Figure({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div>
      <p className={cn('text-2xl font-semibold leading-none tabular-nums tracking-tight', className)}>
        {value.toFixed(1)}
        <span className="ml-0.5 text-sm font-medium">%</span>
      </p>
      <p className="mt-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function groupByPackage(groups: Group[]): Array<[string, Group[]]> {
  const map = new Map<string, Group[]>();
  for (const g of groups) {
    const list = map.get(g.packageName) ?? [];
    list.push(g);
    map.set(g.packageName, list);
  }
  return [...map.entries()];
}
