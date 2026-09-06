/**
 * A project's bar styles, straight off the database.
 *
 * Split from `lib/bar-styles.ts` so the engine stays pure and testable without
 * one. Synchronous, like every read in this app — see `lib/sqlite.ts`.
 *
 * Three places a plan's colours can come from, in this order:
 *
 * **Its own rules**, when someone has edited the list. Those always win.
 *
 * **A preset it was given**, when someone picked one. `type` or `package`.
 *
 * **A preset chosen from the plan itself**, when nobody has said anything —
 * packages if the plan has packages, types if it does not. This is the part
 * that makes it move on its own: mark a second SPK and the plan changes over,
 * because at that moment it started being true.
 *
 * No read ever writes. A preset is a list held in code until an edit copies it
 * into the table, which is also what makes "back to standard" a plain delete.
 */
import { asc, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { PRESETS, pickPreset, pruneStyles, type BarPreset, type BarStyle } from './bar-styles';
import type { SheetRow } from './sheet';

export interface BarStyleSet {
  styles: BarStyle[];
  /** Which of the three it came from — the editor shows this. */
  source: 'custom' | BarPreset;
  /** True when nobody chose and the plan itself decided. */
  auto: boolean;
  /** Rules dropped because they could not tell this plan's rows apart. */
  pruned: string[];
}

export function getBarStyles(projectId: string, rows: SheetRow[] = []): BarStyleSet {
  const today = new Date().toISOString().slice(0, 10);

  const own = db
    .select()
    .from(schema.barStyles)
    .where(eq(schema.barStyles.projectId, projectId))
    .orderBy(asc(schema.barStyles.order))
    .all();

  if (own.length > 0) {
    const styles = own.map((r) => ({
      id: r.id,
      order: r.order,
      label: r.label,
      condition: r.condition,
      conditionValue: r.conditionValue,
      paint: r.paint,
      shape: r.shape,
      hatched: r.hatched,
      enabled: r.enabled,
    }));
    // A list somebody wrote by hand is left exactly as they wrote it. Pruning
    // is a courtesy for the defaults, not a licence to silently ignore a rule
    // a person put there on purpose.
    return { styles, source: 'custom', auto: false, pruned: [] };
  }

  const project = db
    .select({ barPreset: schema.projects.barPreset })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];

  const chosen = project?.barPreset ?? null;
  const key: BarPreset = chosen ?? pickPreset(rows);
  const preset = PRESETS.find((p) => p.key === key) ?? PRESETS[0];

  const kept = pruneStyles(rows, preset.styles, today);
  const pruned = preset.styles.filter((s) => !kept.includes(s)).map((s) => s.label);

  return { styles: kept, source: key, auto: chosen === null, pruned };
}
