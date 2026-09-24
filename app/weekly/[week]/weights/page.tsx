import { getOpenProject } from '@/lib/legacy-bridge';
import { loadWeightsScreen } from '@/lib/weights-screen';
import WeightsWorkbench from '@/components/weekly/WeightsWorkbench';
import PageHeader from '@/components/layout/PageHeader';
import { Reveal } from '@/components/motion/Reveal';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { MOTION } from '@/lib/design';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
  unstable_disableValidation: true,
};

/**
 * Prices and weights. The one screen on this route that is not about a week.
 *
 * It lives under `/weekly/[week]/` because that is where Data Overall lives and
 * a person gets here from the same header, not because the figures belong to a
 * week — they belong to the project, and the week picker above does nothing to
 * them. The page says that in its own subtitle rather than leaving someone to
 * discover it: a control that visibly changes nothing reads as broken.
 *
 * Gated like every other screen that reads SQLite. A project on `db.json` has
 * no `wbs_nodes` to price, so the gate says so instead of rendering an empty
 * list that looks like data loss.
 */
export default function WeightsPage() {
  return (
    <LegacyGate what="prices and weights" planned>
      <WeightsPageBody />
    </LegacyGate>
  );
}

async function WeightsPageBody() {
  const open = await getOpenProject();
  const screen = open ? loadWeightsScreen(open.id) : null;

  return (
    <RouteTransition id="weekly-weights">
      <div className="flex flex-col gap-4 px-3 py-4 sm:p-6 lg:p-8">
        <PageHeader section="Data Overall" title="Weights" className="mb-0 animate-enter">
          {/* Both promises, said once, at the top, in the words that remove the
              two fears. Nobody arrives with a complete BOQ, and believing you
              need one is what stops a project getting set up at all. And nobody
              on a site can answer "what percent is this now" — the workbook
              this replaces asked them 176 times a week and got guesses. */}
          <span className="font-semibold text-foreground">
            Give each work package its budget, then each activity its budget or its share of the
            heading. The weights add up from there.
          </span>
        </PageHeader>

        <Reveal delay={MOTION.stagger}>
          {screen ? (
            <WeightsWorkbench screen={screen} projectId={open!.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Open a project first.</p>
          )}
        </Reveal>
      </div>
    </RouteTransition>
  );
}
