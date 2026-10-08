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
  /** Came back with a comment and nothing has gone out since (`comments`). */
  returnedOpen: number;
  /** Past a planned send date with the ball on our side (`late`). */
  overdue: number;
  awaiting: number;
  longestWait: number | null;
  withUs: number;
  /**
   * Documents filed on this group itself while it also has sub-groups, with
   * their own figures; null when there are none. A sub-group added to a
   * discipline that already held documents left them here.
   */
  own: { documents: number; actual: number; plan: number | null } | null;
  children: RegisterNode[];
}

/** A group as the Data screen lists it: what its header reads, for the rows under it. */
export interface DataGroup { id: string; name: string; parentName: string | null; node: RegisterNode; actual: number; plan: number | null }

/**
 * The Data screen's groups, in order: every group with no sub-groups, and a
 * group's own row before its sub-groups when documents sit on it directly.
 * Listing only the leaves hid those documents from Data while the Summary
 * still counted them (8 Oct 2026). Never a document left out.
 */
export function dataGroups(tree: RegisterNode[]): DataGroup[] {
  const out: DataGroup[] = [];
  const walk = (node: RegisterNode, parentName: string | null) => {
    if (node.children.length === 0) {
      out.push({ id: node.id, name: node.name, parentName, node, actual: node.actual, plan: node.plan });
      return;
    }
    if (node.own) out.push({ id: node.id, name: node.name, parentName, node, actual: node.own.actual, plan: node.own.plan });
    for (const child of node.children) walk(child, node.name);
  };
  for (const root of tree) walk(root, null);
  return out;
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
  /** Documents whose latest send has had no reply yet: the Data screen's "With client". */
  awaiting: number;
  /** Below 100% with the ball on our side: the Data screen's "With us". */
  withUs: number;
  /** The longest of those waits in days, or null when nothing is out. */
  longestWait: number | null;
  /** Submissions the register marks without a date — placed on the curve by estimate. */
  undated: number;
}

/**
 * What a document is waiting on, as of the week being viewed (3 Oct 2026).
 *
 * Decided with the user, in this order, each document counted once:
 * - `late`: the ball is with us and a planned send date has passed.
 * - `comments`: it came back with a comment code and nothing has gone out since.
 * - `waiting`: it is with the other side and has been for over `REPLY_DAYS`.
 * - `soon`: the ball is with us and a planned send date is within `LOOKAHEAD_DAYS`.
 * - `untouched`: never sent and none of the above. Not outstanding on the EDL
 *   summary (a document not yet due is not a problem), kept for the VDRL.
 *
 * The old `returned` kind counted any document whose LAST RETURN carried a
 * comment, even after the next stage had gone out: P&ID Gas Dehydration came
 * back AWC at IFR on 15 Apr, went out at IFA on 22 Apr and at AFC on 30 Apr,
 * and the summary still said it had been held up for 18 days.
 */
/** A project whose register can be copied when another one is built (3 Oct 2026). */
export interface RegisterSource {
  projectId: string;
  name: string;
  documents: number;
  headings: number;
}

export type ObstacleKind = 'late' | 'comments' | 'waiting' | 'soon' | 'untouched';

/** Over this many days with the other side, a document is chased. */
export const REPLY_DAYS = 14;

/**
 * A document at 100% is finished, and Needs action never lists it: three AFC
 * drawings waiting on the client's reply sat under Needs action beside groups
 * reading 100.0% (8 Oct 2026). To the hundredth, because stage weights with
 * decimals can add up to 99.999…
 */
export const isFull = (percent: number) => Math.round(percent * 100) >= 10000;

/*
 * The Data screen's chips and the Summary's Needs action read these and nothing
 * else (8 Oct 2026): the Data tab had its own rule and counted a document the
 * Summary did not, and the reverse. `DocumentCard.action` is decided once, on
 * the server, by the same function that builds the Summary's list.
 */
export const isDone = (c: DocumentCard) => isFull(c.percent) && !c.out;
export const needsAction = (c: DocumentCard) => c.action !== null && c.action.kind !== 'untouched';
export const withUs = (c: DocumentCard) => !c.out && !isFull(c.percent);
/** How far ahead "due soon" looks from the end of the week being viewed. */
export const LOOKAHEAD_DAYS = 14;

export interface Obstacle {
  documentId: string;
  docNo: string | null;
  title: string;
  /** The group it sits in, so the workbench can jump straight to it. */
  categoryId: string;
  categoryName: string;
  kind: ObstacleKind;
  stage: DocStage | null;
  /** The comment it came back with, when it has one still unanswered. */
  returnCode: string | null;
  /** The stage that goes out next: the one to send, or the one answering a comment. */
  next: DocStage | null;
  /**
   * The date that matters for its kind: the planned date (`late`, `soon`), the
   * return (`comments`) or the send (`waiting`).
   */
  since: string | null;
  /** Days from `since` to the as-of date; for `soon`, days until it is due. */
  days: number | null;
}

/** What one document is waiting on: an Obstacle without the document around it. */
export type DocAction = Pick<Obstacle, 'kind' | 'stage' | 'returnCode' | 'next' | 'since' | 'days'>;

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
  /** Doc or Dwg as stored. */
  kind: string | null;
  pic: string | null;
  remarks: string | null;
  percent: number;
  /** The furthest stage it has actually reached. */
  stage: DocStage | null;
  /**
   * The comment its latest stage came back with, while it is unanswered: once
   * the next stage has gone out it is answered, as on the Summary.
   */
  returnCode: string | null;
  /** Days it has been sitting with the reviewer. */
  waiting: number | null;
  /** The first stage after the furthest one reached, and its planned date. */
  nextStage: DocStage | null;
  plannedAt: string | null;
  /** Why it needs action, exactly as the Summary lists it; null when it needs none. */
  action: DocAction | null;
  laps: number;
  /**
   * The stage this document goes out at next while the ball is on our side;
   * null while it is with the other side or when it is finished. Decided by
   * the same rule as Outstanding (`ballOf` in lib/register.ts), and offered by
   * Record transmittal.
   */
  sendNext: DocStage | null;
  /** The stage that is with the other side now, and since when. */
  out: { stage: DocStage; since: string | null; days: number | null } | null;
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

/**
 * What the two registers are, in one line each.
 *
 * "EDL" and "VDRL" are what a document controller says out loud and what
 * nobody else on the project can decode. The difference between them is not a
 * naming detail either: it is WHO OWES THE DOCUMENT, and that is why only one
 * of them carries promised dates and therefore a plan curve and a red overdue
 * count. Stated wherever the pair is offered as a choice, so opening this
 * section for the first time does not start with a guess.
 *
 * Wording taken from what the code already knew: `lib/register.ts` ("what we
 * owe the client" / "what our vendors owe us") and RegisterSetup's own
 * expansions of the acronyms.
 */
export const REGISTER_INFO = {
  edl: {
    short: 'EDL',
    long: 'Engineering Drawing List',
    owes: 'What you owe the client',
    detail: 'Every drawing and document your side issues for review, approval and construction. Each one carries a promised date, so this register has a plan to fall behind.',
  },
  vdrl: {
    short: 'VDRL',
    long: 'Vendor Drawing Register List',
    owes: 'What your vendors owe you',
    detail: 'Documents due from suppliers, grouped by package. Nobody gave promised dates for these, so there is no plan line and nothing is marked overdue.',
  },
} as const satisfies Record<RegisterKind, {
  short: string; long: string; owes: string; detail: string;
}>;

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
