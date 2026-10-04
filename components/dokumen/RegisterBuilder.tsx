'use client';

import dynamic from 'next/dynamic';
import { Suspense, memo, startTransition, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, ChevronRight, ClipboardPaste, Copy, FileSpreadsheet, Plus, Trash2, X } from 'lucide-react';

import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addDocs, addHeadings, canHold, countDocuments, countNewHeadings, findNode, flatten, fromExisting, fromOutline,
  fromPaste, headingNames, holdsTyped, pathTo, removeNode, renameNode, renumber, toDraftGroups, updateDoc,
  type BuilderDoc, type BuilderNode, type ExistingNode, type OutlineNode,
} from '@/lib/builder-model';
import { addFromDraft, readRegisterFile, saveNumbering } from '@/lib/doc-actions';
import { defaultRule, type NumberingRule } from '@/lib/register-numbering';
import { parseRegisterPaste } from '@/lib/register-paste';
import { REGISTER_INFO, type RegisterSource } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

const loadNumbering = () => import('./NumberingDialog');
const NumberingDialog = dynamic(loadNumbering);

/**
 * Building a register, laid out like the register itself (4 Oct 2026).
 *
 * The morning's version was one outline in a centred column: the user asked
 * for exactly that shape (type the main headings, press the heading a
 * sub-heading belongs in), then found it left half a desktop empty, its +
 * buttons floating at the far edge of a wide card, and an add box opening in
 * the middle of the list. "Bagus tapi tidak memuaskan."
 *
 * So it is now the Data screen's own master–detail, the screen whose look they
 * approved: headings on the left as one tidy list (name, document count, a +
 * in a column of its own), and on the right whatever heading is open, with
 * what can go in it. A heading with nothing in it shows both sub-headings and
 * documents, each with its own box, so there is no "which kind?" switch. The
 * + on a row opens that heading and puts the cursor in its box: pressing the
 * mother is still how something goes inside it.
 *
 * Phones get the same two halves one at a time, as Data does: the list, then
 * the heading you tapped, with a back arrow to the one above it.
 *
 * The state is `lib/builder-model.ts`, proved by
 * `scripts/verify-builder-model.ts`. No Radix in the rows (AGENTS.md, "Radix
 * per screen, never per row").
 */

type Mode = 'headings' | 'documents';

