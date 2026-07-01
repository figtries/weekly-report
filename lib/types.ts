export interface WbsItem {
  id: string;
  parentId: string | null;
  wbsCode: string;
  deskripsi: string;
  bobot: number;
  vol: number | null;
  satuan: string | null;
  order: number;
}

export interface LeafSnapshot {
  cumProgressPct: number;
  targetWF: number;
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

export interface Database {
  project: ProjectInfo;
  wbsItems: WbsItem[];
  weeks: WeeklyMeta[];
  scurvePlan: SCurvePoint[];
  scurveActual: SCurvePoint[];
  daily: DailyReport[];
}
