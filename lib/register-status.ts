import { baseOfAdded, stageLabel, stageRank } from './register-shared';
import type { DocStage } from './schema';

/**
 * A document's status SET DIRECTLY (9 Oct 2026): which stage, and who has it.
 *
 * Before this, a status could only be reached by recording letters: sent, came
 * back with a code, sent again. Moving a drawing from IFA to AFC meant three
 * entries and a pop-up. He asked for the plain version: "statusnya di client
 * atau di kita, statusnya apa IFA, AFC". This turns that answer into the stage
 * rows the register already reads, so every figure keeps its one origin.
 *
 *   them            the stage went out on `date`, no reply yet
 *   us + code       the stage came back on `date` with that code
 *   us, no code     the stage is being prepared: it has not gone out
 *
 * Anything recorded after the chosen point is cleared, because a status that
 * says "IFA with the client" cannot sit under an AFC that already went out.
 * Every recorded fact the change would replace is listed in `overwrites`, so
 * the screen asks before it writes ("udh ada datanya mau diubah kah?").
 */

export type StatusWhere = 'us' | 'them';

export interface StatusTarget {
  /** A main stage: IFR, IFA or AFC. Its resubmissions are found here. */
  stage: DocStage;
  where: StatusWhere;
  /** Only with `us`: the reply it came back with. */
  code: string | null;
  /** YYYY-MM-DD. */
  date: string;
  /** The letter, if somebody has its number. */
  letter: string;
}

export interface StageFacts {
  stage: DocStage;
  submitted: boolean;
  submittedAt: string | null;
  returnedAt: string | null;
  returnCode: string | null;
}

export interface StageWrite {
  stage: DocStage;
  submitted: boolean;
  submittedAt: string | null;
  /** A letter number to name; null clears the link; undefined keeps it. */
  submitLetter: string | null | undefined;
  returnedAt: string | null;
  returnLetter: string | null | undefined;
  returnCode: string | null;
}

/** A stage and the resubmissions that belong to it, in order. */
const CHAIN: Partial<Record<DocStage, DocStage[]>> = {
  IFR: ['IFR', 'RE_IFR'],
  IFA: ['IFA', 'RE_IFA'],
  AFC: ['AFC', 'RE_AFC1', 'RE_AFC2'],
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const has = (r: StageFacts | undefined) => Boolean(r && (r.submitted || r.submittedAt || r.returnedAt || r.returnCode));

const CLEAR = { submitted: false, submittedAt: null, submitLetter: null, returnedAt: null, returnLetter: null, returnCode: null };

export function planStatus(rows: StageFacts[], t: StatusTarget, label: (s: DocStage) => string = stageLabel) {
  const added = baseOfAdded(t.stage);
  const chain = CHAIN[t.stage] ?? (added ? [added, `RE_${added}` as DocStage] : [t.stage]);
  const at = new Map(rows.map((r) => [r.stage, r]));
  const last = chain.filter((s) => has(at.get(s))).at(-1);
  const lastRow = last ? at.get(last) : undefined;

  let target: DocStage;
  let write: Omit<StageWrite, 'stage'>;
  if (t.where === 'them') {
    // Sent again after a "revise and resubmit": that is the next round, not the same one.
    const next = last && lastRow?.returnCode === 'RWC' && lastRow.returnedAt ? chain[chain.indexOf(last) + 1] : undefined;
    target = next ?? last ?? t.stage;
    write = { submitted: true, submittedAt: t.date, submitLetter: t.letter || undefined, returnedAt: null, returnLetter: null, returnCode: null };
  } else if (t.code) {
    target = last ?? t.stage;
    write = {
      submitted: true,
      // Came back with no send on record: it went out the same day, as far as anyone wrote down.
      submittedAt: at.get(target)?.submittedAt ?? t.date,
      submitLetter: undefined,
      returnedAt: t.date,
      returnLetter: t.letter || undefined,
      returnCode: t.code,
    };
  } else {
    // Being prepared: nothing of this stage has gone out.
    target = t.stage;
    write = { ...CLEAR };
  }

  const writes: StageWrite[] = [{ stage: target, ...write }];
  // Every recorded stage after the target, added ones included.
  for (const r of rows) if (stageRank(r.stage) > stageRank(target) && has(r)) writes.push({ stage: r.stage, ...CLEAR });
  writes.sort((a, b) => stageRank(a.stage) - stageRank(b.stage));

  const overwrites: string[] = [];
  for (const w of writes) {
    const r = at.get(w.stage);
    if (!r || !has(r)) continue;
    const name = label(w.stage);
    if (r.submittedAt && r.submittedAt !== w.submittedAt) overwrites.push(`${name} sent ${day(r.submittedAt)}`);
    if (r.returnedAt && r.returnedAt !== w.returnedAt) overwrites.push(`${name} back ${day(r.returnedAt)}${r.returnCode ? ` (${r.returnCode})` : ''}`);
    else if (r.returnCode && r.returnCode !== w.returnCode) overwrites.push(`${name} code ${r.returnCode}`);
  }
  return { writes, overwrites };
}

/* ponytail: inline self-check, `npx tsx lib/register-status.ts` */
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('register-status.ts')) {
  const row = (stage: DocStage, p: Partial<StageFacts>): StageFacts => ({ stage, submitted: true, submittedAt: null, returnedAt: null, returnCode: null, ...p });
  const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
  const ifrBack = [row('IFR', { submittedAt: '2026-05-01', returnedAt: '2026-05-10', returnCode: 'AWC' })];

  let p = planStatus(ifrBack, { stage: 'IFA', where: 'them', code: null, date: '2026-06-01', letter: 'T-1' });
  eq(p.writes.map((w) => [w.stage, w.submittedAt, w.submitLetter]), [['IFA', '2026-06-01', 'T-1']], 'send IFA');
  eq(p.overwrites, [], 'send IFA replaces nothing');

  const rwc = [...ifrBack, row('IFA', { submittedAt: '2026-06-01', returnedAt: '2026-06-10', returnCode: 'RWC' })];
  p = planStatus(rwc, { stage: 'IFA', where: 'them', code: null, date: '2026-06-20', letter: '' });
  eq(p.writes.map((w) => w.stage), ['RE_IFA'], 'resubmit goes to RE_IFA');

  const far = [...rwc, row('AFC', { submittedAt: '2026-07-01' })];
  p = planStatus(far, { stage: 'IFR', where: 'us', code: 'APP', date: '2026-05-10', letter: '' });
  eq(p.writes.map((w) => w.stage), ['IFR', 'IFA', 'AFC'], 'moving back clears later stages');
  eq(p.overwrites.length, 4, 'names IFR code, IFA sent + back, AFC sent');

  p = planStatus([], { stage: 'IFR', where: 'us', code: 'APP', date: '2026-05-10', letter: '' });
  eq([p.writes[0].submittedAt, p.writes[0].returnedAt], ['2026-05-10', '2026-05-10'], 'code without send');

  p = planStatus(far, { stage: 'IFA', where: 'us', code: null, date: '2026-06-01', letter: '' });
  eq(p.writes.map((w) => w.stage), ['IFA', 'AFC'], 'prepare IFA clears IFA and after');
  console.log('register-status ok');
}
