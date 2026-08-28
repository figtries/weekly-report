import fs from 'node:fs';

const file = 'lib/register.ts';
let s = fs.readFileSync(file, 'utf-8');
const rep = (a, b) => {
  if (!s.includes(a)) { console.error(`MISS: ${a.slice(0, 90)}`); process.exit(1); }
  s = s.split(a).join(b);
};

/* ------------------------------------------------- Loaded gains a viewpoint */
rep(`  asOfDate: string;
  asOfWeek: number;
  weekOf: (iso: string) => number;
}`,
`  /** The week being looked at. Everything is counted as it stood at its end. */
  asOfWeek: number;
  asOfDate: string;
  /** The last week anything actually happened in the register, whatever week is being viewed. */
  evidenceWeek: number;
  evidenceDate: string;
  weekOf: (iso: string) => number;
}`);

rep(`function loadRegister(projectId: string, register: RegisterKind): Loaded | null {`,
`/**
 * @param week the week to read the register as of. Left out, it is the last
 *   week anything happened — which is what "now" means for a register whose
 *   own file stops in January.
 */
function loadRegister(projectId: string, register: RegisterKind, week?: number): Loaded | null {`);

rep(`  // The register's own date: the last thing that actually happened in it.
  let asOfDate = weeks[0]?.startDate ?? '2025-10-27';
  for (const s of stages) {
    if (s.submittedAt && s.submittedAt > asOfDate) asOfDate = s.submittedAt;
    if (s.returnedAt && s.returnedAt > asOfDate) asOfDate = s.returnedAt;
  }`,
`  // The register's own date: the last thing that actually happened in it.
  let evidenceDate = weeks[0]?.startDate ?? '2025-10-27';
  for (const s of stages) {
    if (s.submittedAt && s.submittedAt > evidenceDate) evidenceDate = s.submittedAt;
    if (s.returnedAt && s.returnedAt > evidenceDate) evidenceDate = s.returnedAt;
  }`);

rep(`  return {
    weeks, categories, documents, stages, weights, byDoc, docsByCategory,
    transmittalNo, asOfDate, asOfWeek: weekOf(asOfDate), weekOf,
  };
}`,
`  const evidenceWeek = weekOf(evidenceDate);
  const lastWeek = weeks[weeks.length - 1]?.weekNo ?? evidenceWeek;
  // A week outside the project is not an error worth throwing over — it is a
  // stale bookmark, and clamping shows the nearest week that exists.
  const asOfWeek = week === undefined ? evidenceWeek : Math.min(Math.max(1, Math.trunc(week)), lastWeek);
  const asOfDate = weeks.find((w) => w.weekNo === asOfWeek)?.endDate ?? evidenceDate;

  return {
    weeks, categories, documents, stages, weights, byDoc, docsByCategory,
    transmittalNo, asOfWeek, asOfDate, evidenceWeek, evidenceDate, weekOf,
  };
}`);

/* ------------------------------------------------------ week-aware evidence */
rep(`function reachedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.submitted) return null;
  if (s.submittedAt) return loaded.weekOf(s.submittedAt);
  if (s.planSubmitDate) return Math.min(loaded.weekOf(s.planSubmitDate), loaded.asOfWeek);
  return loaded.asOfWeek;
}`,
`function reachedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.submitted) return null;
  if (s.submittedAt) return loaded.weekOf(s.submittedAt);
  // Anchored to the register's own last movement, never to the week being
  // viewed: otherwise looking at week 43 would drag 42 dateless submissions
  // forward with it and the earlier weeks would lose them.
  if (s.planSubmitDate) return Math.min(loaded.weekOf(s.planSubmitDate), loaded.evidenceWeek);
  return loaded.evidenceWeek;
}

/** Whether the document had reached this stage by the week being viewed. */
function reachedBy(s: StageRow, loaded: Loaded): boolean {
  const week = reachedWeek(s, loaded);
  return week !== null && week <= loaded.asOfWeek;
}

/** The week a stage came back, on the same terms. */
function returnedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.returnedAt && !s.returnCode) return null;
  return s.returnedAt ? loaded.weekOf(s.returnedAt) : loaded.evidenceWeek;
}

function returnedBy(s: StageRow, loaded: Loaded): boolean {
  const week = returnedWeek(s, loaded);
  return week !== null && week <= loaded.asOfWeek;
}`);

/* ------------------------------- percent defaults to the week being viewed */
rep(`function percentOf(docs: DocumentRow[], loaded: Loaded, upToWeek?: number): number {`,
`function percentOf(docs: DocumentRow[], loaded: Loaded, upToWeek = loaded.asOfWeek): number {`);
rep(`      const week = reachedWeek(row, loaded);
      if (week !== null && (upToWeek === undefined || week <= upToWeek)) reached += 1;`,
`      const week = reachedWeek(row, loaded);
      if (week !== null && week <= upToWeek) reached += 1;`);

/* --------------------------------------------------------- counts by week */
rep(`  for (const d of docs) {
    const rows = loaded.byDoc.get(d.id) ?? [];
    const moved = rows.filter((s) => s.submitted);
    if (moved.length === 0) untouched += 1;

    const returned = rows.filter((s) => s.returnCode);
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) returnedOpen += 1;

    // Promised by now and still not out. Measured against the register's own
    // date, not today — see the note at the top of the file.
    if (rows.some((s) => !s.submitted && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)) {
      overdue += 1;
    }
  }`,
`  for (const d of docs) {
    const rows = loaded.byDoc.get(d.id) ?? [];
    if (!rows.some((s) => reachedBy(s, loaded))) untouched += 1;

    const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) returnedOpen += 1;

    // Promised by the week being viewed and still not out.
    if (rows.some((s) => !reachedBy(s, loaded) && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)) {
      overdue += 1;
    }
  }`);

fs.writeFileSync(file, s);
console.log('register.ts: viewpoint added');
