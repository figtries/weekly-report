'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ChevronDown, ChevronRight, FilePlus2, Inbox, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { DURATION, EASE } from '@/components/motion/Reveal';
import { STAGE_LABEL, type DocumentCard, type RegisterNode } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

import { DocumentEditor } from './DocumentEditor';

// The one overlay left: adding a document. It loads on demand.
const AddDocumentDialog = dynamic(() => import('./AddDocumentDialog').then((m) => m.AddDocumentDialog));

/**
 * Where the register is worked on.
 *
 * Pick a group, click a document, type. That is the whole interaction — the
 * screen this replaced asked people to tick boxes and then choose between
 * "record submission" and "record return" before they could fix anything, and
 * the modes were the first thing that confused them.
 *
 * No percentage is ever typed here. Dates and letters go in; the figures on
 * every row and on both summary screens are computed from them.
 */

interface Group {
  id: string;
  name: string;
  packageName: string;
  node: RegisterNode;
}

/**
 * Every bar in Document Control is blue, because blue means actual.
 *
 * These were painted by trend — emerald when ahead, rose when behind. Once the
 * summary screens settled on the S-curve's convention (actual blue, plan red) a
 * rose bar on this screen read as a plan line, which is the opposite of what it
 * is: no plan is drawn here at all, only how far each group has got.
 */
const BAR = '[&_[data-slot=progress-indicator]]:bg-blue-500';

