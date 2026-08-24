import { getDb } from '@/lib/data';
import { claimableCauseLabels } from '@/lib/catalogs';
import { buildDelayRegister, fmtNum } from '@/lib/analysis';

export const metadata = { title: 'Delay Register' };

export default async function KlaimPage() {
  const db = await getDb();
  const reg = buildDelayRegister(db, claimableCauseLabels(db));

  return (
    <div className="mx-auto max-w-4xl animate-fade-in-up px-3 py-5 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Delay Register</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Setiap jam non-efektif yang pernah dicatat, dijumlahkan lintas minggu jadi bahan klaim
          perpanjangan waktu. Tidak ada isian baru — semuanya sudah kamu kumpulkan tiap hari,
          hanya belum pernah ada yang menjumlahkannya.
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { l: 'Total jam hilang', v: fmtNum(reg.totalHours), s: 'seluruh sebab' },
          {
            l: 'Bisa diklaim',
            v: fmtNum(reg.claimableHours),
            s: `${fmtNum(reg.claimableDays, 1)} hari kerja`,
          },
          {
            l: 'Hari terekam',
            v: fmtNum(reg.daysCovered),
            s: `${fmtNum(reg.daysWithPhotos)} berfoto`,
          },
          {
            l: 'Jam kerja/hari',
            v: fmtNum(reg.workingHoursPerDay, 1),
            s: 'rata-rata dari laporan',
          },
        ].map((s, i) => (
          <div
            key={s.l}
            className="animate-fade-in-up rounded-lg border bg-card p-3"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{s.v}</div>
            <div className="text-xs text-muted-foreground">{s.s}</div>
          </div>
        ))}
      </dl>

      <section className="animate-fade-in-up overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4 pb-3">
          <h2 className="text-sm font-semibold">Rekap per sebab</h2>
          <p className="text-xs text-muted-foreground">
            Sebab mana yang bisa diklaim diatur di{' '}
            <span className="font-medium text-foreground">Pengaturan Proyek</span> — bukan
            ditentukan aplikasi.
          </p>
        </div>
        {reg.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Belum ada jam non-efektif yang tercatat. Begitu lapangan mulai mengisi, tabel ini
            terisi sendiri tanpa kerja tambahan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Sebab</th>
                  <th className="px-3 py-2 text-right font-medium">Jam</th>
                  <th className="px-3 py-2 text-right font-medium">Hari setara</th>
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
                        {r.claimable ? 'Bisa diklaim' : 'Tidak diklaim'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reg.totalPhotos > 0 && (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {[
            { l: "Foto tersimpan", v: fmtNum(reg.totalPhotos), s: "seluruh laporan harian" },
            {
              l: "Berstempel waktu",
              v: fmtNum(reg.verifiedPhotos),
              s: reg.verifiedPhotos === reg.totalPhotos ? "semua bisa dipertanggungjawabkan" : "sisanya bergantung pengunggah",
            },
            { l: "Ber-koordinat GPS", v: fmtNum(reg.photosWithGps), s: "lokasi melekat di file" },
          ].map((s2) => (
            <div key={s2.l} className="rounded-lg border bg-card p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s2.l}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{s2.v}</div>
              <div className="text-xs text-muted-foreground">{s2.s}</div>
            </div>
          ))}
        </div>
      )}

      {!reg.photosVerifiable && (
        <p className="mt-4 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <strong>Belum semua foto bisa berbicara sendiri.</strong>{' '}
          {reg.totalPhotos === 0
            ? 'Belum ada foto tersimpan.'
            : `${reg.totalPhotos - reg.verifiedPhotos} dari ${reg.totalPhotos} foto tidak membawa stempel waktu dari kameranya sendiri — tanggalnya bergantung pada siapa yang mengunggah.`}{' '}
          Foto yang diunggah langsung dari kamera atau galeri ponsel biasanya membawanya; yang
          lewat WhatsApp hampir selalu sudah dibersihkan. Untuk klaim yang kuat, minta lapangan
          mengunggah file aslinya.
        </p>
      )}
    </div>
  );
}
