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
import { parseRegisterPaste, type ColumnMapping, type PasteCategory } from './register-paste';
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

export interface SeedResult {
  categories: number;
  documents: number;
  /** Rows whose number already existed: title and kind refreshed, nothing moved. */
  updated: number;
}

export function writeSeed(input: SeedInput): SeedResult {
  const plan = parseRegisterPaste(input.text, input.mapping);
  return writeCategories(input, plan.categories);
}

/**
 * A register built section by section, where the structure was CHOSEN rather
 * than written out.
 *
 * Each group carries its own path — `['DETAIL ENGINEERING', 'ELECTRICAL',
 * 'Electrical Datasheet']` — so the same writer that handles a pasted sheet
 * handles this: a path becomes one category per level, and the documents hang
 * off the last. Nothing about grouping has to be expressed in text, which is
 * the whole point of picking a section by clicking it.
 */
export interface DraftGroup {
  path: string[];
  documents: { docNo: string | null; title: string }[];
}

export function writeDraft(
  input: Omit<SeedInput, 'text' | 'mapping'> & { groups: DraftGroup[] },
): SeedResult {
  const categories: PasteCategory[] = [];
  for (const group of input.groups) {
    if (group.documents.length === 0) continue;
    group.path.forEach((name, depth) => {
      categories.push({
        name,
        depth: depth + 1,
        documents: depth === group.path.length - 1
          ? group.documents.map((d) => ({ docNo: d.docNo, title: d.title, kind: null }))
          : [],
      });
    });
  }
  return writeCategories({ ...input, text: '' }, categories);
}

function writeCategories(input: SeedInput, categories: PasteCategory[]): SeedResult {
  const clientName = input.clientName.trim();
  const contractorName = input.contractorName.trim();
  if (!clientName) throw new Error('Client name is required');
  if (!contractorName) throw new Error('Contractor name is required');

  const total = categories.reduce((n, c) => n + c.documents.length, 0);
  if (total === 0) throw new Error('Nothing to add — no documents were given');

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

    /**
     * A numbered document that is already here is the SAME document.
     *
     * Without this, importing next month's revision of the same EDL — or
     * pasting the list twice by accident — would leave two of everything, and
     * the second copy would carry none of the dates and transmittals typed
     * against the first. So a matching number refreshes the title and kind and
     * nothing else: the row keeps its id, its group and its whole history.
     *
     * Documents with no number cannot be matched and are always added. That is
     * the honest reading — the VDRL has 115 of them and nothing distinguishes
     * one from another except the order they were written in.
     *
     * Each number holds a QUEUE, not a single row, and a match consumes one.
     * The Petrogas EDL uses `WPP-IN-LAY-003` for two genuinely different
     * drawings; matching both to the first row would quietly overwrite one of
     * them, and refusing the second would drop it. Queued, a re-import of the
     * same file updates the first with the first and the second with the
     * second, and neither is invented or lost.
     */
    const byNumber = new Map<string, string[]>();
    for (const row of tx.select().from(schema.documents)
      .where(and(
        eq(schema.documents.projectId, input.projectId),
        eq(schema.documents.register, input.register),
      )).all().sort((a, b) => a.order - b.order)) {
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
        const existingId = doc.docNo ? byNumber.get(doc.docNo)?.shift() : undefined;
        if (existingId) {
          tx.update(schema.documents)
            .set({ title: doc.title, kind: doc.kind ?? 'Doc' })
            .where(eq(schema.documents.id, existingId))
            .run();
          updated += 1;
          continue;
        }

        docOrder += 1;
        const newId = randomUUID();
        tx.insert(schema.documents).values({
          id: newId,
          projectId: input.projectId,
          register: input.register,
          categoryId: id,
          docNo: doc.docNo,
          title: doc.title,
          kind: doc.kind ?? 'Doc',
          order: docOrder,
        }).run();
        // Deliberately NOT registered in the queue: a number repeated inside
        // one list is two documents that happen to share it, not the same one
        // twice. See the comment on `byNumber`.
        newDocuments += 1;
      }
    }

    return { categories: newCategories, documents: newDocuments, updated };
  });
}
