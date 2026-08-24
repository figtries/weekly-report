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
   * Total contract value in Rupiah. Optional because seeded projects predate
   * it. When present every percentage in the app also has a money figure —
   * which is the only language the layers above PM actually read.
   */
  contractValue?: number;
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
  field: 'cumProgressPct' | 'planPct';
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
