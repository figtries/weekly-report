/**
 * A project plan, read out of whatever workbook somebody actually has.
 *
 * This is the same door `lib/register-xlsx.ts` opens for the document
 * register, and it makes the same promise: the file becomes the grid a PASTE
 * produces and `lib/paste.ts` does the rest. There is no second importer with
 * its own idea of what a row is, no second preview, and no second write path.
 *
 * The first version of this file read ONE workbook: it required a sheet
 * literally named "Data Overall", required a WBS column, and threw away every
 * row whose code was not `1.2.3`. A plan that was merely SIMILAR did not come
 * in slightly wrong, it was refused outright, which is the opposite of useful
 * when half the point is that people arrive with their own file. Three rules
 * replace that.
 *
 * **The sheet is chosen by what is ON it, never by its name.** Every sheet is
 * scored on what a plan actually needs: a column of names, an outline code,
 * start and finish, a price. Row count is only a tie-breaker, because "Detail
 * Overall" has MORE rows than "Data Overall" and no dates at all, so counting
 * rows alone picks the wrong sheet in the very file this was written for. The
 * name is worth a nudge and nothing more, and every candidate is returned so a
 * person can pick a different one without uploading again.
 *
 * **A row is a row when it has a NAME.** An outline code is how depth is best
 * known, not what makes a row exist. `lib/paste.ts` has always been able to
 * take depth from leading spaces instead, and the old reader could never reach
 * that because it collapsed the whitespace before handing the cell over. The
 * indentation is preserved here now, so a workbook with no code column still
 * comes in as a tree rather than as nothing.
 *
 * **The guess is offered, not imposed.** The columns come back with their
 * labels and sample values and the mapping is just a suggestion the panel can
 * overrule, which is the shape `RegisterBuilder` already uses. That is why the
 * whole left block is returned rather than five chosen columns: re-mapping a
 * column must not mean uploading seven megabytes again.
 *
 * **Weights are still not read, deliberately.** `WF per SPK` and `WF Overall`
 * are derived numbers. Weight here comes from price over contract value
 * (`lib/setup.ts`), so the column imported is the one weight is COMPUTED FROM.
 * Reading the weights back would make the app agree with the workbook by
 * copying it instead of by calculating, which is the check worth keeping.
 *
 * **Hierarchy can live in the indent button.** W56, a workbook from another
 * contractor, carries an outline code on 84 of its 1090 rows and types no
 * leading spaces at all: its five levels are held in Excel's own cell indent.
 * That is read and re-expressed as leading spaces, so the shared parser needs
 * to learn nothing, and it is why this reader asks for styles rather than
 * ignoring them.
 *
 * exceljs is driven through `WorkbookReader` over a STREAM, never `readFile`:
 * these workbooks run to 11.8 MB and plain `readFile` died at a 2 GB heap on
 * one. The route hands the request body straight in.
 */
