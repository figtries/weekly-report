'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { m } from 'framer-motion';
import { deleteProjectAction } from '@/lib/actions';
import { pressMotion } from '@/components/motion/Press';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

/**
 * Deleting a project, on the row that names it.
 *
 * It used to be a bare underlined "Delete this project" sitting under the
 * sidebar switcher on EVERY screen, guarded by nothing but `window.confirm`.
 * Here it is one row's own action, it never appears for the last remaining
 * project (the workspace must keep one), and it goes through the app's own
 * ConfirmDialog, which states what is lost.
 *
 * ConfirmDialog renders nothing until it is opened, so a row costs a button.
 */
export default function DeleteProjectButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectAction(id);
      if (!res.ok) {
        setError(res.error);
        setOpen(false);
        return;
      }
      setOpen(false);
      router.push('/projects');
    });
  }

  return (
    <>
      <m.button
        {...pressMotion}
        onClick={() => setOpen(true)}
        disabled={pending}
        aria-label={`Delete project ${name}`}
        title="Delete project"
        className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-300 ease-ios hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        <Trash2 className="size-4" />
      </m.button>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <ConfirmDialog
        open={open}
        title="Delete this project?"
        message={
          <>
            <strong>{name}</strong> and everything filed under it — every week, every daily report,
            every document — is removed for good. This cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        busyLabel="Deleting…"
        busy={pending}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
