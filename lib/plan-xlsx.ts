/**
 * A project plan, read straight out of the weekly workbook.
 *
 * This is the same door `lib/register-xlsx.ts` opens for the document
 * register, and it makes the same promise: the file is turned into the grid a
 * PASTE produces, and `lib/paste.ts` does the rest. There is no second
 * importer here with its own idea of what a row is, no second preview, and no
 * second write path — `previewPasteAction` and `applyPasteAction` are reached
 * unchanged, so a plan that arrives as a file is checked and written exactly
 * like a plan that arrives on the clipboard.
 *
 * **Columns are DETECTED, never counted.** `scripts/gundih-source.ts` hard-codes
 * them (`PLAN_FROM = 16`) because it reads one known file for one known test.
 * That constant is already wrong for W31 of the same project, where the PLAN
 * block starts at column 13 — the earlier weeks carry one set of dates and the
 * later ones carry two baselines side by side. A reader people point at their
 * own workbook cannot hold a column number.
 *
 * **It stops where the weeks start.** "Data Overall" is 305 rows by 451
 * columns: eleven columns of plan, then four horizontal blocks of weekly
 * numbers (PLAN, DATA PLAN, DATA ACTUAL, ACTUAL) 156 columns wide. Only the
 * left block describes the plan; the rest is progress, which is imported
 * elsewhere and must not arrive through a screen that says "plan".
 *
 * **Weights are not read, deliberately.** The sheet has `WF per SPK` and
 * `WF Overall` and they are tempting and they are also derived numbers. In this
 * app weight comes from price over contract value (`lib/setup.ts`), so the
 * columns imported are the ones weight is COMPUTED FROM. Reading them back in
 * would make the app agree with the workbook by copying it instead of by
 * calculating, which is exactly the check worth keeping.
 *
 * **Duration is not read either.** The sheet has two columns called Duration —
 * one under `Workstep` holding something else entirely (620 against a row
 * whose span is 124 days). Start and finish are unambiguous and duration falls
 * out of them, so the ambiguous column is left alone rather than guessed at.
 *
 * exceljs is driven through `WorkbookReader` over a STREAM, never `readFile`:
 * these workbooks run to 11.8 MB and plain `readFile` died at a 2 GB heap on
 * one. The route hands the request body straight in, so the file is never held
 * whole in memory on the way through either.
 */
import type { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

/**
 * exceljs's own `WorksheetReader` type omits the `name` the streaming reader
 * actually puts on it, and picking sheets by name is the whole navigation
 * strategy for a 21-sheet file.
 */
type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

export interface PlanWorkbookRead {
  /** The sheet the plan was taken from, as the workbook spells it. */
  sheet: string;
  /** Tab-separated, canonical header, ISO dates — ready for `parsePaste`. */
  text: string;
  rows: number;
  /** Every sheet in the file, so an error can say what was there instead. */
  sheets: string[];
  /** What the reader worked out, in the same voice the paste preview uses. */
  notes: string[];
  /**
   * The banner "Detail Overall" prints: contract, project, customer, week.
   * Shown before anything is written so a person can see they picked the file
   * they meant to.
   */
  banner: {
    contractNo: string | null;
    projectName: string | null;
    clientName: string | null;
    weeklyNo: string | null;
  };
}

/* ----------------------------------------------------------------- cells */

/**
 * Cell values are unwrapped ONCE, as the row streams past, and the plain
 * results are what the rest of this file works on. Holding on to the reader's
 * own `Row` objects to re-read them later would be trusting a streaming API to
 * keep rows alive after it has moved on.
 */
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text?: string }>; result?: unknown; text?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? '').join('');
    // A formula carries its last computed result, which is the number the
    // workbook was printed with.
    if (o.result !== undefined && o.result !== null) return o.result;
    if (typeof o.text === 'string') return o.text;
    return null;
  }
  return v;
}

function text(raw: unknown): string {
  const v = cellValue(raw);
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ----------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  mei: 5, agu: 8, okt: 10, des: 12,
};

/** Serial 25569 is 1970-01-01 — the same convention as `lib/pdf.ts`. */
function fromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80_000) return null;
  return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * MS Project writes its dates as TEXT — `Oct 27 '25`, and `Dec 3 '25` with no
 * padding — which no spreadsheet reader recognises as a date and which
 * `lib/paste.ts` would have to guess at. Normalised to ISO here, where the
 * source is known, rather than left for the parser to puzzle over downstream.
 *
 * Anything not recognised is passed through untouched: the paste parser has
 * its own date reader and says out loud which day-order it assumed, and that
 * is a better answer than a blank.
 */
