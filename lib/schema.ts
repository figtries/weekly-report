/**
 * The relational shape of a project.
 *
 * Written for SQLite because a prototype's database should be a file you can
 * copy, but every choice here is made so the same schema moves to Postgres
 * without being rewritten: ids are text, timestamps are ISO strings, and
 * nothing that is really a relation is folded into a JSON column. That last
 * rule is the one `lib/db.ts` broke, and it is why a workspace could only ever
 * have one writer.
 *
 * Percentages and weights are 0..100 throughout, matching `bobot` in
 * `lib/types.ts`. Fractions are only ever an implementation detail inside a
 * calculation.
 */
import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey();
const now = () => text('created_at').notNull().default(sql`(datetime('now'))`);

/* ------------------------------------------------------------------ people */

export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: now(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)]);

/**
 * What a person may do, per project — not globally. The same person is a
 * Project Control engineer on one job and a spectator on the next.
 */
export type Role = 'admin' | 'control' | 'field' | 'approver' | 'client';

export const memberships = sqliteTable('memberships', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<Role>().notNull(),
  createdAt: now(),
}, (t) => [uniqueIndex('memberships_project_user_idx').on(t.projectId, t.userId)]);

/* ---------------------------------------------------------------- project */

/**
 * `boq` means every weight was derived from a priced line and the total closes
 * at 100 by construction. `even` means it did not, and the report has to say so
 * — a rough number shown honestly beats a project that never gets set up.
 */
export type WeightBasis = 'boq' | 'even';

export const projects = sqliteTable('projects', {
  id: id(),
  name: text('name').notNull(),
  clientName: text('client_name'),
  contractorName: text('contractor_name'),
  contractNo: text('contract_no'),
  /** Prefix for generated document numbers, e.g. `PRGG-00-G0`. */
  docNoPrefix: text('doc_no_prefix'),
  contractValue: real('contract_value'),
  currency: text('currency').notNull().default('IDR'),
  weightBasis: text('weight_basis').$type<WeightBasis>().notNull().default('boq'),
  startDate: text('start_date'),
  finishDate: text('finish_date'),
  createdAt: now(),
  archivedAt: text('archived_at'),

  /** Drives "last touched" order on /projects. Written by every project mutation. */
  updatedAt: text('updated_at'),

  /**
   * TEMPORARY, and it is meant to die.
   *
   * Dashboard, Weekly, Daily and Klaim still speak the old JSON `Database`
   * shape. `lib/legacy-adapter.ts` builds that shape from these tables, but
   * three of its fields — `daily`, `catalogs`, `photoMeta` — have no tables
   * here yet, so for a project that HAS a db.json twin they are read across
   * from it. Null means no twin, which is the normal case for every project
   * made in the app: those fields come back empty, and empty is the right
   * answer for a project that has never had a daily report.
   *
   * Delete this column when board items 08-14 move those pages onto SQLite.
   */
  legacyJsonId: text('legacy_json_id'),

  /* Report-header text the old `ProjectInfo` demands and this table lacked. */
  workLocation: text('work_location'),
  documentNoWeekly: text('document_no_weekly'),
  documentNoDaily: text('document_no_daily'),
  /** JSON `{ company, name }` — a signature block is two strings, never a relation. */
  signatureLeft: text('signature_left'),
  signatureRight: text('signature_right'),
});

/**
 * Which project the app is looking at. One row, forever.
 *
 * A cookie would give each browser its own, which is the honest answer once
 * there are logins — but reading cookies is a dynamic read, and under
 * `cacheComponents: true` that forces `<Suspense>` around every read in the
 * app. This repo has hit that wall twice. A single synchronous row prerenders
 * like everything else here.
 *
 * `set null` on delete is deliberate: deleting the open project empties the
 * pointer rather than dangling it, and `getActiveProjectId()` falls through to
 * the first unarchived project. The app is never left with nothing to show.
 */
