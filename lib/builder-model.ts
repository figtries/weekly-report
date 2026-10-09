/**
 * The EDL/VDRL builder's state, kept out of React so a script can prove it.
 *
 * 4 Oct 2026: ONE OUTLINE. The 3 Oct builder asked where to start, then showed
 * a row of suggested heading chips, a numbering line, and a separate card per
 * heading with a four-column table (title, kind, number, plan IFR) under each.
 * The user called it "lebih ribet dari Excel": an app that makes the job harder
 * than the sheet it replaces. What they asked for instead is what is here:
 * type the main headings; to put a sub-heading (or a sub-sub-heading) inside
 * one, press the heading it belongs to. The register is a tree, so the screen
 * is one.
 *
 * Two rules are correctness, not taste.
 *
 * A heading holds documents OR headings, never both: the Data screen lists
 * only LEAF categories as groups, so documents left on a heading that also has
 * sub-headings would vanish from it. The first sub-heading added to a heading
 * holding new documents therefore TAKES them, and a heading the register
 * already fills with documents cannot take sub-headings here at all.
 *
 * Unchanged stays the same object: the page draws one memoised row per node,
 * and every edit copies only the path from the root to what changed.
 */
import { knownDiscipline, nextNumber, type NumberingRule } from './register-numbering';
import type { PastePlan } from './register-paste';
import type { DraftGroup } from './register-seed';

export type Kind = 'Doc' | 'Dwg';

/** Main heading, sub-heading, sub-sub-heading. A typed outline stops here. */
export const MAX_DEPTH = 3;

export interface BuilderDoc {
  id: string;
  title: string;
  kind: Kind;
  docNo: string;
  /** False once the number came from a paste: it is not recomputed. */
  auto: boolean;
  /** The first stage's plan date (ISO), '' until somebody gives one. */
  planIfr?: string;
}

export interface BuilderNode {
  id: string;
  name: string;
  /** Already in the register: shown and added to, never renamed or removed here. */
  locked: boolean;
  /** Documents the register already holds under it. */
  existing: number;
  docs: BuilderDoc[];
  children: BuilderNode[];
}

/** A register's outline as it is read from the database or copied from another project. */
export interface OutlineNode {
  name: string;
  documents: { title: string; kind: Kind }[];
  children: OutlineNode[];
}

/** What a saved register already holds, for the builder to add into. */
export interface ExistingNode {
  name: string;
  documents: number;
  children: ExistingNode[];
}

let seq = 0;
const uid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export const kindOf = (raw: string | null | undefined): Kind =>
  (raw ?? '').trim().toLowerCase().startsWith('dw') ? 'Dwg' : 'Doc';

/**
 * A typed title's kind, guessed so nobody has to pick it: what is drawn is a
 * drawing. One press on the row's chip corrects a wrong guess.
 */
const DRAWN = /\b(drawings?|dwg|layouts?|diagrams?|p&id|plot plan|isometrics?|general arrangement|elevations?|sections?|gambar|denah|sketch)\b/i;
export const guessKind = (title: string): Kind => (DRAWN.test(title) ? 'Dwg' : 'Doc');

export function newNode(name: string, locked = false, existing = 0): BuilderNode {
  return { id: uid(), name: name.trim(), locked, existing, docs: [], children: [] };
}

export function newDoc(title: string, kind: Kind = guessKind(title)): BuilderDoc {
  return { id: uid(), title: title.trim(), kind, docNo: '', auto: true };
}

/** One entry per non-empty line: typing one name, or pasting a column of them. */
export function linesOf(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/\t+/g, ' ').trim()).filter(Boolean);
}

export function fromExisting(nodes: ExistingNode[]): BuilderNode[] {
  return nodes.map((n) => ({ ...newNode(n.name, true, n.documents), children: fromExisting(n.children) }));
}

export function fromOutline(nodes: OutlineNode[]): BuilderNode[] {
  return nodes.map((n) => settle({
    ...newNode(n.name),
    docs: n.documents.map((d) => newDoc(d.title, d.kind)),
    children: fromOutline(n.children),
  }));
}

