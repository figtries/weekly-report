import { notFound } from 'next/navigation';
import { getDb } from '@/lib/data';
import DailyPrintReport from '@/components/print/DailyPrintReport';
import PrintTrigger from '@/components/ui/PrintTrigger';

export default async function DailyPrintPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const db = await getDb();
  const report = db.daily.find((d) => d.date === date);
  if (!report) notFound();

  return (
    <div className="min-h-full bg-gray-100 overflow-x-auto print:overflow-visible">
      <div className="sticky top-0 z-20 flex justify-center border-b border-gray-200 bg-white py-3 print:hidden">
        <PrintTrigger label={`Print Daily Report — ${date}`} />
      </div>
      {/* w-max keeps the fixed-width A4 sheet scrollable (not left-clipped) on small screens */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:w-auto print:min-w-0 print:p-0">
        <DailyPrintReport project={db.project} report={report} />
      </div>
    </div>
  );
}
