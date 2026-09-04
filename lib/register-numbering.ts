/**
 * How a document number is built, so nobody has to invent one.
 *
 * This is not a convention we made up. Both real EDLs in this repo number the
 * same way, and each pattern points at exactly one group — 50 patterns across
 * Petrogas' register, 29 across Gundih's:
 *
 *     PROJECT - DISCIPLINE - TYPE - SEQUENCE
 *     WPP     - PC         - DSY  - 001        Process Study/report
 *     WPP     - CV         - DCC  - 001        Civil Calculation
 *     WPP     - EL         - GEL  - 001        Electrical Drawing
 *
 * The TYPE code carries the one piece of logic that makes the whole thing
 * predictable: its first letter is the KIND. `D` for a document, `G` for a
 * drawing — `DDS` is a datasheet document, `GKP` a drawing. So once someone has
 * picked the group and said whether it is a Doc or a Dwg, the number is already
 * decided except for the sequence, and the sequence is just what comes next in
 * that group.
 *
 * The rule is set once and can be edited afterwards: disciplined, not rigid.
 * Every generated number can also be overwritten on the row, because a register
 * inherited halfway through a project always carries a few that predate the
 * rule, and refusing them would mean refusing the register as it is.
 */

export interface NumberingRule {
  /** `WPP`, `PRGG` — the project's own short code. */
  prefix: string;
  /** Section name → discipline code. `ELECTRICAL` → `EL`. */
  disciplines: Record<string, string>;
  /** Group name → two-letter type code, WITHOUT the kind letter. `Datasheet` → `DS`. */
  types: Record<string, string>;
  /** How many digits the running number gets. Both real registers use three. */
  digits: number;
}

/** `Doc` → `D`, `Dwg` → `G` (gambar). The first letter of every type code. */
export function kindLetter(kind: string): string {
  return kind.trim().toLowerCase().startsWith('dw') ? 'G' : 'D';
}

/**
 * Defaults read off the two registers, not invented.
 *
 * Sections and groups that are not listed still work — the fallback builds a
 * code from the name itself — so a discipline someone adds is numbered too.
 */
const DISCIPLINE_DEFAULTS: Record<string, string> = {
  GENERAL: 'GN',
  'EXECUTION PLAN': 'GN',
  PROCEDURE: 'GN',
  'QA/QC': 'QA',
  COMMISSIONING: 'COM',
  PROCESS: 'PC',
  CIVIL: 'CV',
  MECHANICAL: 'ME',
  PIPING: 'PG',
  ELECTRICAL: 'EL',
  'ELECTRICAL & INSTRUMENT': 'EL',
  INSTRUMENT: 'IN',
  HSE: 'HS',
};

const TYPE_DEFAULTS: Array<[RegExp, string]> = [
  [/bill of material|boq|material/i, 'MT'],
  [/datasheet|data sheet/i, 'DS'],
  [/calculation|study/i, 'CC'],
  [/philosophy/i, 'PH'],
  [/specification|spesifikasi/i, 'SP'],
  [/procedure|prosedur/i, 'GS'],
  [/schedule/i, 'SC'],
  [/list|register/i, 'LS'],
  [/instrumentation diagram|p&id/i, 'PI'],
  [/flow diagram/i, 'PF'],
  [/drawing|layout/i, 'DW'],
  [/report|plan/i, 'RE'],
  [/qa\/qc|quality/i, 'QA'],
];

/** Two or three letters from a name, for anything the tables above miss. */
function codeFromName(name: string, length: number): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= length) return words.slice(0, length).map((w) => w[0]).join('');
  const joined = words.join('');
  return (joined + joined).slice(0, length) || 'XX';
}

export function disciplineFor(section: string, rule?: NumberingRule): string {
  const set = rule?.disciplines ?? {};
  const direct = set[section];
  if (direct) return direct;
  const upper = section.toUpperCase();
  for (const [name, code] of Object.entries(DISCIPLINE_DEFAULTS)) {
    if (upper === name || upper.includes(name)) return code;
  }
  return codeFromName(section, 2);
}

export function typeFor(group: string, rule?: NumberingRule): string {
  const direct = rule?.types?.[group];
  if (direct) return direct;
  for (const [pattern, code] of TYPE_DEFAULTS) if (pattern.test(group)) return code;
  return codeFromName(group, 2);
}

/**
 * The next number for a group, given what is already in it.
 *
 * The sequence continues the highest one ALREADY carrying this same prefix, so
 * a register that inherited a few oddly numbered documents does not restart at
 * 001 and collide with them.
 */
export function nextNumber(
  rule: NumberingRule,
  section: string,
  group: string,
  kind: string,
  taken: string[],
): string {
  const head = [
    rule.prefix.trim().toUpperCase(),
    disciplineFor(section, rule),
    `${kindLetter(kind)}${typeFor(group, rule)}`,
  ].filter(Boolean).join('-');

  let highest = 0;
  for (const no of taken) {
    if (!no.toUpperCase().startsWith(`${head}-`)) continue;
    const tail = Number(no.slice(head.length + 1).replace(/\D/g, ''));
    if (Number.isFinite(tail) && tail > highest) highest = tail;
  }

  return `${head}-${String(highest + 1).padStart(rule.digits, '0')}`;
}

/**
 * The project's own prefix, read off numbers that already exist.
 *
 * A register being started from nothing has none, and then the person is asked
 * — but they are asked once, with a guess already in the box.
 */
export function detectPrefix(numbers: string[]): string | null {
  const counts = new Map<string, number>();
  for (const no of numbers) {
    const head = no.split('-')[0]?.trim().toUpperCase();
    if (head && head.length <= 6) counts.set(head, (counts.get(head) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [head, count] of counts) if (count > bestCount) { best = head; bestCount = count; }
  return best;
}

export function defaultRule(prefix: string): NumberingRule {
  return { prefix, disciplines: {}, types: {}, digits: 3 };
}
