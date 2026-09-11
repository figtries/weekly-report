/**
 * Reading a plan off the clipboard.
 *
 * This is the one thing standing between the app and a real project. Gundih is
 * 285 rows; nobody types 285 rows. They already exist, in a workbook, and the
 * shortest honest path from there to here is Ctrl+C.
 *
 * Everything in this file is PURE — no database, no React. It takes the text
 * Excel puts on the clipboard and returns rows plus an account of every guess
 * it made, so `scripts/verify-paste.ts` can run the real workbook through it and
 * the UI can show a person what it understood before anything is written.
 *
 * Three problems, and the decisions taken on each.
 *
 * **Which column is which.** A header row is read when there is one, matched
 * against English AND Indonesian names because the workbooks these people have
 * are Indonesian. With no header the columns are guessed from their contents —
 * the one that is mostly prose is the name, the ones that are mostly dates are
 * start and finish, and so on. Every guess is reported.
 *
 * **How deep each row sits.** Two signals, and the outline code wins when it is
 * there: `1.4.3.2` is unambiguous, whereas indentation survives a copy only if
 * the author typed spaces. A depth may never jump more than one level past its
 * predecessor — a tree cannot have a grandchild with no parent — so a jump is
 * clamped and said out loud.
 *
 * **What a number means.** `1.234.567,89` and `1,234,567.89` are the same
 * amount written by two different offices, and `03/04/2026` is two different
 * days. The rule for numbers is that the LAST separator is the decimal one. The
 * rule for dates is decided per column from the whole column: a day above 12
 * anywhere settles it, and if nothing settles it the app says which order it
 * assumed rather than picking silently.
 */

export interface ParsedRow {
  /** Relative to the shallowest row in the paste; always walkable, never jumps. */
  depth: number;
  name: string;
  /** The outline code as written in the source, kept only to explain the depth. */
  sourceCode: string | null;
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
  targetDate: string | null;
  price: number | null;
  isMilestone: boolean;
}

export type Col = 'code' | 'name' | 'start' | 'finish' | 'duration' | 'target' | 'price';

export interface ParseResult {
  rows: ParsedRow[];
  /** Which source column index fed each field, for the preview to name. */
  columns: Partial<Record<Col, number>>;
  depthFrom: 'code' | 'indent' | 'flat';
  headerSkipped: boolean;
  /** Sentences describing every assumption. Shown to the person before writing. */
  notes: string[];
  /** Source lines that produced nothing, with their line number. */
  skipped: { line: number; text: string }[];
}

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ header */

/**
 * Both languages, because a header written `Uraian Pekerjaan` is far more likely
 * in these workbooks than one written `Task Name`. Matched on a normalised
 * string so `NO.` and `no` are the same word.
 */
const HEADERS: Record<Col, string[]> = {
  code: ['wbs', 'wbscode', 'code', 'kode', 'no', 'nomor', 'item', 'id'],
  name: [
    'taskname', 'task', 'name', 'activity', 'description', 'desc',
    'deskripsi', 'uraian', 'uraianpekerjaan', 'pekerjaan', 'kegiatan', 'namatugas',
  ],
  start: ['start', 'startdate', 'begin', 'mulai', 'tanggalmulai', 'tglmulai', 'awal'],
  finish: ['finish', 'finishdate', 'end', 'enddate', 'selesai', 'tanggalselesai', 'tglselesai', 'akhir'],
  duration: ['duration', 'days', 'dur', 'durasi', 'hari', 'jumlahhari', 'lamahari'],
  target: ['target', 'targetdate', 'deadline', 'batas', 'tanggaltarget', 'targetselesai'],
  price: ['price', 'value', 'amount', 'cost', 'harga', 'nilai', 'jumlah', 'hargasatuan', 'total'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* -------------------------------------------------------------------- date */

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];
/** Indonesian month names, since half these workbooks are written in it. */
const MONTHS_ID = [
  'jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des',
];

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // Rejects 31 February rather than letting it roll into March.
  if (back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fullYear(y: number): number {
  if (y >= 1000) return y;
  // A two-digit year in a construction schedule is this century. 70 is the
  // usual pivot and no EPC plan reaches 2069.
  return y < 70 ? 2000 + y : 1900 + y;
}

/** Everything a cell might be, EXCEPT the two orders that need the column to decide. */
function parseUnambiguousDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const isoM = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (isoM) return iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3]));

  // 27 Oct 25 · 27-Oct-2025 · 5 Des 26
  const nameM = /^(\d{1,2})[\s\-/]*([A-Za-z]{3,})[\s\-/]*(\d{2,4})$/.exec(s);
  if (nameM) {
    const key = norm(nameM[2]).slice(0, 3);
    let m = MONTHS.indexOf(key);
    if (m < 0) m = MONTHS_ID.indexOf(key);
    if (m >= 0) return iso(fullYear(Number(nameM[3])), m + 1, Number(nameM[1]));
  }

  // Excel writes a date as days since 1899-12-30 when the cell is copied as a
  // value rather than as text. The window is deliberately narrow — 1990 to
  // 2079 — so a duration of 45 or a price of 57200 is never mistaken for one.
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n >= 32874 && n <= 65380) {
      return new Date(Date.UTC(1899, 11, 30) + n * MS_PER_DAY).toISOString().slice(0, 10);
    }
  }
  return null;
}

