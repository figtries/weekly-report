import {
  buildNarrative,
  fmtNum,
  fmtPct,
  formatRupiah,
  type Laggard,
  type LookAheadWeek,
  type ProjectHealth,
} from '@/lib/analysis';
import { MOTION, TYPE, verdictOf, verdictText, type Verdict } from '@/lib/design';
import { Reveal } from '@/components/motion/Reveal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ContractValueField from './ContractValueField';

/**
 * The layer the app was missing: what the two S-Curve lines actually mean.
 *
 * Nothing here asks the user for anything (except the contract value, once) —
 * every figure is derived from data already collected, which is why this can
 * exist without adding a single field to anyone's Friday routine.
 *
 * It LIVES WITH THE REPORT, not with the checks. These two were one screen
 * called "Control Panel", where the question "can this week be issued?" sat in
 * a small card between earned value and a look-ahead, and nobody could say what
 * the screen was for. Checking is a gate and belongs to step ②; SPI, earned
 * value, the forecast and the paragraph are things you read once the figures
 * are trusted, which is step ③.
 *
 * Everything visible is shadcn's Card plus the vocabulary in `lib/design.ts`:
 * one heading size, one label size, and green/red only where a figure carries
 * a verdict. Motion is framer-motion's `Reveal` — the hand-rolled
 * `animate-fade-in-up` with per-element `animationDelay` that used to stagger
 * this page is a second animation system, and the app only gets one.
 */

