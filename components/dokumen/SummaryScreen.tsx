import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, CircleSlash, Clock, Inbox, Send, ShieldCheck, TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
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
 * **One theme, no exceptions.** The first version of this screen led with a
 * near-black slab carrying a huge number and a hole of empty space beneath it,
 * and painted its status chips in saturated `-600` fills. Neither belonged to
 * this app: the slab was a colour the theme does not define, and the chips were
 * a second status palette beside the soft tinted pairs every other screen uses.
 * Everything here is now built from the shadcn surface tokens — `bg-card`,
 * `border`, `muted`, `secondary` — with the weekly report's own
 * `emerald-100/700`, `red-100/700`, `amber-100/700` pairs for status, so a
 * reader moving between the two screens stays inside one visual language.
 *
 * The focal anchor is the ring: a page needs one place the eye lands first, and
 * with the slab gone the ring is what carries that job while still living on a
 * plain card. Beside it a divided rail names the things the ring is made of, so
 * no zone of the card is empty.
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

/**
 * The app's status palette, and nothing else.
 *
 * Written out rather than composed, because Tailwind reads these files as text
 * and a class built from a variable at runtime never reaches the stylesheet.
 * The pairs are lifted from `SummaryCards` on the weekly report so the two
 * screens agree on what green and red look like.
 */
const TREND: Record<RegisterNode['trend'], { label: string; chip: string; bar: string }> = {
  ahead: {
    label: 'ahead of plan', chip: 'bg-emerald-100 text-emerald-700',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
  },
  'on-track': {
    label: 'on plan', chip: 'bg-emerald-100 text-emerald-700',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
  },
  slipping: {
    label: 'slipping', chip: 'bg-amber-100 text-amber-700',
    bar: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  },
  behind: {
    label: 'behind plan', chip: 'bg-red-100 text-red-700',
    bar: '[&_[data-slot=progress-indicator]]:bg-red-500',
  },
  unplanned: {
    label: 'no promised dates', chip: 'bg-muted text-muted-foreground',
    bar: '[&_[data-slot=progress-indicator]]:bg-primary',
  },
};

const OBSTACLE: Record<Obstacle['kind'], {
  heading: string; blurb: string; chip: string; tone: string; icon: typeof AlertTriangle;
}> = {
  returned: {
    heading: 'Came back with comments',
    blurb: 'The reviewer sent it back and it has not been approved since.',
    chip: 'bg-red-100 text-red-700', tone: 'text-red-600', icon: AlertTriangle,
  },
  overdue: {
    heading: 'Past the date it was promised',
    blurb: 'The date in the register has gone by and it is still not out.',
    chip: 'bg-amber-100 text-amber-700', tone: 'text-amber-600', icon: Clock,
  },
  untouched: {
    heading: 'Never sent at all',
    blurb: 'Nothing has left for this document at any stage.',
    chip: 'bg-muted text-muted-foreground', tone: 'text-muted-foreground', icon: CircleSlash,
  },
};

const MOVEMENT = {
  submitted: { label: 'Sent out', chip: 'bg-secondary text-secondary-foreground', tone: 'text-foreground', icon: Send },
  returned: { label: 'Came back with comments', chip: 'bg-red-100 text-red-700', tone: 'text-red-600', icon: Inbox },
  approved: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-700', tone: 'text-emerald-600', icon: ShieldCheck },
} as const;

const OBSTACLES_SHOWN = 8;
const MOVEMENTS_SHOWN = 6;
const NAMES_SHOWN = 12;

/**
 * The ring the eye lands on.
 *
 * Hand-drawn rather than a charting library: it is one arc, it has to inherit
 * the theme's own foreground colour, and it must not animate its stroke — a
 * `pathLength` tween is implemented with stroke-dasharray and would fight the
 * dash offset this uses. It fades in with everything else instead.
 */
function Ring({ value, caption }: { value: number; caption: string }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <svg viewBox="0 0 128 128" className="h-36 w-36 -rotate-90" aria-hidden>
        <circle cx="64" cy="64" r={R} fill="none" strokeWidth="12" className="stroke-muted" />
        <circle
          cx="64" cy="64" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
          className="stroke-foreground"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(100, Math.max(0, value)) / 100)}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-semibold leading-none tracking-tight">
          <CountUp value={value} decimals={1} />
        </span>
        <span className="mt-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          {caption}
        </span>
      </div>
    </div>
  );
}

