/**
 * A complete dummy project for trying the app out locally (1 Oct 2026).
 *
 * "EPC Gas Processing Facility & Pipeline Lapangan Merbau": 4 SPK, ~140
 * activities with budgets that close at 100%, a 56-week plan that is at week 30
 * today, progress for every week so far (a little behind plan, with a few late
 * activities and vendor slips so Priority Actions and the forecast have
 * something to say), an EDL and a VDRL register, two weeks of daily reports and
 * placeholder photos. Everything fictional: client, contractor, people.
 *
 * Built through the app's own write paths wherever one exists
 * (`syncDerivedWeights`, `setWorkKindSqlite`, `saveWeekUpdatesSqlite`,
 * `saveFieldProgressSqlite`, `setLeafForecastSqlite`, `applyCreateDaily`,
 * `applyPatchDaily`), so the figures obey the same rules as typed ones.
 *
 * LOCAL ONLY. It writes `data/report.db` (gitignored), the project's record in
 * `data/db.json` and photos under `public/uploads/demo-merbau/` (which carries
 * its own `.gitignore`). It refuses to touch `data/seed.db`.
 *
 * Re-running deletes the demo project, its daily record and its photos, and
 * builds them again from scratch: the way back after playing with it.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/seed-demo.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import puppeteer from 'puppeteer-core';

if (process.env.VERCEL) throw new Error('seed-demo is for a developer machine only');
if (/seed\.db$/i.test(process.env.REPORT_DB_PATH ?? '')) throw new Error('Refusing to write the committed seed.db');

const { db, schema } = await import('../lib/sqlite.ts');
const { DB_PATH } = await import('../lib/db-path.ts');
const { eq } = await import('drizzle-orm');
const { weekRowsFor } = await import('../lib/week-grid.ts');
const { syncDerivedWeights } = await import('../lib/weights-auto.ts');
const { deriveWeights } = await import('../lib/weights.ts');
const { loadWeightNodes } = await import('../lib/weights-read.ts');
const { inclusiveDays, leafPlanFraction } = await import('../lib/plan-curve.ts');
const { BUILT_IN_KINDS } = await import('../lib/work-kind.ts');
const {
  saveFieldProgressSqlite,
  saveWeekUpdatesSqlite,
  setLeafForecastSqlite,
  setWorkKindSqlite,
} = await import('../lib/progress-sqlite.ts');
const { setLinksSqlite } = await import('../lib/links-sqlite.ts');
const { STAGE_ORDER } = await import('../lib/register-shared.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { computeRollup, computeGrandTotal, promoteNestedSpkContracts } = await import('../lib/rollup.ts');
const { weightGate } = await import('../lib/weight-gate.ts');
const { migrate, emptyDatabase } = await import('../lib/workspace.ts');
const { templateCatalogs } = await import('../lib/catalogs.ts');
const { applyCreateDaily, applyPatchDaily } = await import('../lib/mutations.ts');

if (/seed\.db$/i.test(DB_PATH)) throw new Error('Refusing to write the committed seed.db');

/* ------------------------------------------------------------------ setup */

const PID = 'pdemo-merbau';
const START = '2026-03-09'; // Monday: week 1
const FINISH = '2027-04-04'; // Sunday: week 56
const LAST_FULL_WEEK = 29;
const CURRENT_WEEK = 30; // today, 1 Oct 2026
const PHOTO_DIR = path.join(process.cwd(), 'public', 'uploads', 'demo-merbau');
const PHOTO_URL = '/uploads/demo-merbau';
const JSON_PATH = path.join(process.cwd(), 'data', 'db.json');

const DAY = 86_400_000;
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
/** Monday of week n. */
const W = (n: number) => addDays(START, (n - 1) * 7);
/** Sunday of week n. */
const E = (n: number) => addDays(START, n * 7 - 1);
const weekOf = (iso: string) => Math.floor((utc(iso) - utc(START)) / (7 * DAY)) + 1;

// Deterministic, so a reset gives the same project back.
let seed = 20261001;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

/* -------------------------------------------------------------- the plan */

type Phase = 'eng' | 'proc' | 'cons' | 'comm' | 'ms';
interface LeafDef {
  name: string;
  /** Relative value inside its SPK, roughly millions of IDR; scaled to the SPK budget. */
  w: number;
  s: number;
  f: number;
  /** Weeks behind (+) or ahead (−) of plan. */
  lag?: number;
  /** Pace against plan, 1 = on plan. */
  eff?: number;
  /** Highest percent it has reached: stuck there. */
  cap?: number;
  note?: string;
  /** EDL documents for an engineering row: [discipline, type, title]. */
  docs?: [string, string, string][];
  /** Milestone rows only: the exact date. */
  date?: string;
  /** Milestone rows only: reached? */
  hit?: boolean;
}
interface GroupDef {
  name: string;
  phase?: Phase;
  kids: Array<GroupDef | LeafDef>;
}
interface SpkDef extends GroupDef {
  unit: string;
  contractNo: string;
  budget: number;
  area: string;
}

const L = (name: string, w: number, s: number, f: number, o: Partial<LeafDef> = {}): LeafDef => ({ name, w, s, f, ...o });
const G = (name: string, kids: Array<GroupDef | LeafDef>, phase?: Phase): GroupDef => ({ name, kids, phase });
const isGroup = (n: GroupDef | LeafDef): n is GroupDef => 'kids' in n;

