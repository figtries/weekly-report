/**
 * Loads the CPP Gundih weekly workbook into the v2 database.
 *
 * The point is not the data — it is the calculation model. Gundih is a report
 * a client has already signed, so it is the only reference we have for whether
 * our arithmetic is right. `verify-import.ts` is the other half of this script
 * and the one that actually proves anything.
 *
 * What is stored and what is not:
 *
 *   stored   weight, start, finish (both baselines), actual progress per week
 *   derived  the whole plan curve — see lib/plan-curve.ts and decision 14
 *
 * The workbook's own `PLAN` columns are read but never written. Where they
 * disagree with the dates sitting beside them, THE DATES WIN, and the
 * disagreement is printed rather than silently absorbed: 126 of 176 leaves
 * carry a plan column that no longer matches their own schedule, which is the
 * same disease as the `#REF!` in the document register.
 *
 * Run: node scripts/import-gundih.ts [path-to-workbook]
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '../lib/schema.ts';
import { leafPlanFraction } from '../lib/plan-curve.ts';
import { readGundihWorkbook, type SourceRow } from './gundih-source.ts';

// Not `lib/sqlite.ts`: that module keeps a process-wide handle alive because
// Next re-evaluates modules on every edit. A script wants the opposite — open,
// write, close — and reaching for the app's handle would also drag the app's
// module graph into a plain node process.
const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');
const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

const DEFAULT_FILE =
  'E:/Pa Singgih/44. CPP Gundih_Relokasi Taurus 60 Tanjung & Relokasi Centaur 40 Limau/6. Progress/Weekly Report/W43/PRGG-00-G0-RPT-002_WEEKLY PROGRESS REPORT W43 (Overall)_060826.xlsx';

const PROJECT_ID = 'gundih';

/** A reporting unit is a node whose weight closes at 100% inside itself. */
const UNIT_TOLERANCE = 1e-6;
/** No single task is the whole project; a leaf this heavy is a total row. */
const TOTAL_ROW_THRESHOLD = 0.5;

interface Node {
  id: string;
  row: SourceRow;
  parentId: string | null;
  depth: number;
  isLeaf: boolean;
  isUnit: boolean;
  unitLabel: string | null;
  /** Null on branches, on the total row, and on unpriced schedule markers. */
  bobot: number | null;
  bobotInUnit: number | null;
}

function build(rows: SourceRow[]) {
  const byCode = new Map(rows.map((r) => [r.wbsCode, r]));
  const idOf = (code: string) => `${PROJECT_ID}:${code}`;

  /** The nearest ancestor that actually exists as a row — levels can be skipped. */
  const parentOf = (code: string): string | null => {
    const parts = code.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const candidate = parts.slice(0, i).join('.');
      if (byCode.has(candidate)) return idOf(candidate);
    }
    return null;
  };

  const totalRows: SourceRow[] = [];

  const nodes: Node[] = rows.map((row, index) => {
    const isLeaf = !rows.some((o) => o.wbsCode.startsWith(`${row.wbsCode}.`));
    const isUnit = row.wfUnit !== null && Math.abs(row.wfUnit - 1) < UNIT_TOLERANCE;
    const isTotalRow = isLeaf && !isUnit && row.wfOverall !== null && row.wfOverall >= TOTAL_ROW_THRESHOLD;
    if (isTotalRow) totalRows.push(row);

    return {
      id: idOf(row.wbsCode),
      row,
      parentId: parentOf(row.wbsCode),
      depth: row.wbsCode.split('.').length - 1,
      isLeaf,
      isUnit,
      unitLabel: /\((SPK-\d+)\)/.exec(row.deskripsi)?.[1] ?? null,
      // Only leaves carry weight; a branch's weight is its children's sum, and
      // storing it too would double every rollup.
      bobot: isLeaf && !isTotalRow && row.wfOverall !== null ? row.wfOverall * 100 : null,
      bobotInUnit: isLeaf && !isTotalRow && row.wfUnit !== null ? row.wfUnit * 100 : null,
      order: index,
    } as Node & { order: number };
  });

  return { nodes: nodes as Array<Node & { order: number }>, totalRows };
}

/**
 * Weeks before the reported one were signed off as they went; the reported week
 * is the one on the desk. Nothing past it has happened.
 */
