# Planner Langkah 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a project a short alias asked at creation, and cut the schedule sheet from nine columns to the four people actually plan with.

**Architecture:** One pure module (`lib/alias.ts`) derives a short label from a project name; one nullable column (`projects.alias`) stores it, reaching the deployment through a new idempotent `ensureSchema()` at snapshot-restore time rather than through a migration nobody runs on Vercel. The sheet's column removal is confined to `ScheduleSheet.tsx`'s two grid-template constants, its header row and its row component, kept in lockstep because a hidden grid child leaves the grid and shifts every column left.

**Tech Stack:** Next.js (App Router, `cacheComponents: true`), React 19, Drizzle ORM over synchronous `better-sqlite3`, Tailwind v4, framer-motion, `shadcn/radix-nova`. Node v25.7.0 runs `.ts` files directly, which is how this repo's `scripts/verify-*.ts` tests run.

**Spec:** `docs/superpowers/specs/2026-09-12-planner-jadwal-dulu-design.md`

## Global Constraints

- **The app reads in English.** Screens, labels, buttons, error messages. Data (WBS names, catalog rows) stays as typed. `/print/*` is the client's own deliverable and is NOT touched by this plan.
- **No em dash (`—`) in any visible string.** The user calls it the "AI strip". Use a comma, a colon, or two sentences. This applies to UI copy only, not to source comments.
- **Tap targets at least 44px**, expressed as `min-h-11` rather than `h-11` where content can grow.
- **Entry-on-load animation is CSS keyframes** (`.animate-enter`, `.animate-fade-in-up`), never framer-motion, because `motion.div` writes `opacity: 0` into the server HTML and the element stays invisible until hydration. State-triggered motion is framer-motion. Numbers live in `MOTION` in `lib/design.ts`.
- **Inside any `.map()` that can exceed ~20 rows, use native `<input>` / `<select>`**, never Radix. `ScheduleSheet` renders up to 285 rows.
- **Never run `next build` into `.next`.** The user almost always has `npm run dev` on port 3000, and building into the same dist dir swaps chunks underneath it. Always `NEXT_DIST_DIR=.next-verify npx next build`.
- **Never verify a build through a pipe.** `next build | grep` reports grep's exit code. Write to a file, then `echo $?`.
- **`next build` and `next dev` auto-append the current `NEXT_DIST_DIR`'s types to `tsconfig.json`'s `include`.** Check `git diff tsconfig.json` and revert that churn before every commit.
- **Never pass `/dev/null` as a path ARGUMENT to a Node program.** Git Bash on Windows turns it into a real file named `nul` at the project root, which breaks every Turbopack compile permanently and survives `rm -rf .next`. Shell redirection (`> /dev/null`) is safe.
- **Copy `data/report.db` before `drizzle-kit migrate`, and count child rows after.** A drizzle migration that recreates a table deletes its children.
- **Type-check through a scratchpad tsconfig**, not the project one: `npx tsc --noEmit` on the project config pulls in `.next*/types` from every parallel session and reports phantom missing modules.
- **Pre-existing eslint errors in `components/daily/DailyForm.tsx` and `components/ui/ConfirmDialog.tsx` (`react-hooks/set-state-in-effect`) are NOT regressions.** Leave them.
- **A UI change is verified by looking at a screenshot**, via `node scripts/shoot.mjs <url> <out.png> [w] [h]`. Extracted text shows content, never composition.

---

### Task 1: `lib/alias.ts`, the derivation

**Files:**
- Create: `lib/alias.ts`
- Test: `scripts/verify-alias.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveAlias(name: string): string` and `ALIAS_MAX_LENGTH: number`. Tasks 4 and 5 both import `deriveAlias`; Task 5 also uses `ALIAS_MAX_LENGTH` for the input's `maxLength`.

This module must stay free of every other import. That is what lets `node scripts/verify-alias.ts` run it with no loader, and what lets a client component import it without dragging server code into the browser bundle.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-alias.ts`:

```ts
/**
 * Checks the project alias derivation against the names it was designed for.
 *
 * The first case is the real one: the user's own workbook,
 * "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah".
 * He chose initials over the alternatives with that exact output in front of
 * him, so the expected value below is a decision, not a guess.
 *
 * Run: node scripts/verify-alias.ts
 */
import { deriveAlias, ALIAS_MAX_LENGTH } from '../lib/alias.ts';

const CASES: Array<[name: string, expected: string]> = [
  ['Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah', 'JPICSPUCS'],
  ['Relocation of 2 GTG units', 'RGU'],
  ['CPP Gundih', 'CG'],
  // Punctuation is stripped before the first letter is taken, so a bracket
  // never becomes the alias.
  ['(Phase 2) Retrofit C-4500', 'PRC'],
  // Nothing to derive from is not an error. The field is optional, and an
  // empty alias means the UI falls back to the full name.
  ['', ''],
  ['   ', ''],
  // Stopwords go, in both languages this app is typed in.
  ['Perbaikan dan Penggantian Pipa', 'PPP'],
  // Runs of whitespace are one separator, not several empty tokens.
  ['Alpha    Bravo', 'AB'],
];

let failed = 0;
for (const [name, expected] of CASES) {
  const got = deriveAlias(name);
  if (got === expected) continue;
  failed += 1;
  console.error(`✗ ${JSON.stringify(name)}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(got)}`);
}

// The cap is a separate property from the mapping: fourteen significant words
// must not produce a fourteen-character "short" label.
const long = deriveAlias('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November');
if (long.length !== ALIAS_MAX_LENGTH) {
  failed += 1;
  console.error(`✗ cap: expected ${ALIAS_MAX_LENGTH} characters, got ${long.length} (${long})`);
}
if (long !== 'ABCDEFGHIJKL') {
  failed += 1;
  console.error(`✗ cap: expected ABCDEFGHIJKL, got ${long}`);
}

if (failed) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log(`✓ ${CASES.length} names derive as decided, and the ${ALIAS_MAX_LENGTH}-character cap holds.`);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/verify-alias.ts
```

Expected: FAIL, `Cannot find module` for `../lib/alias.ts`. That is the correct first failure: the module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/alias.ts`:

