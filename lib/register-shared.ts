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

/** Return codes that mean the document is genuinely through. */
const APPROVED = new Set(['APP', 'APPROVED', 'FINISH']);

export function isApproved(code: string | null | undefined): boolean {
  return code ? APPROVED.has(code.trim().toUpperCase()) : false;
}

const DAY = 86_400_000;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}
