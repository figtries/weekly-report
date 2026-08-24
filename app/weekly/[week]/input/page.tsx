import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import FieldInput, { type FieldRow } from '@/components/weekly/FieldInput';
import { methodOf } from '@/lib/progress';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function FieldInputPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);

  const [db, rollup] = await Promise.all([getDb(), getCachedWeekRollup(week)]);
  if (!rollup) notFound();

  const meta = rollup.meta;
  const flat = flattenTree(rollup.roots);
  const byId = new Map(flat.map((n) => [n.id, n]));

  const ancestorsOf = (id: string): string => {
    const chain: string[] = [];
    let cur = byId.get(id);
    while (cur?.parentId) {
      const p = byId.get(cur.parentId);
      if (!p) break;
      chain.unshift(p.deskripsi.length > 22 ? `${p.deskripsi.slice(0, 21)}…` : p.deskripsi);
      cur = p;
    }
    return chain.slice(-2).join(' › ');
  };

  const rows: FieldRow[] = flat
    .filter((n) => n.isLeaf && n.bobot > 0)
    .map((n) => ({
      item: db.wbsItems.find((i) => i.id === n.id) ?? n,
      snap: meta.leafData[n.id] ?? null,
      ancestors: ancestorsOf(n.id),
      planPct: n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0,
    }));

  const measurable = rows.filter((r) => methodOf(r.item) !== 'lumpsum').length;

  return (
    <div className="animate-fade-in-up px-3 py-4 sm:p-6 lg:p-8 print:hidden">
      <header className="mb-5 sm:mb-6">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight sm:mb-2 sm:text-3xl">
          Input Lapangan
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
          <span className="font-medium text-foreground">Minggu {week}</span> · Lapor yang selesai,
          bukan tebak persennya. {measurable} dari {rows.length} item sudah bisa diukur — setiap
          angka di sini punya bukti yang bisa dicek ulang di lapangan.
        </p>
      </header>

      <FieldInput
        week={week}
        rows={rows}
        contractValue={db.project.contractValue ?? null}
        editable
      />
    </div>
  );
}
