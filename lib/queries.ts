/**
 * Reads for the v2 database.
 *
 * Separate from `lib/data.ts`, which serves the old JSON store and still feeds
 * every other screen. Only `/dokumen` reads from here for now.
 *
 * Every query is synchronous on purpose. better-sqlite3 under Cache Components
 * counts as a deterministic operation, so these complete during prerendering
 * and land in the static shell — no `use cache`, no `<Suspense>`. See the note
 * at the top of `lib/sqlite.ts`.
 *
 * Percentages are 0..100 throughout, matching the schema.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';

export interface RegisterSummary {
  documents: number;
  categories: number;
  transmittals: number;
  stages: Array<{ stage: string; weight: number; reached: number }>;
  /** Share of the whole register that is done, 0..100. */
  progress: number;
}

export interface CategoryProgress {
  code: string;
  name: string;
  documents: number;
  /** How many have reached each weighted stage. */
  reached: Array<{ stage: string; count: number }>;
}

export interface OutstandingDocument {
  docNo: string;
  title: string;
  categoryName: string;
  /** The furthest stage it has reached. */
  stage: string;
  returnCode: string;
  returnedAt: string | null;
  pic: string | null;
}

/** Return codes that mean the document is genuinely through. */
const APPROVED = new Set(['APP', 'APPROVED', 'FINISH']);

export function getProject(projectId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
}

/* -------------------------------------------------------------- internals */

function loadRegister(projectId: string) {
  const documents = db.select().from(schema.documents)
    .where(eq(schema.documents.projectId, projectId)).all();
  if (documents.length === 0) return null;

  const docIds = new Set(documents.map((d) => d.id));
  // A stage record exists only where something actually happened — a
  // submission, a transmittal, a return — never for a plan date alone. Its
  // presence IS the evidence that the document reached that stage, which is
  // what lets the register count submissions whose date nobody wrote down.
  const stages = db.select().from(schema.docStages).all().filter((s) => docIds.has(s.documentId));

  const reachedByDoc = new Map<string, Set<string>>();
  for (const s of stages) {
    const set = reachedByDoc.get(s.documentId) ?? new Set<string>();
    set.add(s.stage);
    reachedByDoc.set(s.documentId, set);
  }

  const weights = db.select().from(schema.docStageWeights)
    .where(eq(schema.docStageWeights.projectId, projectId)).all()
    .filter((w) => w.weight > 0)
    .sort((a, b) => a.order - b.order);

  return { documents, stages, reachedByDoc, weights };
}

/* ----------------------------------------------------------------- public */

export function getRegisterSummary(projectId: string): RegisterSummary | null {
  const loaded = loadRegister(projectId);
  if (!loaded) return null;
  const { documents, reachedByDoc, weights } = loaded;

  const categories = db.select().from(schema.docCategories)
    .where(eq(schema.docCategories.projectId, projectId)).all();
  const transmittals = db.select().from(schema.transmittals)
    .where(eq(schema.transmittals.projectId, projectId)).all();

  const total = documents.length;
  const stages = weights.map((w) => ({
    stage: w.stage,
    weight: w.weight,
    reached: documents.filter((d) => reachedByDoc.get(d.id)?.has(w.stage)).length,
  }));

  return {
    documents: total,
    categories: categories.filter((c) => !categories.some((o) => o.code.startsWith(`${c.code}.`))).length,
    transmittals: transmittals.length,
    stages,
    progress: stages.reduce((a, s) => a + (s.reached / total) * s.weight, 0),
  };
}

/**
 * One row per category rather than 143 documents. A document controller works
 * category by category — "where is Electrical" — and a wall of rows is exactly
 * what this product exists to replace.
 */
export function getCategoryProgress(projectId: string): CategoryProgress[] {
  const loaded = loadRegister(projectId);
  if (!loaded) return [];
  const { documents, reachedByDoc, weights } = loaded;

  const categories = db.select().from(schema.docCategories)
    .where(eq(schema.docCategories.projectId, projectId)).all();
  const idToCode = new Map(categories.map((c) => [c.id, c.code]));
  // Only leaf categories hold documents; the rest are subtotal headings.
  const leaves = categories.filter((c) => !categories.some((o) => o.code.startsWith(`${c.code}.`)));

  return leaves
    .map((cat) => {
      const docs = documents.filter((d) => idToCode.get(d.categoryId) === cat.code);
      return {
        code: cat.code,
        name: cat.name,
        documents: docs.length,
        reached: weights.map((w) => ({
          stage: w.stage,
          count: docs.filter((d) => reachedByDoc.get(d.id)?.has(w.stage)).length,
        })),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}

/**
 * Documents that came back with a comment and have not been approved since.
 *
 * This is the list that actually holds construction up, and the reason the
 * module earns its place even though every engineering leaf in the WBS together
 * carries under one percent of project weight.
 */
export function getOutstandingDocuments(projectId: string): OutstandingDocument[] {
  const loaded = loadRegister(projectId);
  if (!loaded) return [];
  const { documents, stages } = loaded;

  const categoryName = new Map(
    db.select().from(schema.docCategories)
      .where(eq(schema.docCategories.projectId, projectId)).all()
      .map((c) => [c.id, c.name]),
  );

  const returned = stages.filter((s) => s.returnCode).sort((a, b) => a.order - b.order);

  const out: OutstandingDocument[] = [];
  for (const doc of documents) {
    const history = returned.filter((s) => s.documentId === doc.id);
    if (history.length === 0) continue;
    const last = history[history.length - 1];
    if (APPROVED.has(last.returnCode!.toUpperCase())) continue;
    out.push({
      docNo: doc.docNo,
      title: doc.title,
      categoryName: categoryName.get(doc.categoryId) ?? '—',
      stage: last.stage,
      returnCode: last.returnCode!,
      returnedAt: last.returnedAt,
      pic: doc.pic,
    });
  }

  // Most recently returned first: that is the order a controller works in.
  return out.sort((a, b) => (b.returnedAt ?? '').localeCompare(a.returnedAt ?? ''));
}
