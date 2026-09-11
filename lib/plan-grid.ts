/**
 * The shape a workbook arrives in, and the one function that turns it back
 * into a paste.
 *
 * Separate from `lib/plan-xlsx.ts` because the PANEL needs both: the column
 * dropdowns are only meaningful if changing one re-makes the text without
 * going back to the server, and a client component that imported the reader
 * would drag exceljs and `node:stream` into the browser bundle with it.
 *
 * Nothing here touches a file, a database or React.
 */

/** The five things a plan row is. Everything else on a sheet is progress. */
export type Field = 'code' | 'name' | 'start' | 'finish' | 'price';

/** In the order the paste parser is happiest reading them. */
export const FIELDS: Field[] = ['code', 'name', 'start', 'finish', 'price'];

/**
 * The canonical header. Written out rather than passing the workbook's own
 * labels through, so the parser matches columns by name instead of guessing
 * them from their contents, and so a re-mapped column lands where it was put.
 */
export const FIELD_HEADER: Record<Field, string> = {
  code: 'WBS',
  name: 'Task Name',
  start: 'Start',
  finish: 'Finish',
  price: 'Price',
};

/** What each one is called where a person has to choose it. */
export const FIELD_LABEL: Record<Field, string> = {
  code: 'Outline code',
  name: 'Task name',
  start: 'Start',
  finish: 'Finish',
  price: 'Price',
};

export interface PlanColumn {
  /** Column number in the sheet, 1-based, so a person can find it in Excel. */
  at: number;
  /** The header as written, both tiers merged. */
  label: string;
  /** First few values, so a dropdown can show what the column holds. */
  sample: string[];
}

export interface PlanSheet {
  name: string;
  rows: number;
  score: number;
}

export interface PlanWorkbookRead {
  sheet: string;
  candidates: PlanSheet[];
  sheets: string[];
  columns: PlanColumn[];
  /** Rows by column, parallel to `columns`. Leading spaces are preserved. */
  grid: string[][];
  /** Field to INDEX INTO `columns`. A suggestion; the panel may overrule it. */
  mapping: Partial<Record<Field, number>>;
  notes: string[];
  banner: {
    contractNo: string | null;
    projectName: string | null;
    clientName: string | null;
    weeklyNo: string | null;
  };
}

/**
 * The grid, as the tab-separated text a paste would have produced.
 *
 * The name column keeps its leading spaces: with no outline code that
 * indentation is the only thing left that says how deep a row sits, and
 * `lib/paste.ts` reads it. Every other cell is trimmed, because a stray space
 * in front of a price is not information.
 *
 * A row with nothing in the name column is dropped here rather than downstream:
 * the parser would report it as skipped, and a preview that apologises for
 * fourteen blank spacer rows out of a spreadsheet is noise, not honesty.
 */
export function planToPaste(
  grid: string[][],
  mapping: Partial<Record<Field, number>>
): string {
  const used = FIELDS.filter((f) => mapping[f] !== undefined);
  if (!used.includes('name')) return '';

  const lines = [used.map((f) => FIELD_HEADER[f]).join('\t')];
  for (const row of grid) {
    const name = row[mapping.name!] ?? '';
    if (!name.trim()) continue;
    lines.push(
      used
        .map((f) => {
          const cell = row[mapping[f]!] ?? '';
          return f === 'name' ? cell.replace(/\t/g, ' ') : cell.trim().replace(/\t/g, ' ');
        })
        .join('\t')
    );
  }
  return lines.join('\n');
}