/** One cell of the rail beside the ring. Every zone gets a name. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-2">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="truncate text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

/** One heading, one sentence — every block on this screen opens the same way. */
function BlockHeading({ step, title, blurb }: { step: string; title: string; blurb: string }) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums text-secondary-foreground">
          {step}
        </span>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
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
          <Card className="py-0 mt-6 border-amber-200 bg-amber-50 shadow-none">
            <CardContent className="flex items-start gap-3 p-4 text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm leading-relaxed">
                <span className="font-semibold">
                  This register has not moved since week {summary.evidenceWeek}
                  {' '}({longDate(summary.evidenceDate)}).
                </span>{' '}
                You are looking at week {summary.asOfWeek}, so everything below is still week{' '}
                {summary.evidenceWeek}’s picture — nothing new has been filed since.
              </p>
            </CardContent>
          </Card>
        </Reveal>
      )}

      {/* ============================================ 1 · where it stands */}
      <section className="mt-8">
        <Reveal>
          <BlockHeading
            step="1"
            title="Where it stands"
            blurb="Every figure here is counted from the dates in the register — nothing is typed in. A document earns its share of the total stage by stage, so one that is only out for review counts for less than one already approved."
          />
        </Reveal>

        {/* One card, two zones, both full. The version before this was a grid
            of three cards whose tallest column left the others with a hole of
            empty space under their last line — the same emptiness the dark
            slab had, just repainted. A single divided surface cannot have
            that: each zone is as tall as the card, and the card is as tall as
            its fullest zone. */}
        <Reveal delay={0.04}>
          <Card className="py-0 overflow-hidden shadow-sm">
            <CardContent className="flex flex-col divide-y p-0 lg:flex-row lg:divide-x lg:divide-y-0">
              {/* ---------------------------------------- the anchor zone */}
              <div className="flex flex-col gap-5 p-5 sm:p-6 lg:w-[42%]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                    {isEdl ? 'Engineering documents' : 'Vendor documents'}
                  </span>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    week {summary.asOfWeek}
                  </Badge>
                </div>

                {/* Ring above a three-cell rail rather than beside a two-cell
                    one: side by side left the bottom half of this zone empty
                    whenever the readings opposite ran long, and an empty half
                    is what the reader reads as unfinished. */}
                <div className="flex flex-1 flex-col justify-center gap-5">
                  <div className="flex justify-center">
                    <Ring value={summary.actual} caption="done" />
                  </div>
                  <div className="flex divide-x rounded-lg border bg-muted/40 py-3">
                    <Stat label="Documents" value={String(summary.documents)} />
                    <Stat
                      label={groupNoun.replace(/^./, (c) => c.toUpperCase())}
                      value={String(groups.length)}
                    />
                    <Stat label="Still open" value={String(obstacles.length)} />
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground">
                  Counted as it stood on{' '}
                  <span className="font-medium text-foreground">{longDate(summary.evidenceDate)}</span>
                  {summary.numbered < summary.documents && (
                    <> · {summary.documents - summary.numbered} still have no document number</>
                  )}
                </p>
              </div>

              {/* ------------------------------------------ the two readings */}
              <div className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
                {summary.plan !== null ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                        Against what was promised
                      </p>
                      <Badge className={cn('shrink-0 font-normal', TREND[
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
                      . It is{' '}
                      {(summary.deviation ?? 0) < -0.05 ? (
                        <>
                          <span className="font-semibold tabular-nums text-red-600">
                            {Math.abs(summary.deviation ?? 0).toFixed(1)}%
                          </span> short of that.
                        </>
                      ) : (
                        <>where it should be.</>
                      )}{' '}
                      <span className="text-muted-foreground">
                        {obstacles.length} of {summary.documents} documents are still open — the
                        third block below names them.
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
                        Against what was promised
                      </p>
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        no promised dates
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed">
                      Not one vendor gave a submission date, so there is nothing to compare this
                      against — and none is invented here. What the register does say:{' '}
                      <span className="font-semibold tabular-nums">{summary.untouched}</span> of{' '}
                      <span className="tabular-nums">{summary.documents}</span> documents have
                      never been sent at all.{' '}
                      <span className="text-muted-foreground">
                        Chasing those dates is what would give this register a plan curve.
                      </span>
                    </p>
                  </div>
                )}

                <Separator />

                <div className="flex flex-col gap-3.5">
                  <p className="text-[0.65rem] font-medium uppercase tracking-widest text-muted-foreground">
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
                        className="h-2 [&_[data-slot=progress-indicator]]:bg-foreground"
                      />
                    </div>
                  ))}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Each step is worth{' '}
                    {summary.stages.map((s) => `${s.weight.toFixed(0)}%`).join(' / ')} of a
                    document’s progress, in that order.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Reveal>
        {/* -------------------------------------- the seam to the weekly */}
        {bridge && <EngineeringSeam bridge={bridge} />}

        {/* ---------------------------------------------- the breakdown */}
        <Reveal delay={0.22}>
          <div className="mt-8 flex flex-col gap-1.5">
            <h3 className="text-base font-semibold tracking-tight">{groupsTitle}</h3>
            <p className="max-w-3xl text-sm text-muted-foreground">{groupsBlurb}</p>
          </div>
        </Reveal>

        {foldEmptyGroups && (
          <Reveal delay={0.24}>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary" className="font-normal">{moving.length} under way</Badge>
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
            <p className="mt-4 text-sm text-muted-foreground">Nothing here has been started yet.</p>
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
                        <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', m.chip)}>
                            <Icon className="h-4 w-4" />
                          </span>
                          {m.label}
                        </span>
                        <span className="text-2xl font-semibold tabular-nums">{movement[kind]}</span>
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
                return (
                  <Reveal key={`${e.documentId}-${e.stage}-${e.kind}`} delay={0.26 + Math.min(i, 6) * 0.03}>
                    <Card className="py-0 shadow-sm">
                      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {e.docNo && <span className="font-mono text-xs font-medium">{e.docNo}</span>}
                            <Badge className={cn('font-normal', m.chip)}>
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
                <p className="text-sm font-semibold">Nothing moved in week {summary.asOfWeek}.</p>
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
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', o.chip)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-3xl font-semibold leading-none tabular-nums">
                          {b.value}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{o.heading}</span>
                        <p className="text-xs leading-relaxed text-muted-foreground">{o.blurb}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {obstacles.slice(0, OBSTACLES_SHOWN).map((o, i) => {
              const kind = OBSTACLE[o.kind];
              return (
                <Reveal key={o.documentId} delay={0.24 + Math.min(i, 6) * 0.03}>
                  <Card className="py-0 shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
                    <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {o.docNo && <span className="font-mono text-xs font-medium">{o.docNo}</span>}
                          {o.stage && (
                            <Badge variant="outline" className="font-normal">{STAGE_LABEL[o.stage]}</Badge>
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
                          <span className="font-medium tabular-nums">{o.days} days waiting</span>
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
function EngineeringSeam({ bridge }: { bridge: EngineeringBridge }) {
  const gap = bridge.registerPercent - bridge.typedPercent;
  const agrees = Math.abs(gap) < 0.05;

  return (
    <Reveal delay={0.2}>
      <Card className="py-0 mt-4 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold tracking-tight">
              This is the same work the weekly report counts
            </h3>
            <p className="max-w-3xl text-sm text-muted-foreground">
              The weekly report measures engineering as {bridge.disciplines} disciplines with a
              typed-in percentage; this register measures it as {bridge.documents} documents with
              dates.{' '}
              {bridge.linked > 0
                ? `${bridge.linked} of ${bridge.disciplines} disciplines already take their figure from here.`
                : 'None of them takes its figure from here yet.'}
            </p>
          </div>

          <div className="flex flex-col divide-y rounded-lg border sm:flex-row sm:divide-x sm:divide-y-0">
            <div className="flex-1 p-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Typed into the weekly report{bridge.wbsWeek !== null && ` · week ${bridge.wbsWeek}`}
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                {bridge.typedPercent.toFixed(1)}%
              </p>
            </div>
            <div className="flex-1 p-4">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Counted from this register
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
                {agrees ? 'The two agree' : 'The two disagree by'}
              </p>
              <p className={cn(
                'mt-1.5 text-2xl font-semibold tabular-nums',
                agrees ? 'text-emerald-600' : 'text-amber-700',
              )}>
                {agrees ? 'in step' : `${signed(gap, 1)}%`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link
              href={`/weekly/${bridge.weekNo}/summary`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
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
