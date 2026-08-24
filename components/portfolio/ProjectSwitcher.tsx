'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createProjectAction, deleteProjectAction, switchProjectAction } from '@/lib/actions';
import type { ProjectSummary } from '@/lib/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Switching between projects.
 *
 * A plain `<select>`, not a Radix dropdown: this sits in the sidebar on every
 * page including the phone layout, and on iOS a native select opens the system
 * picker — which is both faster and the control people already know.
 */
export default function ProjectSwitcher({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const active = projects.find((p) => p.isActive);

  function switchTo(id: string) {
    if (id === active?.id) return;
    setError(null);
    startTransition(async () => {
      const res = await switchProjectAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Week numbers don't carry across projects, so land on the new project's
      // own current week rather than keeping a week that may not exist there.
      router.push('/');
    });
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createProjectAction(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      setAdding(false);
      router.push('/setup');
    });
  }

  function remove(id: string, label: string) {
    if (!confirm(`Hapus proyek “${label}” beserta seluruh datanya? Tindakan ini tidak bisa dibatalkan.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteProjectAction(id);
      if (!res.ok) setError(res.error);
      else router.push('/');
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <select
          value={active?.id ?? ''}
          onChange={(e) => switchTo(e.target.value)}
          disabled={pending}
          aria-label="Pilih proyek"
          className="h-8 min-w-0 flex-1 truncate rounded-md border bg-background px-2 text-xs outline-none transition-colors duration-150 ease-ios focus:border-primary/60 disabled:opacity-50"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setAdding((v) => !v)}
          disabled={pending}
          aria-label="Tambah proyek"
          title="Tambah proyek"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 ease-ios hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          +
        </button>
      </div>

      {adding && (
        <div className="animate-fade-in-up space-y-1.5 rounded-md border bg-card p-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()}
            placeholder="Nama proyek baru"
            className="h-8 text-xs"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 flex-1 text-xs" onClick={create} disabled={pending || !name.trim()}>
              Buat &amp; setup
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Batal
            </Button>
          </div>
        </div>
      )}

      {active && projects.length > 1 && (
        <button
          onClick={() => remove(active.id, active.name)}
          disabled={pending}
          className="text-[11px] text-muted-foreground underline-offset-2 transition-colors duration-150 ease-ios hover:text-destructive hover:underline disabled:opacity-50"
        >
          Hapus proyek ini
        </button>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
