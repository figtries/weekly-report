import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleAlert, TrendingDown, TrendingUp } from 'lucide-react';
import {
  buildLookAhead,
  computeHealth,
  findLaggards,
  fmtNum,
  fmtPct,
  formatRupiah,
  narrativeParts,
  validateWeek,
} from '@/lib/analysis';
import { getCachedSCurveSeries, getCachedWeekRollup, getDb, getLatestWeek } from '@/lib/data';
import ProgressCurve from '@/components/dashboard/ProgressCurve';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

/**
 * The dashboard is the product's main advantage, so it does not stop at the
 * number — it states the cause.
 *
 * Two rules hold this page together. The hero owns actual, plan, deviation and
 * SPI, and nothing below repeats them; the prose picks up where the hero stops,
 * at what is holding the project back. And the curve is here because it is the
 * one shape this trade reads instinctively — the gap between two lines lands
 * before any percentage does.
 */
export default async function DashboardPage() {
  const db = await getDb();
  const week = getLatestWeek(db) || 1;
  const rollup = await getCachedWeekRollup(week);
  const health = computeHealth(db, week);

  if (!rollup || !health) {
    return (
      <div className="mx-auto max-w-2xl animate-fade-in-up px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Belum ada data progress</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Susun WBS dan bobotnya dulu — setelah itu semua angka di halaman ini terisi sendiri.
        </p>
        <Link
          href="/setup"
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 active:scale-[0.97]"
        >
          Mulai setup proyek <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const laggards = findLaggards(rollup.roots, health.contractValue);
  const validation = validateWeek(db, week);
  const lookAhead = buildLookAhead(db, health);
  const story = narrativeParts(health, laggards);
  const curve = await getCachedSCurveSeries(week);

  const behind = health.deviationPct < 0;
  const urgent = validation.findings.filter((f) => f.level !== 'ok');
  const errors = urgent.filter((f) => f.level === 'error');
  const weeksLeft = Math.max(0, health.lastWeek - health.week);

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-up space-y-4 px-3 py-5 sm:space-y-5 sm:p-6 lg:p-8">
      {/* Hero — dark on purpose. It is the one element that should feel like an
          instrument panel rather than a card, and the curve needs a ground dark
          enough for two thin lines to read against. */}
      <section className="relative overflow-hidden rounded-3xl bg-[#0B1220] text-white shadow-[0_1px_2px_rgba(0,0,0,.06),0_24px_48px_-24px_rgba(11,18,32,.55)] ring-1 ring-white/10">
        <div className="flex flex-wrap items-start justify-between gap-4 p-6 pb-2 sm:p-8 sm:pb-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
              Minggu {health.week} dari {health.lastWeek} · sisa {weeksLeft} minggu
            </p>
            <p className="mt-2 text-[3.25rem] font-semibold leading-none tracking-tight tabular-nums sm:text-6xl">
              {fmtPct(health.actualPct)}
            </p>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/55">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 rounded bg-current" />
                aktual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-4 border-t border-dashed border-current" />
                rencana {fmtPct(health.planPct)}
              </span>
              <span>SPI {fmtNum(health.spi, 3)}</span>
            </p>
          </div>

          <div className="text-right">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1',
                behind
                  ? 'bg-rose-500/15 text-rose-300 ring-rose-400/25'
                  : 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/25'
              )}
            >
              {behind ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              {fmtPct(Math.abs(health.deviationPct))} {behind ? 'di belakang' : 'di depan'}
            </span>
            {health.scheduleVarianceRp !== null && Math.abs(health.scheduleVarianceRp) > 0 && (
              <p className="mt-2 text-sm text-white/55">
                ≈ {formatRupiah(Math.abs(health.scheduleVarianceRp))}
              </p>
            )}
          </div>
        </div>

        {/* Bleeds to both edges: the curve is the floor of the panel, not a chart
            sitting inside a box inside a box. */}
        <div className={cn('h-28 w-full sm:h-36', behind ? 'text-rose-400' : 'text-emerald-400')}>
          <ProgressCurve rows={curve} className="block h-full w-full" />
        </div>
      </section>

      {/* Picks up exactly where the hero stops — no figure is said twice. */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Yang sebenarnya terjadi
        </h2>
        <p className="mt-2.5 text-[15px] leading-relaxed">
          {story.laggards} {story.forecast}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section
          className={cn(
            'rounded-2xl border bg-card p-5 shadow-sm lg:col-span-2',
            errors.length && 'border-destructive/25'
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Yang genting
            </h2>
            {urgent.length > 0 && (
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                {urgent.length} temuan
              </span>
            )}
          </div>

          {urgent.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Tidak ada temuan. Minggu ini aman untuk diterbitkan.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {urgent.slice(0, 4).map((f, i) => (
                <li key={i} className="flex gap-2.5">
                  {f.level === 'error' ? (
                    <CircleAlert className="mt-[3px] h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-[3px] h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <p className="text-sm font-medium leading-snug">{f.title}</p>
                </li>
              ))}
              {urgent.length > 4 && (
                <li className="pl-[26px] text-sm text-muted-foreground">
                  dan {urgent.length - 4} lainnya
                </li>
              )}
            </ul>
          )}

          {!validation.canIssue && (
            <Link
              href={`/weekly/${week}/control`}
              className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15"
            >
              Belum layak diterbitkan
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </section>

        {/* Ranked by weight-factor variance: an item at 0% of a 3.3% weight costs
            ten times what an item at 0% of a 0.3% weight does, though both read
            as "100% behind". The bar makes that difference visible. */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm lg:col-span-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Penyeret terbesar
          </h2>
          {laggards.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Tidak ada item yang tertinggal.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {laggards.slice(0, 5).map((l) => (
                <li key={l.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">{l.deskripsi}</p>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                      {fmtPct(l.varianceWF)}
                    </span>
                  </div>
                  {/* Fill is what the item HAS reached; the tick is where it was
                      meant to be. A bar sized by variance instead read as "nearly
                      done" on precisely the worst offender. */}
                  <div className="mt-1.5 flex items-center gap-2.5">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                      <div
                        className="h-full rounded-full bg-destructive/60"
                        style={{ width: `${Math.max(0, Math.min(100, l.actualPct))}%` }}
                      />
                      {/* Clamped short of the end: the track is overflow-hidden,
                          so a tick at exactly 100% — the commonest case here —
                          is clipped away entirely. */}
                      <div
                        className="absolute inset-y-0 w-0.5 bg-foreground/45"
                        style={{ left: `${Math.max(0, Math.min(99.2, l.planPct))}%` }}
                        aria-hidden
                      />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {l.wbsCode} · {fmtPct(l.actualPct)} dari {fmtPct(l.planPct)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Laju
          </h2>
          <div className="mt-3 flex items-end gap-6">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{fmtPct(health.velocityPerWeek)}</p>
              <p className="text-xs text-muted-foreground">sekarang, per minggu</p>
            </div>
            <div className="pb-0.5">
              <p className="text-lg font-medium tabular-nums text-muted-foreground">
                {fmtPct(health.requiredVelocity)}
              </p>
              <p className="text-xs text-muted-foreground">dituntut rencana</p>
            </div>
          </div>
          <p className="mt-3 border-t pt-3 text-sm">
            {health.forecastFinishWeek === null ? (
              <span className="text-muted-foreground">Belum bisa diproyeksikan.</span>
            ) : (
              <>
                Selesai di{' '}
                <span className="font-medium">minggu {Math.round(health.forecastFinishWeek)}</span>
                {health.weeksAgainstContract !== null && (
                  <span
                    className={cn(
                      'font-medium',
                      health.weeksAgainstContract >= 0 ? 'text-emerald-600' : 'text-destructive'
                    )}
                  >
                    {' — '}
                    {Math.abs(Math.round(health.weeksAgainstContract))} minggu{' '}
                    {health.weeksAgainstContract >= 0 ? 'lebih cepat' : 'lebih lambat'}
                  </span>
                )}
              </>
            )}
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Yang harus terjadi
            </h2>
            <Link
              href={`/weekly/${week}/input`}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
            >
              Perbarui <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {lookAhead.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Tidak ada minggu berikutnya.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {lookAhead.map((w) => (
                <li key={w.week} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Minggu {w.week}</span>
                  <span className="text-right">
                    <span className="font-medium tabular-nums">+{fmtPct(w.gapFromNow)}</span>
                    {w.paceMultiple !== null && (
                      <span
                        className={cn(
                          'ml-2 text-xs',
                          w.paceMultiple > 1.5 ? 'font-medium text-amber-600' : 'text-muted-foreground'
                        )}
                      >
                        {fmtNum(w.paceMultiple, 1)}× laju sekarang
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