type DateOrder = 'dmy' | 'mdy';

function parseSlashDate(raw: string, order: DateOrder): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(raw.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = fullYear(Number(m[3]));
  return order === 'dmy' ? iso(y, b, a) : iso(y, a, b);
}

/**
 * Which way round a column of `03/04/2026` runs.
 *
 * A first part above 12 can only be a day; a second part above 12 can only be a
 * day the other way round. If the whole column is ambiguous nothing here can
 * know, so it returns null and the caller says which order it assumed.
 */
function detectDateOrder(values: string[]): DateOrder | null {
  let firstOver = false;
  let secondOver = false;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver = true;
    if (Number(m[2]) > 12) secondOver = true;
  }
  if (firstOver && !secondOver) return 'dmy';
  if (secondOver && !firstOver) return 'mdy';
  return null;
}

/** Exported for `lib/plan-xlsx.ts`, which scores a workbook column on whether
 * its VALUES are dates rather than on what its header calls them. */
export function looksLikeDate(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (parseUnambiguousDate(t)) return true;
  return /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t);
}

/* ------------------------------------------------------------------ number */

/**
 * One amount, however the office that typed it writes its separators.
 *
 * Three cases, in this order:
 *
 * **Both `.` and `,` appear.** Whichever comes LAST is the decimal point and
 * the other is thousands. `1,234,567.89` and `1.234.567,89` are the same money
 * written by two different offices and both read correctly.
 *
 * **One kind, used more than once.** `1,837,809` is thousands — separators
 * repeat only when they group. This case cost a run: the earlier rule looked at
 * the LAST separator alone and read that as 1,837.809, losing a whole SPK from
 * Gundih's total.
 *
 * **One kind, used once.** Three digits after it and at most three before is
 * thousands (`57.200`, `1,234`); anything else is a decimal point (`0.97`,
 * `842723.72448`). `57.200` is genuinely ambiguous — 57.2 in London, 57,200 in
 * Jakarta — and thousands wins because a priced line of an EPC contract is not
 * fifty-seven dollars. `parsePaste` says so in its notes when the column
 * contains one.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let n: number;
  if (dots === 0 && commas === 0) {
    n = Number(s);
  } else if (dots > 0 && commas > 0) {
    const cut = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    n = Number(s.slice(0, cut).replace(/[.,]/g, '') + '.' + s.slice(cut + 1));
  } else {
    const sep = dots > 0 ? '.' : ',';
    const parts = s.split(sep);
    const groupsLookLikeThousands =
      parts.length > 2 && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3;
    const singleThousand =
      parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0].length > 0;
    if (groupsLookLikeThousands || singleThousand) {
      n = Number(parts.join(''));
    } else {
      n = Number(parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]);
    }
  }
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** `57.200` — three digits after a single separator, which two offices read two ways. */
function isAmbiguousThousand(s: string): boolean {
  return /^\d{1,3}[.,]\d{3}$/.test(s.trim().replace(/[^\d.,]/g, ''));
}

function looksLikeNumber(s: string): boolean {
  const t = s.trim();
  return t !== '' && /^[^A-Za-z]*\d[\d.,\s-]*$/.test(t) && parseAmount(t) !== null;
}

/* ------------------------------------------------------------------- split */

/**
 * Excel puts TABS on the clipboard, always. Commas are accepted too because
 * people paste out of a saved .csv, but only when a line has no tab at all —
 * guessing per line is how a task named "Piping, mechanical" becomes two rows.
 */