```ts
/**
 * A short name for a project, derived from its long one.
 *
 * EPC project names are sentences. The user's own is seventy characters:
 * "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah".
 * A project list, a sidebar and a page title all need a handle for that, and
 * asking for one without offering an answer is how an optional field ends up
 * empty on every project.
 *
 * So the app guesses, and the guess is INITIALS. Two other rules were put in
 * front of the user with their real outputs shown (distinctive tokens, which
 * would have given "PHSS C-4500"; and the first three words, "Jasa Pengadaan
 * Instrument") and he chose initials knowing it produces "JPICSPUCS". It is a
 * guess he can overwrite in the same breath, which is the only reason a guess
 * this blunt is safe: the field is pre-filled, not decided.
 *
 * Pure, and deliberately importing nothing. That is what lets
 * `node scripts/verify-alias.ts` run it with no loader, and what lets
 * `NewProjectDialog` import it on the client without pulling server code in.
 */

/**
 * Words that carry no identity. Both languages this app is typed in, because
 * the project names are Indonesian and the app around them is English.
 */
const STOPWORDS = new Set([
  'dan', 'di', 'ke', 'untuk', 'pada', 'atau',
  'and', 'of', 'the', 'for', 'in', 'on', 'at', 'to',
]);

/** Past this it stops being a short label and starts being a second name. */
export const ALIAS_MAX_LENGTH = 12;

export function deriveAlias(name: string): string {
  return name
    .split(/\s+/)
    // Punctuation first, so "(Phase" contributes P rather than an open
    // bracket and "C-4500" contributes C.
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter((token) => token !== '')
    .filter((token) => !STOPWORDS.has(token.toLowerCase()))
    // A token that is only digits is a COUNT, not an identity: the "2" in
    // "Relocation of 2 GTG units" says nothing about which project this is.
    .filter((token) => !/^\d+$/.test(token))
    .map((token) => token[0]!.toUpperCase())
    .join('')
    .slice(0, ALIAS_MAX_LENGTH);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/verify-alias.ts
```

Expected: `✓ 8 names derive as decided, and the 12-character cap holds.`

- [ ] **Step 5: Commit**

```bash
git add lib/alias.ts scripts/verify-alias.ts
git commit -m "A project name is a sentence, and a list needs a handle for it"
```

---

### Task 2: The `alias` column

**Files:**
- Modify: `lib/schema.ts` (the `projects` table, after `name`)
- Create: `data/migrations/0011_*.sql` (generated, then read before it is run)
- Create: `scripts/db-table-counts.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `projects.alias` as `text('alias')`, nullable, readable as `string | null` off every `getProject` / `listProjects` row. Tasks 3, 4 and 6 all depend on it existing.

The danger here is not the column, it is the migration STYLE. SQLite cannot add a column to an existing unique index, so when a change needs that, `drizzle-kit generate` falls back to build-new-table / copy / `DROP TABLE` / rename wrapped in `PRAGMA foreign_keys=OFF`. That pragma is a no-op inside a transaction and drizzle runs migrations in one, so the DROP cascades and takes the children with it. It has already cost 357 `doc_stages` rows in this repo.

A plain nullable column on an existing table does not need that path, and `data/migrations/0010_solid_shriek.sql` proves it: one line, `ALTER TABLE projects ADD bar_preset text;`. Step 4 below is where you confirm this migration looks the same. If it does not, STOP and report.

- [ ] **Step 1: Write the counting tool and record the baseline**

Create `scripts/db-table-counts.ts`:

```ts
/**
 * Row counts for every table, so a migration can be proved not to have eaten
 * anything.
 *
 * A drizzle migration that recreates a table DROPs the old one, and
 * `PRAGMA foreign_keys=OFF` is a no-op inside the transaction drizzle wraps
 * migrations in, so the DROP cascades. In August 2026 that silently took all
 * 357 `doc_stages` rows when `documents` gained a column. The defence is
 * arithmetic: count before, count after, compare.
 *
 * Run: node scripts/db-table-counts.ts [path-to-db]
 */
import Database from 'better-sqlite3';

const path = process.argv[2] ?? 'data/report.db';
const db = new Database(path, { readonly: true });

const tables = db
  .prepare(
    `select name from sqlite_master
      where type = 'table'
        and name not like 'sqlite_%'
        and name not like '__drizzle%'
      order by name`
  )
  .all() as Array<{ name: string }>;

