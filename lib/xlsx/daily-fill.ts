import { hoursEachOf, todayItemsOf, tomorrowItemsOf } from '../daily-items';
import type { DailyProgress } from '../daily-progress';
import type { DailyReport, HseRow, ManHourRow, NonEffectiveRow } from '../types';
import { excelSerial } from './addr';
import { CELLS, CHARS_PER_UNIT, LINE_PT } from './daily-cells';
import type { SheetXml } from './sheet-xml';

/**
 * A daily report, written into the client's workbook.
 *
 * Pure: it edits a `SheetXml` and says what it could not fit. Nothing here knows
 * about zips, checkboxes or HTTP (`daily-export.ts` does).
 */

export interface DailyExportInput {
  project: {
    name: string;
    contractNo: string;
    customer: string;
    contractor: string;
    workLocation: string;
    documentNoDaily: string;
    /** As the project stores them: the CLIENT on the left, the contractor on the right. */
    signatureLeft: { company: string; name: string };
    signatureRight: { company: string; name: string };
  };
  report: DailyReport;
  /** The day of the project, counted from week one's first day. Null when the project has no plan. */
  dayNo: number | null;
  /** The weekly figures for this day's week (lib/daily-progress.ts). */
  progress: DailyProgress | null;
}

export type OverflowBlock = 'crew' | 'nonEffective' | 'ptw' | 'hse' | 'activitiesToday' | 'activitiesTomorrow' | 'aoc';

export interface Overflow {
  block: OverflowBlock;
  total: number;
  capacity: number;
}

export type Condition = keyof typeof CELLS.weather;

export interface FillResult {
  overflow: Overflow[];
  /** Which weather checkboxes to tick. */
  weather: Record<Condition, boolean>;
}

/* --------------------------------------------------------------- helpers */

const at = (col: string, row: number) => `${col}${row}`;

function putText(sheet: SheetXml, addr: string, text: string) {
  if (text.trim() === '') sheet.clear(addr);
  else sheet.setText(addr, text);
}

/** A date as its Excel serial, else the text as typed, else empty. */
function putDate(sheet: SheetXml, addr: string, iso: string) {
  const n = excelSerial(iso);
  if (n !== null) sheet.setNumber(addr, n);
  else putText(sheet, addr, iso);
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);

/**
 * Numeric tables keep their totals right when there are more rows than the sheet
 * holds: the overflow is folded into the last row as "Lainnya (N)" with the summed
 * figures, so the sheet's own SUMs still add up to the app's.
 */
function fold<T>(rows: T[], capacity: number, merge: (rest: T[]) => T): { shown: T[]; folded: number } {
  if (rows.length <= capacity) return { shown: rows, folded: 0 };
  const rest = rows.slice(capacity - 1);
  return { shown: [...rows.slice(0, capacity - 1), merge(rest)], folded: rest.length };
}

/** Text lists show the first N-1 and end with "+N lagi (lihat app)". */
function clip<T>(rows: T[], capacity: number): { shown: T[]; hidden: number } {
  if (rows.length <= capacity) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, capacity - 1), hidden: rows.length - (capacity - 1) };
}

const more = (n: number) => `+${n} lagi (lihat app)`;

/**
 * Wrapped lines a text needs in a cell of `units` column-width units. A deliberately
 * cautious guess (the font is Arial 12 pt): too tall wastes a little paper, too short
 * clips a sentence.
 */
export function linesFor(text: string, units: number): number {
  const per = Math.max(1, Math.floor(units * CHARS_PER_UNIT));
  return text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.length / per)), 0);
}

/** The sheet's row heights are set by hand to fit the text; a row grows to fit ours, never below the template's. */
function grow(sheet: SheetXml, row: number, cells: Array<[text: string, addr: string]>) {
  let need = 0;
  for (const [text, addr] of cells) {
    if (!text) continue;
    const ref = sheet.mergeAt(addr) ?? addr;
    need = Math.max(need, linesFor(text, sheet.widthOf(ref)) * LINE_PT + 3);
  }
  const have = sheet.rowHeight(row) ?? 13.2;
  if (need > have) sheet.setRowHeight(row, Math.min(409, need));
}

