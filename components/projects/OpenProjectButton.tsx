'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

import { setActiveProjectAction } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';

/**
 * Opening a project is not the same as looking at one.
 *
 * Reaching this page shows you the project. Pressing this points the REST of
 * the app at it — dashboard, weekly progress, daily, reports and document
 * control all follow. The two are separated on purpose: the pointer is global
 * and there is no login yet, so if merely glancing at a neighbouring project
 * moved everyone's context, someone filling in a weekly report would have the
 * ground move under them.
 */
export default function OpenProjectButton({ id, isOpen }: { id: string; isOpen: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (isOpen) {
    return (
      <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium">
        <Check className="size-4" />
        Open in the app
      </span>
    );
  }

  return (
    <div className="shrink-0">
      <Button
        className="h-11"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await setActiveProjectAction(id);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {pending ? 'Opening…' : 'Open this project'}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
