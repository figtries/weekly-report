/**
 * The register's vocabulary: its shapes, its stage chain, and the two helpers
 * that go with them.
 *
 * Split out of `lib/register.ts` because the working screens are client
 * components and need these — importing them from the query module would drag
 * better-sqlite3 into the browser bundle, which fails the build rather than
 * merely bloating it.
 */
import type { DocStage, RegisterKind } from './schema';

/* ----------------------------------------------------------------- types */

export interface StageReach {
  stage: DocStage;
  weight: number;
  reached: number;
}

export interface WeekPoint {
  weekNo: number;
  endDate: string;
  /** Weighted percent of the register, 0..100. */
  actual: number;
  /** Null where the register carries no plan dates at all — the VDRL's case. */
  plan: number | null;
}

/** How a category is doing against what it promised. */
export type Trend = 'ahead' | 'on-track' | 'slipping' | 'behind' | 'unplanned';

export interface RegisterNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  depth: number;
  documents: number;
  reached: StageReach[];
  actual: number;
  plan: number | null;
  deviation: number | null;
  trend: Trend;
  /** Never went out at any stage. The VDRL's headline number. */
  untouched: number;
  /** Came back with a comment and has not been approved since. */
  returnedOpen: number;
  /** Promised by the as-of date and still not submitted. */
  overdue: number;
  children: RegisterNode[];
}

export interface RegisterSummary {
  register: RegisterKind;
  documents: number;
  numbered: number;
  categories: number;
  transmittals: number;
  stages: StageReach[];
  /** Weighted percent of the whole register. */
  actual: number;
  plan: number | null;
  deviation: number | null;
  /** The rise over the as-of week — computed, not carried over from last week. */
  thisWeek: number;
  asOfWeek: number;
  asOfDate: string;
  /** The last week anything actually happened, whatever week is being viewed. */
  evidenceWeek: number;
  evidenceDate: string;
  series: WeekPoint[];
  untouched: number;
  returnedOpen: number;
  overdue: number;
  /** Submissions the register marks without a date — placed on the curve by estimate. */
  undated: number;
}

export type ObstacleKind = 'returned' | 'overdue' | 'untouched';

export interface Obstacle {
  documentId: string;
  docNo: string | null;
  title: string;
  /** The group it sits in, so the workbench can jump straight to it. */
  categoryId: string;
  categoryName: string;
  kind: ObstacleKind;
  stage: DocStage | null;
  returnCode: string | null;
  /** The date the clock started: returned, or promised. */
  since: string | null;
  /** Days between that date and the register's as-of date. */
  days: number | null;
}

export interface LogEvent {
  at: string;
  /** False where the register recorded the event but not its date. */
  dated: boolean;
  kind: 'submit' | 'return';
  documentId: string;
  docNo: string | null;
  title: string;
  categoryName: string;
  stage: DocStage;
  transmittal: string | null;
  returnCode: string | null;
}

export interface DocumentStageDetail {
  stage: DocStage;
  planSubmitDate: string | null;
  submitted: boolean;
  submittedAt: string | null;
  submitTransmittal: string | null;
  returnedAt: string | null;
  returnTransmittal: string | null;
  returnCode: string | null;
  /** Days from submission to return, or from submission to the as-of date. */
  waiting: number | null;
}

/**
 * How one trip to the reviewer ended.
 *
 * `returned` is the one that costs money: it came back carrying a comment and
 * is holding construction up until it goes round again.
 *
 * `unrecorded` is the honest name for a trip that was sent, has no return
 * written against it, and has been OVERTAKEN — a later stage has since gone
 * out, so the document plainly came back and nobody wrote down when. It is
 * kept separate from `waiting` because conflating the two lies twice over:
 * PRGG-20-E0-DS-003 is a finished document whose IFR row has no return date,
 * and calling that "still out, 253 days" both invents a delay and, once those
 * days are summed, double-counts a period the next stage already covers.
 */
export type LapOutcome = 'approved' | 'returned' | 'waiting' | 'unrecorded';

/** One trip out and (maybe) back, ready to draw. */
export interface DocumentLap {
  stage: DocStage;
  outcome: LapOutcome;
  sentAt: string | null;
  sentTransmittal: string | null;
  returnedAt: string | null;
  returnTransmittal: string | null;
  returnCode: string | null;
  /** Days it was with the reviewer — closed, or still running at the as-of date. */
  days: number | null;
  /** The register recorded the trip but not when it happened. */
  undated: boolean;
}

/**
 * A document's history, folded out of the stage rows it is already stored as.
 *
 * This is what used to be the Log screen. That screen listed 511 raw events
 * newest-first across both registers, which meant one document's three trips
 * appeared as three near-identical cards, usually side by side, differing only
 * by one small badge — 173 documents printed as 511 cards down 54,718 pixels of
 * page. The events were never the unit anyone reads; the DOCUMENT is, and a
 * document's history belongs on the document.
 *
 * A stage with no submission and no return never happened, so it is not a trip
 * and is left out. What remains is in stage order, which is chronological by
 * construction: nothing reaches IFA before it has been through IFR.
 */
