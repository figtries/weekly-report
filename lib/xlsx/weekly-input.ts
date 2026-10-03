import { apportion, r2, shownDiff } from '../figures';
import { hasRealQuantity } from '../progress';
import {
  computeGrandTotal,
  flattenTree,
  packageOfNodes,
  summariseUnits,
  type RollupNode,
} from '../rollup';
import { buildPackageSCurves, buildSCurveSeries, type SCurveRow } from '../scurve';
import type { Database } from '../types';
import { formatDateLong, toISODate, weekEndDate, weekStartDate } from '../weeks';

/**
 * One week of the open project, gathered for the weekly Excel export.
 *
 * THE LOOK IS THE SAMPLE'S, THE CONTENT IS THE APP'S (3 Oct 2026). Nothing here
 * computes a figure of its own: every number is read off the rollup, the
 * summary groups and the S-curve series the screens show, and only ROUNDED the
 * way they print (`lib/figures.ts`): differences are taken between rounded
 * figures, and the Summary's package columns are apportioned so each adds to
 * its printed total. Figures are percent units here (7.07 for 7.07%); the
 * writer turns them into the fractions Excel's `0.00%` format wants.
 */

export interface PercentRow {
  bobot: number;
  prevProgress: number;
  prevWF: number;
  thisProgress: number;
  thisWF: number;
  curProgress: number;
  curWF: number;
  target: number;
  variance: number;
}

export type DetailKind = 'root' | 'heading' | 'package' | 'activity';

export interface DetailLine {
  kind: DetailKind;
  wbs: string;
  /** Indented three spaces per depth, as the sample types it. */
  text: string;
  /** The weight column; null where the sample leaves it blank. */
  bobot: number | null;
  vol: number | null;
  satuan: string | null;
  /** Every progress column; activities with a weight only. */
  figures: PercentRow | null;
}

export interface DetailSheetData {
  lines: DetailLine[];
  total: PercentRow;
}

export interface WeeklyPackage {
  key: string;
  /** As the project names it ("SPK-001 Gas Processing Facility (GPF)"). */
  label: string;
  contractNo: string | null;
  /** What follows "Detail " / "S-Curve " in the sheet names. */
  sheetSuffix: string;
}

export interface SummaryLine extends PercentRow {
  no: number;
  text: string;
}

export interface WeeklyExportInput {
  week: number;
  /** "22 July 2026 to 28 July 2026": the workbook is in English, like the app. */
  periodText: string;
  periodStart: string;
  periodEnd: string;
  project: {
    name: string;
    contractNo: string;
    customer: string;
    documentNoWeekly: string;
    signatureLeft: { company: string; name: string };
    signatureRight: { company: string; name: string };
  };
  packages: WeeklyPackage[];
  summary: { rows: SummaryLine[]; total: PercentRow };
  detail: { overall: DetailSheetData; byPackage: Map<string, DetailSheetData> };
  scurve: {
    overall: SCurveRow[];
    byPackage: Map<string, SCurveRow[]>;
    /** ISO dates; index 0 is the project's first day, index w is week w's last day. */
    weekEnds: string[];
  };
  /** Stored photo paths in the Photos tab's order, empty slots left out. */
  photos: string[];
}

export { OVERALL, hasFigures, parseSelection, selectionCount, selectionQuery } from './weekly-selection';
export type { WeeklySelection } from './weekly-selection';

// ------------------------------------------------------------- names

const SHEET_NAME_MAX = 31;

/**
 * The part after "Detail " / "S-Curve ": the package's label when it has one, else
 * its name. Excel refuses `[]:*?/\` and names over 31 characters, and two sheets may
 * not share a name, so the suffix is cleaned, cut to fit the LONGER prefix, and made
 * unique with " (2)".
 */
