'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArchiveRestore, Archive, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react';

import type { ProjectCard } from '@/lib/projects';
import {
  deleteProjectAction,
  renameProjectAction,
  setActiveProjectAction,
  setProjectArchivedAction,
} from '@/lib/project-actions';
import MiniGantt from './MiniGantt';
import { formatMoney } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Spinner from '@/components/ui/Spinner';

/**
 * The app's first screen.
 *
 * What it is NOT, deliberately: the cross-project money table this page used to
 * be. Plan, actual, deviation, deferred, forecast and status all left — that is
 * a report about projects, and this is the place you keep them. Percentages
 * were the other casualty: a project made five minutes ago read 0.00% in red
 * and looked broken when it was only empty.
 *
 * Row actions run through ONE shared dialog rather than a menu per card. That
 * is the repo's Radix rule — cost is in mounted instances, not in the library —
 * and it happens to be the better answer on a phone anyway, where a 44px list
 * of choices beats a dropdown pinned to a 24px button.
 */
export default function ProjectList({ all }: { all: ProjectCard[] }) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [acting, setActing] = useState<ProjectCard | null>(null);

  const archivedCount = all.filter((p) => p.archivedAt).length;
  const projects = showArchived ? all : all.filter((p) => !p.archivedAt);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.name, p.clientName, p.contractNo].some((v) => v?.toLowerCase().includes(q))
    );
  }, [projects, query]);

  if (all.length === 0) {
    return (
      <div className="animate-enter rounded-xl border border-dashed bg-card p-10 text-center">
        <p className="text-sm font-medium">No projects yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          A project holds its own work breakdown, schedule and reports. Make the first one and
          everything else in the app follows it.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, client, contract"
            aria-label="Search projects"
            className="h-11 pl-9"
          />
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p, i) => (
          <li
            key={p.id}
            className="animate-enter"
            style={{ animationDelay: `${Math.min(i, 7) * 60}ms` }}
          >
            <Card project={p} onActions={() => setActing(p)} />
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="animate-fade-in-up py-8 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="mt-5 h-11 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {showArchived ? 'Hide archived' : `Archived (${archivedCount})`}
        </button>
      )}

      {acting && <ActionsPanel project={acting} onClose={() => setActing(null)} />}
    </>
  );
}

function money(value: number | null, currency: string): string | null {
  // One formatter, in lib/currency.ts. This page is where the bug showed:
  // Gundih is priced in USD and a rupiah formatter turned $5.92M into
  // "Rp 5.920.000" — a figure with the wrong symbol is a wrong number.
  if (value == null || value <= 0) return null;
  return formatMoney(value, currency);
}

function dateRange(start: string | null, finish: string | null): string | null {
  if (!start || !finish) return null;
  const f = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      Date.parse(`${iso}T00:00:00Z`)
    );
  // An arrow rather than a dash: the app already reads a dash as filler, and a
  // range is the one place where the separator is carrying a direction anyway.
  return `${f(start)} → ${f(finish)}`;
}

