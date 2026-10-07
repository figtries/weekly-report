/**
 * The FIELD a project is in, and what that field brings with it (7 Oct 2026).
 *
 * The app is for the whole energy industry, not EPC alone. A project says which
 * field it is in, and the kinds of work its rows can be come from that field
 * rather than from code that assumes EPC. EPC is the only field today; the next
 * one is added here, with its own kinds, and nothing else has to change for the
 * bars and the Bars menu to follow it.
 *
 * Pure: no database, no React.
 */
export interface FieldDef {
  id: string;
  label: string;
  /** One plain line for the picker. */
  help: string;
  /** Kind of work ids, in the order they are shown (lib/work-kind.ts). */
  kinds: string[];
}

export const FIELDS: FieldDef[] = [
  {
    id: 'epc',
    label: 'EPC',
    help: 'Engineering, procurement, construction and commissioning.',
    kinds: ['engineering', 'procurement', 'construction', 'commissioning'],
  },
];

/** A stored field, or EPC for a project made before fields existed. */
export function fieldOf(id: string | null | undefined): FieldDef {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[0];
}