/** A node with documents AND headings: its own documents go into a first heading named after it. */
function settle(n: BuilderNode): BuilderNode {
  return n.docs.length > 0 && n.children.length > 0
    ? { ...n, docs: [], children: [{ ...newNode(n.name), docs: n.docs }, ...n.children] }
    : n;
}

/**
 * A pasted sheet, kept at the depth it was written in. A jump (A, then
 * A.2.1 with no A.2) hangs off the deepest heading above it.
 */
export function fromPaste(plan: PastePlan): BuilderNode[] {
  const roots: BuilderNode[] = [];
  const stack: BuilderNode[] = [];
  for (const c of plan.categories) {
    const node: BuilderNode = {
      ...newNode(c.name),
      docs: c.documents.map((d) => ({
        ...newDoc(d.title, d.kind ? kindOf(d.kind) : guessKind(d.title)),
        docNo: d.docNo ?? '',
        auto: !d.docNo,
      })),
    };
    const depth = Math.max(1, Math.min(c.depth, stack.length + 1));
    stack.length = depth - 1;
    if (depth === 1) roots.push(node);
    else stack[depth - 2].children.push(node);
    stack.push(node);
  }
  const fix = (ns: BuilderNode[]): BuilderNode[] => ns.map((n) => settle({ ...n, children: fix(n.children) }));
  return fix(roots);
}

/* ------------------------------------------------------------- reading */

