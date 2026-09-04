'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { STAGE_ORDER } from './register-shared';
import { writeSeed, type SeedInput } from './register-seed';
import { pickRegisterSheet, readWorkbookGrids } from './register-xlsx';
import type { DocStage, RegisterKind } from './schema';

/**
 * The register's write path — the thing item 15 exists for.
 *
 * Until now the document register could only be read: the importer filled it
 * from a workbook and every screen looked at it. A document controller had
 * nowhere to record that a transmittal went out, so the Excel file stayed the
 * real register and this app stayed a viewer.
 *
 * Two rules hold everything here together:
 *
 * **A field is saved as it was typed, one at a time.** The first attempt made
 * people tick documents and then choose a mode — "record submission" or
 * "record return" — before they could touch anything, and the modes were what
 * confused them. Correcting a wrong date is the commonest thing a controller
 * does, so it costs one click and one keystroke.
 *
 * **Progress is never typed.** Nothing here writes a percentage. What happened
 * is written down, and every figure on every screen — the category, the
 * register total, the weekly curve, and the WBS leaf once it is linked — is
 * recomputed from it by `lib/register.ts`. That is decision 17 actually
 * running, rather than described.
 */

export type ActionResult = { ok: true; changed: number } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Empty is a real answer here: it means “clear this date”. */
function optionalDate(value: string, what: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  if (!ISO_DATE.test(v)) throw new Error(`${what} is not a date`);
  return v;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertRegister(value: string): RegisterKind {
  if (value !== 'edl' && value !== 'vdrl') throw new Error(`Unknown register "${value}"`);
  return value;
}

function assertStage(value: string): DocStage {
  if (!STAGE_ORDER.includes(value as DocStage)) throw new Error(`Unknown stage "${value}"`);
  return value as DocStage;
}

/** Documents that really belong to this project and this register. */
function ownedDocuments(projectId: string, register: RegisterKind, documentIds: string[]) {
  if (documentIds.length === 0) throw new Error('No documents selected');
  const rows = db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.projectId, projectId),
      eq(schema.documents.register, register),
      inArray(schema.documents.id, documentIds),
    )).all();
  if (rows.length !== documentIds.length) throw new Error('Some documents are not in this register');
  return rows;
}

/**
 * A transmittal number is the same letter for everyone on it, so it is looked
 * up before it is created. Its date is the date of the first thing recorded
 * under it — a later correction updates the letter, not a second letter.
 */
function transmittalId(
  projectId: string,
  register: RegisterKind,
  no: string,
  direction: 'out' | 'in',
  date: string,
): string | null {
  const trimmed = no.trim();
  if (!trimmed) return null;

  const existing = db.select().from(schema.transmittals)
    .where(and(
      eq(schema.transmittals.projectId, projectId),
      eq(schema.transmittals.register, register),
      eq(schema.transmittals.no, trimmed),
      eq(schema.transmittals.direction, direction),
    )).all()[0];
  if (existing) return existing.id;

  const id = randomUUID();
  db.insert(schema.transmittals)
    .values({ id, projectId, register, no: trimmed, direction, date })
    .run();
  return id;
}

function refreshRegister() {
  // Every read in this module is a synchronous SQLite query that prerenders
  // into the static shell (see lib/sqlite.ts), so nothing here carries a cache
  // tag to expire — the route itself is what has to be rebuilt.
  revalidatePath('/dokumen', 'layout');
}

/* ------------------------------------------------------------ one stage */

export interface StageInput {
  projectId: string;
  register: RegisterKind;
  documentId: string;
  stage: string;
  /** All four are free text. An empty string clears the field. */
  sentAt: string;
  sentTransmittal: string;
  returnedAt: string;
  returnTransmittal: string;
  /**
   * Left out by the working screen, which no longer asks for it. Undefined
   * means "leave whatever is stored alone" — an imported APP/AWC is what marks
   * a document as still out for comment, and a screen that stopped asking must
   * not quietly erase it.
   */
  returnCode?: string;
}

