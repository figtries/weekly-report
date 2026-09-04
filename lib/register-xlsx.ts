/**
 * A workbook, read as the same grid a paste produces.
 *
 * This file deliberately does NOT parse a register. It turns a worksheet into
 * tab-separated rows and hands them to `parseRegisterPaste`, which already
 * knows how to find the outline column, the number, the title and the type, and
 * already lets a person correct that guess. A sheet is another source of the
 * grid, not a second importer with its own rules to keep in step.
 *
 * exceljs is driven through `WorkbookReader`, never `readFile`: the weekly
 * workbook in this project is 11.8 MB and `readFile` died at a 2 GB heap on it.
 */
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export interface SheetGrid {
  /** Sheet name as the workbook spells it. */
  name: string;
  /** The sheet as tab-separated lines — exactly what a paste from Excel looks like. */
  text: string;
  rows: number;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    }
    if (typeof v.text === 'string') return v.text;
    if (v.result !== undefined && v.result !== null) return String(v.result);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    // A formula with no cached result is a blank as far as a register is
    // concerned — Petrogas' sheet is full of them in the status columns.
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
}

function gridOf(name: string, lines: string[], index: number): SheetGrid {
  return { name: name || `Sheet ${index + 1}`, text: lines.join('\n'), rows: lines.length };
}

async function readStreaming(buffer: Buffer): Promise<SheetGrid[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    entries: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });

  const grids: SheetGrid[] = [];
  for await (const sheet of reader as AsyncIterable<ExcelJS.Worksheet>) {
    const lines: string[] = [];
    for await (const row of sheet as unknown as AsyncIterable<ExcelJS.Row>) {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
      for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
      lines.push(cells.join('\t'));
    }
    grids.push(gridOf(sheet.name, lines, grids.length));
  }
  return grids;
}

/**
 * The whole workbook in memory. Only ever reached by the fallback below.
 */
async function readBuffered(buffer: Buffer): Promise<SheetGrid[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  return workbook.worksheets.map((sheet, index) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
      for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
      lines.push(cells.join('\t'));
    });
    return gridOf(sheet.name, lines, index);
  });
}

/** Above this, only the streaming reader is allowed near a file. */
const BUFFERED_LIMIT = 5 * 1024 * 1024;

/**
 * Every worksheet in the workbook, as grids.
 *
 * Streaming first, because that is the rule this project pays for: plain
 * `readFile` died at a 2 GB heap on the 11.8 MB weekly workbook.
 *
 * The fallback exists because exceljs' own streaming reader cannot read files
 * exceljs itself writes — it throws on `this.model.sheets` before the first
 * row, which is how the export from `/api/register/export` failed to come back
 * in. Rather than let "export it, edit it in Excel, import it again" be a
 * promise that only sounds true, a SMALL file gets one more attempt through
 * the buffered loader. Anything above 5 MB does not, so the heap that rule was
 * written for is still protected.
 */
export async function readWorkbookGrids(buffer: Buffer): Promise<SheetGrid[]> {
  try {
    const grids = await readStreaming(buffer);
    if (grids.length > 0) return grids;
  } catch (err) {
    if (buffer.byteLength > BUFFERED_LIMIT) throw err;
  }
  if (buffer.byteLength > BUFFERED_LIMIT) throw new Error('That workbook has no readable sheets');
  return readBuffered(buffer);
}

/**
 * The sheet a register most likely lives on.
 *
 * Named `EDL`/`VDRL` first, because that is what the workbooks in this project
 * actually call them; otherwise the longest sheet, because a register is the
 * big one and the summary beside it never is.
 */
export function pickRegisterSheet(grids: SheetGrid[], register: 'edl' | 'vdrl'): SheetGrid | null {
  if (grids.length === 0) return null;
  const wanted = register.toLowerCase();
  const named = grids.find((g) => g.name.trim().toLowerCase() === wanted);
  if (named) return named;
  const contains = grids.find((g) => g.name.toLowerCase().includes(wanted)
    && !g.name.toLowerCase().includes('summary'));
  if (contains) return contains;
  return grids.reduce((a, b) => (b.rows > a.rows ? b : a));
}
