import Link from 'next/link';
import SectionTabs, { PROJECT_TABS } from '@/components/layout/SectionTabs';
import { getWorkspace } from '@/lib/data';
import {
  STATUS_LABEL,
  buildPortfolio,
  fmtNum,
  fmtPct,
  formatRupiah,
  portfolioTotals,
  type PortfolioStatus,
} from '@/lib/analysis';

export const metadata = { title: 'Portfolio' };

const STATUS_STYLE: Record<PortfolioStatus, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  watch: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  critical: 'bg-destructive/10 text-destructive',
};

export default async function PortfolioPage() {
  const ws = await getWorkspace();
  const rows = buildPortfolio(
    ws.order
      .filter((id) => ws.projects[id])
      .map((id) => ({ id, db: ws.projects[id], isActive: id === ws.activeProjectId }))
  );
  const t = portfolioTotals(rows);

  const tiles = [
    { l: 'Proyek', v: fmtNum(t.projects), s: `${t.critical} kritis · ${t.watch} dipantau`, bad: false },
    {
      l: 'Nilai kontrak',
      v: t.contractValue > 0 ? formatRupiah(t.contractValue) : '—',
      s: 'total portofolio',
      bad: false,
    },
    {
      l: 'Sudah ter-earn',
      v: t.contractValue > 0 ? formatRupiah(t.earnedValue) : '—',
      s: t.contractValue > 0 ? `${fmtPct(t.weightedActualPct)} tertimbang nilai` : 'isi nilai kontrak',
      bad: false,
    },
    {
      l: 'Tertunda',
      v: t.contractValue > 0 ? formatRupiah(Math.abs(t.scheduleVarianceRp)) : '—',
      s: t.scheduleVarianceRp > 0 ? 'di belakang rencana' : 'di depan rencana',
      bad: t.scheduleVarianceRp > 0,
    },
    { l: 'Laporan tertahan', v: fmtNum(t.blocked), s: 'punya temuan wajib', bad: t.blocked > 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl animate-fade-in-up px-3 py-5 sm:p-6 lg:p-8">
      <SectionTabs tabs={PROJECT_TABS} className="mb-5" />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Portfolio</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Semua proyek dalam satu halaman, diurut dari yang paling tertinggal. Ini lapisan yang
          dibaca direksi — dan satu-satunya yang bicara Rupiah lebih dulu daripada persen.
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((s, i) => (
          <div
            key={s.l}
            className="animate-fade-in-up rounded-lg border bg-card p-3"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.l}</dt>
            <dd
              className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${
                s.bad ? 'text-destructive' : ''
              }`}
            >
              {s.v}
            </dd>
            <dd className="text-xs text-muted-foreground">{s.s}</dd>
          </div>
        ))}
      </dl>

      <section className="animate-fade-in-up overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Proyek</th>
                <th className="px-3 py-2 text-right font-medium">Minggu</th>
                <th className="px-3 py-2 text-right font-medium">Rencana</th>
                <th className="px-3 py-2 text-right font-medium">Aktual</th>
                <th className="px-3 py-2 text-right font-medium">Deviasi</th>
                <th className="px-3 py-2 text-right font-medium">Tertunda</th>
                <th className="px-3 py-2 text-right font-medium">Forecast</th>
                <th className="px-3 py-2 text-left font-medium">Risiko teratas</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const gap =
                  r.weeksAgainstContract !== null ? Math.round(r.weeksAgainstContract) : null;
                return (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium leading-snug">
                        {r.name}
                        {r.isActive && (
                          <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">
                            aktif
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.customer || '—'}
                        {r.approvedThroughWeek !== null &&
                          ` · disetujui s/d mgg ${r.approvedThroughWeek}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {r.week > 0 ? `${r.week}/${r.totalWeeks}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(r.planPct)}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {fmtPct(r.actualPct)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        r.deviationPct < 0 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {r.deviationPct >= 0 ? '+' : '−'}
                      {fmtPct(Math.abs(r.deviationPct))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {r.scheduleVarianceRp !== null && r.scheduleVarianceRp > 0
                        ? formatRupiah(r.scheduleVarianceRp)
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {r.forecastFinishWeek === null ? (
                        '—'
                      ) : (
                        <>
                          {`mgg ${Math.round(r.forecastFinishWeek)}`}
                          {gap !== null && gap !== 0 && (
                            <span className={gap > 0 ? 'text-emerald-600' : 'text-destructive'}>
                              {` (${gap > 0 ? '−' : '+'}${Math.abs(gap)})`}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="max-w-52 truncate px-3 py-2.5 text-xs text-muted-foreground">
                      {r.topRisk ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.blockingFindings > 0 && (
                        <div className="mt-0.5 text-[10px] text-destructive">
                          {r.blockingFindings} temuan menahan
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Persentase gabungan di atas ditimbang berdasarkan nilai kontrak, bukan dirata-rata — supaya
        proyek besar tidak bisa disamarkan oleh proyek-proyek kecil yang sehat.{' '}
        <Link href="/setup" className="underline underline-offset-2 hover:text-foreground">
          Tambah proyek lewat wizard setup
        </Link>
        .
      </p>
    </div>
  );
}
