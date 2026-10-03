'use client';

import dynamic from 'next/dynamic';
import { Suspense, useMemo, useRef, useState, useTransition } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowLeft, ClipboardPaste, Copy, FilePlus2, FileSpreadsheet } from 'lucide-react';

import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  countDocuments, fromOutline, fromPaste, headingSuggestions, newHeading, newSub, renumber, toDraftGroups,
  type BuilderHeading, type OutlineHeading,
} from '@/lib/builder-model';
import { MOTION } from '@/lib/design';
import { addFromDraft, readRegisterFile, saveNumbering } from '@/lib/doc-actions';
import { defaultRule, nextNumber, type NumberingRule } from '@/lib/register-numbering';
import { parseRegisterPaste } from '@/lib/register-paste';
import { REGISTER_INFO, type RegisterSource } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

import { BuilderHeadingCard } from './BuilderHeadingCard';

const NumberingDialog = dynamic(() => import('./NumberingDialog'));

/**
 * Building a register (3 Oct 2026, rebuilt with the user from rendered options).
 *
 * The builder before this asked for the numbering rule before anything else,
 * listed a template three levels deep of empty sections (Merbau showed PROCESS
 * twice), opened one section at a time, and hid "paste" in a link at the foot.
 * The user named all four as why making an EDL was "pusing, ribet, nggak rapi".
 *
 * Now: one question (where to start: another project, a paste, or nothing),
 * then one page. The page asks what headings this register has, suggested from
 * the template and free to extend, and each heading is a card with its
 * documents typed in place and optional sub-headings. Numbers are composed from
 * the project's initial straight away; "Change" corrects the rule. The state is
 * `lib/builder-model.ts`, which a script proves; this file only draws it.
 *
 * Motion is the app's: the page arrives on CSS (`.animate-enter`), and what a
 * press changes moves on framer-motion with `MOTION` (step swap, a heading card
 * opening on height + opacity, a new row rising 8px).
 */

type Step = 'start' | 'build';

