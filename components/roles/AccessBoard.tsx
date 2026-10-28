'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Info, Lock, Plus, Search, SearchX, ShieldCheck } from 'lucide-react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import SoftSheet from '@/components/ui/SoftSheet';
import NativeSelect from '@/components/ui/NativeSelect';
import { CheckBox } from '@/components/ui/CheckBox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TYPE } from '@/lib/design';
import {
  ACCESS_LEVELS,
  AREAS,
  NO_ACCESS,
  ROLES,
  SEED_ACCOUNTS,
  type Access,
  type Account,
  type AccountStatus,
} from '@/lib/roles';
import { cn } from '@/lib/utils';

/**
 * Access per ACCOUNT, not per role (28 Oct 2026). A role is a preset that
 * fills an account's pages in; the account keeps its own copy.
 *
 * A DRAFT, and it says so: with no login nothing here restricts anybody, and
 * a reload puts `lib/roles.ts` back. Changes are made on a copy of the
 * selected account (`draft`) and only land on Save, so a half-made change
 * never shows in the list as if it were done.
 */

type Project = { id: string; name: string };

const PRESETS = ROLES.filter((r) => !r.master);
const STATUS: Record<AccountStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-ok-soft text-ok' },
  invited: { label: 'Invited', cls: 'bg-warn-soft text-warn' },
  suspended: { label: 'Suspended', cls: 'bg-bad-soft text-bad' },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const initials = (n: string) =>
  n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
const presetOf = (key: string | null) => PRESETS.find((r) => r.key === key);
const isCustom = (a: Account) => !a.master && !!presetOf(a.preset) && !same(a.access, presetOf(a.preset)!.access);
const levelOf = (a: Account) =>
  Object.values(a.access).includes('edit') ? 'edit' : Object.values(a.access).includes('view') ? 'view' : 'none';
const validEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

function scopeText(a: Pick<Account, 'projects'>, projects: Project[]) {
  if (a.projects === 'all') return 'All projects';
  if (a.projects.length === 0) return 'No project yet';
  if (a.projects.length === 1) return projects.find((p) => p.id === a.projects[0])?.name ?? '1 project';
  return `${a.projects.length} projects`;
}

/** The split's panel sits beside the list from lg; below it, the panel is a sheet. */
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(min-width: 1024px)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true
  );
}

type Confirm = { title: string; message: string; label: string; onYes: () => void };

