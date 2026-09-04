'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, ClipboardPaste, FileSpreadsheet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { readRegisterFile, seedRegister } from '@/lib/doc-actions';
import { parseRegisterPaste, type ColumnMapping } from '@/lib/register-paste';
import type { RegisterKind } from '@/lib/schema';

/**
 * Building a register, as three plain screens instead of one long page.
 *
 * The version this replaces put everything on one scroll — names, a big
 * textarea, a column mapper, a preview — and opened with no way back out. It
 * also wrote the moment a file was picked, so choosing the wrong workbook put
 * another project's register into this one with nothing shown first.
 *
 * So: pick HOW (a file, or a paste), then see WHAT it found, then press one
 * button that writes. Every screen can be left, and nothing is written until
 * the last press. A file and a paste meet at the same preview because they
 * become the same thing — rows of text — and there is one set of rules about
 * what a group is and what a document is.
 */
type Step = 'how' | 'fill';
type Method = 'file' | 'paste';

const EXAMPLE = `GENERAL
WPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan
WPP-GN-DRE-002\tWeekly Progress Report
PROCEDURE
WPP-GN-DGS-001\tProsedur Penomoran Dokumen`;

const FIELDS = [
  { key: 'docNo', label: 'Number' },
  { key: 'title', label: 'Title' },
  { key: 'kind', label: 'Type' },
] as const;

