/**
 * What each bar looks like, and why.
 *
 * Colour could not go on meaning "package" AND be something a planner
 * configures — one of the two had to give, and what gave was the LAW. "Colour
 * says which package" is now the first default rule rather than a rule of the
 * code, so a planner who thinks lateness matters more than packages moves that
 * rule above it and the app has no opinion about which of them is right.
 *
 * **Ordered list, first match wins.** MS Project stacks bar styles and paints
 * several at once. This does not. A stacked result is impossible to predict from
 * the list, and the list is the interface: you look down it, you find the first
 * line that describes a row, and that is what you will see.
 *
 * Pure — no database, no React, so `scripts/verify-bar-styles.ts` runs the real
 * project through it.
 */
import type { BarCondition, BarPaint, BarShape } from './schema';
import type { SheetRow } from './sheet';

export type { BarCondition, BarPaint, BarShape };

export interface BarStyle {
  id: string;
  order: number;
  label: string;
  condition: BarCondition;
  conditionValue: string | null;
  paint: BarPaint;
  shape: BarShape;
  hatched: boolean;
  enabled: boolean;
}

/** What a bar actually gets drawn with, once the list has been walked. */
export interface ResolvedBar {
  /** The rule that matched, for the legend and for explaining a bar. */
  styleId: string;
  label: string;
  paint: BarPaint;
  shape: Exclude<BarShape, 'auto'>;
  hatched: boolean;
}

/**
 * The list a project has before anybody configures anything.
 *
 * Read as prose, top to bottom: a late bar is amber whatever else it is; a
 * milestone is a diamond; a summary is a bracket; a row nobody has scheduled is
 * grey and hollow; everything else is its package's colour. That is exactly the
 * behaviour this app had hard-coded, written down as rules so it can be argued
 * with.
 *
 * `past_target` sits at the top with `shape: 'auto'` on purpose — a late summary
 * is still a bracket, in amber. Shape and paint are separate axes, and only
 * paint is worth overriding for lateness.
 */
export const DEFAULT_BAR_STYLES: BarStyle[] = [
  {
    id: 'default:past-target',
    order: 0,
    label: 'Past its target date',
    condition: 'past_target',
    conditionValue: null,
    paint: 'warn',
    shape: 'auto',
    hatched: true,
    enabled: true,
  },
  {
    id: 'default:milestone',
    order: 1,
    label: 'Milestone',
    condition: 'milestone',
    conditionValue: null,
    paint: 'unit',
    shape: 'diamond',
    hatched: false,
    enabled: true,
  },
  {
    id: 'default:summary',
    order: 2,
    label: 'Summary',
    condition: 'summary',
    conditionValue: null,
    paint: 'unit',
    shape: 'bracket',
    hatched: false,
    enabled: true,
  },
  {
    id: 'default:unscheduled',
    order: 3,
    label: 'Not scheduled yet',
    condition: 'unscheduled',
    conditionValue: null,
    paint: 'muted',
    shape: 'auto',
    hatched: false,
    enabled: true,
  },
  {
    id: 'default:task',
    order: 4,
    label: 'Work',
    condition: 'always',
    conditionValue: null,
    paint: 'unit',
    shape: 'bar',
    hatched: false,
    enabled: true,
  },
];

/**
 * Every condition, with the sentence the editor shows and whether it takes a
 * value. `critical` is deliberately absent — it needs the chain engine, and a
 * rule that can never fire is worse than one that is missing, because it looks
 * like a rule that simply never matched.
 */
export const CONDITIONS: {
  key: BarCondition;
  label: string;
  help: string;
  takes?: 'unit' | 'percent';
}[] = [
  { key: 'always', label: 'Anything', help: 'Every row that got this far down the list' },
  { key: 'task', label: 'Work', help: 'A row with no rows under it' },
  { key: 'summary', label: 'Summary', help: 'A row that has rows under it' },
  { key: 'milestone', label: 'Milestone', help: 'A point in time rather than a span' },
  { key: 'in_unit', label: 'Inside a package', help: 'Everything under one SPK or lot', takes: 'unit' },
  { key: 'past_target', label: 'Past its target date', help: 'Finishes after the date it was promised for' },
  { key: 'in_progress', label: 'Running today', help: 'Today falls between its start and its finish' },
  { key: 'unscheduled', label: 'Not scheduled yet', help: 'No start or no finish' },
  { key: 'unpriced', label: 'Not priced yet', help: 'No money against it' },
  { key: 'weight_above', label: 'Weight above', help: 'Its share of the project is over this', takes: 'percent' },
  { key: 'weight_below', label: 'Weight below', help: 'Its share of the project is under this', takes: 'percent' },
];