/**
 * Save one stage of one document, exactly as it was typed.
 *
 * This replaced a tick-the-boxes-then-fill-a-dialog flow that made people stop
 * and think about which mode they were in before they could correct anything.
 * A controller is not filing a transaction; they are fixing a row that is
 * wrong. So every field is editable in place and this writes what is there —
 * including clearing it again.
 *
 * `submitted` is DERIVED, never asked for: a stage counts as reached when
 * anything at all is known about it going out. The percentage that follows is
 * then ours to compute, which is the whole arrangement — they keep the facts
 * right, the app keeps the arithmetic right.
 */
export async function saveStage(input: StageInput): Promise<ActionResult> {
  try {
    const stage = assertStage(input.stage);
    const [doc] = ownedDocuments(input.projectId, input.register, [input.documentId]);

    const sentAt = optionalDate(input.sentAt, 'Sent');
    const returnedAt = optionalDate(input.returnedAt, 'Returned');
    const sentNo = input.sentTransmittal.trim();
    const returnNo = input.returnTransmittal.trim();

    db.transaction((tx) => {
      const outId = sentNo
        ? transmittalId(input.projectId, input.register, sentNo, 'out', sentAt ?? returnedAt ?? today())
        : null;
      const inId = returnNo
        ? transmittalId(input.projectId, input.register, returnNo, 'in', returnedAt ?? sentAt ?? today())
        : null;

      const existing = tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)))
        .all()[0];

      const code = input.returnCode === undefined
        ? existing?.returnCode ?? null
        : input.returnCode.trim().toUpperCase() || null;
      // Anything known about the outbound leg means it went out.
      const submitted = Boolean(sentAt || sentNo || returnedAt || returnNo || code);

      const values = {
        submitted,
        submittedAt: sentAt,
        submitTransmittalId: outId,
        returnedAt,
        returnTransmittalId: inId,
        returnCode: code,
      };

      if (existing) {
        tx.update(schema.docStages).set(values).where(eq(schema.docStages.id, existing.id)).run();
      } else {
        tx.insert(schema.docStages).values({
          id: randomUUID(),
          documentId: doc.id,
          stage,
          order: STAGE_ORDER.indexOf(stage),
          ...values,
        }).run();
      }
    });

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* --------------------------------------------------------- the document */

export interface DocumentInput {
  projectId: string;
  register: RegisterKind;
  documentId: string;
  docNo: string;
  title: string;
}

/** Fix the document itself — its number and its title. */
export async function saveDocument(input: DocumentInput): Promise<ActionResult> {
  try {
    const [doc] = ownedDocuments(input.projectId, input.register, [input.documentId]);
    const title = input.title.trim();
    if (!title) throw new Error('Title cannot be empty');

    const docNo = input.docNo.trim() || null;
    if (docNo && docNo !== doc.docNo) {
      const clash = db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.projectId, input.projectId),
          eq(schema.documents.register, input.register),
          eq(schema.documents.docNo, docNo),
        )).all()[0];
      if (clash) throw new Error(`${docNo} is already used`);
    }

    db.update(schema.documents).set({ docNo, title })
      .where(eq(schema.documents.id, doc.id)).run();

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* --------------------------------------------------------- a new document */

export interface NewDocumentInput {
  projectId: string;
  register: RegisterKind;
  categoryId: string;
  docNo: string;
  title: string;
  kind: string;
}

export async function addDocument(input: NewDocumentInput): Promise<ActionResult> {
  try {
    const title = input.title.trim();
    if (!title) throw new Error('Document title is required');

    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all()[0];
    if (!category) throw new Error('Category not found');

    const docNo = input.docNo.trim() || null;
    if (docNo) {
      const clash = db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.projectId, input.projectId),
          eq(schema.documents.register, input.register),
          eq(schema.documents.docNo, docNo),
        )).all()[0];
      if (clash) throw new Error(`Number ${docNo} is already in use`);
    }

    // Adding a document changes every percentage in its category: the weight is
    // one document out of the register, so the denominator moves too. That is
    // the point — a register that grows should dilute, not quietly ignore.
    const siblings = db.select().from(schema.documents)
      .where(eq(schema.documents.categoryId, category.id)).all();

    db.insert(schema.documents).values({
      id: randomUUID(),
      projectId: input.projectId,
      register: input.register,
      categoryId: category.id,
      docNo,
      title,
      kind: input.kind.trim() || 'Doc',
      order: siblings.reduce((a, s) => Math.max(a, s.order), 0) + 1,
    }).run();

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------- building a new register */