for (const { name } of tables) {
  const { n } = db.prepare(`select count(*) as n from "${name}"`).get() as { n: number };
  console.log(`${name}=${n}`);
}
db.close();
```

Run it and keep the output. This is the baseline the migration is checked against:

```bash
node scripts/db-table-counts.ts > /tmp/counts-before.txt; cat /tmp/counts-before.txt
```

Note: `> /tmp/...` is shell REDIRECTION and is safe. What is forbidden is passing `/dev/null` as an argument to a Node program.

- [ ] **Step 2: Back up the database**

```bash
cp data/report.db data/report.db.before-0011
```

This matches the existing habit visible in `data/`: `report.db.before-0006`, `before-0008`, `before-0009`, `before-0010`.

- [ ] **Step 3: Add the column to the schema**

In `lib/schema.ts`, inside `export const projects = sqliteTable('projects', {`, immediately after the `name` line:

```ts
  /**
   * A short handle for the project, for every place the full name does not fit.
   *
   * Asked when the project is created and pre-filled by `deriveAlias` in
   * `lib/alias.ts`, so it is rarely null on anything made after 12 Sep 2026.
   * Null on everything made before: deriving an alias for a project already
   * running is the owner's decision, not a migration's side effect.
   */
  alias: text('alias'),
```

- [ ] **Step 4: Generate the migration and READ IT before running it**

```bash
npm run db:generate
```

Then read what it produced:

```bash
ls data/migrations/ | tail -2 && cat data/migrations/0011_*.sql
```

Expected, and this is a gate: exactly one statement, of the shape

```sql
ALTER TABLE `projects` ADD `alias` text;
```

If instead you see `CREATE TABLE __new_projects`, `INSERT INTO __new_projects`, `DROP TABLE`, or `PRAGMA foreign_keys=OFF`, do NOT run it. Stop and report that the column took the table-recreate path.

- [ ] **Step 5: Migrate, then prove nothing was lost**

```bash
npm run db:migrate && node scripts/db-table-counts.ts > /tmp/counts-after.txt; diff /tmp/counts-before.txt /tmp/counts-after.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL`. Every table holds exactly what it held before. A non-empty diff means the migration cascaded and `data/report.db.before-0011` is the file to restore from.

- [ ] **Step 6: Prove the column is actually there**

```bash
node -e "const D=require('better-sqlite3');const d=new D('data/report.db',{readonly:true});console.log(d.prepare('pragma table_info(projects)').all().map(c=>c.name).join(' '))"
```

Expected: the printed list ends with, or contains, `alias`.

- [ ] **Step 7: Commit**

```bash
git add lib/schema.ts data/migrations scripts/db-table-counts.ts
git commit -m "Projects get a short name of their own, and the row counts prove the migration took the safe path"
```

Note: `data/report.db` and the `.before-*` backups are checked for git tracking by the repo's own `.gitignore`. Do not force-add a database file the repo ignores; if `git status` shows `data/report.db` as modified and tracked, commit it in this same commit so the schema and the file agree.

---

### Task 3: `ensureSchema()`, so the column survives the deployment

**Files:**
- Modify: `lib/db-snapshot.ts`
- Test: `scripts/verify-ensure-schema.ts`

**Interfaces:**
- Consumes: `projects.alias` from Task 2.
- Produces: `export function ensureSchema(dbPath: string): string[]`, returning the list of `"table.column"` strings it had to add (empty when the file was already current). Called internally after every snapshot lands. No later task imports it; the verify script does.

**Why this exists.** A deployment does not run migrations. `instrumentation.ts` calls `restoreDbSnapshot()`, which downloads the blob over the database file before the first query. That blob currently holds a database with no `alias` column, and it WINS at cold start, overwriting the freshly deployed file. So the first query naming `alias` dies with `no such column: alias`, on the deployment and nowhere else. This is the same class of failure as the two already recorded in AGENTS.md: it cannot be reproduced locally, because with no blob store attached the whole snapshot module is inert.

**Why it opens its own connection.** `lib/db-snapshot.ts` is careful not to import the connection it is restoring, which is the whole reason `instrumentation.ts` can run it before route modules load. `ensureSchema` keeps that promise: it opens its own `better-sqlite3` handle, alters, and closes.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-ensure-schema.ts`:

```ts
/**
 * Proves the deployment's schema repair works, on a throwaway copy.
 *
 * A deployment restores its schema from the blob snapshot, not from a
 * migration, so a snapshot written before a column existed silently un-adds
 * that column at every cold start. `ensureSchema` is what puts it back. This
 * script manufactures exactly that state: take the real database, DROP the
 * column, and check the repair restores it without touching the rows.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
 */
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';

import { ensureSchema } from '../lib/db-snapshot.ts';

const DIR = 'data/_tmp-ensure-schema';
const COPY = `${DIR}/report.db`;

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
copyFileSync('data/report.db', COPY);

const columns = (): string[] => {
  const db = new Database(COPY, { readonly: true });
  const names = (db.prepare('pragma table_info(projects)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  db.close();
  return names;
};
const projectCount = (): number => {
  const db = new Database(COPY, { readonly: true });
  const { n } = db.prepare('select count(*) as n from projects').get() as { n: number };
  db.close();
  return n;
};

let failed = 0;
const before = projectCount();

// An already-current file must be left completely alone, and must say so.
const noop = ensureSchema(COPY);
if (noop.length !== 0) {
  failed += 1;
  console.error(`✗ a current database should need no repair, got ${JSON.stringify(noop)}`);
}

// Now manufacture the deployment's state.
{
  const db = new Database(COPY);
  db.prepare('alter table projects drop column alias').run();
  db.close();
}
if (columns().includes('alias')) {
  failed += 1;
  console.error('✗ setup failed: the column was not actually dropped');
}

const added = ensureSchema(COPY);
if (!added.includes('projects.alias')) {
  failed += 1;
  console.error(`✗ expected projects.alias to be reported as added, got ${JSON.stringify(added)}`);
}
if (!columns().includes('alias')) {
  failed += 1;
  console.error('✗ the column is still missing after the repair');
}
if (projectCount() !== before) {
  failed += 1;
  console.error(`✗ the repair changed the row count: ${before} → ${projectCount()}`);
}

// And it must be safe to run twice, because it runs on every cold start and
// on every mid-life snapshot refresh.
if (ensureSchema(COPY).length !== 0) {
  failed += 1;
  console.error('✗ the repair is not idempotent');
}

rmSync(DIR, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('✓ a snapshot missing the column gets it back, rows intact, and running twice is a no-op.');
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
```

Expected: FAIL. `ensureSchema` is not exported from `lib/db-snapshot.ts` yet, so this is an import or `is not a function` error.

The `--import ./scripts/ts-resolve.mjs` loader is needed here and was not needed in Task 1: `lib/db-snapshot.ts` imports `./db-path` with no extension, which node's ESM resolver rejects on its own. `lib/alias.ts` imports nothing, which is why `node scripts/verify-alias.ts` works bare.

- [ ] **Step 3: Write the implementation**

In `lib/db-snapshot.ts`, add near the top, after the existing imports:

```ts
/**
 * Columns this code needs that a stored snapshot may predate.
 *
 * A DEPLOYMENT DOES NOT RUN MIGRATIONS. `instrumentation.ts` pulls the blob
 * over the database file before the first query, so the snapshot's schema is
 * the deployed schema and the freshly built file is overwritten. A column
 * added by a migration therefore reaches Vercel only if something puts it
 * back after the download, and this list is that something.
 *
 * Append one line per column added from here on. Keep it to columns: a new
 * TABLE is a different question, with a different answer, and adding one to
 * this list would not create its indexes or its foreign keys.
 */
const EXPECTED_COLUMNS: Array<{ table: string; column: string; decl: string }> = [
  { table: 'projects', column: 'alias', decl: 'text' },
];

/**
 * Bring a database file up to the columns this build needs.
 *
 * Idempotent, additive, and it never drops or rewrites anything: the worst it
 * can do to a file that is already current is read one `pragma` per table.
 * Returns what it had to add, so the caller can say so in a log rather than
 * repairing in silence.
 *
 * It opens its OWN connection rather than importing `db` from `./sqlite`,
 * because this module must not import the connection it is restoring. That is
 * what lets `instrumentation.ts` run it before any route module loads.
 */
export function ensureSchema(dbPath: string): string[] {
  const added: string[] = [];
  // Required lazily: this module is imported by `instrumentation.ts` before
  // the app's own connection exists, and a top-level import of the driver
  // here would open one.
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const db = new Database(dbPath);
  try {
    for (const { table, column, decl } of EXPECTED_COLUMNS) {
      const cols = db.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>;
      // A table this build does not have yet is not this function's problem.
      if (cols.length === 0) continue;
      if (cols.some((c) => c.name === column)) continue;
      db.prepare(`alter table "${table}" add column "${column}" ${decl}`).run();
      added.push(`${table}.${column}`);
    }
  } finally {
    db.close();
  }
  return added;
}
```

If `require` is not available in this module's context (it is ESM), use a top-of-file `import Database from 'better-sqlite3';` instead and delete the lazy `require` line plus its comment. `lib/sqlite.ts` already imports the driver this way, so the dependency is present either way. Check which form the file's other imports use and match it.

Then call it from both places a foreign file lands. Find `restoreDbSnapshot` and `refreshDbSnapshot` in this file, and immediately after each one has written the downloaded bytes over `DB_PATH` and before it returns success, add:

```ts
    const repaired = ensureSchema(DB_PATH);
    if (repaired.length) {
      console.log(`[db-snapshot] schema repaired after restore: ${repaired.join(', ')}`);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
```

Expected: `✓ a snapshot missing the column gets it back, rows intact, and running twice is a no-op.`

- [ ] **Step 5: Confirm no throwaway directory survived**

```bash
git status --short data/
```

Expected: no `data/_tmp-ensure-schema` entry. The script removes it on success; if a failing run left one behind, delete it before committing.

- [ ] **Step 6: Commit**

```bash
git add lib/db-snapshot.ts scripts/verify-ensure-schema.ts
git commit -m "A new column reaches the deployment through the snapshot, and the snapshot did not have it"
```

---

### Task 4: Creating a project with an alias

**Files:**
- Modify: `lib/project-actions.ts:99-170` (`createProjectAction`)
- Modify: `lib/projects.ts:47-64` (`ProjectCard`) and the query that builds it

**Interfaces:**
- Consumes: `deriveAlias` from Task 1, `projects.alias` from Task 2.
- Produces: `createProjectAction` accepts `alias?: string | null` on its input object. `ProjectCard` gains `alias: string | null`. Tasks 5 and 6 depend on both.

**Where the derivation runs.** In the ACTION, not in the dialog. The dialog shows the guess as a live placeholder so the user can see it before deciding, but a project created by any other path (a script, a future importer) must still get an alias. One authority, and it is the writer.

- [ ] **Step 1: Add `alias` to the action's input and write it**

In `lib/project-actions.ts`, add to `createProjectAction`'s input type, after `clientName`:

```ts
  /**
   * A short handle for this project. Blank is normal: `deriveAlias` fills it
   * from the name, and the dialog shows that guess as its placeholder so
   * nobody is surprised by what lands.
   */
  alias?: string | null;
```

Import the deriver at the top of the file:

```ts
import { deriveAlias } from './alias';
```

Inside the `try`, after the existing `const name = input.name.trim();` and its emptiness check:

```ts
    // Typed wins; otherwise the guess. Empty after both means a name with no
    // letters in it at all, and null is the honest answer for that.
    const alias = (input.alias?.trim() || deriveAlias(name)) || null;
```

Then in the `tx.insert(schema.projects).values({ ... })` object, after `clientName`:

```ts
          alias,
          // The document number prefix starts as the alias because they want
          // the same thing: a short, stable handle for this project. It is
          // separately editable on the project page afterwards, and nothing
          // here ever overwrites a prefix that already exists.
          docNoPrefix: alias,
```

- [ ] **Step 2: Carry `alias` on the card**

In `lib/projects.ts`, add to `export interface ProjectCard`, after `name`:

```ts
  /** Short handle. Null on projects made before 12 Sep 2026. */
  alias: string | null;
```

Then find where `ProjectCard` objects are built and add the field. Locate it with:

```bash
grep -n "clientName:" lib/projects.ts
```

Every object literal that assigns `clientName` from a database row and is typed as `ProjectCard` needs `alias: row.alias,` alongside it. If the mapping is a spread of the whole row, no change is needed there; the type addition is enough.

- [ ] **Step 3: Type-check**

Create the scratchpad tsconfig once (reused by every later task):

```bash
cat > tsconfig.verify.json <<'JSON'
{
  "extends": "./tsconfig.json",
  "include": ["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx", "lib/**/*.ts", "types/**/*.ts", "next-env.d.ts"]
}
JSON
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
```

Expected: `exit=0`. A non-zero exit naming `alias` means a `ProjectCard` literal was missed in Step 2.

`tsconfig.verify.json` and `tsc.log` are working files. Do not commit them; add them to `.gitignore` if `git status` shows them as untracked, or delete them after each check.

- [ ] **Step 4: Prove a created project gets an alias**

```bash
node --import ./scripts/ts-resolve.mjs -e "
const D=require('better-sqlite3');const d=new D('data/report.db',{readonly:true});
console.log(d.prepare('select name, alias, doc_no_prefix from projects order by rowid desc limit 5').all());
"
```

Expected right now: the existing rows, all with `alias: null`. That is correct; nothing has been created through the new path yet. This is the before-picture for Task 5's Step 4.

- [ ] **Step 5: Commit**

```bash
git add lib/project-actions.ts lib/projects.ts
git commit -m "The writer decides the alias, so a project made by any path has one"
```

---

### Task 5: The alias field in the New project dialog

**Files:**
- Modify: `components/projects/NewProjectDialog.tsx`

**Interfaces:**
- Consumes: `deriveAlias` and `ALIAS_MAX_LENGTH` from Task 1, `createProjectAction`'s `alias` input from Task 4.
- Produces: nothing later tasks import.

The dialog is already six fields on one screen with one Save, deliberately not a wizard. This adds a seventh and must not change that shape: no new step, no new screen, and it must never block the Create button.

- [ ] **Step 1: Add the state**

In `components/projects/NewProjectDialog.tsx`, add the import:

```ts
import { ALIAS_MAX_LENGTH, deriveAlias } from '@/lib/alias';
```

Add state beside the existing `name` and `client`:

```ts
  const [alias, setAlias] = useState('');
```

Add to `reset()`, beside `setClient('')`:

```ts
    setAlias('');
```

- [ ] **Step 2: Add the field**

Directly after the closing `</div>` of the existing Project name block (the one containing `id="np-name"`), insert:

```tsx
                    {/* The guess is shown as the PLACEHOLDER, not written into
                        the input. Pre-filling the value would mean anyone who
                        edits the name afterwards keeps an alias derived from
                        the name they abandoned, and they would have no way to
                        tell. As a placeholder it follows the name until the
                        moment somebody types over it, and after that it never
                        interferes again. */}
                    <div className="space-y-1">
                      <Label htmlFor="np-alias">Short name</Label>
                      <Input
                        id="np-alias"
                        value={alias}
                        onChange={(e) => setAlias(e.target.value)}
                        placeholder={deriveAlias(name) || 'For lists and titles'}
                        maxLength={ALIAS_MAX_LENGTH}
                        className="h-11"
                      />
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Used wherever the full name will not fit. Leave it and we
                        will use the short name shown above.
                      </p>
                    </div>
```

Do NOT add `alias` to the `ready` check. `ready` gates the Create button and this field is optional.

- [ ] **Step 3: Send it**

In `create()`, add to the `createProjectAction({ ... })` argument object, after `clientName`:

```ts
        alias,
```

- [ ] **Step 4: Look at it, and create a real project**

Start a preview on its own dist dir so the user's dev server on `.next` is untouched. Use `preview_start` with the `dev-preview` configuration from `.claude/launch.json`. Then, with `<PORT>` as the port it reports:

```bash
node scripts/shoot.mjs http://localhost:<PORT>/projects docs/_shots/dialog-desktop.png 1280 900
node scripts/shoot.mjs http://localhost:<PORT>/projects docs/_shots/dialog-390.png 390 844
```

The dialog only exists once "New project" is clicked, so these two shots show the list. To see the dialog itself, drive it: read the page, click the `New project` button, type into `#np-name`, then screenshot. Check with your own eyes that:

- the Short name field sits under Project name and above Client,
- typing the long name makes the placeholder read `JPICSPUCS`,
- at 390px nothing overflows and the field is at least 44px tall.

Then create a project through the real dialog, named `Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah`, leaving Short name EMPTY, and confirm what landed:

```bash
node -e "
const D=require('better-sqlite3');const d=new D('data/report.db',{readonly:true});
console.log(d.prepare('select name, alias, doc_no_prefix from projects order by rowid desc limit 1').all());
"
```

Expected: `alias: 'JPICSPUCS'` and `doc_no_prefix: 'JPICSPUCS'`.

- [ ] **Step 5: Commit**

```bash
git add components/projects/NewProjectDialog.tsx
git commit -m "The short name is asked once, beside the long one, and answers itself if you skip it"
```

---

### Task 6: Where the alias is shown

**Files:**
- Modify: `components/projects/ProjectList.tsx`
- Modify: `app/projects/[id]/page.tsx` (the `<h1>` block, around line 120)
- Modify: `components/layout/LiveProjectSwitcher.tsx`

**Interfaces:**
- Consumes: `ProjectCard.alias` from Task 4.
- Produces: nothing later tasks import.

One treatment, three places, so the alias reads as the same fact everywhere: a small uppercase badge in front of the name. It NEVER replaces the name. An alias is a handle for finding something you already know about, and a list that shows only `JPICSPUCS` is a list nobody can read.

- [ ] **Step 1: The project list**

Find the element rendering the project name:

```bash
grep -n "p.name\|project.name" components/projects/ProjectList.tsx
```

Immediately before that name element, inside the same flex row, insert:

```tsx
                {p.alias && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide tabular-nums text-muted-foreground">
                    {p.alias}
                  </span>
                )}
```

If the name's parent is not already a flex row with `items-center` and a gap, wrap the badge and the name in `<span className="flex min-w-0 items-center gap-1.5">` rather than changing the existing element's classes.

- [ ] **Step 2: The project page heading**

In `app/projects/[id]/page.tsx`, replace the `<h1>` element with a row that carries the badge beside it:

```tsx
              <div className="flex min-w-0 items-center gap-2">
                {project.alias && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {project.alias}
                  </span>
                )}
                <h1 className="min-w-0 truncate text-base font-semibold leading-tight tracking-tight sm:text-lg">
                  {project.name}
                </h1>
              </div>
```

- [ ] **Step 3: The sidebar**

In `components/layout/LiveProjectSwitcher.tsx`, find where the name is rendered and prefer the alias THERE, because the sidebar is the one place in the app that is genuinely too narrow for a sentence:

```bash
grep -n "name" components/layout/LiveProjectSwitcher.tsx
```

Replace the rendered name expression with `{project.alias || project.name}`, keeping every existing class and the existing `title` attribute. If there is no `title` attribute, add `title={project.name}` so the full name is still reachable. Do not add a tooltip component: information that only appears on hover is against this app's rules, and a native `title` is a supplement here rather than the only route to the name, which is on the project's own page.

- [ ] **Step 4: Look at all three**

```bash
node scripts/shoot.mjs http://localhost:<PORT>/projects docs/_shots/list-desktop.png 1280 900
node scripts/shoot.mjs http://localhost:<PORT>/projects docs/_shots/list-390.png 390 844
```

Look at the images. The badge must not push the client name or the date row out of line, and at 390px it must not squeeze the name into truncation on a project whose name previously fit.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
```

Expected: `exit=0`.

```bash
git add components/projects/ProjectList.tsx "app/projects/[id]/page.tsx" components/layout/LiveProjectSwitcher.tsx
git commit -m "The short name earns its keep in the three places the long one does not fit"
```

---

### Task 7: Nine columns become four

**Files:**
- Modify: `components/projects/ScheduleSheet.tsx` (constants at `:73-117`, header at `:955-985`, row component at `:1287-1440`)
- Test: `scripts/verify-sheet-columns.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks import.

**The trap, stated once more because it is the whole difficulty of this task.** A grid child with `display: none` LEAVES the grid. The header uses that deliberately: `Days` is `sm:hidden` and `Duration` is `hidden sm:block`, so exactly one of the two is in flow at any width and the count still matches. Get the count wrong and every column shifts one to the left; the recorded symptom was "Task name" rendering inside the 12px colour-stripe cell and reading `T..`. So:

- `GRID_SM` must declare exactly as many tracks as there are in-flow children BELOW 640px.
- `GRID_LG` must declare exactly as many as there are AT OR ABOVE 640px.
- Both numbers must be 6 when this task is done.

**The target, counted.** Below 640px, in flow: stripe/`#`, name, `Days`, `Start`, `Finish`, actions = 6. At 640px and above: `#`, name, `Duration`, `Start`, `Finish`, actions = 6. Note that `Start` is currently `hidden ... sm:block` and must lose that, or the mobile count comes to 5.

**The widths, and why they are not the spec's.** The spec computed the mobile row at 4.5rem per date column, giving 378px, and checked it against a 390px phone. 4.25rem instead gives 370px, which also clears a 375px iPhone SE with five pixels to spare. The cost is four pixels of date column, and `11 Dec 26` at `text-[11px]` does not need them. Verified by screenshot in Step 5, at both widths.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-sheet-columns.ts`:

```ts
/**
 * Counts the schedule sheet's declared grid tracks.
 *
 * A grid child with `display: none` leaves the grid, so the number of tracks
 * in `GRID_SM` must equal the number of children in flow below 640px, and
 * `GRID_LG`'s must equal the number at or above it. When that arithmetic
 * slipped, every column shifted one to the left and "Task name" was drawn
 * into the 12px colour-stripe cell, where it read "T..".
 *
 * This checks the cheap half of it: that both templates declare the same
 * number of tracks, and that the number is the intended one. The other half,
 * that the children actually match, is a screenshot.
 *
 * Run: node scripts/verify-sheet-columns.ts
 */
import { readFileSync } from 'node:fs';

const SRC = 'components/projects/ScheduleSheet.tsx';
const EXPECTED_TRACKS = 6;

const src = readFileSync(SRC, 'utf8');

/** Pull the bracketed track list out of a `grid-cols-[...]` arbitrary value. */
function tracks(label: string, needle: RegExp): number {
  const m = src.match(needle);
  if (!m) {
    console.error(`✗ could not find ${label} in ${SRC}`);
    process.exit(1);
  }
  // Tracks are joined by `_` inside a Tailwind arbitrary value, but `minmax(a,
  // b)` contains a comma and no underscore, so splitting on `_` is correct.
  return m[1]!.split('_').length;
}

const sm = tracks('GRID_SM', /const GRID_SM = '(?:sm:)?grid-cols-\[([^\]]+)\]'/);
const lg = tracks('GRID_LG', /const GRID_LG =\s*'sm:grid-cols-\[([^\]]+)\]'/);

let failed = 0;
if (sm !== EXPECTED_TRACKS) {
  failed += 1;
  console.error(`✗ GRID_SM declares ${sm} tracks, expected ${EXPECTED_TRACKS}`);
}
if (lg !== EXPECTED_TRACKS) {
  failed += 1;
  console.error(`✗ GRID_LG declares ${lg} tracks, expected ${EXPECTED_TRACKS}`);
}

// The three removed columns must be gone from the header, not merely hidden.
for (const gone of ['>Target<', '>Price<', '>Weight<']) {
  if (src.includes(gone)) {
    failed += 1;
    console.error(`✗ ${SRC} still renders a ${gone.slice(1, -1)} header`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`✓ both grid templates declare ${EXPECTED_TRACKS} tracks, and Target/Price/Weight are gone.`);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/verify-sheet-columns.ts
```

Expected: FAIL with `GRID_SM declares 5 tracks, expected 6`, `GRID_LG declares 9 tracks, expected 6`, and three lines saying Target, Price and Weight headers are still rendered.

- [ ] **Step 3: Change the four constants**

In `components/projects/ScheduleSheet.tsx`:

Replace `GRID_SM` (`:109`):

```ts
const GRID_SM = 'grid-cols-[0.75rem_minmax(5rem,1fr)_2.75rem_4.25rem_4.25rem_2.75rem]';
```

Replace `GRID_LG`'s value (`:117-118`):

```ts
const GRID_LG =
  'sm:grid-cols-[4.25rem_minmax(8rem,1fr)_4.25rem_4.25rem_4.25rem_2.25rem]';
```

Replace `SHEET_NATURAL` (`:55`) and its comment:

```ts
// Where the divider STARTS, in pixels of the shell, not a ratio: stored as a
// ratio the price column was cut off at 1240px and half the timeline was
// wasted at 1920.
//
// The furniture is now 362px (19.25rem of fixed columns, five 6px gaps, 12px
// of padding either side), down from 588px when this sheet still carried
// Target, Price and Weight. 620 therefore leaves the NAME about 258px, up from
// 212, and hands the timeline the other 180px back. Both panes got better,
// which is what dropping three columns was for.
const SHEET_NATURAL = 620;
```

Replace `FULL_GRID` (`:75`) and its comment:

```ts
/**
 * What the six declared columns actually need: 19.25rem of fixed columns plus
 * an 8rem name, five 0.375rem gaps, and the sheet's own 0.75rem either side.
 * 490px.
 *
 * Drag the divider under this and the pane SCROLLS rather than clipping. Both
 * numbers that should have respected the old 716px were short of it, and the
 * consequence was a Weight column cut in half and a Row actions column
 * off-screen with no scrollbar in sight to say so.
 */
const FULL_GRID = 490;
```

- [ ] **Step 4: Change the header and the row**

In the header block (around `:970-981`), delete the three `<span>` elements for `Target`, `Price` and `Weight`, and remove `hidden` / `sm:block` from the `Start` header so it is in flow at every width:

```tsx
              <span className="invisible sm:visible">#</span>
              <span>Task name</span>
              <span className="text-right sm:hidden">Days</span>
              <span className="hidden text-right sm:block">Duration</span>
              <span className="text-right">Start</span>
              <span className="text-right">Finish</span>
              <span className="sr-only">Row actions</span>
```

In the scrolling body, change the minimum widths that were sized for nine columns. Find the wrapper `<div className="min-w-[19rem] sm:min-w-[44.75rem]">` (around `:955`) and replace it with:

```tsx
          <div className="min-w-[23.125rem] sm:min-w-[30.625rem]">
```

23.125rem is 370px, the six mobile tracks plus gaps and padding. 30.625rem is 490px, matching `FULL_GRID`.

In the row component (`SheetRow`, from `:1287`):

1. Delete the `{r.daysLate != null && ( ... )}` block (around `:1344`), the `5d late` badge. It reads `targetDate`, and after this task nothing in the planner can create or change one.
2. Change the `Start` cell's wrapper from `className="hidden text-right tabular-nums sm:block"` to `className="text-right tabular-nums"`.
3. Delete the three cells after `Finish`: the `targetDate` `EditableCell` block (its wrapper still carries the `r.daysLate != null` warn styling at `:1427`, and the whole block goes), the `price` block, and the `bobot` block. Stop at the row-actions cell and leave it as it is.

Remove any import that is now unused. `formatMoney`, `groupAmount` and `stripAmount` from `@/lib/currency` and `updateRowTargetAction` from the actions import are the likely ones; let the type-check in Step 6 name them rather than guessing.

- [ ] **Step 5: Run the test to verify it passes, then look**

```bash
node scripts/verify-sheet-columns.ts
```

Expected: `✓ both grid templates declare 6 tracks, and Target/Price/Weight are gone.`

Then look at the real thing, at three widths, on the five-row project and on Gundih:

```bash
node scripts/shoot.mjs "http://localhost:<PORT>/projects/<GUNDIH_ID>" docs/_shots/sheet-desktop.png 1280 900
node scripts/shoot.mjs "http://localhost:<PORT>/projects/<GUNDIH_ID>" docs/_shots/sheet-390.png 390 844
node scripts/shoot.mjs "http://localhost:<PORT>/projects/<GUNDIH_ID>" docs/_shots/sheet-375.png 375 812
```

Find `<GUNDIH_ID>` with:

```bash
node -e "
const D=require('better-sqlite3');const d=new D('data/report.db',{readonly:true});
console.log(d.prepare('select id, name from projects').all());
"
```

Look at each image and confirm, by eye:

- exactly four data columns plus the outline number and the row menu,
- at 390px AND at 375px all four are present, nothing is clipped, and there is no horizontal scrollbar,
- **the Gantt bars still line up with their rows.** `ROW_H` is unchanged at 44, and bars are placed by `index × ROW_H`, so any row that is not exactly 44px tall puts every bar below it progressively out of line. This is the single most likely thing to have broken.
- no column header sits above a value of a different kind, which is the symptom of a track-count mismatch.

Also confirm no page overflows the document, which this repo holds to zero:

```bash
node -e "
const {createRequire}=require('node:module');
const puppeteer=createRequire('E:/Figtries/Prototype/Report/package.json')('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const p=await b.newPage();
  await p.setViewport({width:390,height:844});
  await p.goto('http://localhost:<PORT>/projects/<GUNDIH_ID>',{waitUntil:'domcontentloaded'});
  console.log(await p.evaluate(()=>({inner:innerWidth,doc:document.documentElement.scrollWidth})));
  await b.close();
})();
"
```

Expected: `inner` and `doc` equal. A `doc` larger than `inner` is the overflow this repo keeps at zero.

- [ ] **Step 6: Type-check, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
npx eslint components/projects/ScheduleSheet.tsx > lint.log 2>&1; echo "exit=$?"; cat lint.log
```

Expected: `exit=0` from both. Lint failures here will be unused imports from Step 4.

```bash
git add components/projects/ScheduleSheet.tsx scripts/verify-sheet-columns.ts
git commit -m "The sheet asks for the four things a schedule is made of"
```

---

### Task 8: The money leaves the planner

**Files:**
- Modify: `components/projects/RowMenu.tsx:178-190`
- Modify: `components/projects/ValueStrip.tsx`
- Modify: `app/projects/[id]/page.tsx:88-93` and its imports

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks import.

The planner becomes one job: the schedule. The contract VALUE stays, because it is one number belonging to the project and it is already asked when the project is created. What leaves is everything that reads per-row prices, because after Task 7 nothing in the planner can type one, and a bar that will always read 0% and cannot be acted on reads as broken rather than as empty.

`lib/weights-actions.ts`, `lib/weights.ts` and `lib/weights-read.ts` are NOT deleted. Data Overall is where they land, and deleting them now would mean rewriting them then.

- [ ] **Step 1: Take the price field out of the row panel**

In `components/projects/RowMenu.tsx`, delete the `Price` label and its `MoneyInput`, the block around `:181-186`. If that leaves a wrapper element with a single child or none, delete the wrapper too. Remove imports that go unused with it.

- [ ] **Step 2: Reduce the value strip**

In `components/projects/ValueStrip.tsx`, the component keeps the figure and the currency picker and loses the rest. Replace the returned JSX of the `ValueStrip` function with:

```tsx
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
      <span className="flex items-center gap-2">
        <strong className="text-base font-semibold tabular-nums sm:text-lg">
          {signed ? money(summary.contractValue) : 'No contract value yet'}
        </strong>
        <CurrencyPicker projectId={projectId} currency={summary.currency} />
      </span>
    </div>
  );
```

Then delete, from the same file: the `MoneyPanel` function entirely, the `open` state and its `useState`, the `pct` / `over` / `closed` computations, and the imports that become unused (`AnimatePresence`, `m`, `MOTION`, `Check`, `ChevronRight`, `TriangleAlert`, `createPortal`, `previewWeightsAction`, `applyWeightsAction`, `WeightPreview`, and `useEffect` / `useTransition` if nothing else uses them).

Update the file's leading doc comment to say what it now is, replacing the paragraphs about five numbers and the Money panel:

```
/**
 * The contract figure, and the currency it is in.
 *
 * It used to carry four more things: a bar for how far the pricing had got, a
 * sentence explaining it, and a Money panel holding the unit reconciliation
 * and the button that derives weights from prices. All four read PER-ROW
 * PRICES, and as of 12 Sep 2026 the planner has no way to type one: pricing
 * moved to Data Overall, because weighting a plan and scheduling it are two
 * jobs and only one of them is what this screen is for.
 *
 * The bar could not simply stay. With no price to type, it would read 0% on
 * every new project, permanently, with nothing on screen able to move it, and
 * a number that cannot be acted on reads as broken rather than as empty.
 *
 * What is left is the one question this line was always answering first: how
 * much is this contract worth. `lib/weights-actions.ts` and the summary this
 * component still reads are untouched and waiting for Data Overall.
 */
```

- [ ] **Step 3: Trim the page's facts row**

In `app/projects/[id]/page.tsx`, delete these two lines from the `facts` array (around `:88-93`), including the comment above them:

```ts
    // Said as a count rather than hidden: pricing is a separate job from
    // scheduling, and this is how far along it is.
    sheet.pricedRows ? `${sheet.pricedRows} priced` : 'no prices yet',
```

Leave `getWeightSummary` and the `<ValueStrip>` render alone: the strip still reads `contractValue` and `currency` from that summary.

- [ ] **Step 4: Look at it**

```bash
node scripts/shoot.mjs "http://localhost:<PORT>/projects/<GUNDIH_ID>" docs/_shots/strip-desktop.png 1280 900
node scripts/shoot.mjs "http://localhost:<PORT>/projects/<GUNDIH_ID>" docs/_shots/strip-390.png 390 844
```

Look at the images and confirm the strip is one line with a figure and the currency control, that it does not read as an unfinished row with a hole where the bar was, and that the header's facts line no longer mentions prices. Then open a row's panel and confirm there is no Price field and the panel has not collapsed into an odd shape without it.

- [ ] **Step 5: Type-check, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.verify.json > tsc.log 2>&1; echo "exit=$?"; tail -20 tsc.log
npx eslint components/projects/ValueStrip.tsx components/projects/RowMenu.tsx "app/projects/[id]/page.tsx" > lint.log 2>&1; echo "exit=$?"; cat lint.log
```

Expected: `exit=0` from both.

```bash
git add components/projects/ValueStrip.tsx components/projects/RowMenu.tsx "app/projects/[id]/page.tsx"
git commit -m "Pricing a plan and scheduling it are two jobs, and this screen is for one of them"
```

---

### Task 9: The whole thing, proved

**Files:**
- Modify: `AGENTS.md` (the "Setup, weights and the plan curve" area and the v2 board)
- No other source changes. If this task finds a defect, fix it in the task it belongs to and re-run that task's checks.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run every verify script this plan added or touches**

```bash
node scripts/verify-alias.ts; echo "alias=$?"
node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts; echo "ensure=$?"
node scripts/verify-sheet-columns.ts; echo "cols=$?"
node scripts/verify-plan-curve.ts; echo "curve=$?"
node --import ./scripts/ts-resolve.mjs scripts/verify-chains.ts; echo "chains=$?"
node --import ./scripts/ts-resolve.mjs scripts/verify-weights-auto.ts; echo "weights=$?"
```

Expected: every `=0`. The last three are pre-existing and are here because this plan touched the sheet, the schema and the project writer. If one of them was already failing before this branch, say so explicitly rather than fixing it here.

- [ ] **Step 2: Paste the user's own plan and check the durations**

In the project created in Task 5, paste the outline from the user's workbook using the sheet's paste-from-Excel control, as tab-separated `name`, `start`, `finish`:

```
Jasa Pengadaan Instrument dan Control System Solar Turbine PHSS	2025-12-29	2027-05-14
Procurement Material	2025-12-29	2027-03-22
Procurement Material Solar	2025-12-29	2026-11-23
PO Issuance	2025-12-29	2025-12-29
Fabrication & RTS Retrofit Part C-4500	2025-12-29	2026-10-24
Shipment (ETA to Jakarta)	2026-10-25	2026-11-23
Procurement Installation Material part	2026-11-09	2027-03-22
PO Issuance	2026-11-09	2026-11-09
Fabrication & RTS	2026-11-09	2027-03-08
Shipment to Site	2027-03-16	2027-03-22
```

Then read back the durations:

```bash
node -e "
const D=require('better-sqlite3');const d=new D('data/report.db',{readonly:true});
console.log(d.prepare(\"select n.name, s.start_date, s.finish_date from nodes n join node_schedules s on s.node_id = n.id where n.project_id = ? order by n.sort_order\").all('<NEW_PROJECT_ID>'));
"
```

Expected, read off the screen's Duration column: the top row **502 d**, `Fabrication & RTS` **120 d**, and (using the PDF's own later rows) a five-day task as **5 d**. These are the three the spec checked by hand against the signed workbook. A mismatch means duration stopped being inclusive calendar days, which would be a regression in `inclusiveDays`, not in this plan.

If the table name in the query above is wrong, find it with `grep -n "sqliteTable('node" lib/schema.ts` and correct the query. Do not change the schema.

- [ ] **Step 3: Build**

```bash
NEXT_DIST_DIR=.next-verify npx next build > build.log 2>&1; echo "exit=$?"; tail -40 build.log
```

Expected: `exit=0`. Read the tail even on success: a route that changed from static to dynamic is worth noticing. Both build failures in this repo's print history were build-time only, and `cacheComponents` turns an uncached read in the wrong place into a build error rather than a runtime one.

- [ ] **Step 4: Undo the build's churn**

```bash
git diff --stat tsconfig.json && git checkout -- tsconfig.json; git status --short
```

`next build` auto-appends the current `NEXT_DIST_DIR`'s types to `tsconfig.json`'s `include`. Revert it. Also confirm `tsconfig.verify.json`, `tsc.log`, `lint.log`, `build.log` and `docs/_shots/` are either removed or ignored, and that no file named `nul` exists at the project root:

```bash
ls -la ./nul 2>/dev/null && echo "DELETE IT: rm -f ./nul"
```

- [ ] **Step 5: Write down what future sessions must not rediscover**

Add to `AGENTS.md`. Under the section about setup and weights, a new paragraph:

```
**The planner asks for a schedule, and nothing else.** Four columns: task
name, duration, start, finish. Target, Price and Weight were removed on 12
Sep 2026 and the reason is not tidiness. With per-row money out of it, the
sheet's client-side model only has to hold name, dates, duration, order and
depth, which is what makes instant editing tractable at all; with Price in it,
that model would also have to carry weight derivation. Per-row prices, weights
and the `weight_basis = 'boq'` lock live in Data Overall. `ValueStrip` keeps
the contract figure and the currency because that is one number belonging to
the project, asked when the project is created. A bar reading 0% that nothing
on screen can move reads as broken, not as empty, which is why the pricing bar
went with the columns rather than staying behind.
```

And under the multi-project / snapshot section:

```
**A new COLUMN reaches the deployment through `ensureSchema()`, not through a
migration.** Nothing runs `drizzle-kit migrate` on Vercel: `instrumentation.ts`
pulls the blob snapshot over the database file before the first query, so the
snapshot's schema IS the deployed schema and the freshly built file is
overwritten. `EXPECTED_COLUMNS` in `lib/db-snapshot.ts` is the list that gets
put back after every restore, idempotently; append one line per column added
from here on. This does not solve new TABLES, which would also need their
indexes and foreign keys, so that remains a deployment question to answer
before writing the code.
```

Finally, mark the board. In the FASE 5 block, annotate item 17 so the revision is visible:

```
17 Planner                   selesai   WBS · harga · tanggal · target · Gantt
                                       tempel dari Excel · bar styles · rantai
                                       12 Sep 26: turun ke 4 kolom (jadwal saja),
                                       harga/bobot pindah ke papan 12
```

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md
git commit -m "Write down why the planner stopped asking about money"
```

- [ ] **Step 7: Report, do not push**

Report to the user: which verify scripts passed with their output, the build's exit code, and the screenshots at 1280, 390 and 375 with what you saw in each. State plainly anything that did not work. Do NOT push and do NOT merge to `main`; this branch is `planner-jadwal-dulu` and the user decides when it lands.

---

## Self-Review

**Spec coverage.** Bagian 1 (alias): Tasks 1, 2, 4, 5, 6. The deployment problem and `ensureSchema()`: Task 3. Bagian 2 (nine columns to four, `FULL_GRID`, the `5d late` badge, RowMenu, ValueStrip, the facts row): Tasks 7 and 8. The spec's verification section: Task 9, plus the per-task screenshot and type-check steps. Bagian 3 is Langkah 2 and is deliberately absent from this plan.

**Two places this plan deliberately diverges from the spec, both stated at the point of divergence.** The mobile date columns are 4.25rem, not 4.5rem, so the row needs 370px and clears a 375px iPhone SE rather than only a 390px phone (Task 7, preamble). And `SHEET_NATURAL` drops to 620, so the realised gain is about 46px to the name plus 180px back to the timeline, rather than the spec's 226px, which was stated as the gain at a fixed pane width and remains true as written (Task 7, Step 3).

**Names used consistently.** `deriveAlias` and `ALIAS_MAX_LENGTH` (Tasks 1, 4, 5). `ensureSchema(dbPath) → string[]` and `EXPECTED_COLUMNS` (Task 3, Task 9 Step 5). `projects.alias` in the schema, `alias` on `ProjectCard` and on `createProjectAction`'s input (Tasks 2, 4, 5, 6). `GRID_SM`, `GRID_LG`, `SHEET_NATURAL`, `FULL_GRID`, `ROW_H` as they are already spelled in `ScheduleSheet.tsx` (Task 7).

**Three places the plan tells the implementer to look rather than assuming**, because the exact line could not be pinned without reading a file this plan does not otherwise touch: the `ProjectCard` object literals (Task 4, Step 2), the name element in `ProjectList.tsx` (Task 6, Step 1), and the name expression in `LiveProjectSwitcher.tsx` (Task 6, Step 3). Each gives the grep to run and the exact JSX to insert.
