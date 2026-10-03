import { RouteTransition } from '@/components/motion/RouteTransition';
import { RolesBoard } from '@/components/roles/RolesBoard';

export const metadata = { title: 'Roles' };

/**
 * Who may open what, set by the Master. A draft until login exists (board
 * item 22): it reads nothing per request, so the page is static.
 */
export default function RolesPage() {
  return (
    <RouteTransition id="roles">
      <div className="mx-auto max-w-3xl px-3 py-5 sm:p-6 lg:p-8">
        <header className="mb-6 animate-enter">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A role decides which pages a person can open, and whether they can only read or also change
            what is there. The Master sets them for everyone.
          </p>
        </header>
        <RolesBoard />
      </div>
    </RouteTransition>
  );
}
