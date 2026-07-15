import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
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

// Left-hand label cells in the key/value blocks.
const KEY = { fontWeight: 600, background: 'var(--rpt-zebra)' } as const;

// Six 16:9 photos (three rows) is what the second sheet's height budget holds
// next to its tables (see .rpt-photo--wide); a report with more slots than
// that must chunk onto continuation sheets, exactly like the weekly
// documentation pack — a 12-slot day once printed a 401mm sheet.
const PHOTOS_PER_PAGE = 6;

function PhotoGrid({ photos, startAt }: { photos: (string | null)[]; startAt: number }) {
  return (
    <div
      className="mx-auto grid grid-cols-2"
      style={{ maxWidth: '150mm', columnGap: '6mm', rowGap: '3mm' }}
    >
      {photos.map((photo, i) => (
        <figure key={i}>
          <div className="rpt-photo rpt-photo--wide">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={`Documentation ${startAt + i + 1}`} />
            ) : (
              <div className="rpt-photo-empty">No photo</div>
            )}
          </div>
          <figcaption className="rpt-caption">Photo {startAt + i + 1}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function DailyPrintReport({ project, report }: { project: ProjectInfo; report: DailyReport }) {
  const photoPages: (string | null)[][] = [];
  for (let i = 0; i < report.photos.length; i += PHOTOS_PER_PAGE) {
    photoPages.push(report.photos.slice(i, i + PHOTOS_PER_PAGE));
  }
  // The first chunk always prints (empty boxes are part of the form); later
  // chunks earn a sheet only when they actually hold a photo.
  const extras = photoPages
    .map((photos, chunk) => ({ photos, startAt: chunk * PHOTOS_PER_PAGE }))
    .slice(1)
    .filter(({ photos }) => photos.some((p) => p !== null));
  const totalPages = 2 + extras.length;

  return (
    <>
      {/* ---------- Page 1 ---------- */}
      {/* block, not flex: WebKit drops page fragments when paper paginates
          through a flex container */}
      <div className="print-sheet-a4">
        <PrintHeader title="Daily Progress Report" subtitle={project.name} period={weekdayLabel(report.date)} />

        <table className="rpt-table rpt-table--compact">
          <tbody>
            <tr>
              <td style={{ ...KEY, width: '18%' }}>Day / Date</td>
              <td style={{ width: '32%' }}>{weekdayLabel(report.date)}</td>
              <td style={{ ...KEY, width: '18%' }}>Day No.</td>
              <td>{report.hariKe ?? ''}</td>
            </tr>
            <tr>
              <td style={KEY}>Contractor</td>
              <td>{project.contractor}</td>
              <td style={KEY}>Company</td>
              <td>{project.customer}</td>
            </tr>
            <tr>
              <td style={KEY}>Contract No.</td>
              <td>{project.contractNo}</td>
              <td style={KEY}>Document No.</td>
              <td>{project.documentNoDaily}</td>
            </tr>
            <tr>
              <td style={KEY}>Work Location</td>
              <td colSpan={3}>{project.workLocation}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="rpt-section">Weather</h2>
        <table className="rpt-table rpt-table--compact">
          <tbody>
            <tr>
              {(
                [
                  ['Heavy Rain', report.weather.hujanDeras, report.weather.hujanDerasJam],
                  ['Moderate Rain', report.weather.hujanSedang, report.weather.hujanSedangJam],
                  ['Cloudy / Overcast', report.weather.berawanMendung, report.weather.berawanMendungJam],
                  ['Clear / Sunny', report.weather.cerahTerang, report.weather.cerahTerangJam],
                ] as [string, boolean, string][]
              ).map(([label, checked, jam]) => (
                <td key={label} className="rpt-num" style={{ width: '25%' }}>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div style={{ marginTop: '0.6mm' }}>
                    {checked ? '☑' : '☐'} {jam || ''}
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <td className="rpt-num" colSpan={4} style={{ fontWeight: 600 }}>
                Time: {report.weather.waktuMulai} to {report.weather.waktuSelesai}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="rpt-section">1. Man Hours</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Company</th>
              <th style={{ width: '13%' }}>POB</th>
              <th style={{ width: '15%' }}>Previous</th>
              <th style={{ width: '15%' }}>Today</th>
              <th style={{ width: '15%' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {report.manHours.map((r) => (
              <tr key={r.id}>
                <td>{r.company}</td>
                <td className="rpt-num">{r.pobQty}</td>
                <td className="rpt-num">{r.previousHours.toLocaleString('en-US')}</td>
                <td className="rpt-num">{r.todayHours.toLocaleString('en-US')}</td>
                <td className="rpt-num">{(r.previousHours + r.todayHours).toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="rpt-section">Non Effective Working Hours</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Cause</th>
              <th style={{ width: '13%' }}>Previous</th>
              <th style={{ width: '13%' }}>Today</th>
              <th style={{ width: '13%' }}>Cumm.</th>
              <th style={{ width: '24%' }}>Remark</th>
            </tr>
          </thead>
          <tbody>
            {report.nonEffective.map((r) => (
              <tr key={r.id}>
                <td>{r.cause}</td>
                <td className="rpt-num">{r.previous}</td>
                <td className="rpt-num">{r.today}</td>
                <td className="rpt-num">{r.previous + r.today}</td>
                <td>{r.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="rpt-section">2. Permit to Work (PTW)</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Description</th>
              <th style={{ width: '10%' }}>Type</th>
              <th style={{ width: '14%' }}>PWT No.</th>
              <th style={{ width: '14%' }}>PA</th>
              <th style={{ width: '11%' }}>Issued</th>
              <th style={{ width: '11%' }}>Validity</th>
              <th style={{ width: '9%' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {report.ptw.length === 0 && (
              <tr>
                <td className="rpt-num" colSpan={7} style={{ color: 'var(--rpt-muted)' }}>
                  No permits recorded
                </td>
              </tr>
            )}
            {report.ptw.map((r) => (
              <tr key={r.id}>
                <td>{r.description}</td>
                <td>{r.type}</td>
                <td>{r.pwtNo}</td>
                <td>{r.pa}</td>
                <td className="rpt-num">{r.issued}</td>
                <td className="rpt-num">{r.validity}</td>
                <td className="rpt-num">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="rpt-section">3. HSE Input</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Activity / Description</th>
              <th style={{ width: '14%' }}>Previous</th>
              <th style={{ width: '14%' }}>Today</th>
              <th style={{ width: '16%' }}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {report.hseInput.map((r) => (
              <tr key={r.id}>
                <td>{r.activity}</td>
                <td className="rpt-num">{r.previous}</td>
                <td className="rpt-num">{r.today}</td>
                <td className="rpt-num">{r.previous + r.today}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <PrintFooter docNo={project.documentNoDaily} page={1} total={totalPages} />
      </div>

      {/* ---------- Page 2 ---------- */}
      <div className="print-sheet-a4">
        <PrintHeader title="Daily Progress Report" subtitle={project.name} period={weekdayLabel(report.date)} />

        <h2 className="rpt-section">4. Daily Activities</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ width: '50%' }}>Today&apos;s Activities</th>
              <th style={{ width: '50%' }}>Tomorrow&apos;s Activities</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top' }}>
                <div style={{ minHeight: '14mm', whiteSpace: 'pre-wrap' }}>{report.activitiesToday || '-'}</div>
              </td>
              <td style={{ verticalAlign: 'top' }}>
                <div style={{ minHeight: '14mm', whiteSpace: 'pre-wrap' }}>{report.activitiesTomorrow || '-'}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 className="rpt-section">5. Progress</h2>
        <table className="rpt-table rpt-table--compact">
          <thead>
            <tr>
              <th style={{ width: '50%' }}>Plan (%)</th>
              <th style={{ width: '50%' }}>Actual (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rpt-num">{report.planPct.toFixed(2)}%</td>
              <td className="rpt-num">{report.actualPct.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>

        <h2 className="rpt-section">6. Photograph</h2>
        <PhotoGrid photos={photoPages[0] ?? []} startAt={0} />

        <PrintFooter docNo={project.documentNoDaily} page={2} total={totalPages} />
      </div>

      {/* ---------- Continuation sheets: photos 7+ ---------- */}
      {extras.map(({ photos, startAt }, i) => (
        <div key={startAt} className="print-sheet-a4">
          <PrintHeader title="Daily Progress Report" subtitle={project.name} period={weekdayLabel(report.date)} />

          <h2 className="rpt-section">6. Photograph (cont.)</h2>
          <PhotoGrid photos={photos} startAt={startAt} />

          <PrintFooter docNo={project.documentNoDaily} page={3 + i} total={totalPages} />
        </div>
      ))}
    </>
  );
}
