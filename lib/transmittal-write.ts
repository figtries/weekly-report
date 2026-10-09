/**
 * Writing a stage, and a whole transmittal, without Next.
 *
 * One letter usually carries many documents, and until 3 Oct 2026 each had to
 * be given the same date and the same letter number by hand. `writeTransmittal`
 * records the letter once for every document in it; `writeStage` is the one
 * place a stage row is upserted, shared with the editor's `saveStage`, so the
 * two ways of recording the same fact cannot drift apart.
 *
 * Imports nothing from Next, so `scripts/verify-transmittal.ts` can prove it.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { isStageKey, stageRank } from './register-shared';
import { planStatus, type StatusWhere } from './register-status';
import type { DocStage, RegisterKind } from './schema';

type StageRow = typeof schema.docStages.$inferInsert;
type Writer = Pick<typeof db, 'select' | 'update' | 'insert'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODES = new Set(['APP', 'AWC', 'RWC']);

/** The transmittal with this number and direction, created the first time it is named. */
export function transmittalId(
  projectId: string,
  register: RegisterKind,
  no: string,
  direction: 'out' | 'in',
  date: string,
  conn: Writer = db,
): string | null {
  const trimmed = no.trim();
  if (!trimmed) return null;

  const existing = conn.select().from(schema.transmittals)
    .where(and(
      eq(schema.transmittals.projectId, projectId),
      eq(schema.transmittals.register, register),
      eq(schema.transmittals.no, trimmed),
      eq(schema.transmittals.direction, direction),
    )).all()[0];
  if (existing) return existing.id;

  const id = randomUUID();
  conn.insert(schema.transmittals).values({ id, projectId, register, no: trimmed, direction, date }).run();
  return id;
}

/** Upsert one stage of one document. Fields not in `patch` are left as they are. */
export function writeStage(
  tx: Writer,
  documentId: string,
  stage: DocStage,
  patch: Partial<Omit<StageRow, 'id' | 'documentId' | 'stage' | 'order'>>,
): void {
  const existing = tx.select().from(schema.docStages)
    .where(and(eq(schema.docStages.documentId, documentId), eq(schema.docStages.stage, stage)))
    .all()[0];
  if (existing) {
    tx.update(schema.docStages).set(patch).where(eq(schema.docStages.id, existing.id)).run();
  } else {
    tx.insert(schema.docStages).values({
      id: randomUUID(),
      documentId,
      stage,
      order: stageRank(stage),
      submitted: false,
      ...patch,
    }).run();
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
  /** Replace what is already recorded. Without it, anything replaced comes back as `confirm`. */
  confirmed: boolean;
}

/**
 * A status set directly (lib/register-status.ts), in one transaction. Read from
 * the DATABASE, not from the card on screen: a card shown as of an old week
 * does not carry what was recorded since, and that is exactly what a change
 * would clear.
 */
export function writeDocumentStatus(input: StatusInput): { written: number } | { confirm: string[] } {
  if (!ISO_DATE.test(input.date)) throw new Error('Pick a date first');
  const code = input.where === 'us' ? (input.code?.trim().toUpperCase() || null) : null;
  if (code && !CODES.has(code)) throw new Error(`Unknown code ${code}`);
  const doc = db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.id, input.documentId),
      eq(schema.documents.projectId, input.projectId),
      eq(schema.documents.register, input.register),
    )).all()[0];
  if (!doc) throw new Error('That document is not in this register');

  const rows = db.select().from(schema.docStages).where(eq(schema.docStages.documentId, doc.id)).all();
  const { writes, overwrites } = planStatus(rows, { stage: input.stage, where: input.where, code, date: input.date, letter: input.letter.trim() });
  if (overwrites.length > 0 && !input.confirmed) return { confirm: overwrites };

  db.transaction((tx) => {
    for (const w of writes) {
      const link = (no: string | null | undefined, dir: 'out' | 'in', day: string | null) =>
        no === undefined ? undefined : no === null ? null : transmittalId(input.projectId, input.register, no, dir, day ?? input.date, tx);
      const out = link(w.submitLetter, 'out', w.submittedAt);
      const back = link(w.returnLetter, 'in', w.returnedAt);
      writeStage(tx, doc.id, w.stage, {
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
  /** Out: we sent these. In: they came back, each with its code. */
  direction: 'out' | 'in';
  date: string;
  letter: string;
  items: { documentId: string; stage: string; code?: string }[];
}

/**
 * Record one letter for every document in it, in one transaction: either the
 * whole letter is written or none of it is.
 *
 * Out marks each stage sent on the date under the letter. In records the date,
 * the letter and each document's code, and refuses a stage that never went
 * out: a reply to nothing is a typing mistake, not a fact.
 */
export function writeTransmittal(input: TransmittalInput): number {
  const letter = input.letter.trim();
  if (!letter) throw new Error('The letter number is required');
  if (!ISO_DATE.test(input.date)) throw new Error('The date is not a date');
  if (input.items.length === 0) throw new Error('Tick at least one document');

  const ids = [...new Set(input.items.map((i) => i.documentId))];
  const docs = db.select().from(schema.documents)
    .where(and(
      eq(schema.documents.projectId, input.projectId),
      eq(schema.documents.register, input.register),
      inArray(schema.documents.id, ids),
    )).all();
  if (docs.length !== ids.length) throw new Error('A ticked document is not in this register');
  const nameOf = new Map(docs.map((d) => [d.id, d.docNo || d.title]));

  for (const item of input.items) {
    if (!isStageKey(item.stage)) throw new Error(`${item.stage} is not a stage`);
    if (input.direction === 'in' && !CODES.has((item.code ?? '').trim().toUpperCase())) {
      throw new Error(`Choose a return code for ${nameOf.get(item.documentId)}`);
    }
  }

  return db.transaction((tx) => {
    const letterId = transmittalId(input.projectId, input.register, letter, input.direction, input.date, tx);
    for (const item of input.items) {
      const stage = item.stage as DocStage;
      if (input.direction === 'out') {
        writeStage(tx, item.documentId, stage, {
          submitted: true, submittedAt: input.date, submitTransmittalId: letterId,
        });
        continue;
      }
      const row = tx.select().from(schema.docStages)
        .where(and(eq(schema.docStages.documentId, item.documentId), eq(schema.docStages.stage, stage)))
        .all()[0];
      if (!row?.submitted) throw new Error(`${nameOf.get(item.documentId)} ${stage} was never sent`);
      writeStage(tx, item.documentId, stage, {
        returnedAt: input.date,
        returnTransmittalId: letterId,
        returnCode: (item.code ?? '').trim().toUpperCase(),
      });
    }
    return input.items.length;
  });
}
