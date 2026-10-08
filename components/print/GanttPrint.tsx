import type { ReactNode } from 'react';
import type { SheetRow } from '@/lib/sheet';
import type { Network, LinkState } from '@/lib/chains';
import type { BarFact } from '@/lib/bar-facts';
import { arrowPath, visibleEnd } from '@/lib/gantt-arrows';
import { KIND_KEYS, KIND_LABEL, labelsByRow, paintCss, paintOf, segmentsOf, type BarView } from '@/lib/bar-view';
import {
  SHEET,
  axisOf,
  codeWidth,
  daysBetween,
  fmtDay,
  legendColumns,
  legendHeight,
  paginate,
  rowHeight,
  textWidth,
} from '@/lib/gantt-print';

/**
 * The Gantt PDF (8 Oct 2026): the planner's chart on A4 landscape, one sheet
 * per page, for sending to people who have never opened the app.
 *
 * It draws what the planner draws, from the same facts and the same Bars
 * choices (colour, Done, Forecast, Contract, Can slip, Links), so the file and
 * the screen never disagree. Three differences, all because paper is read
 * without the app: no name is ever cut off (lib/gantt-print.ts), the key at the
 * foot of every sheet names every mark the file uses, and an arrow whose other
 * end is on another sheet, or not in the file at all, still shows, as a short
 * arrow with that row's number.
 *
 * Plain HTML and SVG: /print stays Radix-free and motion-free, and every row
 * height is decided before rendering so the table and the bars share one grid.
 */

type PrintRow = SheetRow & { rel: number };

type ArrowKind = 'muted' | 'path' | 'bad';
interface Stub {
  dir: 'in' | 'out';
  x: number;
  y: number;
  /** Which way the line runs from the bar: left of an entry, right of an exit. */
  side: 'left' | 'right';
  code: string;
  kind: ArrowKind;
}
interface Arrow {
  d: string;
  kind: ArrowKind;
  dashed: boolean;
  wait: number;
  label: { x: number; y: number; anchor: 'start' | 'end' };
}

const RED = 'var(--bad)';
const INK = 'var(--rpt-ink)';
const MUTED = 'var(--rpt-muted)';
const TODAY = '#0ea5e9';

