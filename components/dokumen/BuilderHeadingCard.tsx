'use client';

import { memo, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { MoreHorizontal, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CheckBox } from '@/components/ui/CheckBox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  addSub, rowsFromText, subSuggestions,
  type BuilderHeading, type BuilderRow, type Kind,
} from '@/lib/builder-model';
import { MOTION } from '@/lib/design';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

/**
 * One heading of a register being built: its documents, or its sub-headings
 * and theirs (3 Oct 2026, variant A chosen from rendered options).
 *
 * Everything on a row is typed in place. The number is the builder's own until
 * someone types over it; the Plan IFR date is optional and becomes that stage's
 * plan, which is what the engineering plan curve is counted from.
 *
 * Motion: a row that ARRIVES (typed, pasted) rises 8px and fades in on
 * `MOTION`, on its own; rows that were there when the card appeared do not
 * move. No layout animation, no cascade (see `Panel.tsx`).
 */

const field =
  'h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-base outline-none ' +
  'transition-colors duration-200 ease-ios focus-visible:border-ring focus-visible:ring-3 ' +
  'focus-visible:ring-ring/50 md:text-sm';

/**
 * Memoised: the builder holds every heading in one list, and a change to one
 * must not redraw the others. Its callbacks are stable (they take the heading)
 * and `renumber` keeps an unchanged heading the same object.
 */
export const BuilderHeadingCard = memo(function BuilderHeadingCard({
  heading: h,
  register,
  onChange,
  onRemove,
}: {
  heading: BuilderHeading;
  register: RegisterKind;
  onChange: (next: BuilderHeading) => void;
  onRemove: (heading: BuilderHeading) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [ownSub, setOwnSub] = useState('');

  const count = h.rows.filter((r) => r.picked && r.title.trim()).length
    + h.subs.reduce((n, s) => n + s.rows.filter((r) => r.picked && r.title.trim()).length, 0);
  const taken = new Set(h.subs.map((s) => s.name.toLowerCase()));
  const suggestions = subSuggestions(register, h.name).filter((s) => !taken.has(s.toLowerCase()));
  // A locked heading that already holds documents directly cannot grow
  // sub-headings here: its existing documents would be left on a non-leaf.
  const canSub = !(h.locked && h.existing > 0 && h.subs.length === 0);

  const takeSub = (name: string) => {
    if (!name.trim() || taken.has(name.trim().toLowerCase())) return;
    onChange(addSub(h, name));
    setOwnSub('');
    setSubOpen(false);
  };

  const countLabel = h.locked
    ? `${h.existing} existing${count > 0 ? ` · ${count} new` : ''}`
    : count === 0 ? 'Empty' : `${count} document${count === 1 ? '' : 's'}`;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <header className="flex min-h-10 items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            defaultValue={h.name}
            aria-label="Heading name"
            className={cn(field, 'h-10 max-w-sm font-semibold')}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) onChange({ ...h, name: v }); setRenaming(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(false); }}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{h.name}</h3>
        )}
        <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">{countLabel}</span>
        {!h.locked && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`${h.name} actions`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove(h)}>Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {h.subs.length === 0 ? (
        <Rows rows={h.rows} onRows={(rows) => onChange({ ...h, rows })} />
      ) : (
        h.subs.map((s) => (
          <div key={s.id} className="mt-4">
            <div className="flex min-h-8 items-center gap-2 text-sm font-semibold text-foreground/80">
              <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-border" />
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
                {s.rows.filter((r) => r.picked && r.title.trim()).length}
              </span>
            </div>
            <Rows
              rows={s.rows}
              onRows={(rows) => onChange({ ...h, subs: h.subs.map((x) => (x.id === s.id ? { ...x, rows } : x)) })}
            />
          </div>
        ))
      )}

      {canSub && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubOpen((v) => !v)}
            aria-expanded={subOpen}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <Plus className="h-4 w-4" /> Sub-heading
          </button>
          <AnimatePresence initial={false}>
            {subOpen && (
              <m.div
                key="subs"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: MOTION.duration, ease: MOTION.ease }}
                className="flex flex-wrap items-center gap-2"
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => takeSub(s)}
                    className="inline-flex min-h-9 items-center rounded-lg border bg-card px-3 text-sm text-foreground/80 transition-colors duration-200 ease-ios hover:border-primary/50 hover:bg-primary/5"
                  >
                    {s}
                  </button>
                ))}
                <input
                  value={ownSub}
                  onChange={(e) => setOwnSub(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') takeSub(ownSub); }}
                  placeholder="Your own, then Enter"
                  aria-label="New sub-heading"
                  className={cn(field, 'h-9 w-48')}
                />
              </m.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
});

