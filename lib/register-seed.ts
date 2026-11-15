/**
 * Rencana tempelan, dituliskan — dalam satu transaksi, atau tidak sama sekali.
 *
 * Terpisah dari `lib/doc-actions.ts` karena berkas itu `'use server'` dan
 * mengimpor `next/cache`, yang tidak bisa dijalankan sebuah script node. Yang di
 * sini murni database, jadi `scripts/verify-register-seed.ts` bisa
 * membuktikannya di atas salinan sementara — termasuk membuktikan bahwa
 * kegagalan tidak meninggalkan setengah register.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { STAGE_ORDER } from './register-shared';
import { parseRegisterPaste, type ColumnMapping, type PasteCategory } from './register-paste';
import type { RegisterKind } from './schema';

export interface SeedInput {
  projectId: string;
  register: RegisterKind;
  text: string;
  mapping?: Partial<ColumnMapping>;
  /**
   * The two sides, only from an import that names them. Setup never sends
   * them: a register's sides are the project's, set in Project details.
   */
  clientName?: string;
  contractorName?: string;
}

/** IFR 0.5 · IFA 0.3 · AFC 0.2 — Gundih's agreement AND Petrogas', so an honest start. */
const DEFAULT_WEIGHT: Partial<Record<string, number>> = { IFR: 50, IFA: 30, AFC: 20 };

/** `General Prosedur` → `GENERAL-PROSEDUR`, and `-2` when that is taken. */
function codeFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'CATEGORY';
  let code = base;
  let n = 2;
  while (taken.has(code)) { code = `${base}-${n}`; n += 1; }
  taken.add(code);
  return code;
}

export interface SeedResult {
  categories: number;
  documents: number;
  /** Rows whose number already existed: title and kind refreshed, nothing moved. */
  updated: number;
}

export async function writeSeed(input: SeedInput): Promise<SeedResult> {
  const plan = parseRegisterPaste(input.text, input.mapping);
  return writeCategories(input, plan.categories);
}

/**
 * A register built section by section, where the structure was CHOSEN rather
 * than written out.
 */
export interface DraftGroup {
  path: string[];
  documents: {
    docNo: string | null;
    title: string;
    /** Doc or Dwg as chosen in the builder; null lets the writer default to Doc. */
    kind?: string | null;
    /** The IFR planned date (ISO), written as that stage's plan. Never marks it sent. */
    planIfr?: string | null;
  }[];
}

/** A document on its way in, as the writer sees it: the paste's shape plus a plan date. */
type SeedDocument = PasteCategory['documents'][number] & { planIfr?: string | null };
type SeedCategory = Omit<PasteCategory, 'documents'> & { documents: SeedDocument[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function writeDraft(
  input: Omit<SeedInput, 'text' | 'mapping'> & { groups: DraftGroup[] },
): Promise<SeedResult> {
  const categories: SeedCategory[] = [];
  for (const group of input.groups) {
    group.path.forEach((name, depth) => {
      categories.push({
        name,
        depth: depth + 1,
        documents: depth === group.path.length - 1
          ? group.documents.map((d) => ({
            docNo: d.docNo, title: d.title, kind: d.kind ?? null, planIfr: d.planIfr ?? null,
          }))
          : [],
      });
    });
  }
  return writeCategories({ ...input, text: '' }, categories, { allowEmpty: true });
}

async function writeCategories(
  input: SeedInput,
  categories: SeedCategory[],
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<SeedResult> {
  const clientName = input.clientName?.trim() ?? '';
  const contractorName = input.contractorName?.trim() ?? '';

  const total = categories.reduce((n, c) => n + c.documents.length, 0);
  if (total === 0 && !allowEmpty) throw new Error('Nothing to add — no documents were given');
  if (categories.length === 0) throw new Error('Nothing to add');

  return db.transaction(async (tx) => {
    if (clientName && contractorName) {
      await tx.update(schema.projects)
        .set({ clientName, contractorName })
        .where(eq(schema.projects.id, input.projectId));
    }

    const existingWeights = await tx.select().from(schema.docStageWeights)
      .where(and(
        eq(schema.docStageWeights.projectId, input.projectId),
        eq(schema.docStageWeights.register, input.register),
      ));
    if (existingWeights.length === 0) {
      await tx.insert(schema.docStageWeights).values(
        STAGE_ORDER.map((stage, order) => ({
          id: randomUUID(),
          projectId: input.projectId,
          register: input.register,
          stage,
          weight: DEFAULT_WEIGHT[stage] ?? 0,
          order,
        })),
      );
    }

    const existing = await tx.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      ));

    const taken = new Set(existing.map((c) => c.code));
    const byKey = new Map(existing.map((c) => [`${c.parentId ?? ''}|${c.name.toLowerCase()}`, c.id]));
    let order = existing.reduce((a, c) => Math.max(a, c.order), -1);

    const byNumber = new Map<string, string[]>();
    for (const row of (await tx.select().from(schema.documents)
      .where(and(
        eq(schema.documents.projectId, input.projectId),
        eq(schema.documents.register, input.register),
      ))).sort((a, b) => a.order - b.order)) {
      if (!row.docNo) continue;
      const queue = byNumber.get(row.docNo) ?? [];
      queue.push(row.id);
      byNumber.set(row.docNo, queue);
    }

    const stack: string[] = [];
    let newCategories = 0;
    let newDocuments = 0;
    let updated = 0;

    for (const category of categories) {
      const parentId = category.depth > 1 ? (stack[category.depth - 2] ?? null) : null;
      const key = `${parentId ?? ''}|${category.name.toLowerCase()}`;
      let id = byKey.get(key);

      if (!id) {
        id = randomUUID();
        order += 1;
        await tx.insert(schema.docCategories).values({
          id,
          projectId: input.projectId,
          register: input.register,
          parentId,
          code: codeFor(category.name, taken),
          name: category.name,
          order,
        });
        byKey.set(key, id);
        newCategories += 1;
      }

      stack.length = Math.min(stack.length, category.depth - 1);
      stack[category.depth - 1] = id;

      const siblings = await tx.select().from(schema.documents)
        .where(eq(schema.documents.categoryId, id));
      let docOrder = siblings.reduce((a, d) => Math.max(a, d.order), -1);

      for (const doc of category.documents) {
        const existingId = doc.docNo ? byNumber.get(doc.docNo)?.shift() : undefined;
        if (existingId) {
          await tx.update(schema.documents)
            .set({ title: doc.title, kind: doc.kind ?? 'Doc' })
            .where(eq(schema.documents.id, existingId));
          updated += 1;
          continue;
        }

        docOrder += 1;
        const newId = randomUUID();
        await tx.insert(schema.documents).values({
          id: newId,
          projectId: input.projectId,
          register: input.register,
          categoryId: id,
          docNo: doc.docNo,
          title: doc.title,
          kind: doc.kind ?? 'Doc',
          order: docOrder,
        });
        newDocuments += 1;

        if (doc.planIfr && ISO_DATE.test(doc.planIfr)) {
          await tx.insert(schema.docStages).values({
            id: randomUUID(),
            documentId: newId,
            stage: 'IFR',
            order: STAGE_ORDER.indexOf('IFR'),
            planSubmitDate: doc.planIfr,
            submitted: false,
          });
        }
      }
    }

    return { categories: newCategories, documents: newDocuments, updated };
  });
}
