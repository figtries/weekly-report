import { Files } from 'lucide-react';

import { RegisterTabs } from '@/components/dokumen/RegisterTabs';
import { Reveal } from '@/components/motion/Reveal';
import { getDb, getLatestWeek } from '@/lib/data';
import { getProject } from '@/lib/queries';
import { getRegisterWeeks } from '@/lib/register';

export const metadata = { title: 'Document Control' };

const PROJECT_ID = 'gundih';

export function generateStaticParams() {
  return getRegisterWeeks(PROJECT_ID).map((w) => ({ week: String(w.weekNo) }));
}

/**
 * Document Control is one workplace with five screens, not five pages — and
 * every one of them is read as of a chosen week.
 *
 * The week sits in the address, the way the weekly report's does, so a
 * controller can bookmark the week they are reporting and a reload lands back
 * on it. The picker is the same control the weekly report uses; only the base
 * path differs.
 */
export default async function DocumentControlLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const project = getProject(PROJECT_ID);
  const weeks = getRegisterWeeks(PROJECT_ID).map((w) => w.weekNo);
  const db = await getDb();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <Reveal>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Files className="h-4 w-4 text-muted-foreground" />
            <span className="line-clamp-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {project?.contractNo ?? project?.name ?? 'Project'}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Document Control</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Two registers: the EDL for engineering documents we issue to Pertamina, the VDRL for
            what the vendors still owe us. Both are counted the same way, and both are read as of
            the week you pick.
          </p>
        </div>
      </Reveal>

      <RegisterTabs
        weeks={weeks}
        selectedWeek={Number(week)}
        projectCurrentWeek={getLatestWeek(db) || 1}
      />

      {children}
    </div>
  );
}
