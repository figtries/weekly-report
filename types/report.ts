export interface SummaryData {
  no: number;
  deskripsi: string;
  bobot: number;
  prevProgress: number;
  prevWF: number;
  curProgress: number;
  curWF: number;
  cumProgress: number;
  cumWF: number;
  target: number;
  variance: number;
}

export interface SCurveData {
  week: string;
  plan: number;
  actual: number;
}
