/**
 * The rule engine, run over the real plan.
 *
 * Run: npx tsx scripts/verify-bar-styles.ts
 *
 * The point of the whole feature is that the OUTCOME is predictable from the
 * list, so what is checked here is that reordering the list changes what you
 * see, and in the direction the list says.
 */
import { DEFAULT_BAR_STYLES, resolveBar, usedStyles, type BarStyle } from '../lib/bar-styles';
import { getSheet } from '../lib/sheet';

let failures = 0;
function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!pass) failures += 1;
}

const TODAY = '2026-09-06';
const sheet = getSheet('gundih');
const rows = sheet.rows;

check('the plan is there to style', rows.length === 285, `${rows.length} rows`);

/* --- the defaults reproduce the behaviour that used to be hard-coded ------ */

{
  const wrong = rows.filter((r) => {
    const hit = resolveBar(r, DEFAULT_BAR_STYLES, TODAY);
    if (r.daysLate != null) return false; // lateness legitimately overrides
    if (!r.startDate || !r.finishDate) return hit.paint !== 'muted';
    const want = r.isMilestone ? 'diamond' : r.isSummary ? 'bracket' : 'bar';
    return hit.shape !== want || hit.paint !== 'unit';
  });
  check(
    'the default list draws exactly what the code used to draw',
    wrong.length === 0,
    wrong.length === 0 ? 'all 285 rows' : `${wrong.length} differ, first ${wrong[0].code}`
  );
}

/* --- first match wins ----------------------------------------------------- */

{
  const late = rows.filter((r) => r.daysLate != null);
  const hits = late.map((r) => resolveBar(r, DEFAULT_BAR_STYLES, TODAY));
  check(
    'past-target sits above everything and takes the paint',
    late.length > 0 && hits.every((h) => h.paint === 'warn' && h.hatched),
    `${late.length} late rows, all amber and hatched`
  );
  const lateSummaries = late.filter((r) => r.isSummary);
  check(
    'a late SUMMARY keeps its bracket — shape and paint are separate axes',
    lateSummaries.length > 0 &&
      lateSummaries.every((r) => resolveBar(r, DEFAULT_BAR_STYLES, TODAY).shape === 'bracket'),
    `${lateSummaries.length} late summaries, all still brackets`
  );
}

/* --- moving a rule changes the answer ------------------------------------- */

{
  // Put "Summary" above "Past its target date" and a late summary stops being
  // amber. That is the whole product claim of an ordered list.
  const reordered: BarStyle[] = [
    DEFAULT_BAR_STYLES[2], // summary
    DEFAULT_BAR_STYLES[0], // past target
    ...DEFAULT_BAR_STYLES.slice(1, 2),
    ...DEFAULT_BAR_STYLES.slice(3),
  ];
  const lateSummary = rows.find((r) => r.daysLate != null && r.isSummary);
  const before = lateSummary && resolveBar(lateSummary, DEFAULT_BAR_STYLES, TODAY);
  const after = lateSummary && resolveBar(lateSummary, reordered, TODAY);
  check(
    'moving a rule up changes what wins',
    !!before && !!after && before.paint === 'warn' && after.paint === 'unit',
    `${lateSummary?.code}: ${before?.paint} → ${after?.paint}`
  );
}

/* --- a condition that reads a value --------------------------------------- */

{
  const unit = rows.find((r) => r.isReportingUnit && r.unitLabel === 'SPK-007');
  const rule: BarStyle = {
    id: 'test:spk7',
    order: 0,
    label: 'SPK-007',
    condition: 'in_unit',
    conditionValue: unit?.id ?? '',
    paint: 'plan-4',
    shape: 'auto',
    hatched: false,
    enabled: true,
  };
  const list = [rule, ...DEFAULT_BAR_STYLES];
  const inside = rows.filter((r) => r.unitId === unit?.id);
  check(
    'a package rule paints exactly its own subtree',
    !!unit &&
      inside.length > 0 &&
      inside.every((r) => resolveBar(r, list, TODAY).paint === 'plan-4') &&
      rows
        .filter((r) => r.unitId !== unit.id)
        .every((r) => resolveBar(r, list, TODAY).paint !== 'plan-4'),
    `${unit?.unitLabel} covers ${inside.length} rows and nothing else`
  );
}

/* --- disabling, and the floor --------------------------------------------- */

{
  const off = DEFAULT_BAR_STYLES.map((s) => ({ ...s, enabled: false }));
  const hit = resolveBar(rows[0], off, TODAY);
  check(
    'with every rule off a bar still draws, rather than vanishing',
    hit.styleId === 'fallback' && hit.shape === 'bracket',
    `falls back to ${hit.shape} in ${hit.paint}`
  );
}

/* --- the legend only names rules that fired -------------------------------- */

{
  const unusedRule: BarStyle = {
    id: 'test:never',
    order: 0,
    label: 'Weight above 99%',
    condition: 'weight_above',
    conditionValue: '99',
    paint: 'danger',
    shape: 'auto',
    hatched: false,
    enabled: true,
  };
  const used = usedStyles(rows, [unusedRule, ...DEFAULT_BAR_STYLES], TODAY);
  check(
    'a rule nothing matches stays out of the key',
    !used.some((u) => u.style.id === 'test:never'),
    used.map((u) => `${u.style.label}×${u.count}`).join(' · ')
  );
  const total = used.reduce((a, u) => a + u.count, 0);
  check('every row is accounted for exactly once', total === rows.length, `${total} of ${rows.length}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
