'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CheckBox } from '@/components/ui/CheckBox';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import NativeSelect from '@/components/ui/NativeSelect';
import { recordTransmittal } from '@/lib/doc-actions';
import { MOTION } from '@/lib/design';
import { STAGE_LABEL, STAGE_ORDER, type DocumentCard, type Obstacle } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';
import type { RegisterSettings } from '@/lib/register-settings';
import { cn } from '@/lib/utils';
import { matchesSearch, searchWords } from '@/lib/search';

/**
 * RECORD TRANSMITTAL: one letter, every document in it (3 Oct 2026, variant A
 * of two rendered for the user: start from the letter, not from ticks in a
 * list, because tick-then-choose-a-mode was thrown out once already).
 *
 * The first question is what happened: we sent documents, or documents came
 * back. Then the date and the letter number, once. Then the documents: for a
 * send, the ones whose ball is ours, outstanding first in the summary's own
 * words, each with its next stage filled in; for a return, the ones out with
 * the other side, longest first, each with its code. Which stage is next and
 * which is out are decided on the server by the same rule as Outstanding
 * (`DocumentCard.sendNext` / `out`), never worked out again here.
 *
 * Shell copied from ExportExcelDialog: `.dialog-soft` motion, a plain scrim,
 * focus moved two frames after opening. The rows are native controls: a
 * register can hold hundreds, and Radix per row is what AGENTS.md forbids.
 */

const CODES = ['APP', 'AWC', 'RWC'] as const;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dayMonth = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TONE: Record<string, string> = {
  late: 'bg-bad-soft text-bad',
  comments: 'bg-warn-soft text-warn',
  soon: 'bg-chart-1/10 text-primary',
  out: 'bg-muted text-muted-foreground',
};

interface Row {
  card: DocumentCard;
  group: string;
  /** The reason in the summary's words, when it is outstanding. */
  reason: { text: string; tone: string } | null;
  stage: DocStage;
}

