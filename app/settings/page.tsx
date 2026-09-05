import { RouteTransition } from '@/components/motion/RouteTransition';
import { getDb } from '@/lib/data';
import { getCatalogs } from '@/lib/catalogs';
import CatalogEditor from '@/components/settings/CatalogEditor';
import { EngineeringSource } from '@/components/settings/EngineeringSource';
import { getDisciplineLinks, getRegisterSummary } from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

/**
 * The project this screen is about — read per request, never at module scope.
 * A module-level read is evaluated once at import and goes stale the moment
 * anyone switches project. See lib/projects.ts.
 */
function activeProjectId(): string {
  return getActiveProjectId() ?? '';
}

export const metadata = { title: 'Project Settings' };

export default async function SettingsPage() {
  const db = await getDb();
  const cat = getCatalogs(db);
  // Left at its own last movement rather than a chosen week: this decides where
  // a number comes from, so what matters is what the register currently knows.
  const edl = getRegisterSummary(activeProjectId(), 'edl');
  const disciplines = edl ? getDisciplineLinks(activeProjectId()) : [];

  return (
    <RouteTransition id="settings">
    <div className="mx-auto max-w-3xl px-3 py-5 sm:p-6 lg:p-8">

      <header className="mb-6 animate-enter">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Project Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The lists below belong to this project, not to the app. Another project keeps its own —
          which is what lets this app serve any company. Changes apply to the next report; reports
          already issued are left alone.
        </p>
      </header>

      <div className="space-y-4">
        {edl && disciplines.length > 0 && (
          <EngineeringSource
            projectId={activeProjectId()}
            disciplines={disciplines}
            registerDate={edl.evidenceDate}
          />
        )}
        <CatalogEditor catalogKey="weather" entries={cat.weather} />
        <CatalogEditor catalogKey="delayCause" entries={cat.delayCause} />
        <CatalogEditor catalogKey="hse" entries={cat.hse} />
        <CatalogEditor catalogKey="crew" entries={cat.crew} />
      </div>
    </div>
    </RouteTransition>
  );
}
