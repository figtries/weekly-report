/**
 * What a pressed bar says, in one line: its plan, how much is done, when it
 * finishes and why, whether it sets the project finish, its contract dates.
 *
 * Every clause appears only when it has something to say, and every fact in
 * it is read, not worked out: done and the forecast come from lib/bar-facts.ts,
 * which reads what Data Overall reads. Pure.
 */
import type { BarFact } from './bar-facts';

const FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return FMT.format(Date.UTC(y, m - 1, d)).replace('Sept', 'Sep');
}
function daysBetween(a: string, b: string): number {
  const t = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}
const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

export interface SentenceRow {
  isSummary: boolean;
  isMilestone: boolean;
  startDate: string | null;
  finishDate: string | null;
  contractStart: string | null;
  contractFinish: string | null;
}

export function barSentence(row: SentenceRow, fact: BarFact | undefined, opts: { setsFinish: boolean }): string {
  const parts: string[] = [];
  if (row.isMilestone && row.startDate) parts.push(`On ${day(row.startDate)}`);
  else if (row.startDate && row.finishDate) parts.push(`Plan ${day(row.startDate)} → ${day(row.finishDate)}`);
  if (row.isSummary) return parts.join(' · ');

  const done = fact?.donePct ?? 0;
  if (done > 0) {
    const ticked = fact!.rungs.length > 1 ? fact!.rungs.filter((r) => r.done).map((r) => r.label) : [];
    parts.push(`Done ${pct(done)}${ticked.length && done < 100 ? ` (${ticked.join(', ')})` : ''}`);
  }
  const ff = fact?.forecastFinish;
  if (ff && row.finishDate && done < 100) {
    const late = daysBetween(row.finishDate, ff);
    parts.push(
      late > 0
        ? `Finishes ${day(ff)}, ${late} ${late === 1 ? 'day' : 'days'} late${fact?.reason ? ` because ${fact.reason}` : ''}`
        : 'Finishes on plan'
    );
  }
  if (opts.setsFinish) parts.push('Sets the project finish');
  if (row.contractStart && row.contractFinish) {
    parts.push(`Contract ${day(row.contractStart)} → ${day(row.contractFinish)}`);
  }
  return parts.join(' · ');
}
