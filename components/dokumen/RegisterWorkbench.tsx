'use client';

import { Fragment, Suspense, startTransition, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { Check, ChevronDown, Download, Plus, Search, Send, Settings2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { addCategory, addDocument, deleteCategory, renameCategory } from '@/lib/doc-actions';
import { knownDiscipline, nextNumber, defaultRule, type NumberingRule } from '@/lib/register-numbering';
import {
  REGISTER_INFO, REPLY_DAYS, type DocumentCard, type Obstacle, type RegisterNode, type RegisterSource,
} from '@/lib/register-shared';
import { CODE_TONE, codeLabel, docRev, stageOf, type RegisterSettings } from '@/lib/register-settings';
import type { ExistingNode } from '@/lib/builder-model';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

import { RegisterBuilder } from './RegisterBuilder';

const loadTransmittal = () => import('./TransmittalDialog');
const preloadTransmittal = () => { void loadTransmittal(); };
const TransmittalDialog = dynamic(loadTransmittal);
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
 * for its next stage, a discipline with no documents. They are counted in the
 * toolbar, and the count is a filter.
 *
 * Rows are plain elements, never Radix (AGENTS.md: a register can hold
 * hundreds); the one menu on screen is driven by the active group's id.
 */

type NumberingProps = { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };
type Filter = 'all' | 'action' | 'us' | 'them' | 'done' | 'info';

interface Group { id: string; name: string; parentName: string | null; node: RegisterNode }

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const fmt = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

const isDone = (c: DocumentCard) => c.percent >= 100 && !c.out;
const needsPlan = (c: DocumentCard) => !isDone(c) && !c.out && c.nextStage !== null && !c.plannedAt;
const needsAction = (c: DocumentCard) =>
  c.overdue || Boolean(c.returnCode && c.sendNext) || (c.out !== null && (c.out.days ?? 0) > REPLY_DAYS);
const lastLetter = (c: DocumentCard) => {
  for (const s of [...c.stages].reverse()) {
    if (s.returnTransmittal) return s.returnTransmittal;
    if (s.submitTransmittal) return s.submitTransmittal;
  }
  return null;
};

/** Desktop columns: tick, No., Title, Rev, Issue, Code, With, Plan, Last letter. */
const COLS = 'md:grid-cols-[2.25rem_10.5rem_minmax(0,1fr)_3.5rem_4rem_8.5rem_6.5rem] xl:grid-cols-[2.25rem_11rem_minmax(0,1fr)_2.75rem_3.5rem_4rem_9rem_6.5rem_8.5rem]';

export function RegisterWorkbench({
  projectId, register, tree, cards, totalDocuments, weekNo, clientName, contractorName,
  numbering, sources, currentCards, currentObstacles, settings, nextLetters, overview,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  totalDocuments: number;
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
  const other = edl ? 'client' : 'vendor';

  const groups = useMemo(() => {
    const out: Group[] = [];
    const walk = (node: RegisterNode, parent: string | null) => {
      if (node.children.length === 0) { out.push({ id: node.id, name: node.name, parentName: parent, node }); return; }
      for (const child of node.children) walk(child, node.name);
    };
    for (const root of tree) walk(root, null);
    return out;
  }, [tree]);

  const all = useMemo(() => groups.flatMap((g) => cards[g.id] ?? []), [groups, cards]);
  const counts = useMemo(() => ({
    all: all.length,
    action: all.filter(needsAction).length,
    us: all.filter((c) => !isDone(c) && !c.out).length,
    them: all.filter((c) => c.out !== null).length,
    done: all.filter(isDone).length,
    info: all.filter(needsPlan).length,
  }), [all]);
  const emptyGroups = groups.filter((g) => (cards[g.id] ?? []).length === 0).length;

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [letter, setLetter] = useState<{ open: boolean; preset: { direction: 'out' | 'in'; ids: string[] } | null }>({ open: false, preset: null });
  const [letterMounted, setLetterMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the letter dialog's code once the page is quiet, so the first press only opens it.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => { void loadTransmittal().then(() => { if (live) setLetterMounted(true); }); }, 900);
    return () => { live = false; window.clearTimeout(t); };
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

  const q = query.trim().toLowerCase();
  const visible = (c: DocumentCard) => {
    if (q && !(c.title.toLowerCase().includes(q) || (c.docNo ?? '').toLowerCase().includes(q))) return false;
    switch (filter) {
      case 'action': return needsAction(c);
      case 'us': return !isDone(c) && !c.out;
      case 'them': return c.out !== null;
      case 'done': return isDone(c);
      case 'info': return needsPlan(c);
      default: return true;
    }
  };

  const tickedCards = all.filter((c) => ticked.has(c.id));
  const sendStages = new Set(tickedCards.map((c) => c.sendNext));
  const canSend = tickedCards.length > 0 && tickedCards.every((c) => c.sendNext && !c.out);
  const canReply = tickedCards.length > 0 && tickedCards.every((c) => c.out);
  const sendLabel = canSend && sendStages.size === 1 ? stageOf(settings, [...sendStages][0]!).label : null;

  const primary = tickedCards.length === 0
    ? { text: 'Record transmittal', run: () => openLetter(null) }
    : canSend
      ? { text: `Send ${tickedCards.length}${sendLabel ? ` as ${sendLabel}` : ''}`, run: () => openLetter({ direction: 'out', ids: [...ticked] }) }
      : canReply
        ? { text: `Record reply · ${tickedCards.length}`, run: () => openLetter({ direction: 'in', ids: [...ticked] }) }
        : { text: 'Record transmittal', run: () => openLetter(null) };

  function openLetter(preset: { direction: 'out' | 'in'; ids: string[] } | null) {
    setLetterMounted(true);
    setLetter({ open: true, preset });
  }

  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g: Group, on: boolean) => setTicked((s) => {
    const n = new Set(s);
    for (const c of cards[g.id] ?? []) { if (on) n.add(c.id); else n.delete(c.id); }
    return n;
  });

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

  const chips: { key: Filter; label: string; n: number; tone?: 'warn' | 'bad' }[] = [
    { key: 'all', label: 'All', n: counts.all },
    { key: 'action', label: 'Needs action', n: counts.action, tone: 'warn' },
    { key: 'us', label: 'With us', n: counts.us },
    { key: 'them', label: edl ? 'With client' : 'With vendor', n: counts.them },
    { key: 'done', label: 'Done', n: counts.done },
  ];
  if (counts.info > 0) chips.push({ key: 'info', label: 'Plan date needed', n: counts.info, tone: 'bad' });

  return (
    <div className="flex flex-col gap-3 pb-24 sm:gap-4 md:pb-0">
      {/* ------------------------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{info.long}</h2>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground tabular-nums">
            {totalDocuments} documents · week {weekNo}
            {(contractorName || clientName) && <span className="hidden sm:inline"> · {contractorName || 'Contractor'} → {clientName || 'Client'}</span>}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {(counts.info > 0 || emptyGroups > 0) && (
            <button
              type="button"
              onClick={() => counts.info > 0 && setFilter('info')}
              className="col-span-2 h-9 rounded-full bg-bad-soft px-3.5 text-[12.5px] font-semibold text-bad"
            >
              {counts.info > 0
                ? `Plan date needed on ${counts.info} document${counts.info === 1 ? '' : 's'}`
                : `${emptyGroups} group${emptyGroups === 1 ? ' has' : 's have'} no documents yet`}
            </button>
          )}
          {tickedCards.length > 0 && (
            <span className="hidden items-center gap-2 text-[13px] text-muted-foreground md:flex">
              <b className="text-foreground">{tickedCards.length}</b> selected
              <Button variant="outline" className="h-10" onClick={() => setTicked(new Set())}>Clear</Button>
            </span>
          )}
          <Button variant="outline" className="h-10" asChild>
            <a href={`/api/register/export?register=${register}`} download><Download className="mr-1.5 h-4 w-4" />Export</a>
          </Button>
          <Button variant="outline" className="h-10" onClick={() => setBuilding(true)}>
            <Settings2 className="mr-1.5 h-4 w-4" />Setup
          </Button>
          <Button className="col-span-2 h-10" onClick={primary.run} onPointerDown={preloadTransmittal}>
            <Send className="mr-1.5 h-4 w-4" />{primary.text}
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------ phone overview */}
      <section className="rounded-[22px] bg-card p-4 shadow-[0_0_0_1px_rgba(16,24,40,.04),0_4px_16px_-6px_rgba(16,24,40,.10)] md:hidden">
        <div className="flex items-end gap-2.5">
          <span className="text-[40px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
            {overview.actual.toFixed(1)}<span className="text-xl text-muted-foreground">%</span>
          </span>
          {overview.plan !== null && (
            <span className="pb-1 text-[13px] text-muted-foreground">plan <b className="text-foreground tabular-nums">{overview.plan.toFixed(1)}%</b></span>
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
              <div key={s.stage} className="rounded-2xl bg-muted/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><span className="h-2 w-2 rounded-[3px]" style={{ background: st.color }} />{st.label}</div>
                <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">{s.reached}<span className="text-xs font-medium text-muted-foreground"> / {totalDocuments}</span></div>
                <div className="text-xs text-muted-foreground tabular-nums">{totalDocuments ? ((s.reached / totalDocuments) * 100).toFixed(1) : '0.0'}%</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- list */}
      <section className="overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_rgba(16,24,40,.04),0_1px_2px_rgba(16,24,40,.06)]">
        <div className="flex flex-col gap-3 border-b border-border/70 p-3 md:flex-row md:items-center">
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 scrollbar-none md:mx-0 md:flex-wrap md:px-0">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={cn(
                  'h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-200 ease-ios',
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
          <div className="relative md:ml-auto md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search number or title"
              aria-label="Search documents"
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
        </div>

        <div className="md:max-h-[calc(100dvh-19rem)] md:overflow-y-auto md:scrollbar-none">
          {/* Column names: thin, like the Excel register's own header row. */}
          <div className={cn('sticky top-0 z-20 hidden h-9 items-center gap-x-3 border-b border-border/70 bg-muted/70 px-4 text-xs font-medium text-muted-foreground backdrop-blur-none md:grid', COLS)}>
            <span />
            <span>No.</span><span>Title</span><span className="hidden xl:block">Rev</span><span>Issue</span><span>Code</span>
            <span>With</span><span className="text-right">Plan</span><span className="hidden xl:block">Last letter</span>
          </div>

          {groups.map((g) => {
            const docs = cards[g.id] ?? [];
            const shown = docs.filter(visible);
            if (filter !== 'all' && shown.length === 0) return null;
            if (q && shown.length === 0) return null;
            const open = !collapsed.has(g.id);
            const allTicked = docs.length > 0 && docs.every((c) => ticked.has(c.id));
            return (
              <Fragment key={g.id}>
                <div className="sticky top-0 z-10 flex min-h-12 items-center gap-2 border-b border-border/70 bg-[#f8faff] px-3 md:top-9 md:px-4">
                  <input
                    type="checkbox"
                    aria-label={`Select every document in ${g.name}`}
                    checked={allTicked}
                    disabled={docs.length === 0}
                    onChange={(e) => toggleGroup(g, e.target.checked)}
                    className="hidden h-4 w-4 accent-primary md:block"
                  />
                  <button type="button" aria-expanded={open} onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })}
                    className="flex min-w-0 items-center gap-2 text-left md:ml-2">
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-ios', !open && '-rotate-90')} />
                    <span className="min-w-0 truncate text-[14px] font-semibold text-foreground">
                      {g.parentName && <span className="font-medium text-muted-foreground">{g.parentName} · </span>}{g.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{docs.length} docs</span>
                  </button>
                  <div className="ml-1 hidden items-center gap-2 sm:flex">
                    <span className="flex w-16 flex-col gap-[2px]">
                      <span className="h-1.5 rounded-full bg-muted"><span className="block h-1.5 rounded-full bg-chart-1" style={{ width: `${clamp(g.node.actual)}%` }} /></span>
                      {g.node.plan !== null && <span className="h-[3px] rounded-full bg-muted"><span className="block h-[3px] rounded-full bg-chart-2" style={{ width: `${clamp(g.node.plan)}%` }} /></span>}
                    </span>
                    <span className="text-xs font-semibold text-foreground tabular-nums">{g.node.actual.toFixed(1)}%</span>
                    {g.node.plan !== null && <span className="text-xs text-muted-foreground tabular-nums">/ {g.node.plan.toFixed(1)}%</span>}
                  </div>
                  <span className="ml-auto text-sm font-semibold text-foreground tabular-nums sm:hidden">{g.node.actual.toFixed(1)}%</span>
                  <button type="button" onClick={() => { setAddingTo(addingTo === g.id ? null : g.id); setError(null); }}
                    className="ml-auto hidden h-8 shrink-0 items-center gap-1 rounded-full bg-primary-soft px-3 text-[12.5px] font-semibold text-primary sm:flex">
                    <Plus className="h-3.5 w-3.5" />Add
                  </button>
                  <div className="relative">
                    <button type="button" aria-label={`More for ${g.name}`} aria-expanded={menuFor === g.id} onClick={() => setMenuFor(menuFor === g.id ? null : g.id)}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                      <span className="text-base leading-none">⋯</span>
                    </button>
                    {menuFor === g.id && (
                      <GroupMenu
                        name={g.name}
                        empty={docs.length === 0}
                        onAdd={() => { setMenuFor(null); setAddingTo(g.id); }}
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
                    ticked={ticked.has(c.id)}
                    opened={openId === c.id}
                    onTick={() => toggle(c.id)}
                    onOpen={() => startTransition(() => setOpenId(c.id))}
                  />
                ))}
              </Fragment>
            );
          })}
          {flatVisible.length === 0 && filter !== 'all' && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing here.</p>
          )}
        </div>
        {error && <p role="alert" className="border-t border-border/70 bg-bad-soft px-4 py-2.5 text-sm text-bad">{error}</p>}
      </section>

      {/* Phones: what is ticked, and the one thing to do with it, under the thumb. */}
      {tickedCards.length > 0 && (
        <div className="animate-fade-in-up fixed inset-x-3 bottom-4 z-30 flex items-center gap-3 rounded-full bg-[#0f172a] py-2 pl-5 pr-2 shadow-[0_12px_32px_-8px_rgba(15,23,42,.45)] md:hidden">
          <span className="text-sm text-white"><b className="tabular-nums">{tickedCards.length}</b> selected</span>
          <button type="button" onClick={() => setTicked(new Set())} className="h-9 px-2 text-[13px] text-slate-300">Clear</button>
          <button type="button" onClick={primary.run} className="ml-auto h-11 rounded-full bg-[#2563eb] px-5 text-sm font-semibold text-white">{primary.text}</button>
        </div>
      )}

      {openDoc && openGroup && (
        <DocumentSheet
          key={openDoc.id}
          projectId={projectId}
          register={register}
          doc={openDoc}
          groups={groups.map((g) => ({ id: g.id, name: g.parentName ? `${g.parentName} · ${g.name}` : g.name }))}
          settings={settings}
          nextLetter={nextLetters.out}
          position={{ index: Math.max(0, inGroup.findIndex((c) => c.id === openDoc.id)), total: inGroup.length, group: openGroup.name }}
          onPrev={openIndex > 0 ? () => setOpenId(flatVisible[openIndex - 1].id) : null}
          onNext={openIndex >= 0 && openIndex < flatVisible.length - 1 ? () => setOpenId(flatVisible[openIndex + 1].id) : null}
          onSend={(doc) => openLetter({ direction: 'out', ids: [doc.id] })}
          onReply={(doc) => openLetter({ direction: 'in', ids: [doc.id] })}
          onClose={() => setOpenId(null)}
        />
      )}

      {letterMounted && (
        <Suspense fallback={null}>
          <TransmittalDialog
            open={letter.open}
            onOpenChange={(o) => { setLetter((l) => ({ ...l, open: o })); if (!o) setTicked(new Set()); }}
            projectId={projectId}
            register={register}
            cards={currentCards}
            obstacles={currentObstacles}
            groupNames={Object.fromEntries(groups.map((g) => [g.id, g.name]))}
            preset={letter.preset}
            nextLetters={nextLetters}
            settings={settings}
          />
        </Suspense>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- one row */

function Row({
  card: c, settings, other, ticked, opened, onTick, onOpen,
}: {
  card: DocumentCard;
  settings: RegisterSettings;
  other: string;
  ticked: boolean;
  opened: boolean;
  onTick: () => void;
  onOpen: () => void;
}) {
  const done = isDone(c);
  const days = c.out?.days ?? null;
  const late = days !== null && days > REPLY_DAYS;
  const stage = c.stage ? stageOf(settings, c.stage).label : '—';
  const letterNo = lastLetter(c);
  const rev = docRev(settings, c.stages, c.revision);
  const with_ = done
    ? <span className="inline-flex items-center gap-1 font-medium text-ok"><Check className="h-3.5 w-3.5" />Done</span>
    : c.out
      ? <span className={cn(late && 'font-semibold text-bad')}>{other === 'client' ? 'Client' : 'Vendor'}{days !== null ? ` · ${days} d` : ''}{late && <span className="block text-[11px] font-medium leading-3">overdue</span>}</span>
      : <span><b className="font-semibold text-foreground">Us</b>{c.sendNext && <span className="text-muted-foreground"> · send {stageOf(settings, c.sendNext).label}</span>}</span>;
  const code = c.returnCode
    ? <span className={cn('rounded-md px-1.5 text-[11px] font-bold leading-5', CODE_TONE[c.returnCode] ?? 'bg-muted text-foreground')}>{codeLabel(settings, c.returnCode)}</span>
    : <span className="text-muted-foreground">—</span>;
  const plan = needsPlan(c)
    ? <span className="inline-block rounded-full border border-bad/40 bg-bad-soft px-2 text-[11.5px] font-semibold leading-[22px] text-bad">Plan date needed</span>
    : c.plannedAt
      ? <span className={cn(c.overdue && 'font-semibold text-bad')}>{fmt(c.plannedAt)}</span>
      : <span className="text-muted-foreground">—</span>;

  return (
    <div
      className={cn(
        'group relative flex min-h-11 items-center gap-x-3 border-b border-border/60 px-1 transition-colors duration-150 ease-ios md:grid md:px-4 [content-visibility:auto] [contain-intrinsic-size:auto_44px]',
        COLS,
        ticked ? 'bg-primary-soft/60' : opened ? 'bg-muted/60' : 'hover:bg-muted/40',
      )}
    >
      {opened && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
      <label className="flex h-11 w-11 shrink-0 items-center justify-center md:w-auto md:justify-start">
        <input type="checkbox" checked={ticked} onChange={onTick} aria-label={`Select ${c.docNo ?? c.title}`} className="h-[18px] w-[18px] accent-primary md:h-4 md:w-4" />
      </label>

      {/* Phone: two lines. Desktop: the cells below take over. */}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 text-left md:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <span className="truncate">{c.docNo ?? 'No number'} · {stage}{rev ? ` · Rev ${rev}` : ''}</span>{c.returnCode && code}
          </span>
          <span className="mt-0.5 block truncate text-[14px] font-semibold text-foreground">{c.title}</span>
          {needsPlan(c) && <span className="mt-0.5 block text-xs font-semibold text-bad">Plan date needed</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className={cn('block text-[15px] font-semibold tabular-nums', done ? 'text-ok' : 'text-foreground')}>{c.percent.toFixed(0)}%</span>
          <span className="block text-[11px] text-muted-foreground">{done ? 'Done' : c.out ? `${other === 'client' ? 'Client' : 'Vendor'}${days !== null ? ` · ${days} d` : ''}` : `Us${c.sendNext ? ` · ${stageOf(settings, c.sendNext).label}` : ''}`}</span>
        </span>
      </button>

      <button type="button" onClick={onOpen} className={cn('hidden truncate text-left text-[12.5px] tabular-nums md:block [font-feature-settings:"tnum"_1,"zero"_1]', opened ? 'font-semibold text-primary' : 'text-foreground/80')}>
        {c.docNo ?? <span className="text-muted-foreground">No number</span>}
      </button>
      <button type="button" onClick={onOpen} className="hidden truncate text-left text-[13.5px] font-medium text-foreground md:block">{c.title}</button>
      <span className="hidden text-[13px] font-medium text-foreground/80 tabular-nums xl:block">{rev ?? '—'}</span>
      <span className="hidden text-[13px] font-semibold text-foreground md:block">{stage}</span>
      <span className="hidden text-[13px] md:block">{code}</span>
      <span className="hidden text-[13px] text-foreground/80 md:block">{with_}</span>
      <span className="hidden text-right text-[13px] text-foreground tabular-nums md:block">{plan}</span>
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
    <div className="animate-fade-in-up border-b border-border/70 px-3 py-3 md:pl-[4.25rem] md:pr-4">
      <div className={cn('flex items-center gap-2 rounded-xl border bg-card pl-3 pr-1.5 shadow-[0_0_0_3px_rgba(29,78,216,.10)]', nudge ? 'border-bad' : 'border-primary')}>
        <Plus className="h-4 w-4 shrink-0 text-primary" />
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
          placeholder={`Type a title, or paste several lines from Excel, into ${group.name}`}
          aria-label={`New document in ${group.name}`}
          className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
        />
        {preview && <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums lg:block"><b className="text-foreground">{preview}</b> will be given</span>}
        <select value={kind} onChange={(e) => setKind(e.target.value as 'Doc' | 'Dwg')} aria-label="Kind" className="h-9 rounded-lg border border-border bg-card px-2 text-[13px]">
          <option value="Doc">Doc</option>
          <option value="Dwg">Dwg</option>
        </select>
        <button type="button" disabled={pending} onClick={() => put(text)} className="h-9 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? 'Adding…' : 'Add'}
        </button>
        <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
      </div>
      {nudge && <p className="mt-1.5 text-xs font-semibold text-bad">Type a title first.</p>}
    </div>
  );
}

/* --------------------------------------------- the one menu, for one group */

function GroupMenu({
  name, empty, onAdd, onRename, onSub, onDelete, onClose,
}: {
  name: string;
  empty: boolean;
  onAdd: () => void;
  onRename: (name: string) => Promise<{ ok: boolean }>;
  onSub: (name: string) => Promise<{ ok: boolean }>;
  onDelete: () => Promise<{ ok: boolean }>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'sub'>('menu');
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  const item = 'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-foreground hover:bg-muted';
  const submit = () => start(async () => {
    const v = value.trim();
    if (!v) return;
    const r = mode === 'rename' ? await onRename(v) : await onSub(v);
    if (r.ok) onClose();
  });
  return (
    <div className="animate-fade-in-up absolute right-0 top-10 z-30 w-64 rounded-2xl border bg-card p-1.5 shadow-lg">
      {mode === 'menu' ? (
        <>
          <button type="button" className={item} onClick={onAdd}>Add documents</button>
          <button type="button" className={item} onClick={() => { setMode('rename'); setValue(name); }}>Rename</button>
          <button type="button" className={item} onClick={() => { setMode('sub'); setValue(''); }}>Add a sub-discipline</button>
          <button type="button" disabled={!empty || pending} className={cn(item, 'text-bad disabled:text-muted-foreground')} onClick={() => start(async () => { const r = await onDelete(); if (r.ok) onClose(); })}>
            {empty ? 'Remove' : 'Remove: empty it first'}
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
            <button type="button" onClick={onClose} className="h-9 rounded-full px-3 text-sm text-muted-foreground">Cancel</button>
            <button type="button" disabled={pending} onClick={submit} className="h-9 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">{mode === 'rename' ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
