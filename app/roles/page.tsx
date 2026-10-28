import { Suspense } from 'react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { AccessBoard } from '@/components/roles/AccessBoard';
import { listProjects } from '@/lib/projects';

export const metadata = { title: 'Roles' };

/**
 * Who may open what, set by the Master per ACCOUNT. A draft until login exists
 * (board item 22). The board needs the project list, which reads the open
 * project's cookie, so it streams behind a boundary; the header does not wait.
 */
export default function RolesPage() {
  return (
    <RouteTransition id="roles">
      <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:p-6 lg:p-8">
        <header className="animate-enter">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Access management</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Who can open which page, and on which project. Set one account at a time.
          </p>
        </header>
        <Suspense fallback={null}>
          <Board />
        </Suspense>
      </div>
    </RouteTransition>
  );
}

async function Board() {
  const projects = (await listProjects()).map((p) => ({ id: p.id, name: p.name }));
  return <AccessBoard projects={projects} />;
}
