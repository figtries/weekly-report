import { RouteTransition } from '@/components/motion/RouteTransition';
import { Reveal } from '@/components/motion/Reveal';
import { LogScreen, type TaggedEvent } from '@/components/dokumen/LogScreen';
import { getRegisterLog } from '@/lib/register';

export const metadata = { title: 'Document log' };

const PROJECT_ID = 'gundih';

/**
 * Both registers on one timeline, up to the week being viewed.
 *
 * A delay rarely stays on one side of the fence — a vendor drawing that arrives
 * late holds up the engineering document that quotes it — so the two are read
 * together here, and filtered apart only when someone asks.
 */
export default async function LogPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const events: TaggedEvent[] = [
    ...getRegisterLog(PROJECT_ID, 'edl', 400, week).map((e) => ({ ...e, register: 'edl' as const })),
    ...getRegisterLog(PROJECT_ID, 'vdrl', 400, week).map((e) => ({ ...e, register: 'vdrl' as const })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <RouteTransition id="dokumen-log">
      {/* LogScreen's own day sections sit inside an `AnimatePresence
          initial={false}`, which deliberately skips the FIRST mount so nothing
          ships hidden — correct, and the reason this screen arrived with no
          movement at all. The entrance belongs out here, in CSS, where it plays
          on first paint whether or not the bundle has landed. */}
      <Reveal>
        <LogScreen events={events} weekNo={week} />
      </Reveal>
    </RouteTransition>
  );
}
