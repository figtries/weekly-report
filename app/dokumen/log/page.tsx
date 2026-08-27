import { LogScreen, type TaggedEvent } from '@/components/dokumen/LogScreen';
import { getRegisterLog } from '@/lib/register';

export const metadata = { title: 'Log dokumen' };

const PROJECT_ID = 'gundih';

/**
 * Both registers on one timeline.
 *
 * A delay rarely stays on one side of the fence — a vendor drawing that arrives
 * late holds up the engineering document that quotes it — so the two are read
 * together here, and filtered apart only when someone asks.
 */
export default function LogPage() {
  const events: TaggedEvent[] = [
    ...getRegisterLog(PROJECT_ID, 'edl', 400).map((e) => ({ ...e, register: 'edl' as const })),
    ...getRegisterLog(PROJECT_ID, 'vdrl', 400).map((e) => ({ ...e, register: 'vdrl' as const })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return <LogScreen events={events} />;
}