export const appState = sqliteTable('app_state', {
  id: text('id').primaryKey().default('singleton'),
  activeProjectId: text('active_project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  updatedAt: text('updated_at'),
});

/* -------------------------------------------------------------------- WBS */

/**
 * `linked` is the new one: the leaf takes its percentage from the document
 * register instead of from someone typing. It is what stops engineering being
 * measured twice — once in the physical WBS and again in the EDL.
 */
export type ProgressMethod = 'qty' | 'milestone' | 'lumpsum' | 'linked';

/**
 * One tree per project. A reporting unit is not a level of its own — it is a
 * node someone marked, which is exactly how SPK-002 sits at WBS `1.2` in the
 * Gundih workbook. Marking a node normalises its subtree to 100 and earns it
 * its own tab and its own section in the PDF.
 */
export const wbsNodes = sqliteTable('wbs_nodes', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  wbsCode: text('wbs_code').notNull(),
  deskripsi: text('deskripsi').notNull(),
  order: integer('sort_order').notNull().default(0),
  depth: integer('depth').notNull().default(0),
  isLeaf: integer('is_leaf', { mode: 'boolean' }).notNull().default(false),

  /**
   * A point in time rather than a span. MS Project writes this as a duration of
   * `0 days`, which is how the file stores it, not how anyone thinks about it —
   * so here it is a property of the row and the zero duration follows from it.
   * Without the flag a one-day task is indistinguishable from a milestone.
   */
  isMilestone: integer('is_milestone', { mode: 'boolean' }).notNull().default(false),

  /* reporting unit — SPK / Paket / Lot / Area, the label is the client's word */
  isReportingUnit: integer('is_reporting_unit', { mode: 'boolean' }).notNull().default(false),
  unitLabel: text('unit_label'),
  unitContractNo: text('unit_contract_no'),
  unitContractValue: real('unit_contract_value'),

  /**
   * "Should be finished before this" — MS Project's `Deadline`, and the only
   * date a person types on a row that has children.
   *
   * It is deliberately NOT part of the schedule: it never moves a bar, never
   * feeds the plan curve, and never overwrites a summary's computed span. It
   * sits beside the span and is compared against it, so a row that runs past it
   * is marked instead of being quietly re-planned. That separation is the whole
   * point — a deadline that pushes the work is just another finish date, and
   * then nothing records what was actually promised.
   *
   * It lives on the node rather than on a baseline because it is a promise, not
   * a revision: re-baselining the plan does not move what the contract asked
   * for. This is also the first home each SPK's contractual completion date has
   * ever had.
   */
  targetDate: text('target_date'),

  /* leaf economics — null on every branch */
  vol: real('vol'),
  satuan: text('satuan'),
  price: real('price'),
  /** Share of the whole project, 0..100. Derived from price; never accepted from a client payload. */
  bobot: real('bobot'),
  /** Share of the enclosing reporting unit, 0..100. Gundih calls this `WF per SPK`. */
  bobotInUnit: real('bobot_in_unit'),
  /**
   * How this node's weight was split off its parent — Gundih's `Workstep`
   * column, 0.5 / 0.3 / 0.2 for IFR / IFA / AFC. Kept so a schedule or price
   * revision can re-split the subtree instead of asking someone to retype it.
   */
  workstepFactor: real('workstep_factor'),

  /* measurement */
  progressMethod: text('progress_method').$type<ProgressMethod>().notNull().default('lumpsum'),
  /** `qty` items only. `vol: 1, satuan: 'Ls'` is not a real quantity — see hasRealQuantity(). */
  qtyTotal: real('qty_total'),
  /** `linked` items only: the document category this leaf reads its percentage from. */
  linkedCategoryId: text('linked_category_id'),
  /**
   * `linked` items only. Gundih splits engineering into an IFR, an IFA and an
   * AFC leaf per discipline, so a leaf reads ONE stage of its category rather
   * than the category's whole weighted figure.
   */
  linkedStage: text('linked_stage').$type<DocStage>(),

  createdAt: now(),
}, (t) => [
  index('wbs_project_idx').on(t.projectId),
  index('wbs_parent_idx').on(t.parentId),
  uniqueIndex('wbs_project_code_idx').on(t.projectId, t.wbsCode),
]);

