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
    <div className="min-h-full bg-gray-100">
      <div className="sticky top-0 z-20 flex justify-center border-b border-gray-200 bg-white py-3 print:hidden">
        <PrintTrigger label={`Print Daily Report — ${date}`} />
      </div>
      <div className="flex flex-col items-center gap-6 py-6">
        <DailyPrintReport project={db.project} report={report} />
      </div>
    </div>
  );
}
