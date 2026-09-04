'use client';

import { useMemo, useState, useTransition } from 'react';
import { ClipboardPaste, Users } from 'lucide-react';

import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { seedRegister } from '@/lib/doc-actions';
import { parseRegisterPaste, type ColumnMapping } from '@/lib/register-paste';
import type { RegisterKind } from '@/lib/schema';

/**
 * Where a register starts existing.
 *
 * What this replaces printed `node scripts/import-edl.ts` and offered nothing
 * else, which meant the whole module only worked for one project: the one whose
 * workbook somebody had already imported.
 *
 * It takes a list as it actually is — pasted out of a spreadsheet, seventy-five
 * columns wide with four heading rows on top, or typed by hand in two columns.
 * What it deliberately is NOT is a spreadsheet: there is no grid of editable
 * cells, and the preview is shaped like the place the work will happen, a list
 * of groups each with its count.
 */
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

export function RegisterSeed({
  projectId, register, clientName, contractorName,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const [text, setText] = useState('');
  const [override, setOverride] = useState<Partial<ColumnMapping>>({});

  // The same parser the server writes with, so what someone sees is exactly
  // what lands — the preview is not a second implementation to keep in step.
  const plan = useMemo(() => parseRegisterPaste(text, override), [text, override]);
  const wide = plan.mapping.outline !== null;
  const ready = plan.counts.documents > 0 && client.trim() !== '' && contractor.trim() !== '';
  const label = register === 'edl' ? 'Engineering Deliverable List' : 'Vendor Deliverable Register';

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await seedRegister({
        projectId, register, text, mapping: override,
        clientName: client, contractorName: contractor,
      });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 pb-20">
      <PageHeader section="Document Control" title={`Build the ${label}`}>
        Paste the list you already have — from a spreadsheet, from a document, or typed
        by hand. Nothing is written until you press the button at the bottom.
      </PageHeader>

      {/* ------------------------------------------------------- both sides */}
      <section className="animate-enter rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-chart-1" />
          <h2 className="text-sm font-semibold">Who are the two sides?</h2>
        </div>
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
              onChange={(e) => setClient(e.target.value)} placeholder="PETROGAS (BASIN) LTD."
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- the list */}
      <section className="animate-enter stagger-1 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <ClipboardPaste className="h-4 w-4 text-chart-1" />
          <h2 className="text-sm font-semibold">The list</h2>
        </div>
        {/* `max-h` is not decoration. The shared Textarea carries
            `field-sizing-content`, so a 208-line paste grows the box to 208
            lines and pushes the preview and the button off the bottom of a
            phone — the two things a person needs to see after pasting. Capped,
            it scrolls inside itself instead. */}
        <Textarea
          className="mt-3 max-h-72 min-h-56 overflow-auto font-mono text-xs leading-relaxed sm:min-h-64"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          aria-label="Paste your document list"
          spellCheck={false}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          A line on its own is a group. A line with a number and a title is a document.
          Pasting a whole spreadsheet works too — the headings above the table are ignored.
        </p>
      </section>

      {/* --------------------------------------------- which column is which */}
      {wide && (
        <section className="animate-fade-in-up rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Which column is which?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Guessed from the paste. Change any of them and the preview follows.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            {FIELDS.map((field) => (
              <div key={field.key} className="flex min-w-40 flex-1 flex-col gap-1.5">
                <Label htmlFor={`col-${field.key}`}>{field.label}</Label>
                {/* Native select on purpose: one row of controls, and no Radix
                    portal added to a screen that already carries a big textarea. */}
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

      {/* ------------------------------------------------------------ preview */}
      {text.trim() !== '' && (
        <section className="animate-fade-in-up rounded-xl border bg-card p-4 sm:p-5">
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
                {' · line '}
                {plan.problems.slice(0, 4).map((p) => p.line).join(', ')}
              </span>
            )}
          </div>

          <ul className="mt-4 flex flex-col">
            {plan.categories.map((category, i) => (
              <li
                key={`${category.name}-${i}`}
                className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0"
              >
                <span
                  className="min-w-0 truncate"
                  style={{ paddingLeft: `${(category.depth - 1) * 18}px` }}
                >
                  {category.depth === 1 ? (
                    <span className="font-semibold">{category.name}</span>
                  ) : category.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {category.documents.length}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!ready && text.trim() !== '' && (
          <span className="text-sm text-muted-foreground">
            {plan.counts.documents === 0
              ? 'No documents found in that list yet.'
              : 'Both names are needed first.'}
          </span>
        )}
        <Button className="h-11 w-full sm:w-auto" disabled={!ready || pending} onClick={submit}>
          {pending ? 'Creating…' : 'Create this register'}
        </Button>
      </div>
    </div>
  );
}