export function buildJourney(stages: DocumentStageDetail[]): DocumentLap[] {
  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const laps: DocumentLap[] = [];

  for (const stage of STAGE_ORDER) {
    const row = byStage.get(stage);
    if (!row || (!row.submitted && !row.returnCode && !row.returnedAt)) continue;

    const closed = Boolean(row.returnedAt || row.returnCode);
    laps.push({
      stage,
      // Provisional: any open trip is `waiting` here, and the pass below
      // demotes the ones a later stage has overtaken.
      outcome: closed ? (isApproved(row.returnCode) ? 'approved' : 'returned') : 'waiting',
      sentAt: row.submittedAt,
      sentTransmittal: row.submitTransmittal,
      returnedAt: row.returnedAt,
      returnTransmittal: row.returnTransmittal,
      returnCode: row.returnCode,
      days: row.waiting,
      // The Gundih register marks 44 submissions without a date. Saying so is
      // the point: a delay argument built on a date nobody wrote down is one
      // the other side gets to throw out.
      undated: row.submitted && !row.submittedAt,
    });
  }

  // Only the LAST trip can still be with the reviewer. Anything open before it
  // was overtaken by the stage that followed, so its missing return is a gap in
  // the record rather than a document sitting on someone's desk.
  for (let i = 0; i < laps.length - 1; i += 1) {
    if (laps[i].outcome === 'waiting') laps[i].outcome = 'unrecorded';
  }

  return laps;
}


/** A document as the working screen needs it — history included. */
export interface DocumentCard {
  id: string;
  categoryId: string;
  docNo: string | null;
  title: string;
  revision: string | null;
  percent: number;
  /** The furthest stage it has actually reached. */
  stage: DocStage | null;
  /** The last return code, only while it is still open. */
  returnCode: string | null;
  /** Days it has been sitting with the reviewer. */
  waiting: number | null;
  nextStage: DocStage | null;
  plannedAt: string | null;
  overdue: boolean;
  laps: number;
  stages: DocumentStageDetail[];
}

export interface LinkStage {
  nodeId: string;
  stage: DocStage;
  linked: boolean;
  /** What the WBS says today, at its latest recorded week. */
  wbsPercent: number;
  /** What the register says, as of its own date. */
  registerPercent: number;
}

/** One document that moved inside the week being viewed. */
export interface Movement {
  documentId: string;
  docNo: string | null;
  title: string;
  categoryName: string;
  stage: DocStage;
  kind: 'submitted' | 'returned' | 'approved';
  returnCode: string | null;
  at: string;
}

/**
 * What actually happened in one week, counted from the dates.
 *
 * The summary used to say `+0.00 this week` and stop, which tells a reader
 * nothing about whether the week was quiet or the file is simply stale. These
 * are the three events a document controller chases, plus the honest reason
 * when all three are zero.
 */
export interface WeekMovement {
  weekNo: number;
  startDate: string;
  endDate: string;
  submitted: number;
  returned: number;
  approved: number;
  /** Percentage points the register gained over the week. */
  gain: number;
  /** The newest movements first, for the short list on the summary. */
  events: Movement[];
  /** The last week anything moved at all — below weekNo means the file is stale. */
  evidenceWeek: number;
  evidenceDate: string;
}

/**
 * The seam between this register and the weekly report.
 *
 * Both screens describe the same engineering work, so each one carries a band
 * pointing at the other with the other's own figure on it. Reading one and
 * being surprised by the other is exactly what this feature exists to stop.
 */
export interface EngineeringBridge {
  /** The week both sides are being read at. */
  weekNo: number;
  /** The last week the weekly report was actually filled in. */
  wbsWeek: number | null;
  /** Weighted percent the weekly report carries for the engineering leaves. */
  typedPercent: number;
  /** Weighted percent the register counts for the same work. */
  registerPercent: number;
  disciplines: number;
  /** How many of them already take their figure from the register. */
  linked: number;
  documents: number;
}

export interface DisciplineLink {
  nodeId: string;
  name: string;
  /** The last week the WBS was actually reported for — 43 in Gundih, not 60. */
  wbsWeek: number | null;
  categoryId: string | null;
  categoryName: string | null;
  bobot: number;
  stages: LinkStage[];
}

/* ------------------------------------------------------------- constants */

export const STAGE_ORDER: DocStage[] =
  ['IFR', 'RE_IFR', 'IFA', 'RE_IFA', 'AFC', 'RE_AFC1', 'RE_AFC2', 'ASBUILT'];

export const STAGE_LABEL: Record<DocStage, string> = {
  IFR: 'IFR', RE_IFR: 'RE-IFR', IFA: 'IFA', RE_IFA: 'RE-IFA',
  AFC: 'AFC', RE_AFC1: 'RE-AFC 1', RE_AFC2: 'RE-AFC 2', ASBUILT: 'AS-BUILT',
};

/**
 * What the acronym stands for.
 *
 * The abbreviations are what a document controller says out loud, but they are
 * also the first thing that stops everyone else reading this screen. Anywhere
 * a stage is the subject of a line, the full name leads and the acronym
 * follows; in a dense list where the reader has already met it, STAGE_LABEL
 * alone is enough.
 */
export const STAGE_FULL: Record<DocStage, string> = {
  IFR: 'Issued for Review',
  RE_IFR: 'Re-issued for Review',
  IFA: 'Issued for Approval',
  RE_IFA: 'Re-issued for Approval',
  AFC: 'Approved for Construction',
  RE_AFC1: 'Re-approved for Construction (1)',
  RE_AFC2: 'Re-approved for Construction (2)',
  ASBUILT: 'As-built',
};

/** Return codes that mean the document is genuinely through. */
const APPROVED = new Set(['APP', 'APPROVED', 'FINISH']);

export function isApproved(code: string | null | undefined): boolean {
  return code ? APPROVED.has(code.trim().toUpperCase()) : false;
}

const DAY = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}