export function RegisterBuilder({
  projectId, register, clientName, contractorName, hasDocuments, onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  /** Changes the wording only: adding to a register reads differently from starting one. */
  hasDocuments: boolean;
  /** Absent when the register is empty — there is nothing behind this screen to go back to. */
  onClose?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>('how');
  const [method, setMethod] = useState<Method>('paste');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const [text, setText] = useState('');
  const [override, setOverride] = useState<Partial<ColumnMapping>>({});

  // The same parser the server writes with, so what is on screen is exactly
  // what will land — the preview is not a second implementation to keep in step.
  const plan = useMemo(() => parseRegisterPaste(text, override), [text, override]);
  const named = client.trim() !== '' && contractor.trim() !== '';
  const ready = plan.counts.documents > 0 && named;

  const label = register === 'edl' ? 'EDL' : 'VDRL';
  const longLabel = register === 'edl'
    ? 'Engineering Deliverable List'
    : 'Vendor Deliverable Register';

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set('file', file);
      form.set('register', register);
      const result = await readRegisterFile(form);
      if (!result.ok) { setError(result.error); return; }
      setText(result.text);
      setOverride({});
      setSource(`${file.name} · sheet "${result.sheet}"`);
      setMethod('file');
      setStep('fill');
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const create = () => {
    setError(null);
    start(async () => {
      const result = await seedRegister({
        projectId, register, text, mapping: override,
        clientName: client, contractorName: contractor,
      });
      if (!result.ok) { setError(result.error); return; }
      setText('');
      setSource(null);
      setStep('how');
      onClose?.();
    });
  };

  const errorBanner = error && (
    <p
      role="alert"
      className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"
    >
      {error}
    </p>
  );

  /* ------------------------------------------------------------ step one */

  if (step === 'how') {
    return (
      <div className="animate-fade-in-up mx-auto flex max-w-2xl flex-col gap-5 pb-16">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => chooseFile(e.target.files?.[0])}
        />

        {onClose && (
          <Button variant="ghost" className="h-11 w-fit px-2" onClick={onClose}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the register
          </Button>
        )}

        <header>
          <p className="text-xs font-semibold tracking-wide text-chart-1">{longLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {hasDocuments ? `Add to the ${label}` : `Build the ${label}`}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Two ways in, and both end at the same place: you see what was found before
            anything is saved.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => fileInput.current?.click()}
            className="flex min-h-40 flex-col items-start gap-2 rounded-xl border bg-card p-5 text-left transition-colors duration-300 ease-ios hover:bg-muted/60 disabled:opacity-60"
          >
            <FileSpreadsheet className="h-6 w-6 text-chart-1" />
            <span className="text-base font-semibold">
              {pending ? 'Reading the file…' : 'From an Excel file'}
            </span>
            <span className="text-sm text-muted-foreground">
              Pick the .xlsx you already have. We read the register sheet and show you
              what is in it.
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setMethod('paste'); setSource(null); setStep('fill'); }}
            className="flex min-h-40 flex-col items-start gap-2 rounded-xl border bg-card p-5 text-left transition-colors duration-300 ease-ios hover:bg-muted/60"
          >
            <ClipboardPaste className="h-6 w-6 text-chart-1" />
            <span className="text-base font-semibold">Paste a list</span>
            <span className="text-sm text-muted-foreground">
              Copy the rows out of a spreadsheet or a document, or type them yourself.
            </span>
          </button>
        </div>

        {errorBanner}
      </div>
    );
  }

  /* ------------------------------------------------------------ step two */

  return (
    <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 pb-20">
      <Button
        variant="ghost"
        className="h-11 w-fit px-2"
        onClick={() => { setStep('how'); setError(null); }}
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Choose a different way
      </Button>

      <header>
        <p className="text-xs font-semibold tracking-wide text-chart-1">{longLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {method === 'file' ? 'Check what the file holds' : 'Paste the list'}
        </h1>
        {source && <p className="mt-1.5 text-sm text-muted-foreground">{source}</p>}
      </header>

      {/* ---------------------------------------------------- the two sides */}
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Who are the two sides?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A register has two sides and they have names: one submits, the other responds.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="seed-contractor">Contractor</Label>
            <Input
              id="seed-contractor" className="h-11" value={contractor}
              onChange={(e) => setContractor(e.target.value)} placeholder="PT. INDOTURBINE"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="seed-client">Client</Label>
            <Input
              id="seed-client" className="h-11" value={client}
              onChange={(e) => setClient(e.target.value)} placeholder="PT PERTAMINA EP ZONA 11"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- the rows */}
      {method === 'paste' && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">The list</h2>
          {/* `max-h` is not decoration: the shared Textarea carries
              `field-sizing-content`, so a 200-line paste would grow the box to
              200 lines and push the preview and the button off a phone. */}
          <Textarea
            className="mt-3 max-h-72 min-h-48 overflow-auto font-mono text-xs leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            aria-label="Paste your document list"
            spellCheck={false}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            A line on its own is a group. A line with a number and a title is a document.
            A whole spreadsheet works too — the headings above the table are ignored.
          </p>
        </section>
      )}

      {/* ------------------------------------------ which column is which */}
      {plan.mapping.outline !== null && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Which column is which?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Guessed from the rows. Change any of them and the preview follows.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            {FIELDS.map((field) => (
              <div key={field.key} className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor={`col-${field.key}`}>{field.label}</Label>
                {/* Native select: one row of controls, and no Radix portal added
                    to a screen that already carries a long preview. */}
                <select
                  id={`col-${field.key}`}
                  className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  value={plan.mapping[field.key] ?? -1}
                  onChange={(e) => setOverride((o) => ({
                    ...o,
                    [field.key]: Number(e.target.value) < 0 ? null : Number(e.target.value),
                  }))}
                >
                  <option value={-1}>none</option>
                  {plan.columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {`${c.index + 1} · ${c.values[0]?.slice(0, 30) || 'empty'}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- preview */}
      {text.trim() !== '' && (
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <h2 className="text-lg font-semibold tabular-nums">
              {plan.counts.categories} group{plan.counts.categories === 1 ? '' : 's'}
              <span className="mx-2 text-muted-foreground">·</span>
              {plan.counts.documents} document{plan.counts.documents === 1 ? '' : 's'}
            </h2>
            {plan.counts.duplicateNumbers > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {plan.counts.duplicateNumbers} number
                {plan.counts.duplicateNumbers === 1 ? '' : 's'} used more than once
              </span>
            )}
            {plan.problems.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {plan.problems.length} row{plan.problems.length === 1 ? '' : 's'} skipped
              </span>
            )}
          </div>

          {hasDocuments && (
            <p className="mt-2 text-sm text-muted-foreground">
              Documents whose number is already in this register are updated, not added
              a second time.
            </p>
          )}

          <ul className="mt-4 flex max-h-96 flex-col overflow-y-auto">
            {plan.categories.map((category, i) => (
              <li
                key={`${category.name}-${i}`}
                className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0"
              >
                <span
                  className="min-w-0 truncate"
                  style={{ paddingLeft: `${(category.depth - 1) * 18}px` }}
                >
                  {category.depth === 1
                    ? <span className="font-semibold">{category.name}</span>
                    : category.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {category.documents.length}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {errorBanner}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!ready && text.trim() !== '' && (
          <span className="text-sm text-muted-foreground">
            {plan.counts.documents === 0
              ? 'No documents found in those rows yet.'
              : 'Both names are needed first.'}
          </span>
        )}
        <Button className="h-11 w-full sm:w-auto" disabled={!ready || pending} onClick={create}>
          {pending
            ? 'Saving…'
            : `Add ${plan.counts.documents} document${plan.counts.documents === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
