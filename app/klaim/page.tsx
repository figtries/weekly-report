import { RouteTransition } from '@/components/motion/RouteTransition';
import { ScrollReveal } from '@/components/motion/ScrollReveal';
import { getDb } from '@/lib/data';
import { claimableCauseLabels } from '@/lib/catalogs';
import { buildDelayRegister, fmtNum } from '@/lib/analysis';
import LegacyGate from '@/components/projects/LegacyGate';

export const metadata = { title: 'Delay Register' };

/**
 * The gate is asked PER REQUEST (see components/projects/LegacyGate.tsx): this
 * page's static HTML used to carry the open project's NAME, and the CDN served
 * it to whoever had a different one open.
 */
export default function KlaimPage() {
  return (
    <LegacyGate what="delay records">
      <KlaimBody />
    </LegacyGate>
  );
}

async function KlaimBody() {

  const db = await getDb();
  const reg = buildDelayRegister(db, claimableCauseLabels(db));

  return (
    <RouteTransition id="klaim">
    <div className="mx-auto max-w-4xl px-3 py-5 sm:p-6 lg:p-8">
      <header className="mb-6 animate-enter">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Delay Register</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every non-effective hour ever recorded, added up across the weeks into material for an
          extension-of-time claim. Nothing new to fill in — it was all collected daily already,
          only nobody had ever totalled it.
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { l: 'Hours lost', v: fmtNum(reg.totalHours), s: 'all causes' },
          {
            l: 'Claimable',
            v: fmtNum(reg.claimableHours),
            s: `${fmtNum(reg.claimableDays, 1)} working days`,
          },
          {
            l: 'Days recorded',
            v: fmtNum(reg.daysCovered),
            s: `${fmtNum(reg.daysWithPhotos)} with photos`,
          },
          {
            l: 'Working hours/day',
            v: fmtNum(reg.workingHoursPerDay, 1),
            s: 'average across the reports',
          },
        ].map((s, i) => (
          <div
            key={s.l}
            // 60ms apart, matching MOTION.stagger, so these four tiles cascade
            // on the same beat as every other stagger in the app; the +1 keeps
            // them one step behind the header above them.
            className="animate-enter rounded-lg border bg-card p-3"
            style={{ animationDelay: `${(i + 1) * 60}ms` }}
          >
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.s}</div>
          </div>
        ))}
      </dl>

      {/* Below the fold on a phone, so it arrives when it is reached
          rather than having already happened out of sight. */}
      <ScrollReveal>
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4 pb-3">
          <h2 className="text-sm font-semibold">By cause</h2>
          <p className="text-xs text-muted-foreground">
            Which causes count as claimable is set in{' '}
            <span className="font-medium text-foreground">Project Settings</span> — the app does
            not decide it.
          </p>
        </div>
        {reg.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No non-effective hours recorded yet. As soon as the field crew starts filling them
            in, this table fills itself with no extra work.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Cause</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                  <th className="px-3 py-2 text-right font-medium">Equivalent days</th>
                  <th className="px-3 py-2 text-right font-medium">Kejadian</th>
                  <th className="px-3 py-2 text-left font-medium">Rentang</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reg.rows.map((r) => (
                  <tr key={r.cause} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{r.cause}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(r.hours)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtNum(r.equivalentDays, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {fmtNum(r.occurrences)}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {r.firstDate === r.lastDate
                        ? r.firstDate
                        : `${r.firstDate} … ${r.lastDate}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          r.claimable
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {r.claimable ? 'Claimable' : 'Not claimable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </ScrollReveal>

      {reg.totalPhotos > 0 && (
        <ScrollReveal className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {[
            { l: "Photos stored", v: fmtNum(reg.totalPhotos), s: "across every daily report" },
            {
              l: "Time-stamped",
              v: fmtNum(reg.verifiedPhotos),
              s: reg.verifiedPhotos === reg.totalPhotos ? "every one can be vouched for" : "the rest rest on whoever uploaded them",
            },
            { l: "With GPS", v: fmtNum(reg.photosWithGps), s: "location baked into the file" },
          ].map((s2) => (
            <div key={s2.l} className="rounded-lg border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s2.l}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{s2.v}</div>
              <div className="text-xs text-muted-foreground">{s2.s}</div>
            </div>
          ))}
        </ScrollReveal>
      )}

      {!reg.photosVerifiable && (
        <p className="mt-4 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <strong>Not every photo can speak for itself yet.</strong>{' '}
          {reg.totalPhotos === 0
            ? 'No photos stored yet.'
            : `${reg.totalPhotos - reg.verifiedPhotos} of ${reg.totalPhotos} photos carry no timestamp from the camera itself — their date rests on whoever uploaded them.`}{' '}
          A photo uploaded straight from a camera or phone gallery usually carries one; one that
          travelled through WhatsApp almost never does. For a claim that holds, ask the field crew
          to upload the original file.
        </p>
      )}
    </div>
    </RouteTransition>
  );
}