export function RegisterWorkbench({
  projectId,
  register,
  tree,
  cards,
  weekNo,
}: {
  projectId: string;
  register: RegisterKind;
  tree: RegisterNode[];
  cards: Record<string, DocumentCard[]>;
  /** The week being reported. Every figure below is as it stood at its end. */
  weekNo: number;
}) {
  const reduced = useReducedMotion();

  const groups = useMemo(() => {
    const out: Group[] = [];
    const walk = (node: RegisterNode, packageName: string) => {
      if (node.children.length === 0) {
        if (node.documents > 0) out.push({ id: node.id, name: node.name, packageName, node });
        return;
      }
      // The heading is the group's immediate parent, not the band at the top.
      for (const child of node.children) walk(child, node.name);
    };
    for (const root of tree) walk(root, root.name);
    return out;
  }, [tree]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  return (
    <div className="pb-4 lg:grid lg:grid-cols-[minmax(260px,340px)_1fr] lg:gap-6">
      {/* ------------------------------------------------------- categories */}
      {/* The classes go on the aside and the section themselves rather than on
          a `Reveal` wrapper: this is a two-column grid, and a wrapper div would
          become the grid child in their place and collapse the layout. */}
      <aside className={cn('animate-enter flex-col gap-3', selected ? 'hidden lg:flex' : 'flex')}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 pl-9"
            aria-label="Search documents"
          />
        </div>

        <div className="flex flex-col gap-4">
          {/* `packagesBefore` carries a running count across packages so the
              cascade cap below counts the WHOLE column, not each package from
              zero. Without it VDRL's many small packages each restart the
              index and every button animates. */}
          {groupByPackage(matchingGroups).map(([packageName, list], pkgIdx, packages) => {
          const packagesBefore = packages
            .slice(0, pkgIdx)
            .reduce((n, [, l]) => n + l.length, 0);
          return (
            <div key={packageName} className="flex flex-col gap-1.5">
              <p className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {packageName}
              </p>
              {list.map((g, gj) => {
                const gi = packagesBefore + gj;
                return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { setSelectedId(g.id); setOpenDoc(null); }}
                  // Delay capped at 8 steps AND the count capped at 20. The two
                  // are different limits: the first stops the last row arriving
                  // seconds in, the second stops a register with sixty vendor
                  // packages from starting sixty keyframes at once. VDRL has
                  // enough packages to need the second one.
                  style={gi < 20 ? { animationDelay: `${Math.min(gi, 8) * 40}ms` } : undefined}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-300 ease-ios',
                    gi < 20 && 'animate-fade-in-up',
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
                        className={cn(
                          'h-1.5 flex-1',
                          BAR,
                          gi < 20 && '[&_[data-slot=progress-indicator]]:animate-bar-grow',
                        )}
                      />
                      <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                        {g.node.actual.toFixed(0)}% · {g.node.documents}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                );
              })}
            </div>
          );
          })}

          {matchingGroups.length === 0 && (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">No match.</p>
          )}
        </div>
      </aside>

      {/* -------------------------------------------------------- documents */}
      <section className={cn('animate-enter stagger-1 self-start', selected ? 'block' : 'hidden lg:block')}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center lg:sticky lg:top-6">
            <Inbox className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Pick a group to start.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <Button
                variant="ghost" size="icon"
                className="h-11 w-11 shrink-0 lg:hidden"
                onClick={() => { setSelectedId(null); setOpenDoc(null); }}
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {selected.packageName} · week {weekNo}
                </p>
                <h2 className="text-lg font-semibold leading-tight">{selected.name}</h2>
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {selected.node.documents} documents · {selected.node.actual.toFixed(1)}%
                  {selected.node.plan !== null && ` · plan ${selected.node.plan.toFixed(1)}%`}
                </p>
              </div>
              <Button variant="outline" className="h-11 shrink-0" onClick={() => setAdding(true)}>
                <FilePlus2 className="mr-1.5 h-4 w-4" /> Add
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              {shown.map((doc, di) => {
                const open = openDoc === doc.id;
                return (
                  <div
                    key={doc.id}
                    // Only the first twenty animate. A discipline can hold far
                    // more than that, and capping the delay is not capping the
                    // count — the rows past this point are below the fold and
                    // have nothing to announce.
                    style={di < 20 ? { animationDelay: `${Math.min(di, 8) * 40}ms` } : undefined}
                    className={cn(
                      'overflow-hidden rounded-xl border bg-card transition-shadow duration-300 ease-ios',
                      di < 20 && 'animate-fade-in-up',
                      open ? 'shadow-md ring-1 ring-blue-600/30' : 'hover:shadow-sm',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenDoc(open ? null : doc.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-ios',
                          !open && '-rotate-90',
                        )}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {doc.docNo
                            ? <span className="font-mono text-xs font-medium">{doc.docNo}</span>
                            : <span className="text-xs text-muted-foreground">no number</span>}
                          {doc.stage && (
                            <Badge variant="secondary" className="font-normal">{STAGE_LABEL[doc.stage]}</Badge>
                          )}
                          {doc.returnCode && (
                            <Badge className="bg-red-100 font-normal text-red-700">{doc.returnCode}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-sm">{doc.title}</p>
                      </div>

                      <div className="flex w-24 shrink-0 items-center gap-2">
                        {/* Gated on the list being short, exactly as the daily
                            list is: one discipline can hold enough documents
                            that every row starting a 1s grow at once is real
                            work on a phone. */}
                        <Progress
                          value={doc.percent}
                          className={cn(
                            'h-1.5 flex-1',
                            BAR,
                            shown.length <= 20 &&
                              '[&_[data-slot=progress-indicator]]:animate-bar-grow',
                          )}
                        />
                        <span className="w-9 text-right text-[0.7rem] tabular-nums text-muted-foreground">
                          {doc.percent.toFixed(0)}%
                        </span>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {open && (
                        <m.div
                          initial={reduced ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: DURATION, ease: EASE }}
                          className="overflow-hidden"
                        >
                          <DocumentEditor projectId={projectId} register={register} doc={doc} />
                        </m.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {shown.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">No documents here.</p>
              )}
            </div>
          </div>
        )}
      </section>

      {adding && selected && (
        <AddDocumentDialog
          open
          onOpenChange={setAdding}
          projectId={projectId}
          register={register}
          categoryId={selected.id}
          categoryName={selected.name}
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