const SPKS: SpkDef[] = [
  {
    name: 'SPK-001 Gas Processing Facility (GPF)',
    unit: 'SPK-001',
    contractNo: 'SPK-001/EHM-RPK/III/2026',
    budget: 18_500_000_000,
    area: 'GPF',
    kids: [
      G('Engineering', [
        G('Process', [
          L('Process Design Basis & PFD', 120, 1, 5, { docs: [['PR', 'RPT', 'Process Design Basis'], ['PR', 'DWG', 'Process Flow Diagram (PFD)']] }),
          L('Heat & Material Balance', 110, 2, 6, { docs: [['PR', 'CAL', 'Heat & Material Balance']] }),
          L('Piping & Instrument Diagram (P&ID)', 180, 3, 10, { docs: [['PR', 'DWG', 'P&ID Inlet Separation'], ['PR', 'DWG', 'P&ID Gas Compression'], ['PR', 'DWG', 'P&ID Gas Dehydration (TEG)'], ['PR', 'DWG', 'P&ID Metering & Export']] }),
          L('Process Equipment Datasheets', 130, 4, 10, { docs: [['PR', 'DS', 'Process Datasheet Inlet Separator'], ['PR', 'DS', 'Process Datasheet Air Cooler']] }),
          L('HAZOP & SIL Study', 140, 8, 12, { cap: 80, note: 'Menunggu close-out 14 rekomendasi HAZOP dari client', docs: [['HS', 'RPT', 'HAZOP Study Report'], ['HS', 'RPT', 'SIL Assessment Report']] }),
        ]),
        G('Mechanical & Piping', [
          L('Plot Plan & 3D Model Review', 120, 3, 9, { docs: [['PI', 'DWG', 'Overall Plot Plan GPF'], ['PI', 'RPT', '3D Model Review Report (60%)']] }),
          L('Piping GA & Isometric Drawings', 200, 6, 16, { docs: [['PI', 'DWG', 'Piping GA Compressor Area'], ['PI', 'DWG', 'Piping GA Separator Area'], ['PI', 'DWG', 'Piping Isometric Book']] }),
          L('Piping Stress Analysis', 110, 9, 16, { docs: [['PI', 'CAL', 'Stress Analysis Compressor Discharge Line']] }),
          L('Piping Material Take Off (MTO)', 90, 5, 10, { docs: [['PI', 'RPT', 'Piping MTO Rev.1']] }),
          L('Mechanical Equipment Datasheets', 100, 4, 9, { docs: [['ME', 'DS', 'Mechanical Datasheet Gas Compressor'], ['ME', 'DS', 'Mechanical Datasheet TEG Package']] }),
        ]),
        G('Civil & Structure', [
          L('Soil Investigation Report', 80, 1, 5, { docs: [['CV', 'RPT', 'Soil Investigation Report']] }),
          L('Foundation Design Calculation', 130, 5, 12, { docs: [['CV', 'CAL', 'Compressor Foundation Calculation'], ['CV', 'CAL', 'Pipe Rack Foundation Calculation']] }),
          L('Steel Structure & Pipe Rack Design', 120, 7, 14, { docs: [['ST', 'CAL', 'Pipe Rack Structure Calculation'], ['ST', 'DWG', 'Pipe Rack GA Drawing']] }),
        ]),
        G('Instrument & Control', [
          L('Instrument Index & Datasheets', 110, 5, 12, { docs: [['IN', 'RPT', 'Instrument Index'], ['IN', 'DS', 'Control Valve Datasheets']] }),
          L('Control Narrative & Cause and Effect', 90, 7, 13, { docs: [['IN', 'SPC', 'Control Narrative'], ['IN', 'DWG', 'Cause & Effect Diagram']] }),
          L('DCS / ESD System Architecture', 100, 6, 12, { docs: [['IN', 'DWG', 'DCS / ESD System Architecture']] }),
        ]),
      ], 'eng'),
      G('Procurement', [
        L('Gas Compressor Package (2 x 50%)', 2600, 6, 38, { cap: 60, note: 'Vendor: FAT tertunda, slot test bench baru tersedia akhir November' }),
        L('Glycol Dehydration Unit (TEG Package)', 1350, 7, 34),
        L('Inlet Separator (3-Phase)', 520, 6, 28),
        L('Gas Scrubber & KO Drum', 380, 7, 28),
        L('Shell & Tube Heat Exchanger', 330, 8, 30),
        L('Air Cooler (Fin Fan)', 420, 8, 32),
        L('Pig Launcher & Receiver', 210, 9, 30),
        L('Control Valves', 380, 9, 32),
        L('Shutdown & Blowdown Valves (SDV/BDV)', 340, 9, 32),
        L('Pressure Safety Valves', 160, 10, 30),
        L('Gas Metering Skid (Ultrasonic)', 450, 8, 34),
        L('Chemical Injection Package', 190, 10, 32),
        L('Nitrogen Generator Package', 170, 10, 34),
        L('Bulk Piping Material (Pipe, Fittings, Flanges)', 900, 6, 26),
        L('Structural Steel Material', 420, 6, 22),
        L('Instrument Cable, Tubing & Fittings', 260, 10, 30),
        L('Electrical Bulk Material (Cable Tray, Gland)', 200, 10, 30),
      ], 'proc'),
      G('Construction', [
        G('Site Preparation', [
          L('Land Clearing & Grading', 260, 8, 12),
          L('Temporary Facilities (Site Office & Warehouse)', 180, 8, 13),
          L('Access Road & Internal Road', 220, 9, 16),
        ]),
        G('Civil Works', [
          L('Piling Works', 520, 12, 20, { lag: 2 }),
          L('Equipment Foundations', 480, 16, 28, { lag: 1, eff: 0.9 }),
          L('Pipe Rack Foundations', 260, 16, 26),
          L('Drainage & Oily Water Sewer', 210, 22, 32),
          L('Concrete Paving & Bund Wall', 190, 28, 36),
        ]),
        G('Structural Steel', [
          L('Pipe Rack Erection', 340, 24, 32, { eff: 0.9 }),
          L('Compressor Shelter Erection', 280, 28, 36),
          L('Platform, Ladder & Stairs', 220, 30, 38),
        ]),
        G('Mechanical Installation', [
          L('Separator & Vessel Installation', 220, 31, 36),
          L('Heat Exchanger & Air Cooler Installation', 200, 34, 39),
          L('TEG Unit Installation', 260, 36, 41),
          L('Metering Skid Installation', 120, 37, 40),
          L('Compressor Package Setting & Alignment', 360, 40, 44),
        ]),
        G('Piping', [
          L('Piping Prefabrication', 560, 22, 40, { eff: 0.9 }),
          L('Piping Erection', 620, 28, 46),
          L('Painting & Insulation', 260, 30, 47),
          L('Hydrotest', 240, 38, 47),
        ]),
        G('Electrical & Instrument', [
          L('Cable Tray & Cable Laying', 300, 34, 44),
          L('Instrument Installation', 260, 38, 46),
          L('Instrument Tubing & Hook-up', 180, 40, 47),
          L('Loop Check', 160, 44, 48),
        ]),
      ], 'cons'),
      G('Pre-Commissioning & Commissioning', [
        L('Mechanical Completion & Punch List', 220, 46, 48),
        L('Pre-Commissioning (Flushing, Leak Test, Drying)', 260, 47, 50),
        L('Commissioning & Start Up', 300, 50, 53),
        L('Performance Test (72 Hours)', 180, 53, 55),
      ], 'comm'),
    ],
  },
  {
    name: 'SPK-002 Pipeline & Flowline',
    unit: 'SPK-002',
    contractNo: 'SPK-002/EHM-RPK/III/2026',
    budget: 14_200_000_000,
    area: 'PL',
    kids: [
      G('Engineering', [
        L('Pipeline Route Survey & Topography', 160, 2, 6, { docs: [['PL', 'RPT', 'Route Survey & Topography Report']] }),
        L('Pipeline Design Basis & Wall Thickness Calculation', 120, 3, 8, { docs: [['PL', 'RPT', 'Pipeline Design Basis'], ['PL', 'CAL', 'Wall Thickness Calculation']] }),
        L('Alignment Sheets', 170, 5, 12, { docs: [['PL', 'DWG', 'Alignment Sheet KP 0 - KP 10'], ['PL', 'DWG', 'Alignment Sheet KP 10 - KP 18.5']] }),
        L('Road & River Crossing Design', 130, 6, 12, { docs: [['PL', 'DWG', 'Road Crossing Typical Detail'], ['PL', 'CAL', 'River Crossing Design Calculation']] }),
        L('HDD Design & Feasibility', 120, 7, 13, { docs: [['PL', 'RPT', 'HDD Feasibility Study Sungai Lalan']] }),
        L('Cathodic Protection Design', 90, 8, 13, { docs: [['PL', 'CAL', 'Cathodic Protection Design Calculation']] }),
      ], 'eng'),
      G('Procurement', [
        L('Line Pipe 12" API 5L X52 (18.5 km)', 3900, 5, 24, { cap: 75, note: 'Shipment kedua tertahan di pelabuhan Palembang' }),
        L('Line Pipe 6" Flowline (6.2 km)', 900, 6, 24),
        L('Induction Bends & Fittings', 420, 7, 26),
        L('Pipeline Ball Valves & Actuators', 560, 8, 30),
        L('Field Joint Coating Material (3LPE Sleeve)', 260, 8, 24),
        L('CP Material (Anodes & Test Posts)', 180, 10, 28),
        L('Insulating Joints', 110, 10, 28),
      ], 'proc'),
      G('Construction', [
        G('ROW Preparation', [
          L('Land Acquisition Support & Permits', 180, 6, 16, { cap: 90, note: '3 bidang lahan di KP 12 masih negosiasi' }),
          L('ROW Clearing & Grading', 520, 12, 22, { lag: 1 }),
        ]),
        G('Pipeline Installation', [
          L('Stringing', 380, 18, 36, { eff: 0.75 }),
          L('Welding', 1100, 20, 40, { eff: 0.85, lag: 1 }),
          L('NDT Radiography', 260, 21, 41, { eff: 0.85, lag: 1 }),
          L('Field Joint Coating', 240, 22, 42, { eff: 0.85, lag: 1 }),
          L('Trenching', 520, 18, 38),
          L('Lowering & Backfilling', 480, 24, 42, { eff: 0.9 }),
          L('Tie-in Works', 220, 40, 44),
          L('Pipeline Marker & ROW Reinstatement', 160, 42, 46),
        ]),
        G('Crossings', [
          L('Road Crossing by Boring (4 Locations)', 310, 22, 30),
          L('River Crossing by HDD (Sungai Lalan)', 640, 24, 34, { eff: 0.55, note: 'Pilot hole tertahan lapisan batuan keras di 180 m' }),
        ]),
        G('Testing', [
          L('Hydrotest Pipeline (4 Sections)', 340, 40, 45),
          L('Gauging & Caliper Pig Run', 90, 44, 46),
          L('Dewatering & Drying', 110, 45, 47),
        ]),
        G('Cathodic Protection', [
          L('Anode Bed & Test Post Installation', 160, 38, 44),
          L('CP Survey & Energize', 70, 45, 47),
        ]),
      ], 'cons'),
      G('Commissioning', [
        L('Pipeline Pre-Commissioning (N2 Purging)', 180, 47, 49),
        L('Pipeline Commissioning & Handover', 95, 50, 52),
      ], 'comm'),
    ],
  },
  {
    name: 'SPK-003 Power Generation & Electrical',
    unit: 'SPK-003',
    contractNo: 'SPK-003/EHM-RPK/IV/2026',
    budget: 9_600_000_000,
    area: 'PWR',
    kids: [
      G('Engineering', [
        L('Electrical Load List & Single Line Diagram', 110, 3, 9, { docs: [['EL', 'RPT', 'Electrical Load List'], ['EL', 'DWG', 'Overall Single Line Diagram']] }),
        L('Hazardous Area Classification', 60, 4, 9, { docs: [['EL', 'DWG', 'Hazardous Area Classification Drawing']] }),
        L('Cable Sizing & Cable Schedule', 80, 6, 12, { docs: [['EL', 'CAL', 'Cable Sizing Calculation']] }),
        L('Earthing & Lightning Protection Design', 70, 6, 11, { docs: [['EL', 'DWG', 'Earthing & Lightning Layout']] }),
        L('Relay Coordination Study', 70, 9, 15, { docs: [['EL', 'RPT', 'Relay Coordination Study']] }),
      ], 'eng'),
      G('Procurement', [
        L('Gas Engine Generator 2 x 1.2 MW', 2200, 7, 34, { cap: 60, note: 'Engine dari pabrikan terlambat dikirim ke packager' }),
        L('Generator Fuel Gas Conditioning Skid', 380, 9, 32),
        L('MV Switchgear 20 kV', 820, 8, 30),
        L('Power Transformer 2.5 MVA', 560, 8, 30),
        L('LV MCC & Distribution Boards', 520, 9, 30),
        L('UPS & Battery System', 260, 10, 30),
        L('Power & Control Cable', 640, 9, 28),
      ], 'proc'),
      G('Construction', [
        L('Earthing Grid Installation', 160, 24, 34),
        L('Generator Foundation', 260, 20, 28),
        L('Cable Trench & Cable Pulling', 420, 30, 42),
        L('Switchgear & Transformer Installation', 280, 32, 38),
        L('Generator Setting & Alignment', 300, 36, 40),
        L('Area Lighting & Small Power', 180, 36, 44),
        L('Termination & Insulation Test', 150, 40, 46),
      ], 'cons'),
      G('Commissioning', [
        L('Electrical Pre-Commissioning Test', 120, 45, 47),
        L('Generator Energize & Load Bank Test', 160, 47, 49),
        L('Synchronization & Load Sharing Test', 110, 49, 51),
      ], 'comm'),
    ],
  },
  {
    name: 'SPK-004 Control Room & Utility Building',
    unit: 'SPK-004',
    contractNo: 'SPK-004/EHM-RPK/IV/2026',
    budget: 6_400_000_000,
    area: 'BLD',
    kids: [
      G('Engineering', [
        L('Architectural Drawings', 90, 2, 8, { docs: [['AR', 'DWG', 'Control Room Architectural Layout'], ['AR', 'DWG', 'Warehouse Architectural Layout']] }),
        L('Building Structure Calculation', 80, 3, 9, { docs: [['ST', 'CAL', 'Control Room Structure Calculation']] }),
        L('HVAC Design', 60, 5, 10, { docs: [['AR', 'CAL', 'HVAC Heat Load Calculation']] }),
        L('Fire & Gas Detection Design', 70, 6, 12, { docs: [['HS', 'DWG', 'Fire & Gas Detector Layout']] }),
        L('DCS / ESD Panel Layout & Wiring Diagram', 80, 7, 13, { docs: [['IN', 'DWG', 'DCS / ESD Panel Layout']] }),
      ], 'eng'),
      G('Procurement', [
        L('DCS & ESD System', 1100, 8, 32),
        L('Fire & Gas Detection System', 420, 9, 30),
        L('HVAC Units (Package)', 260, 10, 28),
        L('Fire Fighting Package (Pump & Hydrant)', 380, 9, 30),
        L('Telecom & CCTV System', 240, 10, 32),
        L('Building Material (Steel, Panel, Finishing)', 300, 8, 20),
      ], 'proc'),
      G('Construction', [
        G('Control Room Building', [
          L('Foundation & Tie Beam', 260, 10, 16, { lag: -1, eff: 1.1 }),
          L('Structure (Column, Beam, Slab)', 340, 15, 24, { lag: -1, eff: 1.1 }),
          L('Wall, Roof & Finishing', 300, 22, 32, { lag: -1, eff: 1.1 }),
          L('Building MEP (Plumbing, Lighting, HVAC Duct)', 220, 28, 36),
        ]),
        G('Utility Buildings', [
          L('Warehouse & Workshop', 300, 14, 26, { lag: -1 }),
          L('Guard House & Perimeter Fence', 110, 12, 22),
          L('Landscaping & Parking Area', 60, 36, 42),
        ]),
        G('Systems Installation', [
          L('Fire Hydrant Network', 220, 28, 38),
          L('DCS / ESD Panel Installation', 180, 34, 38),
          L('HVAC Installation', 120, 34, 39),
          L('F&G Detector Installation', 140, 36, 42),
        ]),
      ], 'cons'),
      G('Commissioning', [
        L('DCS & ESD FAT / SAT', 150, 30, 40),
        L('Integrated Function Test (ESD / F&G)', 140, 48, 51),
        L('Handover & As-Built Dossier', 90, 54, 56),
      ], 'comm'),
    ],
  },
];

