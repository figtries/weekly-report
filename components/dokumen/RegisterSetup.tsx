'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ClipboardPaste, Copy, FileSpreadsheet, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DateField from '@/components/ui/DateField';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_DEPTH, addDocs, addHeadings, canHold, countDocuments, countNewHeadings, flatten, fromExisting, fromOutline,
  fromPaste, guessKind, holdsTyped, removeNode, renameNode, renumber, toDraftGroups, updateDoc,
  type BuilderDoc, type BuilderNode, type ExistingNode, type OutlineNode,
} from '@/lib/builder-model';
import { addFromDraft, readRegisterFile, saveNumbering, saveRegisterSettings } from '@/lib/doc-actions';
import { defaultRule, disciplineFor, knownDiscipline, nextNumber, typeFor, type NumberingRule } from '@/lib/register-numbering';
import { parseRegisterPaste } from '@/lib/register-paste';
import {
  CODE_EFFECT, CODE_TONE, STAGE_PALETTE, newStage, type CodeSetting, type RegisterSettings, type StageSetting,
} from '@/lib/register-settings';
import { REGISTER_INFO, isAddedStage, type RegisterSource } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

/**
 * Setup: everything a register is built from, on one screen (4 Oct 2026).
 *
 * The documents, the shape of their numbers, what the client's codes mean and
 * what each stage is called, weighs, looks like and which Rev it goes out
 * with. The two sides are NOT asked: they are the project's, set in Project
 * details, and a register only reads them.
 *
 * Every place that has to be filled says so in red, as a sentence, where it
 * is; the toolbar counts them and takes you to the first. Only what would
 * write a wrong figure holds Save back (weights that are not 100, a blank
 * code); a missing plan date or an empty heading is reminded, never refused.
 *
 * The tree is `lib/builder-model.ts`, proved by
 * `scripts/verify-builder-model.ts`. No Radix in the rows.
 */

const card = 'rounded-2xl bg-card shadow-[0_0_0_1px_rgba(16,24,40,.05),0_1px_2px_rgba(16,24,40,.06)]';
const title = 'text-[15px] font-bold tracking-tight text-foreground';
const field = 'h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-base text-foreground outline-none transition-colors duration-200 ease-ios placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 md:text-sm';
const bad = 'border-bad ring-3 ring-bad/15';
const MAIN: DocStage[] = ['IFR', 'IFA', 'AFC'];
const COMMON = ['General', 'Process', 'Mechanical', 'Piping', 'Civil', 'Structure', 'Electrical', 'Instrument', 'HSE'];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const docsUnder = (n: BuilderNode): number => n.existing + countDocuments([n]);

type Adding = { id: string; mode: 'documents' | 'headings' } | null;

