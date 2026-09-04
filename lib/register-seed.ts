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

import { db, schema } from './sqlite';
import { STAGE_ORDER } from './register-shared';
import { parseRegisterPaste, type ColumnMapping } from './register-paste';
import type { RegisterKind } from './schema';

export interface SeedInput {
  projectId: string;
  register: RegisterKind;
  text: string;
  mapping?: Partial<ColumnMapping>;
  clientName: string;
  contractorName: string;
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

export function writeSeed(input: SeedInput): { categories: number; documents: number } {
  const clientName = input.clientName.trim();
  const contractorName = input.contractorName.trim();
  if (!clientName) throw new Error('Client name is required');
  if (!contractorName) throw new Error('Contractor name is required');

  const plan = parseRegisterPaste(input.text, input.mapping);
  if (plan.counts.documents === 0) throw new Error('Nothing to add — the list has no documents');

  return db.transaction((tx) => {
    tx.update(schema.projects)
      .set({ clientName, contractorName })
      .where(eq(schema.projects.id, input.projectId))
      .run();

    const existingWeights = tx.select().from(schema.docStageWeights)
      .where(and(
        eq(schema.docStageWeights.projectId, input.projectId),
        eq(schema.docStageWeights.register, input.register),
      )).all();
    if (existingWeights.length === 0) {
      tx.insert(schema.docStageWeights).values(
        STAGE_ORDER.map((stage, order) => ({
          id: randomUUID(),
          projectId: input.projectId,
          register: input.register,
          stage,
          // A resubmission carries no weight: it is evidence of how many times a
          // drawing went round, not progress on top of the round before it.
          weight: DEFAULT_WEIGHT[stage] ?? 0,
          order,
        })),
      ).run();
    }

    const existing = tx.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all();

    const taken = new Set(existing.map((c) => c.code));
    const byKey = new Map(existing.map((c) => [`${c.parentId ?? ''}|${c.name.toLowerCase()}`, c.id]));
    let order = existing.reduce((a, c) => Math.max(a, c.order), -1);

    const stack: string[] = [];
    let newCategories = 0;
    let newDocuments = 0;

    for (const category of plan.categories) {
      const parentId = category.depth > 1 ? (stack[category.depth - 2] ?? null) : null;
      const key = `${parentId ?? ''}|${category.name.toLowerCase()}`;
      let id = byKey.get(key);

      if (!id) {
        id = randomUUID();
        order += 1;
        tx.insert(schema.docCategories).values({
          id,
          projectId: input.projectId,
          register: input.register,
          parentId,
          code: codeFor(category.name, taken),
          name: category.name,
          order,
        }).run();
        byKey.set(key, id);
        newCategories += 1;
      }

      stack.length = Math.min(stack.length, category.depth - 1);
      stack[category.depth - 1] = id;

      const siblings = tx.select().from(schema.documents)
        .where(eq(schema.documents.categoryId, id)).all();
      let docOrder = siblings.reduce((a, d) => Math.max(a, d.order), -1);

      for (const doc of category.documents) {
        docOrder += 1;
        tx.insert(schema.documents).values({
          id: randomUUID(),
          projectId: input.projectId,
          register: input.register,
          categoryId: id,
          docNo: doc.docNo,
          title: doc.title,
          kind: doc.kind ?? 'Doc',
          order: docOrder,
        }).run();
        newDocuments += 1;
      }
    }

    return { categories: newCategories, documents: newDocuments };
  });
}