const MILESTONES: LeafDef[] = [
  { name: 'Kick Off Meeting', w: 0, s: 1, f: 1, date: '2026-03-10', hit: true },
  { name: 'All Long Lead Items PO Placed', w: 0, s: 11, f: 11, date: addDays(E(11), -2), hit: true },
  { name: 'HAZOP Close-Out', w: 0, s: 13, f: 13, date: addDays(E(13), -2), hit: false },
  { name: 'Mechanical Completion', w: 0, s: 48, f: 48, date: addDays(E(48), -2) },
  { name: 'Ready for Start Up (RFSU)', w: 0, s: 52, f: 52, date: addDays(E(52), -2) },
  { name: 'Final Acceptance & Handover', w: 0, s: 56, f: 56, date: addDays(E(56), -2) },
];

/* ------------------------------------------------------- 1. clean slate */

const existing = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, PID)).all()[0];
if (existing) {
  // doc_stages point at transmittals without a cascade: clear the register first.
  const docIds = db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.projectId, PID)).all();
  for (const d of docIds) db.delete(schema.docStages).where(eq(schema.docStages.documentId, d.id)).run();
  db.delete(schema.projects).where(eq(schema.projects.id, PID)).run();
}
fs.rmSync(PHOTO_DIR, { recursive: true, force: true });

/* ------------------------------------------------------- 2. the project */

const BASELINE = `${PID}:active`;
const now = new Date().toISOString();
db.transaction((tx) => {
  tx.insert(schema.projects)
    .values({
      id: PID,
      name: 'EPC Gas Processing Facility & Pipeline Lapangan Merbau',
      alias: 'MRB',
      docNoPrefix: 'MRB',
      clientName: 'PT Energi Hulu Merbau',
      contractorName: 'PT Rekayasa Prima Konstruksi',
      contractNo: 'EHM/EPC/2026/0142',
      contractValue: SPKS.reduce((s, k) => s + k.budget, 0),
      currency: 'IDR',
      weightBasis: 'even',
      startDate: START,
      finishDate: FINISH,
      workLocation: 'Lapangan Merbau, Musi Banyuasin, Sumatera Selatan',
      documentNoWeekly: 'MRB-RPK-PM-RPT-002',
      documentNoDaily: 'MRB-RPK-PM-RPT-003',
      signatureLeft: JSON.stringify({ company: 'PT ENERGI HULU MERBAU', name: 'Hendra Wijaya' }),
      signatureRight: JSON.stringify({ company: 'PT REKAYASA PRIMA KONSTRUKSI', name: 'Rizky Pratama' }),
      updatedAt: now,
    })
    .run();
  tx.insert(schema.baselines).values({ id: BASELINE, projectId: PID, kind: 'active', revisionNo: 0, label: 'Working plan' }).run();
  tx.insert(schema.weeks).values(weekRowsFor(PID, START, FINISH)).run();
  tx.insert(schema.appState)
    .values({ id: 'singleton', activeProjectId: PID, updatedAt: now })
    .onConflictDoUpdate({ target: schema.appState.id, set: { activeProjectId: PID, updatedAt: now } })
    .run();
});

