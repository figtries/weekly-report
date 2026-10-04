'use client';

import dynamic from 'next/dynamic';
import { Suspense, memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowLeft, FileSpreadsheet, FileText, Plus, X } from 'lucide-react';

import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addDocs, addHeadings, canHold, countDocuments, countNewHeadings, fromExisting, fromOutline, fromPaste,
  headingNames, holdsTyped, linesOf, removeNode, renameNode, renumber, toDraftGroups, updateDoc,
  type BuilderDoc, type BuilderNode, type ExistingNode, type OutlineNode,
} from '@/lib/builder-model';
import { MOTION } from '@/lib/design';
import { addFromDraft, readRegisterFile, saveNumbering } from '@/lib/doc-actions';
import { defaultRule, nextNumber, type NumberingRule } from '@/lib/register-numbering';
import { parseRegisterPaste } from '@/lib/register-paste';
import { REGISTER_INFO, type RegisterSource } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

const loadNumbering = () => import('./NumberingDialog');
const NumberingDialog = dynamic(loadNumbering);

/**
 * Building a register: ONE OUTLINE (4 Oct 2026).
 *
 * The 3 Oct builder asked where to start, then offered a row of suggested
 * heading chips, a numbering line, and a card per heading with a four-column
 * table under it. The user called it harder than Excel ("kita ini bantu, bukan
 * nyusahin") and asked for what is here: type the main headings, and to put a
 * sub-heading or a sub-sub-heading inside one, press + on the heading it
 * belongs to. Documents go in the same way, one level down: + on a heading
 * with nothing under it. Kind is guessed from the title and the number is
 * composed from the project's rule, both shown on the row and both one press
 * to change; plan dates are set on the document afterwards, in Data.
 *
 * An empty register can still start from a paste or another project, but as
 * a quiet line under the outline, not as a question before it.
 *
 * The state is `lib/builder-model.ts`, which `scripts/verify-builder-model.ts`
 * proves; this file only draws it. No Radix in the rows (AGENTS.md, "Radix per
 * screen, never per row"): a register can run to dozens of headings.
 */

type Mode = 'headings' | 'documents';

interface RowActions {
  toggleAdd: (id: string) => void;
  closeAdd: () => void;
  addInside: (id: string, mode: Mode, lines: string[]) => void;
  rename: (id: string, name: string) => void;
  remove: (node: BuilderNode) => void;
  doc: (nodeId: string, docId: string, patch: Partial<BuilderDoc> | null) => void;
}

/** Text that is an input only when you press it: no box until focus, so the outline reads as a list. */
const inline =
  'h-10 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 outline-none ' +
  'transition-colors duration-200 ease-ios hover:border-input focus-visible:border-ring ' +
  'focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/50';

const box =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none ' +
  'transition-colors duration-200 ease-ios placeholder:text-muted-foreground/80 ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm';

