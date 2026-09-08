'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { m } from 'framer-motion';
import { switchProjectAction } from '@/lib/actions';
import { pressMotion } from '@/components/motion/Press';

/**
 * Switching projects, on the row that names the project.
 *
 * This replaced the sidebar's `<select>`: here the choice is made against a
 * full row — name, customer, week, progress, status — instead of a truncated
 * strip in a dropdown the browser draws its own way.
 */
export default function SwitchProjectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const res = await switchProjectAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Week numbers don't carry across projects, so land on the new project's
      // own dashboard rather than keeping a week that may not exist there.
      router.push('/');
    });
  }

  return (
    <>
      <m.button
        {...pressMotion}
        onClick={open}
        disabled={pending}
        aria-label={`Switch to ${name}`}
        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium text-foreground transition-colors duration-300 ease-ios hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
      >
        {pending && <Loader2 className="size-3.5 animate-spin" />}
        {pending ? 'Switching…' : 'Switch'}
      </m.button>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
    </>
  );
}