/* --------------------------------------------------------- 3. the WBS */

interface Leaf extends LeafDef {
  id: string;
  phase: Phase;
  spk: SpkDef | null;
  start: string;
  finish: string;
  price: number;
  /** Week each ladder rung was first reached. */
  rungWeek: Record<string, number>;
}
const leaves: Leaf[] = [];
const byName = new Map<string, Leaf>();
let order = 0;

function insertNode(parentId: string | null, depth: number, code: string, name: string, extra: Record<string, unknown> = {}): string {
  const id = randomUUID();
  db.insert(schema.wbsNodes)
    .values({ id, projectId: PID, parentId, wbsCode: code, deskripsi: name, order: order++, depth, isLeaf: false, progressMethod: 'lumpsum', ...extra })
    .run();
  return id;
}

function insertLeaf(parentId: string, depth: number, code: string, def: LeafDef, phase: Phase, spk: SpkDef | null, price: number) {
  const start = def.date ?? W(def.s);
  const finish = def.date ?? E(def.f);
  const id = insertNode(parentId, depth, code, def.name, {
    isLeaf: true,
    isMilestone: phase === 'ms',
    vol: 1,
    satuan: 'Ls',
    price: price > 0 ? price : null,
  });
  db.insert(schema.nodeSchedules)
    .values({ id: `${BASELINE}:${id}`, baselineId: BASELINE, nodeId: id, startDate: start, finishDate: finish, durationDays: inclusiveDays(start, finish) })
    .run();
  const leaf: Leaf = { ...def, id, phase, spk, start, finish, price, rungWeek: {} };
  leaves.push(leaf);
  byName.set(def.name, leaf);
}

/** Every leaf of an SPK, in order, so prices can be shared out before inserting. */
function leafDefsOf(g: GroupDef): LeafDef[] {
  return g.kids.flatMap((k) => (isGroup(k) ? leafDefsOf(k) : [k]));
}

function walk(g: GroupDef, parentId: string, depth: number, code: string, phase: Phase, spk: SpkDef, prices: Map<LeafDef, number>) {
  g.kids.forEach((k, i) => {
    const c = `${code}.${i + 1}`;
    if (isGroup(k)) {
      const id = insertNode(parentId, depth, c, k.name);
      walk(k, id, depth + 1, c, k.phase ?? phase, spk, prices);
    } else {
      insertLeaf(parentId, depth, c, k, phase, spk, prices.get(k) ?? 0);
    }
  });
}

SPKS.forEach((spk, i) => {
  const defs = leafDefsOf(spk);
  const total = defs.reduce((s, d) => s + d.w, 0);
  const prices = new Map<LeafDef, number>();
  let spent = 0;
  defs.forEach((d, j) => {
    const p = j === defs.length - 1 ? spk.budget - spent : Math.round((spk.budget * d.w) / total / 1e6) * 1e6;
    prices.set(d, p);
    spent += p;
  });
  const id = insertNode(null, 0, String(i + 1), spk.name, {
    price: spk.budget,
    isReportingUnit: true,
    unitLabel: spk.unit,
    unitContractNo: spk.contractNo,
    unitContractValue: spk.budget,
  });
  walk(spk, id, 1, String(i + 1), 'eng', spk, prices);
});
{
  const id = insertNode(null, 0, String(SPKS.length + 1), 'Key Milestones');
  MILESTONES.forEach((m, j) => insertLeaf(id, 1, `${SPKS.length + 1}.${j + 1}`, m, 'ms', null, 0));
}

// Weight from budget, exactly as a price edit would derive it.
syncDerivedWeights(PID);
{
  const result = deriveWeights(loadWeightNodes(PID), SPKS.reduce((s, k) => s + k.budget, 0));
  const unpriced = leaves.filter((l) => l.phase !== 'ms' && !(result.bobotOf.get(l.id)! > 0));
  if (Math.abs(result.total - 100) > 0.01 || unpriced.length) {
    throw new Error(`Weights do not close: ${result.total.toFixed(4)}%, unbudgeted: ${unpriced.map((l) => l.name).join(', ')}`);
  }
}

/* --------------------------------------------- 4. how each row is measured */

const KIND = Object.fromEntries(BUILT_IN_KINDS.map((k) => [k.id, k]));
// Every activity is measured by its kind's own ladder, exactly as the template defines it.
const LADDER: Partial<Record<Phase, string>> = { eng: 'engineering', proc: 'procurement', cons: 'construction', comm: 'commissioning' };
for (const l of leaves) {
  if (l.phase === 'ms') continue;
  const kind = KIND[LADDER[l.phase]!];
  setWorkKindSqlite(l.id, kind.id, 'milestone', { milestones: kind.steps });
}

/* ------------------------------------------------ 5. thirty weeks of site */

// Everything not given a story of its own runs close to plan, with a little noise.
for (const l of leaves) {
  if (l.phase === 'ms') continue;
  if (l.lag === undefined) l.lag = pick([0, 0, -1, 0, 1, -1]);
  if (l.eff === undefined) l.eff = pick([1, 1, 1.05, 0.95, 1, 1.05]);
}

const pctOf = (l: Leaf, w: number, prev: number): number => {
  if (l.phase === 'ms') return l.hit && utc(l.date!) <= utc(E(w)) ? 100 : 0;
  const shifted = w - l.lag!;
  const plan = (x: number) => (x >= 1 ? leafPlanFraction(l.start, l.finish, E(x)) : 0);
  let raw = plan(shifted) * 100 * l.eff!;
  if (plan(shifted - 1) >= 1) raw = 100;
  raw = Math.min(raw, 100, l.cap ?? 100);
  return Math.max(prev, Math.round(raw / 5) * 5);
};

/** The rungs a percent has climbed: whole rungs only, in order. */
const rungsFor = (l: Leaf, pct: number): string[] => {
  const kind = KIND[LADDER[l.phase]!];
  const done: string[] = [];
  let acc = 0;
  for (const m of kind.steps) {
    if (acc + m.weight <= pct + 10) {
      acc += m.weight;
      done.push(m.id);
    } else break;
  }
  return done;
};

const standing = new Map<string, number>();
for (let w = 1; w <= CURRENT_WEEK; w += 1) {
  const lump: Record<string, { cumProgressPct: number; note?: string }> = {};
  const field: { leafId: string; milestonesDone?: string[]; note?: string }[] = [];
  leaves.forEach((l, i) => {
    const prev = standing.get(l.id) ?? 0;
    if (prev >= 100) return; // finished: nothing more to report
    if (utc(l.start) > utc(E(w)) && l.lag! >= 0) return; // not started yet
    // The current week is half filled in: the rest is there to try "Fill in" on.
    if (w === CURRENT_WEEK && i % 5 >= 3) return;
    let pct = pctOf(l, w, prev);
    if (pct === 0 && prev === 0 && utc(l.start) > utc(E(w))) return;
    const note = l.note && (l.cap !== undefined || l.eff! < 0.7) && pct > 0 && w >= LAST_FULL_WEEK - 2 ? l.note : undefined;
    if (l.phase === 'ms') {
      lump[l.id] = { cumProgressPct: pct, ...(note ? { note } : {}) };
    } else {
      const rungs = rungsFor(l, pct);
      const kind = KIND[LADDER[l.phase]!];
      for (const r of rungs) l.rungWeek[r] ??= w;
      pct = kind.steps.filter((s) => rungs.includes(s.id)).reduce((s, m) => s + m.weight, 0);
      field.push({ leafId: l.id, milestonesDone: rungs.map((r) => `${l.id}:${r}`), ...(note ? { note } : {}) });
    }
    standing.set(l.id, pct);
  });
  if (Object.keys(lump).length) saveWeekUpdatesSqlite(PID, w, lump);
  if (field.length) saveFieldProgressSqlite(PID, w, field);
}

/* -------------------------------------- 6. what only a person outside knows */

