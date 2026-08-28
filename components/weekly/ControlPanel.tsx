import {
  buildNarrative,
  fmtNum,
  fmtPct,
  formatRupiah,
  type Finding,
  type Laggard,
  type LookAheadWeek,
  type ProjectHealth,
  type ValidationResult,
} from '@/lib/analysis';
import ApprovalPanel from './ApprovalPanel';
import ContractValueField from './ContractValueField';
import type { Approval } from '@/lib/types';

/**
 * The layer the app was missing: what the two S-Curve lines actually mean.
 *
 * Nothing here asks the user for anything (except the contract value, once) —
 * every figure is derived from data already collected, which is why this
 * screen can exist without adding a single field to anyone's Friday routine.
 */

const LEVEL_STYLES: Record<Finding['level'], { chip: string; label: string }> = {
  error: { chip: 'bg-destructive/10 text-destructive', label: 'TOLAK' },
  warn: { chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', label: 'CEK' },
  ok: { chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', label: 'LOLOS' },
};

function Stat({
  label,
  value,
  sub,
  tone = 'plain',
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'plain' | 'good' | 'bad';
  delay?: number;
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-destructive'
      : tone === 'good'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-foreground';
  return (
    <div
      className="animate-fade-in-up rounded-lg border bg-card p-3 sm:p-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`text-xl font-semibold tabular-nums tracking-tight sm:text-2xl ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function ControlPanel({
  health,
  laggards,
  validation,
  lookAhead,
  approval,
}: {
  health: ProjectHealth;
  laggards: Laggard[];
  validation: ValidationResult;
  lookAhead: LookAheadWeek[];
  approval: Approval | null;
}) {
  const behind = health.deviationPct < 0;
  const narrative = buildNarrative(health, laggards);
  const forecast = health.forecastFinishWeek;
  const gap = health.weeksAgainstContract;

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Progress aktual"
          value={fmtPct(health.actualPct)}
          sub={`rencana ${fmtPct(health.planPct)}`}
        />
        <Stat
          label="Deviasi"
          value={`${behind ? '−' : '+'}${fmtPct(Math.abs(health.deviationPct))}`}
          sub={behind ? 'di belakang jadwal' : 'di depan jadwal'}
          tone={behind ? 'bad' : 'good'}
          delay={40}
        />
        <Stat
          label="SPI"
          value={fmtNum(health.spi, 3)}
          sub={health.spi < 1 ? '< 1.00 = behind' : '≥ 1.00 = on plan'}
          tone={health.spi < 1 ? 'bad' : 'good'}
          delay={80}
        />
        <Stat
          label="Earned value"
          value={health.earnedValue !== null ? formatRupiah(health.earnedValue) : '—'}
          sub={health.earnedValue !== null ? 'value of work done' : 'fill in the contract value'}
          delay={120}
        />
        <Stat
          label="Deferred"
          value={
            health.scheduleVarianceRp !== null
              ? formatRupiah(Math.abs(health.scheduleVarianceRp))
              : '—'
          }
          sub={health.scheduleVarianceRp !== null ? 'gap against plan' : 'fill in the contract value'}
          tone={health.scheduleVarianceRp !== null && health.scheduleVarianceRp > 0 ? 'bad' : 'plain'}
          delay={160}
        />
        <Stat
          label="Forecast finish"
          value={forecast !== null ? `Week ${Math.round(forecast)}` : '—'}
          sub={
            gap === null
              ? 'not enough velocity yet'
              : Math.abs(Math.round(gap)) === 0
                ? 'exactly on the contract end'
                : `${Math.abs(Math.round(gap))} weeks ${gap > 0 ? 'earlier' : 'later'}`
          }
          tone={gap === null ? 'plain' : gap >= 0 ? 'good' : 'bad'}
          delay={200}
        />
      </section>

      <section
        className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5"
        style={{ animationDelay: '240ms' }}
      >
        <ContractValueField value={health.contractValue} />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Every item already carries a weight, so earned value is one multiplication away — this
          single field is what lets the report speak in money instead of only percentages.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5"
          style={{ animationDelay: '280ms' }}
        >
          <h2 className="text-sm font-semibold">This week in a paragraph</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Written by the app from the rolled-up figures — ready to paste into the report.
          </p>
          <p className="border-l-2 border-primary/60 pl-3 text-sm leading-relaxed text-foreground/90">
            {narrative}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
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
        </section>

        <section
          className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5"
          style={{ animationDelay: '320ms' }}
        >
          <h2 className="text-sm font-semibold">Checks before issuing</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {validation.errors > 0
              ? `${validation.errors} findings must be fixed`
              : 'Nothing found that holds the report back'}
          </p>

          <ul className="divide-y rounded-md border">
            {validation.findings.map((f, i) => {
              const s = LEVEL_STYLES[f.level];
              return (
                <li key={i} className="flex gap-3 p-3">
                  <span
                    className={`mt-px h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${s.chip}`}
                  >
                    {s.label}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {f.detail}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {!validation.canIssue && (
            <p className="mt-3 rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
              Week {health.week} stays unissued until the findings above are fixed.
            </p>
          )}
        </section>
      </div>

      <ApprovalPanel
        week={health.week}
        currentPct={health.actualPct}
        approval={approval}
        blocked={!validation.canIssue}
      />

      {lookAhead.length > 0 && (
        <section
          className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5"
          style={{ animationDelay: '340ms' }}
        >
          <h2 className="text-sm font-semibold">{lookAhead.length}-week look-ahead</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Not just the planned target — stated against the velocity actually being achieved
            lately.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {lookAhead.map((la) => {
              const hard = la.paceMultiple !== null && la.paceMultiple > 1.5;
              return (
                <div key={la.week} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">Week {la.week}</span>
                    <span className="tabular-nums text-sm">{fmtPct(la.targetPct)}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Must rise{' '}
                    <strong className="tabular-nums text-foreground">
                      {fmtPct(Math.max(0, la.gapFromNow))}
                    </strong>{' '}
                    from where it stands now
                  </div>
                  <div
                    className={`mt-1 text-xs ${hard ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
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
        </section>
      )}

      <section
        className="animate-fade-in-up rounded-lg border bg-card"
        style={{ animationDelay: '360ms' }}
      >
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <h2 className="text-sm font-semibold">What is dragging</h2>
          <p className="text-xs text-muted-foreground">
            Sorted by weight-factor deviation, not by percentage — a heavy item running slightly
            late is more dangerous than a light one that has not started.
          </p>
        </div>
        {laggards.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5 sm:pb-5">
            Nothing is behind this week’s plan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-y bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-destructive">
                      {fmtPct(l.actualPct, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-destructive">
                      {fmtPct(l.varianceWF, 3)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-destructive">
                      {l.valueRp !== null ? formatRupiah(l.valueRp) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