function Card({ project: p, onActions }: { project: ProjectCard; onActions: () => void }) {
  const value = money(p.contractValue, p.currency);
  const range = dateRange(p.startDate, p.finishDate);

  return (
    // THE WHOLE CARD IS THE LINK, and it is drawn that way rather than wired
    // that way: the title's `after:inset-0` stretches its hit area over the
    // card, so there is still exactly one anchor per card, keyboard focus lands
    // on something real, and no interactive element is nested inside another —
    // which is invalid HTML and the usual reason a clickable card misbehaves on
    // a phone. Everything that must stay separately clickable sits above it on
    // `relative z-10`.
    <div className="group relative flex h-full flex-col rounded-xl border bg-card p-4 transition-all duration-300 ease-ios hover:border-muted-foreground hover:shadow-sm active:scale-[0.995] focus-within:border-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/40">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold uppercase"
        >
          {p.name.trim().charAt(0) || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${p.id}`}
            title={p.name}
            // Three lines, then an ellipsis. Contract titles here run past a
            // hundred characters — the Gundih one took five lines and pushed
            // everything else on the card below the fold.
            className="line-clamp-3 block text-[13px] font-semibold leading-snug outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] group-hover:underline"
          >
            {p.name}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {p.isActive && (
              <span className="rounded bg-foreground px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-background">
                Open
              </span>
            )}
            <span className="truncate">{p.clientName || 'No client named yet'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onActions}
          aria-label={`Actions for ${p.name}`}
          className="relative z-10 grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className="mt-auto pt-5">
        {/* An empty project must read as EMPTY, not broken — so it gets a way
            forward here instead of a bar with nothing in it. */}
        {p.rowCount === 0 ? (
          // A prompt, not a second link. The card already goes here, and two
          // anchors to the same place is one for a screen reader to read twice.
          <span className="flex h-11 items-center justify-center rounded-lg border border-dashed text-xs font-medium text-muted-foreground transition-colors group-hover:border-muted-foreground group-hover:text-foreground">
            Not planned yet. Build the schedule →
          </span>
        ) : (
          <>
            <MiniGantt
              startDate={p.startDate}
              finishDate={p.finishDate}
              totalWeeks={p.weekCount}
            />
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{range ?? 'No dates'}</span>
              <span className="tabular-nums">{p.rowCount} rows</span>
            </div>
          </>
        )}
        {value && (
          <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

/** One instance for the whole list, driven by whichever card asked for it. */
function ActionsPanel({ project: p, onClose }: { project: ProjectCard; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [name, setName] = useState(p.name);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong');
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="animate-enter w-full rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-sm sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Project</p>
        <p className="mt-0.5 text-sm font-semibold leading-snug">{p.name}</p>

        {mode === 'menu' && (
          <div className="mt-3 space-y-1">
            {!p.isActive && !p.archivedAt && (
              <Row onClick={() => run(() => setActiveProjectAction(p.id))} disabled={pending}>
                Open this project
                <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                  the whole app follows
                </span>
              </Row>
            )}
            <Row onClick={() => setMode('rename')} disabled={pending} icon={<Pencil className="size-4" />}>
              Rename
            </Row>
            <Row
              onClick={() => run(() => setProjectArchivedAction(p.id, !p.archivedAt))}
              disabled={pending}
              icon={p.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            >
              {p.archivedAt ? 'Restore from archive' : 'Archive'}
            </Row>
            <Row
              onClick={() => setMode('delete')}
              disabled={pending}
              icon={<Trash2 className="size-4" />}
              danger
            >
              Delete
            </Row>
          </div>
        )}

        {mode === 'rename' && (
          <div className="mt-3 space-y-2">
            <Label htmlFor="rn">New name</Label>
            <Input id="rn" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
            {/* Save leads and Cancel follows, on one row. "Back" was wrong on
                both counts: it named a direction rather than what pressing it
                does, and it sat under the primary where nothing else in this
                app puts a secondary action. */}
            <div className="flex gap-2">
              <Button
                className="h-11 flex-1 gap-1.5"
                disabled={pending || !name.trim() || name.trim() === p.name}
                onClick={() => run(() => renameProjectAction(p.id, name))}
              >
                {pending && <Spinner />}
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setMode('menu')} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mode === 'delete' && (
          <div className="mt-3 space-y-3">
            {/* Naming what disappears, rather than asking "are you sure?". One
                sentence: the paragraph this replaces also explained archiving,
                which is a choice already sitting one row up in the menu. */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Deletes {p.rowCount} work breakdown rows, the schedule, every week of progress and the
              document register. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="h-11 flex-1 gap-1.5"
                disabled={pending}
                onClick={() => run(() => deleteProjectAction(p.id))}
              >
                {pending && <Spinner />}
                {pending ? 'Deleting…' : 'Delete permanently'}
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setMode('menu')} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive animate-fade-in-up">{error}</p>}
      </div>
    </div>
  );
}

function Row({
  children,
  onClick,
  disabled,
  icon,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 ${
        danger ? 'text-destructive hover:bg-muted' : ''
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
