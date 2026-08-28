'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, Check, ChevronRight, CircleAlert, Clock, FilePlus2, Inbox, Search, Send,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { DURATION, EASE, Reveal } from '@/components/motion/Reveal';
import { STAGE_LABEL, type DocumentCard, type RegisterNode } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

import type { RecordMode } from './RecordDialog';

// Overlays load on demand — the field crew's connection is what this costs.
const RecordDialog = dynamic(() => import('./RecordDialog').then((m) => m.RecordDialog));
const DocumentPanel = dynamic(() => import('./DocumentPanel').then((m) => m.DocumentPanel));

/**
 * Where the register is actually worked on.
 *
 * Two columns on a desktop, one at a time on a phone: pick a group, then work
 * through its documents. Never a grid of cells — a spreadsheet is the thing
 * this product replaces, and a controller reads a document, not a row.
 *
 * Every document carries a checkbox because sending is a batch job. Tick the
 * drawings that went out together, press once, and the transmittal number and
 * date are typed a single time for all of them.
 */

interface Group {
  id: string;
  name: string;
  packageName: string;
  node: RegisterNode;
}

const TREND_BAR: Record<RegisterNode['trend'], string> = {
  ahead: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  'on-track': '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  slipping: '[&_[data-slot=progress-indicator]]:bg-amber-600',
  behind: '[&_[data-slot=progress-indicator]]:bg-rose-600',
  unplanned: '[&_[data-slot=progress-indicator]]:bg-blue-600',
};

const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
      })
    : '—';

