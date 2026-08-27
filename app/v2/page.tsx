import { FileText, Layers, TrendingDown, TrendingUp } from 'lucide-react';

import { getProject, getRegisterSummary, getReportedWeek, getWeekSummary } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CountUp, Reveal } from '@/components/v2/Reveal';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Progress v2' };

const PROJECT_ID = 'gundih';

const pct = (n: number, decimals = 2) => `${n.toFixed(decimals).replace('.', ',')}%`;
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2).replace('.', ',')}%`;

const tanggal = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

/**
 * The first screen fed by the v2 database.
 *
 * Everything here comes from `lib/queries.ts` — weights derived from priced BOQ
 * lines, a plan curve derived from dates, actual progress per leaf per week,
 * and the document register. Nothing is read from the JSON store, which is why
 * the figures differ from the rest of the app: the JSON store's actuals stop at
 * week 35 and report 67,19% where the signed report says 80,04%.
 *
 * It is deliberately not a spreadsheet. Four reporting units are four cards,
 * progress is a bar before it is a number, and every figure appears once.
 */
export default function V2Page() {
  const project = getProject(PROJECT_ID);
  const week = project ? getReportedWeek(PROJECT_ID) : null;
  const summary = week ? getWeekSummary(PROJECT_ID, week.weekNo) : null;
  const register = project ? getRegisterSummary(PROJECT_ID) : null;

  if (!project || !summary) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Database v2 masih kosong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Jalankan importernya dulu, lalu muat ulang halaman ini.
        </p>
        <pre className="mt-6 overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-left text-xs text-gray-100">
          node scripts/import-gundih.ts{'\n'}node scripts/import-edl.ts
        </pre>
      </div>
    );
  }

  const { totals } = summary;
  const ahead = totals.deviation >= 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* ---------------------------------------------------------- header */}
      <Reveal>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-blue-600 text-white">Minggu {summary.weekNo}</Badge>
            <Badge variant="secondary">{summary.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {tanggal(summary.startDate)} — {tanggal(summary.endDate)}
            </span>
          </div>
          <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {project.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {project.clientName} · {project.contractorName}
          </p>
        </div>
      </Reveal>

      {/* ------------------------------------------------------------ hero */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Aktual', value: totals.actual, tone: 'ink' as const, note: 'progress terukur' },
          { label: 'Rencana', value: totals.targetContractual, tone: 'ink' as const, note: 'baseline kontraktual' },
          {
            label: 'Deviasi',
            value: totals.deviation,
            tone: ahead ? ('good' as const) : ('bad' as const),
            note: ahead ? 'mendahului rencana' : 'tertinggal dari rencana',
          },
        ].map((stat, i) => (
          <Reveal key={stat.label} delay={0.06 * (i + 1)}>
            <Card
              className={cn(
                'h-full border-0 shadow-lg ring-1 ring-black/5',
                stat.tone === 'good' && 'bg-emerald-600 text-white ring-emerald-700/20',
                stat.tone === 'bad' && 'bg-rose-600 text-white ring-rose-700/20',
              )}
            >
              {/* Stacked on a phone the card should be as tall as its content;
                  side by side on a wider screen the three should line up. */}
              <CardContent className="flex h-full flex-col gap-4 p-6 sm:justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs font-medium uppercase tracking-widest',
                      stat.tone === 'ink' ? 'text-muted-foreground' : 'text-white/80',
                    )}
                  >
                    {stat.label}
                  </span>
                  {stat.tone !== 'ink' &&
                    (ahead ? <TrendingUp className="h-4 w-4 text-white/90" /> : <TrendingDown className="h-4 w-4 text-white/90" />)}
                </div>
                <div>
                  <p className="text-4xl font-semibold tracking-tight sm:text-[2.75rem]">
                    {stat.tone === 'ink'
                      ? <CountUp value={stat.value} />
                      : <span className="tabular-nums">{signed(stat.value)}</span>}
                  </p>
                  <p className={cn('mt-1 text-xs', stat.tone === 'ink' ? 'text-muted-foreground' : 'text-white/75')}>
                    {stat.note}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>

      {/* ------------------------------------------------- reporting units */}
      <Reveal delay={0.24}>
        <div className="mt-12 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Unit pelaporan
          </h2>
        </div>
      </Reveal>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {summary.units.map((unit, i) => {
          const unitAhead = unit.deviation >= 0;
          return (
            <Reveal key={unit.code} delay={0.28 + 0.05 * i}>
              <Card className="h-full shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
                <CardHeader className="gap-1">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base font-semibold">{unit.label}</CardTitle>
                    <Badge
                      className={cn(
                        'shrink-0 text-white',
                        unitAhead ? 'bg-emerald-600' : 'bg-rose-600',
                      )}
                    >
                      {signed(unit.deviation)}
                    </Badge>
                  </div>
                  <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{unit.name}</p>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums tracking-tight">
                      {pct(unit.progress, 2)}
                    </span>
                    <span className="text-xs text-muted-foreground">selesai di unit ini</span>
                  </div>

                  <Progress
                    value={unit.progress}
                    className="h-2 [&_[data-slot=progress-indicator]]:bg-blue-600"
                  />

                  <dl className="grid grid-cols-3 gap-3 border-t pt-4 text-xs">
                    {[
                      ['Bobot', pct(unit.bobot)],
                      ['Kontribusi', pct(unit.contribution)],
                      ['Rencana', pct(unit.targetContractual)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            </Reveal>
          );
        })}
      </div>

      {/* ------------------------------------------------------- register */}
      {register && (
        <>
          <Reveal delay={0.5}>
            <div className="mt-12 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Register dokumen
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.55}>
            <Card className="mt-4 shadow-sm">
              <CardContent className="grid gap-6 p-6 sm:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight">
                      {pct(register.progress, 2)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      progress engineering menurut register
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    {[
                      ['Dokumen', register.documents],
                      ['Kategori', register.categories],
                      ['Transmittal', register.transmittals],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="flex flex-col gap-0.5">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-base font-medium tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="flex flex-col gap-3">
                  {register.stages.map((s) => {
                    const share = (s.reached / register.documents) * 100;
                    return (
                      <div key={s.stage} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-medium">
                            {s.stage}
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              bobot {s.weight.toFixed(0)}%
                            </span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {s.reached} / {register.documents}
                          </span>
                        </div>
                        <Progress value={share} className="h-1.5 [&_[data-slot=progress-indicator]]:bg-slate-600" />
                      </div>
                    );
                  })}
                  {register.awaitingComment > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      {register.awaitingComment} dokumen kembali dengan komentar dan belum disetujui.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </Reveal>
        </>
      )}

      <Reveal delay={0.62}>
        <p className="mt-10 text-pretty text-xs leading-relaxed text-muted-foreground">
          Semua angka di halaman ini dibaca dari database v2 — bobot diturunkan dari harga BOQ,
          kurva rencana diturunkan dari tanggal, dan progress aktual tersimpan per leaf per minggu.
          Halaman lain di aplikasi ini masih membaca penyimpanan lama, yang aktualnya berhenti di
          minggu 35.
        </p>
      </Reveal>
    </div>
  );
}
