/**
 * Runs real workbooks through the plan reader and the paste parser.
 *
 * Run: npx tsx scripts/verify-plan-xlsx.ts "<a.xlsx>" ["<b.xlsx>" ...]
 *
 * The point is not that it does not throw. The point is that it picks the
 * right SHEET out of twenty, finds the columns without being told where they
 * are, and builds the same tree the workbook draws. Give it several weeks of
 * the same report and the columns move between them, which is the whole reason
 * nothing here is allowed to be a constant.
 */
import { createReadStream } from 'node:fs';
import path from 'node:path';

import { readPlanWorkbook } from '../lib/plan-xlsx';
import { planToPaste, FIELDS } from '../lib/plan-grid';
import { completeDates, parsePaste } from '../lib/paste';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: npx tsx scripts/verify-plan-xlsx.ts "<a.xlsx>" ["<b.xlsx>" ...]');
  process.exit(1);
}

async function one(file: string) {
  console.log('\n' + '='.repeat(72));
  console.log(path.basename(file));
  console.log('='.repeat(72));

  const read = await readPlanWorkbook(createReadStream(file));
  console.log('sheets in file :', read.sheets.length);
  console.log('could be a plan:', read.candidates.map((c) => `${c.name} (${c.rows} rows, ${c.score})`).join(' | '));
  console.log('CHOSE          :', read.sheet);
  console.log('columns        :', read.columns.length);
  console.log(
    'mapping        :',
    FIELDS.map((f) => {
      const i = read.mapping[f];
      return `${f}=${i === undefined ? '-' : `col${read.columns[i].at}"${read.columns[i].label}"`}`;
    }).join('  ')
  );
  console.log('banner         :', read.banner.projectName ?? '(none)', '|', read.banner.weeklyNo ?? '');
  for (const n of read.notes) console.log('  ·', n);

  const text = planToPaste(read.grid, read.mapping);
  const parsed = parsePaste(text);

  const depths = new Map<number, number>();
  let withDates = 0;
  let priced = 0;
  for (const r of parsed.rows) {
    depths.set(r.depth, (depths.get(r.depth) ?? 0) + 1);
    if (completeDates(r).startDate) withDates += 1;
    if (r.price != null && r.price > 0) priced += 1;
  }

  console.log('--- through lib/paste.ts ---');
  console.log('rows       :', parsed.rows.length);
  console.log('depth from :', parsed.depthFrom);
  console.log('depths     :', [...depths].sort((a, b) => a[0] - b[0]).map(([d, n]) => `L${d}:${n}`).join('  '));
  console.log('with dates :', withDates);
  console.log('priced     :', priced);
  console.log('skipped    :', parsed.skipped.length);
  for (const n of parsed.notes) console.log('  ·', n);

  return { file: path.basename(file), sheet: read.sheet, rows: parsed.rows.length, withDates, priced };
}

async function main() {
  const results = [];
  for (const f of files) {
    try {
      results.push(await one(f));
    } catch (e) {
      console.log('FAILED:', e instanceof Error ? e.message : e);
      results.push({ file: path.basename(f), sheet: 'FAILED', rows: 0, withDates: 0, priced: 0 });
    }
  }
  console.log('\n' + '='.repeat(72));
  console.log('summary');
  for (const r of results) {
    console.log(
      `  ${r.rows.toString().padStart(5)} rows · ${r.withDates.toString().padStart(5)} dated · ` +
        `${r.priced.toString().padStart(4)} priced · ${r.sheet.padEnd(16)} · ${r.file}`
    );
  }
}

main();