export function RegisterWorkbench({
  projectId,
  register,
  tree,
  cards,
  weekNo,
  weekEndDate,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  /** The week being reported. Every figure below is as it stood at its end. */
  weekNo: number;
  weekEndDate: string;
}) {
  const reduced = useReducedMotion();

  const groups = useMemo(() => {
    const out: Group[] = [];
    const walk = (node: RegisterNode, packageName: string) => {
      if (node.children.length === 0) {
        if (node.documents > 0) out.push({ id: node.id, name: node.name, packageName, node });
        return;
      }
      // The heading is the group's immediate parent, not the band at the top:
      // filing all seventeen detail-engineering groups under "DETAIL
      // ENGINEERING" would hide which discipline each one belongs to.
      for (const child of node.children) walk(child, node.name);
    };
    for (const root of tree) walk(root, root.name);
    return out;
  }, [tree]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openDoc, setOpenDoc] = useState<DocumentCard | null>(null);
  const [mode, setMode] = useState<RecordMode | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const selected = groups.find((g) => g.id === selectedId) ?? null;
  const q = query.trim().toLowerCase();

  const matchingGroups = useMemo(
    () => (q === ''
      ? groups
      : groups.filter((g) =>
          g.name.toLowerCase().includes(q) ||
          g.packageName.toLowerCase().includes(q) ||
          (cards[g.id] ?? []).some((d) =>
            (d.docNo ?? '').toLowerCase().includes(q) || d.title.toLowerCase().includes(q)),
        )),
    [groups, cards, q],
  );

  const shown = useMemo(() => {
    const list = selected ? cards[selected.id] ?? [] : [];
    if (q === '') return list;
    return list.filter((d) =>
      (d.docNo ?? '').toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
  }, [selected, cards, q]);

  const pick = (id: string) => { setSelectedId(id); setChecked(new Set()); setDone(null); };
  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allChecked = shown.length > 0 && shown.every((d) => checked.has(d.id));

  const checkedDocs = shown.filter((d) => checked.has(d.id));
  // A batch is one stage at a time, so the dialog opens on whatever comes next
  // for the first document ticked — nearly always what the rest need too.
  const defaultStage = checkedDocs[0]?.nextStage ?? checkedDocs[0]?.stage ?? 'IFR';

  return (
    <div className="mt-6 pb-16 lg:grid lg:grid-cols-[minmax(260px,340px)_1fr] lg:gap-6">
      {/* ------------------------------------------------------- categories */}
      <aside className={cn('flex-col gap-3', selected ? 'hidden lg:flex' : 'flex')}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by number or title"
            className="h-11 pl-9"
            aria-label="Search documents"
          />
        </div>

        <div className="flex flex-col gap-4">
          {groupByPackage(matchingGroups).map(([packageName, list]) => (
            <div key={packageName} className="flex flex-col gap-1.5">
              <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {packageName}
              </p>
              {list.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => pick(g.id)}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-300 ease-ios',
                    selectedId === g.id
                      ? 'border-foreground/20 bg-muted'
                      : 'border-transparent bg-card hover:bg-muted/60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.name}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress
                        value={g.node.actual}
                        className={cn('h-1.5 flex-1', TREND_BAR[g.node.trend])}
                      />
                      <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                        {g.node.actual.toFixed(0)}% · {g.node.documents} {g.node.documents === 1 ? 'doc' : 'docs'}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ))}

          {matchingGroups.length === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- documents */}
      <section className={cn('self-start', selected ? 'block' : 'hidden lg:block')}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center lg:sticky lg:top-6">
            <Inbox className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Pick a group on the left to start recording.
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Tick the documents that went out on one transmittal, then record it once for all of
              them. The bar colour on the left shows where that group stands against plan.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Button
                variant="ghost" size="icon"
                className="h-11 w-11 shrink-0 lg:hidden"
                onClick={() => { setSelectedId(null); setChecked(new Set()); }}
                aria-label="Back to the group list"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {selected.packageName} · week {weekNo}
                </p>
                <h2 className="text-lg font-semibold leading-tight">{selected.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.node.documents} documents ·{' '}
                  <span className="tabular-nums">{selected.node.actual.toFixed(1)}%</span>
                  {selected.node.plan !== null && ` · plan ${selected.node.plan.toFixed(1)}%`}
                </p>
              </div>
            </div>

            {/* -------------------------------------------------- actions */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-blue-600"
                  checked={allChecked}
                  onChange={() =>
                    setChecked(allChecked ? new Set() : new Set(shown.map((d) => d.id)))}
                />
                <span>{checked.size > 0 ? `${checked.size} selected` : 'Select all'}</span>
              </label>

              <Button
                className="h-11" disabled={checked.size === 0}
                onClick={() => setMode('submit')}
              >
                <Send className="mr-1.5 h-4 w-4" /> Record submission
              </Button>
              <Button
                variant="secondary" className="h-11" disabled={checked.size === 0}
                onClick={() => setMode('return')}
              >
                <Inbox className="mr-1.5 h-4 w-4" /> Record return
              </Button>
              <Button variant="outline" className="h-11" onClick={() => setMode('add')}>
                <FilePlus2 className="mr-1.5 h-4 w-4" /> Add document
              </Button>
            </div>

            <AnimatePresence initial={false}>
              {done && (
                <motion.p
                  initial={reduced ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: DURATION, ease: EASE }}
                  className="overflow-hidden"
                >
                  <span className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    <Check className="h-4 w-4 shrink-0" />
                    {done} — the percentages have already moved.
                  </span>
                </motion.p>
              )}
            </AnimatePresence>

            {/* ------------------------------------------------ document list */}
            <div className="flex flex-col gap-2">
              {shown.map((doc, i) => (
                <Reveal key={doc.id} delay={Math.min(i, 8) * 0.02}>
                  <Card className={cn(
                    'py-0 shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md',
                    checked.has(doc.id) && 'ring-1 ring-blue-600/40',
                  )}>
                    <CardContent className="flex items-stretch gap-1 p-0">
                      <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-blue-600"
                          checked={checked.has(doc.id)}
                          onChange={() => toggle(doc.id)}
                          aria-label={`Select ${doc.docNo ?? doc.title}`}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setOpenDoc(doc)}
                        className="flex min-w-0 flex-1 flex-col gap-2 py-3 pr-4 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {doc.docNo
                            ? <span className="font-mono text-xs font-medium">{doc.docNo}</span>
                            : <Badge variant="outline" className="font-normal">unnumbered</Badge>}
                          {doc.revision && (
                            <span className="text-[0.7rem] text-muted-foreground">rev {doc.revision}</span>
                          )}
                          {doc.stage && (
                            <Badge variant="secondary" className="font-normal">{STAGE_LABEL[doc.stage]}</Badge>
                          )}
                          {doc.returnCode && (
                            <Badge className="bg-rose-600 font-normal text-white">{doc.returnCode}</Badge>
                          )}
                          {doc.laps > 0 && (
                            <span className="text-[0.7rem] text-muted-foreground">{doc.laps}× round trips</span>
                          )}
                        </div>

                        <p className="line-clamp-2 text-sm">{doc.title}</p>

                        <div className="flex items-center gap-3">
                          <Progress
                            value={doc.percent}
                            className="h-1.5 flex-1 [&_[data-slot=progress-indicator]]:bg-blue-600"
                          />
                          <span className="w-12 shrink-0 text-right text-[0.7rem] tabular-nums text-muted-foreground">
                            {doc.percent.toFixed(0)}%
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
                          {doc.waiting !== null && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> waiting {doc.waiting} days
                            </span>
                          )}
                          {doc.overdue && doc.nextStage && (
                            <span className="flex items-center gap-1 text-amber-600">
                              <CircleAlert className="h-3 w-3" />
                              {STAGE_LABEL[doc.nextStage]} promised {shortDate(doc.plannedAt)}
                            </span>
                          )}
                          {!doc.stage && <span>never submitted</span>}
                        </div>
                      </button>
                    </CardContent>
                  </Card>
                </Reveal>
              ))}

              {shown.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No documents match in this group.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {mode && selected && (
        <RecordDialog
          mode={mode}
          open
          onOpenChange={(open) => !open && setMode(null)}
          projectId={projectId}
          register={register}
          categoryId={selected.id}
          categoryName={selected.name}
          documentIds={checkedDocs.map((d) => d.id)}
          documentLabels={checkedDocs.map((d) => d.docNo ?? d.title)}
          defaultStage={defaultStage}
          // A submission recorded while reporting week N belongs in week N,
          // so the date starts there instead of empty.
          defaultDate={weekEndDate}
          onDone={(message) => { setDone(message); setChecked(new Set()); }}
        />
      )}

      {openDoc && (
        <DocumentPanel
          doc={openDoc}
          asOfDate={weekEndDate}
          open
          onOpenChange={(open) => !open && setOpenDoc(null)}
        />
      )}
    </div>
  );
}

function groupByPackage(groups: Group[]): Array<[string, Group[]]> {
  const map = new Map<string, Group[]>();
  for (const g of groups) {
    const list = map.get(g.packageName) ?? [];
    list.push(g);
    map.set(g.packageName, list);
  }
  return [...map.entries()];
}
