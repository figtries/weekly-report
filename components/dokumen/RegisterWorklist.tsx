'use client';

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { STAGE_LABEL, type Obstacle, type ObstacleKind } from '@/lib/register-shared';
import { cn } from '@/lib/utils';

/**
 * What is actually waiting to be worked on, as a list you can click into.
 *
 * This panel exists because the right-hand column used to say "Pick a group to
 * start" inside a dashed box and then stop — on a wide screen roughly sixty per
 * cent of the workbench did no work at all until you clicked something, and the
 * one thing a document controller opens this screen to find out (what is stuck)
 * was two tabs away.
 *
 * It is deliberately NOT the summary screen's obstacle block. That one lists
 * eight and is read; this one is complete, filters by kind, shares the
 * workbench's search box, and every row opens that document's editor in place.
 * Reading versus working — same figures, different verb.
 *
 * `getObstacles` already counts each document once and ranks returned before
 * overdue before never-sent, so the order here is the register's own priority,
 * not a second opinion invented on the client.
 */

/**
 * The three kinds, in the summary screen's own colours.
 *
 * Colour alone never carries the reason: each row also writes its kind out in
 * words on the right, because this app is used by people who will not be
 * hovering anything and some of whom will not separate red from amber.
 */
const KIND: Record<ObstacleKind, { label: string; chip: string; edge: string; unit: string }> = {
  returned: {
    label: 'Returned',
    chip: 'bg-red-100 text-red-700',
    edge: 'border-l-red-400',
    unit: 'days returned',
  },
  overdue: {
    label: 'Overdue',
    chip: 'bg-amber-100 text-amber-700',
    edge: 'border-l-amber-400',
    unit: 'days overdue',
  },
  untouched: {
    label: 'Never sent',
    chip: 'bg-muted text-muted-foreground',
    edge: 'border-l-border',
    unit: 'never sent',
  },
};

const ORDER: ObstacleKind[] = ['returned', 'overdue', 'untouched'];

/** Enough to fill a desktop column without asking the browser to lay out ninety rows. */
const PAGE = 15;

/** The continuation under a selected group is a tail, not a second screen. */
const COMPACT_PAGE = 6;

export function RegisterWorklist({
  obstacles,
  totalDocuments,
  query,
  onOpen,
  compact = false,
  excludeCategoryId = null,
}: {
  obstacles: Obstacle[];
  totalDocuments: number;
  /** The workbench's own search box. One box, both columns. */
  query: string;
  onOpen: (categoryId: string, documentId: string) => void;
  /** The short tail shown under a group's documents. */
  compact?: boolean;
  excludeCategoryId?: string | null;
}) {
  const [kind, setKind] = useState<ObstacleKind | 'all'>('all');
  const [limit, setLimit] = useState(compact ? COMPACT_PAGE : PAGE);

  const counts = useMemo(() => {
    const out: Record<ObstacleKind, number> = { returned: 0, overdue: 0, untouched: 0 };
    for (const o of obstacles) out[o.kind] += 1;
    return out;
  }, [obstacles]);

  const q = query.trim().toLowerCase();

  const matching = useMemo(
    () =>
      obstacles.filter((o) => {
        if (excludeCategoryId && o.categoryId === excludeCategoryId) return false;
        if (kind !== 'all' && o.kind !== kind) return false;
        if (q === '') return true;
        return (
          (o.docNo ?? '').toLowerCase().includes(q) ||
          o.title.toLowerCase().includes(q) ||
          o.categoryName.toLowerCase().includes(q)
        );
      }),
    [obstacles, excludeCategoryId, kind, q],
  );

  const shown = matching.slice(0, limit);

  if (obstacles.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <p className="text-sm font-medium">Nothing is stuck.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every document in the register has gone out and come back clean.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', !compact && 'animate-enter')}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-base')}>
          {compact ? 'Other work waiting' : 'What needs work'}
        </h2>
        {!compact && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {obstacles.length} of {totalDocuments} open
          </span>
        )}
      </div>

      {/* Filters only on the full panel: the tail under a group is six rows, and
          six rows do not need to be narrowed. */}
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip active={kind === 'all'} onClick={() => setKind('all')} label="All" count={obstacles.length} />
          {ORDER.filter((k) => counts[k] > 0).map((k) => (
            <FilterChip
              key={k}
              active={kind === k}
              onClick={() => setKind(kind === k ? 'all' : k)}
              label={KIND[k].label}
              count={counts[k]}
              tone={KIND[k].chip}
            />
          ))}
        </div>
      )}

      {/* Two columns once there is room for them. A single column of these rows
          on a 1440 screen left a hand's width of nothing between the document
          number and the day count on every one of fifteen rows — the same
          emptiness this panel was built to remove, just moved inside the row. */}
      <div className="grid gap-1.5 xl:grid-cols-2">
        {shown.map((o, i) => (
          <button
            key={o.documentId}
            type="button"
            onClick={() => onOpen(o.categoryId, o.documentId)}
            // Same cascade cap the group column uses, and for the same reason:
            // the rows past twenty are below the fold and have nothing to say.
            style={i < 20 ? { animationDelay: `${Math.min(i, 8) * 40}ms` } : undefined}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border border-l-4 bg-card px-4 py-3 text-left transition-shadow duration-300 ease-ios hover:shadow-sm',
              KIND[o.kind].edge,
              i < 20 && 'animate-fade-in-up',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {o.docNo ? (
                  <span className="font-mono text-xs font-medium">{o.docNo}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">no number</span>
                )}
                {o.stage && (
                  <Badge variant="outline" className="font-normal">
                    {STAGE_LABEL[o.stage]}
                  </Badge>
                )}
                {o.returnCode && (
                  <Badge className="bg-red-100 font-normal text-red-700">{o.returnCode}</Badge>
                )}
              </div>
              <p className="mt-0.5 line-clamp-1 text-sm">{o.title}</p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{o.categoryName}</p>
            </div>

            <div className="w-20 shrink-0 text-right">
              {o.days !== null && (
                <p className="text-sm font-semibold leading-none tabular-nums">{o.days}</p>
              )}
              <p className="mt-1 text-[0.65rem] leading-tight text-muted-foreground">
                {o.days !== null ? KIND[o.kind].unit : KIND[o.kind].label.toLowerCase()}
              </p>
            </div>
          </button>
        ))}

        {matching.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground xl:col-span-2">Nothing matches here.</p>
        )}
      </div>

      {matching.length > shown.length && (
        <Button
          variant="outline"
          className="h-11 w-full"
          onClick={() => setLimit((n) => n + (compact ? COMPACT_PAGE : PAGE))}
        >
          Show {Math.min(compact ? COMPACT_PAGE : PAGE, matching.length - shown.length)} more
        </Button>
      )}
    </div>
  );
}

/**
 * A filter, not a statistic.
 *
 * It carries its count so the row doubles as the summary the panel would
 * otherwise need above it — one place for each number, which is the rule the
 * summary screen already follows.
 */
function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors duration-300 ease-ios',
        active
          ? 'bg-foreground text-background'
          : (tone ?? 'bg-muted text-muted-foreground') + ' hover:opacity-80',
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