interface Actions {
  select: (id: string | null) => void;
  /** The row's +: open that heading and put the cursor in its box. */
  addInto: (id: string) => void;
  addInside: (id: string, mode: Mode, lines: string[]) => void;
  rename: (id: string, name: string) => void;
  remove: (node: BuilderNode) => void;
  doc: (nodeId: string, docId: string, patch: Partial<BuilderDoc> | null) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Saved and new documents under a node, all levels. */
const docsUnder = (n: BuilderNode) => n.existing + countDocuments([n]);

export function RegisterBuilder({
  projectId, register, clientName, contractorName, hasDocuments,
  existing = [], numbering, sources = [], onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  hasDocuments: boolean;
  /** What the register already holds, so additions land inside it. */
  existing?: ExistingNode[];
  /** The rule, the numbers already spoken for, and a guess for a register with none. */
  numbering?: { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };
  /** Other projects whose register can be copied. */
  sources?: RegisterSource[];
  onClose?: () => void;
}) {
  const info = REGISTER_INFO[register];
  const edl = register === 'edl';
  const word = edl ? 'heading' : 'package';
  const taken = useMemo(() => numbering?.taken ?? [], [numbering]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tree, setTree] = useState<BuilderNode[]>(() => fromExisting(existing));
  const treeRef = useRef(tree);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  const [origin, setOrigin] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; n: number } | null>(null);
  const spendFocus = useMemo(() => () => setFocusReq(null), []);
  const [rule, setRule] = useState<NumberingRule>(
    numbering?.rule ?? defaultRule(numbering?.suggestedPrefix ?? ''),
  );
  const [ruleDirty, setRuleDirty] = useState(false);
  const [numberingOpen, setNumberingOpen] = useState(false);
  // Mounted on first use and kept, so it can close on its own animation.
  const [numberingUsed, setNumberingUsed] = useState(false);
  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const askNames = !clientName.trim() || !contractorName.trim();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteFrom, setPasteFrom] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BuilderNode | null>(null);

  const numbered = useMemo(() => renumber(tree, rule, taken), [tree, rule, taken]);
  const rows = useMemo(() => flatten(numbered), [numbered]);
  const documents = countDocuments(numbered);
  const newHeadings = countNewHeadings(tree);
  const startable = !hasDocuments && tree.length === 0;
  // "new" only means something beside headings that are not: a register built
  // from nothing would wear it on every row.
  const markNew = rows.some((r) => r.node.locked);

  // What the right half shows. Nothing picked: the first heading, on a wide
  // screen only; below lg the right half is hidden until a row is tapped.
  const picked = selectedId ? findNode(numbered, selectedId) : null;
  const current = picked ?? (numbered[0] ? { node: numbered[0], depth: 1 } : null);
  const panelOpen = picked !== null;
  const currentId = current?.node.id ?? null;
  const path = useMemo(() => (currentId ? pathTo(numbered, currentId) : []), [numbered, currentId]);

  /* ------------------------------------------------------------- verbs */

  // Stable, so a memoised row is only redrawn when its own node changes.
  const { actions, drop } = useMemo(() => {
    /** Removes a heading and opens the one it sat in. */
    const drop = (id: string) => {
      const above = pathTo(treeRef.current, id);
      setTree((t) => removeNode(t, id));
      setSelectedId(above.length > 1 ? above[above.length - 2].id : null);
    };
    const verbs: Actions = {
      select: (id) => startTransition(() => setSelectedId(id)),
      addInto: (id) => {
        startTransition(() => setSelectedId(id));
        setFocusReq({ id, n: Date.now() });
      },
      addInside: (id, mode, lines) => setTree((t) => (mode === 'headings' ? addHeadings(t, id, lines) : addDocs(t, id, lines))),
      rename: (id, name) => setTree((t) => renameNode(t, id, name)),
      remove: (node) => {
        if (node.locked) return;
        if (holdsTyped(node)) { setConfirmRemove(node); return; }
        drop(node.id);
      },
      doc: (nodeId, docId, patch) => setTree((t) => updateDoc(t, nodeId, docId, patch)),
    };
    return { actions: verbs, drop };
  }, []);

  const addMain = (lines: string[]): string | null => {
    const here = new Set(tree.map((n) => n.name.trim().toLowerCase()));
    if (lines.every((l) => here.has(l.toLowerCase()))) return 'That one is already here.';
    setTree((t) => addHeadings(t, null, lines));
    return null;
  };

  /* ----------------------------------------------------------- starting */

  const begin = (next: BuilderNode[], from: string | null) => {
    startTransition(() => {
      setTree(next);
      setOrigin(from);
      setError(null);
      setPasteOpen(false);
      setSelectedId(null);
    });
  };

  /** A GET route, retried once: a read through a server action has left a screen blank before. */
  const copyFrom = async (source: RegisterSource) => {
    setLoadingSource(source.projectId);
    setError(null);
    const url = `/api/register/outline?project=${encodeURIComponent(source.projectId)}&register=${register}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const outline = (await res.json()) as OutlineNode[];
        setLoadingSource(null);
        begin(fromOutline(outline), source.name);
        return;
      } catch {
        // one more try, then say so
      }
    }
    setLoadingSource(null);
    setError(`Could not read ${source.name}. Try again.`);
  };

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set('file', file);
      form.set('register', register);
      const result = await readRegisterFile(form);
      if (!result.ok) { setError(result.error); return; }
      setPasteText(result.text);
      setPasteFrom(`${file.name} · sheet "${result.sheet}"`);
      setPasteOpen(true);
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  /* -------------------------------------------------------------- saving */

  const save = () => {
    setError(null);
    // Said when Save is pressed, not before: a grey button gives no reason.
    if (!client.trim() || !contractor.trim()) {
      setError('Fill in the contractor and the client first.');
      document.getElementById(contractor.trim() ? 'builder-client' : 'builder-contractor')?.focus();
      return;
    }
    start(async () => {
      if (documents > 0 && rule.prefix.trim() && (ruleDirty || !numbering?.rule)) {
        const r = await saveNumbering({
          projectId, register, prefix: rule.prefix, disciplines: rule.disciplines, types: rule.types,
        });
        if (!r.ok) { setError(r.error); return; }
      }
      const result = await addFromDraft({
        projectId, register, groups: toDraftGroups(numbered), clientName: client, contractorName: contractor,
      });
      if (!result.ok) { setError(result.error); return; }
      onClose?.();
    });
  };

  const canSave = !pending && (documents > 0 || newHeadings > 0);
  const tally = `${plural(newHeadings, `new ${word}`)} · ${plural(documents, 'new document')}`;

  const startFrom = (
    <StartFrom
      register={register}
      sources={sources}
      loadingSource={loadingSource}
      pasteOpen={pasteOpen}
      pasteText={pasteText}
      pasteFrom={pasteFrom}
      pending={pending}
      onPasteToggle={() => setPasteOpen((v) => !v)}
      onPasteText={(text) => { setPasteText(text); setPasteFrom(null); }}
      onFile={() => fileInput.current?.click()}
      onCopy={copyFrom}
      onContinue={(plan) => begin(fromPaste(plan), pasteFrom ?? 'your paste')}
    />
  );

  /* -------------------------------------------------------------- render */

  return (
    <div className="flex flex-col gap-3 pb-24 sm:gap-4 sm:pb-0">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />

      {/* The Data screen's toolbar: what you are looking at, and what you can do to it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          {onClose && (
            <Button variant="ghost" size="icon" className="-ml-2 h-11 w-11 shrink-0" onClick={onClose} aria-label="Back to the register">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight">
              {hasDocuments ? `Add to the ${info.short}` : `Build the ${info.short}`}
            </p>
            <p className="truncate text-xs tabular-nums text-muted-foreground">
              {tally}{origin && ` · copied from ${origin}`}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {onClose && <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>}
          <Button className="h-11 min-w-24" disabled={!canSave} onClick={save}>{pending ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      {askNames && (
        <section className="animate-enter rounded-xl border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end sm:gap-4">
            <div className="sm:pb-2.5">
              <h2 className="text-sm font-semibold">Who are the two sides?</h2>
              <p className="text-xs text-muted-foreground">Asked once.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="builder-contractor">Contractor</Label>
              <Input id="builder-contractor" className="h-11" value={contractor} onChange={(e) => setContractor(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="builder-client">Client</Label>
              <Input id="builder-client" className="h-11" value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
          </div>
        </section>
      )}

      {error && <ErrorLine text={error} />}

      {/* Same frame as Data: a fixed-height pane on a wide screen, each half scrolling on its own. */}
      <div className="lg:grid lg:h-[calc(100dvh_-_15rem)] lg:grid-cols-[minmax(300px,380px)_1fr] lg:gap-6">
        {/* ------------------------------------------------------ headings */}
        <aside className={cn('animate-enter flex-col gap-3 lg:min-h-0', panelOpen ? 'hidden lg:flex' : 'flex')}>
          <div className={cn('flex flex-col rounded-xl border bg-card shadow-sm lg:min-h-0', rows.length > 0 && 'lg:flex-1')}>
            <div className="flex min-h-12 items-center gap-2 px-4 pt-1">
              <h2 className="flex-1 text-sm font-semibold">{edl ? 'Headings' : 'Vendor packages'}</h2>
              {!hasDocuments && newHeadings > 0 && (
                <button
                  type="button"
                  onClick={() => { setTree(fromExisting(existing)); setOrigin(null); setError(null); setSelectedId(null); }}
                  className="inline-flex min-h-11 items-center text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Start again
                </button>
              )}
            </div>
            <div className="px-3 pb-3">
              <AddLine
                id="builder-main"
                dashed
                label={edl ? 'Add a main heading' : 'Add a vendor package'}
                placeholder={edl
                  ? (tree.length === 0 ? 'First main heading, e.g. GENERAL' : 'Add a main heading')
                  : (tree.length === 0 ? 'First package name' : 'Add a package')}
                empty="Type a name first."
                onAdd={addMain}
              />
            </div>
            {rows.length > 0 && (
              <div role="list" className="scrollbar-none border-t px-1.5 py-1.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {rows.map(({ node, depth }) => (
                  <TreeRow
                    key={node.id}
                    node={node}
                    depth={depth}
                    active={currentId === node.id}
                    explicit={selectedId === node.id}
                    markNew={markNew}
                    actions={actions}
                  />
                ))}
              </div>
            )}
          </div>
          {startable && <div className="lg:hidden">{startFrom}</div>}
        </aside>

        {/* ------------------------------------------------- the open heading */}
        <section className={cn('animate-enter stagger-1 scrollbar-none lg:min-h-0 lg:overflow-y-auto lg:pb-8', panelOpen ? 'block' : 'hidden lg:block')}>
          {current ? (
            <NodePanel
              key={current.node.id}
              node={current.node}
              depth={current.depth}
              path={path}
              register={register}
              markNew={markNew}
              focusReq={focusReq}
              onFocused={spendFocus}
              actions={actions}
              onNumbering={() => { void loadNumbering(); setNumberingUsed(true); setNumberingOpen(true); }}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="text-base font-semibold tracking-tight">
                  {edl ? 'Start with the main headings' : 'Start with the vendor packages'}
                </h2>
                <ol className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
                  <Step n={1}>{edl ? 'Type them on the left, one at a time: GENERAL, PROCESS, PIPING…' : 'Type them on the left, one at a time.'}</Step>
                  <Step n={2}>
                    Press <Plus className="inline h-3.5 w-3.5 align-[-2px] text-primary" aria-label="plus" /> on one
                    to put {edl ? 'sub-headings and documents' : 'documents'} inside it.
                  </Step>
                  <Step n={3}>Save.</Step>
                </ol>
              </div>
              {startable && startFrom}
            </div>
          )}
        </section>
      </div>

      {/* Phones: the count and Save stay under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-background px-4 py-3 sm:hidden">
        <span className="min-w-0 truncate text-sm tabular-nums" data-builder-count>
          <span className="font-semibold"><AnimatedNumber value={newHeadings} decimals={0} /></span>
          {' new · '}
          <span className="font-semibold"><AnimatedNumber value={documents} decimals={0} /></span>
          {` document${documents === 1 ? '' : 's'}`}
        </span>
        <Button className="ml-auto h-11 min-w-24 shrink-0" disabled={!canSave} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {/* Its own boundary: a lazy dialog suspends on its first render, and
          without one the suspension reached the page's (see ExportExcelButton). */}
      {numberingUsed && (
        <Suspense fallback={null}>
          <NumberingDialog
            open={numberingOpen}
            onOpenChange={setNumberingOpen}
            rule={rule}
            headings={headingNames(tree)}
            onChange={(next) => { setRule(next); setRuleDirty(true); }}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove ${confirmRemove?.name || 'this heading'}?`}
        message="What was typed inside it goes with it. Nothing has been saved yet."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (target) drop(target.id);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/* ---------------------------------------------------------- the list */

