import type { DailyReport, ProjectInfo } from '@/lib/types';

function weekdayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function DailyPrintReport({ project, report }: { project: ProjectInfo; report: DailyReport }) {
  return (
    <>
      <div
        className="bg-white text-black"
        style={{ width: '210mm', minHeight: '297mm', padding: '12mm', margin: '0 auto', pageBreakAfter: 'always' }}
      >
        <div className="mb-4 flex items-start justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pertamina.png"
            alt="Pertamina EP"
            style={{ width: '150px', height: '44px', objectFit: 'contain', objectPosition: 'left' }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/indoturbine.png"
            alt="Indoturbine"
            style={{ width: '130px', height: '44px', objectFit: 'contain', objectPosition: 'right' }}
          />
        </div>
        <h1 className="mb-4 text-center text-lg font-bold">{project.name}</h1>

        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className="w-1/4 border border-black px-2 py-1 font-semibold">Hari / Tanggal</td>
              <td className="w-1/4 border border-black px-2 py-1">{weekdayLabel(report.date)}</td>
              <td className="w-1/4 border border-black px-2 py-1 font-semibold">Hari ke-</td>
              <td className="w-1/4 border border-black px-2 py-1">{report.hariKe ?? ''}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-semibold">Contractor</td>
              <td className="border border-black px-2 py-1">{project.contractor}</td>
              <td className="border border-black px-2 py-1 font-semibold">Company</td>
              <td className="border border-black px-2 py-1">{project.customer}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-semibold">Kontrak No.</td>
              <td className="border border-black px-2 py-1">{project.contractNo}</td>
              <td className="border border-black px-2 py-1 font-semibold">Document No.</td>
              <td className="border border-black px-2 py-1">{project.documentNoDaily}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-semibold">Work Location</td>
              <td className="border border-black px-2 py-1" colSpan={3}>
                {project.workLocation}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 text-center font-semibold" colSpan={4}>
                KEADAAN CUACA
              </td>
            </tr>
            <tr>
              {[
                ['Hujan Deras', report.weather.hujanDeras, report.weather.hujanDerasJam],
                ['Hujan Sedang', report.weather.hujanSedang, report.weather.hujanSedangJam],
                ['Berawan / Mendung', report.weather.berawanMendung, report.weather.berawanMendungJam],
                ['Cerah / Terang', report.weather.cerahTerang, report.weather.cerahTerangJam],
              ].map(([label, checked, jam]) => (
                <td key={label as string} className="border border-black px-2 py-2 text-center">
                  <div className="font-semibold">{label}</div>
                  <div className="mt-1">{checked ? '☑' : '☐'} {jam || ''}</div>
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 text-center font-semibold" colSpan={4}>
                Waktu: {report.weather.waktuMulai} s/d {report.weather.waktuSelesai}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">1. Man Hours</h2>
        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-black px-2 py-1">Company</th>
              <th className="border border-black px-2 py-1">POB</th>
              <th className="border border-black px-2 py-1">Previous</th>
              <th className="border border-black px-2 py-1">Today</th>
              <th className="border border-black px-2 py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.manHours.map((r) => (
              <tr key={r.id}>
                <td className="border border-black px-2 py-1">{r.company}</td>
                <td className="border border-black px-2 py-1 text-center">{r.pobQty}</td>
                <td className="border border-black px-2 py-1 text-center">{r.previousHours.toLocaleString()}</td>
                <td className="border border-black px-2 py-1 text-center">{r.todayHours.toLocaleString()}</td>
                <td className="border border-black px-2 py-1 text-center">
                  {(r.previousHours + r.todayHours).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">Non Effective Working Hours</h2>
        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-black px-2 py-1">Cause</th>
              <th className="border border-black px-2 py-1">Previous</th>
              <th className="border border-black px-2 py-1">Today</th>
              <th className="border border-black px-2 py-1">Cumm.</th>
              <th className="border border-black px-2 py-1">Remark</th>
            </tr>
          </thead>
          <tbody>
            {report.nonEffective.map((r) => (
              <tr key={r.id}>
                <td className="border border-black px-2 py-1">{r.cause}</td>
                <td className="border border-black px-2 py-1 text-center">{r.previous}</td>
                <td className="border border-black px-2 py-1 text-center">{r.today}</td>
                <td className="border border-black px-2 py-1 text-center">{r.previous + r.today}</td>
                <td className="border border-black px-2 py-1">{r.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">2. Permit to Work (PTW)</h2>
        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-black px-2 py-1">Description</th>
              <th className="border border-black px-2 py-1">Type</th>
              <th className="border border-black px-2 py-1">PWT No.</th>
              <th className="border border-black px-2 py-1">PA</th>
              <th className="border border-black px-2 py-1">Issued</th>
              <th className="border border-black px-2 py-1">Validity</th>
              <th className="border border-black px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.ptw.length === 0 && (
              <tr>
                <td className="border border-black px-2 py-2 text-center text-gray-400" colSpan={7}>
                  No permits recorded
                </td>
              </tr>
            )}
            {report.ptw.map((r) => (
              <tr key={r.id}>
                <td className="border border-black px-2 py-1">{r.description}</td>
                <td className="border border-black px-2 py-1">{r.type}</td>
                <td className="border border-black px-2 py-1">{r.pwtNo}</td>
                <td className="border border-black px-2 py-1">{r.pa}</td>
                <td className="border border-black px-2 py-1">{r.issued}</td>
                <td className="border border-black px-2 py-1">{r.validity}</td>
                <td className="border border-black px-2 py-1 text-center">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">3. HSE Input</h2>
        <table className="w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-black px-2 py-1">Activity / Description</th>
              <th className="border border-black px-2 py-1">Previous</th>
              <th className="border border-black px-2 py-1">Today</th>
              <th className="border border-black px-2 py-1">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {report.hseInput.map((r) => (
              <tr key={r.id}>
                <td className="border border-black px-2 py-1">{r.activity}</td>
                <td className="border border-black px-2 py-1 text-center">{r.previous}</td>
                <td className="border border-black px-2 py-1 text-center">{r.today}</td>
                <td className="border border-black px-2 py-1 text-center">{r.previous + r.today}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white text-black" style={{ width: '210mm', minHeight: '297mm', padding: '15mm', margin: '0 auto' }}>
        <div className="mb-4 flex items-start justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pertamina.png"
            alt="Pertamina EP"
            style={{ width: '150px', height: '44px', objectFit: 'contain', objectPosition: 'left' }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/indoturbine.png"
            alt="Indoturbine"
            style={{ width: '130px', height: '44px', objectFit: 'contain', objectPosition: 'right' }}
          />
        </div>

        <h2 className="mb-2 text-sm font-bold">Daily Activities</h2>
        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className="w-1/2 border border-black px-2 py-1 text-center">Today&apos;s Activities</th>
              <th className="w-1/2 border border-black px-2 py-1 text-center">Tomorrow&apos;s Activities</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black p-2 align-top">
                <div className="min-h-[80px] whitespace-pre-wrap">{report.activitiesToday || '-'}</div>
              </td>
              <td className="border border-black p-2 align-top">
                <div className="min-h-[80px] whitespace-pre-wrap">{report.activitiesTomorrow || '-'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mb-6 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 text-center font-semibold">Plan (%)</td>
              <td className="border border-black px-2 py-1 text-center font-semibold">Actual (%)</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 text-center">{report.planPct.toFixed(2)}%</td>
              <td className="border border-black px-2 py-1 text-center">{report.actualPct.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-2 text-center text-lg font-bold">Photograph</h2>
        <div className="grid grid-cols-2 gap-3">
          {report.photos.map((photo, i) => (
            <div key={i} className="border border-black" style={{ aspectRatio: '4 / 3', overflow: 'hidden' }}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={`Documentation ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">No photo</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
