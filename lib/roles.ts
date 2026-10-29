/**
 * Who may open what: the DRAFT behind the Roles page.
 *
 * There is no real login yet (board item 22): the demo sign-in and the
 * Master's changes live in the browser (`lib/signed-in.ts`), which starts from
 * the seed below and hides the menu rows and pages an account has No access
 * to. No server checks it. It is one file on purpose:
 * renaming a role, adding one or changing what it opens is an edit here and
 * nowhere else.
 */

export type Access = 'none' | 'view' | 'edit';

export const ACCESS_LEVELS: { key: Access; label: string }[] = [
  { key: 'none', label: 'No access' },
  { key: 'view', label: 'View' },
  { key: 'edit', label: 'Edit' },
];

export type AreaKey = 'dashboard' | 'overall' | 'weekly' | 'daily' | 'dokumen' | 'projects' | 'roles';

/** The app's own destinations, in the sidebar's order, with what Edit lets a person do there. */
export const AREAS: { key: AreaKey; label: string; edit: string }[] = [
  { key: 'dashboard', label: 'Dashboard', edit: 'Set the current week' },
  { key: 'overall', label: 'Data Overall', edit: 'Fill in progress and budgets' },
  { key: 'weekly', label: 'Weekly Reports', edit: 'Approve and export the week' },
  { key: 'daily', label: 'Daily Reports', edit: 'Write the daily report' },
  { key: 'dokumen', label: 'Document Control', edit: 'Update the document register' },
  { key: 'projects', label: 'Projects', edit: 'Create projects and plan them' },
  { key: 'roles', label: 'Roles', edit: 'Give people their access' },
];

export interface Role {
  key: string;
  name: string;
  initials: string;
  duty: string;
  /** The one who controls the app: always Edit everywhere, never lowered. */
  master?: boolean;
  access: Record<AreaKey, Access>;
}

const all = (a: Access): Record<AreaKey, Access> =>
  Object.fromEntries(AREAS.map((x) => [x.key, a])) as Record<AreaKey, Access>;

export const ROLES: Role[] = [
  {
    key: 'master',
    name: 'Master',
    initials: 'MS',
    duty: 'Controls the app and decides who opens what.',
    master: true,
    access: all('edit'),
  },
  {
    key: 'pm',
    name: 'Project Manager',
    initials: 'PM',
    duty: 'Runs the project and signs off the weekly report.',
    access: { ...all('view'), overall: 'edit', weekly: 'edit', projects: 'edit', roles: 'none' },
  },
  {
    key: 'pc',
    name: 'Project Control',
    initials: 'PC',
    duty: 'Keeps the plan, the budgets and the weekly figures.',
    access: { ...all('view'), overall: 'edit', weekly: 'edit', projects: 'edit', roles: 'none' },
  },
  {
    key: 'site',
    name: 'Site Engineer',
    initials: 'SE',
    duty: 'Writes the daily report from site.',
    access: { ...all('none'), dashboard: 'view', weekly: 'view', daily: 'edit' },
  },
  {
    key: 'doc',
    name: 'Document Control',
    initials: 'DC',
    duty: 'Keeps the document register up to date.',
    access: { ...all('none'), dashboard: 'view', weekly: 'view', dokumen: 'edit' },
  },
  {
    key: 'viewer',
    name: 'Viewer',
    initials: 'VW',
    duty: 'Client or management. Reads, never changes.',
    access: { ...all('none'), dashboard: 'view', weekly: 'view' },
  },
];

/**
 * Access is set PER ACCOUNT (28 Oct 2026). A role above is only a preset that
 * fills an account's pages in; the account then keeps its own copy, changed
 * freely. Sample accounts until login exists: `projects` is an index into the
 * real project list ('all' for every project), resolved on the page.
 */
export type AccountStatus = 'active' | 'invited' | 'suspended';

export interface Account {
  id: string;
  name: string;
  email: string;
  master?: boolean;
  /** The preset it started from, or null when set by hand. */
  preset: string | null;
  status: AccountStatus;
  /** Set by the Master; none means the demo password (`lib/signed-in.ts`). */
  password?: string;
  lastActive: string | null;
  projects: 'all' | string[];
  access: Record<AreaKey, Access>;
}

export type AccountSeed = Omit<Account, 'projects'> & { projects: 'all' | number[] };

const preset = (key: string) => ({ ...ROLES.find((r) => r.key === key)!.access });

export const SEED_ACCOUNTS: AccountSeed[] = [
  { id: 'u01', name: 'Fajar Nugroho', email: 'fajar@figtries.id', master: true, preset: 'master', status: 'active', lastActive: 'Now', projects: 'all', access: all('edit') },
  { id: 'u02', name: 'Rina Wulandari', email: 'rina.w@figtries.id', preset: 'pm', status: 'active', lastActive: '12 min ago', projects: [0, 1], access: preset('pm') },
  { id: 'u03', name: 'Dimas Prakoso', email: 'dimas.p@figtries.id', preset: 'pc', status: 'active', lastActive: '1 hr ago', projects: [0], access: { ...preset('pc'), dokumen: 'edit' } },
  { id: 'u04', name: 'Ayu Lestari', email: 'ayu.lestari@figtries.id', preset: 'doc', status: 'active', lastActive: 'Yesterday', projects: [0, 2], access: preset('doc') },
  { id: 'u05', name: 'Bagus Santoso', email: 'bagus.s@figtries.id', preset: 'site', status: 'active', lastActive: '3 hr ago', projects: [0], access: preset('site') },
  { id: 'u06', name: 'Andika Wijaya', email: 'andika.wijaya@client.co.id', preset: 'viewer', status: 'active', lastActive: '2 days ago', projects: [0], access: preset('viewer') },
  { id: 'u07', name: 'Sari Handayani', email: 'sari.h@figtries.id', preset: 'site', status: 'invited', lastActive: null, projects: [1], access: preset('site') },
  { id: 'u08', name: 'Yoga Pratama', email: 'yoga.p@figtries.id', preset: 'pc', status: 'invited', lastActive: null, projects: [2], access: preset('pc') },
  { id: 'u09', name: 'Hendra Kusuma', email: 'hendra.k@figtries.id', preset: 'pm', status: 'suspended', lastActive: '3 weeks ago', projects: [1], access: preset('pm') },
];

export const NO_ACCESS = all('none');

/** "Edit 3 · View 4": how much a role opens, counted the way the card prints it. */
export function accessSummary(access: Record<AreaKey, Access>): string {
  const n = (a: Access) => AREAS.filter((x) => access[x.key] === a).length;
  const parts = [n('edit') && `Edit ${n('edit')}`, n('view') && `View ${n('view')}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Opens nothing';
}