export default function GanttPrint({
  project,
  rows,
  allRows,
  facts,
  view,
  network,
  today,
  contract,
}: {
  project: { name: string; clientName: string | null; contractorName: string | null };
  rows: PrintRow[];
  allRows: SheetRow[];
  facts: Record<string, BarFact>;
  view: BarView;
  network: Network;
  /** The day the file is made, ISO, for the day line. */
  today: string;
  contract: boolean;
}) {
  const colourBy = view.colourBy;
  const labels = labelsByRow(allRows);
  const codeW = codeWidth(rows);
  const tableW = codeW + SHEET.taskW + SHEET.durW + SHEET.dateW * 2;
  const W = SHEET.width - tableW;
  const heights = rows.map((r) => rowHeight(r, r.rel));

  // ----------------------------------------------------------- the calendar
  let first: string | null = null;
  let last: string | null = null;
  const reach = (d: string | null | undefined) => {
    if (!d) return;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  };
  for (const r of rows) {
    if (!r.startDate || !r.finishDate) continue;
    reach(r.startDate);
    reach(r.finishDate);
    reach(r.targetDate);
    if (view.marks.forecast && !r.isSummary) reach(facts[r.id]?.forecastFinish);
    if (view.marks.contract && !r.isSummary) {
      reach(r.contractStart);
      reach(r.contractFinish);
    }
  }
  const axis = first && last ? axisOf(first, last, W) : null;
  const ppd = axis?.pxPerDay ?? 0;
  const xOf = (d: string) => (axis ? daysBetween(axis.start, d) * ppd : 0);
  const todayX = axis && today >= axis.start && daysBetween(axis.start, today) < axis.days ? xOf(today) : null;

  // ------------------------------------------------------------- the marks
  const late = (r: SheetRow) => {
    const ff = facts[r.id]?.forecastFinish;
    return view.marks.forecast && !r.isSummary && ff && r.finishDate && ff > r.finishDate ? daysBetween(r.finishDate, ff) : 0;
  };
  const slip = (r: SheetRow) =>
    view.marks.slip && late(r) === 0 && !r.isSummary && r.totalFloat != null && r.totalFloat > 0 ? r.totalFloat : 0;
  const onSite = (r: SheetRow) => {
    const f = facts[r.id];
    return !r.isSummary && f?.kindId === 'procurement' && f.rungs.at(-1)?.label === 'On site';
  };
  const colourOf = (r: SheetRow) =>
    r.isSummary || r.isMilestone ? INK : paintCss(paintOf(r, facts[r.id]?.kindId ?? null, view, colourBy, labels.get(r.id) ?? null));

  // ------------------------------------------------------------ the links
  const printedIndex = new Map(rows.map((r, i) => [r.id, i]));
  const parentOf = new Map(allRows.map((r) => [r.id, r.parentId]));
  const codeOf = new Map(allRows.map((r) => [r.id, r.code]));
  const endsOf = (r: SheetRow) => ({ x1: xOf(r.startDate!), x2: xOf(r.finishDate!) + ppd });
  const kindOf = (l: LinkState): ArrowKind =>
    l.slack < 0
      ? 'bad'
      : network.rows.get(l.fromId)?.setsProjectFinish && network.rows.get(l.toId)?.setsProjectFinish
        ? 'path'
        : 'muted';

  type End = { index: number; collapsed: boolean } | null;
  const placed: { link: LinkState; a: End; b: End }[] = [];
  const used = { path: false, bad: false, dashed: false };
  if (view.marks.links && axis) {
    for (const l of network.links) {
      const a = visibleEnd(l.fromId, printedIndex, parentOf);
      const b = visibleEnd(l.toId, printedIndex, parentOf);
      if ((!a && !b) || (a && b && a.index === b.index)) continue;
      const ra = a ? rows[a.index] : null;
      const rb = b ? rows[b.index] : null;
      if ((ra && (!ra.startDate || !ra.finishDate)) || (rb && (!rb.startDate || !rb.finishDate))) continue;
      placed.push({ link: l, a, b });
      const k = kindOf(l);
      if (k === 'path') used.path = true;
      if (k === 'bad') used.bad = true;
      if (a?.collapsed || b?.collapsed) used.dashed = true;
    }
  }

  // ---------------------------------------------------------------- the key
  // Decided by the whole file, so every sheet carries the same key; the sheets
  // are cut after it, because its height comes out of the rows' budget. Every
  // mark starts at its box's left edge, so whichever lands first in a row is
  // flush with the swatch above it.
  const tasks = rows.filter((r) => !r.isSummary && !r.isMilestone && r.startDate);
  const key: { mark: ReactNode; label: string }[] = [];
  const swatch = (css: string) => <rect width="20" height="10" rx="1.5" fill={css} />;
  if (colourBy === 'package') {
    const groups = new Set(rows.map((r) => r.colorGroup));
    for (const g of allRows.filter((r) => r.groupLabel !== null && groups.has(r.colorGroup)))
      key.push({ mark: swatch(paintCss(paintOf(g, null, view, 'package'))), label: g.groupLabel! });
  } else if (colourBy === 'label') {
    const inUse = new Set(tasks.map((r) => labels.get(r.id) ?? null));
    for (const l of view.labels.filter((l) => inUse.has(l.id))) key.push({ mark: swatch(paintCss(l.paint)), label: l.name });
    if (inUse.has(null)) key.push({ mark: swatch(paintCss('muted')), label: 'No label' });
  } else if (colourBy === 'kind') {
    const present = new Set(tasks.map((r) => facts[r.id]?.kindId ?? 'none'));
    for (const k of KIND_KEYS.filter((k) => present.has(k)))
      key.push({
        mark: swatch(paintCss(paintOf({ colorGroup: -1, unitId: null }, k === 'none' ? null : k, view, 'kind'))),
        label: KIND_LABEL[k],
      });
  }
  if (view.marks.done && tasks.length)
    key.push({
      mark: (
        <>
          <rect width="8" height="10" fill={MUTED} />
          <rect x="9" width="8" height="10" fill={MUTED} />
          <rect x="18" width="8" height="10" fill={MUTED} fillOpacity="0.28" />
        </>
      ),
      label: 'Solid done, pale to do',
    });
  if (rows.some((r) => r.isMilestone && !r.isSummary && r.startDate))
    key.push({ mark: <rect x="2" y="1" width="8" height="8" fill={INK} transform="rotate(45 6 5)" />, label: 'Milestone' });
  if (rows.some(onSite)) key.push({ mark: <Flag x={1} y={-2} colour={paintCss('plan-3')} />, label: 'Must be on site' });
  if (placed.length) key.push({ mark: <ArrowMark colour={MUTED} />, label: 'Waits for (+days = wait)' });
  if (used.path) key.push({ mark: <ArrowMark colour={INK} />, label: 'Chain that sets the finish' });
  if (used.bad) key.push({ mark: <ArrowMark colour={RED} dashed />, label: 'Dates break this link' });
  if (used.dashed) key.push({ mark: <ArrowMark colour={MUTED} dashed />, label: 'Link inside a heading not shown' });
  if (rows.some((r) => late(r) > 0))
    key.push({
      mark: <Hatch x={0.5} y={0.5} w={21} h={9} colour={RED} outline />,
      label: 'Forecast later than plan',
    });
  if (rows.some((r) => r.isCritical && !r.isSummary && r.startDate))
    key.push({ mark: <rect x="1" y="0" width="20" height="10" rx="2" fill="none" stroke={RED} strokeWidth="1.5" />, label: 'Sets the project finish' });
  if (rows.some((r) => slip(r) > 0))
    key.push({
      mark: (
        <>
          <path d="M1 5H18" stroke={MUTED} strokeWidth="1.4" strokeDasharray="3 2" />
          <path d="M19 1V9" stroke={MUTED} strokeWidth="1.4" />
        </>
      ),
      label: 'Can slip without moving the finish',
    });
  if (view.marks.contract && contract && rows.some((r) => r.contractStart && !r.isSummary))
    key.push({ mark: <rect y="4" width="22" height="3" rx="1.5" fill={MUTED} fillOpacity="0.45" />, label: 'Contract dates' });
  if (rows.some((r) => r.targetDate)) key.push({ mark: <path d="M0 1h10l-5 8z" fill={INK} fillOpacity="0.55" />, label: 'Target date' });
  if (rows.some((r) => network.rows.get(r.id)?.conflicts.length))
    key.push({
      mark: (
        <>
          <circle cx="5" cy="5" r="5" fill={RED} />
          <text x="5" y="8" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
            !
          </text>
        </>
      ),
      label: 'Starts before what it waits for',
    });
  if (todayX !== null) key.push({ mark: <path d="M1 0V11" stroke={TODAY} strokeWidth="1.5" strokeDasharray="3 2" />, label: 'Data date' });
  // Only what a reader cannot read off the chart itself (8 Oct 2026, "infonya
  // yg penting aja"): a heading's black bar and a link stub's row number
  // explain themselves, and the stub's "1.2 →" mark read as a glitch.
  const keyCols = legendColumns(key.map((k) => k.label));
  // .gantt-key's rows (12px items, 6px gap) and 7px padding, set as its height
  // so the frame the chart draws round it fits it exactly.
  const keyH = key.length ? Math.ceil(key.length / keyCols) * 18 + 8 : 0;
  const legendH = legendHeight(key.map((k) => k.label));

  // ------------------------------------------------------------- the sheets
  const pages = paginate(heights, rows.map((r) => r.isSummary), legendH);
  const pageOf = new Map<number, number>();
  pages.forEach((p, n) => p.forEach((i) => pageOf.set(i, n)));
  const yOf = new Map<number, number>();
  for (const p of pages) {
    let y = SHEET.axis;
    for (const i of p) {
      yOf.set(i, y + heights[i] / 2);
      y += heights[i];
    }
  }

  const arrowsBy: Arrow[][] = pages.map(() => []);
  const stubsBy: Stub[][] = pages.map(() => []);
  for (const { link: l, a, b } of placed) {
    const kind = kindOf(l);
    const ra = a ? rows[a.index] : null;
    const rb = b ? rows[b.index] : null;
    const toMilestone = Boolean(rb?.isMilestone && !b?.collapsed);
    if (a && b && ra && rb && pageOf.get(a.index) === pageOf.get(b.index)) {
      const to = { ...endsOf(rb), y: yOf.get(b.index)!, milestone: toMilestone };
      arrowsBy[pageOf.get(a.index)!].push({
        d: arrowPath(l.type, { ...endsOf(ra), y: yOf.get(a.index)! }, to, heights[b.index]),
        kind,
        dashed: kind === 'bad' || Boolean(a.collapsed || b.collapsed),
        wait: l.wait,
        label: { x: l.type === 'FF' ? to.x2 - 2 : to.x1 + 2, y: to.y - 8, anchor: l.type === 'FF' ? 'end' : 'start' },
      });
      continue;
    }
    if (ra && a) {
      const e = endsOf(ra);
      // Leaving a late bar's finish, the line starts past its hatch and "+N d".
      const lateDays = late(ra);
      const pastLate = lateDays > 0 ? Math.max(lateDays * ppd, 3) + textWidth(`+${lateDays} d`, true, 10) + 8 : 0;
      stubsBy[pageOf.get(a.index)!].push({
        dir: 'out',
        x: l.type === 'SS' ? e.x1 : e.x2 + pastLate,
        y: yOf.get(a.index)!,
        side: l.type === 'SS' ? 'left' : 'right',
        code: rb ? rb.code : (codeOf.get(l.toId) ?? ''),
        kind,
      });
    }
    if (rb && b) {
      const e = endsOf(rb);
      const lateDays = late(rb);
      const pastLate = lateDays > 0 ? Math.max(lateDays * ppd, 3) + textWidth(`+${lateDays} d`, true, 10) + 8 : 0;
      const entry = l.type === 'FF' ? e.x2 + 2 + pastLate : (toMilestone ? e.x1 - 6 : e.x1) - 2;
      stubsBy[pageOf.get(b.index)!].push({
        dir: 'in',
        x: entry,
        y: yOf.get(b.index)!,
        side: l.type === 'FF' ? 'right' : 'left',
        code: ra ? ra.code : (codeOf.get(l.fromId) ?? ''),
        kind,
      });
    }
  }

  /** The heading a sheet starts inside, when that heading sits on an earlier sheet. */
  const continuedFrom = (r: SheetRow, page: number) => {
    let id = r.parentId;
    while (id) {
      const i = printedIndex.get(id);
      if (i !== undefined && (pageOf.get(i) ?? page) < page) return rows[i];
      id = parentOf.get(id) ?? null;
    }
    return null;
  };

  const strokeOf = (k: ArrowKind) => (k === 'bad' ? RED : k === 'path' ? INK : MUTED);
  const gridCols = `${codeW}px ${SHEET.taskW}px ${SHEET.durW}px ${SHEET.dateW}px ${SHEET.dateW}px`;

  return (
    <>
      {pages.map((page, n) => {
        const bodyH = page.reduce((a, i) => a + heights[i], 0);
        const svgH = SHEET.axis + bodyH;
        const cont = page.length ? continuedFrom(rows[page[0]], n) : null;
        return (
          <section key={n} className="print-sheet-a4 print-sheet-landscape gantt-sheet">
            <header className="gantt-head">
              <div className="min-w-0">
                {/* The name alone: the "Schedule · Whole plan · …" line under it
                    went on 8 Oct 2026, asked for. */}
                <h1 className="gantt-title">{project.name}</h1>
              </div>
              {(project.clientName || project.contractorName) && (
                <p className="gantt-parties">
                  {project.clientName && (
                    <>
                      Client <b>{project.clientName}</b>
                    </>
                  )}
                  {project.clientName && project.contractorName && <br />}
                  {project.contractorName && (
                    <>
                      Contractor <b>{project.contractorName}</b>
                    </>
                  )}
                </p>
              )}
            </header>

            {cont && (
              <p className="gantt-cont">
                Continued from {cont.code} {cont.name}
              </p>
            )}

            <div className="gantt-grid" style={{ height: svgH }}>
              <div className={`gantt-table${axis ? ' is-charted' : ''}`} style={{ width: tableW }}>
                <div className="gantt-colhead" style={{ gridTemplateColumns: gridCols, height: SHEET.axis }}>
                  <span>No.</span>
                  <span>Task name</span>
                  <span className="text-right">Duration</span>
                  <span>Start</span>
                  <span>Finish</span>
                </div>
                {page.map((i) => {
                  const r = rows[i];
                  return (
                    <div
                      key={r.id}
                      className={`gantt-row${r.isSummary ? ' is-heading' : ''}${r.isSummary && r.rel === 0 ? ' is-top' : ''}`}
                      style={{ gridTemplateColumns: gridCols, height: heights[i] }}
                    >
                      <span className="gantt-code">{r.code}</span>
                      <span className="gantt-name" style={{ paddingLeft: SHEET.cellPad + r.rel * SHEET.indent }}>
                        {r.name}
                      </span>
                      <span className="text-right">{r.durationDays != null ? `${r.durationDays} d` : ''}</span>
                      <span>{fmtDay(r.startDate)}</span>
                      <span>{fmtDay(r.finishDate)}</span>
                    </div>
                  );
                })}
              </div>

              {axis && (
                <svg className="gantt-chart" style={{ left: tableW }} width={W} height={svgH} aria-hidden>
                  <defs>
                    {(['muted', 'path', 'bad'] as const).map((k) => (
                      <marker key={k} id={`gp-ah-${k}-${n}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M0 0 L8 4 L0 8 z" fill={strokeOf(k)} />
                      </marker>
                    ))}
                  </defs>

                  {/* the calendar */}
                  {axis.grid.map((g, k) => (
                    <line key={k} x1={g.x} y1={g.strong ? 0 : 20} x2={g.x} y2={svgH} stroke="var(--gantt-line)" strokeWidth="0.3" />
                  ))}
                  <line x1="0" y1="20" x2={W} y2="20" stroke="var(--gantt-line)" strokeWidth="0.3" />
                  {/* the table/calendar divider, full height like a year line, so the first year's cell is closed */}
                  <line x1="0" y1="0" x2="0" y2={svgH} stroke="var(--gantt-line)" strokeWidth="0.3" />
                  {axis.top.map((t, k) => (
                    <text key={k} x={t.x + 4} y="14" fontSize="11" fontWeight="600" fill={INK}>
                      {t.label}
                    </text>
                  ))}
                  {axis.bottom.map((t, k) => (
                    <text key={k} x={t.x + 3} y="34" fontSize="10.5" fill={MUTED}>
                      {t.label}
                    </text>
                  ))}
                  {/* the row rules, table included: a CSS border under 1px is rounded up to 1px in the PDF, a stroke is not */}
                  {page.map((i) => {
                    const y = yOf.get(i)! + heights[i] / 2 - 0.15;
                    return <line key={`r-${i}`} x1={-tableW} x2={W} y1={y} y2={y} stroke="var(--gantt-line)" strokeWidth="0.3" />;
                  })}
                  <line x1={-tableW} y1={SHEET.axis - 0.15} x2={W} y2={SHEET.axis - 0.15} stroke={INK} strokeWidth="0.3" />
                  {/* the frame: table, calendar and the key under them as one closed table. Drawn
                      here, in one SVG, because two SVGs are each snapped to whole pixels and their
                      sub-pixel lines never meet */}
                  <rect x={-tableW + 0.15} y="0.15" width={tableW + W - 0.3} height={svgH + keyH - 0.3} fill="none" stroke="var(--gantt-line)" strokeWidth="0.3" />
                  {keyH > 0 && <line x1={-tableW} x2={W} y1={svgH - 0.15} y2={svgH - 0.15} stroke="var(--gantt-line)" strokeWidth="0.3" />}

                  {/* targets first, so a bar running through one is not hidden by it */}
                  {page.map((i) => {
                    const r = rows[i];
                    if (!r.targetDate) return null;
                    const x = xOf(r.targetDate);
                    const y = yOf.get(i)!;
                    const lateTarget = r.daysLate != null;
                    return (
                      <g key={`t-${r.id}`}>
                        {lateTarget && r.finishDate && (
                          <Hatch
                            x={x}
                            y={y - (r.isSummary ? 2.5 : 6)}
                            w={Math.max(daysBetween(r.targetDate, r.finishDate) * ppd, 2)}
                            h={r.isSummary ? 5 : 12}
                            colour="var(--warn)"
                          />
                        )}
                        <path d={`M${x - 4} ${y - 11} h8 l-4 7 z`} fill={lateTarget ? 'var(--warn)' : INK} fillOpacity={lateTarget ? 1 : 0.55} />
                      </g>
                    );
                  })}

                  {/* the bars */}
                  {page.map((i) => {
                    const r = rows[i];
                    if (!r.startDate || !r.finishDate) return null;
                    const y = yOf.get(i)!;
                    const x = xOf(r.startDate);
                    const conflict = network.rows.get(r.id)?.conflicts[0];
                    let conflictMark: ReactNode = null;
                    if (conflict) {
                      const edge = conflict.type === 'FF' ? xOf(r.finishDate) + ppd : x;
                      const bound = xOf(conflict.bound) + (conflict.type === 'FF' ? ppd : 0);
                      const cx = Math.max(7, x - 10);
                      conflictMark = (
                        <g>
                          <rect x={Math.min(edge, bound)} y={y - heights[i] / 2 + 3} width={Math.abs(bound - edge)} height={heights[i] - 6} fill={RED} fillOpacity="0.1" />
                          <circle cx={cx} cy={y - 5} r="6" fill={RED} />
                          <text x={cx} y={y - 1.5} textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">
                            !
                          </text>
                        </g>
                      );
                    }

                    if (r.isMilestone && !r.isSummary) {
                      return (
                        <g key={r.id}>
                          {conflictMark}
                          <rect
                            x={x - 5.5}
                            y={y - 5.5}
                            width="11"
                            height="11"
                            fill={INK}
                            stroke={r.isCritical ? RED : 'none'}
                            strokeWidth="1.5"
                            transform={`rotate(45 ${x} ${y})`}
                          />
                        </g>
                      );
                    }

                    const w = Math.max((daysBetween(r.startDate, r.finishDate) + 1) * ppd, 3);
                    if (r.isSummary) {
                      return (
                        <g key={r.id}>
                          {conflictMark}
                          <rect x={x} y={y - 2.5} width={w} height="5" fill={INK} />
                        </g>
                      );
                    }

                    const colour = colourOf(r);
                    const fact = facts[r.id];
                    const staged = (fact?.rungs.length ?? 0) > 1 && view.marks.done;
                    const parts = view.marks.done
                      ? segmentsOf(fact?.rungs ?? [], fact?.donePct ?? 0)
                      : [{ label: '', from: 0, to: 1, done: true }];
                    const lateDays = late(r);
                    const slipDays = slip(r);
                    const end = x + w;
                    const lateEnd = end + Math.max(lateDays * ppd, 3);
                    const lateInside = lateEnd + 34 > W;
                    return (
                      <g key={r.id}>
                        {conflictMark}
                        {view.marks.contract && r.contractStart && r.contractFinish && (
                          <rect
                            x={xOf(r.contractStart)}
                            y={y + 7.5}
                            width={Math.max((daysBetween(r.contractStart, r.contractFinish) + 1) * ppd, 3)}
                            height="2.5"
                            rx="1.25"
                            fill={MUTED}
                            fillOpacity="0.45"
                          />
                        )}
                        {parts.map((p, k) => {
                          const gapL = staged && k > 0 ? 0.75 : 0;
                          const gapR = staged && k < parts.length - 1 ? 0.75 : 0;
                          return (
                            <rect
                              key={k}
                              x={x + p.from * w + gapL}
                              y={y - 6}
                              width={Math.max((p.to - p.from) * w - gapL - gapR, 0.5)}
                              height="12"
                              rx="1"
                              fill={colour}
                              fillOpacity={p.done ? 0.92 : 0.28}
                            />
                          );
                        })}
                        {r.isCritical && <rect x={x - 1.5} y={y - 7.5} width={w + 3} height="15" rx="2.5" fill="none" stroke={RED} strokeWidth="1.5" />}
                        {onSite(r) && <Flag x={end - 1} y={y - 15} colour={colour} />}
                        {lateDays > 0 && (
                          <>
                            <Hatch x={end + 0.5} y={y - 6} w={lateEnd - end - 0.5} h={12} colour={RED} outline />
                            <text
                              x={lateInside ? lateEnd - 3 : lateEnd + 4}
                              y={y + 3.5}
                              textAnchor={lateInside ? 'end' : 'start'}
                              fontSize="10"
                              fontWeight="700"
                              fill={RED}
                              stroke="#fff"
                              strokeWidth="3"
                              paintOrder="stroke"
                            >
                              +{lateDays} d
                            </text>
                          </>
                        )}
                        {slipDays > 0 && (
                          <>
                            <path d={`M${end + 1} ${y}H${end + slipDays * ppd}`} stroke={MUTED} strokeWidth="1.4" strokeDasharray="3 2" />
                            <path d={`M${end + slipDays * ppd} ${y - 4}V${y + 4}`} stroke={MUTED} strokeWidth="1.4" />
                            <text
                              x={Math.min(end + slipDays * ppd + 4, W - 46)}
                              y={y + 3.5}
                              fontSize="10"
                              fill={MUTED}
                              stroke="#fff"
                              strokeWidth="3"
                              paintOrder="stroke"
                            >
                              +{slipDays} {slipDays === 1 ? 'day' : 'days'}
                            </text>
                          </>
                        )}
                      </g>
                    );
                  })}

                  {/* the links: whole arrows on the sheet, short ones with a number off it */}
                  {arrowsBy[n].map((a, k) => (
                    <g key={`a-${k}`}>
                      <path
                        d={a.d}
                        fill="none"
                        stroke={strokeOf(a.kind)}
                        strokeWidth={a.kind === 'bad' ? 1.6 : 1.2}
                        strokeDasharray={a.dashed ? '4 3' : undefined}
                        markerEnd={`url(#gp-ah-${a.kind}-${n})`}
                      />
                      {a.wait > 0 && (
                        <text x={a.label.x} y={a.label.y} textAnchor={a.label.anchor} fontSize="10" fill={MUTED} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                          +{a.wait} {a.wait === 1 ? 'day' : 'days'}
                        </text>
                      )}
                    </g>
                  ))}
                  {stubsBy[n].map((s, k) => {
                    const labelW = textWidth(s.code, true, 10);
                    // The line runs 16px out from the bar and the number sits past
                    // its end. Near the chart's edge the number is pinned to the
                    // edge and the line shortened to meet it, never thrown over the bar.
                    const left = s.side === 'left';
                    const room = left ? s.x : W - s.x;
                    const len = Math.max(6, Math.min(16, room - labelW - 4));
                    const far = left ? s.x - len : s.x + len;
                    const lx = left ? Math.max(far - 3, labelW) : Math.min(far + 3, W - labelW);
                    const toLeft = left;
                    return (
                      <g key={`s-${k}`}>
                        <path
                          d={s.dir === 'in' ? `M${far} ${s.y}H${s.x}` : `M${s.x} ${s.y}H${far}`}
                          stroke={strokeOf(s.kind)}
                          strokeWidth="1.2"
                          strokeDasharray={s.kind === 'bad' ? '4 3' : undefined}
                          markerEnd={`url(#gp-ah-${s.kind}-${n})`}
                        />
                        {/* On the line's own row, beside its far end: above it, the number
                            sat on the "+7 days" of the arrow coming into the same bar. */}
                        <text
                          x={lx}
                          y={s.y + 3.5}
                          textAnchor={toLeft ? 'end' : 'start'}
                          fontSize="10"
                          fontWeight="600"
                          fill={strokeOf(s.kind)}
                          stroke="#fff"
                          strokeWidth="3"
                          paintOrder="stroke"
                        >
                          {s.code}
                        </text>
                      </g>
                    );
                  })}

                  {todayX !== null && (
                    <g>
                      <line x1={todayX} y1="20" x2={todayX} y2={svgH} stroke={TODAY} strokeWidth="1.4" strokeDasharray="4 3" />
                    </g>
                  )}
                </svg>
              )}
            </div>

            <div className="gantt-key" style={{ gridTemplateColumns: `repeat(${keyCols}, auto)`, height: keyH }}>
              {key.map((k) => (
                <span key={k.label}>
                  <svg width="26" height="12" viewBox="0 -1 26 12" aria-hidden>
                    {k.mark}
                  </svg>
                  {k.label}
                </span>
              ))}
            </div>

            <footer className="gantt-foot">
              <span className="gantt-brand">
                {/* A plain img: lib/pdf.ts waits for it, and next/image would lazy-load it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/lucille-mark-print.png" alt="" />
                <span>
                  <b>Lucille</b> by Figtries
                </span>
              </span>
              <span>
                Page {n + 1} of {pages.length}
              </span>
            </footer>
          </section>
        );
      })}
    </>
  );
}

/**
 * Diagonal stripes as plain lines. An SVG <pattern> came out of Chromium's PDF
 * as a raster image the width of the page, four per sheet: 1.4 MB for nine
 * pages of a file meant to be sent over WhatsApp.
 */
function Hatch({ x, y, w, h, colour, outline = false }: { x: number; y: number; w: number; h: number; colour: string; outline?: boolean }) {
  let d = '';
  for (let t = -h; t < w; t += 4) {
    // The line from (t, h) to (t + h, 0), clipped to 0..w.
    const x0 = Math.max(t, 0);
    const x1 = Math.min(t + h, w);
    if (x1 <= x0) continue;
    d += `M${(x + x0).toFixed(2)} ${(y + h - (x0 - t)).toFixed(2)}L${(x + x1).toFixed(2)} ${(y + h - (x1 - t)).toFixed(2)}`;
  }
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill="#fff" stroke={outline ? colour : 'none'} strokeWidth="0.9" />
      <path d={d} stroke={colour} strokeWidth="1.4" />
    </>
  );
}

function Flag({ x, y, colour }: { x: number; y: number; colour: string }) {
  return <path d={`M${x} ${y + 14}V${y}l8 3.5-8 3.5`} fill={colour} stroke={colour} strokeWidth="1.3" strokeLinejoin="round" />;
}

function ArrowMark({ colour, dashed = false }: { colour: string; dashed?: boolean }) {
  return (
    <>
      <path d="M1 5H19" stroke={colour} strokeWidth="1.3" strokeDasharray={dashed ? '3 2' : undefined} />
      <path d="M18 1l7 4-7 4z" fill={colour} />
    </>
  );
}
