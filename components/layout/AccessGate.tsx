'use client';

import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';

import { AREAS } from '@/lib/roles';
import { areaOf, canOpen, useCurrentAccount } from '@/lib/signed-in';

/*
 * A page whose Roles row is No access for the signed-in account is covered,
 * with what to do about it (29 Oct 2026). A SIBLING of the page, never a
 * wrapper: swapping the page's parent after hydration would remount it. Drawn
 * only once mounted, which keeps `usePathname()` off the prerender (the note
 * above `ActiveLinks` in Sidebar.tsx). A cover, not protection: the draft's
 * accounts live in the browser (`lib/signed-in.ts`).
 */
export function AccessGate() {
  const live = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  return live ? <Cover /> : null;
}

function Cover() {
  const area = areaOf(usePathname() ?? '');
  const account = useCurrentAccount();
  if (canOpen(account, area)) return null;
  const label = AREAS.find((a) => a.key === area)?.label ?? 'this page';
  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-30 flex items-center justify-center bg-background px-6 lg:left-64 lg:top-0 print:hidden">
      <div className="max-w-sm text-center animate-fade-in-up">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">No access to {label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {account?.status === 'suspended'
            ? 'This account is suspended. Ask your Master to reactivate it.'
            : `Your account can't open ${label}. Ask your Master to give you access on Roles.`}
        </p>
      </div>
    </div>
  );
}
