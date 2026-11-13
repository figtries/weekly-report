/**
 * Who may open what: the roles and account shape behind the Roles page.
 *
 * Accounts and sign-in live on the server (`lib/auth-store.ts`, 12 Nov 2026);
 * the menu rows and pages an account has No access to are hidden by the client
 * (`lib/signed-in.ts`). Roles below are the presets an account starts from.
 * It is one file on purpose:
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
 * freely. `projects` is project ids, or 'all'.
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
  /** Only while the Master types a new one; the server keeps a hash, never this. */
  password?: string;
  lastActive: string | null;
  projects: 'all' | string[];
  access: Record<AreaKey, Access>;
}

export const NO_ACCESS = all('none');

/** "Edit 3 · View 4": how much a role opens, counted the way the card prints it. */
export function accessSummary(access: Record<AreaKey, Access>): string {
  const n = (a: Access) => AREAS.filter((x) => access[x.key] === a).length;
  const parts = [n('edit') && `Edit ${n('edit')}`, n('view') && `View ${n('view')}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Opens nothing';
}
