/**
 * How a leaf's progress is arrived at.
 *
 * `lumpsum` is the legacy path — someone types a percentage — and it is why
 * 96% of the seeded project's values are multiples of five. The other two
 * derive the number instead, which is what lets a new hire report progress
 * without having to judge it.
 */
export type ProgressMethod = 'qty' | 'milestone' | 'lumpsum';

/** A named step of a leaf that can't be measured in units (IFR / IFA / AFC). */
export interface Milestone {
  id: string;
  label: string;
  /** Share of the leaf, 0..100. The set should sum to 100. */
  weight: number;
}

export interface WbsItem {
  id: string;
  parentId: string | null;
  wbsCode: string;
  deskripsi: string;
  bobot: number;
  vol: number | null;
  satuan: string | null;
  order: number;
  /** Absent means 'lumpsum' — every pre-existing item. */
  progressMethod?: ProgressMethod;
  milestones?: Milestone[];
  /** Which kind of work this row is. See `lib/work-kind.ts`. Null until asked. */
  workKind?: string | null;
  /**
   * SPK / package / lot / area. The SQLite store's first-class
   * `is_reporting_unit` flag, carried through so `getSummaryRows` can group by
   * what the plan actually marked instead of by a "(SPK-###)" string the Gundih
   * importer happened to write into a description. Absent on the db.json path,
   * which has no such column — which is what keeps Gundih on its old grouping.
   */
  isReportingUnit?: boolean;
  unitLabel?: string | null;
}

export interface LeafSnapshot {
  /**
   * Cumulative progress percent. For 'qty' and 'milestone' items this is a
   * cached derivation of the fields below — `lib/progress.ts` recomputes it
   * and is the only thing allowed to write it for those methods.
   */
  cumProgressPct: number;
  targetWF: number;
  /** 'qty' items: cumulative quantity completed, in the item's own unit. */
  qtyDone?: number;
  /** 'milestone' items: ids of the milestones reached. */
  milestonesDone?: string[];
  /** Free text the person recorded beside the figure, e.g. a vendor's report reference. */
  note?: string;
  /** How the figure was arrived at. 'quote' and 'manual' are both lumpsum and are not the same claim. */
  source?: 'gate' | 'steps' | 'quote' | 'manual';
}

export type WeeklyLeafData = Record<string, LeafSnapshot>;

export interface ManHourRow {
  id: string;
  company: string;
  pobQty: number;
  previousHours: number;
  todayHours: number;
}

export interface NonEffectiveRow {
  id: string;
  cause: string;
  previous: number;
  today: number;
  remark: string;
}

export interface PtwRow {
  id: string;
  description: string;
  type: string;
  pwtNo: string;
  pa: string;
  issued: string;
  validity: string;
  status: string;
}

export interface HseRow {
  id: string;
  activity: string;
  previous: number;
  today: number;
}

export interface WeatherInfo {
  hujanDeras: boolean;
  hujanDerasJam: string;
  hujanSedang: boolean;
  hujanSedangJam: string;
  berawanMendung: boolean;
  berawanMendungJam: string;
  cerahTerang: boolean;
  cerahTerangJam: string;
  waktuMulai: string;
  waktuSelesai: string;
}

export interface WeeklyMeta {
  week: number;
  periodStart: string;
  periodEnd: string;
  documentation: (string | null)[];
  leafData: WeeklyLeafData;
}

export interface SCurvePoint {
  week: number;
  valuePct: number;
}

export interface SignatureBlock {
  company: string;
  name: string;
}

export interface ProjectInfo {
  name: string;
  contractNo: string;
  customer: string;
  contractor: string;
  workLocation: string;
  documentNoWeekly: string;
  documentNoDaily: string;
  signatureLeft: SignatureBlock;
  signatureRight: SignatureBlock;
  weekAnchorEndDate: string;
  /** The latest week that has real recorded actuals — drives the S-Curve's actual line. */
  currentWeek: number;
  /**
   * The week somebody PINNED as current, or null for "let the dates decide".
   *
   * Separate from `currentWeek` above because the two answer different
   * questions and conflating them broke both: the S-curve needs the last week
   * with actuals so its line stops where the reporting stops, while navigation
   * needs the week the project is IN. See `currentWeekOf` in
   * `lib/current-week.ts`.
   *
   * Undefined on the db.json side, which has no such field — there the pin is
   * `currentWeek` itself, because that store only ever had the one number.
   */
  currentWeekOverride?: number | null;
  /**
   * Total contract value in Rupiah. Optional because seeded projects predate
   * it. When present every percentage in the app also has a money figure —
   * which is the only language the layers above PM actually read.
   */
  contractValue?: number;
  /**
   * True where this project's weights are its own STATEMENT rather than a
   * figure derived from its prices — `weight_basis = 'boq'`.
   *
   * It is what tells a weightless leaf apart from a weightless leaf. On the
   * imported project the workbook left 42 rows with no weight on purpose
   * (Project Award, Process PO, SPK-002 Completed): markers, not work, and
   * every weekly surface hides them. On a project built in the app the same
   * shape means the opposite — the money never reached the row, because its
   * heading has no price and the contract had already been handed out — and
   * hiding it deletes real work. Kickoff and Site Survey vanished that way,
   * leaving their heading standing as an empty branch counting itself:
   * "1 activity · weight 0.00%", a chevron opening onto nothing, and no row
   * anywhere to record against (17 Sep 2026).
   *
   * Undefined means LOCKED, because the db.json side carries no such column
   * and the one project that reads it is the imported one.
   */
  weightsLocked?: boolean;
}

