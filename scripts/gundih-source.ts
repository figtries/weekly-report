/**
 * Reads the CPP Gundih weekly workbook into plain data.
 *
 * Split out from the importer because two scripts need it: `import-gundih.ts`
 * writes it to the database, and `verify-import.ts` compares what the database
 * then derives against the workbook's own `PLAN` block. That comparison is the
 * point of the whole exercise — we are not loading data, we are proving the
 * calculation model reproduces a report the client already signed.
 *
 * ONE streaming pass. `ExcelJS.stream.xlsx.WorkbookReader`, never `readFile`:
 * this workbook is 11.8 MB and plain readFile died at a 2 GB heap.
 *
 * Sheet "Data Overall" is 305 rows × 454 columns, four horizontal blocks side
 * by side. We read two of them and deliberately ignore a third:
 *
 *   cols   1– 14   WBS code, name, weights, price, workstep, both baselines
 *   cols  16–171   PLAN     — per-leaf planned fraction, W1..W60
 *   cols 174–233   DATA PLAN   (= PLAN × weight, so nothing new)
 *   cols 236–295   DATA ACTUAL (= ACTUAL × weight, likewise)
 *   cols 298–453   ACTUAL   — per-leaf actual fraction, daily columns
 *
 * PLAN is read as a TEST FIXTURE, never as data to store: the plan curve is
 * derived from start and finish dates, and if our derivation stops matching
 * these columns we want to fail loudly rather than store 10,560 frozen numbers
 * the way the JSON store did.
 */
import ExcelJS from 'exceljs';

/**
 * The streaming reader yields worksheets that carry a `name`, but exceljs's own
 * `WorksheetReader` type omits it. Narrowed here rather than sprinkling casts:
 * picking sheets by name is the whole navigation strategy for a 23-sheet file.
 */
type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

/* --------------------------------------------------------------- columns */

const PLAN_FROM = 16, PLAN_TO = 171;
const ACTUAL_FROM = 298, ACTUAL_TO = 453;

/** Header rows of every block: period start, period end, week label. */
const ROW_PERIOD_START = 6, ROW_PERIOD_END = 7, ROW_WEEK_LABEL = 8;
const FIRST_DATA_ROW = 9;

/* ------------------------------------------------------------------ types */

export interface SourceWeek {
  weekNo: number;
  startDate: string;
  endDate: string;
}

export interface SourceRow {
  /** Spreadsheet row, kept so an error message can point at the real file. */
  excelRow: number;
  wbsCode: string;
  deskripsi: string;
  /** Share of the enclosing reporting unit, 0..1 as stored by Excel. */
  wfUnit: number | null;
  /** Share of the whole project, 0..1. */
  wfOverall: number | null;
  price: number | null;
  /** How this node's weight was split off its parent: 0.5 / 0.3 / 0.2. */
  workstep: number | null;
  contractual: { start: string; finish: string } | null;
  active: { start: string; finish: string } | null;
  /** Planned fraction 0..1 at each week end, by week number. Fixture only. */
  plan: Map<number, number>;
  /** Actual fraction 0..1 at each week end, by week number. */
  actual: Map<number, number>;
}

/** Taken from the workbook's own "Detail Overall" banner, never invented here. */
export interface SourceProject {
  name: string | null;
  contractNo: string | null;
  clientName: string | null;
}

export interface GundihSource {
  project: SourceProject;
  weeks: SourceWeek[];
  rows: SourceRow[];
  /**
   * The week this workbook reports, taken from its own "Summary Overall"
   * banner. Everything past it is stale rather than empty — at W44 the ACTUAL
   * block drops from 155 leaves to 137 and the project total falls from 80.04%
   * back to 75.72% — so progress is imported up to here and no further.
   */
  reportedWeek: number | null;
}

/* ----------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * MS Project writes dates as text — `Oct 27 '25`, and `Dec 3 '25` with no
 * padding. Parsed strictly: a silently unparsed date would become a leaf with
 * no schedule, and a leaf with no schedule contributes nothing to the plan
 * curve, which shows up as a quiet shortfall rather than an error.
 */
export function parseProjectDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s*'(\d{2})$/.exec(text);
  if (!m) throw new Error(`tanggal tidak dikenali: ${JSON.stringify(text)}`);

  const month = MONTHS[m[1].toLowerCase()];
  if (!month) throw new Error(`bulan tidak dikenali: ${JSON.stringify(text)}`);

  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Excel serial → ISO. Serial 25569 is 1970-01-01, same convention as lib/pdf. */
export function fromSerial(serial: number): string {
  return new Date((serial - 25569) * 86_400_000).toISOString().slice(0, 10);
}

/* ----------------------------------------------------------------- cells */

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell?.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; result?: unknown; formula?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    // A formula cell carries its last computed result; that is what we want.
    if (o.result !== undefined) return o.result;
    return null;
  }
  return v;
}

