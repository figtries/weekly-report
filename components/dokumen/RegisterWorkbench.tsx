'use client';

import { startTransition, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FilePlus2, FolderPlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';

import { addCategory, addDocument, deleteCategory, renameCategory } from '@/lib/doc-actions';
import { knownDiscipline, nextNumber, defaultRule, type NumberingRule } from '@/lib/register-numbering';
import {
  REGISTER_INFO, isDone, needsAction, withUs, type DocumentCard, dataGroups, type DataGroup, type Obstacle, type RegisterNode, type RegisterSource,
} from '@/lib/register-shared';
import { CODE_TONE, codeLabel, docRev, stageOf, type RegisterSettings } from '@/lib/register-settings';
import type { ExistingNode } from '@/lib/builder-model';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';
import { matchesSearch, searchWords } from '@/lib/search';

import { RegisterSetup } from './RegisterSetup';
import { verdict } from './verdict';
import { OPEN_SETUP } from './RegisterTabs';
import NativeSelect from '@/components/ui/NativeSelect';
import { Button } from '@/components/ui/button';

// The Record transmittal pop-up went on 9 Oct 2026: a status is set on the
// document itself (DocumentSheet's StatusForm). TransmittalDialog.tsx stays, unlinked.
const DocumentSheet = dynamic(() => import('./DocumentSheet').then((x) => x.DocumentSheet));

/**
 * Where a register is worked on: EDL Data and VDRL Data (4 Oct 2026, variant B
 * of the mockups the user chose, "murni tempat olah data").
 *
 * One full-width list, grouped by discipline (or vendor package), with the
 * columns a document controller knows from the Excel register: number, title,
 * Rev, issue, code, who has it, plan date, last letter. Filters on top say
 * what is outstanding without a second block. A discipline's `+ Add` is how a
 * document goes in ("klik di mother-nya"); ticking rows turns the one primary
 * button into what they need (Send 3 as IFA, Record reply · 2); a row opens
 * the detail sheet, which opens and closes exactly like Data Overall's.
 *
 * Crucial fields that are empty are said in red, in a sentence that starts
 * with a capital (the user's rule, 4 Oct 2026): a document with no plan date
 * for its next stage, a discipline with no documents. A missing plan date is
 * said on its own row only (9 Oct 2026: a toolbar count and a filter on top of
 * the row's red Set date was the same reminder three times).
 *
 * Rows are plain elements, never Radix (AGENTS.md: a register can hold
 * hundreds); the one menu on screen is driven by the active group's id.
 */

type NumberingProps = { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };
type Filter = 'all' | 'action' | 'us' | 'them' | 'done';

type Group = DataGroup;

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const fmt = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

const needsPlan = (c: DocumentCard) => !isDone(c) && !c.out && c.nextStage !== null && !c.plannedAt;
const lastLetter = (c: DocumentCard) => {
  for (const s of [...c.stages].reverse()) {
    if (s.returnTransmittal) return s.returnTransmittal;
    if (s.submitTransmittal) return s.submitTransmittal;
  }
  return null;
};

/** Desktop columns: tick, No., Title, Rev, Issue, Code, With, Plan, Last letter. */
/** A phone's cards (the F-Phone mockup): rounder, lifted off the page. */
const phoneCard = 'overflow-hidden rounded-[22px] bg-card shadow-[0_0_0_1px_rgba(16,24,40,.04),0_4px_16px_-6px_rgba(16,24,40,.10)]';
const COLS = 'md:grid-cols-[2.25rem_10.5rem_minmax(0,1fr)_3.5rem_4rem_8.5rem_6.5rem] xl:grid-cols-[2.25rem_11rem_minmax(0,1fr)_2.75rem_3.5rem_4rem_9.5rem_6.5rem_8rem]';

export function RegisterWorkbench({
  projectId, register, tree, cards, totalDocuments, clientName, contractorName,
  numbering, sources, settings, nextLetters, overview,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  totalDocuments: number;
  /** The week on screen; the title no longer says it, the pages still pass it. */
  weekNo: number;
  clientName: string;
  contractorName: string;
  numbering: NumberingProps;
  sources: RegisterSource[];
  /** The register as it stands now, for transmittals (a letter is today's fact). */
  currentCards: Record<string, DocumentCard[]>;
  currentObstacles: Obstacle[];
  settings: RegisterSettings;
  nextLetters: { out: string; in: string };
  /** The register's own figures, for the phone's top card. */
  overview: { actual: number; plan: number | null; stages: { stage: DocStage; reached: number }[] };
}) {
  const edl = register === 'edl';
  const info = REGISTER_INFO[register];
  const against = overview.plan !== null ? verdict(overview.actual, overview.plan) : null;
  const other = edl ? 'client' : 'vendor';

  const groups = useMemo(() => dataGroups(tree), [tree]);

  const all = useMemo(() => groups.flatMap((g) => cards[g.id] ?? []), [groups, cards]);
  // Done is a GROUP at 100%: a group with one document still out read 86.7%
  // under the Done tab, beside its finished siblings (8 Oct 2026).
  // The group's own figure decides, rounded as it is printed beside the bar.
  const doneIds = useMemo(() => new Set(groups.flatMap((g) =>
    g.actual.toFixed(1) === '100.0' ? (cards[g.id] ?? []).filter(isDone).map((c) => c.id) : [],
  )), [groups, cards]);
  const counts = useMemo(() => ({
    all: all.length,
    action: all.filter(needsAction).length,
    us: all.filter(withUs).length,
    them: all.filter((c) => c.out !== null).length,
    done: doneIds.size,
  }), [all, doneIds]);
  const emptyGroups = groups.filter((g) => (cards[g.id] ?? []).length === 0).length;

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The header's Setup mark (RegisterTabs).
  useEffect(() => {
    const open = () => setBuilding(true);
    window.addEventListener(OPEN_SETUP, open);
    return () => window.removeEventListener(OPEN_SETUP, open);
  }, []);

  // `?doc=<id>` (a row on the Summary's Needs action) opens that document.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('doc');
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      setOpenId(id);
      const url = new URL(window.location.href);
      url.searchParams.delete('doc');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /** Adding into a folded group unfolds it first, or the box would open where nobody can see it. */
  const expand = (id: string) => setCollapsed((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n; });

  const groupOf = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const words = searchWords(query);
  const q = words.length > 0;
  /** A search unfolds every group: a hit inside a folded one read as nothing found. */
  const search = (v: string) => {
    if (!q && searchWords(v).length > 0) setCollapsed(new Set());
    setQuery(v);
  };
  const visible = (c: DocumentCard) => {
    const g = groupOf.get(c.categoryId);
    if (q && !matchesSearch(words, c.title, c.docNo, g?.name, g?.parentName)) return false;
    switch (filter) {
      case 'action': return needsAction(c);
      case 'us': return withUs(c);
      case 'them': return c.out !== null;
      case 'done': return doneIds.has(c.id);
      default: return true;
    }
  };

  const existing = useMemo(() => {
    const map = (n: RegisterNode): ExistingNode => ({ name: n.name, documents: n.documents, children: n.children.map(map) });
    return tree.map(map);
  }, [tree]);

  /* ------------------------------------------------------- the open document */

  const flatVisible = groups.flatMap((g) => (collapsed.has(g.id) ? [] : (cards[g.id] ?? []).filter(visible)));
  const openDoc = openId ? all.find((c) => c.id === openId) ?? null : null;
  const openGroup = openDoc ? groups.find((g) => g.id === openDoc.categoryId) : null;
  const openIndex = openDoc ? flatVisible.findIndex((c) => c.id === openDoc.id) : -1;
  const inGroup = openDoc ? (cards[openDoc.categoryId] ?? []) : [];

  if (building) {
    return (
      <RegisterSetup
        projectId={projectId}
        register={register}
        clientName={clientName}
        contractorName={contractorName}
        hasDocuments={totalDocuments > 0}
        settings={settings}
        existing={existing}
        numbering={numbering}
        sources={sources}
        onClose={() => setBuilding(false)}
      />
    );
  }

  const chips: { key: Filter; label: string; short: string; n: number; tone?: 'warn' | 'bad' }[] = [
    { key: 'all', label: 'All', short: 'All', n: counts.all },
    { key: 'action', label: 'Needs action', short: 'Action', n: counts.action, tone: 'warn' },
    { key: 'us', label: 'With us', short: 'Us', n: counts.us },
    { key: 'them', label: edl ? 'With client' : 'With vendor', short: edl ? 'Client' : 'Vendor', n: counts.them },
    { key: 'done', label: 'Done', short: 'Done', n: counts.done },
  ];

  return (
    <div className="flex flex-col gap-3 pb-24 sm:gap-4 md:pb-0">
      {/* ------------------------------------------------------------ toolbar */}
      {/* Each block rises in on Setup's own keyframe and steps, so coming back
          from Setup moves the way going into it does (4 Oct 2026). */}
      <div className={cn('animate-enter flex flex-wrap items-center gap-x-4 gap-y-3', emptyGroups === 0 && 'max-md:hidden')}>
        <h2 className="hidden min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-foreground md:block">{info.long}</h2>
        <div className="grid w-full grid-cols-2 gap-2 empty:hidden md:flex md:w-auto md:flex-wrap md:items-center">
          {emptyGroups > 0 && (
            <span className="col-span-2 flex h-9 items-center rounded-lg bg-bad-soft px-3.5 text-[12.5px] font-semibold text-bad">
              {emptyGroups} group{emptyGroups === 1 ? ' has' : 's have'} no documents yet
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ phone overview */}
      <section className={cn(phoneCard, 'animate-enter stagger-1 p-4 md:hidden')}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-[13px] font-semibold text-foreground">{info.long}</h2>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{totalDocuments} docs</span>
        </div>
        <div className="mt-1.5 flex items-end gap-2.5">
          <span className="text-[40px] font-semibold leading-none tracking-[-0.03em] text-foreground tabular-nums">
            {overview.actual.toFixed(1)}<span className="text-xl text-muted-foreground">%</span>
          </span>
          {overview.plan !== null && (
            <span className="pb-1 text-[13px] text-muted-foreground">plan <b className="font-semibold text-foreground tabular-nums">{overview.plan.toFixed(1)}%</b></span>
          )}
          {against && (
            <span className={cn('mb-1.5 ml-auto h-6 shrink-0 rounded-md px-[9px] text-xs font-semibold leading-6 tabular-nums', against.diff >= 0 ? 'bg-ok-soft text-ok' : against.chip)}>
              {against.diff > 0 ? `+${against.diff.toFixed(1)} ahead` : against.diff === 0 ? 'On plan' : `${Math.abs(against.diff).toFixed(1)} behind`}
            </span>
          )}
        </div>
        <div className="mt-2.5 flex flex-col gap-[3px]">
          <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-chart-1" style={{ width: `${clamp(overview.actual)}%` }} /></div>
          {overview.plan !== null && <div className="h-[3px] rounded-full bg-muted"><div className="h-[3px] rounded-full bg-chart-2" style={{ width: `${clamp(overview.plan)}%` }} /></div>}
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {overview.stages.map((s) => {
            const st = stageOf(settings, s.stage);
            return (
              <div key={s.stage} className="rounded-2xl p-2.5" style={{ background: `${st.color}14` }}>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><span className="h-2 w-2 rounded-full" style={{ background: st.color }} />{st.label}</div>
                <div className="mt-1 text-lg font-bold text-foreground tabular-nums">{s.reached}<span className="text-xs font-medium text-muted-foreground"> / {totalDocuments}</span></div>
                <div className="text-xs text-muted-foreground tabular-nums">{totalDocuments ? ((s.reached / totalDocuments) * 100).toFixed(1) : '0.0'}%</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Phones (the F-Phone mockup): the filters stand on the page, the picked one dark. */}
      <div className="animate-enter stagger-2 flex flex-col gap-2.5 md:hidden">
        {/* The filters are a bar like the tabs above (WeekSteps' look), every
            filter in view and the bar sharing the cards' edges: as a scrolling
            row of chips the last one ran off the screen (9 Oct 2026). */}
        <div className="flex items-stretch gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-5 gap-0.5 rounded-2xl bg-card p-1 shadow-sm ring-1 ring-foreground/5">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${c.label} ${c.n}`}
                  onClick={() => setFilter(c.key)}
                  className={cn(
                    // One word each (variant A, 9 Oct 2026): "Needs action" and
                    // "With client" wrapped and made the row uneven. The full
                    // name stays the desktop's and the screen reader's.
                    'flex min-h-12 min-w-0 flex-col items-center justify-start rounded-lg px-0.5 pb-1.5 pt-2 text-center transition-colors duration-200 ease-ios',
                    on ? 'bg-chart-1/10 text-chart-1 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)]' : 'text-foreground/80',
                  )}
                >
                  <span className={cn('text-[15px] font-bold leading-tight tabular-nums', !on && (c.tone === 'warn' ? 'text-warn' : c.tone === 'bad' ? 'text-bad' : 'text-foreground'))}>{c.n}</span>
                  <span title={c.label} className={cn('mt-0.5 whitespace-nowrap text-[11px] leading-tight', on ? 'font-semibold' : 'font-medium')}>{c.short}</span>
                </button>
              );
            })}
          </div>
          {/* Search is one press away rather than a standing box: the mockup has none. */}
          <button
            type="button"
            aria-label="Search documents"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v || query !== '')}
            className={cn('flex w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-foreground/5', searchOpen ? 'bg-chart-1/10 text-chart-1' : 'bg-card text-foreground')}
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        {searchOpen && (
          <div className="animate-fade-in-up relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search number or title"
              aria-label="Search number or title"
              className="h-11 w-full rounded-xl bg-card pl-10 pr-4 text-base shadow-[0_0_0_1px_rgba(16,24,40,.10)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </div>
        )}
      </div>

      {/* -------------------------------------------------------------- list */}
      <section className="animate-enter stagger-3 flex flex-col gap-3 md:block md:overflow-hidden md:rounded-2xl md:bg-card md:shadow-[0_0_0_1px_rgba(16,24,40,.04),0_1px_2px_rgba(16,24,40,.06)]">
        <div className="hidden items-center gap-3 border-b border-border/70 p-3 md:flex">
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={cn(
                  'h-9 shrink-0 rounded-lg px-3.5 text-[13px] font-medium transition-colors duration-200 ease-ios',
                  filter === c.key
                    ? (c.tone === 'bad' ? 'bg-bad text-white' : 'bg-primary-soft text-primary')
                    : (c.tone === 'bad' ? 'bg-bad-soft text-bad' : 'text-foreground/80 hover:bg-muted'),
                )}
              >
                {c.label}{' '}
                <span className={cn('tabular-nums', filter === c.key ? 'opacity-80' : c.tone === 'warn' ? 'font-semibold text-warn' : c.tone === 'bad' ? '' : 'text-muted-foreground')}>{c.n}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search number or title"
              aria-label="Search documents"
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 md:block md:max-h-[calc(100dvh-18.75rem)] md:overflow-y-auto md:scrollbar-none">
          {/* Column names: thin, like the Excel register's own header row. */}
          <div className={cn('sticky top-0 z-20 hidden h-9 items-center gap-x-3 border-b border-border/70 bg-[color-mix(in_srgb,var(--color-muted)_70%,var(--color-card))] px-4 text-xs font-medium text-muted-foreground backdrop-blur-none md:grid', COLS)}>
            <span />
            <span>No.</span><span>Title</span><span className="hidden xl:block">Rev</span><span>Issue</span><span className="text-center">Code</span>
            <span>With</span><span>Plan</span><span className="hidden xl:block">Last letter</span>
          </div>

          {groups.map((g) => {
            const docs = cards[g.id] ?? [];
            const shown = docs.filter(visible);
            if (filter !== 'all' && shown.length === 0) return null;
            if (q && shown.length === 0) return null;
            const open = !collapsed.has(g.id);
            return (
              // Never clipped on a wide screen: an overflow there would become the
              // sticky header's scroller and push it down over the first row.
              <div key={g.id} className={cn(phoneCard, 'overflow-visible md:rounded-none md:bg-transparent md:shadow-none')}>
                <div className="relative flex flex-wrap items-center gap-x-2 gap-y-2.5 px-4 pb-3 pt-3.5 md:sticky md:top-9 md:z-10 md:min-h-12 md:flex-nowrap md:border-b md:border-border/70 md:bg-[#f8faff] md:py-0">
                  <span aria-hidden className="hidden w-4 md:block" />
                  <button type="button" aria-expanded={open} onClick={() => {
                    // Folding is a wide screen's: a phone shows no chevron, so a tap there would hide rows unexplained.
                    if (!window.matchMedia('(min-width: 768px)').matches) return;
                    setCollapsed((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; });
                  }}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left md:ml-2 md:w-[22rem] md:flex-none md:items-center">
                    <ChevronDown className={cn('hidden h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform duration-200 ease-ios md:block', !open && '-rotate-90')} />
                    <span className="min-w-0 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-foreground [overflow-wrap:anywhere] md:text-[14px] md:tracking-normal">
                      {g.parentName && <span className="font-medium text-muted-foreground">{g.parentName} · </span>}{g.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums md:ml-auto md:pl-2">{docs.length} docs</span>
                  </button>
                  <span className="shrink-0 text-[20px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums md:hidden">
                    {g.actual.toFixed(1)}<span className="text-xs text-muted-foreground">%</span>
                  </span>
                  {/* Phone: the bars across the card, its plan beside them. */}
                  <div className="flex basis-full items-center gap-2 md:hidden">
                    <span className="flex flex-1 flex-col gap-[3px]">
                      <span className="h-1.5 rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${clamp(g.actual)}%` }} /></span>
                      {g.plan !== null && <span className="h-[3px] rounded-full bg-muted"><span className="block h-[3px] rounded-full bg-chart-2" style={{ width: `${clamp(g.plan)}%` }} /></span>}
                    </span>
                    {g.plan !== null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">plan {g.plan.toFixed(1)}</span>}
                  </div>
                  <div className="ml-4 hidden items-center gap-2.5 md:flex">
                    <span className="flex w-24 flex-col gap-[2px]">
                      <span className="h-1.5 rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${clamp(g.actual)}%` }} /></span>
                      {g.plan !== null && <span className="h-[3px] rounded-full bg-muted"><span className="block h-[3px] rounded-full bg-chart-2" style={{ width: `${clamp(g.plan)}%` }} /></span>}
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">{g.actual.toFixed(1)}%</span>
                    {g.plan !== null && <span className="text-xs text-muted-foreground tabular-nums">/ {g.plan.toFixed(1)}%</span>}
                  </div>
                  <button type="button" onClick={() => { expand(g.id); setAddingTo(addingTo === g.id ? null : g.id); setError(null); }}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary-soft px-3.5 text-[13px] font-semibold text-primary md:ml-auto md:h-8 md:px-3 md:text-[12.5px]">
                    <Plus className="hidden h-3.5 w-3.5 md:block" /><span className="md:hidden">+ </span>Add<span className="md:hidden"> document</span>
                  </button>
                  <div>
                    <button type="button" aria-label={`More for ${g.name}`} aria-expanded={menuFor === g.id} onClick={(e) => { setMenuAt(e.currentTarget); setMenuFor(menuFor === g.id ? null : g.id); }}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f3f4f6] text-[#374151] hover:bg-muted md:bg-transparent md:text-muted-foreground">
                      <span className="text-base leading-none">⋯</span>
                    </button>
                    {menuFor === g.id && (
                      <GroupMenu
                        anchor={menuAt}
                        name={g.name}
                        count={docs.length}
                        onAdd={() => { setMenuFor(null); expand(g.id); setAddingTo(g.id); }}
                        onClose={() => setMenuFor(null)}
                        onRename={(name) => renameCategory({ projectId, register, categoryId: g.id, name })}
                        onSub={(name) => addCategory({ projectId, register, name, parentId: g.id })}
                        onDelete={() => deleteCategory({ projectId, register, categoryId: g.id })}
                      />
                    )}
                  </div>
                </div>

                {open && addingTo === g.id && (
                  <AddLine
                    group={g}
                    numbering={numbering}
                    taken={[...numbering.taken]}
                    onAdd={async (title, kind, docNo) => {
                      const r = await addDocument({ projectId, register, categoryId: g.id, title, kind, docNo });
                      if (!r.ok) setError(r.error);
                      return r.ok;
                    }}
                    onClose={() => setAddingTo(null)}
                  />
                )}
                {open && docs.length === 0 && addingTo !== g.id && (
                  <p className="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-[13px] font-medium text-bad md:pl-[4.25rem]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />{g.name} has no documents yet. Add at least one, or remove it.
                  </p>
                )}
                {open && shown.map((c) => (
                  <Row
                    key={c.id}
                    card={c}
                    settings={settings}
                    other={other}
                    opened={openId === c.id}
                    onOpen={() => startTransition(() => setOpenId(c.id))}
                  />
                ))}
              </div>
            );
          })}
          {q && !all.some(visible) && (
            <p className="px-4 py-8 text-center text-[14px] font-medium text-foreground">
              No document{filter !== 'all' ? ` in ${chips.find((c) => c.key === filter)?.label}` : ''} matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
        </div>
        {error && <p role="alert" className="border-t border-border/70 bg-bad-soft px-4 py-2.5 text-sm text-bad">{error}</p>}
      </section>

      {openDoc && openGroup && (
        <DocumentSheet
          key={openDoc.id}
          projectId={projectId}
          register={register}
          doc={openDoc}
          groups={groups.map((g) => ({ id: g.id, name: g.parentName ? `${g.parentName} · ${g.name}` : g.name }))}
          settings={settings}
          rule={numbering.rule ?? defaultRule(numbering.suggestedPrefix)}
          nextLetter={nextLetters.out}
          position={{ index: Math.max(0, inGroup.findIndex((c) => c.id === openDoc.id)), total: inGroup.length, group: openGroup.name }}
          onPrev={openIndex > 0 ? () => setOpenId(flatVisible[openIndex - 1].id) : null}
          onNext={openIndex >= 0 && openIndex < flatVisible.length - 1 ? () => setOpenId(flatVisible[openIndex + 1].id) : null}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- one row */

function Row({
  card: c, settings, other, opened, onOpen,
}: {
  card: DocumentCard;
  settings: RegisterSettings;
  other: string;
  opened: boolean;
  onOpen: () => void;
}) {
  const done = isDone(c);
  const days = c.out?.days ?? null;
  // Red exactly where the Summary lists it: `waiting` (never a document at 100%).
  const late = c.action?.kind === 'waiting';
  const lateAt = c.action?.kind === 'late' ? c.action.since : null;
  const stage = c.stage ? stageOf(settings, c.stage).label : '—';
  const letterNo = lastLetter(c);
  const rev = docRev(settings, c.stages, c.revision);
  const with_ = done
    ? <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="h-3.5 w-3.5" />Done</span>
    : c.out
      ? <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', late && 'font-semibold text-bad')}>{other === 'client' ? 'Client' : 'Vendor'}{days !== null ? ` · ${days} d` : ''}{late && <span className="rounded-md bg-bad-soft px-1.5 text-[11px] font-semibold leading-5">Overdue</span>}</span>
      : <span><b className="font-semibold text-foreground">Us</b>{c.sendNext && <span className="text-muted-foreground"> · send {stageOf(settings, c.sendNext).label}</span>}</span>;
  const code = c.returnCode
    ? <span className={cn('rounded-md px-1.5 text-[11px] font-bold leading-5', CODE_TONE[c.returnCode] ?? 'bg-muted text-foreground')}>{codeLabel(settings, c.returnCode)}</span>
    : <span className="text-muted-foreground">—</span>;
  // A late document shows the date the Summary counts its lateness from.
  const plan = lateAt
    ? <span className="font-semibold text-bad">{fmt(lateAt)}</span>
    : needsPlan(c)
      // A press, not a warning: the row's click opens the sheet where the date is set.
      ? <span className="inline-flex h-[26px] items-center gap-1 whitespace-nowrap rounded-[7px] border border-dashed border-bad/70 bg-card px-2.5 text-xs font-semibold text-bad group-hover:bg-bad-soft"><Plus className="h-3 w-3" strokeWidth={2.6} />Set date</span>
      : c.plannedAt
        ? <span>{fmt(c.plannedAt)}</span>
        : <span className="text-muted-foreground">—</span>;

  return (
    <div
      onClick={onOpen}
      className={cn(
        'group relative flex min-h-16 cursor-pointer items-center gap-x-0 border-t border-border/60 px-4 transition-colors duration-150 ease-ios max-md:last:rounded-b-[22px] md:grid md:min-h-11 md:gap-x-3 md:border-t-0 md:border-b md:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_44px]',
        COLS,
        opened ? 'bg-muted/60' : 'hover:bg-muted/40',
      )}
    >
      {opened && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <span aria-hidden className="hidden md:block" />

      {/* Phone: two lines. Desktop: the cells below take over. */}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left md:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12px] tracking-[0.02em] text-muted-foreground [font-feature-settings:'tnum'_1,'zero'_1]">
            <span className="min-w-0 break-words">{c.docNo ?? 'No number'} · {stage}</span>{c.returnCode && code}
          </span>
          <span className="mt-[3px] block break-words text-[14px] font-semibold text-foreground">{c.title}</span>
          {needsPlan(c) && <span className="mt-0.5 block text-xs font-semibold text-bad">Plan date needed</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className={cn('block text-[15px] font-semibold tabular-nums', done ? 'text-ok' : 'text-foreground')}>{c.percent.toFixed(0)}%</span>
          <span className="block text-[11px] text-muted-foreground">{done ? 'Done' : c.out ? `${other === 'client' ? 'Client' : 'Vendor'}${days !== null ? ` · ${days} d` : ''}` : `Us${c.sendNext ? ` · ${stageOf(settings, c.sendNext).label}` : ''}`}</span>
        </span>
      </button>

      <button type="button" className={cn('hidden truncate text-left text-[12.5px] tabular-nums md:block [font-feature-settings:"tnum"_1,"zero"_1]', opened ? 'font-semibold text-primary' : 'text-foreground/80')}>
        {c.docNo ?? <span className="text-muted-foreground">No number</span>}
      </button>
      <button type="button" className="hidden break-words py-1.5 text-left text-[13.5px] font-medium text-foreground md:block">{c.title}</button>
      <span className="hidden text-[13px] font-medium text-foreground/80 tabular-nums xl:block">{rev ?? '—'}</span>
      <span className="hidden whitespace-nowrap text-[13px] font-semibold text-foreground md:block">{stage}</span>
      <span className="hidden items-center justify-center text-[13px] md:flex">{code}</span>
      <span className="hidden items-center text-[13px] leading-5 text-foreground/80 md:flex">{with_}</span>
      <span className="hidden text-[13px] text-foreground tabular-nums md:block">{plan}</span>
      <span className="hidden truncate text-[12.5px] text-muted-foreground tabular-nums xl:block">{letterNo ?? '—'}</span>
    </div>
  );
}

/* -------------------------------------------------- adding to a discipline */

function AddLine({
  group, numbering, taken, onAdd, onClose,
}: {
  group: Group;
  numbering: NumberingProps;
  taken: string[];
  onAdd: (title: string, kind: string, docNo: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'Doc' | 'Dwg'>('Doc');
  const [nudge, setNudge] = useState(false);
  const [pending, start] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  const rule = numbering.rule ?? defaultRule(numbering.suggestedPrefix);
  const section = knownDiscipline(group.name, rule) || !group.parentName ? group.name : group.parentName;
  const numberFor = (title: string, k: string, used: string[]) =>
    nextNumber(rule, section, group.name === section ? title : group.name, k, used);
  const preview = rule.prefix.trim() ? numberFor(text.trim() || 'Document', kind, taken) : '';

  const put = (raw: string) => {
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\t+/g, ' ').trim()).filter(Boolean);
    if (lines.length === 0) { setNudge(true); field.current?.focus(); return; }
    start(async () => {
      const used = [...taken];
      for (const title of lines) {
        const docNo = rule.prefix.trim() ? numberFor(title, kind, used) : '';
        if (docNo) used.push(docNo);
        if (!(await onAdd(title, kind, docNo))) return;
      }
      setText('');
      field.current?.focus();
    });
  };

  return (
    <div className="animate-fade-in-up border-b border-border/70 px-3 py-3 md:px-4">
      {/* Variant A (9 Oct 2026), as on Setup: the box holds only the title;
          Kind, Cancel and Add sit under it. A button inside the box read as a
          box in a box. */}
        <input
          ref={field}
          value={text}
          onChange={(e) => { setText(e.target.value); if (nudge) setNudge(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            put(text);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!/\r?\n/.test(pasted.trim())) return;
            e.preventDefault();
            put(pasted);
          }}
          placeholder="Title, or paste from Excel"
          aria-label={`New document in ${group.name}`}
          className={cn('h-11 w-full rounded-xl border-[1.5px] bg-card px-3.5 text-base outline-none ring-3 placeholder:text-muted-foreground/80 md:text-sm', nudge ? 'border-bad ring-bad/15' : 'border-primary ring-ring/20')}
        />
      {nudge && <p className="mt-1.5 text-xs font-semibold text-bad">Type a title first.</p>}
      <div className="mt-2 flex items-center gap-2">
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as 'Doc' | 'Dwg')} aria-label="Kind" wrapperClassName="w-[5.5rem] shrink-0" className="h-9 min-h-9 border-border bg-card pl-3 text-[13px] font-medium md:text-[13px]">
          <option value="Doc">Doc</option>
          <option value="Dwg">Dwg</option>
        </NativeSelect>
        {preview && (
          <span className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="text-xs text-muted-foreground">Number</span>
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[12.5px] font-semibold text-foreground tabular-nums">{preview}</span>
          </span>
        )}
        <Button variant="ghost" className="btn-cancel ml-auto h-9" onClick={onClose}>Cancel</Button>
        <Button className="h-9 min-w-20" disabled={pending} onClick={() => put(text)}>{pending ? 'Adding…' : 'Add'}</Button>
      </div>
    </div>
  );
}

/* --------------------------------------------- the one menu, for one group */

/** Under the ⋯ button and right-aligned to it, flipped above when the room is up there. */
function placeMenu(anchor: HTMLElement | null) {
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const width = Math.min(264, window.innerWidth - 32);
  const below = window.innerHeight - r.bottom - 8;
  const flip = below < 260 && r.top > below;
  // A button on the left half opens to the right of it, so the menu hangs off
  // the ⋯ it came from instead of floating loose at the screen's edge.
  const fromLeft = r.left + r.width / 2 < window.innerWidth / 2;
  const want = fromLeft ? r.left : r.right - width;
  return {
    left: Math.max(16, Math.min(want, window.innerWidth - width - 16)),
    fromLeft,
    top: flip ? undefined : r.bottom + 4,
    bottom: flip ? window.innerHeight - r.top + 4 : undefined,
    width,
    flip,
  };
}

function GroupMenu({
  anchor, name, count, onAdd, onRename, onSub, onDelete, onClose,
}: {
  anchor: HTMLElement | null;
  name: string;
  count: number;
  onAdd: () => void;
  onRename: (name: string) => Promise<{ ok: boolean }>;
  onSub: (name: string) => Promise<{ ok: boolean }>;
  onDelete: () => Promise<{ ok: boolean }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'sub'>('menu');
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  const empty = count === 0;
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium text-foreground hover:bg-muted active:bg-muted md:text-sm';
  const icon = 'h-[18px] w-[18px] shrink-0 text-muted-foreground';
  const submit = () => start(async () => {
    const v = value.trim();
    if (!v) return;
    const r = mode === 'rename' ? await onRename(v) : await onSub(v);
    if (r.ok) onClose();
  });
  // In a portal, fixed to the button (8 Oct 2026): inside the list, each
  // group's sticky header and the list's own scroller painted over it.
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(() => placeMenu(anchor));
  useEffect(() => {
    if (!anchor) return;
    const follow = () => setAt(placeMenu(anchor));
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.contains(t) && !panel.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // The menu stays put: while it is open the page under it does not scroll.
    const hold = (e: Event) => { if (!panel.current?.contains(e.target as Node)) e.preventDefault(); };
    window.addEventListener('wheel', hold, { passive: false, capture: true });
    window.addEventListener('touchmove', hold, { passive: false, capture: true });
    window.addEventListener('resize', follow);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('wheel', hold, true);
      window.removeEventListener('touchmove', hold, true);
      window.removeEventListener('resize', follow);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [anchor, onClose]);
  if (!at) return null;
  return createPortal(
    <div
      ref={panel}
      style={{ position: 'fixed', left: at.left, top: at.top, bottom: at.bottom, width: at.width, zIndex: 70, transformOrigin: `${at.flip ? 'bottom' : 'top'} ${at.fromLeft ? 'left' : 'right'}` }}
      className="animate-dropdown-in rounded-2xl border bg-card p-1.5 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.18)] ring-1 ring-foreground/5"
    >
      {mode === 'menu' ? (
        <>
          <p className="truncate px-3 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">{name}</p>
          <button type="button" className={item} onClick={onAdd}><FilePlus2 className={icon} />Add documents</button>
          <button type="button" className={item} onClick={() => { setMode('sub'); setValue(''); }}><FolderPlus className={icon} />Add a sub-discipline</button>
          <button type="button" className={item} onClick={() => { setMode('rename'); setValue(name); }}><Pencil className={icon} />Rename</button>
          <div className="mx-3 my-1 h-px bg-border" />
          <button type="button" disabled={!empty || pending} className={cn(item, 'items-start py-2.5 disabled:hover:bg-transparent', empty ? 'text-bad' : 'text-muted-foreground')} onClick={() => start(async () => { const r = await onDelete(); if (r.ok) onClose(); })}>
            <Trash2 className={cn(icon, 'mt-px', empty ? 'text-bad' : 'text-muted-foreground/60')} />
            <span className="min-w-0">
              <span className="block">Remove discipline</span>
              {!empty && <span className="mt-0.5 block text-xs font-normal leading-snug text-muted-foreground">Holds {count} document{count === 1 ? '' : 's'}. Move or delete them first.</span>}
            </span>
          </button>
        </>
      ) : (
        <div className="p-1.5">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
            placeholder={mode === 'rename' ? 'Name' : 'Sub-discipline name'}
            className="h-10 w-full rounded-xl border border-border px-3 text-base outline-none focus-visible:border-ring md:text-sm"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" onClick={onClose} className="btn-cancel h-9 rounded-lg px-3.5 text-sm">Cancel</button>
            <button type="button" disabled={pending} onClick={submit} className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{mode === 'rename' ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
