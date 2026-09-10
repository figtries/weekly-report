import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { getDb } from '@/lib/data';
import { getCatalogs } from '@/lib/catalogs';
import CatalogEditor from '@/components/settings/CatalogEditor';
import { EngineeringSource } from '@/components/settings/EngineeringSource';
import { getDisciplineLinks, getRegisterSummary } from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';


export const metadata = { title: 'Project Settings' };

/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <SettingsBody />
    </Suspense>
  );
}

async function SettingsBody() {
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const db = await getDb();
  const cat = getCatalogs(db);
  // Left at its own last movement rather than a chosen week: this decides where
  // a number comes from, so what matters is what the register currently knows.
  const edl = getRegisterSummary(projectId, 'edl');
  const disciplines = edl ? getDisciplineLinks(projectId) : [];

  return (
    <RouteTransition id="settings">
    <div className="mx-auto max-w-3xl px-3 py-5 sm:p-6 lg:p-8">

      <header className="mb-6 animate-enter">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Project Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          The lists below belong to this project, not to the app. Another project keeps its own, which is
          what lets this app serve any company. Changes apply to the next report; reports
          already issued are left alone.
        </p>
      </header>

      <div className="space-y-4">
        {edl && disciplines.length > 0 && (
          <EngineeringSource
            projectId={projectId}
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
