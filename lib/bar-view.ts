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

export type ColourBy = 'kind' | 'package' | 'one';
export type MarkKey = 'done' | 'forecast' | 'contract' | 'slip';

export interface BarView {
  colourBy: ColourBy;
  marks: Record<MarkKey, boolean>;
  colours: { kind: Record<string, BarPaint>; package: Record<string, BarPaint>; one: BarPaint };
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
  none: 'Kind not set',
};
export const DEFAULT_KIND_PAINT: Record<string, BarPaint> = {
  engineering: 'plan-1',
  procurement: 'plan-3',
  construction: 'plan-2',
  commissioning: 'plan-5',
  none: 'muted',
};

export const DEFAULT_BAR_VIEW: BarView = {
  colourBy: 'kind',
  marks: { done: true, forecast: true, contract: true, slip: false },
  colours: { kind: {}, package: {}, one: 'plan-5' },
};

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
    colourBy: by === 'package' || by === 'one' || by === 'kind' ? by : d.colourBy,
    marks,
    colours: {
      kind: paints(raw.colours?.kind),
      package: paints(raw.colours?.package),
      one: ALLOWED.has(one) ? one : d.colours.one,
    },
  };
}

/** A package's colour when nobody picked one: its colour group, in the planner's fixed order. */
export function packagePaint(colorGroup: number): BarPaint {
  return colorGroup >= 0 && colorGroup < 6 ? (`plan-${colorGroup + 1}` as BarPaint) : 'muted';
}

/** Two packages or more: a colour that cannot tell rows apart says nothing. */
export function canColourByPackage(rows: { colorGroup: number }[]): boolean {
  return new Set(rows.map((r) => r.colorGroup).filter((g) => g >= 0)).size >= 2;
}

/** "By package" on a plan with one package falls back to kind rather than painting it all one colour. */
export function effectiveColourBy(view: BarView, rows: { colorGroup: number }[]): ColourBy {
  return view.colourBy === 'package' && !canColourByPackage(rows) ? 'kind' : view.colourBy;
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
  colourBy: ColourBy
): BarPaint {
  if (colourBy === 'one') return view.colours.one;
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