function isoDate(raw: unknown): string {
  const v = cellValue(raw);
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return fromSerial(v) ?? '';

  const written = String(v).trim();
  if (!written) return '';
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*'?(\d{2,4})$/.exec(written);
  if (!m) return written;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return written;
  const day = Number(m[2]);
  const y = Number(m[3]);
  const year = y >= 1000 ? y : y < 70 ? 2000 + y : 1900 + y;
  if (day < 1 || day > 31) return written;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/* --------------------------------------------------------------- columns */

/** The five things a plan row is. Everything else on the sheet is progress. */
type Field = 'code' | 'name' | 'start' | 'finish' | 'price';

const LABELS: Record<Field, string[]> = {
  code: ['wbs', 'wbscode', 'code', 'kode'],
  name: ['taskname', 'task', 'name', 'activity', 'description', 'deskripsi', 'uraian', 'uraianpekerjaan', 'pekerjaan'],
  start: ['start', 'startdate', 'mulai', 'tanggalmulai', 'tglmulai'],
  finish: ['finish', 'finishdate', 'end', 'enddate', 'selesai', 'tanggalselesai', 'tglselesai'],
  price: ['price', 'value', 'amount', 'cost', 'harga', 'nilai'],
};

/** An outline code — `1`, `1.2`, `1.2.1.1`. What makes a row a row. */
const CODE_RE = /^\d+(\.\d+)*\.?$/;
/** A weekly column's label. Where the plan stops and the progress starts. */
const WEEK_RE = /^w\d+$/;
/** The banners Excel puts over each block of weekly numbers. */
const BLOCK_RE = /^(plan|actual|dataplan|dataactual)$/;

interface Header {
  /** Row number carrying the column names. */
  row: number;
  /** Field → column index, 1-based. */
  at: Partial<Record<Field, number>>;
  /** First column belonging to the weekly blocks; the plan stops before it. */
  weeksFrom: number;
}

/**
 * The header of this sheet is two rows deep and staggered: `Task Name` sits on
 * one and `Price` on the next, because Excel merged the cells above them. So
 * labels are collected from the row that names the WBS column AND the row
 * under it, first non-blank wins — reading either row alone finds half the
 * columns and silently drops the other half.
 */
function readHeader(rows: Map<number, string[]>): Header | null {
  for (const [rowNo, cells] of rows) {
    const hasCode = cells.some((c) => LABELS.code.includes(norm(c)));
    const hasName = cells.some((c) => LABELS.name.includes(norm(c)));
    if (!hasCode || !hasName) continue;

    const below = rows.get(rowNo + 1) ?? [];
    const merged: string[] = [];
    const width = Math.max(cells.length, below.length);
    for (let i = 0; i < width; i += 1) merged[i] = (cells[i] || below[i] || '').trim();

    const at: Partial<Record<Field, number>> = {};
    merged.forEach((label, i) => {
      const key = norm(label);
      if (!key) return;
      for (const field of Object.keys(LABELS) as Field[]) {
        if (at[field] !== undefined) continue;
        if (LABELS[field].includes(key)) at[field] = i + 1;
      }
    });

    // Where the weekly blocks begin, so the note can say what was left alone
    // and a stray label out in the progress columns can never be mistaken for
    // part of the plan.
    //
    // The week labels decide it. The block banners (`PLAN`, `ACTUAL`) are only
    // a fallback, because this sheet ALSO prints those two words at the top of
    // its daily-progress box in column 3 — trusting them first cut the plan off
    // at column 4 and lost the price.
    const lastPlanColumn = Math.max(0, ...Object.values(at));
    let weeksFrom = Number.POSITIVE_INFINITY;
    const mark = (candidate: number) => {
      if (candidate > lastPlanColumn) weeksFrom = Math.min(weeksFrom, candidate);
    };
    for (const [, line] of rows) {
      line.forEach((cell, i) => {
        if (WEEK_RE.test(norm(cell))) mark(i + 1);
      });
    }
    if (!Number.isFinite(weeksFrom)) {
      for (const [, line] of rows) {
        line.forEach((cell, i) => {
          // The banner sits one column to the left of the block it names.
          if (BLOCK_RE.test(norm(cell))) mark(i + 2);
        });
      }
    }

    // A field resolved out in the progress blocks is not a field.
    for (const field of Object.keys(at) as Field[]) {
      if ((at[field] ?? 0) >= weeksFrom) delete at[field];
    }

    return { row: rowNo, at, weeksFrom };
  }
  return null;
}

/* ------------------------------------------------------------------ read */

const HEADER_SCAN_ROWS = 25;

export async function readPlanWorkbook(source: Readable): Promise<PlanWorkbookRead> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });

  const sheets: string[] = [];
  const banner: PlanWorkbookRead['banner'] = {
    contractNo: null, projectName: null, clientName: null, weeklyNo: null,
  };
  let picked: { name: string; lines: string[][]; header: Header } | null = null;

  for await (const sheet of reader) {
    const worksheet = sheet as NamedWorksheetReader;
    const name = worksheet.name ?? `Sheet ${sheets.length + 1}`;
    sheets.push(name);

    // "Detail Overall" prints the banner the signed PDF carries. Read so the
    // preview can quote the client's own file back rather than a filename.
    if (norm(name) === 'detailoverall') {
      for await (const row of worksheet) {
        if (row.number > 12) continue;
        for (let c = 1; c <= Math.min(row.cellCount, 12); c += 1) {
          const label = text(row.getCell(c));
          if (!label) continue;
          const after = (prefix: string) =>
            label.slice(prefix.length).replace(/^\s*:\s*/, '').trim() || null;
          const key = norm(label);
          if (key.startsWith('contractno')) banner.contractNo = after(label.split(':')[0]);
          else if (key.startsWith('projectname')) banner.projectName = after(label.split(':')[0]);
          else if (key.startsWith('customer')) banner.clientName = after(label.split(':')[0]);
          else if (key.startsWith('weeklyno')) {
            banner.weeklyNo = after(label.split(':')[0]) ?? (text(row.getCell(c + 1)) || null);
          }
        }
      }
      continue;
    }

    // Only the sheet that holds a plan is read in full. Every other one is
    // still drained: the streaming reader will not move to the next entry
    // while rows are outstanding.
    if (norm(name) !== 'dataoverall') {
      for await (const _row of worksheet) void _row;
      continue;
    }

    const head = new Map<number, string[]>();
    const lines: string[][] = [];
    let header: Header | null = null;

    /**
     * The first rows are BUFFERED rather than read as they arrive. The header
     * is two rows deep, so resolving it the moment the row naming the WBS
     * column appears reads it against a row that has not been streamed yet:
     * `Price` sits one row lower and came back missing, and the week labels
     * that say where the plan ends were not there to be seen either.
     */
    const early: { number: number; values: unknown[] }[] = [];

    const take = (rowNo: number, values: unknown[]) => {
      if (!header || rowNo <= header.row) return;
      const codeAt = header.at.code;
      const nameAt = header.at.name;
      if (!codeAt || !nameAt) return;
      const code = text(values[codeAt - 1]);
      if (!CODE_RE.test(code)) return;

      lines.push([
        code.replace(/\.$/, ''),
        text(values[nameAt - 1]),
        header.at.start ? isoDate(values[header.at.start - 1]) : '',
        header.at.finish ? isoDate(values[header.at.finish - 1]) : '',
        header.at.price ? text(values[header.at.price - 1]) : '',
      ]);
    };

    // Only the plan columns are ever unwrapped. Reading all 451 of them for
    // every row would be reading the whole progress history to throw it away.
    const upto = () => (header && Number.isFinite(header.weeksFrom) ? header.weeksFrom - 1 : 0);

    for await (const row of worksheet) {
      if (!header) {
        const values: unknown[] = [];
        for (let c = 1; c <= row.cellCount; c += 1) values[c - 1] = row.getCell(c).value;
        head.set(row.number, values.map(text));
        early.push({ number: row.number, values });
        if (row.number < HEADER_SCAN_ROWS) continue;
        header = readHeader(head);
        // No header in the first rows means no plan on this sheet. The rest is
        // still drained: the reader will not move on with rows outstanding.
        if (header) {
          for (const e of early) take(e.number, e.values);
          early.length = 0;
        }
        continue;
      }
      const width = Math.min(row.cellCount, upto() || row.cellCount);
      const values: unknown[] = [];
      for (let c = 1; c <= width; c += 1) values[c - 1] = row.getCell(c).value;
      take(row.number, values);
    }

    // A sheet shorter than the scan window never reached the flush above.
    if (!header && head.size > 0) {
      header = readHeader(head);
      if (header) for (const e of early) take(e.number, e.values);
    }

    if (header) picked = { name, lines, header };
  }

  if (sheets.length === 0) throw new Error('That file has no sheets in it');
  if (!picked) {
    throw new Error(
      `No plan was found. This reads the sheet called "Data Overall" — the file has ${sheets.length} sheets: ${sheets.slice(0, 8).join(', ')}`
    );
  }
  if (picked.lines.length === 0) {
    throw new Error(`"${picked.name}" has a header but no rows with an outline code under it`);
  }

  const { at, weeksFrom } = picked.header;
  const notes: string[] = [];
  notes.push(
    `Read from the sheet "${picked.name}", header on row ${picked.header.row}.`
  );
  if (Number.isFinite(weeksFrom)) {
    notes.push(
      `Columns ${weeksFrom} and beyond are the weekly PLAN and ACTUAL blocks; they are progress, not plan, and were left alone.`
    );
  }
  if (!at.price) notes.push('No price column was found, so weights cannot be derived from this file yet.');
  if (!at.start || !at.finish) notes.push('No start or finish column was found, so the rows arrive without dates.');
  notes.push('WF per SPK and WF Overall were ignored on purpose: weight is computed here from price over contract value, not copied.');

  // A canonical header, so the paste parser matches columns by name instead of
  // guessing them from their contents. Everything below it is already
  // normalised — ISO dates, plain numbers — which is why the preview for a
  // file has nothing to apologise for.
  const head = ['WBS', 'Task Name', 'Start', 'Finish', 'Price'].join('\t');
  const body = picked.lines.map((cells) => cells.join('\t'));

  return {
    sheet: picked.name,
    text: [head, ...body].join('\n'),
    rows: picked.lines.length,
    sheets,
    notes,
    banner,
  };
}