export function sheetSuffix(label: string, taken: Set<string>): string {
  const room = SHEET_NAME_MAX - 'S-Curve '.length;
  const clean = label.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Package';
  let name = clean.slice(0, room).trim();
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    const tail = ` (${n})`;
    name = clean.slice(0, room - tail.length).trim() + tail;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** `PRGG-00-G0-RPT-002_WEEKLY PROGRESS REPORT W45 (Overall)_030926.xlsx` */
export function weeklyFileName(documentNoWeekly: string, week: number, periodEndISO: string): string {
  const [y, m, d] = periodEndISO.split('-');
  const doc = documentNoWeekly.replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${doc ? `${doc}_` : ''}WEEKLY PROGRESS REPORT W${week} (Overall)_${d}${m}${y.slice(2)}.xlsx`;
}

// ------------------------------------------------------------- gather

const indent = (depth: number, text: string) => '   '.repeat(depth) + text.trim();

/** A leaf's columns scaled by `f` (1 overall, 100 / package weight inside a package). */
function leafFigures(n: RollupNode, f: number): PercentRow {
  const prevWF = r2(n.prevWF * f);
  const curWF = r2(n.curWF * f);
  const target = r2(n.targetWF * f);
  const prevProgress = r2(n.prevProgressPct);
  const curProgress = r2(n.curProgressPct);
  return {
    bobot: r2(n.bobot * f),
    prevProgress,
    prevWF,
    thisProgress: shownDiff(curProgress, prevProgress),
    thisWF: shownDiff(curWF, prevWF),
    curProgress,
    curWF,
    target,
    variance: shownDiff(curWF, target),
  };
}

function totalRow(bobot: number, prevWF: number, curWF: number, targetWF: number): PercentRow {
  const b = r2(bobot);
  const prev = r2(prevWF);
  const cur = r2(curWF);
  const target = r2(targetWF);
  const prevProgress = bobot > 0 ? r2((prevWF / bobot) * 100) : 0;
  const curProgress = bobot > 0 ? r2((curWF / bobot) * 100) : 0;
  return {
    bobot: b,
    prevProgress,
    prevWF: prev,
    thisProgress: shownDiff(curProgress, prevProgress),
    thisWF: shownDiff(cur, prev),
    curProgress,
    curWF: cur,
    target,
    variance: shownDiff(cur, target),
  };
}

export function gatherWeeklyExport(args: {
  db: Database;
  /** The week's rollup exactly as the screens read it (`getOpenWeekRollup().roots`). */
  roots: RollupNode[];
  week: number;
  /** `weeklyPhotosOf(json, week)` */
  photoSlots: (string | null)[];
}): WeeklyExportInput {
  const { db, roots, week } = args;
  const p = db.project;
  const anchor = p.weekAnchorEndDate;
  const start = weekStartDate(anchor, week);
  const end = weekEndDate(anchor, week);
  const items = new Map(db.wbsItems.map((i) => [i.id, i]));

  // ---- packages, as the Summary cards show them
  const { rows: groups } = summariseUnits(roots);
  const taken = new Set<string>();
  const packages: WeeklyPackage[] = groups.map((g) => {
    const node = items.get(g.key);
    const tag = /^\(SPK-\d+\)$/.test(g.key) ? g.key.slice(1, -1) : null;
    const short = node?.unitLabel?.trim() || tag || g.deskripsi;
    return {
      key: g.key,
      label: g.deskripsi.trim(),
      contractNo: node?.unitContractNo?.trim() || null,
      sheetSuffix: sheetSuffix(short, taken),
    };
  });

  // ---- Summary: apportioned so each WF column adds to its printed total
  const gt = computeGrandTotal(roots);
  const total = totalRow(gt.bobot, gt.prevWF, gt.curWF, gt.targetWF);
  const bobots = apportion(groups.map((g) => g.bobot), total.bobot);
  const prevs = apportion(groups.map((g) => g.prevWF), total.prevWF);
  const curs = apportion(groups.map((g) => g.curWF), total.curWF);
  const targets = apportion(groups.map((g) => g.targetWF), total.target);
  const summaryRows: SummaryLine[] = groups.map((g, i) => {
    const prevProgress = r2(g.prevProgressPct);
    const curProgress = r2(g.curProgressPct);
    return {
      no: i + 1,
      text: g.deskripsi.trim().toUpperCase(),
      bobot: bobots[i],
      prevProgress,
      prevWF: prevs[i],
      thisProgress: shownDiff(curProgress, prevProgress),
      thisWF: shownDiff(curs[i], prevs[i]),
      curProgress,
      curWF: curs[i],
      target: targets[i],
      variance: shownDiff(curs[i], targets[i]),
    };
  });

  // ---- Detail
  const flat = flattenTree(roots);
  const packageOf = packageOfNodes(roots);
  const anchors = new Set(groups.map((g) => g.key));
  const kindOf = (n: RollupNode): DetailKind =>
    anchors.has(n.id) ? 'package' : n.children.length > 0 ? (n.depth === 0 ? 'root' : 'heading') : 'activity';
  const quantity = (n: RollupNode) =>
    hasRealQuantity(n) ? { vol: n.vol, satuan: n.satuan } : { vol: 1, satuan: 'Ls' };

  const lineFor = (n: RollupNode, f: number, bobot: number | null): DetailLine => {
    const kind = kindOf(n);
    const weighed = kind === 'activity' && n.bobot > 0;
    return {
      kind,
      wbs: n.wbsCode,
      text: indent(n.depth, n.deskripsi),
      bobot: bobot !== null && bobot > 0 ? r2(bobot) : null,
      ...(weighed ? quantity(n) : { vol: null, satuan: null }),
      figures: weighed ? leafFigures(n, f) : null,
    };
  };

  const overall: DetailSheetData = {
    lines: flat.map((n) => lineFor(n, 1, n.bobot)),
    total,
  };

  // Inside a package: its own rows (a package nested in it reports in its own
  // sheet, as on the Summary), weights as a share of the package, and the rows
  // above it as plain headings so the WBS still reads from the top.
  const byPackage = new Map<string, DetailSheetData>();
  const leafWeight = new Map<string, number>();
  const weightIn = (n: RollupNode, key: string): number => {
    const memo = `${key}|${n.id}`;
    if (leafWeight.has(memo)) return leafWeight.get(memo)!;
    const w =
      packageOf.get(n.id) !== key
        ? 0
        : n.children.length === 0
          ? n.bobot
          : n.children.reduce((s, c) => s + weightIn(c, key), 0);
    leafWeight.set(memo, w);
    return w;
  };
  for (const g of groups) {
    const f = g.bobot > 0 ? 100 / g.bobot : 0;
    const head = flat.find((n) => n.id === g.key) ?? null;
    const ancestors = new Set<string>();
    for (let id = head?.parentId ?? null; id; id = items.get(id)?.parentId ?? null) ancestors.add(id);
    const lines: DetailLine[] = [];
    for (const n of flat) {
      if (ancestors.has(n.id)) {
        lines.push({ ...lineFor(n, f, null), kind: n.depth === 0 ? 'root' : 'heading' });
      } else if (packageOf.get(n.id) === g.key) {
        lines.push(lineFor(n, f, weightIn(n, g.key) * f));
      }
    }
    byPackage.set(g.key, { lines, total: totalRow(100, g.prevWF * f, g.curWF * f, g.targetWF * f) });
  }

  // ---- S-curve: the app's own series, cut at this week
  const weekEnds = [toISODate(weekStartDate(anchor, 1))];
  for (let w = 1; w <= week; w += 1) weekEnds.push(toISODate(weekEndDate(anchor, w)));

  return {
    week,
    periodText: `${formatDateLong(start)} to ${formatDateLong(end)}`,
    periodStart: toISODate(start),
    periodEnd: toISODate(end),
    project: {
      name: p.name,
      contractNo: p.contractNo ?? '',
      customer: p.customer ?? '',
      documentNoWeekly: p.documentNoWeekly ?? '',
      signatureLeft: { company: p.signatureLeft?.company ?? '', name: p.signatureLeft?.name ?? '' },
      signatureRight: { company: p.signatureRight?.company ?? '', name: p.signatureRight?.name ?? '' },
    },
    packages,
    summary: { rows: summaryRows, total },
    detail: { overall, byPackage },
    scurve: {
      overall: buildSCurveSeries(db, week),
      byPackage: buildPackageSCurves(db, week),
      weekEnds,
    },
    photos: args.photoSlots.filter((x): x is string => !!x),
  };
}
