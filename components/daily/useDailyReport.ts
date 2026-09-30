'use client';

import { useCallback, useRef, useState } from 'react';
import { patchDailyAction } from '@/lib/actions';
import type { DailyPatch, DailyReport, LogEntry } from '@/lib/types';

export type LogDraft = Pick<LogEntry, 'kind' | 'text'>;
export type Commit = (patch: DailyPatch, log?: LogDraft) => void;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Changes made while a write is in flight, merged into the one write that follows it. */
interface Batch {
  patch: DailyPatch;
  logs: LogEntry[];
  /** The report as it was BEFORE the first change in this batch: what a failure puts back. */
  before: DailyReport;
  /** How many changes it holds, for the "Saving" count. */
  count: number;
}

const merge = (a: DailyPatch, b: DailyPatch): DailyPatch => ({
  ...a,
  ...b,
  confirmed: a.confirmed || b.confirmed ? { ...a.confirmed, ...b.confirmed } : undefined,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The screen's one copy of the report.
 *
 * A change shows at once and is written in the background. ONE WRITE IS IN
 * FLIGHT AT A TIME (the store is single-writer: two can land out of order), and
 * whatever is changed meanwhile is merged into the next write instead of queuing
 * a round trip per tap. A write that fails puts back exactly what its batch
 * changed and leaves a "Try again". Refs are only touched in handlers, never in
 * render.
 */
export function useDailyReport(initial: DailyReport) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<{ patch: DailyPatch; logs: LogEntry[] } | null>(null);
  const latest = useRef(initial);
  const failedRef = useRef<{ patch: DailyPatch; logs: LogEntry[] } | null>(null);
  const inFlight = useRef(false);
  const waiting = useRef<Batch | null>(null);

  const markFailed = useCallback((f: { patch: DailyPatch; logs: LogEntry[] } | null) => {
    failedRef.current = f;
    setFailed(f);
  }, []);

  // One loop, not a recursion: while a write is out, `run` only merges into
  // `waiting`, and this picks the merged batch up when the write returns. The
  // last check of `waiting` and the reset of `inFlight` have no await between
  // them, so a change can never be left sitting unwritten.
  const pump = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      while (waiting.current) {
        const b = waiting.current;
        waiting.current = null;
        try {
          const res = await patchDailyAction(b.before.date, b.patch, b.logs);
          if (!res.ok) throw new Error(res.error);
          markFailed(null);
        } catch {
          // Put back only what this batch changed.
          const cur = { ...latest.current } as unknown as Record<string, unknown>;
          for (const k of Object.keys(b.patch)) cur[k] = (b.before as unknown as Record<string, unknown>)[k];
          const ids = new Set(b.logs.map((l) => l.id));
          cur.log = (latest.current.log ?? []).filter((e) => !ids.has(e.id));
          latest.current = cur as unknown as DailyReport;
          setReport(latest.current);
          markFailed({ patch: b.patch, logs: b.logs });
        } finally {
          setPending((n) => n - b.count);
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [markFailed]);

  const run = useCallback(
    (patch: DailyPatch, logs: LogEntry[]) => {
      const before = latest.current;
      latest.current = {
        ...before,
        ...patch,
        confirmed: patch.confirmed ? { ...before.confirmed, ...patch.confirmed } : before.confirmed,
        log: logs.length ? [...(before.log ?? []), ...logs] : before.log,
      };
      setReport(latest.current);
      setPending((n) => n + 1);
      const w = waiting.current;
      waiting.current = w
        ? { patch: merge(w.patch, patch), logs: [...w.logs, ...logs], before: w.before, count: w.count + 1 }
        : { patch, logs, before, count: 1 };
      void pump();
    },
    [pump]
  );

  const commit = useCallback<Commit>(
    (patch, draft) =>
      run(patch, draft ? [{ id: newId('log'), at: new Date().toISOString(), ...draft }] : []),
    [run]
  );

  const retry = useCallback(() => {
    const f = failedRef.current;
    if (f) run(f.patch, f.logs);
  }, [run]);

  // Photos are written by their own route; the screen only mirrors the list.
  const setPhotos = useCallback((photos: (string | null)[]) => {
    latest.current = { ...latest.current, photos };
    setReport(latest.current);
  }, []);

  /** Resolves true when every change has been written and none failed. For the PDF button and Back. */
  const flush = useCallback(async () => {
    while (inFlight.current || waiting.current) await sleep(40);
    return failedRef.current === null;
  }, []);

  return { report, commit, retry, failed, pending, setPhotos, flush };
}