/* ------------------------------------------------------------------ rows */

function Rows({ rows, onRows }: { rows: BuilderRow[]; onRows: (rows: BuilderRow[]) => void }) {
  const withCheck = rows.some((r) => r.fromSource);
  const set = (id: string, patch: Partial<BuilderRow>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // Phone: title (and the tick) on one line, kind, number and plan under it.
  // From sm the second line's wrapper dissolves (`sm:contents`) and every
  // field sits on one grid line, so the columns read as columns.
  const cols = withCheck
    ? 'sm:grid-cols-[1.75rem_minmax(0,1fr)_6.25rem_9.5rem_9rem_2.75rem]'
    : 'sm:grid-cols-[minmax(0,1fr)_6.25rem_9.5rem_9rem_2.75rem]';

  return (
    <div className="mt-2">
      {rows.length > 0 && (
        <div className={cn('hidden gap-2 px-0.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:grid', cols)}>
          {withCheck && <span />}
          <span>Title</span><span>Kind</span><span>Number</span><span>Plan IFR</span><span />
        </div>
      )}
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <m.div
            key={r.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MOTION.duration, ease: MOTION.ease }}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 border-t border-border/60 py-1.5 first:border-t-0',
              withCheck && 'grid-cols-[1.75rem_minmax(0,1fr)_2.75rem]',
              cols,
            )}
          >
            {withCheck && (
              <CheckBox
                checked={r.picked}
                onChange={(e) => set(r.id, { picked: e.target.checked })}
                aria-label={`Include ${r.title}`}
              />
            )}
            <div className="min-w-0">
              <input
                value={r.title}
                onChange={(e) => set(r.id, { title: e.target.value })}
                aria-label="Document title"
                className={cn(field, !r.picked && 'opacity-45')}
              />
              {/* On a phone the number rides under the title: as a third box on
                  the second line it was cut to "ASD-PC". It is typed over on a
                  wider screen, or later in the document editor. */}
              <p className="mt-1 truncate px-0.5 font-mono text-xs text-muted-foreground sm:hidden">
                {r.picked ? r.docNo || 'Numbered when titled' : 'Not added'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRows(rows.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.title || 'row'}`}
              className="flex h-10 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground sm:order-last"
            >
              <X className="h-4 w-4" />
            </button>
            <div className={cn('col-span-full grid grid-cols-[6.25rem_minmax(0,1fr)] gap-2 sm:contents', !r.picked && 'opacity-45')}>
              <KindToggle value={r.kind} onChange={(kind) => set(r.id, { kind })} />
              <input
                value={r.picked ? r.docNo : ''}
                placeholder={r.picked ? '' : 'Not added'}
                onChange={(e) => set(r.id, { docNo: e.target.value, auto: e.target.value.trim() === '' })}
                aria-label="Document number"
                className={cn(field, 'hidden font-mono text-[13px] sm:block md:text-[12.5px]')}
              />
              <input
                type="date"
                value={r.planIfr}
                onChange={(e) => set(r.id, { planIfr: e.target.value })}
                aria-label="Planned IFR date"
                className={field}
              />
            </div>
          </m.div>
        ))}
      </AnimatePresence>
      <AddBox onAdd={(added) => onRows([...rows, ...added])} />
    </div>
  );
}

function KindToggle({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  return (
    <div role="radiogroup" aria-label="Kind" className="grid h-10 grid-cols-2 overflow-hidden rounded-lg border border-input">
      {(['Doc', 'Dwg'] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            'text-[13px] font-semibold transition-colors duration-200 ease-ios',
            value === k ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

/**
 * Enter adds what was typed; a paste of several lines adds one row per line.
 * Pressing Enter on an empty box is the one moment it says anything, in red,
 * and it clears as soon as something is typed (memory: validate on action).
 */
function AddBox({ onAdd }: { onAdd: (rows: BuilderRow[]) => void }) {
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState(false);

  return (
    <div className="mt-1.5">
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); if (nudge) setNudge(false); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const rows = rowsFromText(text);
          if (rows.length === 0) { setNudge(true); return; }
          onAdd(rows);
          setText('');
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (!/\r?\n/.test(pasted.trim())) return;
          e.preventDefault();
          onAdd(rowsFromText(pasted));
          setText('');
        }}
        placeholder="Type a title and press Enter, or paste several lines"
        aria-label="Add a document"
        aria-invalid={nudge || undefined}
        className={cn(
          field,
          'border-dashed bg-transparent placeholder:text-muted-foreground/70',
          nudge && 'border-solid border-bad ring-3 ring-bad/15',
        )}
      />
      {nudge && <p className="mt-1 text-xs font-medium text-bad">Type a title first.</p>}
    </div>
  );
}

