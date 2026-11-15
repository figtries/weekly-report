import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, TriangleAlert } from 'lucide-react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import OpenProjectButton from '@/components/projects/OpenProjectButton';
import ProjectDetails from '@/components/projects/ProjectDetails';
import GanttPdfButton from '@/components/projects/GanttPdfButton';
import { packagesOf } from '@/lib/gantt-print';
import ScheduleSheet from '@/components/projects/ScheduleSheet';
import { getActiveProjectId, getProject, getProjectContents } from '@/lib/projects';
import { getSheet, getWeekSpans } from '@/lib/sheet';
import { getWeightSummary } from '@/lib/weights-read';
import { currentWeekForProject } from '@/lib/data';
import ValueStrip from '@/components/projects/ValueStrip';
import { getBarView } from '@/lib/bar-view-read';
import { getBarFacts } from '@/lib/bar-facts';
import { fieldOf } from '@/lib/fields';

// No `dynamicParams` export here: under `cacheComponents` it is rejected
// outright ("not compatible with nextConfig.cacheComponents"). Reading `params`
// is enough — this route resolves per id without it.

/** `11 Dec 26` — the sheet's own format, so two dates on one screen match. */
function fmtDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' })
    .replace('Sept', 'Sep');
}

/**
 * A project, and the plan it holds.
 *
 * The page is a full-height column rather than a scrolling document: the sheet
 * and its Gantt each need their own scroller, and a page that scrolls as well
 * gives you three, which is the surest way to lose a row you were looking at.
 * The chrome above is deliberately thin — a header, one line of facts — because
 * the plan is what people came for.
 */
