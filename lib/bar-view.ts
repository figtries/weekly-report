/**
 * What a bar on the planner looks like, and why.
 *
 * Replaces the ordered rule list of lib/bar-styles.ts (7 Oct 2026). That list
 * asked a planner to design a legend: When / Colour / Shape, first match wins.
 * Now a planner picks what colour SAYS (the kind of work, the package, or
 * nothing) and which of four marks to show, and never writes a rule. Everything
 * else a bar shows comes from the plan itself: its stages, how much is done,
 * where the forecast puts its finish.
 *
 * Pure: no database, no React.
 */
import type { BarPaint } from './schema';

export type ColourBy = 'kind' | 'package' | 'label' | 'one';
export type MarkKey = 'done' | 'forecast' | 'contract' | 'slip' | 'links';

/** A colour the user named themselves: it means whatever they decide. */
export interface BarLabel {
  id: string;
  name: string;
  paint: BarPaint;
}

export interface BarView {
  colourBy: ColourBy;
  marks: Record<MarkKey, boolean>;
  colours: { kind: Record<string, BarPaint>; package: Record<string, BarPaint>; one: BarPaint };
  /** The user's own labels, in the order they made them. */
  labels: BarLabel[];
}

/**
 * The planner's own tokens, and only those. Red is the forecast's and amber
 * the target date's: a red bar would hide its own red hatch, so neither is a
 * colour a bar can be given.
 */
export const PALETTE: { key: BarPaint; label: string }[] = [
  { key: 'plan-1', label: 'Indigo' },
  { key: 'plan-2', label: 'Teal' },
  { key: 'plan-3', label: 'Fuchsia' },
  { key: 'plan-4', label: 'Orange' },
  { key: 'plan-5', label: 'Sky' },
  { key: 'plan-6', label: 'Lime' },
  { key: 'foreground', label: 'Black' },
  { key: 'muted', label: 'Grey' },
];
const ALLOWED = new Set<BarPaint>(PALETTE.map((p) => p.key));

/** `none` is a row nobody has given a kind yet. */
export const KIND_KEYS = ['engineering', 'procurement', 'construction', 'commissioning', 'none'] as const;

/**
 * The kinds' names, here rather than read off lib/work-kind.ts, so the
 * planner's first load does not carry every kind's ladder and hints just to
 * print five words. The kind picker, which needs the ladders, loads lazily.
 */
export const KIND_LABEL: Record<string, string> = {
  engineering: 'Engineering',
  procurement: 'Procurement',
  construction: 'Construction',
  commissioning: 'Commissioning',
  none: 'No kind set',
};
export const DEFAULT_KIND_PAINT: Record<string, BarPaint> = {
  engineering: 'plan-1',
  procurement: 'plan-3',
  construction: 'plan-2',
  commissioning: 'plan-5',
  none: 'muted',
};

/**
 * A new project starts on ONE colour: what colour should mean is the user's
 * call, and the Bars menu explains the choices (7 Oct 2026, he said
 * 'biarin mereka pilih sendiri').
 */
export const DEFAULT_BAR_VIEW: BarView = {
  colourBy: 'one',
  marks: { done: true, forecast: true, contract: true, slip: false, links: true },
  colours: { kind: {}, package: {}, one: 'plan-5' },
  labels: [],
};

const MAX_LABELS = 24;

function labelsOf(v: unknown): BarLabel[] {
  if (!Array.isArray(v)) return [];
  const out: BarLabel[] = [];
  for (const l of v) {
    if (!l || typeof l !== 'object') continue;
    const { id, name, paint } = l as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof name !== 'string') continue;
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, name: name.trim().slice(0, 40) || 'Label', paint: ALLOWED.has(paint as BarPaint) ? (paint as BarPaint) : 'muted' });
    if (out.length >= MAX_LABELS) break;
  }
  return out;
}

function paints(v: unknown): Record<string, BarPaint> {
  const out: Record<string, BarPaint> = {};
  if (v && typeof v === 'object') {
    for (const [k, p] of Object.entries(v)) if (ALLOWED.has(p as BarPaint)) out[k] = p as BarPaint;
  }
  return out;
}