/** A named step of a leaf that can't be measured in units. Weights sum to 100. */
export const milestones = sqliteTable('milestones', {
  id: id(),
  nodeId: text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  weight: real('weight').notNull(),
  order: integer('sort_order').notNull().default(0),
}, (t) => [index('milestones_node_idx').on(t.nodeId)]);

/* --------------------------------------------------------------- schedule */

/**
 * `contractual` is stamped once and never moves — it is what a claim or an
 * extension of time is argued against. `active` is the latest agreed revision,
 * and it is what the work is managed against. Gundih keeps both side by side as
 * BASELINE-1 and RE-BASELINE, and so do we.
 */
export type BaselineKind = 'contractual' | 'active';

export const baselines = sqliteTable('baselines', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<BaselineKind>().notNull(),
  revisionNo: integer('revision_no').notNull().default(0),
  label: text('label'),
  /** Why the schedule moved. Blank here is what makes a revision unarguable later. */
  reason: text('reason'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedAt: text('approved_at'),
  createdAt: now(),
}, (t) => [index('baselines_project_idx').on(t.projectId)]);

/**
 * Start and finish per leaf, per baseline — and that is all. The weekly plan
 * curve is NOT stored: each leaf spreads linearly across its own duration and
 * the S shape emerges from hundreds of leaves overlapping, which is exactly
 * what the Gundih numbers turn out to be. Deriving it means a schedule revision
 * is a date change, and a stale curve is impossible.
 */
export const nodeSchedules = sqliteTable('node_schedules', {
  id: id(),
  baselineId: text('baseline_id').notNull().references(() => baselines.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  startDate: text('start_date').notNull(),
  finishDate: text('finish_date').notNull(),
  durationDays: integer('duration_days').notNull(),
}, (t) => [uniqueIndex('node_schedules_baseline_node_idx').on(t.baselineId, t.nodeId)]);

/* ---------------------------------------------------------------- weekly */

export type WeekStatus = 'open' | 'submitted' | 'approved';

export const weeks = sqliteTable('weeks', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  weekNo: integer('week_no').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status').$type<WeekStatus>().notNull().default('open'),
  createdAt: now(),
}, (t) => [uniqueIndex('weeks_project_no_idx').on(t.projectId, t.weekNo)]);

/**
 * One row per leaf per week. For `qty`, `milestone` and `linked` items
 * `cumProgressPct` is only a cache of what the evidence already says —
 * `lib/progress.ts` recomputes it and is the only thing allowed to write it.
 * `lumpsum` still reads the typed value, unchanged.
 */
export const leafProgress = sqliteTable('leaf_progress', {
  id: id(),
  weekId: text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  method: text('method').$type<ProgressMethod>().notNull(),
  cumProgressPct: real('cum_progress_pct').notNull().default(0),
  /** `qty` items: cumulative quantity completed, in the item's own unit. */
  qtyDone: real('qty_done'),
  note: text('note'),
  recordedBy: text('recorded_by').references(() => users.id),
  recordedAt: text('recorded_at'),
}, (t) => [uniqueIndex('leaf_progress_week_node_idx').on(t.weekId, t.nodeId)]);

/** Which milestones a leaf had reached as of a given week. */
export const milestoneProgress = sqliteTable('milestone_progress', {
  id: id(),
  weekId: text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  milestoneId: text('milestone_id').notNull().references(() => milestones.id, { onDelete: 'cascade' }),
  achieved: integer('achieved', { mode: 'boolean' }).notNull().default(false),
  recordedBy: text('recorded_by').references(() => users.id),
  recordedAt: text('recorded_at'),
}, (t) => [uniqueIndex('milestone_progress_week_ms_idx').on(t.weekId, t.milestoneId)]);

