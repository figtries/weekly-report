/**
 * The EDL/VDRL builder's state, kept out of React so a script can prove it
 * (3 Oct 2026, docs/superpowers/specs/2026-10-03-edl-builder-and-transmittal-design.md).
 *
 * The builder replaced a numbering step, a template of empty sections three
 * levels deep and a page per section, all of which the user named as the
 * reason building an EDL was "pusing". Here a register is HEADINGS the person
 * chose (suggested from the template, or their own), each holding documents,
 * optionally split into sub-headings.
 *
 * A heading holds documents OR sub-headings, never both: the Data screen shows
 * only leaf categories as groups, so documents left on a heading that also has
 * sub-headings would vanish from it. The first sub-heading therefore TAKES the
 * heading's documents.
 */
import { nextNumber, type NumberingRule } from './register-numbering';
import type { PastePlan } from './register-paste';
import type { DraftGroup } from './register-seed';
import { templateFor } from './register-template';
import type { RegisterKind } from './schema';
import { tidyName } from './tidy-name';

export type Kind = 'Doc' | 'Dwg';

export interface BuilderRow {
  id: string;
  title: string;
  kind: Kind;
  docNo: string;
  /** False once the number is typed by hand (or came from a paste): it is not recomputed. */
  auto: boolean;
  /** ISO date or ''. Stored as the IFR stage's planned date. */
  planIfr: string;
  /** Rows copied from a source can be unticked; typed rows always count. */
  picked: boolean;
  fromSource: boolean;
}

export interface BuilderSub { id: string; name: string; rows: BuilderRow[] }

export interface BuilderHeading {
  id: string;
  name: string;
  /** Already in the register: shown, added to, never removed from here. */
  locked: boolean;
  /** Documents the register already holds under it. */
  existing: number;
  rows: BuilderRow[];
  subs: BuilderSub[];
}

export interface OutlineHeading {
  name: string;
  documents: { title: string; kind: Kind }[];
  subheadings: { name: string; documents: { title: string; kind: Kind }[] }[];
}

let seq = 0;
const uid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export const kindOf = (raw: string | null | undefined): Kind =>
  (raw ?? '').trim().toLowerCase().startsWith('dw') ? 'Dwg' : 'Doc';

/**
 * The headings an EPC EDL starts from. A template band whose sections are
 * disciplines with their own groups (DETAIL ENGINEERING) offers the sections;
 * a band whose sections are just parts of it (GENERAL: EXECUTION PLAN,
 * PROCEDURE) offers itself.
 */
export function headingSuggestions(register: RegisterKind): string[] {
  const out: string[] = [];
  for (const band of templateFor(register)) {
    if (band.sections.length === 0) continue;
    if (band.sections.every((s) => s.groups.length > 0)) out.push(...band.sections.map((s) => s.name));
    else out.push(band.name);
  }
  return out;
}

/** GENERAL offers its sections, a discipline its groups. Title case, as a typed sub-heading would be. */
export function subSuggestions(register: RegisterKind, heading: string): string[] {
  const key = heading.trim().toUpperCase();
  for (const band of templateFor(register)) {
    if (band.name.toUpperCase() === key) return band.sections.map((s) => tidyName(s.name));
    const section = band.sections.find((s) => s.name.toUpperCase() === key);
    if (section) return section.groups.map(tidyName);
  }
  return [];
}

export function newRow(title: string, kind: Kind = 'Doc', fromSource = false): BuilderRow {
  return { id: uid(), title, kind, docNo: '', auto: true, planIfr: '', picked: true, fromSource };
}

export function newHeading(name: string, locked = false, existing = 0): BuilderHeading {
  return { id: uid(), name: name.trim(), locked, existing, rows: [], subs: [] };
}

export function newSub(name: string, rows: BuilderRow[] = []): BuilderSub {
  return { id: uid(), name: name.trim(), rows };
}