/** Whatever is stored, read as a whole view: a missing or broken field is its default. */
export function parseBarView(json: string | null): BarView {
  let raw: {
    colourBy?: unknown;
    marks?: Record<string, unknown>;
    colours?: { kind?: unknown; package?: unknown; one?: unknown };
    labels?: unknown;
  } = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const d = DEFAULT_BAR_VIEW;
  const marks = { ...d.marks };
  for (const k of Object.keys(marks) as MarkKey[]) {
    const m = raw.marks?.[k];
    if (typeof m === 'boolean') marks[k] = m;
  }
  const by = raw.colourBy;
  const one = raw.colours?.one as BarPaint;
  return {
    colourBy: by === 'package' || by === 'one' || by === 'kind' || by === 'label' ? by : d.colourBy,
    marks,
    colours: {
      kind: paints(raw.colours?.kind),
      package: paints(raw.colours?.package),
      one: ALLOWED.has(one) ? one : d.colours.one,
    },
    labels: labelsOf(raw.labels),
  };
}

/** A package's colour when nobody picked one: its colour group, in the planner's fixed order. */
export function packagePaint(colorGroup: number): BarPaint {
  return colorGroup >= 0 && colorGroup < 6 ? (`plan-${colorGroup + 1}` as BarPaint) : 'muted';
}

/**
 * Whether the plan has work packages to colour by. The option is never hidden
 * when it has none (every project gets the same menu); the menu says so.
 */
export function hasPackages(rows: { colorGroup: number }[]): boolean {
  return rows.some((r) => r.colorGroup >= 0);
}

/**
 * Each row's label: its own, or the nearest heading's above it. A label on a
 * heading paints the rows under it that have none of their own.
 */
export function labelsByRow(rows: { id: string; parentId: string | null; barLabel: string | null }[]): Map<string, string | null> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string | null>();
  const resolve = (id: string): string | null => {
    if (out.has(id)) return out.get(id)!;
    const r = byId.get(id);
    const v = !r ? null : r.barLabel ?? (r.parentId ? resolve(r.parentId) : null);
    out.set(id, v);
    return v;
  };
  for (const r of rows) resolve(r.id);
  return out;
}

/**
 * Which package colour a row reads. The unit's id where the plan marks units,
 * so a colour survives another unit being marked above it; the group's place
 * where packages are only the plan's top branches.
 */
export function packageKey(row: { colorGroup: number; unitId: string | null }): string {
  return row.unitId ?? `g${row.colorGroup}`;
}

export function paintOf(
  row: { colorGroup: number; unitId: string | null },
  kindId: string | null,
  view: BarView,
  colourBy: ColourBy,
  labelId: string | null = null
): BarPaint {
  if (colourBy === 'one') return view.colours.one;
  if (colourBy === 'label') return view.labels.find((l) => l.id === labelId)?.paint ?? 'muted';
  if (colourBy === 'package') return view.colours.package[packageKey(row)] ?? packagePaint(row.colorGroup);
  const k = kindId ?? 'none';
  return view.colours.kind[k] ?? DEFAULT_KIND_PAINT[k] ?? 'muted';
}

export function paintCss(p: BarPaint): string {
  if (p === 'foreground') return 'var(--foreground)';
  if (p === 'muted') return 'var(--muted-foreground)';
  return `var(--${p})`;
}

export interface Rung {
  label: string;
  weight: number;
  done: boolean;
}

/** A piece of a bar, as fractions of its length. */
export interface Segment {
  label: string;
  from: number;
  to: number;
  done: boolean;
}

/**
 * A bar cut into its stages, each as wide as its weight, so the solid length
 * IS the done percentage. A row with no stages (a quantity, a typed percent)
 * is one solid part up to its percent and one tint part after it.
 */
export function segmentsOf(rungs: Rung[], donePct: number): Segment[] {
  if (rungs.length > 0) {
    const total = rungs.reduce((a, r) => a + r.weight, 0) || 1;
    let at = 0;
    return rungs.map((r) => {
      const from = at;
      at += r.weight / total;
      return { label: r.label, from, to: at, done: r.done };
    });
  }
  const f = Math.max(0, Math.min(100, donePct)) / 100;
  if (f <= 0) return [{ label: '', from: 0, to: 1, done: false }];
  if (f >= 1) return [{ label: '', from: 0, to: 1, done: true }];
  return [
    { label: '', from: 0, to: f, done: true },
    { label: '', from: f, to: 1, done: false },
  ];
}
