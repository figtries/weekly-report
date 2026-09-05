/**
 * Loads the Vendor Drawing Register List into the v2 database.
 *
 * Same tables as the EDL, told apart by `register: 'vdrl'` — one engine, one
 * write path, one log. Scoped deletes throughout, so running this never
 * touches the engineering register and vice versa.
 *
 * The vendor register carries no summary sheet of its own, so nobody has
 * agreed stage weights for it. It inherits the EDL's IFR 50 · IFA 30 · AFC 20
 * until someone says otherwise, and the screen says so out loud rather than
 * presenting the number as the client's.
 *
 * Run: node scripts/import-vdrl.ts [path-to-edl-workbook]
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

import * as schema from '../lib/schema.ts';
import { readVdrlWorkbook, VDRL_STAGES } from './vdrl-source.ts';

const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');
const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

const DEFAULT_FILE =
  'C:/Users/LENOVO/Downloads/PRGG-00-G0-LS-003~W13 _Engineering Drawing List_Update_15012026 R2.xlsx';

const PROJECT_ID = 'gundih';
const REGISTER = 'vdrl' as const;

/** Inherited from the EDL until the vendor register gets an agreement of its own. */
const STAGE_WEIGHTS: Record<string, number> = { IFR: 50, IFA: 30, AFC: 20 };

function inChunks<T>(items: T[], size: number, write: (batch: T[]) => void) {
  for (let i = 0; i < items.length; i += size) write(items.slice(i, i + size));
}