/** One row per non-empty line: typing a title, or pasting a column of them. */
export function rowsFromText(text: string): BuilderRow[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => newRow(t));
}

export function addSub(h: BuilderHeading, name: string): BuilderHeading {
  const first = h.subs.length === 0;
  return { ...h, rows: first ? [] : h.rows, subs: [...h.subs, newSub(name, first ? h.rows : [])] };
}

export function fromOutline(outline: OutlineHeading[]): BuilderHeading[] {
  return outline.map((o) => ({
    ...newHeading(o.name),
    rows: o.documents.map((d) => newRow(d.title, d.kind, true)),
    subs: o.subheadings.map((s) => newSub(s.name, s.documents.map((d) => newRow(d.title, d.kind, true)))),
  }));
}

/**
 * Depth 1 is a heading; a deeper category that holds documents becomes a
 * sub-heading of its depth-1 ancestor, named by itself. An intermediate level
 * with none (A.2 PROCEDURE above A.2.1) is folded away: the builder has two
 * levels, and the leaf is the one people file under.
 */
export function fromPaste(plan: PastePlan): BuilderHeading[] {
  const out: BuilderHeading[] = [];
  let current: BuilderHeading | null = null;
  for (const c of plan.categories) {
    const rows = c.documents.map((d) => ({
      ...newRow(d.title, kindOf(d.kind), true),
      docNo: d.docNo ?? '',
      auto: !d.docNo,
    }));
    if (c.depth === 1 || !current) {
      current = { ...newHeading(c.name), rows };
      out.push(current);
    } else if (rows.length > 0) {
      current.subs.push(newSub(c.name, rows));
    }
  }
  // A pasted heading with documents of its own AND sub-headings: its own go
  // into a sub-heading named after it, so none of them disappears.
  return out.map((h) => (h.rows.length > 0 && h.subs.length > 0
    ? { ...h, rows: [], subs: [newSub(h.name, h.rows), ...h.subs] }
    : h));
}

const keep = (r: BuilderRow) => r.picked && r.title.trim() !== '';

/**
 * Numbers for every auto row, in screen order, continuing past every number
 * already spoken for (the register's own and the ones handed out above).
 */
export function renumber(hs: BuilderHeading[], rule: NumberingRule, taken: string[]): BuilderHeading[] {
  const used = [...taken];
  for (const h of hs) {
    for (const r of [...h.rows, ...h.subs.flatMap((s) => s.rows)]) {
      if (keep(r) && !r.auto && r.docNo.trim()) used.push(r.docNo.trim());
    }
  }
  const number = (heading: string, group: string | null) => (r: BuilderRow): BuilderRow => {
    if (!r.auto) return r;
    if (!keep(r)) return r.docNo ? { ...r, docNo: '' } : r;
    const docNo = nextNumber(rule, heading, group ?? r.title, r.kind, used);
    used.push(docNo);
    return { ...r, docNo };
  };
  return hs.map((h) => ({
    ...h,
    rows: h.rows.map(number(h.name, null)),
    subs: h.subs.map((s) => ({ ...s, rows: s.rows.map(number(h.name, s.name)) })),
  }));
}

const toDoc = (r: BuilderRow) => ({
  docNo: r.docNo.trim() || null,
  title: r.title.trim(),
  kind: r.kind,
  planIfr: r.planIfr || null,
});

export function toDraftGroups(hs: BuilderHeading[]): DraftGroup[] {
  const out: DraftGroup[] = [];
  for (const h of hs) {
    if (h.subs.length === 0) out.push({ path: [h.name], documents: h.rows.filter(keep).map(toDoc) });
    for (const s of h.subs) out.push({ path: [h.name, s.name], documents: s.rows.filter(keep).map(toDoc) });
  }
  return out;
}

export function countDocuments(hs: BuilderHeading[]): number {
  return hs.reduce(
    (n, h) => n + h.rows.filter(keep).length + h.subs.reduce((m, s) => m + s.rows.filter(keep).length, 0),
    0,
  );
}