/**
 * The list someone pasted, turned into a register.
 *
 * Until this existed the only way to fill a register was to run
 * `scripts/import-edl.ts` — an importer written for one workbook — so the module
 * worked for exactly one project: the one whose data somebody else had already
 * imported.
 *
 * Client and contractor names are asked for here because a register has two
 * sides and those sides are named. On the Petrogas EDL they ARE the column
 * headings: "INDOTURBINE Submission" against "PETROGAS Response".
 *
 * The writing itself lives in `lib/register-seed.ts`, which imports nothing from
 * Next and can therefore be proved by a script.
 */
export async function seedRegister(input: SeedInput): Promise<ActionResult> {
  try {
    const written = writeSeed(input);
    refreshRegister();
    return { ok: true, changed: written.documents };
  } catch (err) {
    return fail(err);
  }
}

export type ReadFileResult =
  | { ok: true; text: string; sheet: string; sheets: string[] }
  | { ok: false; error: string };

/**
 * A workbook, read into the SAME text a paste produces — and nothing more.
 *
 * It deliberately does not write. The first version wrote the moment a file was
 * chosen, which meant picking the wrong file put another project's register
 * into this one before anyone could see what was in it. Reading and writing are
 * now two separate presses with the preview between them, exactly as pasting
 * has always been: one path, one confirmation.
 */
