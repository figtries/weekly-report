'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { createProjectAction } from '@/lib/project-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DateField from '@/components/ui/DateField';

/**
 * Four fields, one screen, one Save — not a wizard.
 *
 * The old flow asked for a name and dropped you into a five-step setup. What it
 * produced was a dead row: a project with no dates has no weeks, and a project
 * with no weeks cannot be opened into anything. Dates are the difference
 * between a project that exists and one that merely has a name, so they are
 * asked here and nothing else is.
 *
 * The finish date is asked for too, and that is the point of it: the schedule
 * gets a span before the first row is typed, so the Gantt has a shape to draw
 * against instead of growing out of nothing.
 *
 * Everything else — contractor, contract numbers, currency, prices — belongs to
 * the project's own page, where there is a project to hang it on.
 */
export default function NewProjectDialog() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [start, setStart] = useState('');
  const [finish, setFinish] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ready = name.trim() !== '' && start !== '' && finish !== '';

  function reset() {
    setName('');
    setClient('');
    setStart('');
    setFinish('');
    setError(null);
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction({
        name,
        clientName: client,
        startDate: start,
        finishDate: finish,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      setOpen(false);
      router.push(`/projects/${res.id}`);
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
    <div className="animate-enter w-full rounded-xl border bg-card p-4 shadow-sm sm:w-[26rem]">
      <h2 className="text-sm font-semibold">New project</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Four things now. The work breakdown, the prices and the schedule come next, on the
        project&apos;s own page.
      </p>

      <div className="mt-3 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="np-name">Project name</Label>
          <Input
            id="np-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Relocation of 2 GTG units"
            className="h-11"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="np-client">Client</Label>
          <Input
            id="np-client"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="Who the work is for"
            className="h-11"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="np-start">Starts</Label>
            <DateField id="np-start" value={start} onChange={setStart} className="h-11 w-full" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="np-finish">Finishes</Label>
            <DateField id="np-finish" value={finish} onChange={setFinish} className="h-11 w-full" />
          </div>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive animate-fade-in-up">{error}</p>}

      <div className="mt-4 flex gap-2">
        <Button className="h-11 flex-1" onClick={create} disabled={pending || !ready}>
          {pending ? 'Creating…' : 'Create project'}
        </Button>
        <Button
          variant="ghost"
          className="h-11"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
