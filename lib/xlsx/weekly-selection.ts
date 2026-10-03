/**
 * Which sheets of the weekly workbook were asked for. Its own module so the pop-up
 * (a client component) can build the URL without pulling the rollup into the bundle;
 * the route parses it back with the same functions.
 */
export interface WeeklySelection {
  documentation: boolean;
  summary: boolean;
  /** 'overall' and/or package keys (`SummaryRow.key`). */
  detail: string[];
  scurve: string[];
}

export const OVERALL = 'overall';

/** `?doc=1&sum=1&det=overall&det=<key>&sc=...`: repeated keys, so a key may hold anything. */
export function selectionQuery(s: WeeklySelection): string {
  const q = new URLSearchParams();
  if (s.documentation) q.set('doc', '1');
  if (s.summary) q.set('sum', '1');
  s.detail.forEach((k) => q.append('det', k));
  s.scurve.forEach((k) => q.append('sc', k));
  return q.toString();
}

export function parseSelection(q: URLSearchParams): WeeklySelection {
  return {
    documentation: q.get('doc') === '1',
    summary: q.get('sum') === '1',
    detail: q.getAll('det'),
    scurve: q.getAll('sc'),
  };
}

export function selectionCount(s: WeeklySelection): number {
  return (s.documentation ? 1 : 0) + (s.summary ? 1 : 0) + s.detail.length + s.scurve.length;
}

/** Any sheet that carries progress figures, which the weight gate holds back. */
export function hasFigures(s: WeeklySelection): boolean {
  return s.summary || s.detail.length > 0 || s.scurve.length > 0;
}
