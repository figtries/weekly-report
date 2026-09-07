'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { useState, useTransition } from 'react';
import { createDailyAction, refreshDbAction } from '@/lib/actions';

// Rendered on the "no report for this date" card. Besides being a convenient
// entry point, it self-heals a stale cached "not found" page: if the report
// actually exists, the create fails with "already exists" and we force a fresh
// re-render instead, which reveals the real report.
export default function CreateReportHere({ date }: { date: string }) {
  const [creating, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createDailyAction(date);
      if (!res.ok && !res.error.includes('already exists')) {
        setError(res.error);
        return;
      }
      // Created (or already existed): re-render this page from inside a
      // server action, where the expired 'db' tag is guaranteed visible, so
      // the empty state swaps to the actual report.
      await refreshDbAction();
    });
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <m.button {...pressMotion}
        onClick={create}
        disabled={creating}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-chart-1 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-300 ease-ios hover:bg-chart-1/90 hover:shadow-md disabled:opacity-60"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        {creating ? 'Creating…' : `Create report for ${date}`}
      </m.button>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}