export function RegisterBuilder({
  projectId, register, clientName, contractorName, hasDocuments,
  existing = [], numbering, sources = [], onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  hasDocuments: boolean;
  /** Headings the register already has, so additions land in them. */
  existing?: { name: string; documents: number; subheadings: string[] }[];
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

  const [step, setStep] = useState<Step>(hasDocuments ? 'build' : 'start');
  const [origin, setOrigin] = useState<string | null>(null);
  const [headings, setHeadings] = useState<BuilderHeading[]>(() => existing.map((e) => ({
    ...newHeading(e.name, true, e.documents),
    subs: e.subheadings.map((s) => newSub(s)),
  })));
  const [rule, setRule] = useState<NumberingRule>(
    numbering?.rule ?? defaultRule(numbering?.suggestedPrefix ?? ''),
  );
  const [ruleDirty, setRuleDirty] = useState(false);
  const [numberingOpen, setNumberingOpen] = useState(false);
  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const askNames = !clientName.trim() || !contractorName.trim();

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteFrom, setPasteFrom] = useState<string | null>(null);
  const [loadingSource, setLoadingSource] = useState<string | null>(null);
  const [ownHeading, setOwnHeading] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<BuilderHeading | null>(null);

  const numbered = useMemo(() => renumber(headings, rule, taken), [headings, rule, taken]);
  const documents = countDocuments(numbered);
  const newHeadings = headings.filter((h) => !h.locked).length;
  const suggestions = headingSuggestions(register);
  const chipNames = [
    ...suggestions,
    ...headings.map((h) => h.name).filter((n) => !suggestions.some((s) => s.toLowerCase() === n.toLowerCase())),
  ];
  const headingOf = (name: string) => headings.find((h) => h.name.toLowerCase() === name.toLowerCase());
  const pastePlan = useMemo(() => (pasteText.trim() ? parseRegisterPaste(pasteText) : null), [pasteText]);

  const sampleNumber = numbered.flatMap((h) => [...h.rows, ...h.subs.flatMap((s) => s.rows)])
    .find((r) => r.picked && r.docNo)?.docNo
    ?? nextNumber(rule, headings[0]?.name ?? (edl ? 'GENERAL' : 'PACKAGE'), 'Drawing', 'Dwg', taken);

  const swap = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: MOTION.duration, ease: MOTION.ease },
  };

  /* ----------------------------------------------------------- starting */

  const begin = (next: BuilderHeading[], from: string | null) => {
    setHeadings(next);
    setOrigin(from);
    setError(null);
    setStep('build');
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
        const outline = (await res.json()) as OutlineHeading[];
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

  /* ------------------------------------------------------------ headings */

  const toggleHeading = (name: string) => {
    const found = headingOf(name);
    if (!found) { setHeadings((hs) => [...hs, newHeading(name)]); return; }
    if (found.locked) return;
    const typed = found.rows.some((r) => r.title.trim()) || found.subs.some((s) => s.rows.some((r) => r.title.trim()));
    if (typed) { setConfirmRemove(found); return; }
    setHeadings((hs) => hs.filter((h) => h.id !== found.id));
  };

  const addOwnHeading = () => {
    const name = ownHeading.trim();
    if (!name) return;
    if (!headingOf(name)) setHeadings((hs) => [...hs, newHeading(name)]);
    setOwnHeading('');
  };

  /* -------------------------------------------------------------- saving */

  const save = () => {
    setError(null);
    // Said when Save is pressed, not before (memory: validate on action):
    // a button that is simply grey gave no reason, and the names card can be
    // far above where the person is working.
    if (!client.trim() || !contractor.trim()) {
      setError('Fill in the contractor and the client first.');
      document.getElementById(contractor.trim() ? 'builder-client' : 'builder-contractor')?.focus();
      return;
    }
    start(async () => {
      if (ruleDirty || !numbering?.rule) {
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

  const canSave = !pending && (documents > 0 || newHeadings > 0) && rule.prefix.trim() !== '';

  /* -------------------------------------------------------------- render */

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-28">
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />

      {(onClose || (step === 'build' && !hasDocuments)) && (
        <div className="flex flex-wrap items-center gap-x-4">
          {onClose && (
            <Button variant="ghost" className="h-11 w-fit px-2" onClick={onClose}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the register
            </Button>
          )}
          {step === 'build' && !hasDocuments && (
            <Button variant="ghost" className="h-11 w-fit px-2 text-muted-foreground" onClick={() => { setHeadings([]); setOrigin(null); setError(null); setPasteOpen(false); setStep('start'); }}>
              Start again
            </Button>
          )}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {step === 'start' ? (
          <m.div key="start" {...swap} className="flex flex-col gap-5">
            <header className="animate-enter">
              <p className="text-xs font-semibold tracking-wide text-chart-1">{info.long}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Build the {info.short}</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Start from something you already have. Everything can be changed before it is saved.
              </p>
            </header>

            <div className="grid gap-3 sm:grid-cols-3">
              <StartCard
                icon={<Copy className="h-4 w-4" />}
                title="Copy from another project"
                text="Use another project's list as the starting point and tick what applies here."
                className="stagger-1"
              >
                {sources.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">No other project has an {info.short} yet.</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {sources.map((s) => (
                      <button
                        key={s.projectId}
                        type="button"
                        disabled={loadingSource !== null}
                        onClick={() => copyFrom(s)}
                        className="rounded-lg border bg-muted/40 px-3 py-2.5 text-left transition-colors duration-200 ease-ios hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
                      >
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{s.name}</span>
                        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                          {loadingSource === s.projectId
                            ? 'Reading…'
                            : `${s.documents} documents · ${s.headings} heading${s.headings === 1 ? '' : 's'}`}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </StartCard>
              <StartCard
                icon={<ClipboardPaste className="h-4 w-4" />}
                title="Paste from Excel"
                text="Copy the rows from your sheet (number, title) and paste them in one go."
                onPress={() => setPasteOpen(true)}
                active={pasteOpen}
                className="stagger-2"
              />
              <StartCard
                icon={<FilePlus2 className="h-4 w-4" />}
                title="Start empty"
                text={edl ? 'Pick the headings, then type the titles.' : 'Name the vendor packages, then type the titles.'}
                onPress={() => begin([], null)}
                className="stagger-3"
              />
            </div>

            <AnimatePresence initial={false}>
              {pasteOpen && (
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
                          ? `${pastePlan.counts.documents} documents under ${pastePlan.categories.filter((c) => c.depth === 1).length} headings`
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

            {error && <ErrorLine text={error} />}
          </m.div>
        ) : (
          <m.div key="build" {...swap} className="flex flex-col gap-5">
            <header className="animate-enter">
              <p className="text-xs font-semibold tracking-wide text-chart-1">
                {info.long}{origin && ` · Copying from ${origin}`}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {hasDocuments ? `Add to the ${info.short}` : `Build the ${info.short}`}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Tick what this project has, then write the documents under each heading.
              </p>
            </header>

            {askNames && (
              <section className="animate-enter stagger-2 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
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

            <section className="animate-enter stagger-1 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
              <h2 className="text-[15px] font-semibold">{edl ? 'What goes in this EDL?' : 'Which vendor packages?'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {edl ? 'Common EPC headings. Tick the ones this project has, or add your own.' : 'One heading per package.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {chipNames.map((name) => {
                  const h = headingOf(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={Boolean(h)}
                      disabled={h?.locked}
                      onClick={() => toggleHeading(name)}
                      className={cn(
                        'inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium transition-colors duration-200 ease-ios',
                        h
                          ? 'border-primary bg-primary/5 font-semibold text-primary'
                          : 'bg-card text-foreground/85 hover:border-primary/50',
                        h?.locked && 'cursor-default opacity-80',
                      )}
                    >
                      {h?.name ?? name}
                    </button>
                  );
                })}
                <input
                  value={ownHeading}
                  onChange={(e) => setOwnHeading(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwnHeading(); } }}
                  onBlur={addOwnHeading}
                  placeholder={edl ? '+ Your own heading, e.g. COMMISSIONING' : '+ Package name'}
                  aria-label={edl ? 'Add your own heading' : 'Add a vendor package'}
                  className="min-h-10 w-64 max-w-full rounded-lg border border-dashed bg-transparent px-3 text-base outline-none transition-colors duration-200 ease-ios placeholder:text-muted-foreground focus-visible:border-ring md:text-sm"
                />
              </div>
            </section>

            <div className="animate-enter stagger-2 -my-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>Numbers:</span>
              <span className="font-mono text-foreground">{sampleNumber}</span>
              <span className="hidden sm:inline">· Project initial, heading, type, sequence</span>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => setNumberingOpen(true)}
                className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
              >
                Change
              </button>
            </div>

            <div className="flex flex-col">
              <AnimatePresence initial={false}>
                {numbered.map((h) => (
                  <m.div
                    key={h.id}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: MOTION.duration, ease: MOTION.ease }}
                    style={{ overflow: 'hidden', contain: 'layout paint' }}
                  >
                    <div className="pb-3">
                      <BuilderHeadingCard
                        heading={h}
                        register={register}
                        onChange={(next) => setHeadings((hs) => hs.map((x) => (x.id === h.id ? next : x)))}
                        onRemove={() => toggleHeading(h.name)}
                      />
                    </div>
                  </m.div>
                ))}
              </AnimatePresence>
              {numbered.length === 0 && (
                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  {edl ? 'Tick a heading above to start.' : 'Name a package above to start.'}
                </p>
              )}
            </div>

            {error && <ErrorLine text={error} />}

            <div className="sticky bottom-0 -mx-3 flex items-center gap-3 border-t bg-background/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-card sm:px-4 sm:shadow-md">
              <span className="text-sm tabular-nums" data-builder-count>
                <span className="font-semibold"><AnimatedNumber value={documents} decimals={0} /></span>
                {` document${documents === 1 ? '' : 's'}`}
                <span className="hidden sm:inline">{` under ${headings.length} heading${headings.length === 1 ? '' : 's'}`}</span>
              </span>
              <Button className="ml-auto h-11" disabled={!canSave} onClick={save}>
                {pending ? 'Saving…' : 'Save to the register'}
              </Button>
            </div>
          </m.div>
        )}
      </AnimatePresence>

      {/* Its own boundary: a lazy dialog suspends on its first render, and
          without one the suspension reached the page's (see ExportExcelButton). */}
      {numberingOpen && (
        <Suspense fallback={null}>
          <NumberingDialog
            open={numberingOpen}
            onOpenChange={setNumberingOpen}
            rule={rule}
            headings={headings.map((h) => h.name)}
            onChange={(next) => { setRule(next); setRuleDirty(true); }}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={confirmRemove !== null}
        title={`Remove ${confirmRemove?.name ?? ''}?`}
        message="The documents typed under it go with it. Nothing has been saved yet."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (target) setHeadings((hs) => hs.filter((h) => h.id !== target.id));
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

function StartCard({
  icon, title, text, onPress, active, className, children,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onPress?: () => void;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        {title}
      </span>
      <span className="mt-2 block text-sm leading-snug text-muted-foreground">{text}</span>
    </>
  );
  const shell = cn(
    'animate-enter flex flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow] duration-200 ease-ios sm:p-5',
    active && 'border-primary ring-3 ring-primary/15',
    className,
  );
  return onPress ? (
    <button type="button" onClick={onPress} className={cn(shell, 'hover:border-primary/50 hover:shadow-md')}>
      {body}
    </button>
  ) : (
    <div className={shell}>{body}{children}</div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      {text}
    </p>
  );
}