/**
 * ONE BOUNDARY ABOVE THIS PAGE, AND IT IS `loading.tsx` (13 Nov 2026).
 *
 * `params` is a runtime read, so the page postpones and its `loading.tsx`
 * (PlannerSkeleton, the shape this route lands in) is the prerendered shell.
 * There used to be three boundaries on the way down: the project LIST's
 * `loading.tsx`, this route's, and a `<Suspense>` of the page's own with the
 * same skeleton. The outer two FINISHED during the prerender (each resolved to
 * the next one's fallback), React outlined them as `S:2` and `S:3`, and the
 * resume handed the same ids to the page's own segments. On every full load of
 * a plan the Details button and the Open button were spliced into the wrong
 * place, React threw #418 and rebuilt the page on the client: the planner
 * mounted twice, so `#row=…&open=kind` was consumed by the copy thrown away
 * and the kind view never opened. A phone reloads a tab far more often than a
 * desktop does, which is where it was seen. The list's loading file now lives in `(list)/` and covers the
 * list alone. `scripts/verify-hydration.mjs` is the proof; see AGENTS.md, "no
 * `<Suspense>` in the shell may complete during the prerender".
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [contents, sheet, weights, barView, weeks, barFactsResult] = await Promise.all([
    getProjectContents(id),
    getSheet(id),
    getWeightSummary(id),
    getBarView(id),
    getWeekSpans(id),
    getBarFacts(id),
  ]);
  const barFacts = barFactsResult.facts;
  const isOpen = (await getActiveProjectId()) === id;
  // The week Data Overall opens on, for the button beside this title — and only
  // when this project is already the open one, which is the only case where the
  // answer is cheap (the same database every other screen has just read) and
  // the only case where the button is a link at all. Working it out here is
  // what saves the press a stop at `/weekly`: that index resolves the same
  // number, but it does it in a second round trip with an empty main area on
  // screen for the ~490 ms it takes.
  const openWeek = isOpen ? await currentWeekForProject(id) : null;

  // Lexicographic order on ISO dates is chronological, which is most of the
  // reason every date in this app is stored as one.
  const planEnd = sheet.spanFinish;
  const outgrown = Boolean(project.finishDate && planEnd && planEnd > project.finishDate);

  const facts = [
    `${contents.wbsRows} rows`,
    `${contents.leaves} measurable`,
    contents.reportingUnits ? `${contents.reportingUnits} work packages` : null,
    `${contents.weeks} weeks`,
    contents.documents ? `${contents.documents} documents` : null,
    // The priced-rows count stood here. It went with the Price column: this
    // page has no pricing to report on any more, and Data Overall is where
    // "how far along is the pricing" will be asked and answered.
    //
    // The contract figure is NOT repeated here either. It is stated once, in
    // the strip directly below.
  ].filter(Boolean);

  return (
    <RouteTransition id="project-home">
      <div className="flex h-full min-h-0 flex-col overflow-hidden max-md:overflow-y-auto">
        <header className="animate-enter shrink-0 border-b px-3 py-2 sm:py-3">
          {/* One wrapping row, reordered rather than duplicated.
              On a phone the way back and the two buttons share the first line
              and the title takes the second; above 640px the way back has its
              own line and the buttons return to the right of the title. Three
              children, one instance of each — a second copy behind a
              `sm:hidden` would mean two ProjectDetails dialogs mounted, each
              with its own state, on every project page. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-y-1">
            <Link
              href="/projects"
              className="order-1 mr-auto inline-flex h-11 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:h-8 sm:w-full"
            >
              <ArrowLeft className="size-3.5" />
              All projects
            </Link>
            <div className="order-2 flex shrink-0 items-center gap-2 sm:order-3">
              <GanttPdfButton
                projectId={id}
                fileBase={[project.alias, project.name].filter(Boolean).join(' - ')}
                parties={{ client: project.clientName, contractor: project.contractorName }}
                packages={packagesOf(sheet.rows)}
                rows={sheet.rows.map((r) => ({
                  id: r.id,
                  parentId: r.parentId,
                  depth: r.depth,
                  name: r.name,
                  code: r.code,
                  isSummary: r.isSummary,
                  isReportingUnit: r.isReportingUnit,
                  unitLabel: r.unitLabel,
                  childCount: r.childCount,
                }))}
              />
              <ProjectDetails project={project} />
              <OpenProjectButton id={id} isOpen={isOpen} openWeek={openWeek} />
            </div>
            <div className="order-3 w-full min-w-0 sm:order-2 sm:mr-auto sm:w-auto">
              {/* The name alone: the three-letter initial beside it was a second
                  name in a grey chip, and he asked for it gone (8 Oct 2026). It
                  is still the project's handle everywhere else. */}
              <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">{project.name}</h1>
              {/* On a phone the client takes a line and the facts the next, so a
                  wrap never starts a line with "·" (8 Oct 2026). Above 640px
                  it is one line again. */}
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="basis-full sm:basis-auto">{project.clientName || 'No client named yet'}</span>
                {facts.map((f, i) => (
                  <span key={f as string} className={i >= 3 ? 'hidden sm:inline' : ''}>
                    <span className={i === 0 ? 'hidden sm:inline' : ''}>· </span>
                    {f}
                  </span>
                ))}
              </p>
            </div>
          </div>

          {/* "2 weeks" is counted from the PROJECT's own start and finish, and
              nothing moves those when a row is dragged past them. So a plan can
              run months beyond the window its reporting weeks are cut from, and
              the only sign of it was a week count quietly disagreeing with every
              date in the sheet. Said out loud instead, with both dates, because
              which of the two is wrong is the reader's call and not ours. */}
          {outgrown && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-warn/10 px-2 py-1.5 text-[11px] font-medium leading-relaxed text-warn">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                Plan runs to {fmtDay(planEnd)}, past this project&apos;s finish on{' '}
                {fmtDay(project.finishDate)}.
                <span className="hidden sm:inline">
                  {' '}
                  Reporting weeks are cut from the project dates, so work after that finish has no
                  week to be reported in.
                </span>
              </span>
            </div>
          )}
        </header>

        {weights && <ValueStrip summary={weights} projectId={id} />}

        {/* Always the sheet, even with nothing in it. An empty project used to
            get a separate panel here, which meant the one screen where you
            build a plan was missing on exactly the project that had none. */}
        {/* Keyed by project, to say out loud what the sheet now depends on: it
            takes `rows` as a SEED and owns them from mount onwards, because a
            page payload cannot be told apart from an older one on arrival (see
            ScheduleSheet). A component that never re-reads this prop has to be
            a new component when the id changes.

            Next remounts across `/projects/a` → `/projects/b` on its own today
            — checked, and `scripts/verify-sheet-optimistic.mjs` passes its swap
            case without this line. The key is here so that the sheet's rule
            does not quietly rest on that. */}
        <ScheduleSheet
          key={id}
          rows={sheet.rows}
          spanStart={sheet.spanStart}
          spanFinish={sheet.spanFinish}
          projectStart={project.startDate}
          projectFinish={project.finishDate}
          projectId={id}
          barView={barView}
          barFacts={barFacts}
          fieldKinds={fieldOf(project.field).kinds}
          weeks={weeks}
          contract={sheet.contract !== null}
        />
      </div>
    </RouteTransition>
  );
}
