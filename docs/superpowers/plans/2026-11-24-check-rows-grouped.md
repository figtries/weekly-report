# Check rows named by their mother — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every activity listed by a check on `/weekly/[week]/control` is shown under a heading naming the full branch it sits in, so the same WBS description under two parents can be told apart and no chain is silently cut.

**Architecture:** `trailIndex` in `lib/analysis.ts` stops truncating to the last two ancestors and stops dropping the root unconditionally; it indexes every node, not only leaves, so the two link checks can read it too. Two new pure helpers beside it, `elideTrail` and `groupFindingRows`, shape the list. `CheckRow` in `components/weekly/WeekChecks.tsx` renders groups instead of a flat list.

**Tech Stack:** TypeScript, Next.js server components, Tailwind. No test framework — proof is a `scripts/verify-*.ts` run under `node --import ./scripts/ts-resolve.mjs`, the repo's existing pattern.

**Spec:** `docs/superpowers/specs/2026-11-24-check-rows-grouped-design.md`

## Global Constraints

- The separator between ancestors is ` › ` (U+203A, space either side), as today.
- The elision mark is `…` (U+2026). Never `—`: no em dash in any visible string.
- No `uppercase` anywhere.
- Group headings are not pressable and carry no link.
- `/print/*` is untouched; this is a screen, not a report sheet.
- The grouping and elision helpers live in `lib/analysis.ts`, not in the
  component, so the verify script can import them. The spec left this to the
  builder and named the component as its default; testability decides it.

## Review Focus

1. A row whose `trail` is `undefined` (an id the rollup tree does not know, e.g. a link check pointing at a deleted node) must still be listed, not dropped. Covered in Task 2.
2. A chain with exactly 3 segments must print whole — the boundary where elision starts. Covered in Task 1.
3. An activity hanging directly off the root must name the project, not print blank. Covered in Task 1.
4. Two different headings with the same description must stay separate groups — grouping is on the full chain string, not on the last segment. Covered in Task 2.
5. The "Show N more" cap counts activities, not headings, so N stays the number of hidden activities. Covered in Task 3.

---

### Task 1: The trail is the whole chain

