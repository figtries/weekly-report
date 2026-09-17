'use client';

import { useState } from 'react';
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
 *
 * **Pressing it LEAVES, and it leaves for Data Overall.** It used to call
 * `router.refresh()` and stay, which billed the wait twice over: the refresh
 * re-rendered the page you were already looking at — on Gundih that is 285 rows
 * and a Gantt, the heaviest render in the app — and then the only thing left to
 * do was press a second button and wait again. Measured on a warm dev server it
 * was 462 ms to settle and 665 ms more to reach the dashboard, for a screen
 * nobody had asked for. Now the press does one trip, and it ends on the map you
 * open a project to fill in.
 *
 * **The week is resolved by the ACTION, not by a redirect.** Pushing to
 * `/weekly` and letting its index work the week out is a second round trip
 * spent on an empty main area — 475 ms of it, measured. `setActiveProjectAction`
 * returns the number instead, through `currentWeekForProject`, so the press
 * goes straight to `/weekly/N/overall` and that route's own `loading.tsx`
 * covers the rest of the wait. `/weekly` stays as the fallback and as the
 * already-open link, which is the same door the sidebar and `NoLegacyData` use
 * when nothing on screen names a week: the rule for which week a project is in
 * lives in `currentWeekOf` and is never guessed twice.
 */
const DATA_OVERALL = '/weekly';

export default function OpenProjectButton({
  id,
  isOpen,
  /**
   * The week Data Overall opens on, when the page already knows it — which is
   * only when this project is the open one. Null means ask `/weekly`.
   */
  openWeek = null,
}: {
  id: string;
  isOpen: boolean;
  openWeek?: number | null;
}) {
  const router = useRouter();
  // Deliberately NOT `useTransition`. The pending flag has to outlive the
  // action and cover the navigation as well, and a transition that wraps
  // `router.push` holds the OLD page on screen until the new one is fully
  // ready — so the route's own `loading.tsx` never gets to paint and the press
  // reads as a freeze. Plain state hands the navigation to Next, which commits
  // it at once and shows the skeleton; this component unmounts with the page it
  // was on, so the spinner never has to be turned off.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already the open project, so this button has somewhere better to go than
  // nowhere. It used to render a grey pill the size and shape of a button that
  // could not be pressed, which reads as a broken control rather than as a
  // state — and the thing a person wants after opening a project is the screen
  // the project is worked on, which is Data Overall.
  if (isOpen) {
    return (
      <Button asChild variant="secondary" className="h-11 shrink-0 gap-1.5">
        <Link href={openWeek ? `/weekly/${openWeek}/overall` : DATA_OVERALL}>
          <Check className="size-4 text-ok" />
          {/* Short on a phone, where this button shares its line with the way
              back and every pixel it takes is a row of the plan you cannot
              see. The sentence is still there on any screen with room. */}
          <span className="sm:hidden">Data Overall</span>
          <span className="hidden sm:inline">Go to Data Overall</span>
        </Link>
      </Button>
    );
  }

  return (
    <div className="shrink-0">
      <Button
        className="h-11"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await setActiveProjectAction(id);
          if (!res.ok) {
            setError(res.error);
            setPending(false);
            return;
          }
          router.push(res.week ? `/weekly/${res.week}/overall` : DATA_OVERALL);
        }}
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
