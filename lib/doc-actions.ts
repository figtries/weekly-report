'use server';

import { requireEdit } from './auth/require-edit';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { transmittalId, writeDocumentStatus, writeStage, writeTransmittal, type TransmittalInput } from './transmittal-write';
import { STAGE_ORDER, baseOfAdded, isAddedStage, isStageKey, stageRank } from './register-shared';
import type { StatusWhere } from './register-status';
import { isAddedCode, parseCodes } from './register-settings';
import { writeDraft, writeSeed, type DraftGroup, type SeedInput } from './register-seed';
import { pickRegisterSheet, readWorkbookGrids } from './register-xlsx';
import type { DocStage, RegisterKind } from './schema';

export type ActionResult = { ok: true; changed: number } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!isStageKey(value)) throw new Error(`Unknown stage "${value}"`);
  return value;
}

async function ownedDocuments(projectId: string, register: RegisterKind, documentIds: string[]) {
  if (documentIds.length === 0) throw new Error('No documents selected');
  const rows = await db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.projectId, projectId),
      eq(schema.documents.register, register),
      inArray(schema.documents.id, documentIds),
    ));
  if (rows.length !== documentIds.length) throw new Error('Some documents are not in this register');
  return rows;
}

function refreshRegister() {
  revalidatePath('/dokumen', 'layout');
}

/* ------------------------------------------------------------ one stage */

export interface StageInput {
  projectId: string;
  register: RegisterKind;
  documentId: string;
  stage: string;
  sentAt: string;
  sentTransmittal: string;
  returnedAt: string;
  returnTransmittal: string;
  returnCode?: string;
  planSubmitDate?: string;
}

export async function saveStage(input: StageInput): Promise<ActionResult> {
  await requireEdit();
  try {
    const stage = assertStage(input.stage);
    const [doc] = await ownedDocuments(input.projectId, input.register, [input.documentId]);

    const sentAt = optionalDate(input.sentAt, 'Sent');
    const returnedAt = optionalDate(input.returnedAt, 'Returned');
    const plan = input.planSubmitDate === undefined
      ? undefined
      : optionalDate(input.planSubmitDate, 'Plan');
    const sentNo = input.sentTransmittal.trim();
    const returnNo = input.returnTransmittal.trim();

    await db.transaction(async (tx) => {
      const outId = sentNo
        ? await transmittalId(input.projectId, input.register, sentNo, 'out', sentAt ?? returnedAt ?? today(), tx)
        : null;
      const inId = returnNo
        ? await transmittalId(input.projectId, input.register, returnNo, 'in', returnedAt ?? sentAt ?? today(), tx)
        : null;

      const existingRows = await tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, doc.id), eq(schema.docStages.stage, stage)));
      const existing = existingRows[0];

      const code = input.returnCode === undefined
        ? existing?.returnCode ?? null
        : input.returnCode.trim().toUpperCase() || null;
      const submitted = Boolean(sentAt || sentNo || returnedAt || returnNo || code);

      const values = {
        submitted,
        submittedAt: sentAt,
        submitTransmittalId: outId,
        returnedAt,
        returnTransmittalId: inId,
        returnCode: code,
        ...(plan !== undefined ? { planSubmitDate: plan } : {}),
      };

      await writeStage(tx, doc.id, stage, values);
    });

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------- status, set directly */