export const PAINTS: { key: BarPaint; label: string }[] = [
  { key: 'unit', label: 'Package colour' },
  { key: 'warn', label: 'Amber' },
  { key: 'danger', label: 'Red' },
  { key: 'ok', label: 'Green' },
  { key: 'muted', label: 'Grey' },
  { key: 'plan-1', label: 'Indigo' },
  { key: 'plan-2', label: 'Teal' },
  { key: 'plan-3', label: 'Magenta' },
  { key: 'plan-4', label: 'Orange' },
  { key: 'plan-5', label: 'Blue' },
  { key: 'plan-6', label: 'Green' },
];

export const SHAPES: { key: BarShape; label: string }[] = [
  { key: 'auto', label: 'From the row' },
  { key: 'bar', label: 'Bar' },
  { key: 'bracket', label: 'Bracket' },
  { key: 'diamond', label: 'Diamond' },
];

/** The shape a row would get if no rule said otherwise. */
function naturalShape(row: SheetRow): Exclude<BarShape, 'auto'> {
  if (row.isMilestone) return 'diamond';
  if (row.isSummary) return 'bracket';
  return 'bar';
}

export function matches(style: BarStyle, row: SheetRow, today: string): boolean {
  switch (style.condition) {
    case 'always':
      return true;
    case 'task':
      return !row.isSummary && !row.isMilestone;
    case 'summary':
      return row.isSummary;
    case 'milestone':
      return row.isMilestone;
    case 'in_unit':
      return style.conditionValue != null && row.unitId === style.conditionValue;
    case 'past_target':
      return row.daysLate != null;
    case 'unscheduled':
      return !row.startDate || !row.finishDate;
    case 'in_progress':
      return (
        !!row.startDate && !!row.finishDate && row.startDate <= today && today <= row.finishDate
      );
    case 'unpriced':
      return row.price == null || row.price <= 0;
    case 'weight_above':
      return row.bobot != null && row.bobot > Number(style.conditionValue ?? 0);
    case 'weight_below':
      return row.bobot != null && row.bobot < Number(style.conditionValue ?? 0);
    case 'critical':
      // Nothing computes this yet; see the note on BarCondition.
      return false;
    default:
      return false;
  }
}

/**
 * Walk the list once per row and stop at the first line that fits.
 *
 * A row that reaches the bottom without matching gets the natural drawing rather
 * than disappearing — deleting the last rule should not make a plan invisible.
 */
export function resolveBar(row: SheetRow, styles: BarStyle[], today: string): ResolvedBar {
  for (const s of styles) {
    if (!s.enabled) continue;
    if (!matches(s, row, today)) continue;
    return {
      styleId: s.id,
      label: s.label,
      paint: s.paint,
      shape: s.shape === 'auto' ? naturalShape(row) : s.shape,
      hatched: s.hatched,
    };
  }
  return {
    styleId: 'fallback',
    label: 'Work',
    paint: 'unit',
    shape: naturalShape(row),
    hatched: false,
  };
}

/**
 * Which rules a plan actually uses, in list order, with a count each.
 *
 * The legend is built from this rather than from the whole list: a rule nobody's
 * plan matches would be a line in the key pointing at nothing on the chart.
 */
export function usedStyles(
  rows: SheetRow[],
  styles: BarStyle[],
  today: string
): { style: BarStyle; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const hit = resolveBar(r, styles, today);
    counts.set(hit.styleId, (counts.get(hit.styleId) ?? 0) + 1);
  }
  return styles
    .filter((s) => s.enabled && (counts.get(s.id) ?? 0) > 0)
    .map((s) => ({ style: s, count: counts.get(s.id)! }));
}
