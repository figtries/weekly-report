import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CircleSlash, Clock, Inbox, Send, ShieldCheck, TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CountUp, Reveal } from '@/components/motion/Reveal';
import { RegisterCurve } from '@/components/dokumen/RegisterCurve';
import {
  STAGE_FULL, STAGE_LABEL,
  type EngineeringBridge, type Obstacle, type RegisterNode, type RegisterSummary,
  type WeekMovement,
} from '@/lib/register';
import { cn } from '@/lib/utils';

/**
 * The register, told as three questions in the order anyone actually asks them:
 * where does it stand, what moved this week, and what is holding it up.
 *
 * The screen this replaced answered none of them plainly. It led with a figure
 * nobody could source, printed IFR/IFA/AFC without ever expanding them, sat a
 * settings toggle in the middle of a report, and showed three counts that added
 * to 144 above a list that said 98 — which is the fastest way to lose a
 * reader's trust in every other number on the page. Two rules follow from that:
 *
 * **Every figure gets a sentence.** Not a label, a sentence, in the words the
 * reader would use. A number a controller has to decode is a number the weekly
 * meeting argues about instead of acting on.
 *
 * **A document is counted once.** The blocking counts are read straight off
 * `getObstacles`, which already assigns each document exactly one reason —
 * returned, then overdue, then never sent — so the three always sum to the
 * list beneath them.
 *
 * One shape still serves both registers. The EDL arrives with promised dates,
 * so it gets a plan and a deviation; the VDRL has none — its vendors never gave
 * any — so instead of inventing a baseline it says what it does know.
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

const signed = (n: number, decimals = 2) =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(decimals)}`;

/** Full within rounding — the curve lands exactly on 1.0, so 99.995 is 100. */
const isFull = (n: number) => n >= 99.995;

// Written out rather than composed: Tailwind reads these files as text, so a
// class built from a variable at runtime never reaches the stylesheet.
const TREND: Record<RegisterNode['trend'], { label: string; chip: string; bar: string }> = {
  ahead: {
    label: 'ahead of plan', chip: 'bg-emerald-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  },
  'on-track': {
    label: 'on plan', chip: 'bg-emerald-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  },
  slipping: {
    label: 'slipping', chip: 'bg-amber-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-amber-600',
  },
  behind: {
    label: 'behind plan', chip: 'bg-rose-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-rose-600',
  },
  unplanned: {
    label: 'no promised dates', chip: 'bg-slate-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-blue-600',
  },
};

const OBSTACLE: Record<Obstacle['kind'], {
  heading: string; blurb: string; chip: string; tone: string; icon: typeof AlertTriangle;
}> = {
  returned: {
    heading: 'Came back with comments',
    blurb: 'The reviewer sent it back and it has not been approved since.',
    chip: 'bg-rose-600 text-white', tone: 'text-rose-600', icon: AlertTriangle,
  },
  overdue: {
    heading: 'Past the date it was promised',
    blurb: 'The date in the register has gone by and it is still not out.',
    chip: 'bg-amber-600 text-white', tone: 'text-amber-600', icon: Clock,
  },
  untouched: {
    heading: 'Never sent at all',
    blurb: 'Nothing has left for this document at any stage.',
    chip: 'bg-slate-600 text-white', tone: 'text-slate-600', icon: CircleSlash,
  },
};

const MOVEMENT = {
  submitted: { label: 'Sent out', tone: 'text-blue-600', icon: Send },
  returned: { label: 'Came back with comments', tone: 'text-rose-600', icon: Inbox },
  approved: { label: 'Approved', tone: 'text-emerald-600', icon: ShieldCheck },
} as const;

const OBSTACLES_SHOWN = 8;
const MOVEMENTS_SHOWN = 6;
const NAMES_SHOWN = 12;

/** One heading, one sentence — every block on this screen opens the same way. */
function BlockHeading({ step, title, blurb }: { step: string; title: string; blurb: string }) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="rounded bg-foreground px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums text-background">
          {step}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">{blurb}</p>
    </div>
  );
}