export async function readRegisterFile(form: FormData): Promise<ReadFileResult> {
  try {
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('No file was chosen');
    if (file.size === 0) throw new Error('That file is empty');
    if (file.size > 25 * 1024 * 1024) throw new Error('That file is larger than 25 MB');

    const register = assertRegister(String(form.get('register') ?? ''));
    const grids = await readWorkbookGrids(Buffer.from(await file.arrayBuffer()));
    const sheet = pickRegisterSheet(grids, register);
    if (!sheet) throw new Error('That workbook has no sheets');
    if (sheet.rows === 0) throw new Error(`The sheet "${sheet.name}" is empty`);

    return { ok: true, text: sheet.text, sheet: sheet.name, sheets: grids.map((g) => g.name) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'That file could not be read';
    return { ok: false, error: message };
  }
}

/**
 * Stage weights are an agreement per contract, not a law — Gundih and Petrogas
 * happen to share 0.5/0.3/0.2, but another contract may not. What is not
 * allowed is a total other than 100: every percentage in the register is
 * computed from these, so a total of 90 reads a finished document as 90%.
 */
export async function saveStageWeights(input: {
  projectId: string; register: RegisterKind; weights: { stage: string; weight: number }[];
}): Promise<ActionResult> {
  try {
    const total = input.weights.reduce((a, w) => a + w.weight, 0);
    if (Math.abs(total - 100) > 0.001) throw new Error(`The weights add up to ${total}, not 100`);

    db.transaction((tx) => {
      for (const { stage, weight } of input.weights) {
        if (weight < 0) throw new Error('A weight cannot be negative');
        tx.update(schema.docStageWeights)
          .set({ weight })
          .where(and(
            eq(schema.docStageWeights.projectId, input.projectId),
            eq(schema.docStageWeights.register, input.register),
            eq(schema.docStageWeights.stage, assertStage(stage)),
          )).run();
      }
    });

    refreshRegister();
    return { ok: true, changed: input.weights.length };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------------------------------- tending it */

/**
 * A group can only be deleted once it is EMPTY.
 *
 * `docCategories` cascades to `documents`, which cascades to `doc_stages`:
 * deleting a group that still holds documents would take their whole history
 * with it and nobody would be asked. This condition is what stands in the way.
 */
export async function deleteCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string;
}): Promise<ActionResult> {
  try {
    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all()[0];
    if (!category) throw new Error('Group not found');

    const docs = db.select().from(schema.documents)
      .where(eq(schema.documents.categoryId, category.id)).all();
    if (docs.length > 0) {
      throw new Error(`Empty it first — ${docs.length} document${docs.length === 1 ? '' : 's'} still inside`);
    }

    const children = db.select().from(schema.docCategories)
      .where(eq(schema.docCategories.parentId, category.id)).all();
    if (children.length > 0) throw new Error('Delete the groups inside it first');

    db.delete(schema.docCategories).where(eq(schema.docCategories.id, category.id)).run();
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/** `General Prosedur` → `GENERAL-PROSEDUR`, and `-2` when that is taken. */
function categoryCode(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'CATEGORY';
  let code = base;
  let n = 2;
  while (taken.has(code)) { code = `${base}-${n}`; n += 1; }
  return code;
}

export async function addCategory(input: {
  projectId: string; register: RegisterKind; name: string; parentId: string | null;
}): Promise<ActionResult> {
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Group name is required');

    const siblings = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all();

    if (siblings.some((c) => (c.parentId ?? null) === input.parentId
      && c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" is already here`);
    }

    db.insert(schema.docCategories).values({
      id: randomUUID(),
      projectId: input.projectId,
      register: input.register,
      parentId: input.parentId,
      code: categoryCode(name, new Set(siblings.map((c) => c.code))),
      name,
      order: siblings.reduce((a, c) => Math.max(a, c.order), -1) + 1,
    }).run();

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function renameCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string; name: string;
}): Promise<ActionResult> {
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Group name is required');

    const updated = db.update(schema.docCategories)
      .set({ name })
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).run();
    if (updated.changes === 0) throw new Error('Group not found');

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Deleting a document deletes its history with it — that is what was asked for,
 * and `doc_stages` already cascades from `documents`. What moves quietly is the
 * denominator: every percentage in this group is recomputed from the documents
 * that remain.
 */
export async function deleteDocument(input: {
  projectId: string; register: RegisterKind; documentId: string;
}): Promise<ActionResult> {
  try {
    const [doc] = ownedDocuments(input.projectId, input.register, [input.documentId]);
    db.delete(schema.documents).where(eq(schema.documents.id, doc.id)).run();
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* ----------------------------------------------------- linking to the WBS */

export interface LinkInput {
  projectId: string;
  /** The discipline branch — `Detail Engineering › Electrical`. */
  nodeId: string;
  categoryId: string;
  on: boolean;
}

/**
 * Point a discipline's engineering leaves at the register, or take them back.
 *
 * Nothing is copied. The leaf's method becomes `linked` and it names the
 * category it reads; the percentage is worked out when it is asked for. So the
 * switch is reversible at no cost — turning it off restores exactly the figures
 * that were there before, because they were never overwritten. That matters
 * here more than anywhere: this register is thirty weeks older than the report
 * it would feed, so the switch is off until a register of the same vintage
 * arrives.
 */
export async function setDisciplineLink(input: LinkInput): Promise<ActionResult> {
  try {
    const leaves = db.select().from(schema.wbsNodes)
      .where(and(eq(schema.wbsNodes.parentId, input.nodeId), eq(schema.wbsNodes.isLeaf, true)))
      .all();
    if (leaves.length === 0) throw new Error('This discipline has no engineering leaves');

    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
      )).all()[0];
    if (!category) throw new Error('Register category not found');

    let changed = 0;
    db.transaction((tx) => {
      for (const leaf of leaves) {
        const stage = leaf.deskripsi.trim().toUpperCase().replace('-', '_') as DocStage;
        if (!STAGE_ORDER.includes(stage)) continue;

        tx.update(schema.wbsNodes)
          .set(input.on
            ? { progressMethod: 'linked', linkedCategoryId: category.id, linkedStage: stage }
            // Back to how the workbook measured it. The stored weekly figures
            // were never touched, so they are still exactly what they were.
            : { progressMethod: 'lumpsum', linkedCategoryId: null, linkedStage: null })
          .where(eq(schema.wbsNodes.id, leaf.id))
          .run();
        changed += 1;
      }
    });

    refreshRegister();
    // The weekly report reads these leaves too.
    revalidatePath('/weekly', 'layout');
    return { ok: true, changed };
  } catch (err) {
    return fail(err);
  }
}
