/**
 * Loads the Engineering Deliverable List into the v2 database.
 *
 * Runs after `import-gundih.ts`, because the register hangs off the project
 * that script creates.
 *
 * What this does NOT do: switch the WBS engineering leaves to `linked`. The
 * register on file is `R2, 15 Jan 2026 (~W13)` while the weekly workbook
 * reports W43 in August — thirty weeks apart. Pointing the leaves at it would
 * drag engineering progress back to January and break a W43 total that matches
 * the signed report. `verify-edl.ts` prints the correlation instead, so the
 * gap is visible rather than absorbed; the switch is item 15's, with a register
 * of the same vintage.
 *
 * Run: node scripts/import-edl.ts [path-to-edl-workbook]
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

import * as schema from '../lib/schema.ts';
import { readEdlWorkbook, parentCode, isLeafCategory, EDL_STAGES, type SourceDocument } from './edl-source.ts';

const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');
const sqlite = new Database(DB_PATH);
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

const DEFAULT_FILE =
  'C:/Users/LENOVO/Downloads/PRGG-00-G0-LS-003~W13 _Engineering Drawing List_Update_15012026 R2.xlsx';

const PROJECT_ID = 'gundih';

function inChunks<T>(items: T[], size: number, write: (batch: T[]) => void) {
  for (let i = 0; i < items.length; i += size) write(items.slice(i, i + size));
}

async function main() {
  const file = process.argv[2] ?? DEFAULT_FILE;
  console.log(`membaca  ${file}`);

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).all()[0];
  if (!project) throw new Error('proyek belum ada — jalankan scripts/import-gundih.ts dulu');

  const src = await readEdlWorkbook(file);

  /* ------------------------------------------------- documents, deduped */

  const seen = new Map<string, SourceDocument>();
  const duplicates: string[] = [];
  for (const doc of src.documents) {
    if (seen.has(doc.docNo)) { duplicates.push(`${doc.docNo} (baris ${doc.excelRow})`); continue; }
    seen.set(doc.docNo, doc);
  }
  const documents = [...seen.values()];

  /* ---------------------------------------------------------- categories */

  const categoryIds = new Map(src.categories.map((c) => [c.code, `${PROJECT_ID}:cat:${c.code}`]));
  const leafCategories = src.categories.filter((c) => isLeafCategory(c.code, src.categories));

  const orphans = documents.filter((d) => !categoryIds.has(d.categoryCode));
  if (orphans.length) throw new Error(`${orphans.length} dokumen tanpa kategori, mis. ${orphans[0].docNo}`);

  /* -------------------------------------------------------- transmittals */

  const transmittals = new Map<string, { id: string; no: string; direction: 'out' | 'in'; date: string }>();
  const noteTransmittal = (no: string | null, direction: 'out' | 'in', when: string | null) => {
    if (!no) return null;
    const key = `${no}|${direction}`;
    if (!transmittals.has(key)) {
      transmittals.set(key, {
        id: `${PROJECT_ID}:tr:${direction}:${no}`,
        no, direction,
        // A transmittal with no date is still a real transmittal; the project
        // start is a safe floor and keeps the NOT NULL honest.
        date: when ?? project.startDate ?? '2025-10-27',
      });
    }
    return transmittals.get(key)!.id;
  };

  const stageRows: Array<typeof schema.docStages.$inferInsert> = [];
  for (const doc of documents) {
    for (const s of doc.stages) {
      stageRows.push({
        id: `${PROJECT_ID}:st:${doc.docNo}:${s.stage}`,
        documentId: `${PROJECT_ID}:doc:${doc.docNo}`,
        stage: s.stage,
        order: EDL_STAGES.indexOf(s.stage),
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

  // Scoped to `edl` throughout: the same four tables also hold the vendor
  // register, and an unscoped delete here would take the VDRL with it.
  db.transaction((tx) => {
    // Re-runnable. Order matters: stages reference transmittals.
    const existing = db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, PROJECT_ID), eq(schema.documents.register, 'edl'))).all();
    for (const doc of existing) {
      tx.delete(schema.docStages).where(eq(schema.docStages.documentId, doc.id)).run();
    }
    tx.delete(schema.documents)
      .where(and(eq(schema.documents.projectId, PROJECT_ID), eq(schema.documents.register, 'edl'))).run();
    tx.delete(schema.transmittals)
      .where(and(eq(schema.transmittals.projectId, PROJECT_ID), eq(schema.transmittals.register, 'edl'))).run();
    tx.delete(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, PROJECT_ID), eq(schema.docCategories.register, 'edl'))).run();
    tx.delete(schema.docStageWeights)
      .where(and(eq(schema.docStageWeights.projectId, PROJECT_ID), eq(schema.docStageWeights.register, 'edl'))).run();

    tx.insert(schema.docStageWeights).values(
      EDL_STAGES.map((stage, order) => ({
        id: `${PROJECT_ID}:sw:${stage}`,
        projectId: PROJECT_ID,
        register: 'edl' as const,
        stage,
        // Only the three agreed stages carry weight. A resubmission is evidence
        // of how many times a drawing went round, not extra progress.
        weight: stage === 'IFR' ? src.stageWeights.IFR * 100
          : stage === 'IFA' ? src.stageWeights.IFA * 100
          : stage === 'AFC' ? src.stageWeights.AFC * 100
          : 0,
        order,
      })),
    ).run();

    inChunks(src.categories, 200, (batch) => {
      tx.insert(schema.docCategories).values(batch.map((c, i) => ({
        id: categoryIds.get(c.code)!,
        projectId: PROJECT_ID,
        register: 'edl' as const,
        parentId: (() => { const p = parentCode(c.code); return p ? categoryIds.get(p) ?? null : null; })(),
        code: c.code,
        name: c.name,
        order: i,
        plannedCount: c.plannedCount,
      }))).run();
    });

    inChunks([...transmittals.values()], 200, (batch) => {
      tx.insert(schema.transmittals).values(batch.map((t) => ({
        id: t.id, projectId: PROJECT_ID, register: 'edl' as const, no: t.no, direction: t.direction, date: t.date,
      }))).run();
    });

    inChunks(documents, 200, (batch) => {
      tx.insert(schema.documents).values(batch.map((d, i) => ({
        id: `${PROJECT_ID}:doc:${d.docNo}`,
        projectId: PROJECT_ID,
        register: 'edl' as const,
        categoryId: categoryIds.get(d.categoryCode)!,
        docNo: d.docNo,
        existingDwgNo: d.existingDwgNo,
        revision: d.revision,
        title: d.title,
        kind: d.kind,
        size: d.size,
        sheets: d.sheets,
        priority: d.priority,
        pic: d.pic,
        status: d.status,
        remarks: d.remarks,
        order: i,
      }))).run();
    });

    inChunks(stageRows, 200, (batch) => tx.insert(schema.docStages).values(batch).run());
  });

  /* -------------------------------------------------------------- report */

  const totalPlanned = leafCategories.reduce((a, c) => a + (c.plannedCount ?? 0), 0);
  console.log(`\n${src.categories.length} kategori (${leafCategories.length} daun) · ${documents.length} dokumen · ${transmittals.size} transmittal · ${stageRows.length} catatan tahap`);
  console.log(`bobot tahap: IFR ${src.stageWeights.IFR} · IFA ${src.stageWeights.IFA} · AFC ${src.stageWeights.AFC}`);
  console.log(`jumlah dokumen menurut ringkasan: ${totalPlanned}`);

  if (duplicates.length) {
    console.log(`\n${duplicates.length} nomor dokumen ganda, yang pertama dipakai:`);
    for (const d of duplicates) console.log(`  ${d}`);
  }

  const registered = new Set(documents.map((d) => d.docNo));
  const withoutStages = documents.filter((d) => d.stages.length === 0);
  if (withoutStages.length) {
    console.log(`\n${withoutStages.length} dokumen belum punya satu pun tahap tercatat (${registered.size} terdaftar)`);
  }

  console.log(`\nditulis ke ${DB_PATH}`);
  console.log('leaf engineering di WBS TIDAK ditautkan — register ini W13, laporan mingguannya W43.');
}

await main();
sqlite.close();
