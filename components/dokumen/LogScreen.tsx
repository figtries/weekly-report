'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
                : <motion.span layoutId="log-filter" className="absolute inset-0 rounded-full bg-foreground"
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
          {days.map(([date, list]) => (
            <motion.section
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

              {list.map((e, i) => (
                <Card key={`${e.documentId}-${e.stage}-${e.kind}-${i}`} className="py-0 shadow-sm">
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
              ))}
            </motion.section>
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
