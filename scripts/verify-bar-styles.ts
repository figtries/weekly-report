/**
 * The rule engine, run over the real plan.
 *
 * Run: npx tsx scripts/verify-bar-styles.ts
 *
 * The point of the whole feature is that the OUTCOME is predictable from the
 * list, so what is checked here is that reordering the list changes what you
 * see, and in the direction the list says.
 */
import {
  DEFAULT_BAR_STYLES,
  PACKAGE_PRESET,
  TYPE_PRESET,
  pickPreset,
  pruneStyles,
  resolveBar,
  usedStyles,
  type BarStyle,
} from '../lib/bar-styles';
import { getSheet } from '../lib/sheet';
import { db, schema } from '../lib/sqlite';

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
  // The package list is the one that has to reproduce what the code used to do
  // before any of this was configurable.
  const wrong = rows.filter((r) => {
    const hit = resolveBar(r, PACKAGE_PRESET, TODAY);
    if (r.daysLate != null) return false; // lateness legitimately overrides
    if (!r.startDate || !r.finishDate) return hit.paint !== 'muted';
    const want = r.isMilestone ? 'diamond' : r.isSummary ? 'bracket' : 'bar';
    return hit.shape !== want || hit.paint !== 'unit';
  });
  check(
    'the package list draws exactly what the code used to draw',
    wrong.length === 0,
    wrong.length === 0 ? 'all 285 rows' : `${wrong.length} differ, first ${wrong[0].code}`
  );
}

/* --- first match wins ----------------------------------------------------- */

{
  // Lateness is made HERE rather than read from the project: nobody has typed a
  // target date on Gundih, and a check that only passes while some row happens
  // to carry test data is a check that will pass until the day it matters.
  const late = [
    { ...rows.find((r) => r.isSummary)!, targetDate: '2026-01-01', daysLate: 12 },
    { ...rows.find((r) => !r.isSummary && !r.isMilestone)!, targetDate: '2026-01-01', daysLate: 3 },
  ];
  const hits = late.map((r) => resolveBar(r, DEFAULT_BAR_STYLES, TODAY));
  check(
    'past-target sits above everything and takes the paint',
    hits.every((h) => h.paint === 'warn' && h.hatched),
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
  // amber. That is the whole product claim of an ordered list. Found by rule
  // rather than by index, so it survives a list gaining an entry.
  const summaryRule = PACKAGE_PRESET.find((s) => s.condition === 'summary')!;
  const reordered: BarStyle[] = [
    summaryRule,
    ...PACKAGE_PRESET.filter((s) => s !== summaryRule),
  ];
  const lateSummary = { ...rows.find((r) => r.isSummary)!, targetDate: '2026-01-01', daysLate: 12 };
  const before = resolveBar(lateSummary, PACKAGE_PRESET, TODAY);
  const after = resolveBar(lateSummary, reordered, TODAY);
  check(
    'moving a rule up changes what wins',
    before.paint === 'warn' && after.paint === 'unit',
    `${lateSummary.code}: ${before.paint} → ${after.paint}`
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

/* --- which ready-made list a plan gets ------------------------------------ */

{
  check(
    'a plan with packages is coloured by package',
    pickPreset(rows) === 'package',
    `Gundih has ${new Set(rows.map((r) => r.colorGroup).filter((g) => g >= 0)).size} groups → ${pickPreset(rows)}`
  );
  check(
    'a plan with no packages is coloured by what each row is',
    pickPreset([{ colorGroup: -1 }, { colorGroup: -1 }]) === 'type' &&
      pickPreset([{ colorGroup: 0 }]) === 'type',
    'and one group is not a grouping either'
  );
}

/* --- a package is a BRANCH, never a leaf ---------------------------------- */

{
  // The bug: four top-level rows, three of them ordinary tasks, came back as
  // four separate "packages" and every row got its own colour.
  const others = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .all()
    .filter((p) => p.id !== 'gundih');
  const bad = others
    .map((p) => ({ p, s: getSheet(p.id) }))
    .filter(({ s }) => {
      const units = s.rows.filter((r) => r.isReportingUnit).length;
      const groups = new Set(s.rows.map((r) => r.colorGroup).filter((g) => g >= 0));
      return units === 0 && groups.size > 1;
    });
  check(
    'a leaf is never treated as a package',
    bad.length === 0,
    bad.length === 0
      ? `${others.length} package-less projects, none of them coloured per row`
      : bad.map((b) => b.p.name).join(', ')
  );
}

/* --- a colour that cannot distinguish is dropped -------------------------- */

{
  const everyone: BarStyle = {
    id: 'test:all-critical',
    order: 0,
    label: 'On the critical path',
    condition: 'critical',
    conditionValue: null,
    paint: 'danger',
    shape: 'auto',
    hatched: false,
    enabled: true,
  };
  const leaves = rows.filter((r) => !r.isSummary);
  check(
    'a rule every row matches is left out',
    pruneStyles(
      leaves.map((r) => ({ ...r, isCritical: true })),
      [everyone, ...TYPE_PRESET],
      TODAY
    ).every((s) => s.condition !== 'critical'),
    'when everything is critical, nothing is'
  );
  check(
    'a rule no row matches is left out too',
    pruneStyles(
      leaves.map((r) => ({ ...r, isCritical: false })),
      [everyone, ...TYPE_PRESET],
      TODAY
    ).every((s) => s.condition !== 'critical'),
    'a line in the key pointing at nothing on the chart'
  );
  check(
    'a rule that separates some from the rest is kept',
    pruneStyles(
      leaves.map((r, i) => ({ ...r, isCritical: i % 2 === 0 })),
      [everyone, ...TYPE_PRESET],
      TODAY
    ).some((s) => s.condition === 'critical'),
    'half critical, half not — the colour is doing work'
  );
  check(
    'the catch-all is never pruned',
    pruneStyles(rows, TYPE_PRESET, TODAY).some((s) => s.condition === 'always'),
    'matching everything is the point of it'
  );
}

/* --- a row with children is never a milestone ----------------------------- */

{
  const stale = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .all()
    .flatMap((p) => getSheet(p.id).rows)
    .filter((r) => r.isMilestone && r.isSummary);
  check(
    'no milestone spans children',
    stale.length === 0,
    stale.length === 0 ? 'decision ① holds on every project' : stale.map((r) => r.code).join(', ')
  );
}

/* --- the two lists differ where they should ------------------------------- */

{
  const summary = rows.find((r) => r.isSummary)!;
  const byType = resolveBar(summary, TYPE_PRESET, TODAY);
  const byPackage = resolveBar(summary, PACKAGE_PRESET, TODAY);
  check(
    'the two lists agree on shape and differ on colour',
    byType.shape === 'bracket' &&
      byPackage.shape === 'bracket' &&
      byType.paint === 'foreground' &&
      byPackage.paint === 'unit',
    `${summary.code}: by type ${byType.paint}, by package ${byPackage.paint}, both ${byType.shape}`
  );
  check(
    'the name DEFAULT_BAR_STYLES now points at the type list',
    DEFAULT_BAR_STYLES === TYPE_PRESET,
    'the name kept, the list swapped'
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
