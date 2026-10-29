'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, Lock, Plus, Search, SearchX, ShieldCheck, Trash2, X } from 'lucide-react';

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
  accessSummary,
  type Access,
  type Account,
  type AccountStatus,
  type Role,
} from '@/lib/roles';
import { DEMO_PASSWORD, saveAccounts, saveRoles, seedAccounts, useRoles, useStoredAccounts } from '@/lib/signed-in';
import { cn } from '@/lib/utils';

/**
 * Access per ACCOUNT, not per role (28 Oct 2026). A role is a preset that
 * fills an account's pages in; the account keeps its own copy.
 *
 * Saved in this browser (`lib/signed-in.ts`, 29 Oct 2026), where it is also
 * what the demo sign-in checks against. The Master sets each account's
 * password and edits the roles themselves (Roles tab). Changes are made on a
 * copy (`draft`) and only land on Save, so a half-made change never shows in
 * the list as if it were done.
 */

type Project = { id: string; name: string };
type Confirm = { title: string; message: string; label: string; onYes: () => void };

// One size for the three filters, small enough that "Project" fits at 390px.
const FILTER = 'bg-card pl-3 pr-8 text-sm sm:h-9';

const STATUS: Record<AccountStatus, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-ok-soft text-ok' },
  invited: { label: 'Invited', cls: 'bg-warn-soft text-warn' },
  suspended: { label: 'Suspended', cls: 'bg-bad-soft text-bad' },
};
const SHORT: Record<Access, string> = { none: 'None', view: 'View', edit: 'Edit' };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const initials = (n: string) =>
  n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
const roleOf = (roles: Role[], key: string | null) => roles.find((r) => r.key === key);
const isCustom = (a: Account, roles: Role[]) => {
  const r = roleOf(roles, a.preset);
  return !a.master && !!r && !same(a.access, r.access);
};
const levelOf = (a: Account) =>
  Object.values(a.access).includes('edit') ? 'edit' : Object.values(a.access).includes('view') ? 'view' : 'none';
const validEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());
const MIN_PASSWORD = 6;

function makePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => chars[x % chars.length]).join('');
}

function scopeText(a: Pick<Account, 'projects'>, projects: Project[]) {
  if (a.projects === 'all') return 'All projects';
  if (a.projects.length === 0) return 'No project yet';
  if (a.projects.length === 1) return projects.find((p) => p.id === a.projects[0])?.name ?? '1 project';
  return `${a.projects.length} projects`;
}


const BTN = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors duration-150 ease-ios active:scale-[0.98] disabled:opacity-50 sm:min-h-9';
const BTN_PRIMARY = cn(BTN, 'bg-primary text-primary-foreground hover:bg-primary-hover');
const BTN_OUTLINE = cn(BTN, 'border bg-card hover:bg-muted');
const BTN_DANGER = cn(BTN, 'border border-bad/30 bg-card text-bad hover:bg-bad-soft');

