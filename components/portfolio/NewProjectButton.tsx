'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createProjectAction } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Creating a project lives here, on the page that lists them — not on the
 * sidebar card, where a bare "+" beside a select was the whole affordance.
 *
 * The name is asked for inline rather than in a dialog: it is one field, and
 * the wizard it hands over to is the real form.
 */
export default function NewProjectButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      setOpen(false);
      router.push('/setup');
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="h-11 gap-1.5 self-start">
        <Plus className="size-4" />
        New project
      </Button>
    );
  }

  return (
    <div className="animate-fade-in-up w-full sm:w-80">
      <div className="flex gap-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) create();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Project name"
          aria-label="Project name"
          className="h-11"
        />
        <Button className="h-11" onClick={create} disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
        <Button variant="ghost" className="h-11" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