export function RegisterSetup({
  projectId, register, clientName, contractorName, hasDocuments, settings: initialSettings,
  existing = [], numbering, sources = [], onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  hasDocuments: boolean;
  settings: RegisterSettings;
  existing?: ExistingNode[];
  numbering?: { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };
  sources?: RegisterSource[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const info = REGISTER_INFO[register];
  const edl = register === 'edl';
  const word = edl ? 'discipline' : 'package';
  const taken = useMemo(() => numbering?.taken ?? [], [numbering]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [tree, setTree] = useState<BuilderNode[]>(() => fromExisting(existing));
  const [origin, setOrigin] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding>(null);
  const [confirmRemove, setConfirmRemove] = useState<BuilderNode | null>(null);
  const [rule, setRule] = useState<NumberingRule>(() => {
    const r = numbering?.rule ?? defaultRule(numbering?.suggestedPrefix ?? '');
    return { ...r, area: r.area ?? initialSettings.area ?? '' };
  });
  const [ruleDirty, setRuleDirty] = useState(false);
  const [stages, setStages] = useState<StageSetting[]>(() => [
    ...MAIN.map((s) => initialSettings.stages.find((x) => x.stage === s)!).filter(Boolean),
    ...initialSettings.stages.filter((x) => isAddedStage(x.stage)),
  ]);
  const [codes, setCodes] = useState<CodeSetting[]>(initialSettings.codes);
  const [settingsDirty, setSettingsDirty] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteFrom, setPasteFrom] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);

  const numbered = useMemo(() => renumber(tree, rule, taken), [tree, rule, taken]);
  const rows = useMemo(() => flatten(numbered), [numbered]);
  const newDocs = countDocuments(numbered);
  const newHeadings = countNewHeadings(tree);
  const allDocs = rows.filter((r) => r.depth === 1).reduce((n, r) => n + docsUnder(r.node), 0);
  const startable = !hasDocuments && tree.length === 0;
  const spoken = useMemo(() => [...taken, ...rows.flatMap((r) => r.node.docs.map((d) => d.docNo).filter(Boolean))], [taken, rows]);
  const first = stages[0];

  const edit = (fn: (t: BuilderNode[]) => BuilderNode[]) => { setTree(fn); setSaved(false); };
  const editRule = (patch: Partial<NumberingRule>) => { setRule((r) => ({ ...r, ...patch })); setRuleDirty(true); setSaved(false); };
  const editStage = (stage: DocStage, patch: Partial<StageSetting>) => {
    setStages((all) => all.map((s) => (s.stage === stage ? { ...s, ...patch } : s)));
    setSettingsDirty(true); setSaved(false);
  };
  // The three are fixed; a stage added here can go again (the server refuses one already sent).
  const addStage = () => { setStages((all) => [...all, newStage(all)]); setSettingsDirty(true); setSaved(false); };
  const removeStage = (stage: DocStage) => { setStages((all) => all.filter((s) => s.stage !== stage)); setSettingsDirty(true); setSaved(false); };
  const editCode = (key: string, patch: Partial<CodeSetting>) => {
    setCodes((all) => all.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    setSettingsDirty(true); setSaved(false);
  };

  /* -------------------------------------------------------- what is missing */

  const mains = numbered.map((n) => n.name);
  const groupsWithDocs = rows.filter((r) => r.depth > 1 && (r.node.docs.length > 0 || r.node.existing > 0)).map((r) => r.node.name);
  const typeNames = [...new Set(groupsWithDocs)];
  const emptyGroups = rows.filter((r) => !r.node.locked && r.node.children.length === 0 && r.node.docs.every((d) => !d.title.trim()));
  const noPlan = rows.flatMap((r) => r.node.docs.filter((d) => d.title.trim() && !d.planIfr));
  const blankCodes = !edl ? [] : mains.filter((m) => rule.disciplines[m] !== undefined && !rule.disciplines[m].trim());
  const total = stages.reduce((n, s) => n + (Number.isFinite(s.weight) ? s.weight : 0), 0);
  const weightsOff = Math.abs(total - 100) > 0.001;
  const blankStage = stages.filter((s) => !s.label.trim());
  const blankReply = codes.filter((c) => !c.label.trim());
  const blocking = blankCodes.length + (weightsOff ? 1 : 0) + blankStage.length + blankReply.length;
  const reminders = blocking + emptyGroups.length + (noPlan.length > 0 ? 1 : 0);

  const toFirst = () => document.querySelector('[data-reminder]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  /* ----------------------------------------------------------- starting */

  const begin = (next: BuilderNode[], from: string | null) => {
    setTree(next); setOrigin(from); setError(null); setPasteOpen(false); setAdding(null); setSaved(false);
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

  const dirty = newDocs > 0 || newHeadings > 0 || ruleDirty || settingsDirty;

  const save = () => {
    setError(null);
    // Said when Save is pressed, not before: a grey button gives no reason.
    if (blocking > 0) {
      setError(weightsOff ? `The stage weights add up to ${total}%. Make them 100% before saving.` : 'Fill in the codes marked in red before saving.');
      toFirst();
      return;
    }
    start(async () => {
      if (settingsDirty) {
        const r = await saveRegisterSettings({
          projectId, register, area: rule.area ?? '',
          stages: stages.map((s) => ({ stage: s.stage, weight: s.weight, label: s.label, name: s.name, color: s.color, revStart: s.revStart })),
          codes: codes.map((c) => ({ key: c.key, label: c.label, meaning: c.meaning })),
        });
        if (!r.ok) { setError(r.error); return; }
      }
      if (rule.prefix.trim() && (ruleDirty || (newDocs > 0 && !numbering?.rule))) {
        const r = await saveNumbering({
          projectId, register, prefix: rule.prefix, disciplines: rule.disciplines, types: rule.types, area: rule.area ?? '',
        });
        if (!r.ok) { setError(r.error); return; }
      }
      if (newDocs > 0 || newHeadings > 0) {
        const r = await addFromDraft({ projectId, register, groups: toDraftGroups(numbered) });
        if (!r.ok) { setError(r.error); return; }
      }
      setRuleDirty(false);
      setSettingsDirty(false);
      setSaved(true);
      if (onClose) onClose();
      router.refresh();
    });
  };

  /* --------------------------------------------------------------- tree */

  const addMain = (lines: string[]): string | null => {
    const here = new Set(tree.map((n) => n.name.trim().toLowerCase()));
    if (lines.every((l) => here.has(l.toLowerCase()))) return 'That one is already here.';
    edit((t) => addHeadings(t, null, lines));
    return null;
  };

  const remove = (node: BuilderNode) => {
    if (node.locked) return;
    if (holdsTyped(node)) { setConfirmRemove(node); return; }
    edit((t) => removeNode(t, node.id));
  };

  /** The number the next document typed here would get, for the add box. */
  const hintFor = (path: string[], node: BuilderNode) => (text: string) => {
    if (!rule.prefix.trim()) return '';
    const section = path.find((n) => knownDiscipline(n, rule)) ?? path[0];
    return nextNumber(rule, section, path.length > 1 ? node.name : text || 'Document', guessKind(text || 'Document'), spoken);
  };

  const pathOf = useMemo(() => {
    const map = new Map<string, string[]>();
    const walk = (ns: BuilderNode[], path: string[]) => ns.forEach((n) => { const here = [...path, n.name]; map.set(n.id, here); walk(n.children, here); });
    walk(numbered, []);
    return map;
  }, [numbered]);

  const missingCommon = edl ? COMMON.filter((c) => !mains.some((m) => m.toLowerCase().includes(c.toLowerCase()))).slice(0, 5) : [];

  /* -------------------------------------------------------------- render */

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-6">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />

      {/* -------------------------------------------------------- toolbar */}
      {/* Back sits on its own bar above the title (9 Oct 2026): beside it, it
          pushed the title in and the parties wrapped into a ragged sentence. */}
      {/* From sm the three share one row (back, title, actions) and the parties
          start a row of their own, flush left with the back arrow: stacked, the wide screen kept a bar
          of empty space above the title (variant B, 9 Oct 2026). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-2 sm:gap-y-1.5">
        <div className="flex min-h-11 items-center gap-3 sm:contents">
          {onClose && (
            <button type="button" onClick={onClose} className="inline-flex h-11 shrink-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:h-8 sm:w-full">
              <ArrowLeft className="size-3.5" />
              Back to {info.short} Data
            </button>
          )}
          <div className="ml-auto flex items-center gap-3 sm:order-2 sm:shrink-0">
          {reminders > 0 ? (
            <button type="button" onClick={toFirst} className="inline-flex min-h-9 items-center rounded-lg bg-bad-soft px-3 text-[13px] font-semibold text-bad">
              Fill in {plural(reminders, 'thing')} to finish
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[13px] font-medium text-ok"><Check className="h-4 w-4" />Nothing missing</span>
          )}
          <span className="hidden text-[13px] text-foreground/60 sm:inline">{pending ? 'Saving…' : dirty ? 'Not saved yet' : saved ? 'Saved' : ''}</span>
          <div className="hidden items-center gap-2 sm:flex">
            {onClose && <Button variant="ghost" className="btn-cancel h-11" onClick={onClose}>Cancel</Button>}
            <Button className="h-11 min-w-24" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save'}</Button>
          </div>
          </div>
        </div>
        <div className="min-w-0 sm:contents">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-foreground sm:order-1 sm:flex sm:min-h-11 sm:min-w-0 sm:flex-1 sm:items-center">
            {hasDocuments ? `Set up the ${info.short}` : `Build the ${info.short}`}
          </h1>
          <div className="sm:order-3 sm:flex sm:basis-full sm:flex-wrap sm:items-center sm:gap-2">
            {contractorName || clientName ? (
              <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13.5px] leading-5 sm:mt-0 sm:flex sm:flex-wrap sm:gap-2">
                <div className="contents sm:flex sm:min-h-8 sm:items-center sm:gap-1.5 sm:rounded-lg sm:border sm:border-border sm:bg-card sm:px-3">
                  <dt className="text-foreground/60">Contractor</dt>
                  <dd className="break-words font-semibold text-foreground">{contractorName || 'Not set'}</dd>
                </div>
                <div className="contents sm:flex sm:min-h-8 sm:items-center sm:gap-1.5 sm:rounded-lg sm:border sm:border-border sm:bg-card sm:px-3">
                  <dt className="text-foreground/60">Client</dt>
                  <dd className="break-words font-semibold text-foreground">{clientName || 'Not set'}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-1.5 text-[13.5px] text-foreground/70 sm:mt-0">Contractor and client are not set yet.</p>
            )}
            <p className="mt-1.5 text-[12.5px] text-foreground/60 sm:mt-0 sm:ml-1 sm:text-[13px]">
              <span className="sm:hidden">Change them in Project details</span>
              <a href={`/projects/${projectId}#edit=contractorName`} className="hidden font-medium text-primary hover:underline sm:inline">Change in Project details</a>
              {origin && <> · Copied from {origin}</>}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="animate-fade-in-up rounded-xl bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{error}</p>
      )}

      {/* ---------------------------------------------------- start strip */}
      {startable && (
        <section className={cn(card, 'animate-enter p-4 sm:p-5')}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className={title}>Start the {info.short}</h2>
            <span className="text-[13px] text-foreground/70">Pick a starting point, or type straight into the list below. Numbers fill themselves.</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            <StartTile icon={<FileSpreadsheet className="h-4 w-4" />} name="Import Excel" note={`An ${info.short} workbook (.xlsx)`} busy={pending} onClick={() => fileInput.current?.click()} />
            <StartTile icon={<ClipboardPaste className="h-4 w-4" />} name="Paste from Excel" note="Copied rows from any sheet" active={pasteOpen} onClick={() => setPasteOpen((v) => !v)} />
            {sources.length > 0 ? sources.slice(0, 2).map((s) => (
              <StartTile key={s.projectId} icon={<Copy className="h-4 w-4" />} name={`Copy from ${s.name}`} note={edl ? 'Disciplines and titles' : 'Packages and titles'} busy={loadingSource === s.projectId} onClick={() => copyFrom(s)} />
            )) : (
              <StartTile icon={<Copy className="h-4 w-4" />} name="Copy from another project" note="No other project has one yet" disabled />
            )}
          </div>
          {pasteOpen && <PastePanel register={register} text={pasteText} from={pasteFrom} onText={(t) => { setPasteText(t); setPasteFrom(null); }} onContinue={(plan) => begin(fromPaste(plan), pasteFrom ?? 'your paste')} />}
        </section>
      )}

      {/* ------------------------------------- documents · document number */}
      <div className={cn('grid grid-cols-[minmax(0,1fr)] items-stretch gap-4', edl && 'xl:grid-cols-[minmax(0,1fr)_27rem]')}>
        <section className={cn(card, 'animate-enter stagger-1 @container flex min-w-0 flex-col overflow-hidden')}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pb-3 pt-5">
            <h2 className={title}>Documents</h2>
            <span className="text-[13px] text-foreground/70 tabular-nums">
              {plural(allDocs, 'document')} in {plural(mains.length, word)}{newDocs > 0 && hasDocuments && ` · ${newDocs} new`}
            </span>
          </div>
          <div className="hidden grid-cols-[11.5rem_minmax(0,1fr)_4.5rem_9.75rem_2.75rem] items-center gap-3 border-y border-border/70 bg-muted/50 px-5 py-2 text-xs font-medium text-foreground/70 @2xl:grid">
            <span>No.</span><span>Title</span><span>Kind</span><span>Plan {first?.label || 'IFR'}</span><span />
          </div>

          <div className="flex-1">
            {rows.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-foreground/70">
                {edl ? 'Type the first discipline below, Process, Piping, Civil…' : 'Type the first vendor package below.'}
                {startable && ' Or start from a file above.'}
              </p>
            )}
            {rows.map(({ node, depth }) => {
              const path = pathOf.get(node.id) ?? [node.name];
              const hold = canHold(node, depth);
              const empty = emptyGroups.some((r) => r.node.id === node.id);
              const open = adding?.id === node.id ? adding.mode : empty && hold.documents ? 'documents' : null;
              const code = edl && depth === 1 ? disciplineFor(node.name, rule) : null;
              return (
                <div key={node.id}>
                  <div className="flex min-h-12 items-center gap-2 border-b border-border/60 bg-[#f8faff] py-1.5 pr-3" style={{ paddingLeft: `${20 + (depth - 1) * 20}px` }}>
                    {/* Name and count wrap rather than truncate: "Instrument &…" hid which discipline a row was. */}
                    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    {node.locked ? (
                      <span className={cn('min-w-0 break-words font-semibold text-foreground', depth === 1 ? 'text-[14px]' : 'text-[13.5px]')}>{node.name}</span>
                    ) : (
                      <input
                        value={node.name}
                        onChange={(e) => edit((t) => renameNode(t, node.id, e.target.value))}
                        aria-label={`${node.name} name`}
                        className={cn('min-w-0 max-w-full rounded-lg bg-transparent px-1 py-1 font-semibold text-foreground outline-none [field-sizing:content] focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/40', depth === 1 ? 'text-[14px]' : 'text-[13.5px]')}
                      />
                    )}
                    <span className="shrink-0 text-xs text-foreground/60 tabular-nums">
                      {plural(docsUnder(node), 'doc')}{code && ` · code ${code}`}{node.locked && node.existing > 0 && ' · saved'}
                    </span>
                    </div>
                    {hold.headings && depth < MAX_DEPTH && (
                      <button type="button" onClick={() => setAdding({ id: node.id, mode: 'headings' })} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-primary hover:bg-primary-soft">
                        <Plus className="h-3.5 w-3.5" /><span className="max-sm:sr-only">Sub-heading</span>
                      </button>
                    )}
                    {hold.documents && (
                      <button type="button" onClick={() => setAdding({ id: node.id, mode: 'documents' })} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-primary-soft px-3 text-[13px] font-semibold text-primary">
                        <Plus className="h-3.5 w-3.5" />Add
                      </button>
                    )}
                    {!node.locked && (
                      <button type="button" onClick={() => remove(node)} aria-label={`Remove ${node.name}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/50 hover:bg-bad-soft hover:text-bad">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {node.docs.map((d) => (
                    <DocLine
                      key={d.id}
                      doc={d}
                      indent={depth}
                      onChange={(patch) => edit((t) => updateDoc(t, node.id, d.id, patch))}
                    />
                  ))}

                  {open && (
                    <div className="border-b border-border/60 px-5 py-3" style={{ paddingLeft: `${20 + (depth - 1) * 20}px` }}>
                      <AddLine
                        key={`${node.id}-${open}`}
                        autoFocus={adding?.id === node.id}
                        label={open === 'documents' ? `Add documents to ${node.name}` : `Add a sub-heading to ${node.name}`}
                        placeholder={open === 'documents' ? 'Title, or paste from Excel' : 'Sub-heading, e.g. Datasheet'}
                        empty="Type a title first."
                        hint={open === 'documents' ? hintFor(path, node) : undefined}
                        onAdd={(lines) => {
                          edit((t) => (open === 'documents' ? addDocs(t, node.id, lines) : addHeadings(t, node.id, lines)));
                          return null;
                        }}
                        onDone={adding?.id === node.id ? () => setAdding(null) : undefined}
                      />
                      {empty && (
                        <Reminder>{node.name} has no documents yet. Add at least one, or remove it.</Reminder>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {noPlan.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 px-5 py-3">
              <Reminder inline>Plan {first?.label || 'IFR'} date needed on {plural(noPlan.length, 'new document')}.</Reminder>
              <label className="ml-auto inline-flex items-center gap-2 text-[13px] text-foreground/70">
                One date for all of them
                <DateField
                  value=""
                  placeholder="Pick a date"
                  className={cn(field, 'h-9 w-[9.5rem]')}
                  onChange={(v) => {
                    if (!v) return;
                    const fill = (ns: BuilderNode[]): BuilderNode[] => ns.map((n) => ({
                      ...n,
                      docs: n.docs.map((d) => (d.title.trim() && !d.planIfr ? { ...d, planIfr: v } : d)),
                      children: fill(n.children),
                    }));
                    edit(fill);
                  }}
                />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border/70 px-5 py-4">
            <AddLine
              label={edl ? 'Add a discipline' : 'Add a vendor package'}
              placeholder={edl ? (tree.length === 0 ? 'First discipline, e.g. Process' : 'Discipline name') : (tree.length === 0 ? 'First package name' : 'Package name')}
              empty="Type a name first."
              onAdd={addMain}
            />
            {missingCommon.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-foreground/60">or one press:</span>
                {missingCommon.map((c) => (
                  <button key={c} type="button" onClick={() => addMain([c])} className="inline-flex min-h-9 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-foreground hover:border-primary/40 hover:bg-primary-soft">
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* The VDRL has no number format: a vendor document keeps its
            vendor's number (9 Oct 2026). */}
        {edl && (
          <NumberCard
            rule={rule}
            mains={mains}
            types={typeNames}
            onRule={editRule}
            className="animate-enter stagger-2"
          />
        )}
      </div>

      {/* ------------------------------------------- client codes · stages */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_27rem]">
        <StagesCard stages={stages} total={total} weightsOff={weightsOff} onStage={editStage} onAdd={addStage} onRemove={removeStage} className="animate-enter stagger-3" />
        <CodesCard codes={codes} edl={edl} onCode={editCode} className="animate-enter stagger-4" />
      </div>

      {/* Phones: Save stays under the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-background px-4 py-3 sm:hidden">
        <span className="min-w-0 truncate text-sm text-foreground/70">{pending ? 'Saving…' : dirty ? 'Not saved yet' : saved ? 'Saved' : ''}</span>
        {onClose && <Button variant="ghost" className="btn-cancel ml-auto h-11" onClick={onClose}>Cancel</Button>}
        <Button className={cn('h-11 min-w-24 shrink-0', !onClose && 'ml-auto')} disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save'}</Button>
      </div>

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove ${confirmRemove?.name ?? ''}?`}
        message="What was typed under it goes too. Nothing has been saved yet, so nothing in the register changes."
        confirmLabel="Remove"
        onConfirm={() => { if (confirmRemove) edit((t) => removeNode(t, confirmRemove.id)); setConfirmRemove(null); }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

/* ================================================================ pieces */

function Reminder({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <p data-reminder className={cn('flex items-start gap-2 text-[13px] font-medium text-bad', !inline && 'mt-2')}>
      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-bad" />
      <span>{children}</span>
    </p>
  );
}

function StartTile({
  icon, name, note, onClick, busy, active, disabled,
}: { icon: React.ReactNode; name: string; note: string; onClick?: () => void; busy?: boolean; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      aria-expanded={active}
      className={cn(
        'flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ease-ios',
        active ? 'border-primary/50 bg-primary-soft' : 'border-border bg-card hover:border-primary/30 hover:bg-[#f8faff]',
        disabled && 'opacity-60',
      )}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', active ? 'bg-primary text-primary-foreground' : 'bg-primary-soft text-primary')}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold text-foreground">{busy ? 'Reading…' : name}</span>
        <span className="block truncate text-xs text-foreground/65">{note}</span>
      </span>
    </button>
  );
}

function PastePanel({
  register, text, from, onText, onContinue,
}: {
  register: RegisterKind;
  text: string;
  from: string | null;
  onText: (t: string) => void;
  onContinue: (plan: ReturnType<typeof parseRegisterPaste>) => void;
}) {
  const plan = useMemo(() => (text.trim() ? parseRegisterPaste(text) : null), [text]);
  return (
    <div className="animate-fade-in-up mt-4 border-t border-border/70 pt-4">
      <p className="text-sm font-medium text-foreground">{from ?? 'Your list'}</p>
      <Textarea
        className="mt-2 max-h-72 min-h-36 overflow-auto rounded-xl font-mono text-xs leading-relaxed"
        value={text}
        onChange={(e) => onText(e.target.value)}
        spellCheck={false}
        aria-label={`Paste your ${register === 'edl' ? 'EDL' : 'VDRL'}`}
        placeholder={'PROCESS\nProcess Design Basis\nProcess Flow Diagram (PFD)'}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-foreground/70">
          {plan
            ? `${plural(plan.counts.documents, 'document')} under ${plural(plan.categories.filter((c) => c.depth === 1).length, 'heading')}`
            : 'Headings on their own lines, documents under them.'}
        </p>
        <Button className="h-11" disabled={!plan || plan.counts.documents === 0} onClick={() => plan && onContinue(plan)}>Continue</Button>
      </div>
    </div>
  );
}

function DocLine({ doc, indent, onChange }: { doc: BuilderDoc; indent: number; onChange: (patch: Partial<BuilderDoc> | null) => void }) {
  const typed = doc.title.trim() !== '';
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1.5 border-b border-border/50 py-2.5 pr-3 @2xl:grid-cols-[11.5rem_minmax(0,1fr)_4.5rem_9.75rem_2.75rem] @2xl:gap-3 @2xl:py-1.5 @2xl:pr-5"
      style={{ paddingLeft: `${20 + (indent - 1) * 20}px` }}
    >
      <span className="truncate font-mono text-[12.5px] tracking-tight text-foreground/75 @2xl:order-none">{doc.docNo || '—'}</span>
      <button
        type="button"
        onClick={() => onChange({ kind: doc.kind === 'Doc' ? 'Dwg' : 'Doc' })}
        aria-label={`Kind: ${doc.kind === 'Dwg' ? 'drawing' : 'document'}. Press to change.`}
        className={cn('inline-flex h-8 min-w-12 items-center justify-center rounded-lg border px-2 text-xs font-semibold @2xl:order-3 @2xl:w-full', doc.kind === 'Dwg' ? 'border-primary/30 bg-primary-soft text-primary' : 'border-border text-foreground/80')}
      >
        {doc.kind}
      </button>
      <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${doc.title || 'this document'}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/45 hover:bg-bad-soft hover:text-bad @2xl:order-5">
        <X className="h-4 w-4" />
      </button>
      <input
        value={doc.title}
        onChange={(e) => onChange({ title: e.target.value })}
        aria-label="Title"
        placeholder="Title"
        className={cn(field, 'col-span-3 h-9 border-transparent bg-transparent px-2 font-medium hover:border-border focus-visible:bg-card @2xl:order-2 @2xl:col-span-1')}
      />
      <DateField
        value={doc.planIfr ?? ''}
        onChange={(v) => onChange({ planIfr: v })}
        placeholder="Plan date"
        clearable
        aria-label="Plan date"
        aria-invalid={typed && !doc.planIfr ? true : undefined}
        className={cn(field, 'col-span-3 h-9 tabular-nums @2xl:order-4 @2xl:col-span-1', typed && !doc.planIfr && 'border-bad text-bad')}
      />
    </div>
  );
}

function AddLine({
  label, placeholder, empty, onAdd, hint, autoFocus, onDone,
}: {
  label: string;
  placeholder: string;
  /** Said when Add is pressed on an empty box. */
  empty: string;
  /** Returns why nothing was added, or null when it was. */
  onAdd: (lines: string[]) => string | null;
  /** The number the typed title would get. */
  hint?: (text: string) => string;
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState<string | null>(null);
  // Variant A (9 Oct 2026): a dashed "+ Add" row in the list that turns into a
  // box when pressed. A box with a button inside it read as a box in a box.
  const [open, setOpen] = useState(!!autoFocus || !!onDone);

  const put = (raw: string) => {
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\t+/g, ' ').trim()).filter(Boolean);
    const why = lines.length === 0 ? empty : onAdd(lines);
    if (why) { setNudge(why); box.current?.focus(); return; }
    setText('');
    setNudge(null);
    box.current?.focus();
  };
  const close = () => { setText(''); setNudge(null); if (onDone) onDone(); else setOpen(false); };
  const next = hint?.(text.trim());

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-primary/35 text-[14px] font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary-soft"
      >
        <Plus className="h-4 w-4" aria-hidden />{label}
      </button>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <input
        ref={box}
        autoFocus
        value={text}
        onChange={(e) => { setText(e.target.value); if (nudge) setNudge(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { close(); return; }
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
        className={cn('h-11 w-full rounded-xl border-[1.5px] border-primary bg-card px-3.5 text-base outline-none ring-3 ring-ring/20 placeholder:text-muted-foreground/80 md:text-sm', nudge && bad)}
      />
      {nudge && <p className="mt-1.5 text-[13px] font-medium text-bad">{nudge}</p>}
      <div className="mt-2 flex items-center gap-2">
        {next && <span className="min-w-0 truncate font-mono text-xs text-foreground/70"><b className="font-semibold text-foreground">{next}</b> next</span>}
        <Button variant="ghost" className="btn-cancel ml-auto h-9" onClick={close}>Cancel</Button>
        <Button className="h-9 min-w-20" onClick={() => put(text)}>Add</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- number card */

function NumberCard({
  rule, mains, types, onRule, className,
}: {
  rule: NumberingRule;
  mains: string[];
  types: string[];
  onRule: (patch: Partial<NumberingRule>) => void;
  className?: string;
}) {
  const sample = mains[0] ?? 'Process';
  const discipline = disciplineFor(sample, rule);
  const type = `G${typeFor(types[0] ?? 'Drawing', rule)}`;
  const example = [rule.prefix, rule.area, discipline, type, '001'.padStart(rule.digits, '0')].filter((x) => x && x.trim()).join('-');
  const seg = 'flex h-10 min-w-11 items-center justify-center rounded-xl border px-2 font-mono text-[13px] font-semibold sm:h-11 sm:min-w-14 sm:px-3 sm:text-[15px]';
  // Each part of the number has a length. Typing past it used to do nothing
  // at all, which read as a broken box; now the box turns red and says why,
  // and clears on the next keystroke that fits.
  const [over, setOver] = useState<{ key: string; text: string } | null>(null);
  const take = (key: string, what: string, max: number, raw: string) => {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setOver(v.length > max ? { key, text: `${what} takes at most ${max} characters.` } : null);
    return v.slice(0, max);
  };
  const overRing = (key: string) => over?.key === key && 'border-bad bg-bad-soft/40 ring-2 ring-bad/30';
  return (
    <section className={cn(card, 'flex min-w-0 flex-col gap-4 p-5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={title}>Document number</h2>
        <span className="truncate font-mono text-[13px] font-medium text-foreground/75">{example}</span>
      </div>

      <div className="flex flex-wrap items-start gap-x-1 gap-y-2 sm:gap-x-1.5">
        {[
          { label: 'Project', node: <span className={cn(seg, 'border-primary bg-primary text-primary-foreground')}>{rule.prefix || '—'}</span> },
          {
            label: 'Area',
            node: (
              <input
                value={rule.area ?? ''}
                onChange={(e) => onRule({ area: take('area', 'The area code', 6, e.target.value) })}
                onBlur={() => setOver(null)}
                aria-invalid={over?.key === 'area' ? true : undefined}
                placeholder="—"
                aria-label="Area code, optional"
                className={cn(seg, 'min-w-14 px-1.5 [field-sizing:content] bg-card sm:min-w-20 sm:px-3 text-center outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40', !rule.area && 'border-dashed', overRing('area'))}
              />
            ),
          },
          { label: 'Discipline', node: <span className={cn(seg, 'border-primary/40 bg-primary-soft text-primary')}>{discipline}</span> },
          { label: 'Type', node: <span className={cn(seg, 'border-border bg-card text-foreground')}>{type}</span> },
          { label: 'Sequence', node: <span className={cn(seg, 'border-dashed border-border bg-card text-foreground/70')}>{'1'.padStart(rule.digits, '0')}</span> },
        ].map((s, i) => (
          <div key={s.label} className="flex items-start gap-1.5">
            {i > 0 && <span className="mt-2.5 text-foreground/40 sm:mt-3">-</span>}
            <div className="flex flex-col items-center gap-1">
              {s.node}
              <span className="text-[11px] text-foreground/60">{s.label}</span>
            </div>
          </div>
        ))}
      </div>
      {over?.key === 'area' && <Reminder inline>{over.text}</Reminder>}
      <p className="-mt-1 text-[13px] text-foreground/70">
        <b className="font-semibold text-foreground">{rule.prefix || 'The first part'}</b> is the project&apos;s initial, changed in Project details. Area is optional; the rest is yours to edit.
      </p>

      <div className="border-t border-border/70 pt-4">
        <h3 className="text-[13.5px] font-bold text-foreground">Disciplines</h3>
        {mains.length === 0 ? (
          <p className="mt-2 text-[13px] text-foreground/65">Each discipline gets a code here as soon as you add it.</p>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {mains.map((m) => {
              const stored = rule.disciplines[m];
              const blank = stored !== undefined && !stored.trim();
              return (
                <label key={m} className={cn('flex h-11 min-w-0 items-center gap-2 rounded-xl border bg-card pl-2 pr-3', blank ? 'border-bad bg-bad-soft/40' : 'border-border', overRing(`d:${m}`))}>
                  <input
                    value={stored ?? disciplineFor(m, rule)}
                    onChange={(e) => onRule({ disciplines: { ...rule.disciplines, [m]: take(`d:${m}`, `${m}'s code`, 4, e.target.value) } })}
                    onBlur={() => setOver(null)}
                    aria-invalid={over?.key === `d:${m}` ? true : undefined}
                    aria-label={`${m} code`}
                    className="h-8 w-12 shrink-0 rounded-lg bg-primary-soft text-center font-mono text-[13px] font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  />
                  <span className="min-w-0 break-words text-[13px] leading-tight text-foreground">{m}</span>
                </label>
              );
            })}
          </div>
        )}
        {mains.filter((m) => rule.disciplines[m] !== undefined && !rule.disciplines[m].trim()).map((m) => (
          <Reminder key={m}>{m} needs a code before its documents can be numbered.</Reminder>
        ))}
        {over?.key.startsWith('d:') && <Reminder>{over.text}</Reminder>}
      </div>

      <div className="border-t border-border/70 pt-4">
        <h3 className="text-[13.5px] font-bold text-foreground">Types</h3>
        {types.length === 0 ? (
          <p className="mt-2 text-[13px] text-foreground/65">
            A document straight under a discipline takes its type from its title: a datasheet is DS, a drawing DW. Sub-headings get a code of their own here.
          </p>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {types.map((t) => (
              <label key={t} className={cn('inline-flex h-10 items-center gap-1.5 rounded-xl border border-transparent bg-primary-soft/70 pl-1.5 pr-3', overRing(`t:${t}`))}>
                <input
                  value={rule.types[t] ?? typeFor(t, rule)}
                  onChange={(e) => onRule({ types: { ...rule.types, [t]: take(`t:${t}`, `${t}'s type code`, 3, e.target.value) } })}
                  onBlur={() => setOver(null)}
                  aria-invalid={over?.key === `t:${t}` ? true : undefined}
                  aria-label={`${t} type code`}
                  className="h-7 w-11 rounded-lg bg-card text-center font-mono text-xs font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <span className="text-[13px] text-foreground">{t}</span>
              </label>
            ))}
          </div>
        )}
        {over?.key.startsWith('t:') && <Reminder>{over.text}</Reminder>}
        <p className="mt-2.5 text-xs text-foreground/60">The type starts with D for a document and G for a drawing.</p>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- codes card */

function CodesCard({
  codes, edl, onCode, className,
}: { codes: CodeSetting[]; edl: boolean; onCode: (key: string, patch: Partial<CodeSetting>) => void; className?: string }) {
  return (
    <section className={cn(card, 'flex min-w-0 flex-col p-5', className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={title}>{edl ? 'Client codes' : 'Vendor return codes'}</h2>
        <span className="text-[13px] text-foreground/70">What a reply means. The words are yours; what each one does stays.</span>
      </div>
      <div className="mt-3 flex flex-col">
        {codes.map((c) => (
          <div key={c.key} className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-border/60 py-3 last:border-b-0">
            <input
              value={c.label}
              onChange={(e) => onCode(c.key, { label: e.target.value.toUpperCase().slice(0, 6) })}
              aria-label={`Code for ${c.meaning}`}
              aria-invalid={!c.label.trim() ? true : undefined}
              className={cn('h-11 w-full rounded-xl text-center font-mono text-[15px] font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/40', CODE_TONE[c.key], !c.label.trim() && bad)}
            />
            <input
              value={c.meaning}
              onChange={(e) => onCode(c.key, { meaning: e.target.value })}
              aria-label={`What ${c.label || c.key} means`}
              className={cn(field, 'h-11 font-semibold')}
            />
            <span className="col-start-2 pl-1 text-[13px] text-foreground/65">{CODE_EFFECT[c.key]}</span>
            {!c.label.trim() && <div className="col-span-full"><Reminder>Write the code the client puts on a reply that means &ldquo;{c.meaning}&rdquo;.</Reminder></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- stages card */

function StagesCard({
  stages, total, weightsOff, onStage, onAdd, onRemove, className,
}: {
  stages: StageSetting[];
  total: number;
  weightsOff: boolean;
  onStage: (stage: DocStage, patch: Partial<StageSetting>) => void;
  onAdd: () => void;
  onRemove: (stage: DocStage) => void;
  className?: string;
}) {
  const [palette, setPalette] = useState<DocStage | null>(null);
  // One grid for the header, every row and the add row, edge to edge with the bar above.
  const cols = 'grid grid-cols-[2.75rem_4.25rem_3.25rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_5rem_minmax(0,1fr)_4rem_5.5rem] items-center gap-x-2';
  return (
    <section className={cn(card, 'flex min-w-0 flex-col p-5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={title}>Stages and weights</h2>
        {weightsOff
          ? <span className="text-[13px] font-semibold text-bad tabular-nums">Total {total}%</span>
          : <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-ok"><Check className="h-3.5 w-3.5" />Total 100%</span>}
      </div>
      <p className="mt-1 text-[13px] text-foreground/70">What a document goes through, and what each stage is worth.</p>
      <div className="mt-3 flex h-2.5 gap-1 overflow-hidden rounded-full">
        {stages.map((s) => <span key={s.stage} className="rounded-full transition-[flex-grow] duration-300 ease-ios" style={{ flexGrow: Math.max(0, s.weight) || 0.0001, background: s.color }} />)}
      </div>

      <div className={cn(cols, 'mt-3 text-[11px] font-medium text-foreground/60')}>
        <span>Colour</span><span>Short</span><span className="max-sm:hidden">Name</span><span className="text-center">Rev</span><span className="text-right">Weight</span>
      </div>
      {/* A hairline between rows, the codes card's rhythm beside it. */}
      <div className="mt-1 flex flex-col">
        {stages.map((s) => (
          <div key={s.stage} className="border-b border-border/60 py-2.5">
            <div className={cols}>
              <button
                type="button"
                onClick={() => setPalette((p) => (p === s.stage ? null : s.stage))}
                aria-label={`${s.label} colour`}
                aria-expanded={palette === s.stage}
                className={cn('size-10 rounded-full ring-offset-2 transition-shadow', palette === s.stage ? 'ring-2 ring-primary' : 'ring-1 ring-black/5')}
                style={{ background: s.color }}
              />
              <input
                value={s.label}
                onChange={(e) => onStage(s.stage, { label: e.target.value.toUpperCase().slice(0, 8) })}
                aria-label={`${s.name || 'Stage'} short name`}
                placeholder={isAddedStage(s.stage) ? 'IFC' : undefined}
                className={cn(field, 'px-1 text-center font-bold', !s.label.trim() && bad)}
              />
              {/* An added stage's remove sits inside its name box: no extra track, so every row keeps the card's edge. */}
              <div className="relative min-w-0 max-sm:order-last max-sm:col-span-3 max-sm:col-start-2 max-sm:mt-1.5">
                <input
                  value={s.name}
                  onChange={(e) => onStage(s.stage, { name: e.target.value })}
                  aria-label={`${s.label || 'Stage'} full name`}
                  placeholder={isAddedStage(s.stage) ? 'Issued for construction' : undefined}
                  className={cn(field, 'w-full', isAddedStage(s.stage) && 'pr-11')}
                />
                {isAddedStage(s.stage) && (
                  <button type="button" onClick={() => onRemove(s.stage)} aria-label={`Remove ${s.label || 'this stage'}`} className="absolute right-0.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-foreground/45 hover:bg-bad-soft hover:text-bad">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <input
                value={s.revStart}
                onChange={(e) => onStage(s.stage, { revStart: e.target.value.toUpperCase().slice(0, 3) })}
                aria-label={`${s.label || s.stage} goes out as Rev`}
                className={cn(field, 'px-1 text-center font-mono font-semibold')}
              />
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={Number.isFinite(s.weight) ? s.weight : ''}
                  onChange={(e) => onStage(s.stage, { weight: e.target.value === '' ? 0 : Number(e.target.value) })}
                  aria-label={`${s.label || s.stage} weight, percent`}
                  className={cn(field, 'w-full pr-6 text-right font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', weightsOff && 'border-bad')}
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground/50">%</span>
              </div>
            </div>
            {palette === s.stage && (
              <div className="animate-fade-in-up ml-[3.25rem] mt-2 flex flex-wrap gap-2 rounded-2xl bg-[#f8faff] p-2">
                {STAGE_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { onStage(s.stage, { color: c }); setPalette(null); }}
                    aria-label={`Colour ${c}`}
                    className={cn('size-8 rounded-full ring-offset-2', s.color.toLowerCase() === c ? 'ring-2 ring-foreground' : 'ring-1 ring-black/5')}
                    style={{ background: c }}
                  />
                ))}
              </div>
            )}
            {!s.label.trim() && <Reminder>{s.name.trim() ? `Give the ${s.name.trim()} stage a short name.` : 'Give this stage a short name.'}</Reminder>}
          </div>
        ))}
      </div>

      {/* The next row, not a box (variant A, 9 Oct 2026): a dashed dot where the colour goes, the words where the short name goes. */}
      <button type="button" onClick={onAdd} className={cn(cols, 'group mt-2.5 min-h-11 w-full rounded-xl text-left')}>
        <span className="flex size-10 items-center justify-center rounded-full border-[1.5px] border-dashed border-primary/45 text-primary transition-colors duration-200 ease-ios group-hover:border-primary group-hover:bg-primary-soft">
          <Plus className="h-4 w-4" />
        </span>
        <span className="col-span-3 text-[13px] font-semibold text-primary sm:col-span-4">Add a stage</span>
      </button>

      {weightsOff && <Reminder>The weights add up to {total}%. Make them 100%.</Reminder>}
    </section>
  );
}
