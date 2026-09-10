'use client';

import { useMemo, useRef, useState, useTransition, ViewTransition } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, ChevronRight, FileSpreadsheet, Plus, X } from 'lucide-react';

import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/button';
import { DURATION, EASE } from '@/components/motion/Reveal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NativeSelect from '@/components/ui/NativeSelect';
import { Textarea } from '@/components/ui/textarea';
import { addFromDraft, readRegisterFile, saveNumbering, seedRegister } from '@/lib/doc-actions';
import { parseRegisterPaste, type ColumnMapping } from '@/lib/register-paste';
import {
  defaultRule, disciplineFor, nextNumber, type NumberingRule,
} from '@/lib/register-numbering';
import { outlineCode } from '@/lib/register-outline';
import { REGISTER_INFO } from '@/lib/register-shared';
import { templateFor, type TemplateBand } from '@/lib/register-template';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

/**
 * Building a register that follows the project's own numbering, without anyone
 * having to know it.
 *
 * Three attempts came before this one and all three failed the same way: they
 * offered a text box. A text box accepts anything — a wrong number, no number,
 * two people inventing two conventions — and a register whose numbers are
 * arbitrary is not a register. Both real EDLs here prove there is a rule:
 * `PROJECT-DISCIPLINE-TYPE-SEQUENCE`, with the type code's first letter saying
 * whether the thing is a document or a drawing.
 *
 * So the structure is pressed rather than written, and the number is composed
 * rather than typed. Pick the section, pick Doc or Dwg, type the title — the
 * number is already there, continuing the sequence in that group. It stays
 * editable, because a register inherited mid-project always carries a few that
 * predate the rule.
 */

interface Row {
  id: string;
  docNo: string;
  title: string;
  kind: 'Doc' | 'Dwg';
  /** False once someone edits the number by hand: it stops being recomputed. */
  auto: boolean;
}

type Draft = Record<string, Row[]>;

type View =
  | { name: 'numbering' }
  | { name: 'sections' }
  | { name: 'section'; band: string; section: string; groups: string[] }
  | { name: 'paste' };

const SEP = '›';
const newId = () => Math.random().toString(36).slice(2);