export default function TransmittalDialog({
  open,
  onOpenChange,
  projectId,
  register,
  cards,
  obstacles,
  groupNames,
  preset = null,
  nextLetters,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  register: RegisterKind;
  cards: Record<string, DocumentCard[]>;
  obstacles: Obstacle[];
  groupNames: Record<string, string>;
  /** Opened from ticked rows or a document's sheet: which way, and which documents. */
  preset?: { direction: 'out' | 'in'; ids: string[] } | null;
  /** The next letter number each way, continuing the register's pattern. */
  nextLetters?: { out: string; in: string };
  /** The register's own words for its codes. */
  settings?: RegisterSettings;
}) {
  const edl = register === 'edl';
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [date, setDate] = useState(today);
  const [letter, setLetter] = useState('');
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [stageOf, setStageOf] = useState<Record<string, DocStage>>({});
  const [codeOf, setCodeOf] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [missingCodes, setMissingCodes] = useState(false);

  // Opened from ticked rows: that direction, those documents, the next letter
  // number proposed. Applied once per opening (state adjusted during render,
  // React's pattern for following a prop), so a second press with other rows
  // ticked is that letter, not the last one.
  const openKey = open ? `${preset?.direction ?? ''}:${preset?.ids.join(',') ?? ''}` : null;
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  if (openKey !== appliedKey) {
    setAppliedKey(openKey);
    if (openKey !== null) {
      const dir = preset?.direction ?? direction;
      if (preset) { setDirection(preset.direction); setTicked(new Set(preset.ids)); }
      setLetter((l) => l || (nextLetters?.[dir] ?? ''));
      setMissingCodes(false);
    }
  }
  const codeName = (key: string) => settings?.codes.find((c) => c.key === key)?.label ?? key;

  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

  const rows = useMemo<Row[]>(() => {
    const all = Object.values(cards).flat();
    const rank = new Map(obstacles.map((o, i) => [o.documentId, i]));
    const byId = new Map(obstacles.map((o) => [o.documentId, o]));
    if (direction === 'out') {
      return all
        .filter((c) => c.sendNext !== null)
        .map((c): Row => {
          const o = byId.get(c.id);
          const reason = !o ? null
            : o.kind === 'late' ? { text: `Late ${plural(o.days ?? 0, 'day')}`, tone: TONE.late }
            : o.kind === 'comments' ? { text: `${o.returnCode ?? 'Back'} ${dayMonth(o.since)}`.trim(), tone: TONE.comments }
            : o.kind === 'soon' ? { text: `Due ${dayMonth(o.since)}`, tone: TONE.soon }
            : null;
          return { card: c, group: groupNames[c.categoryId] ?? '', reason, stage: c.sendNext! };
        })
        .sort((a, b) => {
          const ra = a.reason ? rank.get(a.card.id) ?? 1e6 : 1e6;
          const rb = b.reason ? rank.get(b.card.id) ?? 1e6 : 1e6;
          return ra - rb || a.card.title.localeCompare(b.card.title);
        });
    }
    return all
      .filter((c) => c.out !== null)
      .map((c): Row => ({
        card: c,
        group: groupNames[c.categoryId] ?? '',
        reason: { text: c.out!.days !== null ? `${plural(c.out!.days, 'day')} out` : 'Out', tone: TONE.out },
        stage: c.out!.stage,
      }))
      .sort((a, b) => (b.card.out!.days ?? 0) - (a.card.out!.days ?? 0));
  }, [cards, obstacles, groupNames, direction]);

  const words = searchWords(query);
  const shown = rows.filter((r) => matchesSearch(words, r.card.title, r.card.docNo, r.group));
  const count = rows.filter((r) => ticked.has(r.card.id)).length;

  const switchTo = (next: 'out' | 'in') => {
    if (next === direction) return;
    setDirection(next);
    setTicked(new Set());
    setError(null);
    setLetter(nextLetters?.[next] ?? '');
  };

  const toggle = (id: string) => setTicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const save = () => {
    setError(null);
    if (!letter.trim()) { setError('Type the letter number first.'); return; }
    // No code is ever assumed: a reply records what the other side wrote.
    if (direction === 'in' && rows.some((r) => ticked.has(r.card.id) && !codeOf[r.card.id])) {
      setMissingCodes(true);
      setError('Choose a code for every ticked document.');
      return;
    }
    const items = rows.filter((r) => ticked.has(r.card.id)).map((r) => ({
      documentId: r.card.id,
      stage: direction === 'out' ? (stageOf[r.card.id] ?? r.stage) : r.stage,
      code: direction === 'in' ? codeOf[r.card.id] : undefined,
    }));
    start(async () => {
      const result = await recordTransmittal({ projectId, register, direction, date, letter, items });
      if (!result.ok) { setError(result.error); return; }
      setTicked(new Set());
      setLetter('');
      onOpenChange(false);
    });
  };

  const sides = edl
    ? { out: ['We sent documents', 'To the client, at their next stage'], in: ['Documents came back', 'From the client, each with its code'] }
    : { out: ['Documents came in', 'From the vendor, at their next stage'], in: ['We replied', 'To the vendor, each with its code'] };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dialog-soft flex max-h-[92dvh] flex-col gap-4 overflow-hidden sm:max-w-2xl"
        overlayClassName="scrim-soft bg-black/40 supports-backdrop-filter:backdrop-blur-none"
        ref={contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          later(() => contentRef.current?.focus({ preventScroll: true }));
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const back = opener.current;
          if (back) later(() => back.focus({ preventScroll: true }));
        }}
      >
        <DialogHeader>
          <DialogTitle>Record transmittal</DialogTitle>
          <DialogDescription>One letter, every document in it.</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="What happened" className="grid grid-cols-2 gap-2">
          {(['out', 'in'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => switchTo(d)}
              className={cn(
                'min-h-14 rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-200 ease-ios',
                direction === d ? 'border-primary bg-primary/5 ring-3 ring-primary/15' : 'bg-card hover:border-primary/40',
              )}
            >
              <span className="block text-sm font-semibold">{sides[d][0]}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{sides[d][1]}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Date</span>
            <Input type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Letter</span>
            <Input
              className="h-11 font-mono"
              value={letter}
              onChange={(e) => { setLetter(e.target.value); if (error) setError(null); }}
              placeholder="e.g. TRM-0041"
            />
          </label>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents" className="h-11 pl-9" aria-label="Search documents" />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={direction}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MOTION.duration, ease: MOTION.ease }}
            className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
          >
            {shown.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? (direction === 'out' ? 'Nothing waiting to go out.' : `Nothing is out with the ${edl ? 'client' : 'vendor'}.`)
                  : 'Nothing matches that search.'}
              </p>
            ) : (
              <ul className="flex flex-col">
                {shown.map((r) => {
                  const on = ticked.has(r.card.id);
                  return (
                    <li
                      key={r.card.id}
                      className="grid grid-cols-[1.75rem_minmax(0,1fr)_7.75rem] items-center gap-x-3 border-t border-border/60 py-2 first:border-t-0 sm:grid-cols-[1.75rem_6.5rem_minmax(0,1fr)_6rem]"
                    >
                      <CheckBox checked={on} onChange={() => toggle(r.card.id)} aria-label={`Include ${r.card.title}`} />
                      <span className={cn(
                        'hidden h-7 w-26 items-center justify-center rounded-lg text-xs font-semibold tabular-nums whitespace-nowrap sm:flex',
                        r.reason ? r.reason.tone : 'bg-transparent',
                      )}>
                        {r.reason?.text ?? ''}
                      </span>
                      <button type="button" onClick={() => toggle(r.card.id)} className="min-w-0 py-0.5 text-left">
                        <span className="line-clamp-2 text-sm font-medium leading-snug sm:line-clamp-1">{r.card.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.reason && <span className="font-semibold text-foreground/70 sm:hidden">{r.reason.text} · </span>}
                          {[r.group, r.card.docNo, direction === 'in' ? STAGE_LABEL[r.stage] : null].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                      {direction === 'out' ? (
                        <NativeSelect
                          aria-label={`Stage for ${r.card.title}`}
                          value={stageOf[r.card.id] ?? r.stage}
                          onChange={(e) => setStageOf((s) => ({ ...s, [r.card.id]: e.target.value as DocStage }))}
                        >
                          {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                        </NativeSelect>
                      ) : (
                        <NativeSelect
                          aria-label={`Code for ${r.card.title}`}
                          value={codeOf[r.card.id] ?? ''}
                          onChange={(e) => setCodeOf((s) => ({ ...s, [r.card.id]: e.target.value }))}
                          className={missingCodes && ticked.has(r.card.id) && !codeOf[r.card.id] ? 'border-bad text-bad' : undefined}
                        >
                          <option value="">Choose a code</option>
                          {CODES.map((c) => <option key={c} value={c}>{codeName(c)}</option>)}
                        </NativeSelect>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </m.div>
        </AnimatePresence>

        {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}

        <div className="flex items-center gap-2 border-t pt-3">
          <span className="mr-auto text-sm tabular-nums text-muted-foreground">
            {plural(count, 'document')} in this letter
          </span>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" disabled={pending || count === 0} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
