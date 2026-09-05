import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CalendarRange, FileText, Layers, Milestone, Rows3, Wallet } from 'lucide-react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import OpenProjectButton from '@/components/projects/OpenProjectButton';
import { getActiveProjectId, getProject, getProjectContents } from '@/lib/projects';

// No `dynamicParams` export here: under `cacheComponents` it is rejected
// outright ("not compatible with nextConfig.cacheComponents"). Reading `params`
// is enough — this route resolves per id without it.

/**
 * A project's own home.
 *
 * Two jobs, and the second is the one that does not exist anywhere else in the
 * app: it says what the project actually CONTAINS. A project that reads "285
 * work breakdown rows · 4 reporting units · 454 documents" is one you can
 * believe in; a name and a percentage is not.
 *
 * The schedule sheet — the six-column MS Project surface with its Gantt — lands
 * in this page next. It is deliberately not faked here: an empty grid pretending
 * to be an editor is worse than a sentence saying where it will be.
 */
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a runtime read. Under `cacheComponents` awaiting it in the page
  // component itself fails with "Runtime data ... accessed outside of
  // <Suspense>" — the same wall `/print/*` hit. A `null` fallback is right
  // here: everything on this page depends on which project it is, so there is
  // no honest skeleton to draw before the id is known.
  return (
    <Suspense fallback={null}>
      <ProjectBody params={params} />
    </Suspense>
  );
}

async function ProjectBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  const contents = getProjectContents(id);
  const isOpen = getActiveProjectId() === id;

  const money =
    project.contractValue && project.contractValue > 0
      ? new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: project.currency,
          maximumFractionDigits: 0,
        }).format(project.contractValue)
      : null;

  const dates =
    project.startDate && project.finishDate
      ? `${fmt(project.startDate)} — ${fmt(project.finishDate)}`
      : 'No dates set';

  const facts = [
    { icon: Rows3, label: 'Work breakdown rows', value: contents.wbsRows, sub: `${contents.leaves} of them measurable` },
    { icon: Layers, label: 'Reporting units', value: contents.reportingUnits, sub: 'SPK, packages, lots' },
    { icon: CalendarRange, label: 'Scheduled rows', value: contents.scheduledRows, sub: `across ${contents.baselines} baselines` },
    { icon: Milestone, label: 'Reporting weeks', value: contents.weeks, sub: dates },
    { icon: FileText, label: 'Documents', value: contents.documents, sub: 'in the register' },
    { icon: Wallet, label: 'Contract value', value: money ?? '—', sub: money ? project.currency : 'no prices entered yet' },
  ];

  return (
    <RouteTransition id="project-home">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:p-6 lg:p-8">
        <Link
          href="/projects"
          className="animate-fade-in-up inline-flex h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All projects
        </Link>

        <header className="animate-enter mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
              {project.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.clientName || 'No client named yet'}
              {project.contractorName ? ` · ${project.contractorName}` : ''}
            </p>
          </div>
          <OpenProjectButton id={id} isOpen={isOpen} />
        </header>

        <dl className="animate-enter stagger-1 mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label} className="rounded-xl border bg-card p-3.5">
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                <f.icon className="size-3.5" />
                {f.label}
              </dt>
              <dd className="mt-1.5 text-xl font-semibold tabular-nums">{f.value}</dd>
              <dd className="mt-0.5 text-[11px] text-muted-foreground">{f.sub}</dd>
            </div>
          ))}
        </dl>

        {/* Said plainly rather than mocked up. The sheet is the next thing
            built here, and a dead grid would only teach people to distrust it. */}
        <section className="animate-enter stagger-2 mt-4 rounded-xl border border-dashed bg-card p-6">
          <h2 className="text-sm font-semibold">The schedule sheet goes here</h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Six columns — row, task, duration, start, finish, price — with the Gantt beside them and
            a divider you can drag. Type any of duration, start or finish and the other two follow.
            It is being built next; nothing about this project is lost in the meantime.
          </p>
        </section>
      </div>
    </RouteTransition>
  );
}

function fmt(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.parse(`${isoDate}T00:00:00Z`));
}