/**
 * One heading in the left-hand list. Three columns and nothing else: the name
 * (indented by level), how many documents sit under it, and its +. Memoised:
 * an edit copies only the path to what changed.
 */
const TreeRow = memo(function TreeRow({
  node, depth, active, explicit, markNew, actions,
}: {
  node: BuilderNode;
  depth: number;
  /** The heading the right half shows. */
  active: boolean;
  /** Picked by a press, rather than shown because it is first. */
  explicit: boolean;
  markNew: boolean;
  actions: Actions;
}) {
  const can = canHold(node, depth);
  const count = docsUnder(node);
  const label = node.name.trim() || 'Untitled';

  return (
    <div
      role="listitem"
      className={cn(
        'flex h-11 items-center rounded-lg transition-colors duration-200 ease-ios',
        active
          // Shown-because-first is marked on a wide screen only, where the right half exists.
          ? (explicit ? 'bg-muted' : 'hover:bg-muted/60 lg:bg-muted')
          : 'hover:bg-muted/60',
      )}
    >
      <button
        type="button"
        onClick={() => actions.select(node.id)}
        aria-current={active ? 'true' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left"
        style={{ paddingLeft: `${0.75 + (depth - 1) * 1.125}rem` }}
      >
        {depth > 1 && <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />}
        <span className={cn(
          'min-w-0 truncate',
          depth === 1 ? 'text-sm font-semibold tracking-tight' : depth === 2 ? 'text-sm' : 'text-[13px] text-foreground/80',
          !node.name.trim() && 'italic text-muted-foreground',
        )}
        >
          {label}
        </span>
        {markNew && !node.locked && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary">new</span>
        )}
      </button>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{count > 0 ? count : ''}</span>
      {can.headings || can.documents ? (
        <button
          type="button"
          onClick={() => actions.addInto(node.id)}
          aria-label={`Add inside ${label}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary transition-colors duration-200 ease-ios hover:bg-primary/10"
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : <span aria-hidden className="w-11 shrink-0" />}
    </div>
  );
});

/* --------------------------------------------------- the open heading */

function NodePanel({
  node, depth, path, register, markNew, focusReq, onFocused, actions, onNumbering,
}: {
  node: BuilderNode;
  depth: number;
  path: BuilderNode[];
  register: RegisterKind;
  markNew: boolean;
  focusReq: { id: string; n: number } | null;
  /** The request is spent once the cursor is in: a later visit does not grab it again. */
  onFocused: () => void;
  actions: Actions;
  onNumbering: () => void;
}) {
  const edl = register === 'edl';
  const can = canHold(node, depth);
  const subRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const newDocs = node.docs.filter((d) => d.title.trim()).length;
  const sub = edl ? 'sub-heading' : 'sub-package';
  const under = docsUnder(node);

  // The row's + opened this heading: the cursor goes in its first box.
  const wantsFocus = focusReq?.id === node.id ? focusReq.n : null;
  // A heading already holding documents is a document heading: its documents
  // come first, and sub-headings are the second thing it could take.
  const docsFirst = can.documents && (node.docs.length > 0 || node.existing > 0);
  const firstBox = can.headings && !docsFirst ? subRef : docRef;
  useEffect(() => {
    if (wantsFocus === null) return;
    const frame = requestAnimationFrame(() => {
      // Never pull the cursor out of a box the person already pressed into.
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (!typing) firstBox.current?.focus();
      onFocused();
    });
    return () => cancelAnimationFrame(frame);
  }, [wantsFocus, firstBox, onFocused]);

  const addSubs = (lines: string[]): string | null => {
    const here = new Set(node.children.map((c) => c.name.trim().toLowerCase()));
    if (lines.every((l) => here.has(l.toLowerCase()))) return 'That one is already here.';
    actions.addInside(node.id, 'headings', lines);
    return null;
  };
  const addDocLines = (lines: string[]): string | null => {
    actions.addInside(node.id, 'documents', lines);
    return null;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* -------------------------------------------------------- header */}
      <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost" size="icon"
            className="-ml-2 h-11 w-11 shrink-0 lg:hidden"
            onClick={() => actions.select(parent ? parent.id : null)}
            aria-label={parent ? `Back to ${parent.name}` : 'Back to the list'}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Where this heading sits" className="flex min-h-5 flex-wrap items-center gap-x-1 text-xs uppercase tracking-widest text-muted-foreground">
              {path.length > 1
                ? path.slice(0, -1).map((p, i) => (
                  <span key={p.id} className="inline-flex items-center gap-x-1">
                    {i > 0 && <ChevronRight aria-hidden className="h-3 w-3" />}
                    <button type="button" onClick={() => actions.select(p.id)} className="uppercase hover:text-foreground">{p.name || 'Untitled'}</button>
                  </span>
                ))
                : <span>{edl ? 'Main heading' : 'Vendor package'}</span>}
            </nav>
            {node.locked ? (
              <h2 className="mt-0.5 truncate text-lg font-semibold leading-tight">{node.name}</h2>
            ) : (
              <input
                value={node.name}
                onChange={(e) => actions.rename(node.id, e.target.value)}
                placeholder="Name this heading"
                aria-label="Heading name"
                className="-mx-2 mt-0.5 h-9 w-[calc(100%+1rem)] rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold leading-tight outline-none transition-colors duration-200 ease-ios hover:border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            )}
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {node.locked ? 'Already in the register' : 'New: saved when you press Save'}
              {node.children.length > 0 && ` · ${plural(node.children.length, sub)}`}
              {under > 0 && ` · ${plural(under, 'document')}`}
            </p>
          </div>
          {!node.locked && (
            <Button variant="ghost" className="h-11 shrink-0 px-3 text-muted-foreground hover:text-bad" onClick={() => actions.remove(node)}>
              <Trash2 className="h-4 w-4 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Remove</span>
            </Button>
          )}
        </div>
      </div>

      {/* -------------------------------------------------- sub-headings */}
      {can.headings && (
        <section className={cn('rounded-xl border bg-card p-4 shadow-sm sm:p-5', docsFirst && 'order-last')}>
          <SectionHead title={edl ? 'Sub-headings' : 'Sub-packages'} count={node.children.length} />
          {node.children.length > 0 && (
            <div className="mt-2 flex flex-col">
              {node.children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => actions.select(c.id)}
                  className="flex h-11 items-center gap-2.5 rounded-md border-t border-border/60 px-2 text-left first:border-t-0 hover:bg-muted/50"
                >
                  <span className={cn('min-w-0 flex-1 truncate text-sm', !c.name.trim() && 'italic text-muted-foreground')}>{c.name.trim() || 'Untitled'}</span>
                  {markNew && !c.locked && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">new</span>}
                  <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                    {docsUnder(c) > 0 ? plural(docsUnder(c), 'document') : ''}
                  </span>
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
          <div className="mt-3">
            <AddLine
              inputRef={subRef}
              label={`New ${sub} inside ${node.name}`}
              placeholder={`Add a ${sub} inside ${node.name.trim() || 'this heading'}`}
              empty="Type a name first."
              onAdd={addSubs}
            />
          </div>
          {node.docs.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              The first {sub} takes the {plural(node.docs.length, 'document')} above.
            </p>
          )}
        </section>
      )}

      {/* ----------------------------------------------------- documents */}
      {can.documents && (
        <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <SectionHead
            title="Documents"
            count={node.existing + newDocs}
            aside={newDocs > 0 && (
              <button type="button" onClick={onNumbering} className="inline-flex min-h-11 items-center text-xs font-medium text-primary hover:underline">
                Change numbering
              </button>
            )}
          />
          {node.existing > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {plural(node.existing, 'document')} already in the register; their dates and letters are worked on in Data.
            </p>
          )}
          {node.docs.length > 0 && (
            <div className="mt-2 flex flex-col">
              {node.docs.map((d) => <DocRow key={d.id} doc={d} nodeId={node.id} actions={actions} />)}
            </div>
          )}
          <div className="mt-3">
            <AddLine
              inputRef={docRef}
              label={`New document inside ${node.name}`}
              placeholder="Add a document title. Paste several lines to add many"
              empty="Type a title first."
              onAdd={addDocLines}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHead({ title, count, aside }: { title: string; count: number; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {count > 0 && <span className="rounded-md bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>}
      {aside && <span className="ml-auto">{aside}</span>}
    </div>
  );
}

/** A new document: number, title, kind, remove, in fixed columns so the rows line up. */
function DocRow({ doc, nodeId, actions }: { doc: BuilderDoc; nodeId: string; actions: Actions }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_2.75rem] items-center gap-x-2 border-t border-border/60 py-1 first:border-t-0 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto_2.75rem]">
      <span className="order-last col-span-full -mt-1 truncate px-2 pb-1 font-mono text-[11px] text-muted-foreground sm:order-none sm:col-span-1 sm:mt-0 sm:px-0 sm:pb-0 sm:text-xs">
        {doc.docNo || 'Numbered when titled'}
      </span>
      <input
        value={doc.title}
        onChange={(e) => actions.doc(nodeId, doc.id, { title: e.target.value })}
        aria-label="Document title"
        className="h-10 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-base outline-none transition-colors duration-200 ease-ios hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
      />
      <button
        type="button"
        onClick={() => actions.doc(nodeId, doc.id, { kind: doc.kind === 'Doc' ? 'Dwg' : 'Doc' })}
        aria-label={`${doc.kind === 'Doc' ? 'Document' : 'Drawing'}. Press to change`}
        className="flex h-11 items-center"
      >
        <span className={cn(
          'w-11 rounded-md border py-0.5 text-center text-xs font-semibold transition-colors duration-200 ease-ios',
          doc.kind === 'Dwg' ? 'border-primary/40 bg-primary/5 text-primary' : 'text-muted-foreground',
        )}
        >
          {doc.kind}
        </span>
      </button>
      <button
        type="button"
        onClick={() => actions.doc(nodeId, doc.id, null)}
        aria-label={`Remove ${doc.title || 'document'}`}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ boxes */

/**
 * A box and its Add. Enter or Add puts in what was typed and keeps the cursor
 * there for the next; a paste of several lines adds one per line. The only
 * thing it ever says is why a press did nothing, in red, until you type.
 */
function AddLine({
  id, label, placeholder, empty, onAdd, inputRef, dashed,
}: {
  id?: string;
  label: string;
  placeholder: string;
  /** Said when Add is pressed on an empty box. */
  empty: string;
  /** Returns why nothing was added, or null when it was. */
  onAdd: (lines: string[]) => string | null;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  dashed?: boolean;
}) {
  const own = useRef<HTMLInputElement>(null);
  const field = inputRef ?? own;
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState<string | null>(null);

  const put = (raw: string) => {
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\t+/g, ' ').trim()).filter(Boolean);
    const why = lines.length === 0 ? empty : onAdd(lines);
    if (why) { setNudge(why); field.current?.focus(); return; }
    setText('');
    setNudge(null);
    field.current?.focus();
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          id={id}
          ref={field}
          value={text}
          onChange={(e) => { setText(e.target.value); if (nudge) setNudge(null); }}
          onKeyDown={(e) => {
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
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={nudge ? true : undefined}
          className={cn(
            'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none transition-colors duration-200 ease-ios placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm',
            dashed && 'border-dashed bg-transparent focus-visible:border-solid',
            nudge && 'border-solid border-bad ring-3 ring-bad/15',
          )}
        />
        <Button variant="outline" className="h-11 shrink-0 px-3.5" onClick={() => put(text)}>
          <Plus className="h-4 w-4 sm:mr-1" /><span className="sr-only sm:not-sr-only">Add</span>
        </Button>
      </div>
      {nudge && <p className="mt-1 text-xs font-medium text-bad">{nudge}</p>}
    </div>
  );
}

/** An empty register's other ways in: a paste, a file, or another project's outline. */
function StartFrom({
  register, sources, loadingSource, pasteOpen, pasteText, pasteFrom, pending,
  onPasteToggle, onPasteText, onFile, onCopy, onContinue,
}: {
  register: RegisterKind;
  sources: RegisterSource[];
  loadingSource: string | null;
  pasteOpen: boolean;
  pasteText: string;
  pasteFrom: string | null;
  pending: boolean;
  onPasteToggle: () => void;
  onPasteText: (text: string) => void;
  onFile: () => void;
  onCopy: (source: RegisterSource) => void;
  onContinue: (plan: ReturnType<typeof parseRegisterPaste>) => void;
}) {
  const plan = useMemo(() => (pasteText.trim() ? parseRegisterPaste(pasteText) : null), [pasteText]);
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold">Already have the list?</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" className="h-11" aria-expanded={pasteOpen} onClick={onPasteToggle}>
          <ClipboardPaste className="mr-1.5 h-4 w-4" /> Paste from Excel
        </Button>
        {sources.map((s) => (
          <Button key={s.projectId} variant="outline" className="h-11 max-w-full" disabled={loadingSource !== null} onClick={() => onCopy(s)}>
            <Copy className="mr-1.5 h-4 w-4 shrink-0" />
            <span className="truncate">{loadingSource === s.projectId ? 'Reading…' : `Copy from ${s.name}`}</span>
          </Button>
        ))}
      </div>
      {pasteOpen && (
        <div className="animate-fade-in-up mt-4 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{pasteFrom ?? 'Your list'}</p>
            <Button variant="ghost" className="h-11" disabled={pending} onClick={onFile}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              {pending ? 'Reading…' : 'From an Excel file'}
            </Button>
          </div>
          <Textarea
            className="mt-2 max-h-72 min-h-36 overflow-auto font-mono text-xs leading-relaxed"
            value={pasteText}
            onChange={(e) => onPasteText(e.target.value)}
            spellCheck={false}
            aria-label={`Paste your ${register === 'edl' ? 'EDL' : 'VDRL'}`}
            placeholder={'GENERAL\nWPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan'}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm tabular-nums text-muted-foreground">
              {plan
                ? `${plural(plan.counts.documents, 'document')} under ${plural(plan.categories.filter((c) => c.depth === 1).length, 'heading')}`
                : 'Headings on their own lines, documents under them.'}
            </p>
            <Button className="h-11" disabled={!plan || plan.counts.documents === 0} onClick={() => plan && onContinue(plan)}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      {text}
    </p>
  );
}