import type { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

import { looksLikeDate } from './paste';
import type { Field, PlanColumn, PlanWorkbookRead } from './plan-grid';

export type { Field, PlanColumn, PlanSheet, PlanWorkbookRead } from './plan-grid';

/**
 * exceljs's own `WorksheetReader` type omits the `name` the streaming reader
 * actually puts on it, and picking sheets is the whole navigation strategy for
 * a 21-sheet file.
 */
type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

/* ----------------------------------------------------------------- cells */

function unwrap(v: unknown): unknown {
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

/**
 * A cell as text, KEEPING its leading spaces.
 *
 * Those spaces are how a workbook with no outline code says how deep a row
 * sits, and `lib/paste.ts` reads them. Collapsing them, which the first version
 * of this file did on every cell, quietly removed the only fallback the parser
 * had. Everything after the indent is still normalised, because a newline
 * inside a cell would otherwise become a row break downstream.
 */
function text(raw: unknown): string {
  const v = unwrap(raw);
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  const indent = /^[\s ]*/.exec(s)?.[0] ?? '';
  const body = s.slice(indent.length).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trimEnd();
  return body ? indent.replace(/[\r\n\t]/g, ' ') + body : '';
}

/** The same cell with no indent, for matching labels and testing shapes. */
function flat(raw: unknown): string {
  return text(raw).trim();
}

/** A cell's value together with how far Excel itself pushes it in. */
interface RawCell {
  v: unknown;
  indent: number;
}

function cellOf(cell: ExcelJS.Cell | undefined): RawCell {
  const indent = cell?.alignment?.indent;
  return { v: cell?.value ?? null, indent: typeof indent === 'number' ? indent : 0 };
}

/** How many spaces one level of Excel indent becomes. */
const INDENT_UNIT = 2;

/**
 * Excel's own indentation, re-expressed as the leading spaces `lib/paste.ts`
 * already reads.
 *
 * This is the whole reason the reader now asks for styles. In W56, a workbook
 * from another contractor, only 84 of 1090 rows carry an outline code and
 * none of the names are typed with leading spaces: the hierarchy is held
 * entirely in the indent button, five levels of it. Read it and the file is a
 * tree; ignore it and 1090 rows arrive in one flat list.
 *
 * Translating rather than teaching the parser a new signal is deliberate. The
 * parser is shared with the clipboard path, and "depth came from the leading
 * spaces" is a rule it has had all along; this only puts the spaces where a
 * person would have typed them. The parser takes the SMALLEST non-zero indent
 * as one level, so the multiplier here just has to be consistent.
 *
 * A cell that already carries its own leading spaces keeps them. Gundih's
 * names are indented that way and its Excel indent is zero throughout, so
 * nothing about that file changes.
 */
function indented(value: string, indent: number): string {
  if (!value || indent <= 0) return value;
  if (/^[\s ]/.test(value)) return value;
  return ' '.repeat(indent * INDENT_UNIT) + value;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* ----------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  mei: 5, agu: 8, agt: 8, okt: 10, des: 12,
};

/**
 * `Oct 27 '25` into `2025-10-27`.
 *
 * MS Project writes its dates as TEXT in this order, and it is the ONE common
 * date shape `lib/paste.ts` cannot read: its own reader handles `27 Oct 25`,
 * ISO, and slashes, but not month-first-with-an-apostrophe. Converting it here
 * is safe whatever column it lands in, because nothing but a date looks like
 * this, which is what lets a person re-map the columns afterwards without the
 * dates having to be read again.
 */
function asProjectDate(s: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*'?\s*(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return null;
  const y = Number(m[3]);
  const year = y >= 1000 ? y : y < 70 ? 2000 + y : 1900 + y;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `Tue 01/11/22` into `01/11/22`.
 *
 * MS Project prints the weekday in front of its dates and it is the reason W1
 * of this project read 56 rows and nought of them dated: the column was
 * labelled Start, held a date in every row, and not one of them could be
 * parsed. Only stripped when what is left actually is a date, so a task called
 * "Monday shutdown" survives.
 */
function stripWeekday(s: string): string | null {
  const m = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+(.+)$/i.exec(s.trim());
  return m ? m[2].trim() : null;
}

/** A header cell that is itself a date, which is how a weekly block starts. */
function headerIsDate(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (asProjectDate(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
  // Excel serials, in the window a schedule can occupy: 1990 to 2079.
  if (/^\d{5}$/.test(t)) {
    const n = Number(t);
    return n >= 32874 && n <= 65380;
  }
  return false;
}

/* --------------------------------------------------------------- columns */

const LABELS: Record<Field, string[]> = {
  // `id` is here because MS Project names its outline column that. When it
  // holds a plain sequence rather than a dotted code the parser sees no dots
  // in it and falls through to the indentation, which is the right answer.
  code: ['wbs', 'wbscode', 'code', 'kode', 'outline', 'outlinenumber', 'id', 'no', 'nomor', 'item'],
  name: [
    'taskname', 'task', 'name', 'activity', 'description', 'desc', 'scope',
    'deskripsi', 'uraian', 'uraianpekerjaan', 'uraiankegiatan', 'pekerjaan', 'kegiatan',
    'namatugas', 'namapekerjaan', 'jenispekerjaan',
  ],
  start: ['start', 'startdate', 'begin', 'mulai', 'tanggalmulai', 'tglmulai', 'awal', 'mulaitanggal'],
  finish: [
    'finish', 'finishdate', 'end', 'enddate', 'complete', 'completion',
    'selesai', 'tanggalselesai', 'tglselesai', 'akhir', 'berakhir',
  ],
  price: [
    'price', 'value', 'amount', 'cost', 'contractvalue', 'totalprice',
    'harga', 'nilai', 'nilaikontrak', 'hargasatuan', 'jumlahharga', 'totalharga', 'rab',
  ],
};

/** An outline code. Not what makes a row a row, only the best way to read depth. */
const CODE_RE = /^\d+(\.\d+)*\.?$/;
/** A weekly column's label. */
const WEEK_RE = /^[wm]\d{1,3}$/;
/** The banners Excel prints over a block of weekly numbers. */
const BLOCK_RE = /^(plan|actual|aktual|dataplan|dataactual|rencana|realisasi)$/;
/**
 * Nothing sensible puts a plan more than this many columns from the left, and
 * it is the backstop for a sheet whose progress block announces itself in no
 * way at all.
 */
const MAX_PLAN_COLUMNS = 40;
const HEADER_SCAN_ROWS = 25;
/**
 * The same ceiling `applyPasteAction` enforces. The grid crosses the wire so a
 * column can be re-mapped without sending the file again, and a sheet with no
 * ceiling at all would make that response worse than the upload.
 */
const MAX_ROWS = 5_000;

interface Header {
  row: number;
  /** Field to sheet column, 1-based. */
  at: Partial<Record<Field, number>>;
  /** First column of the weekly blocks; the plan is everything left of it. */
  endsAt: number;
  /** How well this row works as a header. */
  score: number;
  /** Both header tiers merged, by column, so the panel can name each one. */
  labels: string[];
}

/**
 * Where the plan stops and the progress starts.
 *
 * The week labels decide it, then dates in the header, and the block banners
 * are only a fallback: "Data Overall" prints PLAN and ACTUAL over its daily
 * progress box in column 3 as well, and trusting those first cut the plan off
 * at column 4 and lost the price with it.
 */
function planEndsAt(rows: Map<number, string[]>, after: number): number {
  const mark = (candidate: number, into: number[]) => {
    if (candidate > after) into.push(candidate);
  };
  const weeks: number[] = [];
  const dates: number[] = [];
  const banners: number[] = [];
  for (const [, line] of rows) {
    line.forEach((cell, i) => {
      const t = cell.trim();
      if (!t) return;
      if (WEEK_RE.test(norm(t))) mark(i + 1, weeks);
      else if (headerIsDate(t)) mark(i + 1, dates);
      // A banner sits one column to the left of the block it names.
      else if (BLOCK_RE.test(norm(t))) mark(i + 2, banners);
    });
  }
  const found = [...weeks, ...dates].sort((a, b) => a - b)[0] ?? banners.sort((a, b) => a - b)[0];
  return Math.min(found ?? Number.POSITIVE_INFINITY, after + MAX_PLAN_COLUMNS);
}

/**
 * The header is often two rows deep and staggered: `Task Name` on one row and
 * `Price` on the next, because Excel merged the cells above them. Labels are
 * taken from the row and the one under it, first non-blank winning. Reading
 * either row alone finds half the columns and silently drops the other half,
 * which is exactly how the price went missing the first time.
 */
function headerAt(rows: Map<number, string[]>, rowNo: number): Header | null {
  const cells = rows.get(rowNo);
  if (!cells) return null;
  const below = rows.get(rowNo + 1) ?? [];
  const width = Math.max(cells.length, below.length);
  const merged: string[] = [];
  for (let i = 0; i < width; i += 1) merged[i] = (cells[i]?.trim() || below[i]?.trim() || '');

  const at: Partial<Record<Field, number>> = {};
  merged.forEach((label, i) => {
    const key = norm(label);
    if (!key) return;
    for (const field of Object.keys(LABELS) as Field[]) {
      if (at[field] !== undefined) continue;
      if (LABELS[field].includes(key)) at[field] = i + 1;
    }
  });

  // A name is the one column a plan cannot do without.
  if (at.name === undefined) return null;

  const endsAt = planEndsAt(rows, Math.max(...Object.values(at)));
  for (const field of Object.keys(at) as Field[]) {
    if ((at[field] ?? 0) >= endsAt) delete at[field];
  }
  if (at.name === undefined) return null;

  // What a plan needs, weighted by how much it says. Dates together are worth
  // as much as the names, because a schedule without them is a list.
  let score = 3;
  if (at.code !== undefined) score += 2;
  if (at.start !== undefined && at.finish !== undefined) score += 3;
  else if (at.start !== undefined || at.finish !== undefined) score += 1;
  if (at.price !== undefined) score += 1;

  return { row: rowNo, at, endsAt, score, labels: merged };
}

/** The name is a nudge, never a gate. */
const SHEET_HINTS = ['dataoverall', 'wbs', 'schedule', 'jadwal', 'plan', 'rencana', 'boq', 'rab', 'master'];

/* ------------------------------------------------------------------ read */

interface Candidate {
  name: string;
  header: Header;
  grid: string[][];
  score: number;
}

export async function readPlanWorkbook(
  source: Readable,
  /** Force a sheet by name, for when a person overrules the choice. */
  want?: string | null
): Promise<PlanWorkbookRead> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    // Styles are CACHED, not ignored, and that is measured rather than assumed:
    // on this project's 6.8 MB weekly workbook it costs 1.5 s and 63 MB either
    // way, and on W56 20 s and 78 MB either way. The 2 GB heap this repo
    // remembers came from `readFile` swallowing a whole workbook, not from
    // styles. What they buy is `alignment.indent`, which is where a plan with
    // no outline code keeps its hierarchy.
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit',
  });

  const sheets: string[] = [];
  const candidates: Candidate[] = [];
  const banner: PlanWorkbookRead['banner'] = {
    contractNo: null, projectName: null, clientName: null, weeklyNo: null,
  };

  for await (const sheet of reader) {
    const worksheet = sheet as NamedWorksheetReader;
    const name = worksheet.name ?? `Sheet ${sheets.length + 1}`;
    sheets.push(name);

    const head = new Map<number, string[]>();
    const early: { number: number; cells: RawCell[] }[] = [];
    let header: Header | null = null;
    const grid: string[][] = [];

    /**
     * A row is kept when the name column has something in it. The outline code
     * decides DEPTH downstream and nothing else, so requiring one here is what
     * made a plan numbered `A`, or numbered not at all, come in as zero rows.
     */
    const take = (rowNo: number, cells: RawCell[]) => {
      if (!header || rowNo <= header.row || grid.length >= MAX_ROWS) return;
      if (!flat(cells[header.at.name! - 1]?.v)) return;
      const line: string[] = [];
      for (let c = 1; c < header.endsAt; c += 1) {
        const raw = cells[c - 1];
        const cell = indented(text(raw?.v), raw?.indent ?? 0);
        const bare = stripWeekday(cell);
        // A weekday is only in the way when a date is behind it.
        const clean = bare && (asProjectDate(bare) || looksLikeDate(bare)) ? bare : cell;
        line.push(asProjectDate(clean) ?? clean);
      }
      grid.push(line);
    };

    for await (const row of worksheet) {
      // The banner a weekly report prints over itself. Read from any sheet
      // that carries it rather than from one particular name.
      if (row.number <= 12) {
        for (let c = 1; c <= Math.min(row.cellCount, 12); c += 1) {
          const label = flat(row.getCell(c).value);
          if (!label) continue;
          const key = norm(label);
          const after = () => label.split(':').slice(1).join(':').trim() || null;
          if (!banner.contractNo && key.startsWith('contractno')) banner.contractNo = after();
          else if (!banner.projectName && key.startsWith('projectname')) banner.projectName = after();
          else if (!banner.clientName && key.startsWith('customer')) banner.clientName = after();
          else if (!banner.weeklyNo && key.startsWith('weeklyno')) {
            banner.weeklyNo = after() ?? (flat(row.getCell(c + 1).value) || null);
          }
        }
      }

      if (!header) {
        const cells: RawCell[] = [];
        for (let c = 1; c <= row.cellCount; c += 1) cells[c - 1] = cellOf(row.getCell(c));
        head.set(row.number, cells.map((x) => text(x.v)));
        early.push({ number: row.number, cells });
        if (row.number < HEADER_SCAN_ROWS) continue;
        // Settled ONCE, against every scanned row: the label a column needs
        // may sit a row lower than the one naming the WBS column, and the week
        // labels that say where the plan ends sit lower still.
        header = bestHeader(head);
        if (header) {
          for (const e of early) take(e.number, e.cells);
        }
        early.length = 0;
        continue;
      }

      const cells: RawCell[] = [];
      for (let c = 1; c < header.endsAt; c += 1) cells[c - 1] = cellOf(row.getCell(c));
      take(row.number, cells);
    }

    // A sheet shorter than the scan window never reached the settle above.
    if (!header && head.size > 0) {
      header = bestHeader(head);
      if (header) for (const e of early) take(e.number, e.cells);
    }

    if (!header || grid.length === 0) continue;
    candidates.push({ name, header, grid, score: scoreSheet(name, header, grid) });
  }

  if (sheets.length === 0) throw new Error('That file has no sheets in it');
  candidates.sort((a, b) => b.score - a.score);

  const picked = want
    ? candidates.find((c) => c.name === want) ?? candidates[0]
    : candidates[0];
  if (!picked) {
    throw new Error(
      `No sheet in this file looks like a plan. A plan needs a column of task names. The sheets are: ${sheets.slice(0, 10).join(', ')}`
    );
  }

  const { header, grid } = picked;
  const columns: PlanColumn[] = [];
  for (let c = 1; c < header.endsAt; c += 1) {
    const sample: string[] = [];
    for (const line of grid) {
      const v = (line[c - 1] ?? '').trim();
      if (v && sample.length < 3) sample.push(v);
      if (sample.length === 3) break;
    }
    columns.push({ at: c, label: header.labels[c - 1] ?? '', sample });
  }

  const mapping: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(LABELS) as Field[]) {
    const at = header.at[field];
    if (at !== undefined) mapping[field] = at - 1;
  }

  const notes: string[] = [];
  notes.push(`Read from the sheet “${picked.name}”, with the header on row ${header.row}.`);
  if (candidates.length > 1) {
    notes.push(
      `${candidates.length} sheets could have held a plan; this one scored highest. Change it above if it is the wrong one.`
    );
  }
  if (Number.isFinite(header.endsAt) && header.endsAt <= MAX_PLAN_COLUMNS) {
    notes.push(
      `Column ${header.endsAt} onwards looked like weekly progress rather than plan, so it was left alone.`
    );
  }
  if (mapping.code === undefined) {
    notes.push('No outline code column was found, so depth will come from the indentation in the names.');
  }
  if (mapping.start === undefined || mapping.finish === undefined) {
    notes.push('No start or finish column was found, so the rows arrive without dates.');
  }
  if (mapping.price === undefined) {
    notes.push('No price column was found, so weights cannot be derived from this file yet.');
  }
  notes.push('Any weight column was ignored on purpose: weight is computed here from price over contract value, not copied.');

  return {
    sheet: picked.name,
    candidates: candidates.map((c) => ({ name: c.name, rows: c.grid.length, score: Number(c.score.toFixed(2)) })),
    sheets,
    columns,
    grid,
    mapping,
    notes,
    banner,
  };
}

/** Up to this many values decide what a column actually holds. */
const SAMPLE = 30;

function sampleOf(grid: string[][], column: number | undefined): string[] {
  if (column === undefined) return [];
  const out: string[] = [];
  for (const row of grid) {
    const v = (row[column - 1] ?? '').trim();
    if (v) out.push(v);
    if (out.length === SAMPLE) break;
  }
  return out;
}

function mostly(values: string[], test: (s: string) => boolean): boolean {
  if (values.length === 0) return false;
  return values.filter(test).length / values.length >= 0.6;
}

/**
 * How much a sheet looks like a plan, judged on its VALUES.
 *
 * The header alone is not enough and W1 of this project is why: its S-curve
 * sheet has a column headed `Start`, and scoring the label gave it three
 * points for dates it did not have. A column earns the date points by holding
 * dates.
 *
 * Row count is a TIE-BREAKER and never more. "Detail Overall" has MORE rows
 * than "Data Overall" and no dates at all, so a score led by row count picks
 * the wrong sheet in the very file this was written for. The sheet's NAME is
 * worth a nudge on top, for when two sheets are otherwise equal.
 */
function scoreSheet(name: string, header: Header, grid: string[][]): number {
  let score = 3; // it has names, which is the one thing it could not be without

  const codes = sampleOf(grid, header.at.code);
  if (mostly(codes, (c) => CODE_RE.test(c))) score += 2;

  const starts = sampleOf(grid, header.at.start);
  const finishes = sampleOf(grid, header.at.finish);
  const hasStart = mostly(starts, looksLikeDate);
  const hasFinish = mostly(finishes, looksLikeDate);
  if (hasStart && hasFinish) score += 3;
  else if (hasStart || hasFinish) score += 1;

  const prices = sampleOf(grid, header.at.price);
  if (prices.some((p) => Number(p.replace(/[^0-9.-]/g, '')) > 0)) score += 1;

  if (SHEET_HINTS.some((h) => norm(name).includes(h))) score += 1.5;
  return score + Math.min(grid.length, 500) / 500;
}

/** Every scanned row is tried as the header and the best-scoring one wins. */
function bestHeader(rows: Map<number, string[]>): Header | null {
  let best: Header | null = null;
  for (const [rowNo] of rows) {
    const candidate = headerAt(rows, rowNo);
    if (!candidate) continue;
    // On a TIE the later row wins, because a header stacked two rows deep
    // resolves to the same labels from either tier and the data begins under
    // the LOWER one. Taking the upper tier made W56's own header row come in
    // as a task called "Description".
    if (!best || candidate.score >= best.score) best = candidate;
  }
  return best;
}