const leaf = (name: string) => {
  const l = byName.get(name);
  if (!l) throw new Error(`No activity called ${name}`);
  return l;
};
setLeafForecastSqlite(PID, leaf('Gas Compressor Package (2 x 50%)').id, { date: '2026-12-04', source: 'vendor', rungId: `${leaf('Gas Compressor Package (2 x 50%)').id}:rts` }, LAST_FULL_WEEK);
setLeafForecastSqlite(PID, leaf('Line Pipe 12" API 5L X52 (18.5 km)').id, { date: '2026-10-23', source: 'vendor', rungId: `${leaf('Line Pipe 12" API 5L X52 (18.5 km)').id}:onsite` }, LAST_FULL_WEEK);
setLeafForecastSqlite(PID, leaf('Gas Engine Generator 2 x 1.2 MW').id, { date: '2026-11-13', source: 'vendor', rungId: `${leaf('Gas Engine Generator 2 x 1.2 MW').id}:rts` }, LAST_FULL_WEEK);
setLeafForecastSqlite(PID, leaf('Land Acquisition Support & Permits').id, { date: '2026-10-16', source: 'client', rungId: null }, LAST_FULL_WEEK);

const waits: [string, string[]][] = [
  ['Compressor Package Setting & Alignment', ['Gas Compressor Package (2 x 50%)', 'Equipment Foundations']],
  ['Separator & Vessel Installation', ['Inlet Separator (3-Phase)', 'Gas Scrubber & KO Drum', 'Equipment Foundations']],
  ['TEG Unit Installation', ['Glycol Dehydration Unit (TEG Package)']],
  ['Stringing', ['Line Pipe 12" API 5L X52 (18.5 km)', 'ROW Clearing & Grading']],
  ['Welding', ['Stringing']],
  ['Generator Setting & Alignment', ['Gas Engine Generator 2 x 1.2 MW', 'Generator Foundation']],
  ['Switchgear & Transformer Installation', ['MV Switchgear 20 kV', 'Power Transformer 2.5 MVA']],
  ['DCS / ESD Panel Installation', ['DCS & ESD System', 'Wall, Roof & Finishing']],
  ['Commissioning & Start Up', ['Pre-Commissioning (Flushing, Leak Test, Drying)']],
  ['Hydrotest Pipeline (4 Sections)', ['Welding', 'Lowering & Backfilling']],
];
// Every demo link is "after it finishes", no wait (lib/links.ts).
for (const [who, on] of waits)
  setLinksSqlite(PID, leaf(who).id, on.map((n) => ({ id: leaf(n).id, type: 'FS' as const, wait: 0 })));

/* ------------------------------------------------- 7. document registers */

const AS_OF = E(LAST_FULL_WEEK);
const DISCIPLINES: Record<string, string> = {
  PR: 'Process', PI: 'Piping', ME: 'Mechanical', CV: 'Civil', ST: 'Structure',
  EL: 'Electrical', IN: 'Instrument & Control', PL: 'Pipeline', AR: 'Architecture & HVAC', HS: 'Safety (HSE)',
};
const ENGINEERS = ['A. Nugroho', 'D. Lestari', 'F. Hidayat', 'R. Saputra', 'S. Maharani', 'Y. Kurniawan'];
const DEFAULT_STAGE_WEIGHT: Record<string, number> = { IFR: 50, IFA: 30, AFC: 20 };

const transmittals = new Map<string, string>();
const transmittalCount = { out: 0, in: 0 } as Record<'out' | 'in', number>;
function transmittal(register: 'edl' | 'vdrl', direction: 'out' | 'in', date: string): string {
  const key = `${register}|${direction}|${date}`;
  const found = transmittals.get(key);
  if (found) return found;
  transmittalCount[direction] += 1;
  const id = randomUUID();
  const no = `MRB-${register === 'edl' ? 'TRM' : 'VTR'}-${direction === 'out' ? 'O' : 'I'}-${String(transmittalCount[direction]).padStart(4, '0')}`;
  db.insert(schema.transmittals).values({ id, projectId: PID, register, no, direction, date }).run();
  transmittals.set(key, id);
  return id;
}

function stageWeights(register: 'edl' | 'vdrl') {
  db.insert(schema.docStageWeights)
    .values(STAGE_ORDER.map((stage, i) => ({ id: randomUUID(), projectId: PID, register, stage, weight: DEFAULT_STAGE_WEIGHT[stage] ?? 0, order: i })))
    .run();
}

/** One stage row: planned, and what happened to it by the status date. */
function stage(documentId: string, register: 'edl' | 'vdrl', st: 'IFR' | 'IFA' | 'AFC' | 'RE_IFA' | 'RE_AFC1', plan: string | null, sent: string | null, code: string | null) {
  const sentOk = sent && sent <= AS_OF ? sent : null;
  const back = sentOk ? addDays(sentOk, 9 + Math.floor(rand() * 6)) : null;
  const backOk = back && back <= AS_OF ? back : null;
  db.insert(schema.docStages)
    .values({
      id: randomUUID(),
      documentId,
      stage: st,
      order: STAGE_ORDER.indexOf(st),
      planSubmitDate: plan,
      submitted: Boolean(sentOk),
      submittedAt: sentOk,
      submitTransmittalId: sentOk ? transmittal(register, 'out', sentOk) : null,
      returnedAt: backOk,
      returnTransmittalId: backOk ? transmittal(register, 'in', backOk) : null,
      returnCode: backOk ? code : null,
    })
    .run();
}

// EDL: one category per discipline, documents from the engineering rows.
stageWeights('edl');
{
  const cats = new Map<string, string>();
  let catOrder = 0;
  const seq: Record<string, number> = {};
  for (const l of leaves.filter((x) => x.phase === 'eng')) {
    for (const [disc, type, title] of l.docs ?? []) {
      let catId = cats.get(disc);
      if (!catId) {
        catId = randomUUID();
        db.insert(schema.docCategories)
          .values({ id: catId, projectId: PID, register: 'edl', parentId: null, code: disc, name: DISCIPLINES[disc], order: catOrder++ })
          .run();
        cats.set(disc, catId);
      }
      const area = l.spk!.area;
      const k = `${area}-${disc}-${type}`;
      seq[k] = (seq[k] ?? 0) + 1;
      const reached = ['ifr', 'ifa', 'afc'].filter((r) => l.rungWeek[r] !== undefined);
      // Engineering never quite stops: a few drawings go round again as vendor data lands,
      // and the HAZOP report is resubmitted after its rejection.
      const reAfc = reached.includes('afc') && /P&ID|Piping GA|Alignment Sheet|Single Line/.test(title)
        ? addDays(W(24 + Math.floor(rand() * 6)), Math.floor(rand() * 4))
        : null;
      const id = randomUUID();
      db.insert(schema.documents)
        .values({
          id,
          projectId: PID,
          register: 'edl',
          categoryId: catId,
          docNo: `MRB-${area}-${disc}-${type}-${String(seq[k]).padStart(3, '0')}`,
          revision: reAfc ? '1' : reached.includes('afc') ? '0' : reached.includes('ifa') ? 'B' : reached.includes('ifr') ? 'A' : null,
          title,
          kind: type === 'DWG' ? 'Dwg' : 'Doc',
          sheets: type === 'DWG' ? 1 + Math.floor(rand() * 4) : null,
          pic: pick(ENGINEERS),
          order: seq[k],
        })
        .run();
      const dur = utc(l.finish) - utc(l.start);
      const planAt = (f: number) => new Date(utc(l.start) + dur * f).toISOString().slice(0, 10);
      const sentAt = (r: string) => (l.rungWeek[r] !== undefined ? addDays(E(l.rungWeek[r]), -2 - Math.floor(rand() * 3)) : null);
      const hazop = l.cap !== undefined;
      stage(id, 'edl', 'IFR', planAt(0.4), sentAt('ifr'), 'AWC');
      stage(id, 'edl', 'IFA', planAt(0.75), sentAt('ifa'), hazop ? 'RWC' : rand() < 0.7 ? 'APP' : 'AWC');
      stage(id, 'edl', 'AFC', l.finish, sentAt('afc'), 'APP');
      if (reAfc) stage(id, 'edl', 'RE_AFC1', null, reAfc, 'APP');
      if (hazop) stage(id, 'edl', 'RE_IFA', null, addDays(W(LAST_FULL_WEEK), 1), 'APP');
    }
  }
}