/**
 * The figure that was signed, stored beside the signature. A signature that
 * silently follows the number it signed is worth nothing in a dispute, so if
 * the week is edited afterwards the panel can show the drift.
 */
export const approvals = sqliteTable('approvals', {
  id: id(),
  weekId: text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  approvedBy: text('approved_by').notNull().references(() => users.id),
  approvedAt: text('approved_at').notNull(),
  snapshotActualPct: real('snapshot_actual_pct').notNull(),
  snapshotPlanPct: real('snapshot_plan_pct').notNull(),
  signerName: text('signer_name').notNull(),
  signerTitle: text('signer_title'),
  signerCompany: text('signer_company'),
  note: text('note'),
}, (t) => [index('approvals_week_idx').on(t.weekId)]);

/** Who changed what, when, and from what. The reason `#REF!` can't happen here. */
export const auditLog = sqliteTable('audit_log', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  field: text('field'),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  at: text('at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('audit_project_at_idx').on(t.projectId, t.at),
  index('audit_entity_idx').on(t.entityType, t.entityId),
]);

/* ------------------------------------------------------- document control */

/**
 * The second progress engine. It runs on the same arithmetic as the physical
 * WBS — weight, then stage weights, then a cumulative curve — which is why one
 * engine can serve both.
 */
/**
 * Two registers run on one engine. `edl` is what we owe the client; `vdrl` is
 * what our vendors owe us. The chain, the arithmetic and the write path are
 * identical, so they share these tables and differ only by this flag, their
 * stage weights, and who is chasing whom.
 */
export type RegisterKind = 'edl' | 'vdrl';

export const docCategories = sqliteTable('doc_categories', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register: text('register').$type<RegisterKind>().notNull().default('edl'),
  parentId: text('parent_id'),
  code: text('code').notNull(),
  name: text('name').notNull(),
  order: integer('sort_order').notNull().default(0),
  /**
   * How many documents this category is expected to hold. Gundih's `JUMLAH`.
   * Weight is count ÷ total documents — every document counted equally — so
   * this is only stored for categories whose register isn't complete yet.
   */
  plannedCount: integer('planned_count'),
}, (t) => [
  index('doc_categories_project_idx').on(t.projectId, t.register),
  uniqueIndex('doc_categories_project_code_idx').on(t.projectId, t.register, t.code),
]);

export const documents = sqliteTable('documents', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register: text('register').$type<RegisterKind>().notNull().default('edl'),
  categoryId: text('category_id').notNull().references(() => docCategories.id, { onDelete: 'cascade' }),
  /**
   * Blank on 149 rows of Gundih's VDRL: the vendor owes the document but nobody
   * has numbered it yet. It is still a deliverable and still counts against its
   * package, so an empty number is allowed.
   */
  docNo: text('doc_no'),
  /** The client's own drawing number, when the document replaces an existing one. */
  existingDwgNo: text('existing_dwg_no'),
  revision: text('revision'),
  title: text('title').notNull(),
  /** `Doc` or `Dwg` — Gundih's own distinction, and it drives sheet counts. */
  kind: text('kind'),
  size: text('size'),
  sheets: integer('sheets'),
  priority: text('priority'),
  pic: text('pic'),
  status: text('status'),
  remarks: text('remarks'),
  order: integer('sort_order').notNull().default(0),
}, (t) => [
  index('documents_category_idx').on(t.categoryId),
  index('documents_project_register_idx').on(t.projectId, t.register),
  // Document numbers are NOT guaranteed unique. Numbering discipline is real,
  // but enforcing it here means refusing a register as it actually is: Gundih's
  // VDRL uses `PRGG-VDR-KMI-IN-PSV-DOC-003` twice, and Petrogas' EDL — an EDL,
  // where this rule was once thought safe — uses `WPP-IN-LAY-003` twice. What
  // replaces the refusal is sight: the paste preview counts them before writing,
  // and the workbench flags them afterwards.
]);

