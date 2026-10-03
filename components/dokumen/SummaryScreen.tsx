import { ScrollReveal } from '@/components/motion/ScrollReveal';
import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Reveal } from '@/components/motion/Reveal';
import { CountUp } from '@/components/motion/CountUp';
import { RegisterCurve } from '@/components/dokumen/RegisterCurve';
import { OutstandingBlock } from '@/components/dokumen/OutstandingBlock';
import { r1, verdict } from '@/components/dokumen/verdict';
import {
  STAGE_FULL, STAGE_LABEL,
  type EngineeringBridge, type Obstacle, type RegisterNode, type RegisterSummary,
  type WeekMovement,
} from '@/lib/register';
import { cn } from '@/lib/utils';

/**
 * The register in four blocks: where it stands, what is outstanding, each
 * discipline, and the week.
 *
 * Two rules hold the whole screen together.
 *
 * **ACTUAL IS BLUE, PLAN IS RED, AND BOTH ARE ALWAYS DRAWN.** The convention
 * comes from `SCurveClient` — `#3b82f6` and `#ef4444` — and a reader who
 * learned it on the S-curve must not relearn it here. Each gets its own track:
 * concentric arcs in the ring, stacked bars in the meter. A one-pixel plan
 * marker encoded the same fact and nobody could see it; painting the two on one
 * track made the plan vanish outright whenever the work ran ahead of it.
 *
 * **The screen shows, it does not lecture.** An earlier pass gave every block a
 * paragraph of explanation and every count a sentence of its own; together they
 * buried the figures they were meant to introduce. Labels are two or three
 * words, each number is stated exactly once, and anything a chart already shows
 * is not also written out.
 *
 * One shape serves both registers. The EDL has promised dates, so it has a plan
 * and a shortfall; the VDRL has none — no vendor gave one — so it shows no red
 * anywhere rather than inventing a baseline to draw.
 */

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
      })
    : '—';

