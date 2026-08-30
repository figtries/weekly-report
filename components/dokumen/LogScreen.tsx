'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { CornerDownLeft, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DURATION, EASE } from '@/components/motion/Reveal';
import { STAGE_LABEL, isApproved, type LogEvent } from '@/lib/register-shared';
import type { RegisterKind } from '@/lib/schema';
import { cn } from '@/lib/utils';

export interface TaggedEvent extends LogEvent {
  register: RegisterKind;
}

/**
 * Everything that has happened in both registers, newest first.
 *
 * The point of keeping it is not tidiness. A delay argument is built out of
 * dates — when a drawing went out, when it came back, how long it sat — and the
 * Excel register cannot supply them because every revision writes over the last.
 * This list is the record that survives.
 */

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'edl', label: 'EDL' },
  { id: 'vdrl', label: 'VDRL' },
  { id: 'return', label: 'Returns only' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

export function LogScreen({ events, weekNo }: { events: TaggedEvent[]; weekNo: number }) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<FilterId>('all');

  const shown = useMemo(() => {
    switch (filter) {
      case 'edl': return events.filter((e) => e.register === 'edl');
      case 'vdrl': return events.filter((e) => e.register === 'vdrl');
      case 'return': return events.filter((e) => e.kind === 'return');
      default: return events;
    }
  }, [events, filter]);

  const days = useMemo(() => {
    const map = new Map<string, TaggedEvent[]>();
    for (const e of shown) {
      const list = map.get(e.at) ?? [];
      list.push(e);
      map.set(e.at, list);
    }
    return [...map.entries()];
  }, [shown]);

  /**
   * How many cards precede each day, so the entrance can be capped by TOTAL
   * card count rather than per day.
   *
   * Capping per day was not enough: three days of a busy week is still eighty
   * simultaneous keyframes, and the app's own limit is around twenty. This
   * gives each card its position in the whole list, so the cascade stops at a
   * fixed number no matter how the events happen to fall across dates.
   */
  const dayOffset = useMemo(() => {
    let n = 0;
    return days.map(([, list]) => {
      const start = n;
      n += list.length;
      return start;
    });
  }, [days]);

  return (
    <div className="pb-4">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'relative flex h-11 items-center rounded-full px-4 text-sm font-medium transition-colors duration-300 ease-ios',
              filter === f.id ? 'text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {filter === f.id && (
              reduced
                ? <span className="absolute inset-0 rounded-full bg-foreground" />
                : <m.span layoutId="log-filter" className="absolute inset-0 rounded-full bg-foreground"
                    transition={{ duration: DURATION, ease: EASE }} />
            )}
            <span className="relative">{f.label}</span>
          </button>
        ))}
        <span className="flex h-11 items-center text-xs text-muted-foreground">
          {shown.length} events up to the end of week {weekNo}
        </span>
      </div>

      <div className="mt-6 flex flex-col gap-8">
        <AnimatePresence initial={false} mode="popLayout">
          {days.map(([date, list], dayIdx) => (
            <m.section
              key={date}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION, ease: EASE }}
              className="flex flex-col gap-2"
            >
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {dayLabel(date)}
              </h2>

              {/* The cascade goes on the CARDS, not on the section around them.
                  The section carries framer-motion's `layout`, which writes its
                  own transform, and a CSS keyframe on the same element would be
                  a second writer on one property. These are different elements,
                  so the two never meet.

                  It is also what gives this screen an entrance at all: the
                  section's `initial` is skipped on first mount by
                  `AnimatePresence initial={false}` — correctly, so nothing ships
                  hidden — which left the log arriving completely still.

                  ONLY THE FIRST TWENTY CARDS ANIMATE, counted across days and
                  not within them. This log renders every event up to the week
                  being viewed — 511 of them on Gundih — and capping the DELAY
                  is not the same as capping the COUNT. Capping per day was the
                  first attempt and still left eighty-seven keyframes running at
                  once, because a busy day carries thirty events on its own.
                  Twenty is the same limit the rest of the app uses, and it is
                  already more than fills a phone screen. */}
              {list.map((e, i) => {
                const nth = dayOffset[dayIdx] + i;
                return (
                <Card
                  key={`${e.documentId}-${e.stage}-${e.kind}-${i}`}
                  style={nth < 20 ? { animationDelay: `${Math.min(nth, 8) * 40}ms` } : undefined}
                  className={cn('py-0 shadow-sm', nth < 20 && 'animate-fade-in-up')}
                >
                  <CardContent className="flex items-start gap-3 p-4">
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                        e.kind === 'submit'
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : isApproved(e.returnCode)
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
                      )}
                    >
                      {e.kind === 'submit' ? <Send className="h-4 w-4" /> : <CornerDownLeft className="h-4 w-4" />}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {e.kind === 'submit' ? 'Sent' : 'Returned'}
                        </span>
                        <Badge variant="secondary" className="font-normal">{STAGE_LABEL[e.stage]}</Badge>
                        {e.returnCode && (
                          <Badge className={cn(
                            'font-normal',
                            isApproved(e.returnCode) ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white',
                          )}>
                            {e.returnCode}
                          </Badge>
                        )}
                        {e.transmittal && (
                          <span className="font-mono text-[0.7rem] text-muted-foreground">{e.transmittal}</span>
                        )}
                        {!e.dated && (
                          <span className="text-[0.7rem] text-amber-600">no date recorded</span>
                        )}
                        <Badge variant="outline" className="font-normal uppercase">{e.register}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm">{e.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {e.docNo ? <span className="font-mono">{e.docNo}</span> : 'unnumbered'} · {e.categoryName}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </m.section>
          ))}
        </AnimatePresence>

        {days.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No events match this filter.
          </p>
        )}
      </div>
    </div>
  );
}
