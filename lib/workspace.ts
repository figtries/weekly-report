import type { Database } from './types';

/**
 * Many projects in one store.
 *
 * The whole app was written against a single `Database`, and roughly forty
 * call sites read it. Rather than rewrite all of them, a Workspace holds a map
 * of projects and remembers which one is active — `readDb()` keeps returning
 * that one, so every existing page keeps working untouched, and only the
 * portfolio view needs to know more than one exists.
 *
 * This is deliberately still one JSON blob. It proves the shape and unlocks
 * the portfolio tier without committing to a storage decision that belongs to
 * whoever owns the database migration; see AGENTS.md.
 */
export interface Workspace {
  version: 2;
  activeProjectId: string;
  projects: Record<string, Database>;
  order: string[];
}

/** A legacy single-project file, or a workspace. Read code must handle both forever. */
export type StoredShape = Workspace | Database;

export function isWorkspace(v: StoredShape): v is Workspace {
  return (v as Workspace).version === 2 && !!(v as Workspace).projects;
}

export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Wrap a pre-workspace database as the first project.
 *
 * Migration happens on read and is never written back on its own — a file only
 * takes the new shape once something is actually saved. A user who opens the
 * app and changes nothing leaves their file exactly as they left it.
 */
export function migrate(stored: StoredShape): Workspace {
  if (isWorkspace(stored)) return stored;
  const id = 'p-utama';
  return {
    version: 2,
    activeProjectId: id,
    projects: { [id]: stored },
    order: [id],
  };
}

export function activeProject(ws: Workspace): Database {
  const active = ws.projects[ws.activeProjectId];
  if (active) return active;
  // A dangling active id (project deleted elsewhere) must not blank the app.
  const first = ws.order.find((id) => ws.projects[id]) ?? Object.keys(ws.projects)[0];
  return ws.projects[first];
}

export interface ProjectSummary {
  id: string;
  name: string;
  customer: string;
  contractor: string;
  currentWeek: number;
  totalWeeks: number;
  contractValue: number | null;
  isActive: boolean;
}

export function listProjects(ws: Workspace): ProjectSummary[] {
  return ws.order
    .filter((id) => ws.projects[id])
    .map((id) => {
      const p = ws.projects[id];
      return {
        id,
        name: p.project.name || '(tanpa nama)',
        customer: p.project.customer,
        contractor: p.project.contractor,
        currentWeek: p.project.currentWeek,
        totalWeeks: p.weeks.length ? Math.max(...p.weeks.map((w) => w.week)) : 0,
        contractValue: p.project.contractValue ?? null,
        isActive: id === ws.activeProjectId,
      };
    });
}

/** A blank project — the state the setup wizard fills in. */
export function emptyDatabase(name: string): Database {
  return {
    project: {
      name,
      contractNo: '',
      customer: '',
      contractor: '',
      workLocation: '',
      documentNoWeekly: '',
      documentNoDaily: '',
      signatureLeft: { company: '', name: '' },
      signatureRight: { company: '', name: '' },
      weekAnchorEndDate: '',
      currentWeek: 1,
    },
    wbsItems: [],
    weeks: [],
    scurvePlan: [],
    scurveActual: [],
    daily: [],
    changeLog: [],
  };
}
