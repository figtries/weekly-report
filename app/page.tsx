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
import { flattenTree, getSummaryRows, promoteNestedSpkContracts } from '@/lib/rollup';
import { getCachedSCurveSeries, getCachedWeekRollup, getDb, getLatestWeek } from '@/lib/data';
import ProgressCurve from '@/components/dashboard/ProgressCurve';
import {
  ProgressSpread,
  UnitBreakdown,
  VelocityBars,
  type LeafSpread,
} from '@/components/dashboard/charts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

/**
 * The dashboard is the product's main advantage, so it does not stop at the
 * number — it states the cause, and it shows it.
 *
 * Three rules hold this page together. The hero owns actual, plan, deviation
 * and SPI, and nothing below repeats them. Every claim has a picture beside it,
 * because a wall of sentences is something nobody reads twice. And every chart
 * here is hand-drawn SVG rather than Recharts: they are all static, so drawing
 * them by hand keeps them in the prerendered shell instead of appearing after
 * hydration.
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
  const units = getSummaryRows(promoteNestedSpkContracts(rollup.roots));

  // By weight, not by count: a 3.3% leaf and a 0.03% leaf are not equals.
  const spread: LeafSpread = flattenTree(rollup.roots)
    .filter((n) => n.isLeaf && n.bobot > 0)
    .reduce<LeafSpread>(
      (acc, n) => {
        const bucket = n.curProgressPct >= 99.995 ? 'done' : n.curProgressPct > 0 ? 'running' : 'notStarted';
        acc[bucket] += 1;
        acc[`${bucket}Weight` as const] += n.bobot;
        return acc;
      },
      { notStarted: 0, running: 0, done: 0, notStartedWeight: 0, runningWeight: 0, doneWeight: 0 }
    );

  const behind = health.deviationPct < 0;
  const urgent = validation.findings.filter((f) => f.level !== 'ok');
  const errors = urgent.filter((f) => f.level === 'error');
  const weeksLeft = Math.max(0, health.lastWeek - health.week);

  return (
    <div className="mx-auto max-w-6xl animate-fade-in-up space-y-4 px-3 py-5 sm:p-6 lg:p-8">
      {/* Hero — the one element that should read as an instrument panel rather
          than a card. Dark because two thin lines need a ground to sit on. */}
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

        <div className={cn('h-28 w-full sm:h-36', behind ? 'text-rose-400' : 'text-emerald-400')}>
          <ProgressCurve rows={curve} className="block h-full w-full" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* The contract-level view the overall percentage cannot give. */}
        {units.length > 1 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Per kontrak
              </CardTitle>
            </CardHeader>
            <CardContent>
              <UnitBreakdown rows={units} />
            </CardContent>
          </Card>
        )}

        <Card className={cn(units.length > 1 ? '' : 'lg:col-span-2')}>
          <CardHeader>
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Sebaran pekerjaan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressSpread spread={spread} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Tambahan tiap minggu
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VelocityBars rows={curve} />
            <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
              Laju <span className="font-medium text-foreground">{fmtPct(health.velocityPerWeek)}</span> per
              minggu, rencana menuntut{' '}
              <span className="font-medium text-foreground">{fmtPct(health.requiredVelocity)}</span>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Proyeksi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {health.forecastFinishWeek === null ? (
              <p className="text-sm text-muted-foreground">Belum bisa diproyeksikan.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold tabular-nums">
                  minggu {Math.round(health.forecastFinishWeek)}
                </p>
                {health.weeksAgainstContract !== null && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'mt-2',
                      health.weeksAgainstContract >= 0
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-destructive/10 text-destructive'
                    )}
                  >
                    {Math.abs(Math.round(health.weeksAgainstContract))} minggu{' '}
                    {health.weeksAgainstContract >= 0 ? 'lebih cepat' : 'lebih lambat'}
                  </Badge>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  akhir kontrak minggu {health.lastWeek}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className={cn('lg:col-span-2', errors.length && 'border-destructive/25')}>
          <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Yang genting
            </CardTitle>
            {urgent.length > 0 && (
              <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                {urgent.length} temuan
              </span>
            )}
          </CardHeader>
          <CardContent>
            {urgent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada temuan. Minggu ini aman untuk diterbitkan.
              </p>
            ) : (
              <ul className="space-y-2.5">
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
          </CardContent>
        </Card>

        {/* Fill is what the item has reached, the tick is where it should be. A
            bar sized by variance instead read as "nearly done" on precisely the
            worst offender. */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Penyeret terbesar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {laggards.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada item yang tertinggal.</p>
            ) : (
              <ul className="space-y-3">
                {laggards.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium">{l.deskripsi}</p>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                        {fmtPct(l.varianceWF)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                        <div
                          className="h-full rounded-full bg-destructive/60"
                          style={{ width: `${Math.max(0, Math.min(100, l.actualPct))}%` }}
                        />
                        {/* Clamped short of the end: the track is overflow-hidden,
                            so a tick at exactly 100% is clipped away entirely. */}
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
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Yang harus terjadi
            </CardTitle>
            <Link
              href={`/weekly/${week}/input`}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
            >
              Perbarui <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {lookAhead.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada minggu berikutnya.</p>
            ) : (
              <ul className="space-y-2.5">
                {lookAhead.map((w) => (
                  <li key={w.week} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">Minggu {w.week}</span>
                    <span className="text-right">
                      <span className="font-medium tabular-nums">+{fmtPct(w.gapFromNow)}</span>
                      {w.paceMultiple !== null && (
                        <span
                          className={cn(
                            'ml-2 text-xs',
                            w.paceMultiple > 1.5
                              ? 'font-medium text-amber-600'
                              : 'text-muted-foreground'
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
          </CardContent>
        </Card>

        {/* Picks up exactly where the hero stops — no figure is said twice. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Yang sebenarnya terjadi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">{story.laggards}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
