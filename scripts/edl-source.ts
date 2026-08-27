/**
 * Reads the Engineering Deliverable List into plain data.
 *
 * The register is the second progress engine, and it runs on the same
 * arithmetic as the physical WBS: a weight, then stage weights, then a
 * cumulative curve. That is why one engine can serve both — and why the
 * engineering leaves in the WBS are meant to read their figure from here
 * instead of being measured twice.
 *
 * Two sheets matter:
 *
 *   "EDL"          one row per document, and the review chain across 66
 *                  columns — IFR → RE-IFR → IFA → RE-IFA → AFC → RE-AFC1/2 →
 *                  AS-BUILT, each with plan, submission, transmittal both
 *                  ways, and a return code.
 *   "EDL Summary"  one row per category with its document count, its weight,
 *                  the count that has reached each stage, and the resulting
 *                  percent. Read as a FIXTURE: `verify-edl.ts` recomputes all
 *                  of it from the register and checks it lands on the same
 *                  number.
 *
 * Dates here are Excel serials, unlike the weekly workbook where MS Project
 * wrote them as text.
 */
import ExcelJS from 'exceljs';

import { fromSerial } from './gundih-source.ts';

type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

/* --------------------------------------------------------------- columns */

const EDL_FIRST_ROW = 9;

/** Column offsets per stage. AFC carries an extra "Plan Receive" column. */
const STAGE_COLUMNS = {
  IFR: { planSubmit: 20, submitted: 21, outTr: 22, returned: 23, inTr: 24, code: 25 },
  RE_IFR: { planSubmit: null, submitted: 26, outTr: 27, returned: 28, inTr: 29, code: 30 },
  IFA: { planSubmit: 31, submitted: 32, outTr: 33, returned: 34, inTr: 35, code: 36 },
  RE_IFA: { planSubmit: null, submitted: 37, outTr: 38, returned: 39, inTr: 40, code: 41 },
  AFC: { planSubmit: 42, submitted: 43, outTr: 44, returned: 46, inTr: 47, code: 48 },
  RE_AFC1: { planSubmit: null, submitted: 49, outTr: 50, returned: 51, inTr: 52, code: 53 },
  RE_AFC2: { planSubmit: null, submitted: 54, outTr: 55, returned: 56, inTr: 57, code: 58 },
  ASBUILT: { planSubmit: 59, submitted: 60, outTr: 61, returned: 62, inTr: 63, code: 64 },
} as const;

export type EdlStage = keyof typeof STAGE_COLUMNS;
export const EDL_STAGES = Object.keys(STAGE_COLUMNS) as EdlStage[];

/* ------------------------------------------------------------------ types */

export interface SourceStage {
  stage: EdlStage;
  planSubmitDate: string | null;
  /**
   * Whether the document went out at this stage at all. Separate from
   * `submittedAt` because the register marks a submission whose date nobody
   * wrote down with a bare `1` — five QA/QC procedures sit at "APPROVED FOR
   * CONSTRUCTION" with `1` in every date column. Reading only dates loses them
   * and undercounts the stage; the client's own summary counts them.
   */
  submitted: boolean;
  submittedAt: string | null;
  submitTransmittal: string | null;
  returnedAt: string | null;
  returnTransmittal: string | null;
  returnCode: string | null;
}

export interface SourceDocument {
  excelRow: number;
  seq: number;
  docNo: string;
  existingDwgNo: string | null;
  revision: string | null;
  priority: string | null;
  title: string;
  size: string | null;
  sheets: number | null;
  kind: string | null;
  pic: string | null;
  status: string | null;
  remarks: string | null;
  /** The category row this document sits under, e.g. `A.2.1`. */
  categoryCode: string;
  stages: SourceStage[];
}

export interface SourceCategory {
  code: string;
  name: string;
  /** `JUMLAH` — how many documents the summary expects here. */
  plannedCount: number | null;
  /** Share of the whole register, 0..1. Count ÷ total documents. */
  weight: number | null;
  unit: string | null;
  /** What the summary claims has reached each stage, for verification. */
  submitted: { IFR: number; IFA: number; AFC: number } | null;
  /** The summary's own `TOTAL PROGRES`, 0..1 of the whole register. */
  totalProgress: number | null;
}

export interface EdlSource {
  categories: SourceCategory[];
  documents: SourceDocument[];
  /** IFR 0.5 · IFA 0.3 · AFC 0.2 here, but it is a per-project agreement. */
  stageWeights: { IFR: number; IFA: number; AFC: number };
}

/* ----------------------------------------------------------------- cells */

function raw(cell: ExcelJS.Cell): unknown {
  const v = cell?.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; result?: unknown };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return o.result;
    return null;
  }
  return v;
}

function text(cell: ExcelJS.Cell): string | null {
  const v = raw(cell);
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '#REF!' ? null : s;
}

