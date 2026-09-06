/**
 * How numbers are written on screen.
 *
 * Run: npx tsx scripts/verify-numbers.ts
 *
 * SI groups digits in threes with a SPACE, never a comma and never a dot,
 * precisely because `5.000` is five thousand in Jakarta and five in London. The
 * two rules worth pinning here are that rule and its exception — SI leaves a
 * four-digit group alone, because isolating a single digit gains nothing.
 *
 * The round trip matters more than the look: whatever a person types has to come
 * back out as something `Number()` accepts, or a contract value ends up wrong by
 * a factor of a thousand.
 */
import {
  SI_SPACE,
  caretAfterGrouping,
  digitsBeforeCaret,
  formatMoney,
  groupAmount,
  stripAmount,
} from '../lib/currency';
import { fmtNum, fmtPct } from '../lib/analysis';

let failures = 0;
function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!pass) failures += 1;
}

const sp = SI_SPACE;
const show = (s: string) => s.replace(new RegExp(sp, 'g'), '·');

/* --- the separator itself -------------------------------------------------- */

check(
  'the separator is a space, never a comma or a dot',
  !formatMoney(5_000_000_000, 'USD').includes(',') &&
    formatMoney(5_000_000_000, 'USD').includes(sp),
  show(formatMoney(5_000_000_000, 'USD'))
);

check(
  'the decimal marker is still a point',
  fmtNum(1234567.5, 2) === `1${sp}234${sp}567.50`,
  show(fmtNum(1234567.5, 2))
);

/* --- SI's four-digit exception -------------------------------------------- */

{
  const cases: [number, string][] = [
    [999, '999'],
    [1234, '1234'],
    [12345, `12${sp}345`],
    [5920000, `5${sp}920${sp}000`],
  ];
  check(
    'four digits stay together, five and up are grouped',
    cases.every(([n, want]) => fmtNum(n) === want),
    cases.map(([n]) => show(fmtNum(n))).join(' · ')
  );
}

/* --- typing --------------------------------------------------------------- */

{
  const cases: [string, string][] = [
    ['5000000000', `5${sp}000${sp}000${sp}000`],
    ['1234', '1234'],
    ['12345', `12${sp}345`],
    ['5000.', `5000.`],
    ['5920000.006405', `5${sp}920${sp}000.006405`],
    ['', ''],
  ];
  check(
    'the box groups what is typed into it',
    cases.every(([raw, want]) => groupAmount(raw) === want),
    cases.map(([raw]) => `${raw || '(empty)'}→${show(groupAmount(raw)) || '(empty)'}`).join(' · ')
  );
}

check(
  'whatever comes back out is a number again',
  ['5000000000', '5920000.006405', '1234', '0.97'].every(
    (raw) => Number(stripAmount(groupAmount(raw))) === Number(raw)
  ),
  '5000000000 · 5920000.006405 · 1234 · 0.97 all survive the round trip'
);

check(
  'a second dot is a typo, not a separator we missed',
  stripAmount('5.920.000') === '5.920000',
  `5.920.000 → ${stripAmount('5.920.000')}`
);

/* --- the caret ------------------------------------------------------------- */

{
  // Typing a 9 straight after the first digit of "5 000 000 000": the caret has
  // to land after "59", not drift right by the separator that was inserted.
  const typed = `59${sp}000${sp}000${sp}000`;
  const digits = digitsBeforeCaret('59 000 000 000'.replace(/ /g, sp), 2);
  check(
    'the caret is counted in digits, not characters',
    digits === 2 && caretAfterGrouping(typed, digits) === 2,
    `after ${digits} digits the caret sits at ${caretAfterGrouping(typed, digits)}`
  );

  // At the end of a ten-digit figure the caret belongs at the very end, past the
  // last separator rather than before it.
  const grouped = groupAmount('5000000000');
  check(
    'the caret lands at the end of a full figure',
    caretAfterGrouping(grouped, 10) === grouped.length,
    `${show(grouped)} → ${caretAfterGrouping(grouped, 10)} of ${grouped.length}`
  );
}

/* --- percentages ----------------------------------------------------------- */

check(
  'a percentage is never grouped, because it never gets that big',
  fmtPct(100) === '100.00%' && fmtPct(0.97) === '0.97%',
  `${fmtPct(100)} · ${fmtPct(0.97)}`
);

/* --- the figure this whole app is built on --------------------------------- */

check(
  "Gundih's contract still reads correctly",
  formatMoney(5920000.006405001, 'USD') === `US$5${sp}920${sp}000`,
  show(formatMoney(5920000.006405001, 'USD'))
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
