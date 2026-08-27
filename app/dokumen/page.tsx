import { AlertTriangle, FileText } from 'lucide-react';

import {
  getCategoryProgress,
  getOutstandingDocuments,
  getProject,
  getRegisterSummary,
} from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CountUp, Reveal } from '@/components/motion/Reveal';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dokumen' };

const PROJECT_ID = 'gundih';
/** Enough to act on this morning. The full register belongs behind a filter. */
const OUTSTANDING_SHOWN = 12;

const tanggal = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
      })
    : '—';

/**
 * Document control — the engineering register.
 *
 * Deliberately not the register itself. A document controller opens this to
 * answer two questions: how far along is engineering, and what is stuck. So the
 * page leads with those, groups the rest by category, and never puts 143 rows
 * on screen at once.
 *
 * The weight arithmetic is the same as the physical WBS — count, then stage
 * weights (IFR 50 · IFA 30 · AFC 20), then a cumulative figure — which is why
 * one engine serves both.
 */
export default function DokumenPage() {
  const project = getProject(PROJECT_ID);
  const register = project ? getRegisterSummary(PROJECT_ID) : null;

  if (!project || !register) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Register dokumen masih kosong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Impor Engineering Deliverable List-nya dulu, lalu muat ulang halaman ini.
        </p>
        <pre className="mt-6 overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-left text-xs text-gray-100">
          node scripts/import-edl.ts
        </pre>
      </div>
    );
  }

  const categories = getCategoryProgress(PROJECT_ID);
  const outstanding = getOutstandingDocuments(PROJECT_ID);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {/* ---------------------------------------------------------- header */}
      <Reveal>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Document control
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Register dokumen</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Engineering Deliverable List — {register.documents} dokumen dalam {categories.length} kategori,
            ditimbang IFR 50% · IFA 30% · AFC 20%.
          </p>
        </div>
      </Reveal>

      {/* ------------------------------------------------------------ hero */}
      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Reveal delay={0.06}>
          <Card className="h-full border-0 bg-slate-900 text-white shadow-lg ring-1 ring-black/10">
            <CardContent className="flex h-full flex-col gap-4 p-6 sm:justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-white/70">
                Progress engineering
              </span>
              <div>
                <p className="text-4xl font-semibold tracking-tight sm:text-[2.75rem]">
                  <CountUp value={register.progress} />
                </p>
                <p className="mt-1 text-xs text-white/70">menurut register, bukan diketik tangan</p>
              </div>
            </CardContent>
          </Card>
        </Reveal>

        <Reveal delay={0.12}>
          <Card className="h-full shadow-sm">
            <CardContent className="flex h-full flex-col justify-center gap-5 p-6">
              {register.stages.map((s) => (
                <div key={s.stage} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {s.stage}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        bobot {s.weight.toFixed(0)}%
                      </span>
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {s.reached} dari {register.documents}
                    </span>
                  </div>
                  <Progress
                    value={(s.reached / register.documents) * 100}
                    className="h-2 [&_[data-slot=progress-indicator]]:bg-blue-600"
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </Reveal>
      </div>

      {/* ----------------------------------------------------- outstanding */}
      {outstanding.length > 0 && (
        <>
          <Reveal delay={0.18}>
            <div className="mt-12 flex flex-wrap items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Perlu tindakan
              </h2>
              <Badge className="bg-amber-600 text-white">{outstanding.length} dokumen</Badge>
            </div>
          </Reveal>

          <Reveal delay={0.22}>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Kembali dengan komentar dan belum disetujui sejak itu. Inilah yang menahan konstruksi —
              bukan angka persennya.
            </p>
          </Reveal>

          <div className="mt-4 flex flex-col gap-2">
            {outstanding.slice(0, OUTSTANDING_SHOWN).map((doc, i) => (
              <Reveal key={doc.docNo} delay={0.26 + Math.min(i, 6) * 0.03}>
                <Card className="shadow-sm transition-shadow duration-300 ease-ios hover:shadow-md">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-medium">{doc.docNo}</span>
                        <Badge variant="secondary" className="font-normal">{doc.stage}</Badge>
                        <Badge className="bg-amber-600 text-white">{doc.returnCode}</Badge>
                      </div>
                      {/* Wraps rather than truncates: on a phone a cut-off drawing title is
                          the one thing the reader needed. */}
                      <p className="line-clamp-2 text-sm">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">{doc.categoryName}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-6 text-xs sm:flex-col sm:items-end sm:gap-1">
                      <span className="text-muted-foreground">{tanggal(doc.returnedAt)}</span>
                      {doc.pic && <span className="font-medium">{doc.pic}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>

          {outstanding.length > OUTSTANDING_SHOWN && (
            <Reveal delay={0.5}>
              <p className="mt-3 text-xs text-muted-foreground">
                Menampilkan {OUTSTANDING_SHOWN} teratas menurut tanggal kembali,
                dari {outstanding.length} yang tertahan.
              </p>
            </Reveal>
          )}
        </>
      )}

      {/* ------------------------------------------------------ categories */}
      <Reveal delay={0.54}>
        <h2 className="mt-12 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Per kategori
        </h2>
      </Reveal>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat, i) => (
          <Reveal key={cat.code} delay={0.58 + Math.min(i, 8) * 0.02}>
            <Card className="h-full shadow-sm">
              <CardHeader className="gap-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">{cat.name}</CardTitle>
                  <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">{cat.code}</span>
                </div>
                <p className="text-xs text-muted-foreground">{cat.documents} dokumen</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {cat.reached.map((r) => (
                  <div key={r.stage} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                      {r.stage}
                    </span>
                    <Progress
                      value={cat.documents === 0 ? 0 : (r.count / cat.documents) * 100}
                      className={cn(
                        'h-1.5 [&_[data-slot=progress-indicator]]:bg-blue-600',
                        r.count === cat.documents && '[&_[data-slot=progress-indicator]]:bg-emerald-600',
                      )}
                    />
                    <span className="w-10 shrink-0 text-right text-[0.65rem] tabular-nums text-muted-foreground">
                      {r.count}/{cat.documents}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.8}>
        <p className="mt-10 max-w-3xl text-pretty text-xs leading-relaxed text-muted-foreground">
          Register ini bertanggal 15 Januari 2026 sementara laporan mingguannya minggu 43 di bulan
          Agustus, jadi leaf engineering di WBS belum ditautkan ke sini — angkanya akan mundur tiga
          puluh minggu. Penautan menunggu register yang seumuran.
        </p>
      </Reveal>
    </div>
  );
}
