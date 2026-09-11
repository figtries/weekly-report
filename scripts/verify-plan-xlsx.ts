/**
 * Runs a real weekly workbook through the plan reader and the paste parser.
 *
 * Run: npx tsx scripts/verify-plan-xlsx.ts "<path to .xlsx>"
 *
 * The point is not that it does not throw. The point is that the tree it
 * produces is the tree the workbook draws: the same number of rows, the same
 * depths, dates on the rows that have them, and the money adding up to the
 * contract when only the TOP priced rows are counted (prices nest — summing
 * every priced row counts the same money three times, see lib/weights.ts).
 */
import { createReadStream } from 'node:fs';

import { readPlanWorkbook } from '../lib/plan-xlsx';
import { completeDates, parsePaste } from '../lib/paste';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/verify-plan-xlsx.ts "<path to .xlsx>"');
  process.exit(1);
}

async function main() {
const read = await readPlanWorkbook(createReadStream(file));

console.log('sheets   :', read.sheets.join(' | '));
console.log('sheet    :', read.sheet);
console.log('rows     :', read.rows);
console.log('banner   :', JSON.stringify(read.banner, null, 2));
console.log('notes    :');
for (const n of read.notes) console.log('  ·', n);

const parsed = parsePaste(read.text);
console.log('\n--- through lib/paste.ts ---');
console.log('parsed rows :', parsed.rows.length);
console.log('depth from  :', parsed.depthFrom);
console.log('columns     :', JSON.stringify(parsed.columns));
console.log('skipped     :', parsed.skipped.length);
for (const s of parsed.skipped.slice(0, 5)) console.log('   line', s.line, JSON.stringify(s.text.slice(0, 60)));
if (parsed.notes.length) {
  console.log('notes       :');
  for (const n of parsed.notes) console.log('  ·', n);
}

const depths = new Map<number, number>();
let withDates = 0;
let priced = 0;
for (const r of parsed.rows) {
  depths.set(r.depth, (depths.get(r.depth) ?? 0) + 1);
  if (completeDates(r).startDate) withDates += 1;
  if (r.price != null && r.price > 0) priced += 1;
}
console.log('\ndepths      :', [...depths].sort((a, b) => a[0] - b[0]).map(([d, n]) => `L${d}:${n}`).join('  '));
console.log('with dates  :', withDates, 'of', parsed.rows.length);
console.log('priced rows :', priced);

// Money, counted the way lib/weights.ts counts it: a priced row whose ancestor
// is also priced is already inside that ancestor's number.
let top = 0;
const pricedAt: { depth: number; price: number }[] = [];
for (const r of parsed.rows) pricedAt.push({ depth: r.depth, price: r.price ?? 0 });
const stack: number[] = [];
parsed.rows.forEach((r, i) => {
  stack.length = r.depth;
  const covered = stack.some((p) => p > 0);
  if (!covered && (r.price ?? 0) > 0) top += r.price ?? 0;
  stack[r.depth] = pricedAt[i].price;
});
console.log('top-level money :', top.toLocaleString('en-US'));

console.log('\nfirst 12 rows:');
for (const r of parsed.rows.slice(0, 12)) {
  const d = completeDates(r);
  console.log(
    '  ' + '  '.repeat(r.depth) +
      [r.sourceCode, r.name.slice(0, 44), d.startDate ?? '-', d.finishDate ?? '-', r.price ?? '-'].join('  |  ')
  );
}
}

main();
