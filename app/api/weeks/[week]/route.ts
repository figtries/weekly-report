import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import type { ChangeLogEntry, LeafSnapshot } from '@/lib/types';

const MAX_LOG = 500;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const body = (await request.json()) as { updates: Record<string, Partial<LeafSnapshot>> };

  try {
    const updated = await mutateDb((db) => {
      const meta = db.weeks.find((w) => w.week === week);
      if (!meta) throw new Error(`Week ${week} not found`);
      const wbsById = new Map(db.wbsItems.map((w) => [w.id, w]));
      if (!db.changeLog) db.changeLog = [];
      const at = new Date().toISOString();

      for (const [id, patch] of Object.entries(body.updates)) {
        const existing = meta.leafData[id] ?? { cumProgressPct: 0, targetWF: 0 };
        const wbs = wbsById.get(id);
        const bobot = wbs?.bobot ?? 0;

        if (patch.cumProgressPct !== undefined && patch.cumProgressPct !== existing.cumProgressPct) {
          db.changeLog.push({
            id: `${at}-${id}-actual`,
            leafId: id,
            week,
            field: 'cumProgressPct',
            oldValue: existing.cumProgressPct,
            newValue: patch.cumProgressPct,
            at,
          } satisfies ChangeLogEntry);
        }
        if (patch.targetWF !== undefined && patch.targetWF !== existing.targetWF) {
          const oldPlanPct = bobot > 0 ? (existing.targetWF / bobot) * 100 : 0;
          const newPlanPct = bobot > 0 ? (patch.targetWF / bobot) * 100 : 0;
          db.changeLog.push({
            id: `${at}-${id}-plan`,
            leafId: id,
            week,
            field: 'planPct',
            oldValue: oldPlanPct,
            newValue: newPlanPct,
            at,
          } satisfies ChangeLogEntry);
        }
        meta.leafData[id] = { ...existing, ...patch };
      }

      if (db.changeLog.length > MAX_LOG) {
        db.changeLog = db.changeLog.slice(-MAX_LOG);
      }
      return meta;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
