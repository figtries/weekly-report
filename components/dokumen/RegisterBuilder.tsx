'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, Check, ChevronRight, FileSpreadsheet, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { addFromDraft, readRegisterFile, seedRegister } from '@/lib/doc-actions';
import { parseRegisterPaste, type ColumnMapping } from '@/lib/register-paste';
import { templateFor, type TemplateBand } from '@/lib/register-template';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

/**
 * Building a register the way it is actually shaped: section by section.
 *
 * Two earlier attempts failed the same way. Both handed someone an empty text
 * box and asked them to express a THREE-LEVEL STRUCTURE in it — "a line on its
 * own is a group" — which is a format to learn before a register can be
 * started, and learning it is the whole difficulty. Moving 131 rows out of a
 * spreadsheet needs that box; creating five documents does not.
 *
 * So the structure is chosen by pressing it, not written. The sections come
 * ready-made from `lib/register-template.ts` — the union of the two real EDLs
 * in this repo — and a section is opened, filled with one title per line, and
 * closed. Nothing about grouping is ever typed. Sections nobody uses stay empty
 * and are never written; a project with its own discipline adds one.
 *
 * The Excel door stays open beside it, because a list that already exists
 * should never be retyped.
 */

interface Draft {
  /** Keyed by the group's full path, joined — `DETAIL ENGINEERING›ELECTRICAL›Electrical Datasheet`. */
  [path: string]: string;
}

type View =
  | { name: 'sections' }
  | { name: 'section'; band: string; section: string; groups: string[] }
  | { name: 'paste' };

const SEP = '›';

/** One line = one document. A number in front is optional and split off. */
function documentsFrom(text: string): { docNo: string | null; title: string }[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|\s*\|\s*|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return { docNo: parts[0], title: parts.slice(1).join(' ') };
      return { docNo: null, title: parts[0] ?? line };
    });
}