export function findNode(tree: BuilderNode[], id: string): { node: BuilderNode; depth: number } | null {
  const walk = (ns: BuilderNode[], depth: number): { node: BuilderNode; depth: number } | null => {
    for (const n of ns) {
      if (n.id === id) return { node: n, depth };
      const hit = walk(n.children, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, 1);
}

/** The node and every heading above it, main heading first; empty when it is not there. */
export function pathTo(tree: BuilderNode[], id: string): BuilderNode[] {
  for (const n of tree) {
    if (n.id === id) return [n];
    const below = pathTo(n.children, id);
    if (below.length) return [n, ...below];
  }
  return [];
}

/** Every node in screen order with its depth, for a list that draws one row each. */
export function flatten(tree: BuilderNode[], depth = 1): { node: BuilderNode; depth: number }[] {
  return tree.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/**
 * What may go inside a node. Headings while it is above the third level and
 * the register has not already filled it with documents; documents while it
 * has no headings under it.
 */
export function canHold(node: BuilderNode, depth: number): { headings: boolean; documents: boolean } {
  const filledLeaf = node.locked && node.existing > 0 && node.children.length === 0;
  return {
    headings: depth < MAX_DEPTH && !filledLeaf,
    documents: node.children.length === 0,
  };
}

/* ------------------------------------------------------------- editing */

/** Copies the path to `id` and applies `fn` there; every other branch stays the same object. */
export function updateNode(tree: BuilderNode[], id: string, fn: (n: BuilderNode) => BuilderNode | null): BuilderNode[] {
  let changed = false;
  const out: BuilderNode[] = [];
  for (const n of tree) {
    if (n.id === id) {
      const next = fn(n);
      if (next !== n) changed = true;
      if (next) out.push(next);
      continue;
    }
    const children = updateNode(n.children, id, fn);
    if (children !== n.children) { changed = true; out.push({ ...n, children }); } else out.push(n);
  }
  return changed ? out : tree;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Names already present among the siblings are skipped, not doubled. */
export function addHeadings(tree: BuilderNode[], parentId: string | null, names: string[]): BuilderNode[] {
  const fresh = (siblings: BuilderNode[]) => {
    const out: BuilderNode[] = [];
    for (const name of names) {
      if ([...siblings, ...out].some((s) => sameName(s.name, name))) continue;
      out.push(newNode(name));
    }
    return out;
  };
  if (parentId === null) {
    const added = fresh(tree);
    return added.length ? [...tree, ...added] : tree;
  }
  return updateNode(tree, parentId, (p) => {
    const added = fresh(p.children);
    if (!added.length) return p;
    // The first heading under a node holding new documents takes them.
    if (p.children.length === 0 && p.docs.length > 0) {
      added[0] = { ...added[0], docs: p.docs };
      return { ...p, docs: [], children: added };
    }
    return { ...p, children: [...p.children, ...added] };
  });
}

export function addDocs(tree: BuilderNode[], parentId: string, titles: string[]): BuilderNode[] {
  if (!titles.length) return tree;
  return updateNode(tree, parentId, (p) => ({ ...p, docs: [...p.docs, ...titles.map((t) => newDoc(t))] }));
}

export function removeNode(tree: BuilderNode[], id: string): BuilderNode[] {
  return updateNode(tree, id, (n) => (n.locked ? n : null));
}

export function renameNode(tree: BuilderNode[], id: string, name: string): BuilderNode[] {
  return updateNode(tree, id, (n) => (n.locked ? n : { ...n, name }));
}

export function updateDoc(tree: BuilderNode[], nodeId: string, docId: string, patch: Partial<BuilderDoc> | null): BuilderNode[] {
  return updateNode(tree, nodeId, (n) => ({
    ...n,
    docs: patch === null
      ? n.docs.filter((d) => d.id !== docId)
      : n.docs.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
  }));
}

/** Whether a new node holds anything typed, so removing it asks first. */
export function holdsTyped(n: BuilderNode): boolean {
  return n.docs.some((d) => d.title.trim()) || n.children.some(holdsTyped);
}

/* -------------------------------------------------------------- saving */

const keep = (d: BuilderDoc) => d.title.trim() !== '';

/**
 * Numbers for every auto document, in screen order, continuing past every
 * number already spoken for. The discipline is the first heading on the path
 * that names one (PROCESS under DETAIL ENGINEERING), else the main heading;
 * the type comes from the heading the document sits in, or from its own title
 * when it sits straight under a main heading.
 */
export function renumber(tree: BuilderNode[], rule: NumberingRule, taken: string[]): BuilderNode[] {
  const used = [...taken];
  const collect = (ns: BuilderNode[]) => ns.forEach((n) => {
    for (const d of n.docs) if (keep(d) && !d.auto && d.docNo.trim()) used.push(d.docNo.trim());
    collect(n.children);
  });
  collect(tree);

  const walk = (ns: BuilderNode[], path: string[]): BuilderNode[] => {
    const out = ns.map((n) => {
      const here = [...path, n.name];
      const section = here.find((name) => knownDiscipline(name, rule)) ?? here[0];
      const docs = n.docs.map((d) => {
        if (!d.auto) return d;
        // No prefix, no format (the VDRL): an auto document gets no number.
        if (!keep(d) || !rule.prefix.trim()) return d.docNo ? { ...d, docNo: '' } : d;
        const docNo = nextNumber(rule, section, here.length > 1 ? n.name : d.title, d.kind, used);
        used.push(docNo);
        return docNo === d.docNo ? d : { ...d, docNo };
      });
      const children = walk(n.children, here);
      return same(docs, n.docs) && children === n.children ? n : { ...n, docs, children };
    });
    return same(out, ns) ? ns : out;
  };
  return walk(tree, []);
}

const same = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * One group per new leaf (written even when empty: a heading made on purpose
 * is structure, see `writeDraft`) and per node with new documents. A locked
 * branch with nothing new under it writes nothing.
 */
export function toDraftGroups(tree: BuilderNode[]): DraftGroup[] {
  const out: DraftGroup[] = [];
  const walk = (ns: BuilderNode[], path: string[]) => {
    for (const n of ns) {
      const here = [...path, n.name.trim()];
      const docs = n.docs.filter(keep).map((d) => ({
        docNo: d.docNo.trim() || null, title: d.title.trim(), kind: d.kind, planIfr: d.planIfr || null,
      }));
      if (docs.length > 0 || (!n.locked && n.children.length === 0)) out.push({ path: here, documents: docs });
      walk(n.children, here);
    }
  };
  walk(tree, []);
  return out;
}

export function countDocuments(tree: BuilderNode[]): number {
  return tree.reduce((sum, n) => sum + n.docs.filter(keep).length + countDocuments(n.children), 0);
}

export function countNewHeadings(tree: BuilderNode[]): number {
  return tree.reduce((sum, n) => sum + (n.locked ? 0 : 1) + countNewHeadings(n.children), 0);
}

/** Every heading name, main ones first, for the numbering dialog's discipline list. */
export function headingNames(tree: BuilderNode[]): string[] {
  return tree.map((n) => n.name);
}
