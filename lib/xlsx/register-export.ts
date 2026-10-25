import ExcelJS from 'exceljs';

import {
  getRegisterCards, getRegisterParties, getRegisterSettings, getRegisterSummary, getRegisterTree,
  isDone, REGISTER_INFO, stageRank,
  type DocumentCard, type DocumentStageDetail, type RegisterNode,
} from '../register';
import { outlineCode } from '../register-outline';
import { fitSheet } from './fit-sheet';
import type { DocStage, RegisterKind } from '../schema';

/**
 * The register as the people who read it in Excel want it (25 Oct 2026).
 *
 * THE LOOK IS PETROGAS' EDL, THE CONTENT IS THE APP'S: Arial, a light-blue
 * header, grey discipline bands, one coloured block per stage with the
 * contractor's submission beside the client's response. No logos, no bars, no
 * formulas. One row per document; the left columns say where it stands as of
 * the exported week (Status, Position), the stage blocks carry the dates.
 * A resubmission (RE-IFR, RE-AFC 1) shows in its stage's block as the latest
 * round; every round is a row of Submission Log (Excel reserves "History").
 *
 * Everything is read as of the week being viewed, through the same readers as
 * the Summary and Data screens, so the file says what the screen says.
 */

const FONT = 'Arial';
const HEADER_FILL = 'FFC5D9F1';
// Petrogas' heading levels: A darker grey, A.1 grey, A.1.1 and below white, all bold.
const bandOf = (depth: number): string | null => (depth === 1 ? 'FFBFBFBF' : depth === 2 ? 'FFE7E6E6' : null);
// Petrogas' stage bands, in order; a register with more stages wraps round.
const STAGE_FILLS: { fill: string; text: string }[] = [
  { fill: 'FFFFFF00', text: 'FF000000' },
  { fill: 'FF00B050', text: 'FFFFFFFF' },
  { fill: 'FFC65911', text: 'FFFFFFFF' },
  { fill: 'FF8EA9DB', text: 'FF000000' },
  { fill: 'FFA9D08E', text: 'FF000000' },
];
const CODE_FILL: Record<string, string> = { APP: 'FFC6EFCE', AWC: 'FFFFEB9C', RWC: 'FFFFC7CE' };
const RED = 'FFC00000';
const NAVY = 'FF1F3864';
const THIN = { style: 'thin' as const, color: { argb: 'FF9A9A9A' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
// OOXML's A3; exceljs' PaperSize enum stops short of it.
const A3 = 8 as ExcelJS.PaperSize;
const A4 = 9 as ExcelJS.PaperSize;

/** The block a round belongs to: RE-IFR is IFR's, RE-AFC 2 is AFC's, RE-S1 is S1's. */
function blockOf(stage: DocStage): DocStage {
  if (stage === 'RE_AFC1' || stage === 'RE_AFC2') return 'AFC';
  return stage.replace(/^RE_/, '') as DocStage;
}

/** A stage's own label from Setup, its resubmissions as RE-<label> (RE-AFC 2 keeps its number). */
function labelOf(stage: DocStage, labels: Map<DocStage, string>): string {
  const base = blockOf(stage);
  const head = labels.get(base) ?? base;
  if (stage === base) return head;
  const n = /(\d)$/.exec(stage)?.[1];
  return `RE-${head}${stage.startsWith('RE_AFC') && n ? ` ${n}` : ''}`;
}

const date = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00Z`) : null);

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export interface RegisterWorkbookInput {
  projectId: string;
  projectName: string;
  register: RegisterKind;
  week?: number;
}

export async function buildRegisterWorkbook(input: RegisterWorkbookInput): Promise<{ buffer: Buffer; week: number | null }> {
  const { projectId, register } = input;
  const summary = getRegisterSummary(projectId, register, input.week);
  const workbook = new ExcelJS.Workbook();
  const info = REGISTER_INFO[register];
  if (!summary) {
    workbook.addWorksheet(info.short).getCell('A1').value = 'This register has no documents yet.';
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), week: null };
  }

  const week = summary.asOfWeek;
  const tree = getRegisterTree(projectId, register, week);
  const lastTree = week > 1 ? getRegisterTree(projectId, register, week - 1) : [];
  const cards = getRegisterCards(projectId, register, week);
  const settings = getRegisterSettings(projectId, register);
  const parties = getRegisterParties(projectId);
  const contractor = parties.contractorName.trim() || 'Contractor';
  const client = parties.clientName.trim() || 'Client';

  const labels = new Map(settings.stages.map((s) => [s.stage, s.label || s.stage]));
  const names = new Map(settings.stages.map((s) => [s.stage, s.name || s.label || s.stage]));
  const blocks: DocStage[] = settings.stages.map((s) => s.stage);
  const allCards = Object.values(cards).flat();
  // AS-BUILT is no stage on Setup, but an imported register may carry it.
  if (allCards.some((c) => c.stages.some((s) => s.stage === 'ASBUILT' && s.submitted))) {
    blocks.push('ASBUILT');
    labels.set('ASBUILT', 'AS-BUILT');
    names.set('ASBUILT', 'As-built');
  }

  // A return only counts once it happened by the end of the exported week.
  const returned = (s: DocumentStageDetail) =>
    s.submitted && (s.returnedAt ? s.returnedAt <= summary.asOfDate : Boolean(s.returnCode));

  const lastActual = new Map<string, number>();
  const collect = (nodes: RegisterNode[]) => nodes.forEach((n) => { lastActual.set(n.id, n.actual); collect(n.children); });
  collect(lastTree);
  const lastTotal = summary.series.find((p) => p.weekNo === week - 1)?.actual ?? 0;

  const title = `${info.long.toUpperCase()} (${info.short})`;
  const period = `Week ${week} · as of ${fmtDate(summary.asOfDate)}`;

  /* ------------------------------------------------------------ Summary */
  {
    const ws = workbook.addWorksheet('Summary', {
      views: [{ state: 'frozen', ySplit: 6, xSplit: 2, topLeftCell: 'C7', showGridLines: false, style: 'pageBreakPreview', zoomScale: 85, zoomScaleNormal: 85 }],
      pageSetup: printSetup(A4, '5:6'),
      headerFooter: footer(`Summary · ${info.short} · Week ${week}`),
    });
    const n = blocks.length;
    const cols = [6, 40, 8, ...blocks.map(() => 8), 14, 14, 8, 11, 13, 13, 11];
    cols.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const last = cols.length;

    heading(ws, `SUMMARY · ${title}`, input.projectName, period, last);

    const sentFrom = 4;
    const posFrom = sentFrom + n;
    const lateCol = posFrom + 2;
    const planCol = lateCol + 1;
    const r5 = ws.getRow(5);
    const r6 = ws.getRow(6);
    const top: [number, number, string][] = [
      [1, 1, 'NO'], [2, 2, 'DISCIPLINE'], [3, 3, 'DOCS'],
      [sentFrom, posFrom - 1, 'SENT'], [posFrom, posFrom + 1, 'POSITION'], [lateCol, lateCol, 'LATE'],
      [planCol, planCol, 'PLAN'], [planCol + 1, planCol + 3, 'ACTUAL PROGRESS'],
    ];
    for (const [from, to, text] of top) {
      ws.mergeCells(5, from, from === to ? 6 : 5, to);
      r5.getCell(from).value = text;
    }
    blocks.forEach((b, i) => {
      const cell = r6.getCell(sentFrom + i);
      cell.value = labels.get(b) ?? b;
      paintStage(cell, i);
    });
    r6.getCell(posFrom).value = contractor;
    r6.getCell(posFrom + 1).value = client;
    r6.getCell(planCol + 1).value = `Week ${week - 1}`;
    r6.getCell(planCol + 2).value = `Week ${week}`;
    r6.getCell(planCol + 3).value = 'Change';
    for (const row of [r5, r6]) {
      row.height = 26;
      for (let c = 1; c <= last; c += 1) {
        if (row === r6 && c >= sentFrom && c < posFrom) continue;
        header(row.getCell(c));
      }
    }

    const write = (code: string, name: string, node: Pick<RegisterNode, 'documents' | 'reached' | 'withUs' | 'awaiting' | 'overdue' | 'plan' | 'actual'>, previous: number, band: string | null, bold: boolean) => {
      const row = ws.addRow([
        code, name, node.documents,
        ...blocks.map((b) => node.reached.find((r) => r.stage === b)?.reached ?? 0),
        node.withUs, node.awaiting, node.overdue || null,
        node.plan === null ? null : node.plan / 100, previous / 100, node.actual / 100, (node.actual - previous) / 100,
      ]);
      body(row, last, band, bold);
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = 3; c <= lateCol; c += 1) row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = planCol; c <= last; c += 1) row.getCell(c).numFmt = c === last ? '+0.00%;-0.00%;0.00%' : '0.00%';
      if (node.overdue) row.getCell(lateCol).font = { name: FONT, size: 9, bold: true, color: { argb: RED } };
    };

    const walk = (nodes: RegisterNode[], path: number[]) => nodes.forEach((node, i) => {
      const here = [...path, i + 1];
      write(outlineCode(here), node.name, node, lastActual.get(node.id) ?? 0,
        bandOf(here.length), true);
      walk(node.children, here);
    });
    walk(tree, []);
    write('', 'TOTAL', {
      documents: summary.documents,
      reached: summary.stages,
      withUs: summary.withUs,
      awaiting: summary.awaiting,
      overdue: summary.overdue,
      plan: summary.plan,
      actual: summary.actual,
    }, lastTotal, 'FFDDEBF7', true);
  }

  /* --------------------------------------------------------- EDL / VDRL */
  {
    const ws = workbook.addWorksheet(info.short, {
      views: [{ state: 'frozen', ySplit: 8, xSplit: 4, topLeftCell: 'E9', showGridLines: false, style: 'pageBreakPreview', zoomScale: 70, zoomScaleNormal: 85 }],
      pageSetup: printSetup(A3, '6:8'),
      headerFooter: footer(`${info.short} · Week ${week}`),
    });
    // Sized to the longest thing each column holds, so the sheet fits one A3 width at a readable scale.
    const left = [
      ['NO', 6], ['DOCUMENT / DRAWING NO', 24], ['REV', 5], ['DESCRIPTION', 40], ['TYPE', 6], ['PIC', 12],
      ['STATUS', 20], ['POSITION', 26], ['PROGRESS', 10], ['REMARKS', 18],
    ] as const;
    const blockCols = ['Plan', 'Sent', 'Transmittal No', 'Received', 'Transmittal No', 'Code'];
    const widths = [10, 10, 15, 10, 15, 7];
    left.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    blocks.forEach((_, b) => widths.forEach((w, i) => { ws.getColumn(left.length + b * 6 + i + 1).width = w; }));
    const last = left.length + blocks.length * 6;

    heading(ws, title, input.projectName,
      `${period} · Progress ${pct(summary.actual)}${summary.plan === null ? '' : ` (plan ${pct(summary.plan)})`}`, left.length);

    const r6 = ws.getRow(6);
    const r7 = ws.getRow(7);
    const r8 = ws.getRow(8);
    left.forEach(([text], i) => {
      ws.mergeCells(6, i + 1, 8, i + 1);
      r6.getCell(i + 1).value = text;
      header(r6.getCell(i + 1));
    });
    blocks.forEach((b, i) => {
      const from = left.length + i * 6 + 1;
      ws.mergeCells(6, from, 6, from + 5);
      r6.getCell(from).value = `${(names.get(b) ?? b).toUpperCase()} (${labels.get(b) ?? b})`;
      for (let c = from; c < from + 6; c += 1) paintStage(r6.getCell(c), i);
      ws.mergeCells(7, from, 7, from + 2);
      ws.mergeCells(7, from + 3, 7, from + 5);
      r7.getCell(from).value = `${contractor} Submission`;
      r7.getCell(from + 3).value = `${client} Response`;
      for (let c = from; c < from + 6; c += 1) {
        const cell = r7.getCell(c);
        cell.font = { name: FONT, size: 8, bold: true, color: { argb: c < from + 3 ? 'FF2F75B5' : RED } };
        cell.fill = solid('FFF2F2F2');
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = BOX;
        r8.getCell(c).value = blockCols[c - from];
        header(r8.getCell(c));
      }
    });
    r6.height = 22; r7.height = 14; r8.height = 26;

    const documentRow = (c: DocumentCard, no: number) => {
      const done = isDone(c);
      // Read off the latest round, as it came back: "IFA approved", "IFR returned RWC".
      const latest = c.stages.filter((s) => s.submitted).sort((x, y) => stageRank(x.stage) - stageRank(y.stage)).at(-1);
      const code = latest && returned(latest) ? latest.returnCode?.trim().toUpperCase() ?? null : null;
      const status = done ? 'Complete'
        : !latest ? 'Not sent'
        : c.out ? `${labelOf(c.out.stage, labels)} sent`
        : code === 'APP' ? `${labelOf(latest.stage, labels)} approved`
        : `${labelOf(latest.stage, labels)} returned${code ? ` ${code}` : ''}`;
      const row = ws.addRow([
        no, c.docNo ?? '', c.revision ?? '', c.title, c.kind ?? '', c.pic ?? '',
        status, done ? 'Complete' : c.out ? client : contractor,
        c.percent / 100, c.remarks ?? '',
      ]);
      body(row, last, null, false);
      for (const col of [1, 3, 5]) row.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(9).numFmt = '0.00%';

      blocks.forEach((b, i) => {
        const from = left.length + i * 6 + 1;
        const rounds = c.stages.filter((s) => blockOf(s.stage) === b).sort((x, y) => stageRank(x.stage) - stageRank(y.stage));
        const plan = rounds.find((s) => s.stage === b)?.planSubmitDate ?? null;
        const sent = rounds.filter((s) => s.submitted).at(-1) ?? null;
        const back = sent && returned(sent) ? sent : null;
        const values: (Date | string | null)[] = [
          date(plan), date(sent?.submittedAt ?? null), sent?.submitTransmittal ?? null,
          date(back?.returnedAt ?? null), back?.returnTransmittal ?? null, back?.returnCode ?? null,
        ];
        values.forEach((v, k) => {
          const cell = row.getCell(from + k);
          cell.value = v;
          if (v instanceof Date) cell.numFmt = 'dd mmm yy';
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        const code = back?.returnCode?.trim().toUpperCase();
        if (code && CODE_FILL[code]) row.getCell(from + 5).fill = solid(CODE_FILL[code]);
        // A plan date that passed with nothing sent is what "late" means.
        if (plan && !sent && plan < summary.asOfDate) {
          row.getCell(from).font = { name: FONT, size: 9, bold: true, color: { argb: RED } };
        }
      });
    };

    let running = 0;
    const walk = (nodes: RegisterNode[], path: number[]) => nodes.forEach((node, i) => {
      const here = [...path, i + 1];
      const group = ws.addRow([outlineCode(here), node.name]);
      ws.mergeCells(group.number, 2, group.number, left.length - 2);
      group.getCell(left.length - 1).value = node.actual / 100;
      group.getCell(left.length - 1).numFmt = '0.00%';
      body(group, last, bandOf(here.length), true);
      group.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

      for (const card of cards[node.id] ?? []) {
        running += 1;
        documentRow(card, running);
      }
      walk(node.children, here);
    });
    walk(tree, []);
  }

  /* ----------------------------------------------------- Submission Log */
  {
    const ws = workbook.addWorksheet('Submission Log', {
      views: [{ state: 'frozen', ySplit: 5, topLeftCell: 'A6', showGridLines: false, style: 'pageBreakPreview', zoomScale: 85, zoomScaleNormal: 85 }],
      pageSetup: printSetup(A4, '5:5'),
      headerFooter: footer(`Submission Log · ${info.short} · Week ${week}`),
    });
    const cols = [['DOCUMENT / DRAWING NO', 26], ['DESCRIPTION', 44], ['STAGE', 12], ['SENT', 12], ['TRANSMITTAL NO', 16],
      ['RECEIVED', 12], ['TRANSMITTAL NO', 16], ['CODE', 8], ['DAYS IN REVIEW', 11]] as const;
    cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
    heading(ws, `SUBMISSION LOG · ${title}`, input.projectName, `${period} · every submission, in order per document`, cols.length);
    const h = ws.getRow(5);
    cols.forEach(([text], i) => { h.getCell(i + 1).value = text; header(h.getCell(i + 1)); });
    h.height = 26;

    const walk = (nodes: RegisterNode[]) => nodes.forEach((node) => {
      for (const c of cards[node.id] ?? []) {
        const rounds = c.stages.filter((s) => s.submitted).sort((x, y) => stageRank(x.stage) - stageRank(y.stage));
        for (const s of rounds) {
          const back = returned(s);
          const row = ws.addRow([
            c.docNo ?? '', c.title, labelOf(s.stage, labels), date(s.submittedAt), s.submitTransmittal,
            back ? date(s.returnedAt) : null, back ? s.returnTransmittal : null, back ? s.returnCode : null,
            back ? s.waiting : null,
          ]);
          body(row, cols.length, null, false);
          for (const k of [3, 4, 5, 6, 7, 8, 9]) row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' };
          for (const k of [4, 6]) row.getCell(k).numFmt = 'dd mmm yy';
          const code = back ? s.returnCode?.trim().toUpperCase() : undefined;
          if (code && CODE_FILL[code]) row.getCell(8).fill = solid(CODE_FILL[code]);
        }
      }
      walk(node.children);
    });
    walk(tree);
  }

  // Every column and row sized to what landed in it, so no name is cut off; then
  // opened as Page Break Preview, as Petrogas' own EDL is: what prints is what you see,
  // and the grey outside it is not on the page.
  for (const ws of workbook.worksheets) {
    // The register sheet is the wide one: a long name wraps sooner there, so it still prints large enough.
    fitSheet(ws, { maxWidth: ws.name === info.short ? 32 : 44 });
    // exceljs puts the $ before each column itself; the rows carry their own.
    ws.pageSetup.printArea = `A$1:${ws.getColumn(ws.columnCount).letter}$${ws.rowCount}`;
  }
  workbook.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), week };
}

/* ---------------------------------------------------------------- styling */

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const pct = (n: number) => `${n.toFixed(2)}%`;
/**
 * Ready for Save as PDF from Excel: landscape, one page wide and as many tall
 * as it needs, centred, the header rows repeated on every page.
 */
const printSetup = (paperSize: ExcelJS.PaperSize, titles: string): Partial<ExcelJS.PageSetup> => ({
  orientation: 'landscape', paperSize, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
  horizontalCentered: true, printTitlesRow: titles,
  margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 },
});

/** What the sheet is on the left, the page in the middle, the quiet mark on the right. No print date. */
const footer = (what: string): Partial<ExcelJS.HeaderFooter> => {
  const text = `&L&"Arial"&8${what.replace(/&/g, '&&')}&C&"Arial"&8Page &P of &N&R&"Arial"&8Lucille by Figtries`;
  return { oddFooter: text, evenFooter: text };
};

function heading(ws: ExcelJS.Worksheet, title: string, project: string, line: string, span: number) {
  const rows: [string, number, string][] = [[title, 14, NAVY], [project.toUpperCase(), 10, NAVY], [line, 9, RED]];
  rows.forEach(([text, size, color], i) => {
    ws.mergeCells(i + 1, 1, i + 1, Math.max(span, 2));
    const cell = ws.getCell(i + 1, 1);
    cell.value = text;
    cell.font = { name: FONT, size, bold: true, color: { argb: color } };
    cell.alignment = { vertical: 'middle' };
    ws.getRow(i + 1).height = i === 0 ? 22 : 15;
  });
}

function header(cell: ExcelJS.Cell) {
  cell.font = { name: FONT, size: 9, bold: true };
  cell.fill = solid(HEADER_FILL);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = BOX;
}

function paintStage(cell: ExcelJS.Cell, index: number) {
  const { fill, text } = STAGE_FILLS[index % STAGE_FILLS.length];
  cell.font = { name: FONT, size: 9, bold: true, color: { argb: text } };
  cell.fill = solid(fill);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = BOX;
}

function body(row: ExcelJS.Row, width: number, band: string | null, bold: boolean) {
  for (let c = 1; c <= width; c += 1) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 9, bold };
    cell.border = BOX;
    cell.alignment = { vertical: 'middle' };
    if (band) cell.fill = solid(band);
  }
  row.height = 15;
}
