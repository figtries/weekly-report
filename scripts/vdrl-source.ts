/**
 * Reads the Vendor Drawing Register List into plain data.
 *
 * Same chain as the EDL — IFR → RE-IFR → IFA → RE-IFA → AFC → RE-AFC1/2 →
 * AS-BUILT, each with plan, submission, transmittal both ways and a return
 * code — but the sheet itself is far rougher than the EDL, and three of its
 * habits decide how this parser works:
 *
 *   1. **A heading can live in any of three columns.** Some carry a code in
 *      column C (`A.1`, `B.2.2`), some sit in column D (`DRAWING MCC`), and
 *      some only appear in column F (`TEMPERATURE TRANSMITTER`). So a row is
 *      classified by what follows it, not by where its text sits: a heading
 *      with documents under it is a GROUP, a heading with none is the start of
 *      a new vendor PACKAGE.
 *   2. **The codes are not a hierarchy.** `A.2.3` sits inside `A.1`, and
 *      `II.2.2` sits in section B. They are typed labels, so this parser
 *      numbers packages and groups itself (`V01`, `V01.1`) and keeps the
 *      sheet's own code only as part of the name.
 *   3. **114 of the 310 deliverables have no document number at all** — the
 *      vendor owes it, nobody has numbered it, and the sequence column shows
 *      `=#REF!+1`. They are still deliverables and still count against their
 *      package, so a document is anything with a description and a sequence
 *      cell, numbered or not.
 */
import ExcelJS from 'exceljs';

import { date, number, raw, text } from './edl-source.ts';

type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { name: string };

/* --------------------------------------------------------------- columns */

const VDRL_FIRST_ROW = 8;

const COL = {
  seq: 3,
  docNo: 4,
  revision: 5,
  title: 6,
  reviewPti: 7,
  reviewPep: 8,
  note: 9,
  status: 10,
  remarks: 61,
} as const;

/** Six cells per stage, in the same order as the EDL's. */
const STAGE_COLUMNS = {
  IFR: { planSubmit: 14, submitted: 15, outTr: 16, returned: 17, inTr: 18, code: 19 },
  RE_IFR: { planSubmit: 20, submitted: 21, outTr: 22, returned: 23, inTr: 24, code: 25 },
  IFA: { planSubmit: 26, submitted: 27, outTr: 28, returned: 29, inTr: 30, code: 31 },
  RE_IFA: { planSubmit: 32, submitted: 33, outTr: 34, returned: 35, inTr: 36, code: 37 },
  AFC: { planSubmit: 38, submitted: 39, outTr: 40, returned: 41, inTr: 42, code: 43 },
  RE_AFC1: { planSubmit: 44, submitted: 45, outTr: 46, returned: 47, inTr: 48, code: 49 },
  RE_AFC2: { planSubmit: null, submitted: 50, outTr: 51, returned: 52, inTr: 53, code: 54 },
  ASBUILT: { planSubmit: 55, submitted: 56, outTr: 57, returned: 58, inTr: 59, code: 60 },
} as const;

export type VdrlStage = keyof typeof STAGE_COLUMNS;
export const VDRL_STAGES = Object.keys(STAGE_COLUMNS) as VdrlStage[];

/* ------------------------------------------------------------------ types */

export interface VdrlSourceStage {
  stage: VdrlStage;
  planSubmitDate: string | null;
  submitted: boolean;
  submittedAt: string | null;
  submitTransmittal: string | null;
  returnedAt: string | null;
  returnTransmittal: string | null;
  returnCode: string | null;
}

export interface VdrlSourceDocument {
  excelRow: number;
  /** Blank on 149 rows — the vendor owes it, nobody has numbered it. */
  docNo: string | null;
  revision: string | null;
  title: string;
  /** Whether we review it, whether Pertamina reviews it. */
  reviewPti: boolean;
  reviewPep: boolean;
  status: string | null;
  remarks: string | null;
  groupCode: string;
  stages: VdrlSourceStage[];
}

export interface VdrlSourceCategory {
  code: string;
  name: string;
  /** Null on a package, set on a group. */
  parentCode: string | null;
  /** `A`, `B`, `C` — the sheet's own section bands. */
  section: string | null;
}

export interface VdrlSource {
  categories: VdrlSourceCategory[];
  documents: VdrlSourceDocument[];
}

/* --------------------------------------------------------------- helpers */

/** `A. VENDOR ELECTRICAL`, `B. VENDOR INSTRUMENT` — a band, not a package. */
const SECTION = /^([A-Z])\.\s*VEND/i;

/** `A.1`, `B.2.2`, `II.2.2`, `A.1.1.` — a typed label, kept only as a name. */
const CODE_LABEL = /^[A-Z]+[.\d]*\.?$/;

