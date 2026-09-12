/**
 * Counts the schedule sheet's declared grid tracks.
 *
 * A grid child with `display: none` leaves the grid, so the number of tracks
 * in `GRID_SM` must equal the number of children in flow below 640px, and
 * `GRID_LG`'s must equal the number at or above it. When that arithmetic
 * slipped, every column shifted one to the left and "Task name" was drawn
 * into the 12px colour-stripe cell, where it read "T..".
 *
 * This checks the cheap half of it: that both templates declare the same
 * number of tracks, and that the number is the intended one. The other half,
 * that the children actually match, is a screenshot.
 *
 * Run: node scripts/verify-sheet-columns.ts
 */
import { readFileSync } from 'node:fs';

const SRC = 'components/projects/ScheduleSheet.tsx';
/**
 * Five below 640px, six at or above it, and the two numbers differ on purpose.
 *
 * The phone shows the name, the duration and the finish; Start is desktop-only
 * and lives in the row panel below 640px. Measured on Gundih at 390px, adding
 * it to the phone took the name column from 170px to 100px and turned
 * "Relokasi 2 Unit Ta…" into "Relok…". It FITS on a phone, which is exactly why
 * this is written down: the arithmetic said yes and the screenshot said no.
 */
const EXPECTED_SM = 5;
const EXPECTED_LG = 6;

const src = readFileSync(SRC, 'utf8');

/** Pull the bracketed track list out of a `grid-cols-[...]` arbitrary value. */
function tracks(label: string, needle: RegExp): number {
  const m = src.match(needle);
  if (!m) {
    console.error(`✗ could not find ${label} in ${SRC}`);
    process.exit(1);
  }
  // Tracks are joined by `_` inside a Tailwind arbitrary value, and
  // `minmax(a,b)` carries a comma but no underscore, so splitting on `_` is
  // exactly right.
  return m[1]!.split('_').length;
}

const sm = tracks('GRID_SM', /const GRID_SM = '(?:sm:)?grid-cols-\[([^\]]+)\]'/);
const lg = tracks('GRID_LG', /const GRID_LG =\s*'sm:grid-cols-\[([^\]]+)\]'/);

let failed = 0;
if (sm !== EXPECTED_SM) {
  failed += 1;
  console.error(`✗ GRID_SM declares ${sm} tracks, expected ${EXPECTED_SM}`);
}
if (lg !== EXPECTED_LG) {
  failed += 1;
  console.error(`✗ GRID_LG declares ${lg} tracks, expected ${EXPECTED_LG}`);
}

// The three removed columns must be GONE from the header, not merely hidden:
// a hidden grid child is the trap this script exists for.
for (const gone of ['>Target<', '>Price<', '>Weight<']) {
  if (src.includes(gone)) {
    failed += 1;
    console.error(`✗ ${SRC} still renders a ${gone.slice(1, -1)} header`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(
  `✓ GRID_SM declares ${EXPECTED_SM} tracks, GRID_LG ${EXPECTED_LG}, and Target/Price/Weight are gone.`
);