**Files:**
- Modify: `lib/analysis.ts:423-436` (`trailIndex`), and add `elideTrail` beside it
- Modify: `lib/analysis.ts:815`, `lib/analysis.ts:828` (the two link checks' `rows`)
- Test: `scripts/verify-check-rows.ts` (create)

**Interfaces:**
- Produces: `trailIndex(roots: RollupNode[]): Map<string, string>` — unchanged signature, new contents: an entry for EVERY node, holding its ancestors joined by ` › `, the root dropped only when the node has another ancestor.
- Produces: `export function elideTrail(trail: string): string` — 3 segments or fewer returned unchanged; more, and the middle collapses to `…`, keeping the first segment and the last two.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-check-rows.ts` following the shape of `scripts/verify-priority-actions.ts` (a `check(name, ok, detail)` helper counting failures, `process.exit(failed ? 1 : 0)` at the end, a header comment saying what it proves and the run command). Build one `RollupNode` tree by hand — no database:

```
P (root)
├─ D            leaf hanging off the root
└─ A
   └─ B
      └─ C
         └─ L  leaf four deep
```

Assertions:

```ts
const t = trailIndex([P]);
check('leaf off the root names the project', t.get('D') === 'P');
check('a branch is indexed too', t.get('A') === 'P');
check('the chain is whole, root dropped', t.get('L') === 'A › B › C');
check('three segments print whole', elideTrail('A › B › C') === 'A › B › C');
check('four segments elide the middle', elideTrail('A › B › C › D') === 'A › … › C › D');
check('one segment is untouched', elideTrail('P') === 'P');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-check-rows.ts`
Expected: FAIL — `elideTrail` is not exported, and `t.get('L')` is `'B › C'`.

- [ ] **Step 3: Rewrite `trailIndex` and add `elideTrail` in `lib/analysis.ts`**

`trailIndex`'s `visit` sets an entry for every node before recursing, instead of returning early on a branch. The stored value is `trail.slice(1)` joined, falling back to `trail` joined when `slice(1)` is empty — that fallback is the whole of rule 3 in the spec, so keep the comment explaining that the root is the only ancestor such a node has.

- [ ] **Step 4: Give the two link checks their trail**

In the `late` rows (`lib/analysis.ts:815`) and the `net.ignored` rows (`:828`), add `trail: trails.get(id)` / `trail: trails.get(l.toId)`. These two are the only row builders that never had one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-check-rows.ts`
Expected: every line PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/analysis.ts scripts/verify-check-rows.ts
git commit -m "Check: the trail is the whole branch, and the link checks have one"
```

---

### Task 2: Rows group under their mother

**Files:**
- Modify: `lib/analysis.ts` (add `groupFindingRows` beside `elideTrail`)
- Test: `scripts/verify-check-rows.ts` (extend)

**Interfaces:**
- Consumes: `FindingRow` (`lib/analysis.ts:364`), `elideTrail` from Task 1.
- Produces: `export interface FindingRowGroup { trail: string; rows: FindingRow[] }` and `export function groupFindingRows(rows: FindingRow[]): FindingRowGroup[]` — groups by the exact `trail` string; group order is the order each group's first member appears in `rows`; row order inside a group is the input order; rows with no `trail` collect into one group with `trail: ''` placed last.

- [ ] **Step 1: Write the failing test**

Append to `scripts/verify-check-rows.ts`:

```ts
const rows = [
  { label: 'Server', value: '', trail: 'R › Lucille' },
  { label: 'Payment Gateway', value: '', trail: 'R › Backend' },
  { label: 'Database', value: '', trail: 'R › Lucille' },
  { label: 'Orphan', value: '' },
];
const g = groupFindingRows(rows);
check('group order follows first appearance', g.map((x) => x.trail).join('|') === 'R › Lucille|R › Backend|');
check('no row is lost or duplicated', g.flatMap((x) => x.rows).length === 4);
check('row order inside a group is kept', g[0].rows.map((r) => r.label).join(',') === 'Server,Database');
check('a row with no trail is still listed', g[2].rows[0].label === 'Orphan');
```

Add a fifth assertion for Review Focus 4: two rows whose trails end in the same word (`'R › A › Work'` and `'R › B › Work'`) produce two groups, not one.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-check-rows.ts`
Expected: FAIL with `groupFindingRows is not a function`.

- [ ] **Step 3: Implement `groupFindingRows` in `lib/analysis.ts`**

A `Map<string, FindingRow[]>` keyed on `r.trail ?? ''` preserves insertion order for free; move the `''` group to the end if present.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-check-rows.ts`
Expected: every line PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/analysis.ts scripts/verify-check-rows.ts
git commit -m "Check: group a finding's rows by the branch they sit in"
```

---

### Task 3: The screen renders the groups

**Files:**
- Modify: `components/weekly/WeekChecks.tsx:31-114` (`CheckRow`)

**Interfaces:**
- Consumes: `groupFindingRows`, `elideTrail` from Tasks 1 and 2.

- [ ] **Step 1: Render groups in `CheckRow`**

Replace the flat `f.rows.map(...)` with `groupFindingRows(f.rows).map(...)`. Each group renders a heading line then its rows; the per-row trail line under the label is deleted, since the heading now carries it.

- The heading is `elideTrail(group.trail)`, `text-[12px] font-semibold text-foreground/70`, its own `px-3 py-2` line on the group's ground, no chevron, not a `<Link>`. A group with `trail === ''` renders no heading.
- Row markup is otherwise unchanged: the `min-h-11` `<Link>` to `/weekly/${week}/overall?item=`, the two-line clamp on the label, the value beside it, the chevron.
- `key` stays index-based within the group, for the reason the existing comment gives: the same description legitimately repeats.

- [ ] **Step 2: Keep the cap counting activities**

The `i >= 6 && 'hidden group-has-checked/more:block'` trick currently indexes rows directly. Compute a running activity index across groups while mapping, and hide an entry when that index is `>= 6`; a heading takes the index of its own first activity, so a heading whose activities are all hidden is hidden with them. `Show {f.rows.length - 6} more` is unchanged — it already counts activities.

- [ ] **Step 3: Verify it builds and lints**

Run: `npx next build > build.log 2>&1; echo $?` then read `build.log`.
Expected: exit 0. Never pipe this to `grep` — grep's exit code would be reported instead.

- [ ] **Step 4: Look at it**

Run `node scripts/shoot.mjs http://localhost:3000/weekly/9/control check-390.png 390 1400` and again at desktop width, then OPEN both images. Check: every listed activity sits under a heading naming its branch, the headings are legible rather than grey, a deep chain shows `…` in the middle, and the figure column is not pushed off at 390px.

- [ ] **Step 5: Commit**

```bash
git add components/weekly/WeekChecks.tsx
git commit -m "Check: a finding lists its activities under the branch they belong to"
```

---

## Self-review notes

- Spec coverage: full chain (Task 1), root kept when sole ancestor (Task 1), link checks given a trail (Task 1), grouping (Task 2), heading weight and non-pressability (Task 3), elision (Tasks 1 and 3), cap counts rows (Task 3). Nothing in the spec is unassigned.
- The spec's "left to the builder" items are both decided here: helpers go in `lib/analysis.ts` (Global Constraints), and the heading is a line on the group's own ground rather than a `divide-y` row (Task 3 Step 1).
