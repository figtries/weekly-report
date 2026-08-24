import Link from 'next/link';
import { AlertTriangle, ArrowRight, CircleAlert, TrendingDown, TrendingUp } from 'lucide-react';
import {
  buildLookAhead,
  buildNarrative,
  computeHealth,
  findLaggards,
  fmtNum,
  fmtPct,
  formatRupiah,
  validateWeek,
} from '@/lib/analysis';
import { getCachedWeekRollup, getDb, getLatestWeek } from '@/lib/data';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

/**
 * The dashboard is the product's main advantage, so it does not stop at the
 * number — it states the cause.
 *
 * Every piece of this already existed in lib/analysis.ts and had nowhere to
 * live: buildNarrative was written and never rendered anywhere, and the health
 * figures were buried behind a tab called Panel Kendali while `/` redirected
 * past them to a spreadsheet. A number board is something Excel already does.
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
  const narrative = buildNarrative(health, laggards);

  const behind = health.deviationPct < 0;
  const urgent = validation.findings.filter((f) => f.level !== 'ok');
  const pct = Math.max(0, Math.min(100, health.actualPct));
  const planMark = Math.max(0, Math.min(100, health.planPct));

  return (
    <div className="mx-auto max-w-5xl animate-fade-in-up space-y-4 px-3 py-5 sm:space-y-5 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        {/* health.lastWeek is the last week materialised in the PLAN, not the last
            one reported — health.week is that. Saying it the other way round
            told the user their latest report was 24 weeks newer than it is. */}
        <p className="text-sm text-muted-foreground">
          Minggu <span className="font-medium text-foreground">{health.week}</span>
          {health.lastWeek > health.week && ` dari ${health.lastWeek} minggu rencana`}
        </p>
      </header>

      {/* Hero — the state of the project, each number said exactly once. */}
      <section
        className={cn(
          'relative overflow-hidden rounded-2xl border p-5 shadow-sm sm:p-7',
          behind ? 'border-destructive/20 bg-destructive/[0.04]' : 'border-emerald-500/20 bg-emerald-500/[0.04]'
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Progress aktual
            </p>
            <p className="mt-1 text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">
              {fmtPct(health.actualPct)}
            </p>
          </div>
          <div className="text-right">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                behind ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              )}
            >
              {behind ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
              {fmtPct(Math.abs(health.deviationPct))} {behind ? 'di belakang' : 'di depan'}
            </span>
            <p className="mt-1.5 text-xs text-muted-foreground">
              rencana {fmtPct(health.planPct)} · SPI {fmtNum(health.spi, 3)}
            </p>
          </div>
        </div>

        {/* The plan sits as a mark on the bar, so the gap is a distance, not a second number. */}
        <div className="relative mt-5 h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className={cn('h-full rounded-full', behind ? 'bg-destructive' : 'bg-emerald-500')}
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/50"
            style={{ left: `${planMark}%` }}
            aria-hidden
          />
        </div>

        {health.scheduleVarianceRp !== null && Math.abs(health.scheduleVarianceRp) > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Setara{' '}
            <span className="font-medium text-foreground">
              {formatRupiah(Math.abs(health.scheduleVarianceRp))}
            </span>{' '}
            pekerjaan yang {behind ? 'belum terealisasi' : 'terealisasi lebih awal'}.
          </p>
        )}
      </section>

      {/* The sentence — what a number board can never give you. */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Yang sebenarnya terjadi
        </h2>
        <p className="mt-2.5 text-[15px] leading-relaxed">{narrative}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Urgent first: these block issuing the report. */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Yang genting minggu ini
          </h2>
          {urgent.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Tidak ada temuan. Minggu ini aman untuk diterbitkan.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {urgent.slice(0, 5).map((f, i) => (
                <li key={i} className="flex gap-2.5">
                  {f.level === 'error' ? (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-sm text-muted-foreground">{f.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!validation.canIssue && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              Laporan minggu ini belum layak diterbitkan.
            </p>
          )}
        </section>

        {/* Ranked by weight-factor variance — the item that costs the project most. */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Penyeret terbesar
          </h2>
          {laggards.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Tidak ada item yang tertinggal.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {laggards.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{l.deskripsi}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.wbsCode} · bobot {fmtPct(l.bobot)} · baru {fmtPct(l.actualPct)} dari{' '}
                      {fmtPct(l.planPct)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                    {fmtPct(l.varianceWF)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Proyeksi
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Laju sekarang</dt>
              <dd className="font-medium tabular-nums">{fmtPct(health.velocityPerWeek)} / minggu</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Dituntut rencana</dt>
              <dd className="font-medium tabular-nums">{fmtPct(health.requiredVelocity)} / minggu</dd>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2">
              <dt className="text-muted-foreground">Perkiraan selesai</dt>
              <dd className="font-medium tabular-nums">
                {health.forecastFinishWeek === null
                  ? 'belum bisa diproyeksikan'
                  : `minggu ${Math.round(health.forecastFinishWeek)}`}
              </dd>
            </div>
            {health.weeksAgainstContract !== null && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Terhadap kontrak</dt>
                <dd
                  className={cn(
                    'font-medium tabular-nums',
                    health.weeksAgainstContract >= 0 ? 'text-emerald-600' : 'text-destructive'
                  )}
                >
                  {Math.abs(Math.round(health.weeksAgainstContract))} minggu{' '}
                  {health.weeksAgainstContract >= 0 ? 'lebih cepat' : 'lebih lambat'}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Yang harus terjadi
          </h2>
          {lookAhead.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Tidak ada minggu berikutnya di rencana.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {lookAhead.map((w) => (
                <li key={w.week} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Minggu {w.week}</span>
                  <span className="text-right">
                    <span className="font-medium tabular-nums">{fmtPct(w.targetPct)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      +{fmtPct(w.gapFromNow)}
                      {w.paceMultiple !== null && ` · ${fmtNum(w.paceMultiple, 1)}× laju sekarang`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/weekly/${week}/input`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
          >
            Perbarui progress <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