export function AccessBoard({ projects }: { projects: Project[] }) {
  const stored = useStoredAccounts();
  const seed = useMemo(() => seedAccounts(projects.map((p) => p.id)), [projects]);
  const accounts = stored ?? seed;
  const roles = useRoles();
  const [tab, setTab] = useState<'accounts' | 'roles'>('accounts');

  const tabs = (
    <div role="tablist" aria-label="Access management" className="inline-flex rounded-lg border bg-muted/50 p-0.5">
      {([['accounts', 'Accounts', accounts.length], ['roles', 'Roles', roles.length]] as const).map(([key, label, n]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setTab(key)}
          className={cn(
            'min-h-11 rounded-md px-3.5 text-sm font-semibold transition-colors duration-150 ease-ios sm:min-h-9 sm:px-4',
            tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
          <span className={cn('ml-1.5 tabular-nums', tab === key ? 'text-primary' : 'text-muted-foreground')}>{n}</span>
        </button>
      ))}
    </div>
  );

  // Both stay mounted, so switching tabs never drops an unsaved draft.
  return (
    <div className="space-y-4 animate-enter stagger-1">
      <div className={cn(tab !== 'accounts' && 'hidden')}>
        <AccountsView tabs={tabs} accounts={accounts} roles={roles} projects={projects} />
      </div>
      <div className={cn(tab !== 'roles' && 'hidden')}>
        <RolesView tabs={tabs} accounts={accounts} roles={roles} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- accounts */

function AccountsView({ tabs, accounts, roles, projects }: { tabs: React.ReactNode; accounts: Account[]; roles: Role[]; projects: Project[] }) {
  const [selectedId, setSelectedId] = useState<string | null>('u02');
  const [draft, setDraft] = useState<Account | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fProject, setFProject] = useState('');
  const [fLevel, setFLevel] = useState('');

  const current = accounts.find((a) => a.id === selectedId) ?? null;
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
  const filtersOn = !!(q || fStatus || fProject || fLevel);

  const open = (id: string) => {
    const go = () => {
      setSelectedId(id);
      setDraft(null);
      setSheetOpen(true);
    };
    if (dirty && id !== selectedId)
      setConfirm({ title: 'Leave without saving?', message: `Your changes to ${current!.name} will be lost.`, label: 'Discard changes', onYes: go });
    else go();
  };

  const edit = (patch: Partial<Account>) => shown && setDraft({ ...shown, ...patch });

  const toggleStatus = () => {
    if (!shown) return;
    if (shown.status === 'suspended') return edit({ status: 'active' });
    setConfirm({
      title: `Suspend ${shown.name}?`,
      message: 'They are locked out until you turn sign-in back on. Their access is kept.',
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
        saveAccounts(accounts.filter((a) => a.id !== current.id));
        setDraft(null);
        setSelectedId(null);
        setSheetOpen(false);
        toast.success('Account removed', { description: current.name });
      },
    });
  };

  const panel = shown && (
    <AccountPanel
      account={shown}
      roles={roles}
      projects={projects}
      dirty={dirty}
      onEdit={edit}
      onToggleStatus={toggleStatus}
      onRemove={remove}
      onSave={() => {
        if (!draft) return;
        saveAccounts(accounts.map((a) => (a.id === draft.id ? draft : a)));
        setDraft(null);
        setSheetOpen(false);
        toast.success('Changes saved', { description: draft.name });
      }}
      onDiscard={() => {
        setDraft(null);
        setSheetOpen(false);
        toast('Changes discarded');
      }}
      onClose={() => setSheetOpen(false)}
    />
  );

  const stats: { label: string; value: number; note: string; dot: string }[] = [
    { label: 'Accounts', value: accounts.length, note: `1 Master · ${accounts.length - 1} others`, dot: 'bg-primary' },
    { label: 'Active', value: count('active'), note: 'Signing in and working', dot: 'bg-chart-3' },
    { label: 'Invited', value: count('invited'), note: count('invited') ? 'Not signed in yet' : 'Nobody waiting', dot: 'bg-chart-1' },
    { label: 'Suspended', value: count('suspended'), note: count('suspended') ? 'Kept, but locked out' : 'Nobody suspended', dot: 'bg-chart-5/45' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {tabs}
        <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>
          <Plus className="size-4" aria-hidden />
          Add account
        </button>
      </div>

      <section aria-label="Accounts at a glance" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 bg-card px-4 py-3 sm:px-5 sm:py-4">
            <p className="flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground sm:text-[13px]">
              <span className={cn('size-2 shrink-0 rounded-full', s.dot)} aria-hidden />
              {s.label}
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{s.value}</p>
            <p className="truncate text-xs text-muted-foreground">{s.note}</p>
          </div>
        ))}
      </section>

      <Split
        sheetOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label={shown?.name ?? 'Account'}
        panel={panel}
        list={
          <section aria-labelledby="accounts-title" className="overflow-hidden rounded-xl border bg-card">
            <div className="space-y-2.5 border-b p-3 sm:px-4">
              <div className="flex items-center justify-between">
                <h2 id="accounts-title" className={TYPE.cardTitle}>Accounts</h2>
                <span className={TYPE.meta}>{rows.length === accounts.length ? `${accounts.length} accounts` : `${rows.length} of ${accounts.length}`}</span>
              </div>
              <div className="grid gap-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search accounts by name or email" className="h-11 pl-9 sm:h-9" />
                </label>
                <div className="grid grid-cols-3 gap-2 xl:contents">
                  <NativeSelect aria-label="Filter by status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} wrapperClassName="min-w-0" className={FILTER}>
                    <option value="">Status</option>
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="suspended">Suspended</option>
                  </NativeSelect>
                  <NativeSelect aria-label="Filter by project" value={fProject} onChange={(e) => setFProject(e.target.value)} wrapperClassName="min-w-0" className={FILTER}>
                    <option value="">Project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </NativeSelect>
                  <NativeSelect aria-label="Filter by access" value={fLevel} onChange={(e) => setFLevel(e.target.value)} wrapperClassName="min-w-0" className={FILTER}>
                    <option value="">Level</option>
                    <option value="edit">Can edit</option>
                    <option value="view">View only</option>
                  </NativeSelect>
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <SearchX className="size-5" aria-hidden />
                </span>
                <p className="font-semibold text-foreground">{filtersOn ? 'Nobody matches' : 'No accounts yet'}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {filtersOn ? 'No account fits this search and these filters.' : 'Add the first person who should use Lucille.'}
                </p>
                {filtersOn && (
                  <button type="button" onClick={() => { setQ(''); setFStatus(''); setFProject(''); setFLevel(''); }} className={cn(BTN_OUTLINE, 'mt-4')}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <ul className="divide-y">
                {rows.map((a) => {
                  const on = a.id === selectedId && sheetOpen;
                  const r = roleOf(roles, a.preset);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => open(a.id)}
                        aria-current={on || undefined}
                        className={cn(
                          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-ios hover:bg-muted/40 sm:px-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]',
                          on && 'bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary-soft'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar account={a} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{a.name}</span>
                              <RoleChip account={a} role={r} custom={isCustom(a, roles)} className="max-sm:hidden" />
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                            <RoleChip account={a} role={r} custom={isCustom(a, roles)} className="mt-1 inline-block max-w-full sm:hidden" />
                          </span>
                        </span>
                        <span className="hidden min-w-0 md:block">
                          <span className="block truncate text-sm text-foreground">{scopeText(a, projects)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{a.lastActive ?? 'Not signed in yet'}</span>
                        </span>
                        <StatusChip status={a.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        }
      />

      <AddAccountSheet
        open={adding}
        roles={roles}
        projects={projects}
        taken={accounts.map((a) => a.email.toLowerCase())}
        onClose={() => setAdding(false)}
        onAdd={(a) => {
          saveAccounts([...accounts, a]);
          setAdding(false);
          toast.success('Account added', { description: a.name });
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

function AccountPanel({
  account: a,
  roles,
  projects,
  dirty,
  onEdit,
  onToggleStatus,
  onRemove,
  onSave,
  onDiscard,
  onClose,
}: {
  account: Account;
  roles: Role[];
  projects: Project[];
  dirty: boolean;
  onEdit: (p: Partial<Account>) => void;
  onToggleStatus: () => void;
  onRemove: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const locked = !!a.master;
  const r = roleOf(roles, a.preset);
  const custom = isCustom(a, roles);
  // `??`, not passwordOf's `||`: an emptied box must stay empty while it is retyped.
  const password = a.password ?? DEMO_PASSWORD;
  const problem = !a.name.trim()
    ? 'Type a name'
    : !validEmail(a.email)
      ? 'Type a valid email'
      : password.length < MIN_PASSWORD
        ? `Password needs ${MIN_PASSWORD}+ characters`
        : null;

  return (
    <PanelShell onClose={onClose}
      head={
        <div className="flex items-center gap-3">
          <Avatar account={a} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold tracking-tight text-foreground">{a.name || 'Unnamed'}</p>
            <p className="truncate text-xs text-muted-foreground">{a.email}</p>
          </div>
          {locked ? <MasterChip /> : <StatusChip status={a.status} />}
        </div>
      }
      foot={dirty && <SaveBar problem={problem} onDiscard={onDiscard} onSave={onSave} />}
    >
      {locked && (
        <div className="flex gap-2.5 rounded-lg border border-check/25 bg-check-soft px-3 py-2.5 text-sm text-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-check" aria-hidden />
          <p>The Master always has Edit on every page and project, and can&apos;t be suspended or removed.</p>
        </div>
      )}

      <Section title="Sign-in">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={a.name} onChange={(e) => onEdit({ name: e.target.value })} className="h-11 sm:h-9" />
          </Field>
          <Field label="Email">
            <Input type="email" value={a.email} disabled={locked} onChange={(e) => onEdit({ email: e.target.value })} className="h-11 sm:h-9" />
          </Field>
          <Field label="Password" className="sm:col-span-2">
            <PasswordField value={password} onChange={(password) => onEdit({ password })} />
          </Field>
        </div>
        {!locked && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{a.status === 'suspended' ? 'Suspended' : 'Can sign in'}</span>
              <span className="block text-xs text-muted-foreground">
                {a.status === 'invited' ? 'Not signed in yet' : a.status === 'suspended' ? 'Locked out. Access below is kept.' : 'Signs in and uses the pages below'}
              </span>
            </span>
            <Switch checked={a.status !== 'suspended'} onCheckedChange={onToggleStatus} aria-label="Account can sign in" />
          </div>
        )}
      </Section>

      <Section
        title="Role and page access"
        aside={
          custom && (
            <button type="button" onClick={() => onEdit({ access: { ...r!.access } })} className="min-h-9 rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary-soft">
              Reset to {r!.name}
            </button>
          )
        }
      >
        {!locked && (
          <NativeSelect
            aria-label="Role"
            value={r ? r.key : ''}
            onChange={(e) => {
              const next = roleOf(roles, e.target.value);
              onEdit(next ? { preset: next.key, access: { ...next.access } } : { preset: null });
            }}
            wrapperClassName="mb-2"
            className="bg-card pl-3 sm:h-9"
          >
            <option value="">No role, set by hand</option>
            {roles.map((x) => (
              <option key={x.key} value={x.key}>{x.name}{x.key === r?.key && custom ? ' (changed)' : ''}</option>
            ))}
          </NativeSelect>
        )}
        <AccessMatrix access={a.access} locked={locked} label={a.name} onChange={(k, v) => onEdit({ access: { ...a.access, [k]: v } })} />
      </Section>

      <Section title="Projects" aside={<span className={cn(TYPE.meta, 'min-w-0 truncate')}>{scopeText(a, projects)}</span>}>
        <ProjectScope value={a.projects} projects={projects} locked={locked} onChange={(projects) => onEdit({ projects })} />
      </Section>

      {!locked && (
        <DangerButton label="Remove account" onPress={onRemove} />
      )}
    </PanelShell>
  );
}

function AddAccountSheet({
  open,
  roles,
  projects,
  taken,
  onClose,
  onAdd,
}: {
  open: boolean;
  roles: Role[];
  projects: Project[];
  taken: string[];
  onClose: () => void;
  onAdd: (a: Account) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preset, setPreset] = useState('');
  const [scope, setScope] = useState<Account['projects']>([]);
  const [access, setAccess] = useState<Account['access']>(NO_ACCESS);
  const [error, setError] = useState('');

  const reset = () => { setName(''); setEmail(''); setPassword(''); setPreset(''); setScope([]); setAccess(NO_ACCESS); setError(''); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Type a name first.');
    if (!validEmail(email)) return setError('Type a valid email.');
    if (taken.includes(email.trim().toLowerCase())) return setError('That email already has an account.');
    if (password.length < MIN_PASSWORD) return setError(`Set a password of ${MIN_PASSWORD} or more characters.`);
    onAdd({
      id: `u${Date.now().toString(36)}`,
      name: name.trim(),
      email: email.trim(),
      password,
      preset: preset || null,
      status: 'invited',
      lastActive: null,
      projects: scope,
      access,
    });
  };

  return (
    <SoftSheet open={open} onClose={onClose} onExited={reset} label="Add account" size="lg" className="flex flex-col overflow-hidden p-0 sm:pt-0">
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <PanelShell onClose={onClose}
          head={
            <>
              <h2 className="text-base font-semibold text-foreground">Add account</h2>
              <p className="text-xs text-muted-foreground">Give them this email and password. They show as Invited until they first sign in.</p>
            </>
          }
          foot={
            <>
              {error ? <p role="alert" className="min-w-0 text-sm font-medium text-bad">{error}</p> : <span />}
              <span className="flex shrink-0 gap-2">
                <button type="button" onClick={onClose} className={BTN_OUTLINE}>Cancel</button>
                <button type="submit" className={BTN_PRIMARY}>Add account</button>
              </span>
            </>
          }
        >
          <Section title="Sign-in">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} className="h-11 sm:h-9" autoComplete="off" />
              </Field>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} className="h-11 sm:h-9" autoComplete="off" />
              </Field>
              <Field label="Password" className="sm:col-span-2">
                <PasswordField value={password} onChange={(v) => { setPassword(v); setError(''); }} />
              </Field>
            </div>
          </Section>

          <Section title="Role and page access">
            <NativeSelect
              aria-label="Role"
              value={preset}
              onChange={(e) => { setPreset(e.target.value); setAccess(roleOf(roles, e.target.value) ? { ...roleOf(roles, e.target.value)!.access } : NO_ACCESS); }}
              wrapperClassName="mb-2"
              className="bg-card pl-3 sm:h-9"
            >
              <option value="">No role, set by hand</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </NativeSelect>
            <AccessMatrix access={access} locked={false} label={name || 'New account'} onChange={(k, v) => setAccess({ ...access, [k]: v })} />
          </Section>

          <Section title="Projects">
            <ProjectScope value={scope} projects={projects} locked={false} onChange={setScope} />
          </Section>
        </PanelShell>
      </form>
    </SoftSheet>
  );
}

/* ------------------------------------------------------------------- roles */

/**
 * The Master's own roles (29 Oct 2026): rename, describe, set the pages, add,
 * delete. Saving a role also moves every account that follows it UNCHANGED;
 * an account changed by hand keeps its own copy. Deleting one leaves its
 * accounts' access as it is, set by hand.
 */
function RolesView({ tabs, accounts, roles }: { tabs: React.ReactNode; accounts: Account[]; roles: Role[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(roles[0]?.key ?? null);
  const [draft, setDraft] = useState<Role | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const current = roles.find((r) => r.key === selectedKey) ?? null;
  const isNew = !!draft && !roles.some((r) => r.key === draft.key);
  const shown = draft && draft.key === selectedKey ? draft : current;
  const dirty = !!draft && draft.key === selectedKey && (isNew || !same(draft, current));

  const usedBy = (r: Role) => accounts.filter((a) => !a.master && a.preset === r.key);
  const followers = (r: Role) => usedBy(r).filter((a) => same(a.access, r.access));

  const guard = (go: () => void) =>
    dirty
      ? setConfirm({ title: 'Leave without saving?', message: `Your changes to ${shown!.name || 'this role'} will be lost.`, label: 'Discard changes', onYes: go })
      : go();

  const open = (key: string) =>
    key === selectedKey ? setSheetOpen(true) : guard(() => { setSelectedKey(key); setDraft(null); setSheetOpen(true); });

  const add = () =>
    guard(() => {
      const key = `r${Date.now().toString(36)}`;
      setDraft({ key, name: '', initials: '', duty: '', access: { ...NO_ACCESS } });
      setSelectedKey(key);
      setSheetOpen(true);
    });

  const save = () => {
    if (!draft) return;
    const next = { ...draft, name: draft.name.trim(), duty: draft.duty.trim(), initials: initials(draft.name) };
    if (isNew) saveRoles([...roles, next]);
    else {
      const old = current!;
      saveRoles(roles.map((r) => (r.key === next.key ? next : r)));
      if (!same(old.access, next.access))
        saveAccounts(accounts.map((a) => (a.preset === old.key && same(a.access, old.access) ? { ...a, access: { ...next.access } } : a)));
    }
    setDraft(null);
    setSheetOpen(false);
    toast.success(isNew ? 'Role added' : 'Changes saved', { description: next.name });
  };

  const remove = () => {
    if (!current) return;
    const n = usedBy(current).length;
    setConfirm({
      title: `Delete ${current.name}?`,
      message: n ? `${n} account${n === 1 ? '' : 's'} keep${n === 1 ? 's' : ''} its access, set by hand.` : 'No account uses it.',
      label: 'Delete role',
      onYes: () => {
        saveRoles(roles.filter((r) => r.key !== current.key));
        if (n) saveAccounts(accounts.map((a) => (a.preset === current.key ? { ...a, preset: null } : a)));
        setDraft(null);
        setSelectedKey(null);
        setSheetOpen(false);
        toast.success('Role removed', { description: current.name });
      },
    });
  };

  const panel = shown && (
    <PanelShell onClose={() => setSheetOpen(false)}
      head={
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary" aria-hidden>
            {initials(shown.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold tracking-tight text-foreground">{shown.name || 'New role'}</p>
            <p className="truncate text-xs text-muted-foreground">{isNew ? 'Not saved yet' : `Used by ${usedBy(shown).length} account${usedBy(shown).length === 1 ? '' : 's'}`}</p>
          </div>
        </div>
      }
      foot={
        dirty && (
          <SaveBar
            problem={!shown.name.trim() ? 'Type a name' : roles.some((r) => r.key !== shown.key && r.name.trim().toLowerCase() === shown.name.trim().toLowerCase()) ? 'That name is taken' : null}
            note={!isNew && current && !same(current.access, shown.access) && followers(current).length ? `Also updates ${followers(current).length} account${followers(current).length === 1 ? '' : 's'}` : undefined}
            saveLabel={isNew ? 'Add role' : 'Save'}
            onDiscard={() => { setDraft(null); if (isNew) setSelectedKey(roles[0]?.key ?? null); setSheetOpen(false); toast('Changes discarded'); }}
            onSave={save}
          />
        )
      }
    >
      <Section title="Role">
        <div className="grid gap-3">
          <Field label="Name">
            <Input value={shown.name} onChange={(e) => setDraft({ ...shown, name: e.target.value })} placeholder="e.g. QA/QC Engineer" className="h-11 sm:h-9" />
          </Field>
          <Field label="What they do">
            <Input value={shown.duty} onChange={(e) => setDraft({ ...shown, duty: e.target.value })} placeholder="One line, shown beside the role" className="h-11 sm:h-9" />
          </Field>
        </div>
      </Section>
      <Section title="Page access" aside={<span className={TYPE.meta}>{accessSummary(shown.access)}</span>}>
        <AccessMatrix access={shown.access} locked={false} label={shown.name} onChange={(k, v) => setDraft({ ...shown, access: { ...shown.access, [k]: v } })} />
      </Section>
      {!isNew && (
        <DangerButton label="Delete role" onPress={remove} />
      )}
    </PanelShell>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {tabs}
        <button type="button" onClick={add} className={BTN_PRIMARY}>
          <Plus className="size-4" aria-hidden />
          Add role
        </button>
      </div>

      <Split
        sheetOpen={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label={shown?.name || 'Role'}
        panel={panel}
        list={
          <section aria-labelledby="roles-title" className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b p-3 sm:px-4">
              <h2 id="roles-title" className={TYPE.cardTitle}>Roles</h2>
              <span className={TYPE.meta}>Pick one to fill an account in</span>
            </div>
            <ul className="divide-y">
              <li className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-check-soft text-sm font-semibold text-check" aria-hidden>MS</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">Master</span>
                  <span className="block truncate text-xs text-muted-foreground">Controls the app. Always Edit everywhere.</span>
                </span>
                <Lock className="size-4 shrink-0 text-check" aria-label="Fixed" />
              </li>
              {[...roles, ...(isNew && draft ? [draft] : [])].map((r) => {
                const on = r.key === selectedKey && sheetOpen;
                const n = usedBy(r).length;
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => open(r.key)}
                      aria-current={on || undefined}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-ios hover:bg-muted/40 sm:px-4',
                        on && 'bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary-soft'
                      )}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary" aria-hidden>
                        {initials(r.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{r.name || 'New role'}</span>
                        <span className="block truncate text-xs text-muted-foreground">{r.duty || accessSummary(r.access)}</span>
                      </span>
                      <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                        <AccessStrip access={r.access} />
                        <span className="text-xs text-muted-foreground">{accessSummary(r.access)}</span>
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {n} account{n === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        }
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

/* ------------------------------------------------------------------ shared */

/**
 * The list alone, full width; a press opens the detail over it, a bottom sheet
 * on a phone and a centred dialog from sm (29 Oct 2026). Side by side, the two
 * cards never ended on the same line.
 */
function Split({ list, panel, sheetOpen, onClose, label }: { list: React.ReactNode; panel: React.ReactNode; sheetOpen: boolean; onClose: () => void; label: string }) {
  return (
    <>
      {list}
      <SoftSheet open={sheetOpen && !!panel} onClose={onClose} label={label} size="2xl" className="flex flex-col overflow-hidden p-0 sm:pt-0">
        {panel}
      </SoftSheet>
    </>
  );
}

/** Who it is and what to do with it stay pinned; only the middle scrolls. */
function PanelShell({ head, foot, onClose, children }: { head: React.ReactNode; foot?: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 pb-3 pt-1 sm:px-5 sm:pt-3">
        <div className="min-w-0 flex-1">{head}</div>
        {/* A phone has the grab handle; a centred dialog needs a way out it can see. */}
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:size-9">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      {/* iOS Safari's floating toolbar covers the foot of a sheet on a phone
          (29 Oct 2026); only Safari knows -webkit-touch-callout, so only it
          gets the extra room and Android keeps a tight foot. */}
      <div className={cn('min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5', !foot && 'supports-[-webkit-touch-callout:none]:max-sm:pb-24')}>
        {children}
      </div>
      {foot && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 animate-fade-in-up sm:px-5 supports-[-webkit-touch-callout:none]:max-sm:pb-[calc(5rem+env(safe-area-inset-bottom))]">
          {foot}
        </div>
      )}
    </div>
  );
}

function SaveBar({ problem, note, saveLabel = 'Save', onDiscard, onSave }: { problem: string | null; note?: string; saveLabel?: string; onDiscard: () => void; onSave: () => void }) {
  return (
    <>
      <span role="status" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
        <span className={cn('size-2 shrink-0 rounded-full', problem ? 'bg-bad' : 'bg-warn')} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate">{problem ?? 'Unsaved changes'}</span>
          {note && !problem && <span className="block truncate text-xs font-normal text-muted-foreground">{note}</span>}
        </span>
      </span>
      <span className="flex shrink-0 gap-2">
        <button type="button" onClick={onDiscard} className={BTN_OUTLINE}>Discard</button>
        <button type="button" disabled={!!problem} onClick={onSave} className={BTN_PRIMARY}>{saveLabel}</button>
      </span>
    </>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <h3 className="shrink-0 text-[13px] font-semibold text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** One quiet red button at the panel's foot; what it deletes is said in its confirm. */
function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} className={cn(BTN_DANGER, 'w-full sm:min-h-10')}>
      <Trash2 className="size-4" aria-hidden />
      {label}
    </button>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <span className="flex gap-2">
      <span className="relative min-w-0 flex-1">
        <Input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          className="h-11 pr-11 sm:h-9"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </span>
      <button type="button" onClick={() => { onChange(makePassword()); setShow(true); }} className={BTN_OUTLINE}>
        <KeyRound className="size-4" aria-hidden />
        Generate
      </button>
    </span>
  );
}

function Avatar({ account }: { account: Account }) {
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
        account.master ? 'bg-check-soft text-check' : 'bg-primary-soft text-primary'
      )}
      aria-hidden
    >
      {initials(account.name)}
    </span>
  );
}

function MasterChip() {
  return <span className="inline-flex w-20 shrink-0 justify-center rounded-md bg-check-soft px-2 py-1 text-xs font-semibold text-check">Master</span>;
}

function StatusChip({ status }: { status: AccountStatus }) {
  return (
    <span className={cn('inline-flex w-20 shrink-0 justify-center rounded-md px-2 py-1 text-xs font-semibold', STATUS[status].cls)}>
      {STATUS[status].label}
    </span>
  );
}

/** Beside the name from sm; on a phone it sits under the email, so the name keeps the width. */
function RoleChip({ account, role, custom, className }: { account: Account; role: Role | undefined; custom: boolean; className?: string }) {
  if (account.master) return <span className={cn('shrink-0 rounded bg-check-soft px-1.5 py-px text-[11px] font-semibold text-check', className)}>Master</span>;
  return (
    <span className={cn('min-w-0 truncate rounded px-1.5 py-px text-[11px] font-semibold', custom || !role ? 'bg-primary-soft text-primary' : 'bg-muted text-foreground', className)}>
      {role ? `${role.name}${custom ? ' · Custom' : ''}` : 'Custom'}
    </span>
  );
}

/** One short bar per page: blue Edit, pale View, grey none. Read at a glance, spelled out in the panel. */
function AccessStrip({ access }: { access: Account['access'] }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {AREAS.map((a) => (
        <i key={a.key} className={cn('h-1 w-3 rounded-full', access[a.key] === 'edit' ? 'bg-primary' : access[a.key] === 'view' ? 'bg-primary/35' : 'bg-track')} />
      ))}
    </span>
  );
}

function ProjectScope({ value, projects, locked, onChange }: { value: Account['projects']; projects: Project[]; locked: boolean; onChange: (v: Account['projects']) => void }) {
  const all = value === 'all';
  const row = 'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm';
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

/** None / View / Edit per page on one line, native buttons (seven rows, one panel). */
function AccessMatrix({ access, locked, label, onChange }: { access: Account['access']; locked: boolean; label: string; onChange: (k: keyof Account['access'], v: Access) => void }) {
  return (
    <ul className="divide-y rounded-lg border">
      {AREAS.map((area) => (
        <li key={area.key} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{area.label}</span>
            <span className="block text-xs text-muted-foreground">Edit: {area.edit}</span>
          </span>
          {locked ? (
            <span className="flex min-h-9 shrink-0 items-center gap-1.5 text-sm font-medium text-check">
              <Lock className="size-3.5" aria-hidden />
              Always Edit
            </span>
          ) : (
            <div role="radiogroup" aria-label={`${label}, ${area.label}`} className="grid w-40 shrink-0 grid-cols-3 rounded-lg border bg-muted/50 p-0.5">
              {ACCESS_LEVELS.map((lvl) => {
                const on = access[area.key] === lvl.key;
                return (
                  <button
                    key={lvl.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={lvl.label}
                    onClick={() => onChange(area.key, lvl.key)}
                    className={cn(
                      'min-h-10 rounded-md text-[13px] transition-colors duration-150 ease-ios active:scale-[0.97] sm:min-h-8',
                      on
                        ? lvl.key === 'edit'
                          ? 'bg-primary font-semibold text-primary-foreground shadow-sm'
                          : lvl.key === 'view'
                            ? 'bg-card font-semibold text-primary shadow-sm'
                            : 'bg-card font-semibold text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {SHORT[lvl.key]}
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