/* ------------------------------------------------------------------ fill */

export function fillDailySheet(sheet: SheetXml, input: DailyExportInput): FillResult {
  const { project, report } = input;
  const overflow: Overflow[] = [];

  /* header */
  // The workbook's own two runs (Arial 16 bold; the first underlined), the work description on a line of its own.
  const arial = '<family val="2"/></rPr>';
  sheet.setRich(CELLS.title, [
    { text: 'DAILY REPORT\n', props: `<rPr><b/><u/><sz val="16"/><rFont val="Arial"/>${arial}` },
    { text: project.name, props: `<rPr><b/><sz val="16"/><rFont val="Arial"/>${arial}` },
  ]);
  putDate(sheet, CELLS.date, report.date);
  if (input.dayNo === null) sheet.clear(CELLS.dayNo);
  else sheet.setNumber(CELLS.dayNo, input.dayNo);
  putText(sheet, CELLS.contractor, project.contractor ? ` ${project.contractor}` : '');
  putText(sheet, CELLS.contractNo, project.contractNo);
  putText(sheet, CELLS.location, project.workLocation ? ` ${project.workLocation}` : '');
  putText(sheet, CELLS.client, project.customer ? `: ${project.customer}` : '');
  putText(sheet, CELLS.docNo, project.documentNoDaily ? `: ${project.documentNoDaily}` : '');

  /* weather: a picked condition takes the day's working hours, the rest keep the template's zeros */
  const w = report.weather;
  const picked: Record<Condition, boolean> = {
    hujanDeras: w.hujanDeras,
    hujanSedang: w.hujanSedang,
    berawanMendung: w.berawanMendung,
    cerahTerang: w.cerahTerang,
  };
  for (const key of Object.keys(CELLS.weather) as Condition[]) {
    const c = CELLS.weather[key];
    if (picked[key]) {
      putText(sheet, c.start, w.waktuMulai);
      putText(sheet, c.end, w.waktuSelesai);
    } else {
      sheet.setText(c.start, key === 'hujanDeras' ? '0.00' : '00.00');
      sheet.setText(c.end, '00.00');
    }
  }

  /* crew */
  {
    const cfg = CELLS.crew;
    const { shown, folded } = fold<ManHourRow>(report.manHours, cfg.rows.length, (rest) => ({
      id: 'fold',
      company: `Lainnya (${rest.length})`,
      pobQty: sum(rest, (r) => r.pobQty),
      previousHours: sum(rest, (r) => r.previousHours),
      todayHours: sum(rest, (r) => r.todayHours),
    }));
    if (folded) overflow.push({ block: 'crew', total: report.manHours.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const r = shown[i];
      const [b, c, e, f, g, h] = [cfg.no, cfg.name, cfg.pob, cfg.prev, cfg.today, cfg.total].map((col) => at(col, row));
      if (!r) {
        for (const a of [b, c, e, f, g, h]) sheet.clear(a);
        return;
      }
      const each = r.id === 'fold' ? 0 : hoursEachOf(r);
      sheet.setNumber(b, i + 1);
      putText(sheet, c, r.company);
      sheet.setNumber(e, r.pobQty);
      sheet.setNumber(f, r.previousHours);
      // Hours follow people when the row says how many hours each: the workbook's own formula.
      if (each > 0 && r.pobQty * each === r.todayHours) {
        sheet.setFormula(g, `${e}*${each}`);
        sheet.setCached(g, r.todayHours);
      } else {
        sheet.setNumber(g, r.todayHours);
      }
      sheet.setCached(h, r.previousHours + r.todayHours);
    });
    sheet.setCached(`E${cfg.totalsRow}`, sum(shown, (r) => r.pobQty));
    sheet.setCached(`F${cfg.totalsRow}`, sum(shown, (r) => r.previousHours));
    sheet.setCached(`G${cfg.totalsRow}`, sum(shown, (r) => r.todayHours));
    sheet.setCached(`H${cfg.totalsRow}`, sum(shown, (r) => r.previousHours + r.todayHours));
  }

  /* non effective working hours */
  {
    const cfg = CELLS.nonEffective;
    const { shown, folded } = fold<NonEffectiveRow>(report.nonEffective, cfg.rows.length, (rest) => ({
      id: 'fold',
      cause: `Lainnya (${rest.length})`,
      previous: sum(rest, (r) => r.previous),
      today: sum(rest, (r) => r.today),
      remark: '',
    }));
    if (folded) overflow.push({ block: 'nonEffective', total: report.nonEffective.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const r = shown[i];
      const [b, c, e, f, g, h] = [cfg.no, cfg.name, cfg.prev, cfg.today, cfg.cumm, cfg.remark].map((col) => at(col, row));
      if (!r) {
        for (const a of [b, c, e, f, g, h]) sheet.clear(a);
        return;
      }
      sheet.setNumber(b, i + 1);
      putText(sheet, c, r.cause);
      sheet.setNumber(e, r.previous);
      sheet.setNumber(g, r.previous + r.today);
      sheet.setCached(f, r.today); // the sheet's own formula is cumulative minus previous
      putText(sheet, h, r.remark);
    });
    sheet.setCached(`E${cfg.totalsRow}`, sum(shown, (r) => r.previous));
    sheet.setCached(`F${cfg.totalsRow}`, sum(shown, (r) => r.today));
    sheet.setCached(`G${cfg.totalsRow}`, sum(shown, (r) => r.previous + r.today));
  }

  /* permit to work */
  {
    const cfg = CELLS.ptw;
    const { shown, hidden } = clip(report.ptw, cfg.rows.length);
    if (hidden) overflow.push({ block: 'ptw', total: report.ptw.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const cols = [cfg.no, cfg.desc, cfg.type, cfg.pwtNo, cfg.pa, cfg.issued, cfg.validity, cfg.status].map((col) => at(col, row));
      const p = shown[i];
      const last = hidden > 0 && i === cfg.rows.length - 1;
      if (!p && !last) {
        for (const a of cols) sheet.clear(a);
        return;
      }
      for (const a of cols) sheet.clear(a);
      sheet.setNumber(at(cfg.no, row), i + 1);
      if (last) {
        putText(sheet, at(cfg.desc, row), more(hidden));
        return;
      }
      putText(sheet, at(cfg.desc, row), p.description);
      putText(sheet, at(cfg.type, row), p.type);
      putText(sheet, at(cfg.pwtNo, row), p.pwtNo);
      putText(sheet, at(cfg.pa, row), p.pa);
      putDate(sheet, at(cfg.issued, row), p.issued);
      putDate(sheet, at(cfg.validity, row), p.validity);
      putText(sheet, at(cfg.status, row), p.status);
      grow(sheet, row, [[p.description, at(cfg.desc, row)]]);
    });
  }

  /* HSE */
  {
    const cfg = CELLS.hse;
    const { shown, folded } = fold<HseRow>(report.hseInput, cfg.rows.length, (rest) => ({
      id: 'fold',
      activity: `Lainnya (${rest.length})`,
      previous: sum(rest, (r) => r.previous),
      today: sum(rest, (r) => r.today),
    }));
    if (folded) overflow.push({ block: 'hse', total: report.hseInput.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const r = shown[i];
      const [k, l, o, p, rr] = [cfg.no, cfg.name, cfg.prev, cfg.today, cfg.cumm].map((col) => at(col, row));
      if (!r) {
        for (const a of [k, l, o, p, rr]) sheet.clear(a);
        return;
      }
      sheet.setNumber(k, i + 1);
      putText(sheet, l, r.activity);
      sheet.setNumber(o, r.previous);
      sheet.setNumber(p, r.today);
      // The template's own formula here adds column N (blank) instead of O (Previous), so its
      // cumulative was only ever today's count. Written as Previous + Today.
      sheet.setFormula(rr, `${o}+${p}`);
      sheet.setCached(rr, r.previous + r.today);
    });
  }

  /* daily activities: what was DONE today, and everything planned for tomorrow */
  {
    const cfg = CELLS.activities;
    const today = todayItemsOf(report).filter((i) => i.done).map((i) => i.text);
    const tomorrow = tomorrowItemsOf(report).map((i) => i.text);
    const t = clip(today, cfg.rows.length);
    const m = clip(tomorrow, cfg.rows.length);
    if (t.hidden) overflow.push({ block: 'activitiesToday', total: today.length, capacity: cfg.rows.length });
    if (m.hidden) overflow.push({ block: 'activitiesTomorrow', total: tomorrow.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const lastT = t.hidden > 0 && i === cfg.rows.length - 1;
      const lastM = m.hidden > 0 && i === cfg.rows.length - 1;
      const a = lastT ? more(t.hidden) : (t.shown[i] ?? '');
      const b = lastM ? more(m.hidden) : (m.shown[i] ?? '');
      putText(sheet, at(cfg.todayText, row), a);
      putText(sheet, at(cfg.tomorrowText, row), b);
      grow(sheet, row, [[a, at(cfg.todayText, row)], [b, at(cfg.tomorrowText, row)]]);
    });
  }

  /* area of concern / ask for help */
  {
    const cfg = CELLS.aoc;
    const rows = report.aoc ?? [];
    const { shown, hidden } = clip(rows, cfg.rows.length);
    if (hidden) overflow.push({ block: 'aoc', total: rows.length, capacity: cfg.rows.length });
    cfg.rows.forEach((row, i) => {
      const cols = [cfg.no, cfg.type, cfg.desc, cfg.date, cfg.by, cfg.status].map((col) => at(col, row));
      for (const a of cols) sheet.clear(a);
      const r = shown[i];
      const last = hidden > 0 && i === cfg.rows.length - 1;
      if (!r && !last) return;
      sheet.setNumber(at(cfg.no, row), i + 1);
      if (last) {
        putText(sheet, at(cfg.desc, row), more(hidden));
        return;
      }
      putText(sheet, at(cfg.type, row), r.type);
      putText(sheet, at(cfg.desc, row), r.description);
      putDate(sheet, at(cfg.date, row), r.date);
      putText(sheet, at(cfg.by, row), r.actionBy);
      putText(sheet, at(cfg.status, row), r.status);
      grow(sheet, row, [[r.description, at(cfg.desc, row)]]);
    });
  }

  /* progress: the weekly figure; empty while the weights do not close */
  {
    const cfg = CELLS.progress;
    putDate(sheet, cfg.date, report.date);
    const p = input.progress;
    if (p && p.state === 'ready') {
      const plan = p.plan / 100;
      const actual = p.actual / 100;
      sheet.setNumber(cfg.plan, plan);
      sheet.setNumber(cfg.actual, actual);
      sheet.setCached(cfg.dev, actual - plan);
    } else {
      sheet.clear(cfg.plan);
      sheet.clear(cfg.actual);
      sheet.clear(cfg.dev);
    }
  }

  /* signatures: "Dibuat Oleh" (left) is the contractor, "Disetujui Oleh" (right) the client */
  {
    const s = CELLS.sign;
    putText(sheet, s.leftCompany, project.signatureRight.company);
    putText(sheet, s.leftName, project.signatureRight.name);
    putText(sheet, s.rightCompany, project.signatureLeft.company);
    putText(sheet, s.rightName, project.signatureLeft.name);
  }

  return { overflow, weather: picked };
}
