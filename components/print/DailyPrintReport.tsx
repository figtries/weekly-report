import type { CSSProperties } from 'react';
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

// Shared cell classes keep every table visually consistent.
const CELL = 'border border-black px-2 py-0.5 align-middle';
const HEAD = 'border border-black px-2 py-0.5 text-center font-semibold';

// Sizing/page-break rules live in the shared .print-sheet-a4 class.
const sheetStyle: CSSProperties = {
  padding: '12mm',
};

function SheetHeader() {
  return (
    <div className="mb-3 flex items-center justify-between border-b-2 border-black pb-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/pertamina.png"
        alt="Pertamina EP"
        style={{ width: '140px', height: '40px', objectFit: 'contain', objectPosition: 'left' }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/indoturbine.png"
        alt="Indoturbine"
        style={{ width: '120px', height: '40px', objectFit: 'contain', objectPosition: 'right' }}
      />
    </div>
  );
}

function SheetFooter({ docNo, page }: { docNo: string; page: number }) {
  return (
    <div
      className="flex items-center justify-between border-t border-black pt-1 text-[10px] text-gray-600"
      style={{ marginTop: 'auto' }}
    >
      <span>{docNo}</span>
      <span>Page {page} of 2</span>
    </div>
  );
}

export default function DailyPrintReport({ project, report }: { project: ProjectInfo; report: DailyReport }) {
  return (
    <>
      {/* ---------- Page 1 ---------- */}
      <div className="print-sheet-a4 flex flex-col text-black" style={sheetStyle}>
        <SheetHeader />
        <h1 className="mb-3 text-center text-sm font-bold uppercase tracking-wide">{project.name}</h1>

        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className={`w-1/4 ${CELL} font-semibold`}>Day / Date</td>
              <td className={`w-1/4 ${CELL}`}>{weekdayLabel(report.date)}</td>
              <td className={`w-1/4 ${CELL} font-semibold`}>Day No.</td>
              <td className={`w-1/4 ${CELL}`}>{report.hariKe ?? ''}</td>
            </tr>
            <tr>
              <td className={`${CELL} font-semibold`}>Contractor</td>
              <td className={CELL}>{project.contractor}</td>
              <td className={`${CELL} font-semibold`}>Company</td>
              <td className={CELL}>{project.customer}</td>
            </tr>
            <tr>
              <td className={`${CELL} font-semibold`}>Contract No.</td>
              <td className={CELL}>{project.contractNo}</td>
              <td className={`${CELL} font-semibold`}>Document No.</td>
              <td className={CELL}>{project.documentNoDaily}</td>
            </tr>
            <tr>
              <td className={`${CELL} font-semibold`}>Work Location</td>
              <td className={CELL} colSpan={3}>
                {project.workLocation}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className={HEAD} colSpan={4}>
                WEATHER
              </td>
            </tr>
            <tr>
              {[
                ['Heavy Rain', report.weather.hujanDeras, report.weather.hujanDerasJam],
                ['Moderate Rain', report.weather.hujanSedang, report.weather.hujanSedangJam],
                ['Cloudy / Overcast', report.weather.berawanMendung, report.weather.berawanMendungJam],
                ['Clear / Sunny', report.weather.cerahTerang, report.weather.cerahTerangJam],
              ].map(([label, checked, jam]) => (
                <td key={label as string} className={`${CELL} w-1/4 text-center`}>
                  <div className="font-semibold">{label}</div>
                  <div className="mt-0.5">
                    {checked ? '☑' : '☐'} {jam || ''}
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <td className={`${CELL} text-center font-semibold`} colSpan={4}>
                Time: {report.weather.waktuMulai} to {report.weather.waktuSelesai}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">1. Man Hours</h2>
        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className={HEAD}>Company</th>
              <th className={`${HEAD} w-[13%]`}>POB</th>
              <th className={`${HEAD} w-[15%]`}>Previous</th>
              <th className={`${HEAD} w-[15%]`}>Today</th>
              <th className={`${HEAD} w-[15%]`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.manHours.map((r) => (
              <tr key={r.id}>
                <td className={CELL}>{r.company}</td>
                <td className={`${CELL} text-center`}>{r.pobQty}</td>
                <td className={`${CELL} text-center`}>{r.previousHours.toLocaleString('en-US')}</td>
                <td className={`${CELL} text-center`}>{r.todayHours.toLocaleString('en-US')}</td>
                <td className={`${CELL} text-center`}>{(r.previousHours + r.todayHours).toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">Non Effective Working Hours</h2>
        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className={HEAD}>Cause</th>
              <th className={`${HEAD} w-[13%]`}>Previous</th>
              <th className={`${HEAD} w-[13%]`}>Today</th>
              <th className={`${HEAD} w-[13%]`}>Cumm.</th>
              <th className={`${HEAD} w-[24%]`}>Remark</th>
            </tr>
          </thead>
          <tbody>
            {report.nonEffective.map((r) => (
              <tr key={r.id}>
                <td className={CELL}>{r.cause}</td>
                <td className={`${CELL} text-center`}>{r.previous}</td>
                <td className={`${CELL} text-center`}>{r.today}</td>
                <td className={`${CELL} text-center`}>{r.previous + r.today}</td>
                <td className={CELL}>{r.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">2. Permit to Work (PTW)</h2>
        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className={HEAD}>Description</th>
              <th className={`${HEAD} w-[10%]`}>Type</th>
              <th className={`${HEAD} w-[14%]`}>PWT No.</th>
              <th className={`${HEAD} w-[14%]`}>PA</th>
              <th className={`${HEAD} w-[11%]`}>Issued</th>
              <th className={`${HEAD} w-[11%]`}>Validity</th>
              <th className={`${HEAD} w-[9%]`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {report.ptw.length === 0 && (
              <tr>
                <td className={`${CELL} text-center text-gray-400`} colSpan={7}>
                  No permits recorded
                </td>
              </tr>
            )}
            {report.ptw.map((r) => (
              <tr key={r.id}>
                <td className={CELL}>{r.description}</td>
                <td className={CELL}>{r.type}</td>
                <td className={CELL}>{r.pwtNo}</td>
                <td className={CELL}>{r.pa}</td>
                <td className={`${CELL} text-center`}>{r.issued}</td>
                <td className={`${CELL} text-center`}>{r.validity}</td>
                <td className={`${CELL} text-center`}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mb-1 text-sm font-bold">3. HSE Input</h2>
        <table className="w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className={HEAD}>Activity / Description</th>
              <th className={`${HEAD} w-[14%]`}>Previous</th>
              <th className={`${HEAD} w-[14%]`}>Today</th>
              <th className={`${HEAD} w-[16%]`}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {report.hseInput.map((r) => (
              <tr key={r.id}>
                <td className={CELL}>{r.activity}</td>
                <td className={`${CELL} text-center`}>{r.previous}</td>
                <td className={`${CELL} text-center`}>{r.today}</td>
                <td className={`${CELL} text-center`}>{r.previous + r.today}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <SheetFooter docNo={project.documentNoDaily} page={1} />
      </div>

      {/* ---------- Page 2 ---------- */}
      <div className="print-sheet-a4 flex flex-col text-black" style={sheetStyle}>
        <SheetHeader />

        <h2 className="mb-1 text-sm font-bold">Daily Activities</h2>
        <table className="mb-3 w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-200">
              <th className={`${HEAD} w-1/2`}>Today&apos;s Activities</th>
              <th className={`${HEAD} w-1/2`}>Tomorrow&apos;s Activities</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black p-2 align-top">
                <div className="min-h-[64px] whitespace-pre-wrap">{report.activitiesToday || '-'}</div>
              </td>
              <td className="border border-black p-2 align-top">
                <div className="min-h-[64px] whitespace-pre-wrap">{report.activitiesTomorrow || '-'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="mb-4 w-full border-collapse border border-black text-xs">
          <tbody>
            <tr>
              <td className={`${CELL} w-1/2 text-center font-semibold`}>Plan (%)</td>
              <td className={`${CELL} w-1/2 text-center font-semibold`}>Actual (%)</td>
            </tr>
            <tr>
              <td className={`${CELL} text-center`}>{report.planPct.toFixed(2)}%</td>
              <td className={`${CELL} text-center`}>{report.actualPct.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-2 text-sm font-bold">Photograph</h2>
        <div className="grid grid-cols-2 gap-2">
          {report.photos.map((photo, i) => (
            <div key={i} className="border border-black" style={{ aspectRatio: '16 / 9', overflow: 'hidden' }}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={`Documentation ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">No photo</div>
              )}
            </div>
          ))}
        </div>

        <SheetFooter docNo={project.documentNoDaily} page={2} />
      </div>
    </>
  );
}