function num(cell: ExcelJS.Cell): number | null {
  const v = cellValue(cell);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(cell: ExcelJS.Cell): string | null {
  const v = cellValue(cell);
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/* ---------------------------------------------------------------- reader */

export async function readGundihWorkbook(file: string): Promise<GundihSource> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  const periodStart = new Map<number, number>();  // column → serial
  const periodEnd = new Map<number, number>();
  const weekLabel = new Map<number, number>();    // column → week number

  // week number → the column to read in each block
  let planCols = new Map<number, number>();
  let actualCols = new Map<number, number>();
  let weeks: SourceWeek[] = [];

  const rows: SourceRow[] = [];
  const project: SourceProject = { name: null, contractNo: null, clientName: null };
  let reportedWeek: number | null = null;

  for await (const sheet of reader) {
    const worksheet = sheet as NamedWorksheetReader;
    if (worksheet.name === 'Summary Overall') {
      for await (const row of worksheet) {
        if (row.number !== 2) continue;
        const m = /^W(\d+)$/.exec(str(row.getCell(15)) ?? '');
        if (m) reportedWeek = Number(m[1]);
      }
      continue;
    }

    // "Detail Overall" carries the banner the PDF prints: contract numbers,
    // project name, customer. Reading it here means the project row is quoted
    // from the client's own file rather than typed into this script.
    if (worksheet.name === 'Detail Overall') {
      for await (const row of worksheet) {
        if (row.number > 10) continue;
        const label = str(row.getCell(1));
        if (!label) continue;
        const after = (prefix: string) => label.slice(prefix.length).replace(/^\s*:\s*/, '').trim() || null;
        if (label.startsWith('CONTRACT NO')) project.contractNo = after('CONTRACT NO');
        else if (label.startsWith('PROJECT NAME')) project.name = after('PROJECT NAME');
        else if (label.startsWith('CUSTOMER')) project.clientName = after('CUSTOMER');
      }
      continue;
    }

    if (worksheet.name !== 'Data Overall') {
      // A worksheet must still be drained or the stream stalls on the next one.
      for await (const skipped of worksheet) void skipped;
      continue;
    }

    for await (const row of worksheet) {
      const n = row.number;

      if (n === ROW_PERIOD_START || n === ROW_PERIOD_END || n === ROW_WEEK_LABEL) {
        const collect = (from: number, to: number) => {
          for (let c = from; c <= to; c++) {
            const cell = row.getCell(c);
            if (n === ROW_WEEK_LABEL) {
              const s = str(cell);
              const m = s && /^W(\d+)$/.exec(s);
              if (m) weekLabel.set(c, Number(m[1]));
            } else {
              const v = num(cell);
              if (v !== null) (n === ROW_PERIOD_START ? periodStart : periodEnd).set(c, v);
            }
          }
        };
        collect(PLAN_FROM, PLAN_TO);
        collect(ACTUAL_FROM, ACTUAL_TO);
        continue;
      }

      if (n < FIRST_DATA_ROW) continue;

      // The header rows are behind us now, so the column maps can be built once.
      if (weeks.length === 0) {
        ({ weeks, planCols, actualCols } = buildWeekMaps(weekLabel, periodStart, periodEnd));
      }

      const wbsCode = str(row.getCell(2));
      if (!wbsCode) continue;

      const readBlock = (cols: Map<number, number>) => {
        const out = new Map<number, number>();
        for (const [weekNo, col] of cols) {
          const v = num(row.getCell(col));
          if (v !== null) out.set(weekNo, v);
        }
        return out;
      };

      rows.push({
        excelRow: n,
        wbsCode,
        deskripsi: (str(row.getCell(3)) ?? '').trim(),
        wfUnit: num(row.getCell(4)),
        wfOverall: num(row.getCell(5)),
        price: num(row.getCell(6)),
        workstep: num(row.getCell(7)),
        contractual: datePair(row, 10, 11),
        active: datePair(row, 13, 14),
        plan: readBlock(planCols),
        actual: readBlock(actualCols),
      });
    }
  }

  if (weeks.length === 0) throw new Error('sheet "Data Overall" tidak ditemukan');
  return { project, weeks, rows, reportedWeek };
}

function datePair(row: ExcelJS.Row, startCol: number, finishCol: number) {
  const start = parseProjectDate(str(row.getCell(startCol)));
  const finish = parseProjectDate(str(row.getCell(finishCol)));
  return start && finish ? { start, finish } : null;
}

/**
 * A week owns several columns in the ACTUAL block, one per day it was reported
 * on, all carrying the same label. Its figure is the rightmost column whose
 * period end is the week's own end — which is exactly what the workbook's own
 * S-curve does with `HLOOKUP` over row 7.
 */
function buildWeekMaps(
  weekLabel: Map<number, number>,
  periodStart: Map<number, number>,
  periodEnd: Map<number, number>,
) {
  const bounds = new Map<number, { start: number; end: number }>();
  for (const [col, weekNo] of weekLabel) {
    const s = periodStart.get(col);
    const e = periodEnd.get(col);
    if (s === undefined || e === undefined) continue;
    const cur = bounds.get(weekNo);
    bounds.set(weekNo, {
      start: cur ? Math.min(cur.start, s) : s,
      end: cur ? Math.max(cur.end, e) : e,
    });
  }

  const weeks: SourceWeek[] = [...bounds.entries()]
    .map(([weekNo, b]) => ({ weekNo, startDate: fromSerial(b.start), endDate: fromSerial(b.end) }))
    .sort((a, b) => a.weekNo - b.weekNo);

  const pick = (from: number, to: number) => {
    const cols = new Map<number, number>();
    for (const week of weeks) {
      const wanted = bounds.get(week.weekNo)!.end;
      let chosen: number | null = null;
      for (const [col, end] of periodEnd) {
        if (col < from || col > to || end !== wanted) continue;
        if (chosen === null || col > chosen) chosen = col;
      }
      if (chosen !== null) cols.set(week.weekNo, chosen);
    }
    return cols;
  };

  return { weeks, planCols: pick(PLAN_FROM, PLAN_TO), actualCols: pick(ACTUAL_FROM, ACTUAL_TO) };
}
