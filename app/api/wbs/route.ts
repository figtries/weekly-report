import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import type { WbsItem } from '@/lib/types';

type Body =
  | {
      action: 'add';
      parentId: string | null;
      wbsCode: string;
      deskripsi: string;
      bobot: number;
      vol: number | null;
      satuan: string | null;
    }
  | { action: 'edit'; id: string; patch: Partial<Omit<WbsItem, 'id'>> }
  | { action: 'delete'; id: string };

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as Body;

  try {
    const result = await mutateDb((db) => {
      if (body.action === 'add') {
        const maxN = db.wbsItems.reduce((max, i) => {
          const n = Number(i.id.replace(/^w/, ''));
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        const id = `w${maxN + 1}`;
        const order = db.wbsItems.length + 1;
        const item: WbsItem = {
          id,
          parentId: body.parentId,
          wbsCode: body.wbsCode,
          deskripsi: body.deskripsi,
          bobot: body.bobot,
          vol: body.vol,
          satuan: body.satuan,
          order,
        };
        db.wbsItems.push(item);
        db.weeks.forEach((w) => {
          w.leafData[id] = { cumProgressPct: 0, targetWF: 0 };
        });
        return item;
      }

      if (body.action === 'edit') {
        const item = db.wbsItems.find((i) => i.id === body.id);
        if (!item) throw new Error('WBS item not found');
        Object.assign(item, body.patch);
        return item;
      }

      if (body.action === 'delete') {
        const idsToRemove = new Set<string>();
        const collect = (id: string) => {
          idsToRemove.add(id);
          db.wbsItems.filter((i) => i.parentId === id).forEach((c) => collect(c.id));
        };
        collect(body.id);
        db.wbsItems = db.wbsItems.filter((i) => !idsToRemove.has(i.id));
        db.weeks.forEach((w) => {
          idsToRemove.forEach((id) => delete w.leafData[id]);
        });
        return { deletedIds: Array.from(idsToRemove) };
      }

      throw new Error('Unknown action');
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
