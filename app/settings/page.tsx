import { getDb } from '@/lib/data';
import { getCatalogs } from '@/lib/catalogs';
import CatalogEditor from '@/components/settings/CatalogEditor';
import { EngineeringSource } from '@/components/settings/EngineeringSource';
import SectionTabs, { PROJECT_TABS } from '@/components/layout/SectionTabs';
import { getDisciplineLinks, getRegisterSummary } from '@/lib/register';

const PROJECT_ID = 'gundih';

export const metadata = { title: 'Project Settings' };

export default async function SettingsPage() {
  const db = await getDb();
  const cat = getCatalogs(db);
  // Left at its own last movement rather than a chosen week: this decides where
  // a number comes from, so what matters is what the register currently knows.
  const edl = getRegisterSummary(PROJECT_ID, 'edl');
  const disciplines = edl ? getDisciplineLinks(PROJECT_ID) : [];

  return (
    <div className="mx-auto max-w-3xl animate-fade-in-up px-3 py-5 sm:p-6 lg:p-8">
      <SectionTabs tabs={PROJECT_TABS} className="mb-5" />

      <header className="mb-6">
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
            projectId={PROJECT_ID}
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
  );
}
