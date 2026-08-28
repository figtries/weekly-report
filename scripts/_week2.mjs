import fs from 'node:fs';

const file = 'lib/register.ts';
let s = fs.readFileSync(file, 'utf-8');
const rep = (a, b) => {
  if (!s.includes(a)) { console.error(`MISS: ${a.slice(0, 90)}`); process.exit(1); }
  s = s.split(a).join(b);
};

/* ------------------------------------------------------------- the weeks */
rep(`/* ----------------------------------------------------------------- public */`,
`/* ----------------------------------------------------------------- public */

export interface RegisterWeek {
  weekNo: number;
  startDate: string;
  endDate: string;
}

/** Every week of the project, for the week picker. */
export function getRegisterWeeks(projectId: string): RegisterWeek[] {
  return db.select().from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId)).all()
    .sort((a, b) => a.weekNo - b.weekNo)
    .map((w) => ({ weekNo: w.weekNo, startDate: w.startDate, endDate: w.endDate }));
}
`);

/* ------------------------------------------------------------- summary */
rep(`export function getRegisterSummary(projectId: string, register: RegisterKind): RegisterSummary | null {
  const loaded = loadRegister(projectId, register);`,
`export function getRegisterSummary(
  projectId: string,
  register: RegisterKind,
  week?: number,
): RegisterSummary | null {
  const loaded = loadRegister(projectId, register, week);`);

rep(`    reached: documents.filter((d) => {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      return row ? row.submitted : false;
    }).length,`,
`    reached: documents.filter((d) => {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      return row ? reachedBy(row, loaded) : false;
    }).length,`);

rep(`  // The curve runs to whichever ends later: the last evidence, or the last
  // promise. Anything beyond that is empty chart.
  let lastPlanWeek = asOfWeek;`,
`  // The curve runs to whichever ends latest: the week being viewed, the last
  // evidence, or the last promise. Anything beyond that is empty chart.
  let lastPlanWeek = Math.max(asOfWeek, loaded.evidenceWeek);`);

rep(`    undated: loaded.stages.filter((s) => s.submitted && !s.submittedAt).length,`,
`    evidenceWeek: loaded.evidenceWeek,
    evidenceDate: loaded.evidenceDate,
    undated: loaded.stages.filter((s) => s.submitted && !s.submittedAt).length,`);

/* ---------------------------------------------------------------- tree */
rep(`export function getRegisterTree(projectId: string, register: RegisterKind): RegisterNode[] {
  const loaded = loadRegister(projectId, register);`,
`export function getRegisterTree(projectId: string, register: RegisterKind, week?: number): RegisterNode[] {
  const loaded = loadRegister(projectId, register, week);`);

rep(`        reached: docs.filter((d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && s.submitted)).length,`,
`        reached: docs.filter((d) =>
          loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && reachedBy(s, loaded))).length,`);

rep(`export function getRegisterLeaves(projectId: string, register: RegisterKind): RegisterNode[] {`,
`export function getRegisterLeaves(projectId: string, register: RegisterKind, week?: number): RegisterNode[] {`);
rep(`  walk(getRegisterTree(projectId, register));`, `  walk(getRegisterTree(projectId, register, week));`);

/* ----------------------------------------------------------- obstacles */
rep(`export function getObstacles(projectId: string, register: RegisterKind): Obstacle[] {
  const loaded = loadRegister(projectId, register);`,
`export function getObstacles(projectId: string, register: RegisterKind, week?: number): Obstacle[] {
  const loaded = loadRegister(projectId, register, week);`);

rep(`    const returned = rows.filter((s) => s.returnCode);
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) {`,
`    const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) {`);

rep(`    const late = rows
      .filter((s) => !s.submitted && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)`,
`    const late = rows
      .filter((s) => !reachedBy(s, loaded) && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)`);

rep(`    if (!rows.some((s) => s.submitted)) {
      out.push({ ...base, kind: 'untouched', stage: null, returnCode: null, since: null, days: null });`,
`    if (!rows.some((s) => reachedBy(s, loaded))) {
      out.push({ ...base, kind: 'untouched', stage: null, returnCode: null, since: null, days: null });`);

