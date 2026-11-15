/**
 * Writing a stage, and a whole transmittal, without Next.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { db, type Db } from './pg';
import * as schema from './schema';
import { codeAct, isStageKey, stageRank } from './register-shared';
import { planStatus, type StatusWhere } from './register-status';
import type { DocStage, RegisterKind } from './schema';

type StageRow = typeof schema.docStages.$inferInsert;
type Writer = Pick<Db, 'select' | 'update' | 'insert'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODES = { has: (c: string) => codeAct(c) !== null };

export async function transmittalId(
  projectId: string,
  register: RegisterKind,
  no: string,
  direction: 'out' | 'in',
  date: string,
  conn: Writer = db,
): Promise<string | null> {
  const trimmed = no.trim();
  if (!trimmed) return null;

  const rows = await conn.select().from(schema.transmittals)
    .where(and(
      eq(schema.transmittals.projectId, projectId),
      eq(schema.transmittals.register, register),
      eq(schema.transmittals.no, trimmed),
      eq(schema.transmittals.direction, direction),
    ));
  if (rows[0]) return rows[0].id;

  const id = randomUUID();
  await conn.insert(schema.transmittals).values({ id, projectId, register, no: trimmed, direction, date });
  return id;
}

export async function writeStage(
  tx: Writer,
  documentId: string,
  stage: DocStage,
  patch: Partial<Omit<StageRow, 'id' | 'documentId' | 'stage' | 'order'>>,
): Promise<void> {
  const rows = await tx.select().from(schema.docStages)
    .where(and(eq(schema.docStages.documentId, documentId), eq(schema.docStages.stage, stage)));
  const existing = rows[0];
  if (existing) {
    await tx.update(schema.docStages).set(patch).where(eq(schema.docStages.id, existing.id));
  } else {
    await tx.insert(schema.docStages).values({
      id: randomUUID(),
      documentId,
      stage,
      order: stageRank(stage),
      submitted: false,
      ...patch,
    });
  }
}

export interface StatusInput {
  projectId: string;
  register: RegisterKind;
  documentId: string;
  stage: DocStage;
  where: StatusWhere;
  code: string | null;
  date: string;
  letter: string;
  confirmed: boolean;
}

export async function writeDocumentStatus(input: StatusInput): Promise<{ written: number } | { confirm: string[] }> {
  if (!ISO_DATE.test(input.date)) throw new Error('Pick a date first');
  const code = input.where === 'us' ? (input.code?.trim().toUpperCase() || null) : null;
  if (code && !CODES.has(code)) throw new Error(`Unknown code ${code}`);
  const docRows = await db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.id, input.documentId),
      eq(schema.documents.projectId, input.projectId),
      eq(schema.documents.register, input.register),
    ));
  const doc = docRows[0];
  if (!doc) throw new Error('That document is not in this register');

  const rows = await db.select().from(schema.docStages).where(eq(schema.docStages.documentId, doc.id));
  const { writes, overwrites } = planStatus(rows, { stage: input.stage, where: input.where, code, date: input.date, letter: input.letter.trim() });
  if (overwrites.length > 0 && !input.confirmed) return { confirm: overwrites };

  await db.transaction(async (tx) => {
    for (const w of writes) {
      const link = async (no: string | null | undefined, dir: 'out' | 'in', day: string | null) =>
        no === undefined ? undefined : no === null ? null : transmittalId(input.projectId, input.register, no, dir, day ?? input.date, tx);
      const out = await link(w.submitLetter, 'out', w.submittedAt);
      const back = await link(w.returnLetter, 'in', w.returnedAt);
      await writeStage(tx, doc.id, w.stage, {
        submitted: w.submitted,
        submittedAt: w.submittedAt,
        returnedAt: w.returnedAt,
        returnCode: w.returnCode,
        ...(out !== undefined ? { submitTransmittalId: out } : {}),
        ...(back !== undefined ? { returnTransmittalId: back } : {}),
      });
    }
  });
  return { written: writes.length };
}

export interface TransmittalInput {
  projectId: string;
  register: RegisterKind;
  direction: 'out' | 'in';
  date: string;
  letter: string;
  items: { documentId: string; stage: string; code?: string }[];
}

export async function writeTransmittal(input: TransmittalInput): Promise<number> {
  const letter = input.letter.trim();
  if (!letter) throw new Error('The letter number is required');
  if (!ISO_DATE.test(input.date)) throw new Error('The date is not a date');
  if (input.items.length === 0) throw new Error('Tick at least one document');

  const ids = [...new Set(input.items.map((i) => i.documentId))];
  const docs = await db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.projectId, input.projectId),
      eq(schema.documents.register, input.register),
      inArray(schema.documents.id, ids),
    ));
  if (docs.length !== ids.length) throw new Error('A ticked document is not in this register');
  const nameOf = new Map(docs.map((d) => [d.id, d.docNo || d.title]));

  for (const item of input.items) {
    if (!isStageKey(item.stage)) throw new Error(`${item.stage} is not a stage`);
    if (input.direction === 'in' && !CODES.has((item.code ?? '').trim().toUpperCase())) {
      throw new Error(`Choose a return code for ${nameOf.get(item.documentId)}`);
    }
  }

  return db.transaction(async (tx) => {
    const letterId = await transmittalId(input.projectId, input.register, letter, input.direction, input.date, tx);
    for (const item of input.items) {
      const stage = item.stage as DocStage;
      if (input.direction === 'out') {
        await writeStage(tx, item.documentId, stage, {
          submitted: true, submittedAt: input.date, submitTransmittalId: letterId,
        });
        continue;
      }
      const stageRows = await tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, item.documentId), eq(schema.docStages.stage, stage)));
      const row = stageRows[0];
      if (!row?.submitted) throw new Error(`${nameOf.get(item.documentId)} ${stage} was never sent`);
      await writeStage(tx, item.documentId, stage, {
        returnedAt: input.date,
        returnTransmittalId: letterId,
        returnCode: (item.code ?? '').trim().toUpperCase(),
      });
    }
    return input.items.length;
  });
}