function number(cell: ExcelJS.Cell): number | null {
  const v = raw(cell);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A date cell holds an Excel serial. Anything else — and there is plenty of it,
 * one column holds the literal `1` — is not a date and is dropped rather than
 * turned into 1900.
 */
function date(cell: ExcelJS.Cell | null): string | null {
  if (!cell) return null;
  const v = number(cell);
  if (v === null || v < 40000 || v > 60000) return null;
  return fromSerial(v);
}

/* ---------------------------------------------------------------- reader */

export async function readEdlWorkbook(file: string): Promise<EdlSource> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  const categories = new Map<string, SourceCategory>();
  const documents: SourceDocument[] = [];
  const stageWeights = { IFR: 0.5, IFA: 0.3, AFC: 0.2 };

  for await (const sheet of reader) {
    const ws = sheet as NamedWorksheetReader;

    if (ws.name === 'EDL') {
      let currentCategory = '';
      for await (const row of ws) {
        if (row.number < EDL_FIRST_ROW) continue;
        const first = raw(row.getCell(2));
        const second = text(row.getCell(3));
        if (first === null && second === null) continue;

        // A category row is labelled `A`, `A.1`, `B.2.3`; a document row is
        // numbered 1, 2, 3. That is the only thing that separates them.
        if (typeof first !== 'number') {
          const code = String(first).trim();
          if (!code || !second) continue;
          currentCategory = code;
          const existing = categories.get(code);
          if (existing) existing.name = second;
          else categories.set(code, {
            code, name: second, plannedCount: null, weight: null,
            unit: null, submitted: null, totalProgress: null,
          });
          continue;
        }

        const docNo = second;
        if (!docNo) continue;

        documents.push({
          excelRow: row.number,
          seq: first,
          docNo,
          existingDwgNo: text(row.getCell(4)),
          revision: text(row.getCell(5)),
          priority: text(row.getCell(7)),
          title: text(row.getCell(8)) ?? docNo,
          size: text(row.getCell(9)),
          sheets: number(row.getCell(10)),
          kind: text(row.getCell(11)),
          pic: text(row.getCell(12)),
          status: text(row.getCell(15)),
          remarks: text(row.getCell(65)),
          categoryCode: currentCategory,
          stages: EDL_STAGES.map((stage) => {
            const c = STAGE_COLUMNS[stage];
            return {
              stage,
              planSubmitDate: c.planSubmit ? date(row.getCell(c.planSubmit)) : null,
              submitted: raw(row.getCell(c.submitted)) !== null,
              submittedAt: date(row.getCell(c.submitted)),
              submitTransmittal: text(row.getCell(c.outTr)),
              returnedAt: date(row.getCell(c.returned)),
              returnTransmittal: text(row.getCell(c.inTr)),
              returnCode: text(row.getCell(c.code)),
            };
            // A stage is recorded once something ACTUALLY happened. A plan date
            // on its own is a date in the future, not evidence of a submission,
            // and counting it would inflate every category.
          }).filter((s) =>
            s.submitted || s.submitTransmittal || s.returnedAt || s.returnTransmittal || s.returnCode,
          ),
        });
      }
      continue;
    }

    if (ws.name === 'EDL Summary') {
      for await (const row of ws) {
        const n = row.number;
        if (n === 8) {
          for (const [stage, col] of [['IFR', 7], ['IFA', 8], ['AFC', 9]] as const) {
            const w = number(row.getCell(col));
            if (w !== null) stageWeights[stage] = w;
          }
          continue;
        }
        if (n < 10) continue;

        const code = text(row.getCell(2));
        const name = text(row.getCell(3));
        if (!code || !name) continue;

        const counts = [7, 8, 9].map((c) => number(row.getCell(c)));
        const existing = categories.get(code) ?? {
          code, name, plannedCount: null, weight: null, unit: null, submitted: null, totalProgress: null,
        };
        existing.name = name;
        existing.plannedCount = number(row.getCell(4));
        existing.unit = text(row.getCell(5));
        existing.weight = number(row.getCell(6));
        // A blank count cell means none have reached that stage yet, not that
        // the row is unreadable — several categories leave AFC empty.
        existing.submitted = counts.some((c) => c !== null)
          ? { IFR: counts[0] ?? 0, IFA: counts[1] ?? 0, AFC: counts[2] ?? 0 }
          : null;
        existing.totalProgress = number(row.getCell(18));
        categories.set(code, existing);
      }
      continue;
    }

    for await (const skipped of ws) void skipped;
  }

  return { categories: [...categories.values()], documents, stageWeights };
}

/** `A.2.1` hangs off `A.2`, which hangs off `A`. */
export function parentCode(code: string): string | null {
  const i = code.lastIndexOf('.');
  return i === -1 ? null : code.slice(0, i);
}

/** Only leaf categories carry weight; the others are subtotal rows. */
export function isLeafCategory(code: string, all: SourceCategory[]): boolean {
  return !all.some((c) => c.code.startsWith(`${code}.`));
}
