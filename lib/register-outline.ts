/**
 * The three levels a register has, and the code that names each one.
 *
 * This is the rule, taken from the registers themselves and now applied
 * everywhere without exception — reading a file, writing one, and building one
 * by hand:
 *
 *     B        a HEADING          DETAIL ENGINEERING
 *     B.1      a SECTION          PROCESS
 *     B.1.1    a GROUP            Process Study & Report
 *     18       a DOCUMENT         WPP-PC-DSY-001  Process Simulation Report
 *
 * Depth is the number of parts in the code, and nothing else decides it. A row
 * whose first cell is a plain running number is a document, and it belongs to
 * the deepest heading still open above it — which is why a section that holds
 * documents directly (EXECUTION PLAN does) needs no group beneath it.
 *
 * `lib/register-paste.ts` reads it, `app/api/register/export/route.ts` writes
 * it, and the builder shows it while someone types, so all three are talking
 * about the same shape.
 */

/** `[2]` → `B`, `[2,1]` → `B.1`, `[2,1,1]` → `B.1.1`. Positions are 1-based. */
export function outlineCode(path: number[]): string {
  const [first, ...rest] = path;
  if (first === undefined) return '';
  return [String.fromCharCode(64 + first), ...rest.map(String)].join('.');
}

/** What a code of this depth names, in the words the register uses. */
export function outlineLevel(depth: number): 'heading' | 'section' | 'group' {
  if (depth <= 1) return 'heading';
  if (depth === 2) return 'section';
  return 'group';
}
