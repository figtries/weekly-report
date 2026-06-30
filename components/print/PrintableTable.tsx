import { summaryData } from '@/utils/mockData';

export default function PrintableTable() {
  return (
    <div className="hidden print:block print-color-adjust-exact">
      <div 
        className="bg-white text-black"
        style={{ 
          width: '210mm', 
          minHeight: '297mm',
          padding: '15mm',
          margin: '0 auto',
          pageBreakAfter: 'always'
        }}
      >
        {/* Header with Logos */}
        <div className="flex justify-between items-start mb-6">
          <div style={{ width: '120px', height: '40px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/figtries-logo (1).png"
              alt="Figtries Logo"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          <div style={{ width: '120px', height: '40px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/figtries-logo (1).png"
              alt="Company Logo"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        </div>

        {/* Title Section */}
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold mb-2">WEEKLY REPORT NO.35</h1>
          <p className="text-sm font-semibold mb-2">
            RELOKASI 2 UNIT TAURUS 60 GTG DARI TANJUNG FIELD & 1 UNIT CENTAUR 40 GTG LIMAU FIELD KE FIELD GUNDIH
          </p>
          <p className="text-sm mb-4">19 June 2026 s/d 25 June 2026</p>
        </div>

        {/* Section Title */}
        <div className="mb-4 text-center">
          <h2 className="text-sm font-bold inline-block border-b-2 border-black pb-1">
            OVERALL PROGRESS SUMMARY
          </h2>
        </div>

        {/* Table */}
        <table className="w-full border-collapse border-2 border-black" style={{ fontSize: '10px' }}>
          <thead>
            {/* First header row with colSpan */}
            <tr className="bg-gray-300">
              <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                NO.
              </th>
              <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                DESKRIPSI
              </th>
              <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                BOBOT<br />
                (%)
              </th>
              <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                MINGGU LALU
              </th>
              <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                MINGGU INI
              </th>
              <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                CUMM. MINGGU INI
              </th>
              <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                TARGET<br />
                (%)
              </th>
              <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
                VARIANCE<br />
                (%)
              </th>
            </tr>
            {/* Second header row */}
            <tr className="bg-gray-300">
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                Progress
              </th>
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                WF<br />
                (%)
              </th>
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                Progress
              </th>
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                WF<br />
                (%)
              </th>
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                Progress
              </th>
              <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
                WF<br />
                (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {summaryData.map((item) => {
              const isGrandTotal = item.no === 0;
              return (
                <tr
                  key={item.no}
                  className={isGrandTotal ? 'bg-white font-bold' : ''}
                >
                  <td className="border border-black px-2 py-2 text-center">
                    {isGrandTotal ? '' : item.no}
                  </td>
                  <td className="border border-black px-2 py-2">
                    {item.deskripsi}
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.bobot.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.prevProgress.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.prevWF.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.curProgress.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.curWF.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.cumProgress.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.cumWF.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.target.toFixed(2)}%
                  </td>
                  <td className="border border-black px-2 py-2 text-center">
                    {item.variance.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