export async function setDocumentStatus(input: {
  projectId: string; register: RegisterKind; documentId: string;
  stage: string; where: StatusWhere; code: string | null; date: string; letter: string;
  confirmed: boolean;
}): Promise<ActionResult | { ok: false; error: string; confirm: string[] }> {
  await requireEdit();
  try {
    const r = await writeDocumentStatus({ ...input, register: assertRegister(input.register), stage: assertStage(input.stage) });
    if ('confirm' in r) return { ok: false, error: 'Already recorded', confirm: r.confirm };
    refreshRegister();
    return { ok: true, changed: r.written };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------------------------- one letter, many */

export async function recordTransmittal(input: TransmittalInput): Promise<ActionResult> {
  await requireEdit();
  try {
    const changed = await writeTransmittal({ ...input, register: assertRegister(input.register) });
    refreshRegister();
    return { ok: true, changed };
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
  kind?: string;
  categoryId?: string;
  revision?: string;
  pic?: string;
  remarks?: string;
}

export async function saveDocument(input: DocumentInput): Promise<ActionResult> {
  await requireEdit();
  try {
    const [doc] = await ownedDocuments(input.projectId, input.register, [input.documentId]);
    const title = input.title.trim();
    if (!title) throw new Error('Title cannot be empty');

    const docNo = input.docNo.trim() || null;
    if (docNo && docNo !== doc.docNo) {
      const clashRows = await db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.projectId, input.projectId),
          eq(schema.documents.register, input.register),
          eq(schema.documents.docNo, docNo),
        ));
      if (clashRows[0]) throw new Error(`${docNo} is already used`);
    }

    const extra: Partial<typeof schema.documents.$inferInsert> = {};
    if (input.kind !== undefined) extra.kind = input.kind.trim().toLowerCase().startsWith('dw') ? 'Dwg' : 'Doc';
    if (input.revision !== undefined) extra.revision = input.revision.trim() || null;
    if (input.pic !== undefined) extra.pic = input.pic.trim() || null;
    if (input.remarks !== undefined) extra.remarks = input.remarks.trim() || null;
    if (input.categoryId !== undefined && input.categoryId !== doc.categoryId) {
      const targetRows = await db.select().from(schema.docCategories)
        .where(and(
          eq(schema.docCategories.id, input.categoryId),
          eq(schema.docCategories.projectId, input.projectId),
          eq(schema.docCategories.register, input.register),
        ));
      if (!targetRows[0]) throw new Error('That discipline is not in this register');
      extra.categoryId = targetRows[0].id;
    }

    await db.update(schema.documents).set({ docNo, title, ...extra })
      .where(eq(schema.documents.id, doc.id));

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
  await requireEdit();
  try {
    const title = input.title.trim();
    if (!title) throw new Error('Document title is required');

    const categoryRows = await db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      ));
    const category = categoryRows[0];
    if (!category) throw new Error('Category not found');

    const docNo = input.docNo.trim() || null;
    if (docNo) {
      const clashRows = await db.select().from(schema.documents)
        .where(and(
          eq(schema.documents.projectId, input.projectId),
          eq(schema.documents.register, input.register),
          eq(schema.documents.docNo, docNo),
        ));
      if (clashRows[0]) throw new Error(`Number ${docNo} is already in use`);
    }

    const siblings = await db.select().from(schema.documents)
      .where(eq(schema.documents.categoryId, category.id));

    await db.insert(schema.documents).values({
      id: randomUUID(),
      projectId: input.projectId,
      register: input.register,
      categoryId: category.id,
      docNo,
      title,
      kind: input.kind.trim() || 'Doc',
      order: siblings.reduce((a, s) => Math.max(a, s.order), 0) + 1,
    });

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------- building a new register */

export async function seedRegister(input: SeedInput): Promise<ActionResult> {
  await requireEdit();
  try {
    const written = await writeSeed(input);
    refreshRegister();
    return { ok: true, changed: written.documents };
  } catch (err) {
    return fail(err);
  }
}

export async function saveNumbering(input: {
  projectId: string;
  register: RegisterKind;
  prefix: string;
  disciplines: Record<string, string>;
  types: Record<string, string>;
  area?: string;
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const prefix = input.prefix.trim().toUpperCase();
    if (!prefix) throw new Error('A project code is required');
    if (!/^[A-Z0-9-]{2,10}$/.test(prefix)) {
      throw new Error('A project code is 2 to 10 letters, digits or dashes');
    }

    const values = {
      prefix,
      disciplines: JSON.stringify(input.disciplines ?? {}),
      types: JSON.stringify(input.types ?? {}),
      digits: 3,
      ...(input.area !== undefined ? { area: input.area.trim().toUpperCase() || null } : {}),
    };

    const existingRows = await db.select().from(schema.docNumbering)
      .where(and(
        eq(schema.docNumbering.projectId, input.projectId),
        eq(schema.docNumbering.register, input.register),
      ));
    const existing = existingRows[0];

    if (existing) {
      await db.update(schema.docNumbering).set(values)
        .where(eq(schema.docNumbering.id, existing.id));
    } else {
      await db.insert(schema.docNumbering).values({
        id: randomUUID(), projectId: input.projectId, register: input.register, ...values,
      });
    }

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function addFromDraft(input: {
  projectId: string;
  register: RegisterKind;
  groups: DraftGroup[];
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const written = await writeDraft(input);
    refreshRegister();
    return { ok: true, changed: written.documents + written.updated };
  } catch (err) {
    return fail(err);
  }
}

export type ReadFileResult =
  | { ok: true; text: string; sheet: string; sheets: string[] }
  | { ok: false; error: string };

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

export async function saveStageWeights(input: {
  projectId: string; register: RegisterKind; weights: { stage: string; weight: number }[];
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const total = input.weights.reduce((a, w) => a + w.weight, 0);
    if (Math.abs(total - 100) > 0.001) throw new Error(`The weights add up to ${total}, not 100`);

    await db.transaction(async (tx) => {
      for (const { stage, weight } of input.weights) {
        if (weight < 0) throw new Error('A weight cannot be negative');
        await tx.update(schema.docStageWeights)
          .set({ weight })
          .where(and(
            eq(schema.docStageWeights.projectId, input.projectId),
            eq(schema.docStageWeights.register, input.register),
            eq(schema.docStageWeights.stage, assertStage(stage)),
          ));
      }
    });

    refreshRegister();
    return { ok: true, changed: input.weights.length };
  } catch (err) {
    return fail(err);
  }
}

export async function saveRegisterSettings(input: {
  projectId: string;
  register: RegisterKind;
  stages: { stage: string; weight: number; label: string; name: string; color: string; revStart?: string }[];
  codes?: { key: string; label: string; meaning: string }[];
  area?: string;
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const register = assertRegister(input.register);
    const total = input.stages.reduce((a, w) => a + (Number.isFinite(w.weight) ? w.weight : 0), 0);
    if (Math.abs(total - 100) > 0.001) throw new Error(`The weights add up to ${total}%, not 100%`);
    const COLOR = /^#[0-9a-f]{6}$/i;

    await db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.docStageWeights)
        .where(and(eq(schema.docStageWeights.projectId, input.projectId), eq(schema.docStageWeights.register, register)));
      if (rows.length === 0) {
        await tx.insert(schema.docStageWeights).values(STAGE_ORDER.map((stage, order) => ({
          id: randomUUID(), projectId: input.projectId, register, stage, weight: 0, order,
        })));
      }

      const kept = new Set(input.stages.map((s) => s.stage));
      const gone = rows.filter((r) => isAddedStage(r.stage) && !kept.has(r.stage)).map((r) => r.stage);
      if (gone.length) {
        const keys = gone.flatMap((s) => [s, `RE_${s}` as DocStage]);
        const docIdRows = await tx.select({ id: schema.documents.id }).from(schema.documents)
          .where(and(eq(schema.documents.projectId, input.projectId), eq(schema.documents.register, register)));
        const docIds = docIdRows.map((d) => d.id);
        const used = docIds.length === 0 ? [] : await tx.select().from(schema.docStages)
          .where(and(inArray(schema.docStages.documentId, docIds), inArray(schema.docStages.stage, keys)));
        const sent = used.filter((u) => u.submitted || u.submittedAt || u.returnedAt || u.returnCode);
        if (sent.length) {
          const label = rows.find((r) => r.stage === baseOfAdded(sent[0].stage))?.label || sent[0].stage;
          throw new Error(`${label} has already been sent on ${sent.length === 1 ? 'a document' : `${sent.length} documents`}, so it stays`);
        }
        if (used.length) await tx.delete(schema.docStages).where(inArray(schema.docStages.id, used.map((u) => u.id)));
        await tx.delete(schema.docStageWeights).where(and(
          eq(schema.docStageWeights.projectId, input.projectId),
          eq(schema.docStageWeights.register, register),
          inArray(schema.docStageWeights.stage, keys),
        ));
      }

      for (const s of input.stages) {
        const stage = assertStage(s.stage);
        if (s.weight < 0) throw new Error('A weight cannot be negative');
        if (!s.label.trim()) throw new Error(`Give ${stage} a short name`);
        if (isAddedStage(stage) && !rows.some((r) => r.stage === stage)) {
          await tx.insert(schema.docStageWeights).values({
            id: randomUUID(), projectId: input.projectId, register, stage, weight: 0, order: stageRank(stage),
          });
        }
        await tx.update(schema.docStageWeights)
          .set({
            weight: s.weight,
            label: s.label.trim().slice(0, 12),
            fullName: s.name.trim().slice(0, 60) || null,
            color: COLOR.test(s.color) ? s.color : null,
            ...(s.revStart !== undefined ? { revStart: s.revStart.trim().slice(0, 6) } : {}),
          })
          .where(and(
            eq(schema.docStageWeights.projectId, input.projectId),
            eq(schema.docStageWeights.register, register),
            eq(schema.docStageWeights.stage, stage),
          ));
      }

      if (input.codes !== undefined || input.area !== undefined) {
        const values: Partial<typeof schema.docNumbering.$inferInsert> = {};
        const numberingRows = await tx.select().from(schema.docNumbering)
          .where(and(eq(schema.docNumbering.projectId, input.projectId), eq(schema.docNumbering.register, register)));
        const numbering = numberingRows[0];
        if (input.codes !== undefined) {
          const codes = input.codes.filter((c) => ['APP', 'AWC', 'RWC'].includes(c.key) || isAddedCode(c.key));
          const labels = new Set<string>();
          for (const c of codes) {
            const label = c.label.trim().toUpperCase();
            if (!label) throw new Error('Give every client code its letters');
            if (labels.has(label)) throw new Error(`Two codes read ${label}`);
            labels.add(label);
          }
          const keptCodes = new Set(codes.map((c) => c.key));
          const goneCodes = parseCodes(numbering?.codes).filter((c) => isAddedCode(c.key) && !keptCodes.has(c.key));
          if (goneCodes.length) {
            const docIdRows2 = await tx.select({ id: schema.documents.id }).from(schema.documents)
              .where(and(eq(schema.documents.projectId, input.projectId), eq(schema.documents.register, register)));
            const docIds2 = docIdRows2.map((d) => d.id);
            const usedCodes = docIds2.length === 0 ? [] : await tx.select({ code: schema.docStages.returnCode }).from(schema.docStages)
              .where(and(inArray(schema.docStages.documentId, docIds2), inArray(schema.docStages.returnCode, goneCodes.map((c) => c.key))));
            if (usedCodes.length) {
              const label = goneCodes.find((c) => c.key === usedCodes[0].code)?.label || usedCodes[0].code;
              throw new Error(`${label} is already on ${usedCodes.length === 1 ? 'a reply' : `${usedCodes.length} replies`}, so it stays`);
            }
          }
          values.codes = JSON.stringify(codes
            .map((c) => ({ key: c.key, label: c.label.trim().toUpperCase().slice(0, 8), meaning: c.meaning.trim().slice(0, 60) })));
        }
        if (input.area !== undefined) values.area = input.area.trim().toUpperCase().slice(0, 8) || null;
        if (numbering) {
          await tx.update(schema.docNumbering).set(values).where(eq(schema.docNumbering.id, numbering.id));
        } else {
          const projectRows = await tx.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
          const project = projectRows[0];
          await tx.insert(schema.docNumbering).values({
            id: randomUUID(), projectId: input.projectId, register,
            prefix: (project?.alias?.trim() || 'DOC').toUpperCase(), ...values,
          });
        }
      }
    });

    refreshRegister();
    return { ok: true, changed: input.stages.length };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string;
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const categoryRows = await db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      ));
    const category = categoryRows[0];
    if (!category) throw new Error('Group not found');

    const [docs, children] = await Promise.all([
      db.select().from(schema.documents).where(eq(schema.documents.categoryId, category.id)),
      db.select().from(schema.docCategories).where(eq(schema.docCategories.parentId, category.id)),
    ]);
    if (docs.length > 0) {
      throw new Error(`Empty it first — ${docs.length} document${docs.length === 1 ? '' : 's'} still inside`);
    }
    if (children.length > 0) throw new Error('Delete the groups inside it first');

    await db.delete(schema.docCategories).where(eq(schema.docCategories.id, category.id));
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function editSavedHeadings(input: {
  projectId: string; register: RegisterKind;
  renames: { id: string; name: string }[];
  removals: string[];
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const all = await db.select().from(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, input.projectId), eq(schema.docCategories.register, input.register)));
    const gone = new Set<string>();
    const take = (id: string) => {
      if (gone.has(id) || !all.some((c) => c.id === id)) return;
      gone.add(id);
      for (const c of all) if (c.parentId === id) take(c.id);
    };
    input.removals.forEach(take);
    const ids = [...gone];

    await db.transaction(async (tx) => {
      for (const r of input.renames) {
        const name = r.name.trim();
        if (!name || gone.has(r.id) || !all.some((c) => c.id === r.id)) continue;
        await tx.update(schema.docCategories).set({ name }).where(eq(schema.docCategories.id, r.id));
      }
      if (ids.length > 0) {
        await Promise.all([
          tx.update(schema.wbsNodes)
            .set({ progressMethod: 'lumpsum', linkedCategoryId: null, linkedStage: null })
            .where(inArray(schema.wbsNodes.linkedCategoryId, ids)),
          tx.delete(schema.documents).where(inArray(schema.documents.categoryId, ids)),
        ]);
        await tx.delete(schema.docCategories).where(inArray(schema.docCategories.id, ids));
      }
    });

    refreshRegister();
    if (ids.length > 0) revalidatePath('/weekly', 'layout');
    return { ok: true, changed: input.renames.length + ids.length };
  } catch (err) {
    return fail(err);
  }
}

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
  await requireEdit();
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Group name is required');

    const siblings = await db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      ));

    if (siblings.some((c) => (c.parentId ?? null) === input.parentId
      && c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" is already here`);
    }

    await db.insert(schema.docCategories).values({
      id: randomUUID(),
      projectId: input.projectId,
      register: input.register,
      parentId: input.parentId,
      code: categoryCode(name, new Set(siblings.map((c) => c.code))),
      name,
      order: siblings.reduce((a, c) => Math.max(a, c.order), -1) + 1,
    });

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function renameCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string; name: string;
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Group name is required');

    const updated = await db.update(schema.docCategories)
      .set({ name })
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      ));
    if (updated.length === 0) throw new Error('Group not found');

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteDocument(input: {
  projectId: string; register: RegisterKind; documentId: string;
}): Promise<ActionResult> {
  await requireEdit();
  try {
    const [doc] = await ownedDocuments(input.projectId, input.register, [input.documentId]);
    await db.delete(schema.documents).where(eq(schema.documents.id, doc.id));
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/* ----------------------------------------------------- linking to the WBS */

export interface LinkInput {
  projectId: string;
  nodeId: string;
  categoryId: string;
  on: boolean;
}

export async function setDisciplineLink(input: LinkInput): Promise<ActionResult> {
  await requireEdit();
  try {
    const [leaves, categoryRows] = await Promise.all([
      db.select().from(schema.wbsNodes)
        .where(and(eq(schema.wbsNodes.parentId, input.nodeId), eq(schema.wbsNodes.isLeaf, true))),
      db.select().from(schema.docCategories)
        .where(and(
          eq(schema.docCategories.id, input.categoryId),
          eq(schema.docCategories.projectId, input.projectId),
        )),
    ]);
    if (leaves.length === 0) throw new Error('This discipline has no engineering leaves');
    const category = categoryRows[0];
    if (!category) throw new Error('Register category not found');

    let changed = 0;
    await db.transaction(async (tx) => {
      for (const leaf of leaves) {
        const stage = leaf.deskripsi.trim().toUpperCase().replace('-', '_') as DocStage;
        if (!(STAGE_ORDER as DocStage[]).includes(stage)) continue;

        await tx.update(schema.wbsNodes)
          .set(input.on
            ? { progressMethod: 'linked', linkedCategoryId: category.id, linkedStage: stage }
            : { progressMethod: 'lumpsum', linkedCategoryId: null, linkedStage: null })
          .where(eq(schema.wbsNodes.id, leaf.id));
        changed += 1;
      }
    });

    refreshRegister();
    revalidatePath('/weekly', 'layout');
    return { ok: true, changed };
  } catch (err) {
    return fail(err);
  }
}