export function RegisterBuilder({
  projectId, register, clientName, contractorName, hasDocuments, existingSections = [], onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  hasDocuments: boolean;
  /**
   * Sections already in the register, so they appear beside the ready-made
   * ones. Optional, and defaulted: a half-swapped dev bundle once rendered this
   * component with the prop missing and the whole page died on a spread of
   * undefined. A builder with no existing sections is a correct thing to show;
   * a crash is not.
   */
  existingSections?: { band: string; section: string; groups: string[] }[];
  onClose?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [view, setView] = useState<View>({ name: 'sections' });
  const [error, setError] = useState<string | null>(null);

  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const [draft, setDraft] = useState<Draft>({});
  const [extraBands, setExtraBands] = useState<TemplateBand[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [pasteSource, setPasteSource] = useState<string | null>(null);
  const [override, setOverride] = useState<Partial<ColumnMapping>>({});

  /**
   * The ready-made shape, plus whatever this register already has, plus
   * anything added during this sitting. A section that exists in both appears
   * once — matched on name, because that is what the writer matches on too.
   */
  const bands = useMemo(() => {
    const merged: TemplateBand[] = templateFor(register).map((b) => ({
      name: b.name,
      sections: b.sections.map((s) => ({ ...s, groups: [...s.groups] })),
    }));

    const findBand = (name: string) => {
      let band = merged.find((b) => b.name.toLowerCase() === name.toLowerCase());
      if (!band) { band = { name, sections: [] }; merged.push(band); }
      return band;
    };

    for (const row of [...existingSections, ...extraBands.flatMap((b) =>
      b.sections.map((s) => ({ band: b.name, section: s.name, groups: s.groups })))]) {
      const band = findBand(row.band);
      let section = band.sections.find((s) => s.name.toLowerCase() === row.section.toLowerCase());
      if (!section) { section = { name: row.section, groups: [] }; band.sections.push(section); }
      for (const g of row.groups) {
        if (!section.groups.some((x) => x.toLowerCase() === g.toLowerCase())) section.groups.push(g);
      }
    }

    return merged;
  }, [register, existingSections, extraBands]);

  const countIn = (band: string, section: string) => Object.entries(draft)
    .filter(([path]) => path.startsWith(`${band}${SEP}${section}${SEP}`) || path === `${band}${SEP}${section}`)
    .reduce((n, [, text]) => n + documentsFrom(text).length, 0);

  const totals = useMemo(() => {
    let documents = 0;
    let groups = 0;
    for (const text of Object.values(draft)) {
      const n = documentsFrom(text).length;
      if (n > 0) { documents += n; groups += 1; }
    }
    return { documents, groups };
  }, [draft]);

  const named = client.trim() !== '' && contractor.trim() !== '';
  const label = register === 'edl' ? 'EDL' : 'VDRL';
  const longLabel = register === 'edl'
    ? 'Engineering Deliverable List'
    : 'Vendor Deliverable Register';

  /* ------------------------------------------------------------- writing */

  const saveDraft = () => {
    setError(null);
    start(async () => {
      const groups = Object.entries(draft)
        .map(([path, text]) => ({ path: path.split(SEP), documents: documentsFrom(text) }))
        .filter((g) => g.documents.length > 0);
      const result = await addFromDraft({
        projectId, register, groups, clientName: client, contractorName: contractor,
      });
      if (!result.ok) { setError(result.error); return; }
      setDraft({});
      onClose?.();
    });
  };

  const savePaste = () => {
    setError(null);
    start(async () => {
      const result = await seedRegister({
        projectId, register, text: pasteText, mapping: override,
        clientName: client, contractorName: contractor,
      });
      if (!result.ok) { setError(result.error); return; }
      setPasteText('');
      setPasteSource(null);
      onClose?.();
    });
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
      setOverride({});
      setPasteSource(`${file.name} · sheet "${result.sheet}"`);
      setView({ name: 'paste' });
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const errorBanner = error && (
    <p
      role="alert"
      className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"
    >
      {error}
    </p>
  );

  /** Asked once, while the register is still empty — after that the project knows. */
  const namesCard = !hasDocuments && (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Who are the two sides?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Asked once. One submits, the other responds.
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
  );

  const fileField = (
    <input
      ref={fileInput}
      type="file"
      accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      className="hidden"
      onChange={(e) => chooseFile(e.target.files?.[0])}
    />
  );

  /* --------------------------------------------------- one section, open */

  if (view.name === 'section') {
    const groups = view.groups.length > 0 ? view.groups : [view.section];
    const pathOf = (group: string) => (view.groups.length > 0
      ? `${view.band}${SEP}${view.section}${SEP}${group}`
      : `${view.band}${SEP}${view.section}`);

    return (
      <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 pb-24">
        {fileField}
        <Button variant="ghost" className="h-11 w-fit px-2" onClick={() => setView({ name: 'sections' })}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All sections
        </Button>

        <header>
          <p className="text-xs font-semibold tracking-wide text-chart-1">{view.band}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{view.section}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            One document per line. Put its number first if it has one — otherwise just the
            title.
          </p>
        </header>

        {groups.map((group) => {
          const path = pathOf(group);
          const value = draft[path] ?? '';
          const n = documentsFrom(value).length;
          return (
            <section key={group} className="rounded-xl border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{group}</h2>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {n} document{n === 1 ? '' : 's'}
                </span>
              </div>
              <Textarea
                className="mt-3 max-h-64 min-h-28 overflow-auto font-mono text-xs leading-relaxed"
                value={value}
                spellCheck={false}
                aria-label={`Documents in ${group}`}
                placeholder={'PRGG-20-E0-DS-001\tDatasheet for Transformer\nDatasheet for LV Busduct'}
                onChange={(e) => setDraft((d) => ({ ...d, [path]: e.target.value }))}
              />
            </section>
          );
        })}

        <AddNameCard
          label="Add another group here"
          placeholder="e.g. Electrical Single Line Diagram"
          onAdd={(name) => setExtraBands((bandsSoFar) => [
            ...bandsSoFar,
            { name: view.band, sections: [{ name: view.section, groups: [name] }] },
          ])}
        />

        {errorBanner}

        <div className="flex justify-end">
          <Button className="h-11" onClick={() => setView({ name: 'sections' })}>
            <Check className="mr-1.5 h-4 w-4" /> Done with this section
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------ a whole pasted sheet */

  if (view.name === 'paste') {
    const plan = parseRegisterPaste(pasteText, override);
    const ready = plan.counts.documents > 0 && named;

    return (
      <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 pb-24">
        {fileField}
        <Button
          variant="ghost" className="h-11 w-fit px-2"
          onClick={() => { setView({ name: 'sections' }); setError(null); }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All sections
        </Button>

        <header>
          <p className="text-xs font-semibold tracking-wide text-chart-1">{longLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {pasteSource ? 'Check what the file holds' : 'Paste a whole list'}
          </h1>
          {pasteSource && <p className="mt-1.5 text-sm text-muted-foreground">{pasteSource}</p>}
        </header>

        {namesCard}

        {!pasteSource && (
          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold">The list</h2>
            <Textarea
              className="mt-3 max-h-72 min-h-48 overflow-auto font-mono text-xs leading-relaxed"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
              aria-label="Paste your document list"
              placeholder={'GENERAL\nWPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan\nPROCEDURE\nWPP-GN-DGS-001\tProsedur Penomoran Dokumen'}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              Here a line on its own becomes a group. Filling sections one at a time is
              easier — this box is for a list that already exists somewhere else.
            </p>
          </section>
        )}

        {plan.mapping.outline !== null && (
          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="text-sm font-semibold">Which column is which?</h2>
            <div className="mt-4 flex flex-wrap gap-4">
              {([['docNo', 'Number'], ['title', 'Title'], ['kind', 'Type']] as const).map(([key, name]) => (
                <div key={key} className="flex min-w-40 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`col-${key}`}>{name}</Label>
                  <select
                    id={`col-${key}`}
                    className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    value={plan.mapping[key] ?? -1}
                    onChange={(e) => setOverride((o) => ({
                      ...o, [key]: Number(e.target.value) < 0 ? null : Number(e.target.value),
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

        {pasteText.trim() !== '' && (
          <section className="rounded-xl border bg-card p-4 sm:p-5">
            <h2 className="text-lg font-semibold tabular-nums">
              {plan.counts.categories} group{plan.counts.categories === 1 ? '' : 's'}
              <span className="mx-2 text-muted-foreground">·</span>
              {plan.counts.documents} document{plan.counts.documents === 1 ? '' : 's'}
            </h2>
            {hasDocuments && (
              <p className="mt-2 text-sm text-muted-foreground">
                Documents whose number is already here are updated, not added twice.
              </p>
            )}
            <ul className="mt-4 flex max-h-80 flex-col overflow-y-auto">
              {plan.categories.map((category, i) => (
                <li
                  key={`${category.name}-${i}`}
                  className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0"
                >
                  <span className="min-w-0 truncate" style={{ paddingLeft: `${(category.depth - 1) * 18}px` }}>
                    {category.depth === 1 ? <span className="font-semibold">{category.name}</span> : category.name}
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

        <div className="flex justify-end">
          <Button className="h-11" disabled={!ready || pending} onClick={savePaste}>
            {pending ? 'Saving…' : `Add ${plan.counts.documents} document${plan.counts.documents === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------ the section list */

  return (
    <div className="animate-fade-in-up mx-auto flex max-w-3xl flex-col gap-5 pb-24">
      {fileField}

      {onClose && (
        <Button variant="ghost" className="h-11 w-fit px-2" onClick={onClose}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the register
        </Button>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-chart-1">{longLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {hasDocuments ? `Add to the ${label}` : `Build the ${label}`}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Open a section and write what belongs in it, one document per line. Sections you
            do not use are simply left alone.
          </p>
        </div>
        <Button variant="outline" className="h-11" disabled={pending} onClick={() => fileInput.current?.click()}>
          <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          {pending ? 'Reading…' : 'From an Excel file'}
        </Button>
      </header>

      {namesCard}

      {bands.map((band) => (
        <section key={band.name} className="flex flex-col gap-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {band.name}
          </p>

          {band.sections.map((section) => {
            const n = countIn(band.name, section.name);
            return (
              <button
                key={section.name}
                type="button"
                onClick={() => setView({
                  name: 'section', band: band.name, section: section.name, groups: section.groups,
                })}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors duration-300 ease-ios hover:bg-muted/60',
                  n > 0 && 'border-foreground/20',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{section.name}</p>
                  {section.groups.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {section.groups.join(' · ')}
                    </p>
                  )}
                </div>
                <span className={cn(
                  'shrink-0 text-sm tabular-nums',
                  n > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
                >
                  {n > 0 ? `${n} document${n === 1 ? '' : 's'}` : 'empty'}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}

          <AddNameCard
            label={`Add a section to ${band.name}`}
            placeholder="e.g. HSE"
            onAdd={(name) => setExtraBands((soFar) => [
              ...soFar, { name: band.name, sections: [{ name, groups: [] }] },
            ])}
          />
        </section>
      ))}

      <button
        type="button"
        className="w-fit px-1 text-sm text-muted-foreground underline underline-offset-4"
        onClick={() => { setPasteSource(null); setView({ name: 'paste' }); }}
      >
        Or paste a whole list instead
      </button>

      {errorBanner}

      {/* Sticky so the count and the button stay in sight while sections are
          filled — on a phone the list is long and the total is the one thing
          worth never scrolling back for. */}
      <div className="sticky bottom-0 -mx-3 mt-2 flex flex-wrap items-center gap-3 border-t bg-background/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <span className="text-sm tabular-nums">
          <span className="font-semibold">{totals.documents}</span> document
          {totals.documents === 1 ? '' : 's'} in {totals.groups} group
          {totals.groups === 1 ? '' : 's'}
        </span>
        <Button
          className="ml-auto h-11"
          disabled={totals.documents === 0 || !named || pending}
          onClick={saveDraft}
        >
          {pending ? 'Saving…' : 'Save to the register'}
        </Button>
      </div>
    </div>
  );
}

/** One field and one button, used for both "add a section" and "add a group". */
function AddNameCard({
  label, placeholder, onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-fit items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-4 w-4" /> {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Input
        autoFocus
        className="h-11 w-full sm:w-72"
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false); }}
      />
      <Button className="h-11" onClick={commit} disabled={!name.trim()}>Add</Button>
      <Button variant="ghost" className="h-11" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
