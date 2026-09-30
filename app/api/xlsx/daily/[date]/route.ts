import type { NextRequest } from 'next/server';
import { dailyProgressFor } from '@/lib/daily-progress';
import { dayOfProject } from '@/lib/daily-week';
import { getOpenDb, getOpenProjectStatus } from '@/lib/data';
import { readOpenDb } from '@/lib/db';
import { buildDailyWorkbook } from '@/lib/xlsx/daily-export';

export const maxDuration = 60;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The daily report as the client's own workbook.
 *
 * The report is read UNCACHED (`readOpenDb`): the fill-in screen autosaves and its
 * Export button waits for the queue, so what was just typed must be what leaves, and
 * the cached copy can lag a lambda that has not seen the latest tag purge. Identity
 * (names, contract, signatories) comes from the project's own columns, which are what
 * Project details edits; the JSON record's copy is only a seed.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return new Response('Bad date', { status: 400 });
  }

  const record = await readOpenDb();
  const report = record?.daily.find((d) => d.date === date);
  if (!report) return new Response(`No daily report for ${date}`, { status: 404 });

  // After the cookie read inside readOpenDb, so the clock these read is allowed.
  const [db, status] = await Promise.all([getOpenDb(), getOpenProjectStatus()]);
  const p = db.project;

  let file: Awaited<ReturnType<typeof buildDailyWorkbook>>;
  try {
    file = await buildDailyWorkbook({
      project: {
        name: p.name,
        contractNo: p.contractNo,
        customer: p.customer,
        contractor: p.contractor,
        workLocation: p.workLocation,
        documentNoDaily: p.documentNoDaily,
        signatureLeft: p.signatureLeft,
        signatureRight: p.signatureRight,
      },
      report,
      dayNo: dayOfProject(p.weekAnchorEndDate, date),
      progress: dailyProgressFor(status, date),
    });
  } catch (error) {
    // Where curl and the function log can see it, as the PDF routes do.
    console.error('Excel export failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Excel export failed: ${message}`, { status: 500 });
  }

  const [y, m, d] = date.split('-');
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="DAILY PROGRESS REPORT ${d}${m}${y}.xlsx"`,
      // Explicit length so the button can count the transfer up.
      'Content-Length': String(file.bytes.byteLength),
      'Cache-Control': 'no-store',
      // Which lines the sheet could not hold, for anyone who wants to look.
      'X-Excel-Overflow': file.overflow.map((o) => `${o.block}:${o.total}/${o.capacity}`).join(',') || 'none',
    },
  });
}