function splitCells(line: string, delimiter: '\t' | ','): string[] {
  if (delimiter === '\t') return line.split('\t');
  // Minimal CSV: quotes protect a comma, "" is an escaped quote.
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/* ------------------------------------------------------------------- parse */

const CODE_RE = /^\d+(\.\d+)*\.?$/;

/**
 * Does this column of dotted numbers actually describe an outline?
 *
 * `57.200` and `418.400` match the shape of `1.1` perfectly, so shape alone
 * once claimed a price column as the outline and pushed a whole plan flat. The
 * property money can never have is CONTAINMENT: an outline holds a value that
 * is the prefix of a later one — `1` before `1.1`, or `1.2` before `1.2.1`.
 * That, plus every value being distinct, is what makes a column an outline.
 */
function isOutline(values: string[]): boolean {
  const clean = values.map((v) => v.trim().replace(/\.$/, '')).filter((v) => CODE_RE.test(v));
  if (clean.length < 2) return false;
  if (new Set(clean).size !== clean.length) return false;
  for (let i = 0; i < clean.length; i += 1) {
    for (let j = i + 1; j < clean.length; j += 1) {
      if (clean[j].startsWith(clean[i] + '.')) return true;
    }
  }
  return false;
}

export function parsePaste(text: string): ParseResult {
  const notes: string[] = [];
  const skipped: { line: number; text: string }[] = [];

  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const delimiter: '\t' | ',' = rawLines.some((l) => l.includes('\t')) ? '\t' : ',';
  if (delimiter === ',') {
    notes.push('No tabs found, so the text was read as comma-separated.');
  }

  const grid = rawLines
    .map((text, i) => ({ line: i + 1, text, cells: splitCells(text, delimiter) }))
    .filter((r) => {
      if (r.text.trim() === '') return false;
      if (r.cells.every((c) => c.trim() === '')) return false;
      return true;
    });

  if (grid.length === 0) {
    return { rows: [], columns: {}, depthFrom: 'flat', headerSkipped: false, notes, skipped };
  }

  const width = Math.max(...grid.map((r) => r.cells.length));
  const columns: Partial<Record<Col, number>> = {};

  /* --- the header, if there is one --------------------------------------- */

  let headerSkipped = false;
  const first = grid[0].cells;
  const fromHeader: Partial<Record<Col, number>> = {};
  first.forEach((cell, i) => {
    const key = norm(cell);
    if (!key) return;
    for (const col of Object.keys(HEADERS) as Col[]) {
      if (fromHeader[col] !== undefined) continue;
      if (HEADERS[col].includes(key)) {
        fromHeader[col] = i;
        return;
      }
    }
  });
  // Two matches is the threshold: one word landing on a synonym is a
  // coincidence a real first task can produce ("Mobilisasi" is not a header,
  // but a single cell reading "No" might be).
  if (Object.keys(fromHeader).length >= 2) {
    Object.assign(columns, fromHeader);
    headerSkipped = true;
    grid.shift();
    notes.push(
      `The first line was read as a header: ${Object.entries(fromHeader)
        .map(([c, i]) => `${c} = column ${(i as number) + 1}`)
        .join(', ')}.`
    );
  }

  const body = grid;
  if (body.length === 0) {
    return { rows: [], columns, depthFrom: 'flat', headerSkipped, notes, skipped };
  }

  const colValues = (i: number) => body.map((r) => (r.cells[i] ?? '').trim());
  const share = (i: number, pred: (s: string) => boolean) => {
    const vals = colValues(i).filter((v) => v !== '');
    if (vals.length === 0) return 0;
    return vals.filter(pred).length / vals.length;
  };

  /* --- guessing whatever the header did not give ------------------------- */

  const taken = new Set(Object.values(columns));
  const free = (i: number) => !taken.has(i);
  const claim = (col: Col, i: number) => {
    columns[col] = i;
    taken.add(i);
  };

  if (columns.code === undefined) {
    for (let i = 0; i < width; i += 1) {
      if (!free(i)) continue;
      if (share(i, (v) => CODE_RE.test(v)) < 0.8) continue;
      if (!isOutline(colValues(i))) continue;
      claim('code', i);
      notes.push(`Column ${i + 1} is an outline of dotted numbers, so it was read as the code.`);
      break;
    }
  }

  if (columns.name === undefined) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < width; i += 1) {
      if (!free(i)) continue;
      const score = share(i, (v) => /[A-Za-z]{3}/.test(v) && !looksLikeDate(v));
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 0.5) {
      claim('name', best);
      notes.push(`Column ${best + 1} is mostly words, so it was read as the task name.`);
    }
  }

  if (columns.start === undefined || columns.finish === undefined) {
    const dateCols: number[] = [];
    for (let i = 0; i < width; i += 1) {
      if (!free(i)) continue;
      if (share(i, looksLikeDate) >= 0.6) dateCols.push(i);
    }
    if (columns.start === undefined && dateCols[0] !== undefined) {
      claim('start', dateCols[0]);
      notes.push(`Column ${dateCols[0] + 1} is dates, so it was read as the start.`);
    }
    const rest = dateCols.filter(free);
    if (columns.finish === undefined && rest[0] !== undefined) {
      claim('finish', rest[0]);
      notes.push(`Column ${rest[0] + 1} is dates, so it was read as the finish.`);
    }
  }

  if (columns.price === undefined) {
    // The biggest column of numbers is the money: a duration is days and a
    // weight is a percentage, and neither reaches six figures.
    let best = -1;
    let bestMax = 0;
    for (let i = 0; i < width; i += 1) {
      if (!free(i)) continue;
      if (share(i, looksLikeNumber) < 0.6) continue;
      const max = Math.max(
        0,
        ...colValues(i).map((v) => parseAmount(v) ?? 0)
      );
      if (max > bestMax) {
        bestMax = max;
        best = i;
      }
    }
    if (best >= 0 && bestMax >= 1000) {
      claim('price', best);
      notes.push(`Column ${best + 1} holds the largest numbers, so it was read as the price.`);
    }
  }

  if (columns.price !== undefined) {
    const n = colValues(columns.price).filter(isAmbiguousThousand).length;
    if (n > 0) {
      notes.push(
        `${n} price${n === 1 ? '' : 's'} look like 57.200, which is 57.2 in one country and 57,200 in another. They were read as thousands.`
      );
    }
  }

  if (columns.duration === undefined) {
    for (let i = 0; i < width; i += 1) {
      if (!free(i)) continue;
      if (share(i, (v) => /^\d{1,4}$/.test(v)) >= 0.7) {
        claim('duration', i);
        notes.push(`Column ${i + 1} is small whole numbers, so it was read as the duration.`);
        break;
      }
    }
  }

  if (columns.name === undefined) {
    notes.push('No column looked like a task name, so the first column was used.');
    columns.name = 0;
  }

  /* --- date order, decided per column ------------------------------------ */

  const orderFor = (col: Col, label: string): DateOrder => {
    const i = columns[col];
    if (i === undefined) return 'dmy';
    const found = detectDateOrder(colValues(i));
    if (found) return found;
    if (colValues(i).some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(v))) {
      notes.push(`Nothing in the ${label} column settles day-first or month-first, so day-first (31/12/2026) was assumed.`);
    }
    return 'dmy';
  };
  const startOrder = orderFor('start', 'start');
  const finishOrder = orderFor('finish', 'finish');
  const targetOrder = orderFor('target', 'target');

  const readDate = (raw: string | undefined, order: DateOrder): string | null => {
    if (!raw) return null;
    return parseUnambiguousDate(raw) ?? parseSlashDate(raw, order);
  };

  /* --- depth -------------------------------------------------------------- */

  const nameCol = columns.name!;
  const codeCol = columns.code;

  let depths: number[];
  let depthFrom: ParseResult['depthFrom'];

  const codes = codeCol === undefined ? [] : colValues(codeCol);
  const codesUsable =
    codeCol !== undefined &&
    codes.filter((c) => CODE_RE.test(c)).length / codes.length >= 0.8 &&
    codes.some((c) => c.includes('.'));

  if (codesUsable) {
    depthFrom = 'code';
    depths = codes.map((c) => (CODE_RE.test(c) ? c.replace(/\.$/, '').split('.').length - 1 : 0));
    notes.push('Depth came from the outline code, so 1.4.3 is three levels in.');
  } else {
    // Leading whitespace, if any survived the copy. The unit is the smallest
    // non-zero indent seen, so both two-space and four-space files work.
    const indents = body.map((r) => {
      const raw = r.cells[nameCol] ?? '';
      const m = /^[\s ]*/.exec(raw)![0];
      // A tab inside a cell cannot happen (it is the delimiter), so this is
      // spaces and non-breaking spaces only.
      return m.length;
    });
    const unit = Math.min(...indents.filter((n) => n > 0).concat([Infinity]));
    if (Number.isFinite(unit) && unit > 0) {
      depthFrom = 'indent';
      depths = indents.map((n) => Math.round(n / unit));
      notes.push(`Depth came from the leading spaces, at ${unit} space${unit === 1 ? '' : 's'} per level.`);
    } else {
      depthFrom = 'flat';
      depths = body.map(() => 0);
      notes.push('Nothing said how deep each row sits, so every row came in flat. Indent them with Tab afterwards.');
    }
  }

  // Normalise to zero and forbid a jump: a tree cannot have a grandchild whose
  // parent was never pasted, and a paste that starts at 1.4.3 should still land
  // as a flat-topped block rather than three levels of nothing.
  const min = Math.min(...depths);
  depths = depths.map((d) => d - min);
  let clamped = 0;
  for (let i = 0; i < depths.length; i += 1) {
    const ceiling = i === 0 ? 0 : depths[i - 1] + 1;
    if (depths[i] > ceiling) {
      depths[i] = ceiling;
      clamped += 1;
    }
  }
  if (clamped > 0) {
    notes.push(`${clamped} row${clamped === 1 ? '' : 's'} skipped a level and w${clamped === 1 ? 'as' : 'ere'} pulled up to sit under the row above.`);
  }

  /* --- the rows ----------------------------------------------------------- */

  const rows: ParsedRow[] = [];
  body.forEach((r, i) => {
    const name = (r.cells[nameCol] ?? '').trim();
    if (!name) {
      skipped.push({ line: r.line, text: r.text.trim().slice(0, 80) });
      return;
    }
    const start = readDate(r.cells[columns.start ?? -1], startOrder);
    const finish = readDate(r.cells[columns.finish ?? -1], finishOrder);
    const target = readDate(r.cells[columns.target ?? -1], targetOrder);
    const durRaw = columns.duration === undefined ? '' : (r.cells[columns.duration] ?? '').trim();
    const duration = durRaw === '' ? null : Math.round(parseAmount(durRaw) ?? NaN);
    const priceRaw = columns.price === undefined ? '' : (r.cells[columns.price] ?? '').trim();
    const price = priceRaw === '' ? null : parseAmount(priceRaw);

    rows.push({
      depth: depths[i],
      name,
      sourceCode: codeCol === undefined ? null : (r.cells[codeCol] ?? '').trim() || null,
      startDate: start,
      finishDate: finish,
      durationDays: duration != null && Number.isFinite(duration) ? duration : null,
      targetDate: target,
      price: price != null && Number.isFinite(price) && price >= 0 ? price : null,
      // A zero-day row is a point in time. MS Project stores a milestone exactly
      // this way, and so does every workbook exported from it.
      isMilestone: duration === 0 || (!!start && !!finish && start === finish && duration === 0),
    });
  });

  if (skipped.length > 0) {
    notes.push(`${skipped.length} line${skipped.length === 1 ? '' : 's'} had no name and w${skipped.length === 1 ? 'as' : 'ere'} left out.`);
  }

  return { rows, columns, depthFrom, headerSkipped, notes, skipped };
}