export function AccessBoard({ projects }: { projects: Project[] }) {
  const [accounts, setAccounts] = useState<Account[]>(() =>
    SEED_ACCOUNTS.map((s) => ({
      ...s,
      projects: s.projects === 'all' ? 'all' : s.projects.map((i) => projects[i]?.id).filter((x): x is string => !!x),
    }))
  );
  const [selectedId, setSelectedId] = useState<string | null>('u02');
  const [draft, setDraft] = useState<Account | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fProject, setFProject] = useState('');
  const [fLevel, setFLevel] = useState('');
  const wide = useWide();

  const current = accounts.find((a) => a.id === selectedId) ?? null;
  // The draft is the selected account until something is changed.
  const shown = draft && draft.id === selectedId ? draft : current;
  const dirty = !!draft && !!current && draft.id === current.id && !same(draft, current);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        (!s || a.name.toLowerCase().includes(s) || a.email.toLowerCase().includes(s)) &&
        (!fStatus || a.status === fStatus) &&
        (!fProject || a.projects === 'all' || a.projects.includes(fProject)) &&
        (!fLevel || levelOf(a) === fLevel)
    );
  }, [accounts, q, fStatus, fProject, fLevel]);

  const count = (s: AccountStatus) => accounts.filter((a) => a.status === s).length;

  const open = (id: string) => {
    const go = () => {
      setSelectedId(id);
      setDraft(null);
      setSheetOpen(true);
    };
    if (dirty && id !== selectedId) {
      setConfirm({
        title: 'Leave without saving?',
        message: `Your changes to ${current!.name} will be lost.`,
        label: 'Discard changes',
        onYes: go,
      });
    } else go();
  };

  const edit = (patch: Partial<Account>) => shown && setDraft({ ...shown, ...patch });

  const save = () => {
    if (!draft) return;
    setAccounts((as) => as.map((a) => (a.id === draft.id ? draft : a)));
    setDraft(null);
  };

  const toggleStatus = () => {
    if (!shown) return;
    if (shown.status === 'suspended') return edit({ status: 'active' });
    setConfirm({
      title: `Suspend ${shown.name}?`,
      message: 'They are locked out until you reactivate them. Their access is kept.',
      label: 'Suspend',
      onYes: () => edit({ status: 'suspended' }),
    });
  };

  const remove = () => {
    if (!current) return;
    setConfirm({
      title: `Remove ${current.name}?`,
      message: 'The account and its access are deleted. What they entered in reports stays.',
      label: 'Remove',
      onYes: () => {
        setAccounts((as) => as.filter((a) => a.id !== current.id));
        setDraft(null);
        setSelectedId(null);
        setSheetOpen(false);
      },
    });
  };

  const panel = shown && (
    <AccountPanel
      account={shown}
      projects={projects}
      dirty={dirty}
      onEdit={edit}
      onToggleStatus={toggleStatus}
      onRemove={remove}
      onSave={save}
      onDiscard={() => setDraft(null)}
    />
  );

  const filtersOn = !!(q || fStatus || fProject || fLevel);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between animate-enter stagger-1">
        <div className="flex gap-3 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            <span className="mr-1 font-semibold">Draft.</span>
            {"Changes here aren't saved and don't restrict anyone yet. That comes with login."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 ease-ios hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus className="size-4" aria-hidden />
          Add account
        </button>
      </div>

      <section aria-label="Accounts at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4 animate-enter stagger-2">
        <Stat label="Accounts" value={accounts.length} note={`1 Master · ${accounts.length - 1} others`}>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
            <i className="bg-ok" style={{ width: `${(count('active') / accounts.length) * 100}%` }} />
            <i className="bg-warn" style={{ width: `${(count('invited') / accounts.length) * 100}%` }} />
            <i className="bg-bad" style={{ width: `${(count('suspended') / accounts.length) * 100}%` }} />
          </div>
        </Stat>
        <Stat label="Active" dot="bg-ok" value={count('active')} note="Signing in and working" />
        <Stat label="Invited" dot="bg-warn" value={count('invited')} note={count('invited') ? 'Not signed in yet' : 'Nobody waiting'} />
        <Stat label="Suspended" dot="bg-bad" value={count('suspended')} note={count('suspended') ? 'Kept, but locked out' : 'Nobody suspended'} />
      </section>

      <div className="flex flex-wrap gap-2 rounded-xl border bg-card p-3 animate-enter stagger-3">
        <label className="relative min-w-56 flex-[2_1_16rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search accounts by name or email"
            className="h-11 pl-9 sm:h-10"
          />
        </label>
        <NativeSelect aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} wrapperClassName="flex-[1_1_9rem]" className="bg-card pl-3 sm:h-10">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="suspended">Suspended</option>
        </NativeSelect>
        <NativeSelect aria-label="Filter by project" value={fProject} onChange={(e) => setFProject(e.target.value)} wrapperClassName="flex-[1_1_12rem] min-w-0" className="bg-card pl-3 sm:h-10">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by access" value={fLevel} onChange={(e) => setFLevel(e.target.value)} wrapperClassName="flex-[1_1_9rem]" className="bg-card pl-3 sm:h-10">
          <option value="">Any access</option>
          <option value="edit">Can edit something</option>
          <option value="view">View only</option>
        </NativeSelect>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] animate-enter stagger-4">
        <section aria-labelledby="accounts-title" className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="accounts-title" className={TYPE.cardTitle}>Accounts</h2>
            <span className={TYPE.meta}>
              {rows.length === accounts.length ? `${accounts.length} accounts` : `${rows.length} of ${accounts.length}`}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <SearchX className="size-5" aria-hidden />
              </span>
              <p className="font-semibold text-foreground">{filtersOn ? 'Nobody matches' : 'No accounts yet'}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {filtersOn ? 'No account fits this search and these filters.' : 'Add the first person who should use Lucille.'}
              </p>
              {filtersOn && (
                <button
                  type="button"
                  onClick={() => { setQ(''); setFStatus(''); setFProject(''); setFLevel(''); }}
                  className="mt-4 min-h-10 rounded-lg border px-4 text-sm font-semibold hover:bg-muted"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_10rem_6.5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid xl:grid-cols-[minmax(0,1fr)_10rem_6.5rem_6.5rem]">
                <span>Account</span>
                <span>Projects</span>
                <span>Status</span>
                <span className="hidden xl:block">Last active</span>
              </div>
              <ul className="divide-y">
                {rows.map((a) => {
                  const on = a.id === selectedId && (wide || sheetOpen);
                  const p = presetOf(a.preset);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => open(a.id)}
                        aria-current={on || undefined}
                        className={cn(
                          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-ios hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_10rem_6.5rem] xl:grid-cols-[minmax(0,1fr)_10rem_6.5rem_6.5rem]',
                          on && 'bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary-soft'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar account={a} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">{a.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {a.master ? (
                                <span className="rounded-md bg-check-soft px-1.5 py-0.5 text-[11px] font-semibold text-check">Master</span>
                              ) : p ? (
                                <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', isCustom(a) ? 'bg-primary-soft text-primary' : 'bg-muted text-foreground')}>
                                  {p.name}{isCustom(a) ? ' · Custom' : ''}
                                </span>
                              ) : (
                                <span className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary">Custom</span>
                              )}
                              <AccessStrip access={a.access} />
                            </span>
                          </span>
                        </span>
                        <span className="hidden truncate text-sm text-foreground sm:block">{scopeText(a, projects)}</span>
                        <StatusChip status={a.status} />
                        <span className="hidden text-sm text-muted-foreground xl:block">{a.lastActive ?? 'Not yet'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {wide && (
          <aside aria-label="Account access" className="sticky top-4 overflow-hidden rounded-xl border bg-card">
            {panel ?? <p className="px-6 py-14 text-center text-sm text-muted-foreground">Pick an account to see what it can open.</p>}
          </aside>
        )}
      </div>

      {!wide && (
        <SoftSheet open={sheetOpen && !!shown} onClose={() => setSheetOpen(false)} label={shown?.name ?? 'Account'} size="lg" className="p-0">
          {panel}
        </SoftSheet>
      )}

      <AddAccountSheet
        open={adding}
        projects={projects}
        taken={accounts.map((a) => a.email.toLowerCase())}
        onClose={() => setAdding(false)}
        onAdd={(a) => {
          setAccounts((as) => [...as, a]);
          setAdding(false);
          setSelectedId(a.id);
          setDraft(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.label ?? ''}
        onConfirm={() => { confirm?.onYes(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Stat({ label, value, note, dot = 'bg-primary', children }: { label: string; value: number; note: string; dot?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span className={cn('size-2 rounded-full', dot)} aria-hidden />
        {label}
      </p>
      <p className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">{value}</p>
      {children}
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Avatar({ account, big }: { account: Account; big?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg font-semibold',
        big ? 'size-12 text-base' : 'size-10 text-sm',
        account.master ? 'bg-check-soft text-check' : 'bg-primary-soft text-primary'
      )}
      aria-hidden
    >
      {initials(account.name)}
    </span>
  );
}

function StatusChip({ status }: { status: AccountStatus }) {
  return (
    <span className={cn('inline-flex w-[6.5rem] justify-center rounded-md px-2 py-1 text-xs font-semibold', STATUS[status].cls)}>
      {STATUS[status].label}
    </span>
  );
}

/** One short bar per page: blue Edit, pale View, grey none. Read at a glance, spelled out in the panel. */
function AccessStrip({ access }: { access: Account['access'] }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {AREAS.map((a) => (
        <i
          key={a.key}
          className={cn('h-1 w-3 rounded-full', access[a.key] === 'edit' ? 'bg-primary' : access[a.key] === 'view' ? 'bg-primary/35' : 'bg-track')}
        />
      ))}
    </span>
  );
}

function AccountPanel({
  account: a,
  projects,
  dirty,
  onEdit,
  onToggleStatus,
  onRemove,
  onSave,
  onDiscard,
}: {
  account: Account;
  projects: Project[];
  dirty: boolean;
  onEdit: (p: Partial<Account>) => void;
  onToggleStatus: () => void;
  onRemove: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const locked = !!a.master;
  const [pick, setPick] = useState('');
  const p = presetOf(a.preset);
  const canSave = a.name.trim() !== '' && validEmail(a.email);

  return (
    <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
      <div className="overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <Avatar account={a} big />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
              {a.name || 'Unnamed'}
              {locked ? (
                <span className="rounded-md bg-check-soft px-1.5 py-0.5 text-[11px] font-semibold text-check">Master</span>
              ) : (
                <StatusChip status={a.status} />
              )}
            </p>
            <p className="truncate text-sm text-muted-foreground">{a.email}</p>
          </div>
        </div>

        {locked && (
          <div className="mt-4 flex gap-2.5 rounded-lg border border-check/25 bg-check-soft px-3.5 py-3 text-sm text-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-check" aria-hidden />
            <p>This is the Master account. It always has Edit on every page and every project, and it can&apos;t be suspended or removed.</p>
          </div>
        )}

        <h3 className="mt-6 mb-2 text-[13px] font-semibold text-foreground">Account</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={a.name} onChange={(e) => onEdit({ name: e.target.value })} className="h-11 sm:h-10" />
          </Field>
          <Field label="Email">
            <Input type="email" value={a.email} disabled={locked} onChange={(e) => onEdit({ email: e.target.value })} className="h-11 sm:h-10" />
          </Field>
        </div>
        {!locked && (
          <div className="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5">
            <span>
              <span className="block text-sm font-semibold text-foreground">{a.status === 'suspended' ? 'Suspended' : 'Can sign in'}</span>
              <span className="block text-xs text-muted-foreground">
                {a.status === 'invited' ? 'Invite sent, not signed in yet' : a.status === 'suspended' ? 'Locked out. Access below is kept.' : 'Signs in and uses the pages below'}
              </span>
            </span>
            <Switch checked={a.status !== 'suspended'} onCheckedChange={onToggleStatus} aria-label="Account can sign in" />
          </div>
        )}

        <div className="mt-6 mb-2 flex items-center justify-between gap-3">
          <h3 className="shrink-0 text-[13px] font-semibold text-foreground">Projects</h3>
          <span className={cn(TYPE.meta, 'min-w-0 truncate')}>{scopeText(a, projects)}</span>
        </div>
        <ProjectScope value={a.projects} projects={projects} locked={locked} onChange={(projects) => onEdit({ projects })} />

        <div className="mt-6 mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">Page access</h3>
          {p && !locked && (
            <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', isCustom(a) ? 'bg-primary-soft text-primary' : 'bg-muted text-foreground')}>
              {p.name}{isCustom(a) ? ' · Custom' : ''}
            </span>
          )}
        </div>
        {!locked && (
          <div className="mb-3 flex flex-wrap gap-2">
            <NativeSelect aria-label="Preset" value={pick} onChange={(e) => setPick(e.target.value)} wrapperClassName="flex-[1_1_10rem]" className="bg-card pl-3 sm:h-9">
              <option value="">Choose a preset</option>
              {PRESETS.map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </NativeSelect>
            <button
              type="button"
              disabled={!pick}
              onClick={() => { onEdit({ preset: pick, access: { ...presetOf(pick)!.access } }); setPick(''); }}
              className="min-h-11 rounded-lg border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50 sm:min-h-9"
            >
              Apply preset
            </button>
            <button
              type="button"
              disabled={!isCustom(a)}
              onClick={() => onEdit({ access: { ...p!.access } })}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary-soft disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-transparent sm:min-h-9"
            >
              Reset to default
            </button>
          </div>
        )}
        <AccessMatrix access={a.access} locked={locked} label={a.name} onChange={(k, v) => onEdit({ access: { ...a.access, [k]: v } })} />

        {!locked && (
          <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
            {a.status === 'suspended' ? (
              <button type="button" onClick={onToggleStatus} className="min-h-11 rounded-lg border px-3 text-sm font-semibold hover:bg-muted sm:min-h-9">
                Reactivate
              </button>
            ) : (
              <button type="button" onClick={onToggleStatus} className="min-h-11 rounded-lg border border-bad/30 px-3 text-sm font-semibold text-bad hover:bg-bad-soft sm:min-h-9">
                Suspend
              </button>
            )}
            <button type="button" onClick={onRemove} className="min-h-11 rounded-lg border border-bad/30 px-3 text-sm font-semibold text-bad hover:bg-bad-soft sm:min-h-9">
              Remove account
            </button>
          </div>
        )}
      </div>

      {dirty && (
        <div role="region" aria-label="Unsaved changes" className="flex items-center justify-between gap-3 border-t bg-card px-5 py-3 animate-fade-in-up">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden />
            {canSave ? 'Unsaved changes' : 'Name and a valid email are needed'}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onDiscard} className="min-h-11 rounded-lg border px-3 text-sm font-semibold hover:bg-muted sm:min-h-9">
              Discard
            </button>
            <button type="button" disabled={!canSave} onClick={onSave} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50 sm:min-h-9">
              Save
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ProjectScope({ value, projects, locked, onChange }: { value: Account['projects']; projects: Project[]; locked: boolean; onChange: (v: Account['projects']) => void }) {
  const all = value === 'all';
  const row = 'flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 text-sm';
  return (
    <div className="divide-y rounded-lg border">
      <label className={cn(row, 'font-semibold', locked && 'cursor-not-allowed')}>
        <CheckBox checked={all} disabled={locked} onChange={() => onChange(all ? [] : 'all')} />
        All projects
      </label>
      {projects.map((p) => (
        <label key={p.id} className={cn(row, (locked || all) && 'cursor-not-allowed text-muted-foreground')}>
          <CheckBox
            checked={all || value.includes(p.id)}
            disabled={locked || all}
            onChange={() => !all && onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])}
          />
          <span className="min-w-0">{p.name}</span>
        </label>
      ))}
    </div>
  );
}

/** No access / View / Edit per page, native buttons (seven rows, one panel). */
function AccessMatrix({ access, locked, label, onChange }: { access: Account['access']; locked: boolean; label: string; onChange: (k: keyof Account['access'], v: Access) => void }) {
  return (
    // Sized by its own width, not the screen's: the side panel is narrow on a wide screen.
    <ul className="@container divide-y rounded-lg border">
      {AREAS.map((area) => (
        <li key={area.key} className="flex flex-col gap-2 px-3.5 py-2.5 @lg:flex-row @lg:items-center @lg:justify-between">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{area.label}</span>
            <span className="block text-xs text-muted-foreground">Edit: {area.edit}</span>
          </span>
          {locked ? (
            <span className="flex min-h-9 items-center gap-1.5 text-sm font-medium text-check">
              <Lock className="size-3.5" aria-hidden />
              Always Edit
            </span>
          ) : (
            <div role="radiogroup" aria-label={`${label}, ${area.label}`} className="grid shrink-0 grid-cols-3 rounded-lg border bg-muted/50 p-0.5">
              {ACCESS_LEVELS.map((lvl) => {
                const on = access[area.key] === lvl.key;
                return (
                  <button
                    key={lvl.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onChange(area.key, lvl.key)}
                    className={cn(
                      'min-h-11 rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150 ease-ios active:scale-[0.97] sm:min-h-9',
                      on
                        ? lvl.key === 'edit'
                          ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                          : lvl.key === 'view'
                            ? 'bg-card font-semibold text-primary shadow-sm'
                            : 'bg-card font-semibold text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {lvl.label}
                  </button>
                );
              })}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddAccountSheet({
  open,
  projects,
  taken,
  onClose,
  onAdd,
}: {
  open: boolean;
  projects: Project[];
  taken: string[];
  onClose: () => void;
  onAdd: (a: Account) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [preset, setPreset] = useState('');
  const [scope, setScope] = useState<Account['projects']>([]);
  const [access, setAccess] = useState<Account['access']>(NO_ACCESS);
  const [error, setError] = useState('');

  const reset = () => { setName(''); setEmail(''); setPreset(''); setScope([]); setAccess(NO_ACCESS); setError(''); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Type a name first.');
    if (!validEmail(email)) return setError('Type a valid email.');
    if (taken.includes(email.trim().toLowerCase())) return setError('That email already has an account.');
    onAdd({
      id: `u${Date.now().toString(36)}`,
      name: name.trim(),
      email: email.trim(),
      preset: preset || null,
      status: 'invited',
      lastActive: null,
      projects: scope,
      access,
    });
  };

  return (
    <SoftSheet open={open} onClose={onClose} onExited={reset} label="Add account" size="lg" className="px-5 pb-5 sm:p-6">
      <form onSubmit={submit} noValidate>
        <h2 className="text-lg font-semibold text-foreground">Add account</h2>
        <p className="mt-1 text-sm text-muted-foreground">They get an invite by email and show as Invited until they sign in.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} className="h-11 sm:h-10" autoComplete="off" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} className="h-11 sm:h-10" autoComplete="off" />
          </Field>
        </div>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-bad">{error}</p>}

        <div className="mt-4">
          <Field label="Start from a preset (optional)">
            <NativeSelect
              aria-label="Preset"
              value={preset}
              onChange={(e) => { setPreset(e.target.value); setAccess(e.target.value ? { ...presetOf(e.target.value)!.access } : NO_ACCESS); }}
              className="bg-card pl-3 sm:h-10"
            >
              <option value="">No preset, set by hand</option>
              {PRESETS.map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <h3 className="mt-5 mb-2 text-[13px] font-semibold text-foreground">Projects</h3>
        <ProjectScope value={scope} projects={projects} locked={false} onChange={setScope} />

        <h3 className="mt-5 mb-2 text-[13px] font-semibold text-foreground">Page access</h3>
        <AccessMatrix access={access} locked={false} label={name || 'New account'} onChange={(k, v) => setAccess({ ...access, [k]: v })} />

        <div className="mt-6 flex gap-2">
          <button type="submit" className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
            Send invite
          </button>
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm font-semibold hover:bg-muted">
            Cancel
          </button>
        </div>
      </form>
    </SoftSheet>
  );
}