/**
 * The review chain. `RE_*` stages are resubmissions of the stage before them
 * and carry no weight of their own — they exist so the register can say how
 * many times a drawing went round, which is what an extension-of-time argument
 * is actually built from.
 */
export type DocStage = 'IFR' | 'RE_IFR' | 'IFA' | 'RE_IFA' | 'AFC' | 'RE_AFC1' | 'RE_AFC2' | 'ASBUILT';

export const docStages = sqliteTable('doc_stages', {
  id: id(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  stage: text('stage').$type<DocStage>().notNull(),
  order: integer('sort_order').notNull().default(0),
  planSubmitDate: text('plan_submit_date'),
  /**
   * Whether the document ACTUALLY went out at this stage. A row now exists for
   * a stage that was merely promised too — that is what lets the register draw
   * a plan curve beside the real one — so the presence of a row is no longer
   * evidence of anything. This flag is.
   *
   * Separate from `submittedAt` because the register marks 42 submissions whose
   * date nobody wrote down with a bare `1`; the client's own summary counts
   * them, and reading dates alone would undercount every stage.
   */
  submitted: integer('submitted', { mode: 'boolean' }).notNull().default(false),
  submittedAt: text('submitted_at'),
  submitTransmittalId: text('submit_transmittal_id').references(() => transmittals.id),
  returnedAt: text('returned_at'),
  returnTransmittalId: text('return_transmittal_id').references(() => transmittals.id),
  /** APP, AWC, and friends. `AWC` is what quietly holds construction up. */
  returnCode: text('return_code'),
}, (t) => [uniqueIndex('doc_stages_doc_stage_idx').on(t.documentId, t.stage)]);

/** IFR 0.5 · IFA 0.3 · AFC 0.2 in Gundih — but it is a per-project agreement, not a law. */
export const docStageWeights = sqliteTable('doc_stage_weights', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register: text('register').$type<RegisterKind>().notNull().default('edl'),
  stage: text('stage').$type<DocStage>().notNull(),
  /** Share of a document, 0..100. The weighted stages should sum to 100. */
  weight: real('weight').notNull(),
  order: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('doc_stage_weights_project_stage_idx').on(t.projectId, t.register, t.stage)]);

/**
 * How this project builds a document number: PROJECT-DISCIPLINE-TYPE-SEQUENCE.
 *
 * Stored per project and register because it IS per project — Petrogas numbers
 * `WPP-EL-DDS-001` and Gundih `PRGG-20-E0-DS-001`, the same idea with a
 * different alphabet. The per-section and per-group codes are JSON because they
 * are a map keyed by names the project chose, and a table of two-letter codes
 * would be a join for nothing.
 *
 * Set once and editable afterwards: a rule nobody can change is a rule people
 * work around.
 */
export const docNumbering = sqliteTable('doc_numbering', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register: text('register').$type<RegisterKind>().notNull().default('edl'),
  /** `WPP`, `PRGG`. */
  prefix: text('prefix').notNull(),
  /** Section name → discipline code, as JSON. */
  disciplines: text('disciplines').notNull().default('{}'),
  /** Group name → type code without its kind letter, as JSON. */
  types: text('types').notNull().default('{}'),
  digits: integer('digits').notNull().default(3),
}, (t) => [uniqueIndex('doc_numbering_project_idx').on(t.projectId, t.register)]);

export const transmittals = sqliteTable('transmittals', {
  id: id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register: text('register').$type<RegisterKind>().notNull().default('edl'),
  no: text('no').notNull(),
  /** `out` is ours to them, `in` is theirs back to us. */
  direction: text('direction').$type<'out' | 'in'>().notNull(),
  date: text('date').notNull(),
  note: text('note'),
  // Both registers number their transmittals from T.001, and they are not the
  // same letters: the EDL's go to Pertamina, the VDRL's come from vendors.
}, (t) => [uniqueIndex('transmittals_project_no_dir_idx').on(t.projectId, t.register, t.no, t.direction)]);