// VDRL: one category per major vendor package. Vendors give no plan dates.
stageWeights('vdrl');
{
  const VENDOR_DOCS: [string, number][] = [
    ['General Arrangement Drawing', 20],
    ['Equipment Datasheet', 20],
    ['Inspection & Test Plan (ITP)', 40],
    ['FAT Procedure', 55],
    ['Manufacturing Record Book (MRB)', 75],
    ['Installation, Operation & Maintenance Manual', 75],
  ];
  const packages = [
    'Gas Compressor Package (2 x 50%)', 'Glycol Dehydration Unit (TEG Package)', 'Gas Metering Skid (Ultrasonic)',
    'Gas Engine Generator 2 x 1.2 MW', 'MV Switchgear 20 kV', 'DCS & ESD System',
  ];
  packages.forEach((name, i) => {
    const l = leaf(name);
    const catId = randomUUID();
    db.insert(schema.docCategories)
      .values({ id: catId, projectId: PID, register: 'vdrl', parentId: null, code: `V${String(i + 1).padStart(2, '0')}`, name, order: i })
      .run();
    const pct = standing.get(l.id) ?? 0;
    const poWeek = l.rungWeek.po ?? LAST_FULL_WEEK;
    VENDOR_DOCS.forEach(([title, needs], j) => {
      const id = randomUUID();
      db.insert(schema.documents)
        .values({ id, projectId: PID, register: 'vdrl', categoryId: catId, docNo: null, title, kind: j === 0 ? 'Dwg' : 'Doc', order: j })
        .run();
      const goes = pct >= needs || (j < 2 && poWeek <= LAST_FULL_WEEK);
      const first = goes ? addDays(W(Math.min(poWeek + 2 + j * 4, LAST_FULL_WEEK)), Math.floor(rand() * 4)) : null;
      stage(id, 'vdrl', 'IFR', null, first, 'AWC');
      const second = first && pct >= needs + 20 ? addDays(first, 21) : null;
      stage(id, 'vdrl', 'IFA', null, second, rand() < 0.6 ? 'APP' : 'AWC');
      stage(id, 'vdrl', 'AFC', null, null, 'APP');
    });
  });
}

/* --------------------------------------------- 8. photos (placeholders) */

interface Shot { file: string; scene: string; caption: string; date: string; sky: 'clear' | 'cloud' | 'rain' }
const shots: Shot[] = [];
const shoot = (dir: string, slot: number, scene: string, caption: string, date: string, sky: Shot['sky']) => {
  const file = `${dir}/slot-${slot}.jpg`;
  shots.push({ file, scene, caption, date, sky });
  return `${PHOTO_URL}/${file}`;
};

/* ----------------------------------------------- 9. two weeks of daily */

