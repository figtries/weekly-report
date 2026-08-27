'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { STAGE_ORDER } from './register-shared';
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
 * **A submission is recorded once, for every document that went out in it.**
 * The evidence says why: 47 outgoing transmittals in Gundih's EDL carry 232
 * submissions between them — `T.001` alone carries 34. Recording one document
 * at a time would mean typing the same number and the same date 34 times.
 *
 * **Progress is never typed.** Nothing here writes a percentage. A submission
 * is written down, and every figure on every screen — the category, the
 * register total, the weekly curve, and the WBS leaf once it is linked — is
 * recomputed from it by `lib/register.ts`. That is decision 17 actually
 * running, rather than described.
 */

export type ActionResult = { ok: true; changed: number } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Ada yang salah' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, what: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`${what} belum diisi`);
  return value;
}

function assertStage(value: string): DocStage {
  if (!STAGE_ORDER.includes(value as DocStage)) throw new Error(`Tahap "${value}" tidak dikenal`);
  return value as DocStage;
}

/** Documents that really belong to this project and this register. */
function ownedDocuments(projectId: string, register: RegisterKind, documentIds: string[]) {
  if (documentIds.length === 0) throw new Error('Belum ada dokumen yang dipilih');
  const rows = db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.projectId, projectId),
      eq(schema.documents.register, register),
      inArray(schema.documents.id, documentIds),
    )).all();
  if (rows.length !== documentIds.length) throw new Error('Ada dokumen yang tidak ditemukan di register ini');
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

/* ------------------------------------------------------------- submissions */

export interface SubmissionInput {
  projectId: string;
  register: RegisterKind;
  stage: string;
  /** Our letter out. Optional: plenty of real submissions never got one. */
  transmittalNo: string;
  date: string;
  documentIds: string[];
}

export async function recordSubmission(input: SubmissionInput): Promise<ActionResult> {
  try {
    const stage = assertStage(input.stage);
    const date = assertDate(input.date, 'Tanggal kirim');
    const documents = ownedDocuments(input.projectId, input.register, input.documentIds);

    const changed = db.transaction((tx) => {
      const outId = transmittalId(input.projectId, input.register, input.transmittalNo, 'out', date);
      let n = 0;

      for (const doc of documents) {
        const existing = tx.select().from(schema.docStages)
          .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)))
          .all()[0];

        if (existing) {
          // The row may already exist as a promise — a plan date and nothing
          // else. Recording the submission turns the promise into a fact and
          // leaves the promise beside it, which is what the plan curve reads.
          tx.update(schema.docStages)
            .set({ submitted: true, submittedAt: date, submitTransmittalId: outId ?? existing.submitTransmittalId })
            .where(eq(schema.docStages.id, existing.id))
            .run();
        } else {
          tx.insert(schema.docStages).values({
            id: randomUUID(),
            documentId: doc.id,
            stage,
            order: STAGE_ORDER.indexOf(stage),
            submitted: true,
            submittedAt: date,
            submitTransmittalId: outId,
          }).run();
        }
        n += 1;
      }
      return n;
    });

    refreshRegister();
    return { ok: true, changed };
  } catch (err) {
    return fail(err);
  }
}

/* ----------------------------------------------------------------- returns */

export interface ReturnInput {
  projectId: string;
  register: RegisterKind;
  stage: string;
  transmittalNo: string;
  date: string;
  /** APP, AWC, RWC — the client's own vocabulary, kept as typed. */
  returnCode: string;
  documentIds: string[];
}

export async function recordReturn(input: ReturnInput): Promise<ActionResult> {
  try {
    const stage = assertStage(input.stage);
    const date = assertDate(input.date, 'Tanggal terima');
    const code = input.returnCode.trim().toUpperCase();
    if (!code) throw new Error('Return code belum diisi');
    const documents = ownedDocuments(input.projectId, input.register, input.documentIds);

    const changed = db.transaction((tx) => {
      const inId = transmittalId(input.projectId, input.register, input.transmittalNo, 'in', date);
      let n = 0;

      for (const doc of documents) {
        const existing = tx.select().from(schema.docStages)
          .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)))
          .all()[0];
        // A return with no submission behind it is a data entry mistake, not a
        // new fact: it would count as progress the document never made.
        if (!existing || !existing.submitted) continue;

        tx.update(schema.docStages)
          .set({ returnedAt: date, returnTransmittalId: inId ?? existing.returnTransmittalId, returnCode: code })
          .where(eq(schema.docStages.id, existing.id))
          .run();
        n += 1;
      }
      return n;
    });

    if (changed === 0) throw new Error('Tidak ada dokumen yang sudah dikirim di tahap itu');
    refreshRegister();
    return { ok: true, changed };
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
    if (!title) throw new Error('Judul dokumen belum diisi');

    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all()[0];
    if (!category) throw new Error('Kategori tidak ditemukan');

    const docNo = input.docNo.trim() || null;
    if (docNo) {
      const clash = db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.projectId, input.projectId),
          eq(schema.documents.register, input.register),
          eq(schema.documents.docNo, docNo),
        )).all()[0];
      if (clash) throw new Error(`Nomor ${docNo} sudah dipakai`);
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
    if (leaves.length === 0) throw new Error('Disiplin ini tidak punya leaf engineering');

    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
      )).all()[0];
    if (!category) throw new Error('Kategori register tidak ditemukan');

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
