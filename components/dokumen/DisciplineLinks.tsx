'use client';

import { useState, useTransition } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link2, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { DURATION, EASE, Reveal } from '@/components/motion/Reveal';
import { setDisciplineLink } from '@/lib/doc-actions';
import { STAGE_LABEL, type DisciplineLink } from '@/lib/register-shared';
import { cn } from '@/lib/utils';

/**
 * The switch that makes the register the source of truth for engineering.
 *
 * Gundih's WBS measures engineering twice: once as five disciplines with an
 * IFR, an IFA and an AFC leaf, and again as 143 documents in the EDL. Turning a
 * discipline on points its three leaves at the register — `progressMethod:
 * 'linked'` — and from then on nobody types an engineering percentage anywhere.
 *
 * It is off by default and that is not timidity. This register is `R2, 15 Jan
 * 2026`; the weekly report is W43 in August. Switching it on today would drag
 * fifteen leaves from 100% back to what January knew, and the difference in the
 * right-hand column is the honest size of that gap. Nothing is overwritten
 * either way — the stored weekly figures stay exactly where they are — so the
 * switch can be turned back off and lose nothing.
 */
export function DisciplineLinks({
  projectId,
  disciplines,
  asOfDate,
}: {
  projectId: string;
  disciplines: DisciplineLink[];
  asOfDate: string;
}) {
  if (disciplines.length === 0) return null;

  return (
    <section className="mt-12">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Tautan ke laporan mingguan
          </h2>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Kalau dinyalakan, leaf engineering di WBS membaca angkanya dari register ini — tidak ada
          lagi persen engineering yang diketik. Register ini terakhir bergerak{' '}
          {new Date(`${asOfDate}T00:00:00Z`).toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
          })}
          , sementara kolom WBS di bawah adalah angka minggu{' '}
          {disciplines[0]?.wbsWeek ?? '—'} — laporan terakhir yang benar-benar diisi. Selisih di
          kolom kanan itulah seberapa jauh angkanya akan mundur kalau dinyalakan hari ini.
        </p>
      </Reveal>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {disciplines.map((d, i) => (
          <Reveal key={d.nodeId} delay={0.08 + i * 0.03}>
            <DisciplineCard projectId={projectId} discipline={d} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function DisciplineCard({ projectId, discipline }: { projectId: string; discipline: DisciplineLink }) {
  const reduced = useReducedMotion();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(discipline.stages.every((s) => s.linked));
  const [error, setError] = useState<string | null>(null);

  const drop = discipline.stages.reduce((a, s) => a + (s.registerPercent - s.wbsPercent), 0)
    / Math.max(1, discipline.stages.length);

  const toggle = (next: boolean) => {
    if (!discipline.categoryId) return;
    setOn(next);
    setError(null);
    start(async () => {
      const result = await setDisciplineLink({
        projectId,
        nodeId: discipline.nodeId,
        categoryId: discipline.categoryId!,
        on: next,
      });
      if (!result.ok) { setOn(!next); setError(result.error); }
    });
  };

  return (
    <Card className={cn('py-0 h-full shadow-sm transition-shadow duration-300 ease-ios', on && 'ring-1 ring-blue-600/40')}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{discipline.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {discipline.categoryName ?? 'tidak ada kategori yang cocok'} · bobot{' '}
              {discipline.bobot.toFixed(3).replace('.', ',')}% dari proyek
            </p>
          </div>
          {/* 44px of height around a 18px control: this is tapped on a phone. */}
          <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
            <span className="text-muted-foreground">{on ? 'baca register' : 'mati'}</span>
            <Switch
              checked={on}
              disabled={pending || !discipline.categoryId}
              onCheckedChange={toggle}
              aria-label={`Tautkan ${discipline.name} ke register`}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          {discipline.stages.map((s) => {
            const delta = s.registerPercent - s.wbsPercent;
            return (
              <div key={s.nodeId} className="flex items-center justify-between gap-3 text-xs">
                <span className="w-14 shrink-0 font-mono text-muted-foreground">{STAGE_LABEL[s.stage]}</span>
                <span className="flex-1 border-b border-dashed border-border" />
                <span className="tabular-nums text-muted-foreground">
                  WBS {s.wbsPercent.toFixed(1).replace('.', ',')}%
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums">
                  <span className="font-medium">{s.registerPercent.toFixed(1).replace('.', ',')}%</span>
                  <span className={cn('ml-1', delta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                    {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(1).replace('.', ',')}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <AnimatePresence initial={false}>
          {(error || (on && drop < -0.05)) && (
            <motion.div
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: DURATION, ease: EASE }}
              className="overflow-hidden"
            >
              <Badge
                className={cn(
                  'w-full justify-start whitespace-normal text-left font-normal',
                  error ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white',
                )}
              >
                <TriangleAlert className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                {error ?? `Laporan mingguan akan turun rata-rata ${Math.abs(drop).toFixed(1).replace('.', ',')} poin di disiplin ini.`}
              </Badge>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
