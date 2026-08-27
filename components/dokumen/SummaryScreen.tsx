import { AlertTriangle, ArrowUpRight, CircleSlash, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CountUp, Reveal } from '@/components/motion/Reveal';
import { RegisterCurve } from '@/components/dokumen/RegisterCurve';
import { STAGE_LABEL, type Obstacle, type RegisterNode, type RegisterSummary } from '@/lib/register';
import { cn } from '@/lib/utils';

/**
 * The half-dashboard: what the register says, and what is in the way.
 *
 * One shape serves both registers. The EDL arrives with promised dates, so it
 * gets a plan curve and a deviation; the VDRL has none — its vendors never gave
 * one — so instead of inventing a baseline the screen says what it does know,
 * which is how many deliverables have never moved at all.
 */

const tanggal = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

const pendek = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
      })
    : '—';

// Written out rather than composed: Tailwind reads these files as text, so a
// class built from a variable at runtime never reaches the stylesheet.
const TREND: Record<RegisterNode['trend'], { label: string; chip: string; bar: string }> = {
  ahead: {
    label: 'lebih cepat', chip: 'bg-emerald-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  },
  'on-track': {
    label: 'sesuai rencana', chip: 'bg-emerald-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-emerald-600',
  },
  slipping: {
    label: 'mulai jauh', chip: 'bg-amber-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-amber-600',
  },
  behind: {
    label: 'jauh dari rencana', chip: 'bg-rose-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-rose-600',
  },
  unplanned: {
    label: 'tanpa rencana', chip: 'bg-slate-600 text-white',
    bar: '[&_[data-slot=progress-indicator]]:bg-blue-600',
  },
};

const OBSTACLE: Record<Obstacle['kind'], { label: string; chip: string; icon: typeof AlertTriangle }> = {
  returned: { label: 'kembali dengan komentar', chip: 'bg-rose-600 text-white', icon: AlertTriangle },
  overdue: { label: 'lewat tanggal rencana', chip: 'bg-amber-600 text-white', icon: Clock },
  untouched: { label: 'belum pernah dikirim', chip: 'bg-slate-600 text-white', icon: CircleSlash },
};

const signed = (n: number, decimals = 2) =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(decimals).replace('.', ',')}`;

const OBSTACLES_SHOWN = 8;

export function SummaryScreen({
  summary,
  groups,
  obstacles,
  groupsTitle,
  children,
}: {
  summary: RegisterSummary;
  groups: RegisterNode[];
  obstacles: Obstacle[];
  groupsTitle: string;
  /** The link switches, on the EDL screen only. */
  children?: React.ReactNode;
}) {
  const isEdl = summary.register === 'edl';
  const trend = TREND[summary.deviation === null ? 'unplanned' :
    summary.deviation >= 1 ? 'ahead' :
    summary.deviation >= -1 ? 'on-track' :
    summary.deviation >= -10 ? 'slipping' : 'behind'];

  const counts = [
    { label: 'kembali dengan komentar', value: summary.returnedOpen, tone: 'text-rose-600' },
    { label: 'lewat tanggal rencana', value: summary.overdue, tone: 'text-amber-600' },
    { label: 'belum pernah dikirim', value: summary.untouched, tone: 'text-slate-600' },
  ];

  return (
    <div className="pb-16">
      {/* ------------------------------------------------------------ hero */}
      <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Reveal delay={0.04}>
          <Card className="py-0 h-full overflow-hidden border-0 bg-slate-900 text-white shadow-xl ring-1 ring-black/10">
            <CardContent className="flex h-full flex-col justify-between gap-6 p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-widest text-white/70">
                  {isEdl ? 'Progress engineering' : 'Progress dokumen vendor'}
                </span>
                <Badge className="shrink-0 bg-white/15 font-normal text-white hover:bg-white/15">
                  minggu {summary.asOfWeek}
                </Badge>
              </div>

              <div>
                <p className="text-[3.25rem] font-semibold leading-none tracking-tight sm:text-6xl">
                  <CountUp value={summary.actual} />
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80">
                  <ArrowUpRight className="h-4 w-4" />
                  <span className="font-medium text-white">{signed(summary.thisWeek)} minggu ini</span>
                  <span className="text-white/50">·</span>
                  <span>per {tanggal(summary.asOfDate)}</span>
                </p>
              </div>

              <p className="text-xs leading-relaxed text-white/60">
                {summary.documents} dokumen · {summary.categories} kelompok
                {summary.numbered < summary.documents && ` · ${summary.documents - summary.numbered} belum bernomor`}
              </p>
            </CardContent>
          </Card>
        </Reveal>

        <div className="grid gap-4">
          <Reveal delay={0.1}>
            <Card className="py-0 shadow-sm">
              <CardContent className="flex flex-col gap-4 p-6">
                {summary.plan !== null ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          Terhadap rencana
                        </p>
                        <p className="mt-2 text-3xl font-semibold tracking-tight">
                          {signed(summary.deviation ?? 0)}
                          <span className="ml-1 text-lg font-normal text-muted-foreground">poin</span>
                        </p>
                      </div>
                      <Badge className={cn('shrink-0', trend.chip)}>{trend.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Rencana sampai minggu {summary.asOfWeek} adalah{' '}
                      <span className="font-medium text-foreground tabular-nums">
                        {summary.plan.toFixed(2).replace('.', ',')}%
                      </span>{' '}
                      — diturunkan dari tanggal rencana submit tiap dokumen.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          Belum bergerak
                        </p>
                        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                          {summary.untouched}
                          <span className="ml-1 text-lg font-normal text-muted-foreground">
                            dari {summary.documents}
                          </span>
                        </p>
                      </div>
                      <Badge className="shrink-0 bg-slate-600 text-white">tanpa rencana</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Register vendor tidak memuat satu pun tanggal rencana, jadi tidak ada kurva rencana
                      yang bisa diturunkan. Yang bisa dikatakan: sebanyak inilah yang belum pernah dikirim.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </Reveal>

          <Reveal delay={0.16}>
            <Card className="py-0 shadow-sm">
              <CardContent className="flex flex-col gap-4 p-6">
                {summary.stages.map((s) => (
                  <div key={s.stage} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">
                        {STAGE_LABEL[s.stage]}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          bobot {s.weight.toFixed(0)}%
                        </span>
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {s.reached} dari {summary.documents}
                      </span>
                    </div>
                    <Progress
                      value={(s.reached / summary.documents) * 100}
                      className="h-2 [&_[data-slot=progress-indicator]]:bg-blue-600"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </Reveal>
        </div>
      </div>

      {/* ----------------------------------------------------------- curve */}
      <Reveal delay={0.22}>
        <Card className="py-0 mt-4 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Per minggu
              </h2>
              <span className="text-xs text-muted-foreground">
                minggu {summary.series[0]?.weekNo ?? 1}–{summary.series[summary.series.length - 1]?.weekNo ?? 1}
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

      {/* -------------------------------------------------------- barriers */}
      <Reveal delay={0.26}>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {counts.map((c) => (
            <Card key={c.label} className="py-0 shadow-sm">
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <span className={cn('text-2xl font-semibold tabular-nums', c.tone)}>{c.value}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </Reveal>

      {children}

      {/* ------------------------------------------------------ categories */}
      <Reveal delay={0.3}>
        <h2 className="mt-12 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {groupsTitle}
        </h2>
      </Reveal>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g, i) => {
          const t = TREND[g.trend];
          return (
            <Reveal key={g.id} delay={0.34 + Math.min(i, 8) * 0.02}>
              <Card className="py-0 h-full shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{g.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{g.documents} dokumen</p>
                    </div>
                    {g.trend !== 'unplanned' && (
                      <Badge className={cn('shrink-0 font-normal', t.chip)}>{t.label}</Badge>
                    )}
                  </div>

                  <div className="mt-auto flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold tabular-nums">
                        {g.actual.toFixed(1).replace('.', ',')}%
                      </span>
                      {g.plan !== null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          rencana {g.plan.toFixed(1).replace('.', ',')}% · {signed(g.deviation ?? 0, 1)}
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
            </Reveal>
          );
        })}
      </div>

      {/* --------------------------------------------------------- blocked */}
      {obstacles.length > 0 && (
        <>
          <Reveal delay={0.4}>
            <div className="mt-12 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Yang menghambat
              </h2>
              <Badge variant="secondary" className="font-normal">{obstacles.length} dokumen</Badge>
            </div>
          </Reveal>

          <div className="mt-4 flex flex-col gap-2">
            {obstacles.slice(0, OBSTACLES_SHOWN).map((o, i) => {
              const kind = OBSTACLE[o.kind];
              const Icon = kind.icon;
              return (
                <Reveal key={o.documentId} delay={0.44 + Math.min(i, 6) * 0.03}>
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
                            {o.returnCode ?? kind.label}
                          </Badge>
                        </div>
                        {/* Wraps rather than truncates: on a phone a cut-off
                            drawing title is the one thing the reader needed. */}
                        <p className="line-clamp-2 text-sm">{o.title}</p>
                        <p className="text-xs text-muted-foreground">{o.categoryName}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-xs sm:flex-col sm:items-end sm:gap-1">
                        <span className="text-muted-foreground">{pendek(o.since)}</span>
                        {o.days !== null && (
                          <span className="font-medium tabular-nums">{o.days} hari</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Reveal>
              );
            })}
          </div>

          {obstacles.length > OBSTACLES_SHOWN && (
            <Reveal delay={0.6}>
              <p className="mt-3 text-xs text-muted-foreground">
                Menampilkan {OBSTACLES_SHOWN} teratas dari {obstacles.length} — yang kembali dengan
                komentar lebih dulu, lalu yang lewat tanggal, lalu yang belum pernah bergerak.
              </p>
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}