/**
 * Fill in whichever of duration / start / finish the paste did not carry.
 *
 * A workbook usually has two of the three. With a start and a duration the
 * finish is arithmetic; with a start and a finish the duration is. A row that
 * has only a start lasts a day, which is what a new row does here anyway. A row
 * with no dates at all is left with none — inventing a schedule for it would be
 * a guess wearing a date's clothes.
 */
export function completeDates(row: ParsedRow): {
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
} {
  const { startDate, finishDate, durationDays } = row;
  const day = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const add = (s: string, n: number) => new Date(day(s) + n * MS_PER_DAY).toISOString().slice(0, 10);

  if (startDate && finishDate) {
    return {
      startDate,
      finishDate,
      durationDays: Math.round((day(finishDate) - day(startDate)) / MS_PER_DAY) + 1,
    };
  }
  if (startDate && durationDays != null && durationDays > 0) {
    return { startDate, finishDate: add(startDate, durationDays - 1), durationDays };
  }
  if (startDate) return { startDate, finishDate: startDate, durationDays: 1 };
  if (finishDate && durationDays != null && durationDays > 0) {
    return { startDate: add(finishDate, -(durationDays - 1)), finishDate, durationDays };
  }
  if (finishDate) return { startDate: finishDate, finishDate, durationDays: 1 };
  return { startDate: null, finishDate: null, durationDays: durationDays ?? null };
}