const json = migrate(JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')));
const record = emptyDatabase('EPC Gas Processing Facility & Pipeline Lapangan Merbau');
record.project.contractNo = 'EHM/EPC/2026/0142';
record.project.customer = 'PT Energi Hulu Merbau';
record.project.contractor = 'PT Rekayasa Prima Konstruksi';
record.project.workLocation = 'Lapangan Merbau, Musi Banyuasin, Sumatera Selatan';
record.catalogs = {
  ...templateCatalogs(),
  crew: [
    { id: 'office', label: 'Office Staff' },
    { id: 'super', label: 'Site Supervision' },
    { id: 'civil', label: 'Civil & Structure Crew' },
    { id: 'mech', label: 'Mechanical & Piping Crew' },
    { id: 'ei', label: 'Electrical & Instrument Crew' },
    { id: 'pipe', label: 'Subcon Pipeline (PT Sarana Pipa Nusantara)' },
    { id: 'vendor', label: 'Vendor Representative' },
  ],
};
record.photoMeta = {};

const CREW: Record<string, [number, number, number]> = {
  // pob, hours each, hours before the first report
  office: [9, 8, 13_100],
  super: [14, 10, 25_800],
  civil: [46, 10, 71_500],
  mech: [38, 10, 38_900],
  ei: [12, 10, 6_200],
  pipe: [64, 10, 58_400],
  vendor: [2, 8, 1_150],
};
const PLAN_POOL = [
  'Welding pipeline 12" KP 8+400 s/d KP 8+900',
  'Radiography test joint hasil welding kemarin',
  'Stringing line pipe KP 10+000 s/d KP 11+200',
  'Trenching KP 7+200 s/d KP 7+850',
  'Lowering & backfill KP 5+300 s/d KP 5+700',
  'Pilot hole HDD Sungai Lalan',
  'Boring road crossing RC-03 jalan desa Sukamaju',
  'Erection pipe rack PR-02 axis 5-8',
  'Pengecoran pondasi compressor C-101A',
  'Pemasangan anchor bolt pondasi air cooler',
  'Fabrikasi spool piping area separator',
  'Pemasangan rangka atap control room',
  'Pemasangan dinding bata ringan control room',
  'Galian dan bekisting drainage area GPF',
  'Pemasangan earthing grid area generator',
  'Pengecoran pondasi generator G-01 / G-02',
  'Instalasi pipa hydrant ring main',
  'Inspeksi kedatangan material bulk piping di laydown',
];
const SCENE_OF: [RegExp, string][] = [
  [/welding|radiography|lowering|trenching|stringing|kp /i, 'pipeline'],
  [/hdd|boring/i, 'drill'],
  [/pipe rack|rangka/i, 'rack'],
  [/pondasi|pengecoran|bekisting|drainage|anchor/i, 'concrete'],
  [/spool|piping|hydrant/i, 'spool'],
  [/dinding|atap|control room/i, 'building'],
  [/earthing|generator/i, 'electrical'],
  [/material|inspeksi/i, 'yard'],
];
const sceneFor = (text: string) => SCENE_OF.find(([re]) => re.test(text))?.[1] ?? 'yard';
const PERMIT_TYPES: [string, string, string][] = [
  ['HW', 'Hot Work', 'Welding pipeline KP 8'],
  ['EX', 'Excavation', 'Trenching & galian KP 7'],
  ['WH', 'Working at Height', 'Erection pipe rack PR-02'],
  ['CW', 'Cold Work', 'Instalasi hydrant ring main'],
  ['HW', 'Hot Work', 'Fabrikasi spool area separator'],
  ['LF', 'Lifting', 'Lifting line pipe di laydown'],
  ['EX', 'Excavation', 'Galian drainage area GPF'],
  ['CS', 'Confined Space', 'Inspeksi bore pit HDD'],
];
const PA = ['Budi Santoso', 'Agus Salim', 'Wahyu Prasetyo', 'Joko Susilo', 'Iwan Setiawan'];
const permits = PERMIT_TYPES.map(([code, type, description], i) => {
  const issued = addDays('2026-09-14', i * 2);
  return { id: `ptw-${i}`, description, type, pwtNo: `PTW-${code}-${String(380 + i * 7).padStart(4, '0')}`, pa: PA[i % PA.length], issued, validity: addDays(issued, 6) };
});

const DAYS: string[] = [];
for (let d = '2026-09-17'; d <= '2026-09-30'; d = addDays(d, 1)) DAYS.push(d);
const RAIN = new Set(['2026-09-19', '2026-09-22', '2026-09-23', '2026-09-27']);
const CLOUD = new Set(['2026-09-18', '2026-09-24', '2026-09-28']);
const AOCS: Record<string, { type: 'AOC' | 'AFH'; description: string; actionBy: string; status: string }[]> = {
  '2026-09-18': [{ type: 'AOC', description: 'Scaffolding PR-02 belum terpasang scaff tag', actionBy: 'Supervisor Struktur', status: 'CLOSED' }],
  '2026-09-21': [{ type: 'AFH', description: 'Sisa potongan pipa berserakan di area fabrikasi', actionBy: 'Foreman Piping', status: 'CLOSED' }],
  '2026-09-24': [{ type: 'AOC', description: 'Kabel las terkelupas di KP 8+600', actionBy: 'Supervisor Pipeline', status: 'CLOSED' }],
  '2026-09-29': [{ type: 'AOC', description: 'Barikade galian drainage terlepas setelah hujan', actionBy: 'Supervisor Sipil', status: 'OPEN' }],
};

let tomorrowPlan: string[] = [];
DAYS.forEach((date, di) => {
  const report = applyCreateDaily(record, date);
  const sky: Shot['sky'] = RAIN.has(date) ? 'rain' : CLOUD.has(date) ? 'cloud' : 'clear';
  const heavy = date === '2026-09-22';
  const weekday = new Date(utc(date)).getUTCDay();

  const manHours = di === 0
    ? Object.entries(CREW).map(([id, [pob, each, before]]) => ({
        id, company: record.catalogs!.crew.find((c) => c.id === id)!.label, pobQty: pob, hoursEach: each, previousHours: before, todayHours: pob * each,
      }))
    : report.manHours.map((r) => {
        const pob = Math.max(1, r.pobQty + (r.id === 'pipe' || r.id === 'mech' || r.id === 'ei' ? pick([0, 1, 2, -1]) : pick([0, 0, 1, -1])));
        return { ...r, pobQty: pob, todayHours: pob * (r.hoursEach ?? 10) };
      });

  const nonEffective = (di === 0
    ? record.catalogs!.delayCause.map((c) => ({ id: c.id, cause: c.label, previous: ({ wx: 46, gsm: 27, crew: 12, stby: 9, drill: 6, mat: 14, permit: 5 } as Record<string, number>)[c.id] ?? 0, today: 0, remark: '' }))
    : report.nonEffective.map((r) => ({ ...r, remark: '' }))
  ).map((r) => {
    if (r.id === 'wx' && RAIN.has(date)) return { ...r, today: heavy ? 4 : 2, remark: heavy ? 'Hujan deras 10:00-14:00, pekerjaan galian dihentikan' : 'Hujan sore, welding ditunda' };
    if (r.id === 'gsm' && weekday === 1) return { ...r, today: 1, remark: 'General safety meeting Senin pagi' };
    if (r.id === 'mat' && date === '2026-09-25') return { ...r, today: 3, remark: 'Line pipe shipment kedua belum tiba' };
    return { ...r, today: 0 };
  });

  const hseInput = (di === 0
    ? record.catalogs!.hse.map((c) => ({ id: c.id, activity: c.label, previous: ({ nlti: 1, unsafe: 38, nearmiss: 6, medical: 2 } as Record<string, number>)[c.id] ?? 0, today: 0 }))
    : report.hseInput
  ).map((r) => ({ ...r, today: r.id === 'unsafe' ? pick([0, 1, 1, 2]) : r.id === 'nearmiss' && date === '2026-09-24' ? 1 : 0 }));

  const ptw = permits
    .filter((p) => p.issued <= date && (p.validity >= date || (p.pwtNo.includes('-CS-') && date === '2026-09-30')))
    .map((p) => ({ id: p.id, description: p.description, type: p.type, pwtNo: p.pwtNo, pa: p.pa, issued: p.issued, validity: p.validity, status: p.validity === date ? 'CLOSED' : 'OPEN' }));

  // Today is yesterday's plan, ticked; one thing on most days did not happen.
  const missed = di % 3 === 1 ? 1 : -1;
  const todayItems = (di === 0 ? PLAN_POOL.slice(0, 4).map((text, k) => ({ id: `at-${date}-${k}`, text, done: true })) : report.todayItems ?? [])
    .map((it, k) => ({ ...it, done: k !== missed }));
  if (di % 2 === 0) todayItems.push({ id: `at-${date}-extra`, text: pick(['Toolbox meeting & safety induction pekerja baru', 'Housekeeping area laydown', 'Survey as-built ROW KP 0+000 s/d KP 4+000', 'Kalibrasi alat ukur torsi']), done: true });
  tomorrowPlan = Array.from({ length: 4 }, (_, k) => PLAN_POOL[(di * 3 + k + 2) % PLAN_POOL.length]);
  const tomorrowItems = [...new Set(tomorrowPlan)].map((text, k) => ({ id: `tm-${date}-${k}`, text, done: false }));

  const aoc = (AOCS[date] ?? []).map((a, k) => ({ id: `aoc-${date}-${k}`, date, ...a }));

  const done = todayItems.filter((t) => t.done);
  const photoCount = 3 + (di % 3 === 0 ? 1 : 0);
  const photos: (string | null)[] = [null, null, null, null, null, null];
  for (let k = 0; k < photoCount; k += 1) {
    const text = done[k % done.length]?.text ?? 'Kondisi area kerja';
    const rel = shoot(`daily/${date}`, k, sceneFor(text), text, date, sky);
    photos[k] = rel;
    const at = `${date}T${String(9 + k * 2).padStart(2, '0')}:${String(10 + k * 7).padStart(2, '0')}:00+07:00`;
    record.photoMeta![rel] = { path: rel, takenAt: at, uploadedAt: at, verified: false };
  }

  const log = [
    ...done.map((t, k) => ({ id: `log-${date}-a${k}`, at: `${date}T${String(8 + k).padStart(2, '0')}:${String(15 + k * 9).padStart(2, '0')}:00+07:00`, kind: 'activity' as const, text: t.text })),
    ...hseInput.filter((r) => r.today > 0).map((r, k) => ({ id: `log-${date}-h${k}`, at: `${date}T14:${String(20 + k * 5)}:00+07:00`, kind: 'hse' as const, text: `${r.activity} +${r.today}` })),
  ];

  applyPatchDaily(record, date, {
    hariKe: Math.round((utc(date) - utc(START)) / DAY) + 1,
    weather: {
      hujanDeras: heavy, hujanDerasJam: '',
      hujanSedang: RAIN.has(date) && !heavy, hujanSedangJam: '',
      berawanMendung: CLOUD.has(date), berawanMendungJam: '',
      cerahTerang: !RAIN.has(date) && !CLOUD.has(date), cerahTerangJam: '',
      waktuMulai: '07:00', waktuSelesai: '17:00',
    },
    manHours,
    nonEffective,
    hseInput,
    ptw,
    todayItems,
    tomorrowItems,
    aoc,
    aocNone: aoc.length === 0,
    photos,
    log,
    confirmed: { manHours: true, ptw: true, hse: true, aoc: true, activities: true },
  });
});

// Weekly documentation photos for the last four weeks.
const WEEKLY_SCENES: [string, string][] = [
  ['pipeline', 'Progress welding & lowering pipeline'],
  ['rack', 'Erection pipe rack PR-02'],
  ['concrete', 'Pondasi equipment area GPF'],
  ['building', 'Control room: pekerjaan dinding & atap'],
  ['drill', 'Persiapan HDD Sungai Lalan'],
  ['yard', 'Material di laydown area'],
];
record.weeklyPhotos = {};
for (let w = 27; w <= CURRENT_WEEK; w += 1) {
  const count = w === CURRENT_WEEK ? 3 : 6;
  record.weeklyPhotos[String(w)] = Array.from({ length: 6 }, (_, k) => {
    if (k >= count) return null;
    const [scene, caption] = WEEKLY_SCENES[(k + w) % WEEKLY_SCENES.length];
    const date = addDays(W(w), 4);
    const rel = shoot(`weekly/${w}`, k, scene, `${caption} (minggu ${w})`, date, k === 2 ? 'cloud' : 'clear');
    record.photoMeta![rel] = { path: rel, takenAt: `${date}T10:00:00+07:00`, uploadedAt: `${date}T16:00:00+07:00`, verified: false };
    return rel;
  });
}

json.projects[PID] = record;
if (!json.order.includes(PID)) json.order.push(PID);
fs.writeFileSync(JSON_PATH, JSON.stringify(json), 'utf-8');

/* ------------------------------------------------- 10. draw the photos */

const SKY = { clear: ['#7cc0f2', '#d9eefc'], cloud: ['#8b97a6', '#cfd6de'], rain: ['#56606c', '#9aa4ae'] };
function sceneSvg(s: Shot): string {
  const [top, bottom] = SKY[s.sky];
  const ground = s.scene === 'pipeline' || s.scene === 'drill' ? '#8a6a45' : '#9b9283';
  const r = (n: number) => Math.round(rand() * n);
  const parts: string[] = [];
  switch (s.scene) {
    case 'pipeline':
      parts.push(`<rect x="0" y="610" width="1280" height="90" fill="#6d5236"/>`);
      for (let i = 0; i < 6; i += 1) parts.push(`<rect x="${-40 + i * 230}" y="560" width="225" height="36" rx="18" fill="#2f3a3f"/><rect x="${178 + i * 230}" y="556" width="14" height="44" fill="#c9c9c9"/>`);
      for (let i = 0; i < 6; i += 1) parts.push(`<rect x="${60 + i * 230}" y="596" width="22" height="40" fill="#5a3d22"/>`);
      parts.push(`<rect x="${640 + r(80)}" y="430" width="60" height="120" rx="12" fill="#f39c12"/><circle cx="${670 + r(80)}" cy="410" r="26" fill="#f1c40f"/><circle cx="660" cy="575" r="10" fill="#fff6a8" opacity="0.95"/>`);
      break;
    case 'drill':
      parts.push(`<polygon points="300,600 520,260 560,260 380,600" fill="#d35400"/><rect x="180" y="560" width="420" height="80" fill="#e67e22"/><rect x="700" y="540" width="260" height="100" fill="#ecf0f1"/><rect x="980" y="590" width="240" height="40" rx="20" fill="#2f3a3f"/>`);
      break;
    case 'rack':
      for (let i = 0; i < 5; i += 1) parts.push(`<rect x="${140 + i * 220}" y="300" width="24" height="330" fill="#7f8c8d"/>`);
      parts.push(`<rect x="130" y="300" width="920" height="22" fill="#95a5a6"/><rect x="130" y="420" width="920" height="22" fill="#95a5a6"/>`);
      for (let i = 0; i < 4; i += 1) parts.push(`<rect x="130" y="${280 - i * 14}" width="920" height="12" rx="6" fill="${['#c0392b', '#7f8c8d', '#f1c40f', '#2c3e50'][i]}"/>`);
      parts.push(`<polygon points="1100,640 1130,120 1150,120 1130,640" fill="#f1c40f"/><line x1="1140" y1="130" x2="760" y2="200" stroke="#f1c40f" stroke-width="14"/><line x1="800" y1="200" x2="800" y2="290" stroke="#333" stroke-width="3"/>`);
      break;
    case 'concrete':
      parts.push(`<rect x="220" y="520" width="380" height="110" fill="#bdc3c7"/><rect x="680" y="540" width="300" height="90" fill="#aab2b7"/>`);
      for (let i = 0; i < 9; i += 1) parts.push(`<rect x="${240 + i * 40}" y="470" width="8" height="60" fill="#7f4f24"/>`);
      parts.push(`<rect x="1000" y="470" width="180" height="120" rx="16" fill="#e74c3c"/><ellipse cx="1090" cy="460" rx="70" ry="40" fill="#ecf0f1"/>`);
      break;
    case 'spool':
      for (let i = 0; i < 5; i += 1) parts.push(`<rect x="${120 + i * 210}" y="${500 - (i % 2) * 40}" width="180" height="40" rx="20" fill="#7f8c8d"/><rect x="${280 + i * 210}" y="${470 - (i % 2) * 40}" width="40" height="110" rx="6" fill="#95a5a6"/>`);
      parts.push(`<rect x="0" y="620" width="1280" height="20" fill="#5d6d7e"/>`);
      break;
    case 'building':
      parts.push(`<rect x="300" y="330" width="680" height="300" fill="#ecf0f1"/><polygon points="270,340 640,210 1010,340" fill="#34495e"/>`);
      for (let i = 0; i < 5; i += 1) parts.push(`<rect x="${350 + i * 125}" y="420" width="70" height="80" fill="#5dade2"/>`);
      parts.push(`<rect x="590" y="530" width="100" height="100" fill="#7f8c8d"/><rect x="1040" y="300" width="14" height="330" fill="#bdc3c7"/><rect x="1040" y="300" width="160" height="14" fill="#bdc3c7"/>`);
      break;
    case 'electrical':
      parts.push(`<rect x="260" y="470" width="300" height="160" fill="#27ae60"/><rect x="620" y="440" width="300" height="190" fill="#16a085"/><rect x="980" y="520" width="200" height="110" fill="#7f8c8d"/>`);
      for (let i = 0; i < 8; i += 1) parts.push(`<line x1="${200 + i * 120}" y1="640" x2="${260 + i * 120}" y2="700" stroke="#b87333" stroke-width="8"/>`);
      break;
    default:
      for (let i = 0; i < 4; i += 1) parts.push(`<rect x="${100 + i * 40}" y="${600 - i * 34}" width="600" height="30" rx="15" fill="#34495e"/>`);
      parts.push(`<rect x="820" y="460" width="320" height="170" fill="#e67e22"/><rect x="840" y="480" width="120" height="70" fill="#d6eaf8"/>`);
  }
  const rain = s.sky === 'rain'
    ? Array.from({ length: 90 }, () => { const x = r(1280); const y = r(600); return `<line x1="${x}" y1="${y}" x2="${x - 8}" y2="${y + 26}" stroke="#dfe6ee" stroke-width="2" opacity="0.6"/>`; }).join('')
    : '';
  const sun = s.sky === 'clear' ? `<circle cx="${1050 + r(120)}" cy="${110 + r(40)}" r="54" fill="#fff3b0"/>` : `<ellipse cx="${300 + r(500)}" cy="120" rx="220" ry="55" fill="#ffffff" opacity="0.35"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">
    <defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <rect width="1280" height="640" fill="url(#sky)"/>${sun}
    <polygon points="0,600 220,520 430,575 700,500 980,560 1280,510 1280,640 0,640" fill="#4f7a3a"/>
    <rect y="630" width="1280" height="330" fill="${ground}"/>
    ${parts.join('')}${rain}
  </svg>`;
}
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome not found: the photos need it to be drawn');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });
  for (const s of shots) {
    const date = new Date(`${s.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    await page.setContent(`<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif">
      <div style="position:relative;width:1280px;height:960px;overflow:hidden">${sceneSvg(s)}
        <div style="position:absolute;left:0;right:0;bottom:0;padding:22px 30px;background:rgba(0,0,0,.55);color:#fff">
          <div style="font-size:30px;font-weight:600">${esc(s.caption)}</div>
          <div style="font-size:22px;opacity:.85;margin-top:6px">Lapangan Merbau · ${date} · FOTO DUMMY</div>
        </div></div></body></html>`);
    const out = path.join(PHOTO_DIR, s.file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: 'jpeg', quality: 78 });
  }
} finally {
  await browser.close();
}
// Local play data: keep it out of git.
fs.writeFileSync(path.join(PHOTO_DIR, '.gitignore'), '*\n');

/* ------------------------------------------------------------ 11. report */

const dash = buildProjectDashboardData(PID)!;
const gate = weightGate(dash.db.wbsItems);
const totalAt = (week: number) => {
  const meta = dash.db.weeks.find((x) => x.week === week)!;
  const prev = dash.db.weeks.find((x) => x.week === week - 1);
  return computeGrandTotal(promoteNestedSpkContracts(computeRollup(dash.db.wbsItems, meta.leafData, prev?.leafData ?? null)));
};
const t29 = totalAt(LAST_FULL_WEEK);
const t30 = totalAt(CURRENT_WEEK);
const count = (sql: string) => (db.$client.prepare(sql).get(PID) as { n: number }).n;
console.log(`Project   ${PID}  (${DB_PATH})`);
console.log(`Weights   gate ${gate.ok ? 'closed' : 'OPEN'}  · ${leaves.filter((l) => l.phase !== 'ms').length} activities + ${MILESTONES.length} milestones`);
console.log(`Week 29   plan ${t29.planPct.toFixed(2)}%  actual ${t29.curProgressPct.toFixed(2)}%`);
console.log(`Week 30   plan ${t30.planPct.toFixed(2)}%  actual ${t30.curProgressPct.toFixed(2)}%  (half filled in)`);
console.log(`Progress  ${count('select count(*) n from leaf_progress lp join weeks w on w.id = lp.week_id where w.project_id = ?')} rows`);
console.log(`Register  ${count("select count(*) n from documents where project_id = ? and register = 'edl'")} EDL · ${count("select count(*) n from documents where project_id = ? and register = 'vdrl'")} VDRL · ${count('select count(*) n from transmittals where project_id = ?')} transmittals`);
console.log(`Daily     ${record.daily.length} reports (${DAYS[0]} .. ${DAYS[DAYS.length - 1]}) · ${shots.length} photos`);