export interface DailyReport {
  date: string;
  hariKe: number | null;
  weather: WeatherInfo;
  manHours: ManHourRow[];
  nonEffective: NonEffectiveRow[];
  ptw: PtwRow[];
  hseInput: HseRow[];
  activitiesToday: string;
  activitiesTomorrow: string;
  planPct: number;
  actualPct: number;
  photos: (string | null)[];
}

export interface ChangeLogEntry {
  id: string;
  leafId: string;
  week: number;
  /**
   * 'noProgress' records that someone LOOKED and there was nothing to report.
   *
   * Without it the weekly queue can never empty: the log only gets an entry
   * when a figure actually changes, so an item that genuinely did not move
   * stays in "not filled in yet" forever and the "3 of 9 done" counter lies.
   * `oldValue` and `newValue` are equal on these — the entry is the fact that
   * it was checked, not a change.
   */
  field: 'cumProgressPct' | 'planPct' | 'noProgress';
  oldValue: number;
  newValue: number;
  at: string;
}

export interface Database {
  project: ProjectInfo;
  wbsItems: WbsItem[];
  weeks: WeeklyMeta[];
  scurvePlan: SCurvePoint[];
  scurveActual: SCurvePoint[];
  daily: DailyReport[];
  changeLog?: ChangeLogEntry[];
  boq?: BoqLine[];
  schedule?: ScheduleItem[];
  catalogs?: ProjectCatalogs;
  baselines?: Baseline[];
  approvals?: Approval[];
  /** Keyed by the photo path stored in DailyReport.photos / WeeklyMeta.documentation. */
  photoMeta?: Record<string, PhotoRecord>;
}

// ---------------------------------------------------------------------------
// Setup & baseline
//
// Everything below is optional on `Database`: db.json predates it, and a
// project that was seeded from Excel still has to open without a BOQ or a
// generated schedule. Absent data means "not set up in the app yet", never
// "broken".
// ---------------------------------------------------------------------------

/** How an item's weight is spread across its scheduled weeks. */
export type DistributionPattern = 'linear' | 'scurve' | 'front' | 'back';

/**
 * One priced line of the Bill of Quantities. Weight is DERIVED from this —
 * never typed by hand — so the weights always sum to exactly 100 and the
 * project gets its Rupiah figures for free. See `lib/setup.ts`.
 */
export interface BoqLine {
  leafId: string;
  unitPrice: number;
  qty: number;
}

/** Start/finish and spread for one leaf — the input the plan curve is built from. */
export interface ScheduleItem {
  leafId: string;
  startWeek: number;
  finishWeek: number;
  pattern: DistributionPattern;
}

/**
 * A named row a project can add to, remove from, or rename. These used to be
 * hard-coded in `lib/defaults.ts` with PT Indoturbine's own categories, which
 * is why no second project could use the app.
 */
export interface CatalogEntry {
  id: string;
  label: string;
  /** Delay causes only: does this cause support an extension-of-time claim? */
  claimable?: boolean;
}

export interface ProjectCatalogs {
  /**
   * Labels for the four fixed weather slots. Only the wording is per project —
   * the slots themselves stay named fields on `WeatherInfo` because the daily
   * form and the printed sheet address them individually, and turning them into
   * a list would change the report's layout for every existing project. Ids
   * here must match the `WeatherInfo` keys.
   */
  weather: CatalogEntry[];
  delayCause: CatalogEntry[];
  hse: CatalogEntry[];
  crew: CatalogEntry[];
}

/** A frozen plan. Re-baselining appends a new version rather than editing one. */
export interface Baseline {
  version: number;
  lockedAt: string;
  reason: string;
  /** leafId -> week -> targetWF */
  points: Record<string, Record<number, number>>;
}

/**
 * A week signed off.
 *
 * There is no authentication yet, so `by` is a typed name rather than a proven
 * identity — an approval here records *that someone stood behind these numbers
 * and when*, which is the audit trail the report needs, not proof of who they
 * were. Wiring it to real accounts is a database concern; the shape is ready
 * for it.
 */
export interface Approval {
  week: number;
  by: string;
  role: string;
  at: string;
  /** Snapshot of the figure approved, so a later edit is visibly a later edit. */
  approvedPct: number;
  note?: string;
}

/**
 * A photo's own account of when and where it was taken.
 *
 * Read from the file's EXIF at upload time and stored beside the path, because
 * the bytes may be re-encoded (Redis, resizing) and lose it. `verified` is
 * false when the file carried no capture data — an honest "we don't know" is
 * worth more in a dispute than a date supplied by whoever uploaded it.
 */
export interface PhotoRecord {
  path: string;
  takenAt?: string;
  lat?: number;
  lon?: number;
  device?: string;
  uploadedAt: string;
  verified: boolean;
}
