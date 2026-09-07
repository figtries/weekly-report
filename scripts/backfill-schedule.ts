/**
 * Copy the imported start/finish dates into the JSON store's `schedule`.
 *
 * The weekly screens run on `data/db.json`, whose plan curve was typed by hand
 * in the client's workbook. AGENTS.md records why that curve cannot be trusted
 * to say when an item is meant to be worked on: 126 of 176 leaves have a PLAN
 * column that disagrees with the dates printed beside it. Counted against that
 * curve, "active this week" comes out at 52 items in W43 and 155 in the early
 * weeks — a worklist that filters nothing.
 *
 * The v2 import (`data/report.db`) holds the real dates, 176 of them, and
 * against those the same week has 3 active leaves and the project averages 8.7.
 * That is the number the worklist needs, so this brings the dates across.
 *
 * SAFE BY CONSTRUCTION: nothing reads `db.schedule` at render time. It is
 * written only by `applySetup` and the plan curve is already frozen into
 * `weeks[].leafData[].targetWF`, so adding it moves no reported figure. Verify
 * that before running this if the app has changed:
 *
 *     grep -rn "\.schedule\b" lib/ app/ components/
 *
 * Run: node scripts/backfill-schedule.ts [--write]
 * Without --write it only reports what it would do.
 */
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import type { DistributionPattern, ScheduleItem } from '../lib/types.ts';

const DB_JSON = 'data/db.json';
const REPORT_DB = 'data/report.db';
const MS_PER_DAY = 86_400_000;

const write = process.argv.includes('--write');

interface SqliteRow {
  wbs_code: string;
  start_date: string;
  finish_date: string;
}

function parseISO(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Which reporting week a date falls in.
 *
 * Weeks are derived from the anchor, not read from `weeks[].periodStart` —
 * those are null on later weeks, and W1 is truncated where a project starts
 * mid-week. Anything before W1 or after the last week clamps to the edge: a
 * schedule that runs past the reporting window still belongs to the last week
 * it can be reported in.
 */
function weekOf(iso: string, anchorEndISO: string, totalWeeks: number): number {
  const firstWeekStart = parseISO(anchorEndISO) - 6 * MS_PER_DAY;
  const n = Math.floor((parseISO(iso) - firstWeekStart) / (7 * MS_PER_DAY)) + 1;
  return Math.max(1, Math.min(totalWeeks, n));
}

const sqlite = new Database(REPORT_DB, { readonly: true });
const workspace = JSON.parse(readFileSync(DB_JSON, 'utf8'));
const project = workspace.projects[workspace.activeProjectId];
if (!project) throw new Error(`No active project in ${DB_JSON}`);

const anchor: string = project.project.weekAnchorEndDate;
const totalWeeks: number = project.weeks.length;

// The ACTIVE baseline, not the contractual one. Two baselines live side by
// side here: Kontraktual is locked and answers claims, Aktif is the latest
// agreed revision and answers "what are we meant to be doing". A worklist is
// the second question. On Gundih only one leaf differs (1.4.4.4 was pulled
// forward six weeks in the W43 re-baseline) — but that leaf is exactly the one
// a worklist reading the wrong baseline would show six weeks late.
const rows = sqlite
  .prepare<[], SqliteRow>(
    `select n.wbs_code, s.start_date, s.finish_date
       from wbs_nodes n
       join node_schedules s on s.node_id = n.id
      where n.is_leaf = 1
        and s.baseline_id = (
          select id from baselines
           where kind in ('active', 'contractual')
           order by kind = 'active' desc
           limit 1)`
  )
  .all();

const byCode = new Map(rows.map((r) => [r.wbs_code, r]));

// Only weighted leaves carry progress, so only they can appear in a worklist.
const items: Array<{ id: string; wbsCode: string; bobot: number }> = project.wbsItems;
const hasChild = new Set(items.map((i) => (i as { parentId?: string }).parentId).filter(Boolean));
const leaves = items.filter((i) => !hasChild.has(i.id) && i.bobot > 0);

const schedule: ScheduleItem[] = [];
const missing: string[] = [];

for (const leaf of leaves) {
  const row = byCode.get(leaf.wbsCode);
  if (!row) {
    missing.push(leaf.wbsCode);
    continue;
  }
  const startWeek = weekOf(row.start_date, anchor, totalWeeks);
  const finishWeek = Math.max(startWeek, weekOf(row.finish_date, anchor, totalWeeks));
  // 'linear' is what the import assumed and what lib/plan-curve.ts spreads by;
  // claiming a shape nobody measured would be inventing schedule detail.
  schedule.push({ leafId: leaf.id, startWeek, finishWeek, pattern: 'linear' as DistributionPattern });
}

console.log(`weighted leaves: ${leaves.length}`);
console.log(`matched to a date pair: ${schedule.length}`);
if (missing.length) console.log(`WITHOUT dates (${missing.length}): ${missing.slice(0, 10).join(', ')}`);

// The number the whole worklist rests on — print it so a bad mapping is loud.
const perWeek: number[] = [];
for (let w = 1; w <= totalWeeks; w++) {
  perWeek.push(schedule.filter((s) => s.startWeek <= w && s.finishWeek >= w).length);
}
const avg = perWeek.reduce((a, b) => a + b, 0) / totalWeeks;
console.log(`scheduled active per week — avg ${avg.toFixed(1)}, max ${Math.max(...perWeek)}`);
console.log(`  W1 ${perWeek[0]} · W20 ${perWeek[19]} · W36 ${perWeek[35]} · W43 ${perWeek[42]} · W60 ${perWeek[59]}`);

if (!write) {
  console.log('\nDry run. Re-run with --write to save.');
  process.exit(0);
}

copyFileSync(DB_JSON, `${DB_JSON}.bak`);
project.schedule = schedule;
// Minified, exactly as `writeWorkspace` in lib/db.ts saves it — pretty-printing
// here would rewrite all 700KB and bury the change in a reformat.
writeFileSync(DB_JSON, JSON.stringify(workspace), 'utf-8');
console.log(`\nwrote ${schedule.length} schedule rows to ${DB_JSON} (backup at ${DB_JSON}.bak)`);
