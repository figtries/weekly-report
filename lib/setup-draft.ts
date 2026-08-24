import type { DistributionPattern, ProjectInfo } from './types';

/**
 * What the setup wizard hands back when the user locks the baseline.
 *
 * Kept as its own module (rather than living in `actions.ts`) so the client
 * wizard can import the type without pulling a `'use server'` file into the
 * browser bundle.
 *
 * The draft carries *inputs*, not results: rows, prices and dates. Weights and
 * the plan curve are computed server-side from these on commit, so the numbers
 * that land in the database can only have come from `lib/setup.ts` — a client
 * can't post a hand-edited weight.
 */
export interface SetupDraftRow {
  wbsCode: string;
  deskripsi: string;
  level: number;
  vol: number | null;
  satuan: string | null;
  /** Rupiah per unit. 0 means unpriced. */
  unitPrice: number;
  startWeek: number;
  finishWeek: number;
  pattern: DistributionPattern;
}

export interface SetupDraft {
  project: Pick<
    ProjectInfo,
    'name' | 'contractNo' | 'customer' | 'contractor' | 'workLocation'
  > & { weekAnchorEndDate: string };
  totalWeeks: number;
  rows: SetupDraftRow[];
  /** True when the user chose to proceed without a priced BOQ. */
  evenWeights: boolean;
}