function Stat({
  label,
  value,
  sub,
  verdict = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  verdict?: Verdict;
}) {
  return (
    <Card size="sm" className="h-full gap-2">
      <CardContent>
        <div className={TYPE.statLabel}>{label}</div>
        <div
          className={cn(
            'mt-1.5 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl',
            verdictText[verdict]
          )}
        >
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function WeekAnalysis({
  health,
  laggards,
  lookAhead,
}: {
  health: ProjectHealth;
  laggards: Laggard[];
  lookAhead: LookAheadWeek[];
}) {
  const deviation = verdictOf(health.deviationPct);
  const behind = deviation === 'behind';
  const narrative = buildNarrative(health, laggards);
  const forecast = health.forecastFinishWeek;
  const gap = health.weeksAgainstContract;
  const step = MOTION.stagger;

  return (
    <div className="space-y-4">
      <Reveal>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat
            label="Actual progress"
            value={fmtPct(health.actualPct)}
            sub={`Plan ${fmtPct(health.planPct)}`}
            verdict={deviation}
          />
          <Stat
            label="Deviation"
            value={`${behind ? '−' : '+'}${fmtPct(Math.abs(health.deviationPct))}`}
            sub={behind ? 'Behind schedule' : 'Ahead of schedule'}
            verdict={deviation}
          />
          <Stat
            label="Schedule index"
            value={fmtNum(health.spi, 3)}
            sub={health.spi < 1 ? 'Below 1.00 is behind' : '1.00 or above is on plan'}
            verdict={health.spi < 1 ? 'behind' : 'ahead'}
          />
          <Stat
            label="Earned value"
            value={health.earnedValue !== null ? formatRupiah(health.earnedValue) : '—'}
            sub={health.earnedValue !== null ? 'Value of work done' : 'Fill in the contract value'}
          />
          <Stat
            label="Deferred"
            value={
              health.scheduleVarianceRp !== null
                ? formatRupiah(Math.abs(health.scheduleVarianceRp))
                : '—'
            }
            sub={
              health.scheduleVarianceRp !== null ? 'Gap against plan' : 'Fill in the contract value'
            }
            verdict={
              health.scheduleVarianceRp !== null && health.scheduleVarianceRp > 0
                ? 'behind'
                : 'neutral'
            }
          />
          <Stat
            label="Forecast finish"
            value={forecast !== null ? `Week ${Math.round(forecast)}` : '—'}
            sub={
              gap === null
                ? 'Not enough velocity yet'
                : Math.abs(Math.round(gap)) === 0
                  ? 'Exactly on the contract end'
                  : `${Math.abs(Math.round(gap))} weeks ${gap > 0 ? 'earlier' : 'later'}`
            }
            verdict={gap === null ? 'neutral' : gap >= 0 ? 'ahead' : 'behind'}
          />
        </section>
      </Reveal>

      <Reveal delay={step}>
        <Card>
          <CardContent>
            <ContractValueField value={health.contractValue} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Every item already carries a weight, so earned value is one multiplication away. This
              single field is what lets the report speak in money instead of only percentages.
            </p>
          </CardContent>
        </Card>
      </Reveal>

      {/* Full width now. It used to share a two-column row with the checks
          card, which is how the gate ended up looking like a sibling of the
          prose instead of the thing that decides whether any of this may be
          printed. The checks moved to step ② and this took the row. */}
      <Reveal delay={step * 2}>
        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>This week in a paragraph</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                Written by the app from the rolled-up figures, ready to paste into the report
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="border-l-2 border-chart-1/60 pl-3 text-sm leading-relaxed text-foreground/90">
                {narrative}
              </p>
              <dl className="mt-auto grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Velocity, last 4 weeks</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {fmtPct(health.velocityPerWeek)} / week
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Velocity required</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {fmtPct(health.requiredVelocity)} / week
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </Reveal>

      {lookAhead.length > 0 && (
        <Reveal delay={step * 4}>
          <Card>
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>{lookAhead.length}-week look-ahead</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                Not just the planned target, but stated against the velocity actually being achieved
                lately
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {lookAhead.map((la) => {
                  const hard = la.paceMultiple !== null && la.paceMultiple > 1.5;
                  return (
                    <div key={la.week} className="rounded-xl border bg-muted/30 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">Week {la.week}</span>
                        <span className="text-sm font-semibold tabular-nums">
                          {fmtPct(la.targetPct)}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs text-muted-foreground">
                        Must rise{' '}
                        <strong className="tabular-nums text-foreground">
                          {fmtPct(Math.max(0, la.gapFromNow))}
                        </strong>{' '}
                        from where it stands now
                      </div>
                      <div
                        className={cn(
                          'mt-1 text-xs',
                          hard ? 'font-medium text-warn' : 'text-muted-foreground'
                        )}
                      >
                        {la.paceMultiple === null
                          ? 'Current velocity is not a usable comparison yet'
                          : la.paceMultiple <= 0
                            ? 'Already met'
                            : `Needs ${fmtNum(la.paceMultiple, 1)}× the current average pace`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </Reveal>
      )}

      <Reveal delay={step * 5}>
        <Card className="gap-0">
          <CardHeader className="pb-4">
            <CardTitle className={TYPE.cardTitle}>What is dragging</CardTitle>
            <CardDescription className={TYPE.cardDesc}>
              Sorted by weight-factor deviation, not by percentage. A heavy item running slightly
              late is more dangerous than a light one that has not started
            </CardDescription>
          </CardHeader>
          {laggards.length === 0 ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">Nothing is behind this week&rsquo;s plan.</p>
            </CardContent>
          ) : (
            // Native table, deliberately: this list runs past twenty rows on a
            // real project, and a Radix cell per row is 285 portals.
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-[11px] text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Weight</th>
                    <th className="px-3 py-2 text-right font-medium">Plan</th>
                    <th className="px-3 py-2 text-right font-medium">Actual</th>
                    <th className="px-3 py-2 text-right font-medium">Drag</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {laggards.map((l) => (
                    <tr key={l.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium leading-snug">{l.deskripsi}</div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          {l.wbsCode}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(l.bobot, 3)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(l.planPct, 1)}</td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums', verdictText.behind)}>
                        {fmtPct(l.actualPct, 1)}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums', verdictText.behind)}>
                        {fmtPct(l.varianceWF, 3)}
                      </td>
                      <td className={cn('px-4 py-2.5 text-right tabular-nums', verdictText.behind)}>
                        {l.valueRp !== null ? formatRupiah(l.valueRp) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