const nameStyle = (depth: number) =>
  depth === 1 ? 'text-base font-semibold tracking-tight md:text-[15px]'
    : depth === 2 ? 'text-base font-medium md:text-sm'
      : 'text-base text-foreground/85 md:text-sm';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  const taken = useMemo(() => numbering?.taken ?? [], [numbering]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tree, setTree] = useState<BuilderNode[]>(() => fromExisting(existing));
  const [origin, setOrigin] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
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
  const documents = countDocuments(numbered);
  const newHeadings = countNewHeadings(tree);
  const pastePlan = useMemo(() => (pasteText.trim() ? parseRegisterPaste(pasteText) : null), [pasteText]);
  const startable = !hasDocuments && tree.length === 0;

  const sampleNumber = useMemo(() => {
    const find = (ns: BuilderNode[]): string | null => {
      for (const n of ns) {
        const hit = n.docs.find((d) => d.auto && d.docNo)?.docNo ?? find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(numbered) ?? nextNumber(rule, tree[0]?.name ?? (edl ? 'GENERAL' : 'PACKAGE'), 'Document', 'Doc', taken);
  }, [numbered, rule, tree, edl, taken]);

  /* ----------------------------------------------------- the outline's verbs */

  // Stable, so a memoised row is only redrawn when its own branch changes.
  const actions = useMemo<RowActions>(() => ({
    toggleAdd: (id) => setAddingTo((cur) => (cur === id ? null : id)),
    closeAdd: () => setAddingTo(null),
    addInside: (id, mode, lines) => setTree((t) => (mode === 'headings' ? addHeadings(t, id, lines) : addDocs(t, id, lines))),
    rename: (id, name) => setTree((t) => renameNode(t, id, name)),
    remove: (node) => {
      if (node.locked) return;
      if (holdsTyped(node)) { setConfirmRemove(node); return; }
      setTree((t) => removeNode(t, node.id));
    },
    doc: (nodeId, docId, patch) => setTree((t) => updateDoc(t, nodeId, docId, patch)),
  }), []);

  const addMain = useCallback((lines: string[]) => setTree((t) => addHeadings(t, null, lines)), []);

  /* ----------------------------------------------------------- starting */

  const begin = (next: BuilderNode[], from: string | null) => {
    startTransition(() => {
      setTree(next);
      setOrigin(from);
      setError(null);
      setPasteOpen(false);
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

  /* -------------------------------------------------------------- render */

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-28">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />

      {(onClose || (!hasDocuments && newHeadings > 0)) && (
        <div className="flex flex-wrap items-center gap-x-4">
          {onClose && (
            <Button variant="ghost" className="h-11 w-fit px-2" onClick={onClose}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the register
            </Button>
          )}
          {!hasDocuments && newHeadings > 0 && (
            <Button
              variant="ghost"
              className="h-11 w-fit px-2 text-muted-foreground"
              onClick={() => { setTree(fromExisting(existing)); setOrigin(null); setError(null); setAddingTo(null); }}
            >
              Start again
            </Button>
          )}
        </div>
      )}

      <header className="animate-enter">
        <p className="text-xs font-semibold tracking-wide text-chart-1">
          {info.long}{origin && ` · Copied from ${origin}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {hasDocuments ? `Add to the ${info.short}` : `Build the ${info.short}`}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {edl
            ? <>Type the main headings. To put a sub-heading or documents inside one, press <Plus className="inline h-3.5 w-3.5 align-[-2px] text-primary" aria-label="plus" /> beside it.</>
            : <>Type the vendor packages. To put documents inside one, press <Plus className="inline h-3.5 w-3.5 align-[-2px] text-primary" aria-label="plus" /> beside it.</>}
        </p>
      </header>

      {askNames && (
        <section className="animate-enter stagger-1 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-semibold">Who are the two sides?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Asked once. One submits, the other responds.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="builder-contractor">Contractor</Label>
              <Input id="builder-contractor" className="h-11" value={contractor} onChange={(e) => setContractor(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="builder-client">Client</Label>
              <Input id="builder-client" className="h-11" value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- the outline */}
      <section className="animate-enter stagger-2 rounded-xl border bg-card p-3 shadow-sm sm:p-5">
        {numbered.length > 0 && (
          <div className="mb-3 flex flex-col">
            {numbered.map((n) => (
              <OutlineRow
                key={n.id}
                node={n}
                depth={1}
                openId={addingTo}
                register={register}
                actions={actions}
              />
            ))}
          </div>
        )}

        <MainHeadingBox
          first={numbered.length === 0}
          register={register}
          existing={tree.map((n) => n.name)}
          onAdd={addMain}
        />
      </section>

      {startable && (
        <p className="animate-enter stagger-3 -mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
          <span>Already have the list?</span>
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            aria-expanded={pasteOpen}
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            Paste it from Excel
          </button>
          {sources.map((s) => (
            <span key={s.projectId} className="inline-flex items-center gap-x-1">
              <span aria-hidden>·</span>
              <button
                type="button"
                disabled={loadingSource !== null}
                onClick={() => copyFrom(s)}
                className="inline-flex min-h-11 max-w-[16rem] items-center font-medium text-primary hover:underline disabled:opacity-60"
              >
                <span className="truncate">
                  {loadingSource === s.projectId ? 'Reading…' : `Copy from ${s.name}`}
                </span>
              </button>
            </span>
          ))}
        </p>
      )}

      <AnimatePresence initial={false}>
        {startable && pasteOpen && (
          <m.section
            key="paste"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: MOTION.duration, ease: MOTION.ease }}
            style={{ overflow: 'hidden', contain: 'layout paint' }}
          >
            <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{pasteFrom ?? 'Your list'}</h2>
                <Button variant="outline" className="h-11" disabled={pending} onClick={() => fileInput.current?.click()}>
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                  {pending ? 'Reading…' : 'From an Excel file'}
                </Button>
              </div>
              <Textarea
                className="mt-3 max-h-72 min-h-36 overflow-auto font-mono text-xs leading-relaxed"
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteFrom(null); }}
                spellCheck={false}
                aria-label="Paste your document list"
                placeholder={'GENERAL\nWPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan'}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm tabular-nums text-muted-foreground">
                  {pastePlan
                    ? `${plural(pastePlan.counts.documents, 'document')} under ${plural(pastePlan.categories.filter((c) => c.depth === 1).length, 'heading')}`
                    : 'Headings on their own lines, documents under them.'}
                </p>
                <Button
                  className="h-11"
                  disabled={!pastePlan || pastePlan.counts.documents === 0}
                  onClick={() => pastePlan && begin(fromPaste(pastePlan), pasteFrom ?? 'your paste')}
                >
                  Continue
                </Button>
              </div>
            </div>
          </m.section>
        )}
      </AnimatePresence>

      {/* Only once there is a number to talk about. */}
      {documents > 0 && (
        <div className="-my-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span>Numbered like</span>
          <span className="font-mono text-foreground">{sampleNumber}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => { setNumberingUsed(true); setNumberingOpen(true); }}
            onPointerDown={() => { void loadNumbering(); }}
            className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            Change
          </button>
        </div>
      )}

      {error && <ErrorLine text={error} />}

      {/* A plain bar, no backdrop blur: a blur under a sticky bar is redrawn on
          every frame the page scrolls or moves behind it (70 ms of GPU traced
          at CPU 4x, 4 Oct 2026). */}
      <div className="sticky bottom-0 -mx-3 flex items-center gap-3 border-t bg-background px-3 py-3 sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:px-4 sm:shadow-md">
        <span className="min-w-0 text-sm tabular-nums" data-builder-count>
          <span className="font-semibold"><AnimatedNumber value={newHeadings} decimals={0} /></span>
          {` new ${edl ? 'heading' : 'package'}${newHeadings === 1 ? '' : 's'} · `}
          <span className="font-semibold"><AnimatedNumber value={documents} decimals={0} /></span>
          {` document${documents === 1 ? '' : 's'}`}
        </span>
        <Button className="ml-auto h-11 shrink-0" disabled={!canSave} onClick={save}>
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
        title={`Remove ${confirmRemove?.name ?? ''}?`}
        message="What was typed inside it goes with it. Nothing has been saved yet."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (target) setTree((t) => removeNode(t, target.id));
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------- one node */

/**
 * A heading, what is inside it, and its + . Memoised: an edit copies only the
 * path to what changed, so every other branch is the same object and skips.
 */
const OutlineRow = memo(function OutlineRow({
  node, depth, openId, register, actions,
}: {
  node: BuilderNode;
  depth: number;
  openId: string | null;
  register: RegisterKind;
  actions: RowActions;
}) {
  const can = canHold(node, depth);
  const open = openId === node.id;
  const label = node.name || 'this heading';

  return (
    <m.div
      initial={node.locked ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration, ease: MOTION.ease }}
    >
      <div className="flex min-h-11 items-center gap-1">
        {node.locked ? (
          <span className={cn('min-w-0 flex-1 truncate py-2', nameStyle(depth))}>{node.name}</span>
        ) : (
          <input
            value={node.name}
            onChange={(e) => actions.rename(node.id, e.target.value)}
            aria-label="Heading name"
            className={cn(inline, '-ml-2 flex-1', nameStyle(depth))}
          />
        )}
        {node.locked && node.existing > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{plural(node.existing, 'document')}</span>
        )}
        {(can.headings || can.documents) && (
          <button
            type="button"
            onClick={() => actions.toggleAdd(node.id)}
            aria-expanded={open}
            aria-label={open ? `Close adding inside ${label}` : `Add inside ${label}`}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary transition-colors duration-200 ease-ios hover:bg-primary/10',
              open && 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {/* It stays a plus while open (pressed look, not a turn into an X):
                beside the remove X, a rotated plus read as a second remove. */}
            <Plus className="h-5 w-5" />
          </button>
        )}
        {!node.locked && (
          <button
            type="button"
            onClick={() => actions.remove(node)}
            aria-label={`Remove ${label}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Always drawn, so the add box can leave on its own exit; empty, it has no height. */}
      <div className="ml-2.5 border-l border-border pl-2.5 sm:pl-4">
        {node.docs.map((d) => <DocLine key={d.id} doc={d} nodeId={node.id} actions={actions} />)}
        {node.children.map((c) => (
          <OutlineRow key={c.id} node={c} depth={depth + 1} openId={openId} register={register} actions={actions} />
        ))}
        <AnimatePresence initial={false}>
          {open && (
            <m.div
              key="add"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: MOTION.duration, ease: MOTION.ease }}
              style={{ overflow: 'hidden', contain: 'layout paint' }}
            >
              <AddInside node={node} depth={depth} register={register} actions={actions} />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </m.div>
  );
});

function DocLine({ doc, nodeId, actions }: { doc: BuilderDoc; nodeId: string; actions: RowActions }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.duration, ease: MOTION.ease }}
      className="flex min-h-11 items-center gap-1"
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <input
          value={doc.title}
          onChange={(e) => actions.doc(nodeId, doc.id, { title: e.target.value })}
          aria-label="Document title"
          className={cn(inline, 'text-base md:text-sm')}
        />
        {/* On a phone the number rides under the title; beside it, it was cut. */}
        <p className="-mt-1 truncate px-2 pb-1 font-mono text-[11px] text-muted-foreground sm:hidden">
          {doc.docNo || 'Numbered when titled'}
        </p>
      </div>
      <span className="hidden w-40 shrink-0 truncate text-right font-mono text-xs text-muted-foreground sm:block">
        {doc.docNo}
      </span>
      <button
        type="button"
        onClick={() => actions.doc(nodeId, doc.id, { kind: doc.kind === 'Doc' ? 'Dwg' : 'Doc' })}
        aria-label={`${doc.kind === 'Doc' ? 'Document' : 'Drawing'}. Press to change`}
        className="flex h-11 shrink-0 items-center px-0.5"
      >
        <span className={cn(
          'rounded-md border px-1.5 py-0.5 text-xs font-semibold transition-colors duration-200 ease-ios',
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
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </m.div>
  );
}

/* ------------------------------------------------------------- adding */

/**
 * What + opens, under the heading it was pressed on. A choice only where both
 * are allowed; Enter or Add puts it in and keeps the box open for the next.
 * Pressing Add on an empty box is the one moment it says anything, in red.
 */
function AddInside({
  node, depth, register, actions,
}: {
  node: BuilderNode;
  depth: number;
  register: RegisterKind;
  actions: RowActions;
}) {
  const can = canHold(node, depth);
  const [mode, setMode] = useState<Mode>(() => {
    if (!can.headings) return 'documents';
    if (!can.documents) return 'headings';
    if (node.docs.length > 0 || node.existing > 0) return 'documents';
    // Headings first on an EDL: what the user asked for is main heading, then
    // sub-heading, then sub-sub-heading, each by pressing the one above.
    return register === 'edl' ? 'headings' : 'documents';
  });
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, [mode]);

  const put = (raw: string) => {
    const lines = linesOf(raw);
    if (lines.length === 0) { setNudge(mode === 'headings' ? 'Type a name first.' : 'Type a title first.'); field.current?.focus(); return; }
    if (mode === 'headings') {
      const here = new Set(node.children.map((c) => c.name.trim().toLowerCase()));
      if (lines.every((l) => here.has(l.toLowerCase()))) { setNudge('That one is already here.'); return; }
    }
    actions.addInside(node.id, mode, lines);
    setText('');
    setNudge(null);
    field.current?.focus();
  };

  return (
    <div className="my-1.5 flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5">
      {can.headings && can.documents && (
        <div role="radiogroup" aria-label="What to add" className="grid h-10 grid-cols-2 rounded-lg bg-background p-1 sm:w-80">
          {(['headings', 'documents'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              onClick={() => { setMode(k); setNudge(null); }}
              className={cn(
                'rounded-md text-sm font-medium transition-colors duration-200 ease-ios',
                mode === k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k === 'headings' ? 'Sub-heading' : 'Documents'}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={field}
          value={text}
          onChange={(e) => { setText(e.target.value); if (nudge) setNudge(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); actions.closeAdd(); return; }
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
          placeholder={mode === 'headings'
            ? `Sub-heading inside ${node.name || 'this heading'}`
            : 'Document title. Paste several lines to add many'}
          aria-label={mode === 'headings' ? `New sub-heading inside ${node.name}` : `New document inside ${node.name}`}
          aria-invalid={nudge ? true : undefined}
          className={cn(box, nudge && 'border-bad ring-3 ring-bad/15')}
        />
        <Button className="h-11 shrink-0" onClick={() => put(text)}>Add</Button>
      </div>
      {nudge && <p className="text-xs font-medium text-bad">{nudge}</p>}
      {mode === 'headings' && node.docs.length > 0 && !nudge && (
        <p className="text-xs text-muted-foreground">
          The {plural(node.docs.length, 'document')} above move into the first sub-heading.
        </p>
      )}
    </div>
  );
}

/** The one question the screen asks first: what are the main headings? */
function MainHeadingBox({
  first, register, existing, onAdd,
}: {
  first: boolean;
  register: RegisterKind;
  existing: string[];
  onAdd: (lines: string[]) => void;
}) {
  const edl = register === 'edl';
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const put = (raw: string) => {
    const lines = linesOf(raw);
    if (lines.length === 0) { setNudge('Type a name first.'); field.current?.focus(); return; }
    const here = new Set(existing.map((n) => n.trim().toLowerCase()));
    if (lines.every((l) => here.has(l.toLowerCase()))) { setNudge('That one is already here.'); return; }
    onAdd(lines);
    setText('');
    setNudge(null);
    field.current?.focus();
  };

  return (
    <div className={cn(!first && 'border-t pt-3')}>
      {first && (
        <label htmlFor="builder-main" className="mb-2 block text-[15px] font-semibold">
          {edl ? 'What are the main headings?' : 'Which vendor packages?'}
        </label>
      )}
      <div className="flex gap-2">
        <input
          id="builder-main"
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
          placeholder={edl
            ? (first ? 'e.g. GENERAL, then Enter' : 'Another main heading')
            : (first ? 'Package name, then Enter' : 'Another package')}
          aria-label={first ? undefined : (edl ? 'Add a main heading' : 'Add a vendor package')}
          aria-invalid={nudge ? true : undefined}
          className={cn(box, 'border-dashed bg-transparent', nudge && 'border-solid border-bad ring-3 ring-bad/15')}
        />
        <Button variant="outline" className="h-11 shrink-0" onClick={() => put(text)}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      {nudge && <p className="mt-1 text-xs font-medium text-bad">{nudge}</p>}
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