const signed = (n: number, decimals = 1) =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(decimals)}`;

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Full within rounding — the curve lands exactly on 1.0, so 99.995 is 100. */
const isFull = (n: number) => n >= 99.995;

/**
 * The verdict palette: what a chip says, never what a bar is painted.
 *
 * Two colour jobs run side by side and mixing them is what makes a chart
 * unreadable. A chip answers "is this all right?" in the weekly report's own
 * tinted pairs. A bar answers "how far, against what was promised?" in blue and
 * red. A bar coloured by verdict cannot also say where the plan is, so bars are
 * never coloured by trend. Written out because Tailwind reads files as text.
 */
const MOVEMENT = {
  submitted: { label: 'Sent out', chip: 'bg-blue-100 text-blue-700' },
  returned: { label: 'Returned', chip: 'bg-red-100 text-red-700' },
  approved: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-700' },
} as const;

const NAMES_SHOWN = 10;

/* ------------------------------------------------------------ primitives */

/**
 * The ring: two concentric arcs, actual inside and plan outside.
 *
 * They were stacked on one radius at first — red to the plan, blue painted over
 * it — which drew the shortfall beautifully and then vanished the moment the
 * work ran ahead of plan, because blue simply covered every pixel of red. A
 * baseline that disappears exactly when you are winning is not a baseline. On
 * two radii both are always visible and the comparison is the arc lengths.
 *
 * Hand-drawn rather than a charting library: it is two arcs, it has to take the
 * app's own blue and red, and its stroke must not be tweened — framer-motion
 * implements `pathLength` with stroke-dasharray and would fight the dash offset
 * the arcs are made of.
 */
function Ring({ actual, plan }: { actual: number; plan: number | null }) {
  const arc = (r: number, pct: number) => {
    const c = 2 * Math.PI * r;
    return { strokeDasharray: c, strokeDashoffset: c * (1 - clamp(pct) / 100) };
  };
  const ACTUAL_R = 44;
  const PLAN_R = 58;

  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <svg viewBox="0 0 128 128" className="h-40 w-40 -rotate-90" aria-hidden>
        {plan !== null && (
          <>
            <circle cx="64" cy="64" r={PLAN_R} fill="none" strokeWidth="6" className="stroke-muted" />
            <circle
              cx="64" cy="64" r={PLAN_R} fill="none" strokeWidth="6" strokeLinecap="round"
              className="stroke-red-500" {...arc(PLAN_R, plan)}
            />
          </>
        )}
        <circle cx="64" cy="64" r={ACTUAL_R} fill="none" strokeWidth="13" className="stroke-muted" />
        {/* ONLY THE ACTUAL SWEEPS. The plan ring above stands still, which is
            the same call the hero gauge in WbsTreeVisual makes and for the same
            reason: standing still it states the target first, and the actual
            then runs at it and stops short, so the shortfall is something you
            watch happen rather than a gap you find afterwards. Sweeping both
            would race them, and on a week that is behind, the one thing worth
            seeing is exactly the distance between the two.

            `--ring-c` is the circumference the keyframe counts back from; the
            offset in the markup is already the true one. */}
        <circle
          cx="64" cy="64" r={ACTUAL_R} fill="none" strokeWidth="13" strokeLinecap="round"
          className="animate-ring-draw stroke-blue-500"
          style={{ '--ring-c': 2 * Math.PI * ACTUAL_R } as React.CSSProperties}
          {...arc(ACTUAL_R, actual)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-semibold leading-none tracking-tight text-blue-600">
          <CountUp value={actual} decimals={1} />
        </span>
        <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
          done
        </span>
      </div>
    </div>
  );
}

/**
 * The ring laid flat: actual above, plan on its own track below.
 *
 * Two tracks for the same reason the ring has two radii — one track hides the
 * plan completely whenever the work is ahead of it. Same left edge and same
 * scale, so the two ends can be read against each other at a glance.
 */
function Meter({ actual, plan, delay = 0 }: { actual: number; plan?: number | null; delay?: number }) {
  return (
    <div className="flex w-full flex-col gap-1">
      {/* Both tracks grow, the plan a beat behind the actual, so the gap between
          the two ends is something you watch open rather than a difference you
          have to go looking for. The widths in the markup are already the real
          ones — the keyframe only scales X — so nothing here depends on the
          bundle arriving. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full animate-bar-grow rounded-full bg-blue-500"
          style={{ width: `${clamp(actual)}%`, animationDelay: delay ? `${delay}s` : undefined }}
        />
      </div>
      {plan != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full animate-bar-grow rounded-full bg-red-500"
            style={{ width: `${clamp(plan)}%`, animationDelay: `${delay + 0.12}s` }}
          />
        </div>
      )}
    </div>
  );
}

/** Blue key, red key. Two words each — the numbers live elsewhere. */
function Key({ hasPlan }: { hasPlan: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        <span className="font-medium text-blue-600">Actual</span>
      </span>
      {hasPlan && (
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="font-medium text-red-600">Plan</span>
        </span>
      )}
    </div>
  );
}

function BlockHeading({ step, title, aside, extra }: {
  step: string; title: string; aside?: string; extra?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-secondary-foreground">
        {step}
      </span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {aside && <span className="text-sm text-muted-foreground">{aside}</span>}
      {extra}
    </div>
  );
}

/* ---------------------------------------------------------------- screen */

/**
 * Four blocks since 3 Oct 2026, tidied with the user from a screen they liked
 * the look of and found crowded: where it stands, what is outstanding, each
 * discipline, the week. Gone: the stat strip (documents, disciplines, still
 * open), the "Against plan" box (its verdict was wrong and its figure is now
 * the line under the ring), "As at" (the register's last entry, not the week
 * being viewed), the six-event list (the Log tab has them) and the stage
 * weights (a contract setting, now on the Data screen).
 */
export function SummaryScreen({
  summary,
  groups,
  obstacles,
  movement,
  bridge,
  groupsTitle,
  /** Vendor packages get folded by status; six disciplines do not need it. */
  foldEmptyGroups = false,
}: {
  summary: RegisterSummary;
  groups: RegisterNode[];
  obstacles: Obstacle[];
  movement: WeekMovement | null;
  /** The seam to the weekly report. EDL only — the VDRL feeds no WBS leaf. */
  bridge?: EngineeringBridge | null;
  groupsTitle: string;
  foldEmptyGroups?: boolean;
}) {
  const isEdl = summary.register === 'edl';
  const stale = summary.evidenceWeek < summary.asOfWeek;
  const hasPlan = summary.plan !== null;

  // Taken between the printed figures, so the line adds up on a calculator.
  const previous = summary.actual - summary.thisWeek;
  const gained = r1(r1(summary.actual) - r1(previous));
  const against = hasPlan ? verdict(summary.actual, summary.plan!) : null;

  // Most behind first: the discipline that needs a push is the first one read.
  // A discipline with no planned dates has nothing to be behind, so it goes last.
  const ranked = foldEmptyGroups
    ? groups
    : [...groups].sort((a, b) => {
      if (a.plan === null || b.plan === null) return (a.plan === null ? 1 : 0) - (b.plan === null ? 1 : 0);
      return verdict(a.actual, a.plan).diff - verdict(b.actual, b.plan).diff;
    });
  const moving = foldEmptyGroups ? groups.filter((g) => g.actual > 0 && !isFull(g.actual)) : ranked;
  const done = foldEmptyGroups ? groups.filter((g) => isFull(g.actual)) : [];
  const idle = foldEmptyGroups ? groups.filter((g) => g.actual === 0) : [];

  const moved = movement ? movement.submitted + movement.returned + movement.approved : 0;

  return (
    <div className="pb-4">
      {stale && (
        <Reveal>
          <Card className="py-0 border-amber-200 bg-amber-50 shadow-none">
            <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-900">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <p>
                <span className="font-semibold">
                  Nothing filed since week {summary.evidenceWeek}
                </span>{' '}
                ({longDate(summary.evidenceDate)}). You are viewing week {summary.asOfWeek}.
              </p>
            </CardContent>
          </Card>
        </Reveal>
      )}

      {/* ============================================ 1 · where it stands */}
      <section className={cn(stale && 'mt-4')}>
        <Reveal>
          <BlockHeading step="1" title="Where it stands" />
        </Reveal>

        <Reveal delay={0.04}>
          <Card className="py-0 overflow-hidden shadow-sm">
            <CardContent className="flex flex-col divide-y p-0 lg:flex-row lg:divide-x lg:divide-y-0">
              <div className="flex flex-col items-center gap-4 p-5 sm:p-6 lg:w-[42%]">
                <span className="self-start text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                  {isEdl ? 'Engineering documents' : 'Vendor documents'}
                </span>
                <Ring actual={summary.actual} plan={summary.plan} />
                <Key hasPlan={hasPlan} />
                <p className="text-center text-sm tabular-nums">
                  {against ? (
                    <>
                      <span className="text-red-600">Plan {summary.plan!.toFixed(1)}%</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className={cn('font-semibold', against.diff < 0 ? 'text-red-600' : against.diff > 0 ? 'text-emerald-600' : '')}>
                        {against.label}
                      </span>
                      <span className="text-muted-foreground"> · </span>
                    </>
                  ) : null}
                  <span className="font-semibold text-blue-600">{signed(gained)}</span> this week
                  {!hasPlan && (
                    <>
                      <span className="text-muted-foreground"> · </span>
                      {summary.untouched} of {summary.documents} never sent
                    </>
                  )}
                </p>
              </div>

              {/* flex-1 so the three bars spread down the zone instead of
                  stacking at the top and leaving a tail of empty card. */}
              <div className="flex flex-1 flex-col justify-between gap-3.5 p-5 sm:p-6">
                <p className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                  How far they have got
                </p>
                {summary.stages.map((s, i) => (
                  <div key={s.stage} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">
                        {STAGE_FULL[s.stage]}
                        <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                          {STAGE_LABEL[s.stage]}
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.reached} of {summary.documents}
                      </span>
                    </div>
                    {/* IFR, then IFA, then AFC, a tenth of a second apart, so
                        the three read as one sweep down the stages. */}
                    <Meter actual={(s.reached / summary.documents) * 100} delay={i * 0.1} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </Reveal>

        {bridge && <EngineeringSeam bridge={bridge} />}
      </section>

      {/* ============================================== 2 · outstanding */}
      <section className="mt-10">
        <Reveal delay={0.08}>
          <BlockHeading step="2" title="Outstanding" />
        </Reveal>
        <Reveal delay={0.12}>
          <OutstandingBlock
            obstacles={obstacles}
            register={summary.register}
            week={summary.asOfWeek}
            asOfDate={summary.asOfDate}
            awaiting={summary.awaiting}
            longestWait={summary.longestWait}
          />
        </Reveal>
      </section>

      {/* ============================================ 3 · by discipline */}
      <ScrollReveal>
      <section className="mt-10">
        <Reveal delay={0.06}>
          <BlockHeading
            step="3"
            title={groupsTitle}
            extra={foldEmptyGroups ? (
              <>
                <Badge variant="secondary" className="font-normal">{moving.length} under way</Badge>
                <Badge variant="secondary" className="font-normal">{idle.length} not started</Badge>
                {done.length > 0 && (
                  <Badge variant="secondary" className="font-normal">{done.length} complete</Badge>
                )}
              </>
            ) : hasPlan ? (
              <span className="text-sm text-muted-foreground">Most behind first</span>
            ) : null}
          />
        </Reveal>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {moving.map((g, i) => (
            <Reveal key={g.id} delay={0.1 + Math.min(i, 8) * 0.02}>
              <GroupCard group={g} />
            </Reveal>
          ))}
        </div>

        {idle.length > 0 && (
          <Reveal delay={0.2}>
            <Card className="py-0 mt-3 border-dashed shadow-none">
              <CardContent className="flex flex-col gap-3 p-5">
                <p className="text-sm font-semibold">
                  {idle.length} packages have sent nothing:{' '}
                  {idle.reduce((a, g) => a + g.documents, 0)} documents owed
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {idle.slice(0, NAMES_SHOWN).map((g) => (
                    <Badge key={g.id} variant="secondary" className="max-w-full font-normal">
                      <span className="truncate">{g.name}</span>
                      <span className="ml-1.5 shrink-0 tabular-nums text-muted-foreground">
                        {g.documents}
                      </span>
                    </Badge>
                  ))}
                  {idle.length > NAMES_SHOWN && (
                    <Badge variant="outline" className="font-normal">
                      +{idle.length - NAMES_SHOWN} more
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Reveal>
        )}
      </section>
      </ScrollReveal>

      {/* =================================================== 4 · the week */}
      <ScrollReveal>
      <section className="mt-10">
        <Reveal delay={0.06}>
          <BlockHeading
            step="4"
            title={`Week ${summary.asOfWeek}`}
            aside={movement ? `${shortDate(movement.startDate)} – ${shortDate(movement.endDate)}` : undefined}
          />
        </Reveal>

        {movement && moved > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            {(['submitted', 'returned', 'approved'] as const).map((kind, i) => (
              <Reveal key={kind} delay={0.1 + i * 0.04}>
                <Card className="py-0 h-full shadow-sm">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:p-5">
                    <Badge className={cn('w-fit font-normal', MOVEMENT[kind].chip)}>
                      {MOVEMENT[kind].label}
                    </Badge>
                    <span className="text-2xl font-semibold tabular-nums">{movement[kind]}</span>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        ) : (
          <Reveal delay={0.1}>
            <Card className="py-0 border-dashed shadow-none">
              <CardContent className="p-6 text-sm">
                <span className="font-semibold">Nothing sent, returned or approved.</span>{' '}
                {movement && movement.evidenceWeek < summary.asOfWeek && (
                  <span className="text-muted-foreground">
                    Last movement was week {movement.evidenceWeek}. A stale file, not a quiet week.
                  </span>
                )}
              </CardContent>
            </Card>
          </Reveal>
        )}

        <Reveal delay={0.2}>
          <Card className="py-0 mt-4 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Week by week</h3>
                <span className="text-xs text-muted-foreground">
                  Week {summary.series[0]?.weekNo ?? 1}–
                  {summary.series[summary.series.length - 1]?.weekNo ?? 1}
                </span>
              </div>
              <RegisterCurve
                series={summary.series}
                asOfWeek={summary.asOfWeek}
                undated={summary.undated}
              />
            </CardContent>
          </Card>
        </Reveal>
      </section>
      </ScrollReveal>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

/** The seam to the weekly report — the same work, counted two ways. */
function EngineeringSeam({ bridge }: { bridge: EngineeringBridge }) {
  const gap = bridge.registerPercent - bridge.typedPercent;
  const agrees = Math.abs(gap) < 0.05;

  return (
    <Reveal delay={0.2}>
      <Card className="py-0 mt-4 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
          <h3 className="text-base font-semibold tracking-tight">
            The weekly report counts this same work
          </h3>

          <div className="flex flex-col divide-y rounded-lg border sm:flex-row sm:divide-x sm:divide-y-0">
            <div className="flex-1 p-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Typed in the report{bridge.wbsWeek !== null && ` · week ${bridge.wbsWeek}`}
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                {bridge.typedPercent.toFixed(1)}%
              </p>
            </div>
            <div className="flex-1 p-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Counted here
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                {bridge.registerPercent.toFixed(1)}%
              </p>
            </div>
            <div className={cn('flex-1 p-4', !agrees && 'bg-amber-50')}>
              <p className={cn(
                'text-[0.65rem] font-medium uppercase tracking-wider',
                agrees ? 'text-muted-foreground' : 'text-amber-700',
              )}>
                {agrees ? 'In step' : 'They disagree by'}
              </p>
              <p className={cn(
                'mt-1.5 text-2xl font-semibold tabular-nums',
                agrees ? 'text-emerald-600' : 'text-amber-700',
              )}>
                {agrees ? '—' : `${signed(gap)}%`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              href={`/weekly/${bridge.weekNo}/summary`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
            >
              Week {bridge.weekNo} report
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              {bridge.linked} of {bridge.disciplines} disciplines read from here
            </Link>
          </div>
        </CardContent>
      </Card>
    </Reveal>
  );
}

function GroupCard({ group: g }: { group: RegisterNode }) {
  const v = g.plan !== null ? verdict(g.actual, g.plan) : null;
  return (
    <Card className="py-0 h-full shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{g.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{g.documents} documents</p>
          </div>
          {v && (
            <Badge className={cn('w-24 shrink-0 justify-center font-medium tabular-nums', v.chip)}>{v.label}</Badge>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold tabular-nums text-blue-600">
              {g.actual.toFixed(1)}%
            </span>
            {g.plan !== null && (
              <span className="text-xs tabular-nums text-red-600">
                Plan {g.plan.toFixed(1)}%
              </span>
            )}
          </div>
          <Meter actual={g.actual} plan={g.plan} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
            {g.reached.map((r) => (
              <span key={r.stage} className="tabular-nums">
                {STAGE_LABEL[r.stage]} {r.reached}/{g.documents}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