export function SummaryScreen({
  summary,
  groups,
  obstacles,
  movement,
  bridge,
  groupsTitle,
  groupsBlurb,
  groupNoun,
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
  groupsBlurb: string;
  /** What one card below is, plural. The hero counts the same things. */
  groupNoun: string;
  foldEmptyGroups?: boolean;
}) {
  const isEdl = summary.register === 'edl';
  const thing = isEdl ? 'engineering documents' : 'vendor documents';
  const stale = summary.evidenceWeek < summary.asOfWeek;

  // Each document appears in exactly one of these, which is why they sum to the
  // list below them. Counting them separately is what produced 75 + 63 + 6 = 144
  // above a list of 98.
  const blocking = (['returned', 'overdue', 'untouched'] as const).map((kind) => ({
    kind,
    value: obstacles.filter((o) => o.kind === kind).length,
  }));

  // The week the plan expected everything to be through — a date is a far more
  // useful thing to argue about than "−15.59 points".
  const planFullWeek = summary.series.find((p) => p.plan !== null && isFull(p.plan))?.weekNo ?? null;

  const moving = foldEmptyGroups ? groups.filter((g) => g.actual > 0 && !isFull(g.actual)) : groups;
  const done = foldEmptyGroups ? groups.filter((g) => isFull(g.actual)) : [];
  const untouchedGroups = foldEmptyGroups ? groups.filter((g) => g.actual === 0) : [];

  return (
    <div className="pb-16">
      {/* ------------------------------------------------ the honesty band */}
      {stale && (
        <Reveal>
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-sm leading-relaxed">
              <span className="font-semibold">
                This register has not moved since week {summary.evidenceWeek}
                {' '}({longDate(summary.evidenceDate)}).
              </span>{' '}
              You are looking at week {summary.asOfWeek}, so everything below is still week{' '}
              {summary.evidenceWeek}’s picture — nothing new has been filed since.
            </p>
          </div>
        </Reveal>
      )}

      {/* ============================================ 1 · where it stands */}
      <section className="mt-8">
        <Reveal>
          <BlockHeading
            step="1"
            title="Where it stands"
            blurb={`Every figure here is counted from the dates in the register — nothing is typed in. A document earns its share of the total stage by stage, so one that is only out for review counts for less than one already approved.`}
          />
        </Reveal>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Reveal delay={0.04}>
            <Card className="py-0 h-full overflow-hidden border-0 bg-slate-900 text-white shadow-xl ring-1 ring-black/10">
              <CardContent className="flex h-full flex-col justify-between gap-6 p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-xs font-medium uppercase tracking-widest text-white/70">
                    {isEdl ? 'Engineering documents' : 'Vendor documents'}
                  </span>
                  <Badge className="shrink-0 bg-white/15 font-normal text-white hover:bg-white/15">
                    week {summary.asOfWeek}
                  </Badge>
                </div>

                <div>
                  <p className="text-[3.25rem] font-semibold leading-none tracking-tight sm:text-6xl">
                    <CountUp value={summary.actual} />
                  </p>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80">
                    of the work in this register is done, across{' '}
                    {/* Counts the cards below, not the register's leaf
                        categories: a hero that says 76 above a breakdown that
                        shows 15 is the reader's first reason to distrust it. */}
                    <span className="font-medium text-white">{summary.documents} {thing}</span>
                    {' '}in {groups.length} {groupNoun}.
                  </p>
                </div>

                <p className="text-xs leading-relaxed text-white/60">
                  Counted as it stood on {longDate(summary.evidenceDate)}
                  {summary.numbered < summary.documents
                    && ` · ${summary.documents - summary.numbered} still have no document number`}
                </p>
              </CardContent>
            </Card>
          </Reveal>

          <div className="grid gap-4">
            <Reveal delay={0.1}>
              <Card className="py-0 shadow-sm">
                <CardContent className="flex flex-col gap-3 p-6">
                  {summary.plan !== null ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          Against what was promised
                        </p>
                        <Badge className={cn('shrink-0', TREND[
                          summary.deviation === null ? 'unplanned'
                            : summary.deviation >= 1 ? 'ahead'
                            : summary.deviation >= -1 ? 'on-track'
                            : summary.deviation >= -10 ? 'slipping' : 'behind'
                        ].chip)}>
                          {(summary.deviation ?? 0) >= -1 ? 'on plan' : 'behind'}
                        </Badge>
                      </div>
                      <p className="text-sm leading-relaxed">
                        The dates in the register had this work{' '}
                        {planFullWeek !== null && isFull(summary.plan) ? (
                          <>finished by <span className="font-semibold">week {planFullWeek}</span></>
                        ) : (
                          <>at <span className="font-semibold tabular-nums">
                            {summary.plan.toFixed(1)}%
                          </span> by week {summary.asOfWeek}</>
                        )}
                        . It is at{' '}
                        <span className="font-semibold tabular-nums">{summary.actual.toFixed(1)}%</span>
                        {(summary.deviation ?? 0) < -0.05 && (
                          <>
                            {' '}— <span className="font-semibold text-rose-600 tabular-nums">
                              {Math.abs(summary.deviation ?? 0).toFixed(1)}%
                            </span> short.
                          </>
                        )}
                        {(summary.deviation ?? 0) >= -0.05 && <>, so it is where it should be.</>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {obstacles.length} of {summary.documents} documents are still open — the
                        third block below names them.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          Against what was promised
                        </p>
                        <Badge className="shrink-0 bg-slate-600 text-white">no promised dates</Badge>
                      </div>
                      <p className="text-sm leading-relaxed">
                        Not one vendor gave a submission date, so there is nothing to compare this
                        against — and none is invented here. What the register does say:{' '}
                        <span className="font-semibold tabular-nums">{summary.untouched}</span> of{' '}
                        <span className="tabular-nums">{summary.documents}</span> documents have
                        never been sent at all.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Chasing those dates is what would give this register a plan curve.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={0.16}>
              <Card className="py-0 shadow-sm">
                <CardContent className="flex flex-col gap-4 p-6">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    How far they have got
                  </p>
                  {summary.stages.map((s) => (
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
                      <Progress
                        value={(s.reached / summary.documents) * 100}
                        className="h-2 [&_[data-slot=progress-indicator]]:bg-blue-600"
                      />
                    </div>
                  ))}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Each step is worth{' '}
                    {summary.stages.map((s) => `${s.weight.toFixed(0)}%`).join(' / ')} of a
                    document’s progress, in that order.
                  </p>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>

        {/* -------------------------------------- the seam to the weekly */}
        {bridge && <EngineeringSeam bridge={bridge} registerPercent={summary.actual} />}

        {/* ---------------------------------------------- the breakdown */}
        <Reveal delay={0.22}>
          <div className="mt-8 flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{groupsTitle}</h3>
            <p className="max-w-3xl text-sm text-muted-foreground">{groupsBlurb}</p>
          </div>
        </Reveal>

        {foldEmptyGroups && (
          <Reveal delay={0.24}>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary" className="font-normal">
                {moving.length} under way
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {untouchedGroups.length} not started
              </Badge>
              <Badge variant="secondary" className="font-normal">{done.length} complete</Badge>
            </div>
          </Reveal>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {moving.map((g, i) => (
            <Reveal key={g.id} delay={0.26 + Math.min(i, 8) * 0.02}>
              <GroupCard group={g} />
            </Reveal>
          ))}
        </div>

        {moving.length === 0 && (
          <Reveal delay={0.26}>
            <p className="mt-4 text-sm text-muted-foreground">
              Nothing here has been started yet.
            </p>
          </Reveal>
        )}

        {untouchedGroups.length > 0 && (
          <Reveal delay={0.34}>
            <Card className="py-0 mt-3 border-dashed shadow-none">
              <CardContent className="flex flex-col gap-2 p-5">
                <p className="text-sm font-semibold">
                  {untouchedGroups.length} packages have not sent a single document
                </p>
                <p className="text-sm text-muted-foreground">
                  {untouchedGroups.reduce((a, g) => a + g.documents, 0)} documents are owed and none
                  has arrived. These are the vendors to chase first.
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {untouchedGroups.slice(0, NAMES_SHOWN).map((g) => (
                    <Badge key={g.id} variant="secondary" className="max-w-full font-normal">
                      <span className="truncate">{g.name}</span>
                      <span className="ml-1.5 shrink-0 tabular-nums text-muted-foreground">
                        {g.documents}
                      </span>
                    </Badge>
                  ))}
                  {untouchedGroups.length > NAMES_SHOWN && (
                    <Badge variant="outline" className="font-normal">
                      and {untouchedGroups.length - NAMES_SHOWN} more
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Reveal>
        )}

        {done.length > 0 && (
          <Reveal delay={0.36}>
            <p className="mt-3 text-sm text-muted-foreground">
              {done.length} {done.length === 1 ? 'package is' : 'packages are'} fully through:{' '}
              {done.map((g) => g.name).slice(0, NAMES_SHOWN).join(', ')}
              {done.length > NAMES_SHOWN && ` and ${done.length - NAMES_SHOWN} more`}.
            </p>
          </Reveal>
        )}
      </section>

      {/* =========================================== 2 · what moved this week */}
      <section className="mt-12">
        <Reveal delay={0.06}>
          <BlockHeading
            step="2"
            title={`What moved in week ${summary.asOfWeek}`}
            blurb={
              movement
                ? `Everything dated between ${shortDate(movement.startDate)} and ${shortDate(movement.endDate)}. These are the three things that happen to a document, counted from the register itself.`
                : 'Everything dated inside the week you picked.'
            }
          />
        </Reveal>

        {movement && (movement.submitted + movement.returned + movement.approved) > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['submitted', 'returned', 'approved'] as const).map((kind, i) => {
                const m = MOVEMENT[kind];
                const Icon = m.icon;
                return (
                  <Reveal key={kind} delay={0.1 + i * 0.04}>
                    <Card className="py-0 h-full shadow-sm">
                      <CardContent className="flex items-center justify-between gap-3 p-5">
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Icon className={cn('h-4 w-4 shrink-0', m.tone)} />
                          {m.label}
                        </span>
                        <span className={cn('text-2xl font-semibold tabular-nums', m.tone)}>
                          {movement[kind]}
                        </span>
                      </CardContent>
                    </Card>
                  </Reveal>
                );
              })}
            </div>

            <Reveal delay={0.22}>
              <p className="mt-3 text-sm text-muted-foreground">
                The register as a whole moved{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {signed(movement.gain)}%
                </span>{' '}
                over the week.
              </p>
            </Reveal>

            <div className="mt-3 flex flex-col gap-2">
              {movement.events.slice(0, MOVEMENTS_SHOWN).map((e, i) => {
                const m = MOVEMENT[e.kind];
                const Icon = m.icon;
                return (
                  <Reveal key={`${e.documentId}-${e.stage}-${e.kind}`} delay={0.26 + Math.min(i, 6) * 0.03}>
                    <Card className="py-0 shadow-sm">
                      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Icon className={cn('h-3.5 w-3.5 shrink-0', m.tone)} />
                            {e.docNo && <span className="font-mono text-xs font-medium">{e.docNo}</span>}
                            <Badge variant="secondary" className="font-normal">
                              {m.label} · {STAGE_LABEL[e.stage]}
                            </Badge>
                            {e.returnCode && (
                              <Badge variant="outline" className="font-normal">{e.returnCode}</Badge>
                            )}
                          </div>
                          <p className="line-clamp-2 text-sm">{e.title}</p>
                          <p className="text-xs text-muted-foreground">{e.categoryName}</p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {shortDate(e.at)}
                        </span>
                      </CardContent>
                    </Card>
                  </Reveal>
                );
              })}
            </div>

            {movement.events.length > MOVEMENTS_SHOWN && (
              <Reveal delay={0.44}>
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing {MOVEMENTS_SHOWN} of {movement.events.length} movements this week — the
                  Log tab has all of them.
                </p>
              </Reveal>
            )}
          </>
        ) : (
          <Reveal delay={0.1}>
            <Card className="py-0 border-dashed shadow-none">
              <CardContent className="flex flex-col gap-2 p-6">
                <p className="text-sm font-semibold">
                  Nothing moved in week {summary.asOfWeek}.
                </p>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {movement && movement.evidenceWeek < summary.asOfWeek ? (
                    <>
                      No document was sent, returned or approved that week. The last movement in
                      this register was week {movement.evidenceWeek}, on{' '}
                      {longDate(movement.evidenceDate)} — so this is a stale file, not a quiet week.
                    </>
                  ) : (
                    <>No document was sent, returned or approved that week.</>
                  )}
                </p>
              </CardContent>
            </Card>
          </Reveal>
        )}

        <Reveal delay={0.3}>
          <Card className="py-0 mt-4 shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">Week by week, from the start</h3>
                <span className="text-xs text-muted-foreground">
                  week {summary.series[0]?.weekNo ?? 1}–
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

      {/* ========================================= 3 · what is holding it up */}
      {obstacles.length > 0 && (
        <section className="mt-12">
          <Reveal delay={0.06}>
            <BlockHeading
              step="3"
              title="What is holding it up"
              blurb={`${obstacles.length} of ${summary.documents} documents are still open. Each one is counted once, under the worst thing that is true of it, so these three numbers add up to that total exactly.`}
            />
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-3">
            {blocking.map((b, i) => {
              const o = OBSTACLE[b.kind];
              const Icon = o.icon;
              return (
                <Reveal key={b.kind} delay={0.1 + i * 0.04}>
                  <Card className="py-0 h-full shadow-sm">
                    <CardContent className="flex h-full flex-col gap-2 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Icon className={cn('h-4 w-4 shrink-0', o.tone)} />
                          {o.heading}
                        </span>
                        <span className={cn('text-2xl font-semibold leading-none tabular-nums', o.tone)}>
                          {b.value}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{o.blurb}</p>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {obstacles.slice(0, OBSTACLES_SHOWN).map((o, i) => {
              const kind = OBSTACLE[o.kind];
              const Icon = kind.icon;
              return (
                <Reveal key={o.documentId} delay={0.24 + Math.min(i, 6) * 0.03}>
                  <Card className="py-0 shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {o.docNo && <span className="font-mono text-xs font-medium">{o.docNo}</span>}
                          {o.stage && (
                            <Badge variant="secondary" className="font-normal">{STAGE_LABEL[o.stage]}</Badge>
                          )}
                          <Badge className={cn('font-normal', kind.chip)}>
                            {o.returnCode ?? kind.heading}
                          </Badge>
                        </div>
                        {/* Wraps rather than truncates: on a phone a cut-off
                            drawing title is the one thing the reader needed. */}
                        <p className="line-clamp-2 text-sm">{o.title}</p>
                        <p className="text-xs text-muted-foreground">{o.categoryName}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-xs sm:flex-col sm:items-end sm:gap-1">
                        <span className="text-muted-foreground">{shortDate(o.since)}</span>
                        {o.days !== null && (
                          <span className="font-medium tabular-nums">
                            {o.days} days waiting
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>

          {obstacles.length > OBSTACLES_SHOWN && (
            <Reveal delay={0.44}>
              <p className="mt-3 text-xs text-muted-foreground">
                Showing the {OBSTACLES_SHOWN} worst of {obstacles.length} — the ones that came back
                with comments first, then the overdue, then the ones never sent.
              </p>
            </Reveal>
          )}
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

/**
 * The band that ties this register to the weekly report and back.
 *
 * The two screens measure the same engineering work and used to do it without
 * ever naming each other. Whichever one you are reading, the other one's figure
 * for the same week is here, with the gap between them stated rather than left
 * for someone to discover in a meeting.
 */
function EngineeringSeam({
  bridge,
  registerPercent,
}: {
  bridge: EngineeringBridge;
  registerPercent: number;
}) {
  const gap = bridge.registerPercent - bridge.typedPercent;
  const agrees = Math.abs(gap) < 0.05;

  return (
    <Reveal delay={0.2}>
      <Card className="py-0 mt-4 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">This is the same work the weekly report counts</h3>
            <p className="max-w-3xl text-sm text-muted-foreground">
              The weekly report measures engineering as {bridge.disciplines} disciplines with a
              typed-in percentage; this register measures it as {bridge.documents} documents with
              dates.{' '}
              {bridge.linked > 0
                ? `${bridge.linked} of ${bridge.disciplines} disciplines already take their figure from here.`
                : 'None of them takes its figure from here yet.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">
                Typed into the weekly report{bridge.wbsWeek !== null && ` (week ${bridge.wbsWeek})`}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {bridge.typedPercent.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Counted from this register</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {bridge.registerPercent.toFixed(1)}%
              </p>
            </div>
            <div className={cn('rounded-lg border p-4', !agrees && 'border-amber-300 bg-amber-50')}>
              <p className={cn('text-xs', agrees ? 'text-muted-foreground' : 'text-amber-900')}>
                {agrees ? 'The two agree' : 'The two disagree by'}
              </p>
              <p className={cn(
                'mt-1 text-2xl font-semibold tabular-nums',
                agrees ? 'text-emerald-600' : 'text-amber-700',
              )}>
                {agrees ? 'in step' : `${signed(gap, 1)}%`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={`/weekly/${bridge.weekNo}/summary`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline"
            >
              Open the week {bridge.weekNo} report
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              Choose where engineering progress comes from
            </Link>
          </div>

          <p className="sr-only">
            This register is at {registerPercent.toFixed(1)}% overall.
          </p>
        </CardContent>
      </Card>
    </Reveal>
  );
}

function GroupCard({ group: g }: { group: RegisterNode }) {
  const t = TREND[g.trend];
  return (
    <Card className="py-0 h-full shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{g.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{g.documents} documents</p>
          </div>
          {g.trend !== 'unplanned' && (
            <Badge className={cn('shrink-0 font-normal', t.chip)}>{t.label}</Badge>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold tabular-nums">{g.actual.toFixed(1)}% done</span>
            {g.plan !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                promised {g.plan.toFixed(0)}% by now
              </span>
            )}
          </div>
          <div className="relative">
            <Progress value={g.actual} className={cn('h-2', t.bar)} />
            {g.plan !== null && (
              <span
                aria-hidden
                className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground/60"
                style={{ left: `calc(${Math.min(100, Math.max(0, g.plan))}% - 1px)` }}
              />
            )}
          </div>
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