async function main() {
  const file = process.argv[2] ?? DEFAULT_FILE;
  console.log(`membaca  ${file}`);

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).all()[0];
  if (!project) throw new Error('proyek belum ada — jalankan scripts/import-gundih.ts dulu');

  const src = await readVdrlWorkbook(file);

  const categoryIds = new Map(src.categories.map((c) => [c.code, `${PROJECT_ID}:vcat:${c.code}`]));
  const orphans = src.documents.filter((d) => !categoryIds.has(d.groupCode));
  if (orphans.length) throw new Error(`${orphans.length} dokumen tanpa kelompok, mis. baris ${orphans[0].excelRow}`);

  /* ------------------------------------------------------------ documents */

  // 115 rows have no document number, and several numbers repeat across
  // packages, so identity is the row it came from. It is stable across
  // re-imports of the same workbook and unique by construction.
  const docId = (excelRow: number) => `${PROJECT_ID}:vdoc:${excelRow}`;

  /* -------------------------------------------------------- transmittals */

  const transmittals = new Map<string, { id: string; no: string; direction: 'out' | 'in'; date: string }>();
  const noteTransmittal = (no: string | null, direction: 'out' | 'in', when: string | null) => {
    if (!no) return null;
    const key = `${no}|${direction}`;
    if (!transmittals.has(key)) {
      transmittals.set(key, {
        id: `${PROJECT_ID}:vtr:${direction}:${no}`,
        no, direction,
        date: when ?? project.startDate ?? '2025-10-27',
      });
    }
    return transmittals.get(key)!.id;
  };

  const stageRows: Array<typeof schema.docStages.$inferInsert> = [];
  for (const doc of src.documents) {
    for (const s of doc.stages) {
      stageRows.push({
        id: `${PROJECT_ID}:vst:${doc.excelRow}:${s.stage}`,
        documentId: docId(doc.excelRow),
        stage: s.stage,
        order: VDRL_STAGES.indexOf(s.stage),
        planSubmitDate: s.planSubmitDate,
        submitted: s.submitted || s.submitTransmittal !== null || s.returnedAt !== null ||
          s.returnTransmittal !== null || s.returnCode !== null,
        submittedAt: s.submittedAt,
        submitTransmittalId: noteTransmittal(s.submitTransmittal, 'out', s.submittedAt),
        returnedAt: s.returnedAt,
        returnTransmittalId: noteTransmittal(s.returnTransmittal, 'in', s.returnedAt),
        returnCode: s.returnCode,
      });
    }
  }

  /* --------------------------------------------------------------- write */

  db.transaction((tx) => {
    const existing = db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, PROJECT_ID), eq(schema.documents.register, REGISTER))).all();
    for (const doc of existing) {
      tx.delete(schema.docStages).where(eq(schema.docStages.documentId, doc.id)).run();
    }
    tx.delete(schema.documents)
      .where(and(eq(schema.documents.projectId, PROJECT_ID), eq(schema.documents.register, REGISTER))).run();
    tx.delete(schema.transmittals)
      .where(and(eq(schema.transmittals.projectId, PROJECT_ID), eq(schema.transmittals.register, REGISTER))).run();
    tx.delete(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, PROJECT_ID), eq(schema.docCategories.register, REGISTER))).run();
    tx.delete(schema.docStageWeights)
      .where(and(eq(schema.docStageWeights.projectId, PROJECT_ID), eq(schema.docStageWeights.register, REGISTER))).run();

    tx.insert(schema.docStageWeights).values(
      VDRL_STAGES.map((stage, order) => ({
        id: `${PROJECT_ID}:vsw:${stage}`,
        projectId: PROJECT_ID,
        register: REGISTER,
        stage,
        weight: STAGE_WEIGHTS[stage] ?? 0,
        order,
      })),
    ).run();

    inChunks(src.categories, 200, (batch) => {
      tx.insert(schema.docCategories).values(batch.map((c, i) => ({
        id: categoryIds.get(c.code)!,
        projectId: PROJECT_ID,
        register: REGISTER,
        parentId: c.parentCode ? categoryIds.get(c.parentCode) ?? null : null,
        code: c.code,
        name: c.name,
        order: i,
        plannedCount: null,
      }))).run();
    });

    inChunks([...transmittals.values()], 200, (batch) => {
      tx.insert(schema.transmittals).values(batch.map((t) => ({
        id: t.id, projectId: PROJECT_ID, register: REGISTER, no: t.no, direction: t.direction, date: t.date,
      }))).run();
    });

    inChunks(src.documents, 200, (batch) => {
      tx.insert(schema.documents).values(batch.map((d) => ({
        id: docId(d.excelRow),
        projectId: PROJECT_ID,
        register: REGISTER,
        categoryId: categoryIds.get(d.groupCode)!,
        docNo: d.docNo,
        revision: d.revision,
        title: d.title,
        // `Dwg` only where the vendor said so in the group name; everything
        // else stays a document rather than being guessed at.
        kind: /drawing|dwg/i.test(src.categories.find((c) => c.code === d.groupCode)?.name ?? '') ? 'Dwg' : 'Doc',
        status: d.status,
        remarks: d.remarks,
        // Who reviews it, kept as the sheet's own two flags.
        priority: [d.reviewPti ? 'PTI' : null, d.reviewPep ? 'PEP' : null].filter(Boolean).join(' · ') || null,
        order: d.excelRow,
      }))).run();
    });

    inChunks(stageRows, 200, (batch) => tx.insert(schema.docStages).values(batch).run());
  });

  /* -------------------------------------------------------------- report */

  const packages = src.categories.filter((c) => !c.parentCode);
  const numbered = src.documents.filter((d) => d.docNo).length;
  const moving = src.documents.filter((d) => d.stages.length > 0).length;

  console.log(`\n${packages.length} paket vendor · ${src.categories.length - packages.length} kelompok · ${src.documents.length} dokumen · ${transmittals.size} transmittal · ${stageRows.length} catatan tahap`);
  console.log(`bobot tahap diwarisi dari EDL: IFR ${STAGE_WEIGHTS.IFR} · IFA ${STAGE_WEIGHTS.IFA} · AFC ${STAGE_WEIGHTS.AFC}`);
  console.log(`${numbered} bernomor · ${src.documents.length - numbered} belum diberi nomor oleh vendornya`);
  console.log(`${moving} dokumen sudah bergerak · ${src.documents.length - moving} belum pernah dikirim sama sekali`);

  console.log(`\nditulis ke ${DB_PATH}`);
}

await main();
sqlite.close();
