import { Files } from 'lucide-react';

import { RegisterTabs } from '@/components/dokumen/RegisterTabs';
import { Reveal } from '@/components/motion/Reveal';
import { getProject } from '@/lib/queries';

export const metadata = { title: 'Document Control' };

const PROJECT_ID = 'gundih';

/**
 * Document Control is one workplace with five screens, not five pages.
 *
 * The heading and the tab bar are the layout so they survive navigation between
 * them — moving from the EDL summary to its working screen should feel like
 * changing tabs, not loading a new page.
 */
export default function DocumentControlLayout({ children }: { children: React.ReactNode }) {
  const project = getProject(PROJECT_ID);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <Reveal>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Files className="h-4 w-4 text-muted-foreground" />
            <span className="line-clamp-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {project?.contractNo ?? project?.name ?? 'Proyek'}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Document Control</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Dua register: EDL untuk dokumen engineering yang kita kirim ke Pertamina, VDRL untuk
            dokumen yang ditagih dari vendor. Keduanya dihitung dengan cara yang sama.
          </p>
        </div>
      </Reveal>

      <RegisterTabs />

      {children}
    </div>
  );
}