export function RegisterBuilder({
  projectId, register, clientName, contractorName, hasDocuments,
  existingSections = [], numbering, onClose,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
  hasDocuments: boolean;
  existingSections?: { band: string; section: string; groups: string[] }[];
  /** The rule, the numbers already spoken for, and a guess for a register with none. */
  numbering?: { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string };
  onClose?: () => void;
}) {
  const reduced = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const savedRule = numbering?.rule ?? null;
  const taken = numbering?.taken ?? [];

  const [rule, setRule] = useState<NumberingRule>(
    savedRule ?? defaultRule(numbering?.suggestedPrefix ?? ''),
  );
  const [view, setView] = useState<View>(savedRule ? { name: 'sections' } : { name: 'numbering' });

  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const [draft, setDraft] = useState<Draft>({});
  const [extraBands, setExtraBands] = useState<TemplateBand[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [pasteSource, setPasteSource] = useState<string | null>(null);
  const [override, setOverride] = useState<Partial<ColumnMapping>>({});

  /** The ready-made shape, plus what this register already has, plus additions. */
  const bands = useMemo(() => {
    // Its own type, not an intersection with TemplateBand: intersecting the
    // two leaves `sections.find()` resolving to the template's element type,
    // which has no `cleared` on it.
    interface WorkingSection { name: string; groups: string[]; cleared?: boolean }
    interface Working { name: string; sections: WorkingSection[] }
    const merged: Working[] = templateFor(register).map((b) => ({
      name: b.name,
      sections: b.sections.map((s) => ({ ...s, groups: [...s.groups] })),
    }));

    const findBand = (name: string): Working => {
      let band = merged.find((b) => b.name.toLowerCase() === name.toLowerCase());
      if (!band) { band = { name, sections: [] }; merged.push(band); }
      return band;
    };

    // Every added heading is registered FIRST, sections or not. Reaching them
    // only through their sections meant a heading created on its own produced
    // no row at all, so it never entered the shape and never appeared — while
    // the count at the bottom cheerfully said "1 new heading".
    for (const band of extraBands) findBand(band.name);

    const rows = [
      ...existingSections,
      ...extraBands.flatMap((b) => b.sections.map((s) => ({
        band: b.name, section: s.name, groups: s.groups,
      }))),
    ];

    // A section the register already fills keeps ITS OWN groups and drops the
    // ready-made ones. Merging both listed "General Procedure" beside "General
    // Prosedur" — the same group twice, in two spellings — and the suggestion
    // is worth nothing next to what the project actually calls things.
    const filled = new Set(
      existingSections.filter((r) => r.groups.length > 0)
        .map((r) => `${r.band.toLowerCase()}|${r.section.toLowerCase()}`),
    );

    for (const row of rows) {
      const band = findBand(row.band);
      let section = band.sections.find((s) => s.name.toLowerCase() === row.section.toLowerCase());
      if (!section) { section = { name: row.section, groups: [] }; band.sections.push(section); }
      // No cleverness about which of the two spellings is better: a section
      // the register already fills starts from empty and takes only its own.
      if (filled.has(`${row.band.toLowerCase()}|${row.section.toLowerCase()}`)
        && !section.cleared) {
        section.groups = [];
        section.cleared = true;
      }
      for (const g of row.groups) {
        if (!section.groups.some((x) => x.toLowerCase() === g.toLowerCase())) section.groups.push(g);
      }
    }

    return merged;
  }, [register, existingSections, extraBands]);

  /**
   * Headings, sections and groups added in this sitting, as paths.
   *
   * They are saved even with nothing inside them. A register is built structure
   * first — someone lays out the shape, then fills it, often on another day —
   * and until this existed "Add a heading" wrote nothing at all: the name lived
   * on the screen until the page was left.
   */
  const structurePaths = useMemo(() => {
    const out: string[][] = [];
    for (const band of extraBands) {
      if (band.sections.length === 0) { out.push([band.name]); continue; }
      for (const section of band.sections) {
        if (section.groups.length === 0) { out.push([band.name, section.name]); continue; }
        for (const group of section.groups) out.push([band.name, section.name, group]);
      }
    }
    return out;
  }, [extraBands]);

  const totals = useMemo(() => {
    let documents = 0;
    let groups = 0;
    for (const rows of Object.values(draft)) {
      const filled = rows.filter((r) => r.title.trim() !== '');
      if (filled.length > 0) { documents += filled.length; groups += 1; }
    }
    return { documents, groups };
  }, [draft]);

  const countIn = (band: string, section: string) => Object.entries(draft)
    .filter(([path]) => path === `${band}${SEP}${section}`
      || path.startsWith(`${band}${SEP}${section}${SEP}`))
    .reduce((n, [, rows]) => n + rows.filter((r) => r.title.trim() !== '').length, 0);

  const named = client.trim() !== '' && contractor.trim() !== '';
  // One source for what these two acronyms mean, shared with the tab header
  // that offers the choice between them. See REGISTER_INFO.
  const info = REGISTER_INFO[register];
  const label = info.short;
  const longLabel = info.long;

  /* --------------------------------------------------------- numbering */

/**
   * Numbers spoken for OUTSIDE one group: the register's own, plus every other
   * group drafted in this sitting.
   *
   * The group being renumbered is deliberately excluded. Counting its own rows
   * as taken makes every keystroke look like a collision, and the sequence
   * climbed by one per letter typed — a title of twenty-five characters landed
   * on 081.
   */
  const takenOutside = (path: string) => [
    ...taken,
    ...Object.entries(draft)
      .filter(([p]) => p !== path)
      .flatMap(([, rows]) => rows.map((r) => r.docNo))
      .filter(Boolean),
  ];

  const saveRule = () => {
    setError(null);
    start(async () => {
      const result = await saveNumbering({
        projectId, register, prefix: rule.prefix,
        disciplines: rule.disciplines, types: rule.types,
      });
      if (!result.ok) { setError(result.error); return; }
      setView({ name: 'sections' });
    });
  };

  /* ------------------------------------------------------------ writing */

  const saveDraft = () => {
    setError(null);
    start(async () => {
      const filledGroups = Object.entries(draft)
        .map(([path, rows]) => ({
          path: path.split(SEP),
          documents: rows
            .filter((r) => r.title.trim() !== '')
            .map((r) => ({ docNo: r.docNo.trim() || null, title: r.title.trim() })),
        }))
        .filter((g) => g.documents.length > 0);

      // Structure first, so a heading exists before the group beneath it, then
      // the groups that carry documents. A path already carrying documents is
      // not sent twice.
      const written = new Set(filledGroups.map((g) => g.path.join(SEP)));
      const groups = [
        ...structurePaths
          .filter((path) => !written.has(path.join(SEP)))
          .map((path) => ({ path, documents: [] })),
        ...filledGroups,
      ];

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

  const namesCard = !hasDocuments && (
    <section className="animate-enter rounded-xl border bg-card p-4 sm:p-5">
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

  /* ------------------------------------------------- step: the numbering */

  if (view.name === 'numbering') {
    const sample = (section: string, group: string, kind: 'Doc' | 'Dwg') =>
      nextNumber(rule, section, group, kind, []);
    const sections = bands.flatMap((b) => b.sections.map((s) => ({ band: b.name, section: s.name })));

    return (
      <ViewTransition key="numbering" enter="page-enter" exit="page-exit" default="none">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-24">
        {onClose && (
          <Button variant="ghost" className="h-11 w-fit px-2" onClick={onClose}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to the register
          </Button>
        )}

        <header>
          <p className="text-xs font-semibold tracking-wide text-chart-1">{longLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            How this project numbers its documents
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Set once, so nobody has to invent a number again. It can be changed later, and
            any single number can be overwritten where a document came with its own.
          </p>
        </header>

        <section className="animate-enter rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prefix">Project code</Label>
            <Input
              id="prefix"
              className="h-11 w-full font-mono uppercase sm:w-48"
              value={rule.prefix}
              placeholder="WPP"
              onChange={(e) => setRule((r) => ({ ...r, prefix: e.target.value.toUpperCase() }))}
            />
            <p className="text-sm text-muted-foreground">
              The short code on your drawings. Petrogas uses <code>WPP</code>, Gundih{' '}
              <code>PRGG</code>.
            </p>
          </div>

          <div className="mt-5 rounded-lg bg-muted/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              What numbers will look like
            </p>
            <ul className="mt-3 flex flex-col gap-1.5 font-mono text-sm">
              <li>
                {sample('ELECTRICAL', 'Electrical Datasheet', 'Doc')}
                <span className="ml-3 font-sans text-xs text-muted-foreground">
                  Electrical Datasheet · Doc
                </span>
              </li>
              <li>
                {sample('ELECTRICAL', 'Electrical Drawing', 'Dwg')}
                <span className="ml-3 font-sans text-xs text-muted-foreground">
                  Electrical Drawing · Dwg
                </span>
              </li>
              <li>
                {sample('CIVIL', 'Civil Calculation', 'Doc')}
                <span className="ml-3 font-sans text-xs text-muted-foreground">
                  Civil Calculation · Doc
                </span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Project · discipline · type · sequence. The type starts with <b>D</b> for a
              document and <b>G</b> for a drawing, which is why the kind is chosen and not
              typed.
            </p>
          </div>
        </section>

        <details className="animate-enter stagger-1 rounded-xl border bg-card p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold">
            Adjust the discipline codes
          </summary>
          <p className="mt-1 text-sm text-muted-foreground">
            Filled in from what both real registers use. Change any that differ on your
            project.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {sections.map(({ band, section }) => (
              <div key={`${band}-${section}`} className="flex items-center gap-3">
                <Input
                  className="h-11 w-24 font-mono uppercase"
                  value={rule.disciplines[section] ?? disciplineFor(section, rule)}
                  onChange={(e) => setRule((r) => ({
                    ...r,
                    disciplines: { ...r.disciplines, [section]: e.target.value.toUpperCase() },
                  }))}
                  aria-label={`Discipline code for ${section}`}
                />
                <span className="min-w-0 truncate text-sm">{section}</span>
              </div>
            ))}
          </div>
        </details>

        {errorBanner}

        <div className="flex justify-end">
          <Button className="h-11" disabled={!rule.prefix.trim() || pending} onClick={saveRule}>
            {pending ? 'Saving…' : 'Use this numbering'}
          </Button>
        </div>
      </div>
      </ViewTransition>
    );
  }

  /* --------------------------------------------------- step: one section */

  if (view.name === 'section') {
    const groups = view.groups.length > 0 ? view.groups : [view.section];
    // Where this section sits in the shape, so its code reads the same here as
    // it will in the export and in any spreadsheet made from it.
    const bandIndex = bands.findIndex((b) => b.name === view.band);
    const sectionIndex = bands[bandIndex]?.sections.findIndex((x) => x.name === view.section) ?? -1;
    const sectionCode = bandIndex >= 0 && sectionIndex >= 0
      ? outlineCode([bandIndex + 1, sectionIndex + 1])
      : '';
    const pathOf = (group: string) => (view.groups.length > 0
      ? `${view.band}${SEP}${view.section}${SEP}${group}`
      : `${view.band}${SEP}${view.section}`);

    /** Rebuild every auto number in a group, in order, after any change. */
    const renumber = (rows: Row[], group: string): Row[] => {
      const outside = takenOutside(pathOf(group));
      const used: string[] = [];
      return rows.map((row) => {
        if (!row.auto) { used.push(row.docNo); return row; }
        const docNo = nextNumber(rule, view.section, group, row.kind, [...outside, ...used]);
        used.push(docNo);
        return { ...row, docNo };
      });
    };

    const setRows = (group: string, next: Row[]) => {
      setDraft((d) => ({ ...d, [pathOf(group)]: renumber(next, group) }));
    };

    const rowsOf = (group: string) => draft[pathOf(group)] ?? [];

    const blankRow = (group: string, rows: Row[]): Row => ({
      id: newId(),
      docNo: nextNumber(rule, view.section, group, 'Doc', [
        ...takenOutside(pathOf(group)),
        ...rows.map((r) => r.docNo),
      ]),
      title: '',
      kind: 'Doc',
      auto: true,
    });

    return (
      <ViewTransition key="section" enter="page-enter" exit="page-exit" default="none">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 pb-28">
        {fileField}
        <Button variant="ghost" className="h-11 w-fit px-2" onClick={() => setView({ name: 'sections' })}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All sections
        </Button>

        <header>
          <p className="text-xs font-semibold tracking-wide text-chart-1">
            {outlineCode([bandIndex + 1])} · {view.band}
          </p>
          <h1 className="mt-1 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tracking-tight">
            {sectionCode && <span className="font-mono text-base text-muted-foreground">{sectionCode}</span>}
            {view.section}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Type the title. The number is written for you and can be changed. Press Enter for
            the next one, or paste a whole list of titles into a title box and each line
            becomes its own document.
          </p>
        </header>

        {groups.map((group, groupIndex) => {
          const rows = rowsOf(group);
          const filled = rows.filter((r) => r.title.trim() !== '').length;

          return (
            <section
              key={group}
              className={cn(
                'animate-enter rounded-xl border bg-card p-4 sm:p-5',
                groupIndex < 8 && `stagger-${Math.min(groupIndex + 1, 8)}`,
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                  {sectionCode && view.groups.length > 0 && (
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {`${sectionCode}.${groupIndex + 1}`}
                    </span>
                  )}
                  {group}
                </h2>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {filled} document{filled === 1 ? '' : 's'}
                </span>
              </div>

              {rows.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {/* Column names once, above the rows — on a phone each row
                      stacks and the inputs carry their own labels instead. */}
                  <div className="hidden gap-2 px-1 text-xs uppercase tracking-widest text-muted-foreground sm:grid sm:grid-cols-[13rem_1fr_6.5rem_2.75rem]">
                    <span>Number</span>
                    <span>Title</span>
                    <span>Kind</span>
                    <span />
                  </div>

                  <AnimatePresence initial={false}>
                  {rows.map((row, index) => (
                    // One row, two shapes. On a phone it is a card — number and
                    // kind on one line, title beneath — because four full-width
                    // fields in a column give no clue where one document ends
                    // and the next begins. On a wide screen the same elements
                    // sit in the four columns named above.
                    <m.div
                      key={row.id}
                      // A row is something the user just added or removed, so it
                      // gets the interaction duration, not an arrival's.
                      initial={reduced ? false : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: DURATION, ease: EASE }}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-2 overflow-hidden rounded-lg border bg-background p-2 sm:grid-cols-[13rem_1fr_6.5rem_2.75rem] sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                    >
                      <Input
                        className="h-11 font-mono text-xs sm:col-start-1 sm:row-start-1"
                        value={row.docNo}
                        aria-label="Document number"
                        onChange={(e) => setRows(group, rows.map((r) => (r.id === row.id
                          ? { ...r, docNo: e.target.value, auto: false } : r)))}
                      />
                      <Input
                        className="col-span-3 h-11 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                        value={row.title}
                        placeholder="Datasheet for Transformer"
                        aria-label="Document title"
                        autoFocus={index === rows.length - 1 && row.title === ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          // A pasted block of titles becomes one row per line —
                          // the fast path for someone handed a list.
                          if (value.includes('\n')) {
                            const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                            const made: Row[] = lines.map((title) => ({
                              id: newId(), docNo: '', title, kind: row.kind, auto: true,
                            }));
                            setRows(group, [
                              ...rows.filter((r) => r.id !== row.id),
                              ...made,
                            ]);
                            return;
                          }
                          setRows(group, rows.map((r) => (r.id === row.id ? { ...r, title: value } : r)));
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || row.title.trim() === '') return;
                          e.preventDefault();
                          if (index === rows.length - 1) setRows(group, [...rows, blankRow(group, rows)]);
                        }}
                      />
                      <NativeSelect
                        wrapperClassName="sm:col-start-3 sm:row-start-1"
                        value={row.kind}
                        aria-label="Document or drawing"
                        onChange={(e) => setRows(group, rows.map((r) => (r.id === row.id
                          ? { ...r, kind: e.target.value as 'Doc' | 'Dwg' } : r)))}
                      >
                        <option value="Doc">Doc</option>
                        <option value="Dwg">Dwg</option>
                      </NativeSelect>
                      <Button
                        variant="ghost" size="icon" className="h-11 w-11 sm:col-start-4 sm:row-start-1"
                        aria-label="Remove this row"
                        onClick={() => setRows(group, rows.filter((r) => r.id !== row.id))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </m.div>
                  ))}
                  </AnimatePresence>
                </div>
              )}

              <Button
                variant="outline"
                className="mt-3 h-11"
                onClick={() => setRows(group, [...rows, blankRow(group, rows)])}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                {rows.length === 0 ? 'Add the first document' : 'Add another'}
              </Button>
            </section>
          );
        })}

        <AddNameCard
          label="Add another group here"
          placeholder="e.g. Electrical Single Line Diagram"
          onAdd={(name) => setExtraBands((soFar) => [
            ...soFar, { name: view.band, sections: [{ name: view.section, groups: [name] }] },
          ])}
        />

        {errorBanner}

        <div className="flex justify-end">
          <Button className="h-11" onClick={() => setView({ name: 'sections' })}>
            <Check className="mr-1.5 h-4 w-4" /> Done with this section
          </Button>
        </div>
      </div>
      </ViewTransition>
    );
  }

  /* --------------------------------------------- step: a whole pasted sheet */

  if (view.name === 'paste') {
    const plan = parseRegisterPaste(pasteText, override);
    const ready = plan.counts.documents > 0 && named;

    return (
      <ViewTransition key="paste" enter="page-enter" exit="page-exit" default="none">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-24">
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
              className="mt-3 max-h-72 min-h-40 overflow-auto font-mono text-xs leading-relaxed"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
              aria-label="Paste your document list"
              placeholder={'GENERAL\nWPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan'}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              For a list that already exists somewhere else, with its own numbers. Building
              section by section is easier for anything new.
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
                  <NativeSelect
                    id={`col-${key}`}
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
                  </NativeSelect>
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
      </ViewTransition>
    );
  }

  /* ------------------------------------------------------ the section list */

  return (
    <ViewTransition key="sections" enter="page-enter" exit="page-exit" default="none">
    <div className="mx-auto flex max-w-3xl flex-col gap-5 pb-24">
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
          {/* Whose documents these are comes FIRST, because this is the screen
              somebody lands on before either register exists, and "Build the
              VDRL" on its own does not say what to put in it. */}
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {info.owes}. Open a section and write what belongs in it. Numbers follow{' '}
            <span className="font-mono">{rule.prefix || 'PROJECT'}-…</span> on their own.
          </p>
        </div>
        <Button variant="outline" className="h-11" disabled={pending} onClick={() => fileInput.current?.click()}>
          <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          {pending ? 'Reading…' : 'From an Excel file'}
        </Button>
      </header>

      {namesCard}

      {bands.map((band, bandIndex) => (
        <section key={band.name} className="flex flex-col gap-2">
          {/* The outline code is shown, not hidden, because it IS the register's
              structure: `B` a heading, `B.1` a section, `B.1.1` a group. The
              same codes come out of the export and go back in through an
              import, so what someone builds here is what a spreadsheet shows. */}
          <p className="flex items-baseline gap-2 px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="font-mono normal-case text-foreground">{outlineCode([bandIndex + 1])}</span>
            {band.name}
          </p>

          {band.sections.map((section, sectionIndex) => {
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
                  // The cascade stops at 8, as everywhere else: past that the
                  // delay costs more than the arrival is worth.
                  'animate-enter',
                  sectionIndex < 8 && `stagger-${Math.min(sectionIndex + 1, 8)}`,
                  n > 0 && 'border-foreground/20',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {outlineCode([bandIndex + 1, sectionIndex + 1])}
                    </span>
                    <p className="text-sm font-medium">{section.name}</p>
                    <span className="font-mono text-xs text-muted-foreground">
                      {rule.prefix || 'PROJECT'}-{disciplineFor(section.name, rule)}-…
                    </span>
                  </div>
                  {section.groups.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {section.groups.map((g, i) => `${outlineCode([bandIndex + 1, sectionIndex + 1, i + 1])} ${g}`).join(' · ')}
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

      <AddNameCard
        label="Add a heading"
        placeholder="e.g. CONSTRUCTION"
        onAdd={(name) => setExtraBands((soFar) => [...soFar, { name, sections: [] }])}
      />

      <div className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-sm text-muted-foreground">
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => setView({ name: 'numbering' })}
        >
          Change the numbering
        </button>
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => { setPasteSource(null); setView({ name: 'paste' }); }}
        >
          Paste a whole list instead
        </button>
      </div>

      {errorBanner}

      <div className="sticky bottom-0 -mx-3 mt-2 flex flex-wrap items-center gap-3 border-t bg-background/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <span className="text-sm tabular-nums">
          <span className="font-semibold">
            <AnimatedNumber value={totals.documents} decimals={0} />
          </span>{' '}
          document{totals.documents === 1 ? '' : 's'} in {totals.groups} group
          {totals.groups === 1 ? '' : 's'}
          {structurePaths.length > 0 && (
            <span className="text-muted-foreground">
              {' · '}
              {structurePaths.length} added to the structure
            </span>
          )}
        </span>
        <Button
          className="ml-auto h-11"
          disabled={(totals.documents === 0 && structurePaths.length === 0) || !named || pending}
          onClick={saveDraft}
        >
          {pending ? 'Saving…' : 'Save to the register'}
        </Button>
      </div>
    </div>
    </ViewTransition>
  );
}

/** One field and one button, for both "add a section" and "add a group". */
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
