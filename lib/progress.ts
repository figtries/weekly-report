import type { LeafSnapshot, Milestone, ProgressMethod, WbsItem } from './types';

/**
 * Where a leaf's percentage comes from.
 *
 * The whole argument for this app rests on one substitution: stop asking "what
 * percent is it?" — a question that needs years of judgement — and ask "how
 * much did you finish?", which anyone can answer and anyone else can go and
 * check. This module is that substitution.
 *
 * Everything funnels through `resolveLeafProgress` so a percentage can only
 * ever have one origin. `lib/rollup.ts` calls it instead of reading
 * `cumProgressPct` directly, which means a quantity-based item cannot drift
 * from its own evidence no matter which screen wrote last.
 */

export function methodOf(item: Pick<WbsItem, 'progressMethod'>): ProgressMethod {
  return item.progressMethod ?? 'lumpsum';
}

/** Total quantity for a `qty` item. Falls back to 1 so a missing volume can't divide by zero. */
export function totalQty(item: Pick<WbsItem, 'vol'>): number {
  return item.vol && item.vol > 0 ? item.vol : 1;
}

/**
 * Whether an item actually has something countable.
 *
 * `vol: 1, satuan: 'Ls'` is how every seeded item is stored, and it is a
 * lumpsum placeholder rather than a quantity — treating it as one turns
 * "1 of 1 Ls" into a measurement it never was. Switching such an item to
 * quantity mode has to ask for a real total first.
 */
export function hasRealQuantity(item: Pick<WbsItem, 'vol' | 'satuan'>): boolean {
  if (!item.vol || item.vol <= 0) return false;
  const unit = (item.satuan ?? '').trim().toLowerCase();
  if (!unit || unit === 'ls' || unit === 'lot') return false;
  return true;
}

export function milestoneProgress(milestones: Milestone[], done: string[]): number {
  const total = milestones.reduce((s, m) => s + m.weight, 0);
  if (total <= 0) return 0;
  const reached = milestones
    .filter((m) => done.includes(m.id))
    .reduce((s, m) => s + m.weight, 0);
  return (reached / total) * 100;
}

/**
 * The single answer to "what percent is this leaf?".
 *
 * A `qty` or `milestone` item ignores any stored `cumProgressPct` entirely —
 * that field is a cache, and trusting it over the evidence is how a report ends
 * up disagreeing with the site.
 */
export function resolveLeafProgress(
  item: Pick<WbsItem, 'progressMethod' | 'vol' | 'milestones'>,
  snap: LeafSnapshot | null | undefined
): number {
  if (!snap) return 0;
  switch (methodOf(item)) {
    case 'qty': {
      const done = Math.max(0, snap.qtyDone ?? 0);
      return Math.min(100, (done / totalQty(item)) * 100);
    }
    case 'milestone':
      return milestoneProgress(item.milestones ?? [], snap.milestonesDone ?? []);
    case 'lumpsum':
      return snap.cumProgressPct ?? 0;
  }
}

/** How the number was arrived at, for showing beside it. An audit trail in one line. */
export function progressEvidence(
  item: Pick<WbsItem, 'progressMethod' | 'vol' | 'satuan' | 'milestones'>,
  snap: LeafSnapshot | null | undefined
): string {
  switch (methodOf(item)) {
    case 'qty': {
      const done = Math.max(0, snap?.qtyDone ?? 0);
      const unit = item.satuan ?? '';
      return `${fmt(done)} / ${fmt(totalQty(item))} ${unit}`.trim();
    }
    case 'milestone': {
      const done = snap?.milestonesDone ?? [];
      const labels = (item.milestones ?? [])
        .filter((m) => done.includes(m.id))
        .map((m) => m.label);
      return labels.length ? labels.join(' + ') : 'none yet';
    }
    case 'lumpsum':
      return 'diketik manual';
  }
}

/**
 * Recompute and store the cached percent after an edit.
 *
 * Callers mutate `qtyDone` / `milestonesDone`; this puts `cumProgressPct` back
 * in step. Kept separate from `resolveLeafProgress` so reads never write.
 */
export function syncLeafSnapshot(
  item: Pick<WbsItem, 'progressMethod' | 'vol' | 'milestones'>,
  snap: LeafSnapshot
): LeafSnapshot {
  if (methodOf(item) === 'lumpsum') return snap;
  return { ...snap, cumProgressPct: resolveLeafProgress(item, snap) };
}

/** The standard engineering deliverable ladder, offered when switching an item to milestones. */
export function defaultMilestones(): Milestone[] {
  return [
    { id: 'ifr', label: 'IFR — Issued for Review', weight: 50 },
    { id: 'ifa', label: 'IFA — Issued for Approval', weight: 30 },
    { id: 'afc', label: 'AFC — Approved for Construction', weight: 20 },
  ];
}

function fmt(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
