/**
 * The EPC profile: what an experienced EPC planner knows that the forecast
 * needs, and the ONLY file in the app that knows the work is EPC.
 *
 * The engine (`lib/forecast.ts`) and the checks (`lib/forecast-checks.ts`) ask
 * it three things: which phase a HEADING names, which rungs of a ladder a
 * row's NAME names, and what a row waits for by default. Another energy sector
 * answers the same three in a file of its own; the sector will be asked when a
 * project is created (27 Sep 2026, not built yet).
 *
 * Rung ids are the step ids of `BUILT_IN_KINDS` in `lib/work-kind.ts`. A stored
 * milestone id is `${nodeId}:${stepId}`, which is what `stepIdOf` reads.
 */
import { normalizeName } from './work-kind';
import type { WbsItem } from './types';

export type Phase = 'engineering' | 'procurement' | 'construction' | 'commissioning';

export const PROCUREMENT_STEPS = ['po', 'fab', 'rts', 'onsite'];

const PHASES = new Set<string>(['engineering', 'procurement', 'construction', 'commissioning']);

/**
 * Words that make a HEADING one phase. A heading naming two phases
 * ("Engineering, Procurement and Construction") is the contract, not a phase,
 * and names none. "Mechanical" is deliberately not a construction word:
 * "Mechanical Completion & Commissioning" is the commissioning phase.
 */
const HEADING_WORDS: Record<Phase, string[]> = {
  engineering: ['engineering', 'design'],
  procurement: ['procurement', 'purchasing', 'supply'],
  construction: ['construction', 'installation', 'erection', 'instalasi'],
  commissioning: ['commissioning', 'mechanical completion', 'start up', 'startup', 'handover'],
};

/** What each rung is called when a ROW is named after it. */
const RUNG_WORDS: Record<string, string[]> = {
  po: ['po', 'purchase order'],
  fab: ['fabrication', 'fab', 'manufacturing', 'manufacture'],
  rts: ['rts', 'ready to ship'],
  onsite: ['shipment', 'shipping', 'delivery', 'on site', 'arrival', 'mos'],
  ifr: ['ifr'],
  ifa: ['ifa'],
  afc: ['afc', 'ifc'],
  material: ['material on site'],
  install: ['installation', 'install', 'erection'],
  connect: ['connection', 'connections', 'tie in'],
  qc: ['qc', 'inspection'],
  precomm: ['pre commissioning', 'precommissioning'],
  function: ['function test', 'energize', 'energise'],
  startup: ['start up', 'startup'],
  running: ['running test', 'performance test'],
};

/** Words that say nothing about WHAT is being bought or built. */
const FILLER = new Set(['and', 'to', 'of', 'the', 'for', 'site', 'dan', 'ke']);

function hasPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${phrase} `);
}

export function stepIdOf(milestoneId: string): string {
  const i = milestoneId.lastIndexOf(':');
  return i >= 0 ? milestoneId.slice(i + 1) : milestoneId;
}

export function phaseOfHeading(name: string): Phase | null {
  const n = normalizeName(name);
  const hits = (Object.keys(HEADING_WORDS) as Phase[]).filter((p) =>
    HEADING_WORDS[p].some((w) => hasPhrase(n, w))
  );
  return hits.length === 1 ? hits[0] : null;
}

/** The rungs, of those offered, that a row's name names. In ladder order. */
export function rungsNamedBy(name: string, stepIds: string[]): string[] {
  const n = normalizeName(name);
  return stepIds.filter((id) => (RUNG_WORDS[id] ?? []).some((w) => hasPhrase(n, w)));
}

/**
 * What a row is ABOUT once its rung words are taken out: "Shipment to Site
 * Material Solar" and "PO Material Solar" are both "material solar", which is
 * how the app knows they are one purchase split across rows.
 */
export function subjectOf(name: string, stepIds: string[]): string {
  const phrases = stepIds
    .flatMap((id) => RUNG_WORDS[id] ?? [])
    .map((p) => p.split(' '))
    .sort((a, b) => b.length - a.length);
  const words = normalizeName(name).split(' ');
  for (const p of phrases) {
    for (let i = 0; i + p.length <= words.length; ) {
      if (p.every((w, k) => words[i + k] === w)) words.splice(i, p.length);
      else i += 1;
    }
  }
  return words.filter((w) => w && !FILLER.has(w)).join(' ');
}

export interface ProfileRow {
  id: string;
  parentId: string | null;
  name: string;
  order: number;
  isLeaf: boolean;
  isReportingUnit: boolean;
  /** The nearest heading's phase, else the row's own kind. */
  phase: Phase | null;
  /** The nearest heading that names a phase, for the check against the kind. */
  headingPhase: Phase | null;
  headingName: string | null;
}

/**
 * The heading wins over the row's own kind. On PHSS Samberah the headings were
 * right and three kinds were wrong (Installation tagged Engineering,
 * Commissioning tagged Procurement), and the check in lib/forecast-checks.ts is
 * what tells the person so.
 */
export function profileRowsOf(items: WbsItem[]): ProfileRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parents = new Set(items.map((i) => i.parentId).filter((p): p is string => !!p));
  return items.map((item) => {
    let heading: { name: string; phase: Phase } | null = null;
    for (
      let p = item.parentId ? byId.get(item.parentId) : undefined;
      p && !heading;
      p = p.parentId ? byId.get(p.parentId) : undefined
    ) {
      const phase = phaseOfHeading(p.deskripsi);
      if (phase) heading = { name: p.deskripsi, phase };
    }
    const own = item.workKind && PHASES.has(item.workKind) ? (item.workKind as Phase) : null;
    return {
      id: item.id,
      parentId: item.parentId,
      name: item.deskripsi,
      order: item.order,
      isLeaf: !parents.has(item.id),
      isReportingUnit: item.isReportingUnit === true,
      phase: heading?.phase ?? own,
      headingPhase: heading?.phase ?? null,
      headingName: heading?.name ?? null,
    };
  });
}

/**
 * What each activity waits for, by EPC order, OFFERED for a person to confirm.
 * Never applied in silence: lib/forecast.ts only reads confirmed links.
 *
 * - construction waits for the procurement rows that bring material ON SITE
 * - commissioning waits for construction
 * - a procurement row holding later rungs waits for the sibling holding the
 *   nearest earlier rungs of the SAME subject (Shipment waits for Fab & RTS)
 *
 * All within one reporting unit when the row sits in one, else the project.
 */
export function suggestWaitsFor(rows: ProfileRow[]): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unitOf = (r: ProfileRow): string | null => {
    for (let p = r.parentId ? byId.get(r.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (p.isReportingUnit) return p.id;
    }
    return null;
  };
  const leaves = rows.filter((r) => r.isLeaf).sort((a, b) => a.order - b.order);
  const rungIndexes = (r: ProfileRow) =>
    rungsNamedBy(r.name, PROCUREMENT_STEPS).map((s) => PROCUREMENT_STEPS.indexOf(s));

  const out = new Map<string, string[]>();
  for (const b of leaves) {
    const scope = unitOf(b);
    const near = leaves.filter((a) => a.id !== b.id && unitOf(a) === scope);
    let preds: string[] = [];
    if (b.phase === 'construction') {
      preds = near
        .filter((a) => a.phase === 'procurement' && rungsNamedBy(a.name, PROCUREMENT_STEPS).includes('onsite'))
        .map((a) => a.id);
    } else if (b.phase === 'commissioning') {
      preds = near.filter((a) => a.phase === 'construction').map((a) => a.id);
    } else if (b.phase === 'procurement') {
      const mine = rungIndexes(b);
      if (mine.length) {
        const first = Math.min(...mine);
        const subject = subjectOf(b.name, PROCUREMENT_STEPS);
        let best: { id: string; last: number } | null = null;
        for (const a of near) {
          if (a.parentId !== b.parentId || a.phase !== 'procurement') continue;
          if (subjectOf(a.name, PROCUREMENT_STEPS) !== subject) continue;
          const theirs = rungIndexes(a);
          if (!theirs.length) continue;
          const last = Math.max(...theirs);
          if (last < first && (!best || last > best.last)) best = { id: a.id, last };
        }
        if (best) preds = [best.id];
      }
    }
    if (preds.length) out.set(b.id, preds);
  }
  return out;
}