/* ----------------------------------------------------------------- log */
rep(`export function getRegisterLog(projectId: string, register: RegisterKind, limit = 200): LogEvent[] {
  const loaded = loadRegister(projectId, register);`,
`export function getRegisterLog(
  projectId: string,
  register: RegisterKind,
  limit = 200,
  week?: number,
): LogEvent[] {
  const loaded = loadRegister(projectId, register, week);`);

rep(`    if (s.submitted) {
      events.push({
        ...base,
        at: s.submittedAt ?? loaded.asOfDate,`,
`    if (reachedBy(s, loaded)) {
      events.push({
        ...base,
        at: s.submittedAt ?? loaded.evidenceDate,`);

rep(`    if (s.returnedAt || s.returnCode) {
      events.push({
        ...base,
        at: s.returnedAt ?? loaded.asOfDate,`,
`    if (returnedBy(s, loaded)) {
      events.push({
        ...base,
        at: s.returnedAt ?? loaded.evidenceDate,`);

/* --------------------------------------------------------------- cards */
rep(`export function getRegisterCards(
  projectId: string,
  register: RegisterKind,
): Record<string, DocumentCard[]> {
  const loaded = loadRegister(projectId, register);`,
`export function getRegisterCards(
  projectId: string,
  register: RegisterKind,
  week?: number,
): Record<string, DocumentCard[]> {
  const loaded = loadRegister(projectId, register, week);`);

rep(`        const moved = rows.filter((s) => s.submitted);
        const last = moved[moved.length - 1] ?? null;
        const returned = rows.filter((s) => s.returnCode);
        const lastReturn = returned[returned.length - 1] ?? null;
        const next = rows.find((s) => !s.submitted) ?? null;`,
`        const moved = rows.filter((s) => reachedBy(s, loaded));
        const last = moved[moved.length - 1] ?? null;
        const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
        const lastReturn = returned[returned.length - 1] ?? null;
        const next = rows.find((s) => !reachedBy(s, loaded)) ?? null;`);

rep(`          laps: rows.filter((s) => s.stage.startsWith('RE_') && s.submitted).length,`,
`          laps: rows.filter((s) => s.stage.startsWith('RE_') && reachedBy(s, loaded)).length,`);

rep(`          stages: rows.map((s) => ({
            stage: s.stage,
            planSubmitDate: s.planSubmitDate,
            submitted: s.submitted,`,
`          stages: rows.map((s) => ({
            stage: s.stage,
            planSubmitDate: s.planSubmitDate,
            submitted: reachedBy(s, loaded),`);

/* ---------------------------------------------------------------- links */
rep(`export function getDisciplineLinks(projectId: string): DisciplineLink[] {
  const loaded = loadRegister(projectId, 'edl');`,
`export function getDisciplineLinks(projectId: string, week?: number): DisciplineLink[] {
  const loaded = loadRegister(projectId, 'edl', week);`);

rep(`  const recorded = new Set(db.selectDistinct({ weekId: schema.leafProgress.weekId })
    .from(schema.leafProgress).all().map((r) => r.weekId));
  const latestWeek = weeks.find((w) => recorded.has(w.id)) ?? null;`,
`  const recorded = new Set(db.selectDistinct({ weekId: schema.leafProgress.weekId })
    .from(schema.leafProgress).all().map((r) => r.weekId));
  // Compare like with like: the WBS figure for the week being viewed, if that
  // week was reported at all, otherwise the last week that was.
  const latestWeek = weeks.find((w) => w.weekNo <= loaded.asOfWeek && recorded.has(w.id))
    ?? weeks.find((w) => recorded.has(w.id))
    ?? null;`);

rep(`          const reached = docs.filter(
            (d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && s.submitted),
          ).length;`,
`          const reached = docs.filter(
            (d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && reachedBy(s, loaded)),
          ).length;`);

fs.writeFileSync(file, s);
console.log('register.ts: every read takes a week');
