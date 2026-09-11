'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';

import { setActiveProjectAction } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/Spinner';

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

  // Already the open project, so this button has somewhere better to go than
  // nowhere. It used to render a grey pill the size and shape of a button that
  // could not be pressed, which reads as a broken control rather than as a
  // state — and the thing a person wants after opening a project is its
  // numbers, which is the dashboard.
  if (isOpen) {
    return (
      <Button asChild variant="secondary" className="h-11 shrink-0 gap-1.5">
        <Link href="/">
          <Check className="size-4 text-ok" />
          {/* Short on a phone, where this button shares its line with the way
              back and every pixel it takes is a row of the plan you cannot
              see. The sentence is still there on any screen with room. */}
          <span className="sm:hidden">Dashboard</span>
          <span className="hidden sm:inline">Go to dashboard</span>
        </Link>
      </Button>
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
        {pending && <Spinner />}
        {pending ? (
          'Opening…'
        ) : (
          <>
            <span className="sm:hidden">Open</span>
            <span className="hidden sm:inline">Open this project</span>
          </>
        )}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
