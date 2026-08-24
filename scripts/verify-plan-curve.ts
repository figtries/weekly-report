/**
 * Checks the derived plan curve against a real client workbook.
 *
 * The expected values below are read straight out of
 * `PRGG-00-G0-RPT-002_WEEKLY PROGRESS REPORT W43 (Overall).xlsx`, sheet
 * "Data Overall", row 16 — the leaf at WBS 1.2.1.2.1.1 (IFR), 45 days from
 * 27 Oct 2025 to 10 Dec 2025. If our derivation ever stops reproducing these,
 * our weekly plan figure stops agreeing with the client's schedule tool, and
 * that is a number the client checks.
 *
 * Run: node scripts/verify-plan-curve.ts
 */
import { leafPlanFraction, inclusiveDays } from '../lib/plan-curve.ts';

/** Excel serial → ISO date. Serial 25569 is 1970-01-01. */
function fromSerial(serial: number): string {
  return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
}

const START = '2025-10-27';
const FINISH = '2025-12-10';

// [column serial (period end), value in the workbook]
const EXPECTED: Array<[number, number]> = [
  [45960, 8.8888888888888892e-2], [45967, 0.24444444444444446], [45974, 0.39999999999999986],
  [45975, 0.42222222222222205], [45976, 0.44444444444444425], [45977, 0.46666666666666645],
  [45978, 0.48888888888888865], [45979, 0.51111111111111085], [45980, 0.5333333333333331],
  [45981, 0.55555555555555536], [45982, 0.57777777777777761], [45983, 0.59999999999999987],
  [45984, 0.62222222222222212], [45985, 0.64444444444444438], [45986, 0.66666666666666663],
  [45987, 0.68888888888888888], [45988, 0.71111111111111114], [45989, 0.73333333333333339],
  [45990, 0.75555555555555565], [45991, 0.7777777777777779], [45992, 0.80000000000000016],
  [45993, 0.82222222222222241], [45994, 0.84444444444444466], [45995, 0.86666666666666692],
  [45996, 0.88888888888888917], [45997, 0.91111111111111143], [45998, 0.93333333333333368],
  [45999, 0.95555555555555594], [46000, 0.97777777777777819], [46001, 1.0000000000000004],
];

const TOLERANCE = 1e-9;

const duration = inclusiveDays(START, FINISH);
console.log(`leaf 1.2.1.2.1.1 (IFR)  ${START} → ${FINISH}`);
console.log(`durasi terhitung: ${duration} hari   (workbook: 45 days)\n`);

let failed = 0;
for (const [serial, expected] of EXPECTED) {
  const asOf = fromSerial(serial);
  const got = leafPlanFraction(START, FINISH, asOf);
  const diff = Math.abs(got - expected);
  if (diff > TOLERANCE) {
    failed++;
    console.log(`  ✗ ${asOf}  diturunkan ${got.toFixed(12)}  workbook ${expected.toFixed(12)}  selisih ${diff.toExponential(2)}`);
  }
}

// The two ends are where a wrong curve hides: never negative before it starts,
// and exactly 1 after it finishes — an asymptote leaks a permanent deviation.
const before = leafPlanFraction(START, FINISH, '2025-10-01');
const after = leafPlanFraction(START, FINISH, '2026-03-01');
if (before !== 0) { failed++; console.log(`  ✗ sebelum mulai harus 0, dapat ${before}`); }
if (after !== 1) { failed++; console.log(`  ✗ setelah selesai harus tepat 1, dapat ${after}`); }

if (failed === 0) {
  console.log(`✓ ${EXPECTED.length} titik cocok dengan workbook, dalam toleransi ${TOLERANCE}`);
  console.log('✓ sebelum mulai = 0, setelah selesai = 1 tepat');
  console.log('\nKurva rencana Gundih memang linier. Model terbukti.');
} else {
  console.log(`\n${failed} pemeriksaan gagal.`);
  process.exitCode = 1;
}
