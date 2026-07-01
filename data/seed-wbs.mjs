// Restore the database to its seeded state.
//
// The canonical seed data in `data/seed-data.json` was extracted directly from the
// authoritative Excel workbook (PRGG-00-G0-RPT-002 W35) — specifically the
// "Detail Overall" sheet (exact WBS tree, bobot, vol, per-leaf cumulative & target
// for W35 and the previous week) and the "S-Curve Overall" sheet (weekly CUM PLAN /
// CUM ACTUAL). This guarantees the app's numbers match the printed report exactly
// (W35 actual 67.19%, target 71.29%). See the report's own formulas:
//   Progress% = WF / Bobot ; WF = actual% × bobot ; Target = plan% × bobot ;
//   Variance = CumWF − TargetWF ; MingguIni = Cumm − MingguLalu.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(dir, 'seed-data.json'), 'utf8');
writeFileSync(join(dir, 'db.json'), seed);

const db = JSON.parse(seed);
console.log(
  `Seeded ${db.wbsItems.length} WBS items, ${db.weeks.length} week(s), ${db.daily.length} daily report(s).`
);
