/**
 * A project's bar styles, straight off the database.
 *
 * Split from `lib/bar-styles.ts` so the engine stays pure and testable without
 * one. Synchronous, like every read in this app — see `lib/sqlite.ts`.
 *
 * **A project with no rows here is not unstyled.** It gets `DEFAULT_BAR_STYLES`,
 * so nothing has to be seeded for a new project to read correctly and no read
 * has to write. Rows only appear the first time someone edits the list, and that
 * write copies the defaults in first — which is also what makes "Reset to
 * defaults" a delete rather than a re-seed.
 */
import { asc, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { DEFAULT_BAR_STYLES, type BarStyle } from './bar-styles';

export function getBarStyles(projectId: string): { styles: BarStyle[]; customised: boolean } {
  const rows = db
    .select()
    .from(schema.barStyles)
    .where(eq(schema.barStyles.projectId, projectId))
    .orderBy(asc(schema.barStyles.order))
    .all();

  if (rows.length === 0) return { styles: DEFAULT_BAR_STYLES, customised: false };

  return {
    styles: rows.map((r) => ({
      id: r.id,
      order: r.order,
      label: r.label,
      condition: r.condition,
      conditionValue: r.conditionValue,
      paint: r.paint,
      shape: r.shape,
      hatched: r.hatched,
      enabled: r.enabled,
    })),
    customised: true,
  };
}