function weekStatus(weekNo: number, reported: number): schema.WeekStatus {
  if (weekNo < reported) return 'approved';
  return weekNo === reported ? 'submitted' : 'open';
}

/** SQLite takes a bounded number of bound parameters per statement. */
function inChunks<T>(items: T[], size: number, write: (batch: T[]) => void) {
  for (let i = 0; i < items.length; i += size) write(items.slice(i, i + size));
}

async function main() {
  const file = process.argv[2] ?? DEFAULT_FILE;
  console.log(`membaca  ${file}`);
  const src = await readGundihWorkbook(file);

  const reported = src.reportedWeek ?? src.weeks[src.weeks.length - 1].weekNo;
  console.log(`         ${src.rows.length} baris · ${src.weeks.length} minggu · dilaporkan sampai W${reported}\n`);

  const { nodes, totalRows } = build(src.rows);
  const leaves = nodes.filter((n) => n.bobot !== null);
  const units = nodes.filter((n) => n.isUnit);

  const totalBobot = leaves.reduce((a, n) => a + n.bobot!, 0);
  if (Math.abs(totalBobot - 100) > 1e-6) {
    throw new Error(`bobot tidak menutup di 100: ${totalBobot.toFixed(8)}`);
  }

  const contractValue = units.reduce((a, n) => a + (n.row.price ?? 0), 0);
  const withDates = nodes.filter((n) => n.row.contractual);
  const startDate = withDates.reduce((a, n) => (n.row.contractual!.start < a ? n.row.contractual!.start : a), '9999');
  const finishDate = withDates.reduce((a, n) => (n.row.contractual!.finish > a ? n.row.contractual!.finish : a), '0000');

  /* ------------------------------------------------------------- write */

  db.transaction((tx) => {
    // Re-runnable: the project cascades to everything that hangs off it.
    tx.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();

    tx.insert(schema.projects).values({
      id: PROJECT_ID,
      name: src.project.name ?? 'CPP Gundih',
      clientName: src.project.clientName,
      contractorName: 'PT. INDOTURBINE',
      contractNo: src.project.contractNo,
      docNoPrefix: 'PRGG-00-G0',
      contractValue,
      currency: 'USD',
      weightBasis: 'boq',
      startDate,
      finishDate,
    }).run();

    inChunks(nodes, 200, (batch) => {
      tx.insert(schema.wbsNodes).values(batch.map((n) => ({
        id: n.id,
        projectId: PROJECT_ID,
        parentId: n.parentId,
        wbsCode: n.row.wbsCode,
        deskripsi: n.row.deskripsi,
        order: n.order,
        depth: n.depth,
        isLeaf: n.isLeaf,
        isReportingUnit: n.isUnit,
        unitLabel: n.unitLabel,
        unitContractValue: n.isUnit ? n.row.price : null,
        price: n.row.price,
        bobot: n.bobot,
        bobotInUnit: n.bobotInUnit,
        workstepFactor: n.row.workstep,
        progressMethod: 'lumpsum' as const,
      }))).run();
    });

    // Two baselines side by side: `contractual` is what a claim is argued
    // against, `active` is what the work is managed against. In this workbook
    // they differ on exactly one leaf — 1.4.4.4 was pulled forward six weeks —
    // and that single row is most of why the project reads ahead of plan.
    for (const [kind, revisionNo, label] of [
      ['contractual', 0, 'BASELINE-1'],
      ['active', 1, 'RE-BASELINE'],
    ] as const) {
      const baselineId = `${PROJECT_ID}:${kind}`;
      tx.insert(schema.baselines).values({
        id: baselineId, projectId: PROJECT_ID, kind, revisionNo, label,
        reason: kind === 'active' ? 'Re-baseline seperti tercatat di workbook W43' : null,
      }).run();

      const schedules = nodes
        .map((n) => {
          const s = kind === 'contractual' ? n.row.contractual : (n.row.active ?? n.row.contractual);
          if (!s) return null;
          return {
            id: `${baselineId}:${n.row.wbsCode}`,
            baselineId, nodeId: n.id,
            startDate: s.start, finishDate: s.finish,
            durationDays: Math.round((Date.parse(s.finish) - Date.parse(s.start)) / 86_400_000) + 1,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      inChunks(schedules, 200, (batch) => tx.insert(schema.nodeSchedules).values(batch).run());
    }

    inChunks(src.weeks, 200, (batch) => {
      tx.insert(schema.weeks).values(batch.map((w) => ({
        id: `${PROJECT_ID}:W${w.weekNo}`,
        projectId: PROJECT_ID,
        weekNo: w.weekNo,
        startDate: w.startDate,
        endDate: w.endDate,
        status: weekStatus(w.weekNo, reported),
      }))).run();
    });

    const progress = [];
    for (const week of src.weeks) {
      if (week.weekNo > reported) continue;
      for (const leaf of leaves) {
        progress.push({
          id: `${PROJECT_ID}:W${week.weekNo}:${leaf.row.wbsCode}`,
          weekId: `${PROJECT_ID}:W${week.weekNo}`,
          nodeId: leaf.id,
          method: 'lumpsum' as const,
          cumProgressPct: (leaf.row.actual.get(week.weekNo) ?? 0) * 100,
        });
      }
    }
    inChunks(progress, 200, (batch) => tx.insert(schema.leafProgress).values(batch).run());
    console.log(`tersimpan ${progress.length} baris progress (W1–W${reported} × ${leaves.length} leaf)`);
  });

  /* ----------------------------------------------------------- report */

  console.log(`\nproyek   ${src.project.name}`);
  console.log(`kontrak  ${src.project.contractNo}`);
  console.log(`nilai    ${contractValue.toLocaleString('en-US')}   ${startDate} → ${finishDate}`);
  console.log(`\n${nodes.length} node · ${leaves.length} leaf berbobot · bobot ${totalBobot.toFixed(8)}%`);

  console.log('\nunit pelaporan:');
  for (const u of units) {
    console.log(`  ${(u.unitLabel ?? '?').padEnd(8)} ${u.row.wbsCode.padEnd(7)} ${((u.row.wfOverall ?? 0) * 100).toFixed(4).padStart(8)}%  ${u.row.deskripsi.slice(0, 46)}`);
  }

  if (totalRows.length) {
    console.log('\nbaris total dibuang dari perhitungan bobot:');
    for (const r of totalRows) console.log(`  ${r.wbsCode}  "${r.deskripsi}"  wf=${r.wfOverall}`);
  }

  reconcilePlan(src.weeks, leaves);
  console.log(`\nditulis ke ${DB_PATH}`);
}

/**
 * Says out loud where the workbook's own plan columns contradict the dates
 * beside them. Not a failure — the dates win by decision — but the planner
 * needs the list, because on paper these rows read as a schedule nobody has
 * regenerated since the last revision.
 */
function reconcilePlan(weeks: Array<{ weekNo: number; endDate: string }>, leaves: Array<Node & { order: number }>) {
  const disagreeing = new Set<string>();
  let worst = { weekNo: 0, gap: 0 };

  for (const week of weeks) {
    let gap = 0;
    for (const leaf of leaves) {
      const s = leaf.row.contractual;
      if (!s) continue;
      const derived = leafPlanFraction(s.start, s.finish, week.endDate);
      const excel = leaf.row.plan.get(week.weekNo) ?? 0;
      if (Math.abs(derived - excel) > 1e-6) disagreeing.add(leaf.row.wbsCode);
      gap += (derived - excel) * leaf.bobot!;
    }
    if (Math.abs(gap) > Math.abs(worst.gap)) worst = { weekNo: week.weekNo, gap };
  }

  const weight = leaves
    .filter((l) => disagreeing.has(l.row.wbsCode))
    .reduce((a, l) => a + l.bobot!, 0);

  console.log('\nrekonsiliasi kurva rencana (tanggal vs kolom PLAN workbook):');
  console.log(`  ${disagreeing.size} dari ${leaves.length} leaf punya kolom PLAN yang tidak cocok dengan tanggalnya sendiri`);
  console.log(`  bobot gabungannya ${weight.toFixed(2)}% dari proyek`);
  console.log(`  selisih terbesar  ${worst.gap >= 0 ? '+' : ''}${worst.gap.toFixed(4)} poin di W${worst.weekNo}`);
  console.log('  tanggal yang dipakai. kolom PLAN tidak disimpan.');
}

await main();
sqlite.close();