function clean(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/* ---------------------------------------------------------------- reader */

interface PendingHeading {
  label: string;
  code: string | null;
  section: string | null;
  documents: VdrlSourceDocument[];
}

export async function readVdrlWorkbook(file: string): Promise<VdrlSource> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });

  const headings: PendingHeading[] = [];
  let section: string | null = null;

  for await (const sheet of reader) {
    const ws = sheet as NamedWorksheetReader;
    if (ws.name !== 'Vdrl') {
      for await (const _ of ws) { /* drained so the stream advances */ }
      continue;
    }

    for await (const row of ws) {
      if (row.number < VDRL_FIRST_ROW) continue;

      const seqCell = row.getCell(COL.seq);
      const seq = clean(text(seqCell));
      const docNo = clean(text(row.getCell(COL.docNo)));
      const title = clean(text(row.getCell(COL.title)));

      const sectionMatch = seq?.match(SECTION);
      if (sectionMatch) { section = sectionMatch[1].toUpperCase(); continue; }

      // A sequence cell that is a number, or a formula that tried to be one,
      // marks a deliverable — a heading never has one. The formula matters more
      // than its result: the running count breaks at `=#REF!+1` and every row
      // below it carries a shared formula whose value is an error.
      const seqValue = seqCell?.value as unknown;
      const hasSeq =
        typeof seqValue === 'number' ||
        (typeof seqValue === 'object' && seqValue !== null &&
          ('formula' in seqValue || 'sharedFormula' in seqValue));
      // One row lost its sequence cell entirely. A heading is a short label —
      // `GENERAL`, `DRAWING MCC` — so a long sentence in mixed case with no code
      // is a deliverable whose number nobody filled in, not a new package.
      const looksLikeSentence =
        !hasSeq && docNo === null && title !== null && title.length > 40 && title !== title.toUpperCase();
      const isDocument = (hasSeq && (docNo !== null || title !== null)) || looksLikeSentence;

      if (!isDocument) {
        const code = seq && CODE_LABEL.test(seq) ? seq : null;
        // A heading's text is in column D, except where it is in column F.
        const label = clean(text(row.getCell(COL.docNo))) ?? title;
        if (!label) continue;
        headings.push({ label, code, section, documents: [] });
        continue;
      }

      const current = headings[headings.length - 1];
      if (!current) continue;

      current.documents.push({
        excelRow: row.number,
        docNo,
        revision: clean(text(row.getCell(COL.revision))),
        title: title ?? docNo ?? '(tanpa judul)',
        reviewPti: /^y/i.test(clean(text(row.getCell(COL.reviewPti))) ?? ''),
        reviewPep: /^y/i.test(clean(text(row.getCell(COL.reviewPep))) ?? ''),
        status: clean(text(row.getCell(COL.status))),
        remarks: clean(text(row.getCell(COL.remarks))) ?? clean(text(row.getCell(COL.note))),
        groupCode: '',
        stages: VDRL_STAGES.map((stage) => {
          const c = STAGE_COLUMNS[stage];
          return {
            stage,
            planSubmitDate: c.planSubmit ? date(row.getCell(c.planSubmit)) : null,
            submitted: raw(row.getCell(c.submitted)) !== null,
            submittedAt: date(row.getCell(c.submitted)),
            submitTransmittal: clean(text(row.getCell(c.outTr))),
            returnedAt: date(row.getCell(c.returned)),
            returnTransmittal: clean(text(row.getCell(c.inTr))),
            returnCode: clean(text(row.getCell(c.code))),
          };
          // Evidence only. A plan date alone is a date in the future.
        }).filter((s) =>
          s.submitted || s.submitTransmittal || s.returnedAt || s.returnTransmittal || s.returnCode,
        ),
      });
    }
  }

  /* --------------------------------------- headings → packages and groups */

  const categories: VdrlSourceCategory[] = [];
  const documents: VdrlSourceDocument[] = [];
  let packageCode: string | null = null;
  let packageSeq = 0;
  let groupSeq = 0;
  let prefix: string | null = null;

  for (const heading of headings) {
    const name = heading.code ? `${heading.code} ${heading.label}` : heading.label;

    // A heading with nothing under it is a container. A trailing dot on its
    // code (`A.2.3.`) is the sheet's way of saying "still inside the package
    // above" — those become a prefix on the groups that follow rather than a
    // package of their own, which is what keeps the three MCC drawing groups
    // under the LV switchgear package where they belong.
    if (heading.documents.length === 0) {
      if (heading.code?.endsWith('.') && packageCode) { prefix = heading.label; continue; }
      packageSeq += 1;
      groupSeq = 0;
      prefix = null;
      packageCode = `V${String(packageSeq).padStart(2, '0')}`;
      categories.push({ code: packageCode, name, parentCode: null, section: heading.section });
      continue;
    }

    // A heading with documents belongs to whichever package is open. A sheet
    // that opens with documents before any package gets one made for it.
    if (!packageCode) {
      packageSeq += 1;
      groupSeq = 0;
      packageCode = `V${String(packageSeq).padStart(2, '0')}`;
      categories.push({ code: packageCode, name: 'Tanpa paket', parentCode: null, section: heading.section });
    }

    groupSeq += 1;
    const groupCode = `${packageCode}.${groupSeq}`;
    categories.push({
      code: groupCode,
      name: prefix ? `${prefix} · ${name}` : name,
      parentCode: packageCode,
      section: heading.section,
    });
    for (const doc of heading.documents) documents.push({ ...doc, groupCode });
  }

  // Packages that never received a group are headings the sheet abandoned.
  const used = new Set(categories.filter((c) => c.parentCode).map((c) => c.parentCode));
  const kept = categories.filter((c) => c.parentCode !== null || used.has(c.code));

  return { categories: kept, documents };
}
