/**
 * Where each field of a daily report lives in the client's workbook
 * (`PRGG-00-G0-RPT-003_DAILY PROGRESS REPORT`). Pure data, read off the sample and
 * checked against 360 real workbooks: 348 of them share this exact layout, and none
 * has ever had a row inserted.
 *
 * Row numbers are the sheet's own. `rows` are the rows a block has, top to bottom;
 * anything a report holds beyond that is folded, see `daily-fill.ts`.
 */

export const CELLS = {
  title: 'F2',
  date: 'E4',
  dayNo: 'S4',
  contractor: 'E5',
  contractNo: 'E6',
  location: 'E7',
  client: 'N5',
  docNo: 'N6',

  /** Row 13 holds a start and an end time per condition; ctrl is the checkbox (ctrlPropN), shape the VML id. */
  weather: {
    hujanDeras: { start: 'I13', end: 'K13', ctrl: 2, shape: 1026 },
    hujanSedang: { start: 'L13', end: 'M13', ctrl: 1, shape: 1025 },
    berawanMendung: { start: 'N13', end: 'O13', ctrl: 4, shape: 1028 },
    cerahTerang: { start: 'P13', end: 'R13', ctrl: 3, shape: 1027 },
  },

  /** Row 20 is a 4.5 pt spacer that only the SUMs reach; it is not a fourth crew row. */
  crew: { rows: [17, 18, 19], no: 'B', name: 'C', pob: 'E', prev: 'F', today: 'G', total: 'H', totalsRow: 21 },
  nonEffective: { rows: [24, 25, 26, 27, 28], no: 'B', name: 'C', prev: 'E', today: 'F', cumm: 'G', remark: 'H', totalsRow: 29 },
  ptw: { rows: [16, 17, 18, 19], no: 'K', desc: 'L', type: 'N', pwtNo: 'O', pa: 'P', issued: 'Q', validity: 'R', status: 'S' },
  hse: { rows: [24, 25, 26, 27, 28, 29], no: 'K', name: 'L', prev: 'O', today: 'P', cumm: 'R' },
  activities: { rows: [32, 33, 34, 35, 36, 37, 38, 39], todayNo: 'B', todayText: 'C', tomorrowNo: 'L', tomorrowText: 'M' },
  aoc: { rows: [43, 44, 45], no: 'B', type: 'C', desc: 'E', date: 'P', by: 'Q', status: 'S' },

  /**
   * "6. Progress Summary". Left out of the export since 30 Sep 2026 (progress is the
   * weekly report's job): its rows are HIDDEN rather than deleted, so no cell below
   * moves, and the photographs take its number.
   */
  progress: { date: 'D50', plan: 'D51', actual: 'D52', dev: 'D53', rows: [46, 56] },
  photoTitle: { addr: 'B67', text: '6. Progress Photograph' },
  /** The six photo boxes, left then right, top to bottom. Rows 91, 112 and 133 between them are captions. */
  photos: [
    { from: 'C71', to: 'K90' },
    { from: 'L71', to: 'R90' },
    { from: 'C92', to: 'K111' },
    { from: 'L92', to: 'R111' },
    { from: 'C113', to: 'K132' },
    { from: 'L113', to: 'R132' },
  ],
  /** The daily sheet reads "Dibuat Oleh" (made by, the contractor) on the left and "Disetujui Oleh" (approved, the client) on the right. */
  sign: { leftCompany: 'C60', leftName: 'C65', rightCompany: 'N60', rightName: 'N65' },
} as const;

/** What one sheet holds, for the app's "Excel holds N lines" note. */
export const CAPACITY = {
  crew: CELLS.crew.rows.length,
  nonEffective: CELLS.nonEffective.rows.length,
  ptw: CELLS.ptw.rows.length,
  hse: CELLS.hse.rows.length,
  activities: CELLS.activities.rows.length,
  aoc: CELLS.aoc.rows.length,
  photos: CELLS.photos.length,
} as const;

/** The sample's date-formatted style of S4, and the plain-number copy of it the template adds. */
export const DAY_NO_STYLE = { from: '12', to: '423' } as const;

/** Arial 12 pt: one wrapped line, and about how many characters fit per column-width unit. */
export const LINE_PT = 15.5;
export const CHARS_PER_UNIT = 0.9;
