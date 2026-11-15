/**
 * The relational shape of a project — PostgreSQL edition (FASE 3).
 *
 * Translated from the SQLite schema; the mapping is deliberate:
 * - `sqliteTable` → `pgTable`
 * - `integer(mode:'boolean')` → `boolean`
 * - `real` → `doublePrecision`
 * - `datetime('now')` default → `now()::text` (kept as text so callers
 *   that build/compare ISO strings need no changes in FASE 4)
 *
 * Percentages and weights are 0..100 throughout, matching `bobot` in
 * `lib/types.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const id  = () => text('id').primaryKey();
const now = () => text('created_at').notNull().default(sql`now()::text`);

/* ------------------------------------------------------------------ people */

export const users = pgTable('users', {
  id:        id(),
  email:     text('email').notNull(),
  name:      text('name').notNull(),
  createdAt: now(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)]);

export type Role = 'admin' | 'control' | 'field' | 'approver' | 'client';

export const memberships = pgTable('memberships', {
  id:        id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      text('role').$type<Role>().notNull(),
  createdAt: now(),
}, (t) => [uniqueIndex('memberships_project_user_idx').on(t.projectId, t.userId)]);

/* ---------------------------------------------------------------- project */

export type WeightBasis = 'boq' | 'even';

export const projects = pgTable('projects', {
  id:               id(),
  name:             text('name').notNull(),
  alias:            text('alias'),
  clientName:       text('client_name'),
  contractorName:   text('contractor_name'),
  contractNo:       text('contract_no'),
  docNoPrefix:      text('doc_no_prefix'),
  contractValue:    doublePrecision('contract_value'),
  currency:         text('currency').notNull().default('IDR'),
  weightBasis:      text('weight_basis').$type<WeightBasis>().notNull().default('boq'),
  barPreset:        text('bar_preset').$type<BarPreset>(),
  barView:          text('bar_view'),
  field:            text('field'),
  startDate:        text('start_date'),
  finishDate:       text('finish_date'),
  pinnedCurrentWeek: integer('current_week'),
  createdAt:        now(),
  archivedAt:       text('archived_at'),
  updatedAt:        text('updated_at'),
  legacyJsonId:     text('legacy_json_id'),
  workLocation:     text('work_location'),
  documentNoWeekly: text('document_no_weekly'),
  documentNoDaily:  text('document_no_daily'),
  signatureLeft:    text('signature_left'),
  signatureRight:   text('signature_right'),
});

export const appState = pgTable('app_state', {
  id:              text('id').primaryKey().default('singleton'),
  activeProjectId: text('active_project_id').references(() => projects.id, { onDelete: 'set null' }),
  updatedAt:       text('updated_at'),
});

/* -------------------------------------------------------------------- WBS */

export type ProgressMethod = 'qty' | 'milestone' | 'lumpsum' | 'linked';

export const wbsNodes = pgTable('wbs_nodes', {
  id:                id(),
  projectId:         text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentId:          text('parent_id'),
  wbsCode:           text('wbs_code').notNull(),
  deskripsi:         text('deskripsi').notNull(),
  order:             integer('sort_order').notNull().default(0),
  depth:             integer('depth').notNull().default(0),
  isLeaf:            boolean('is_leaf').notNull().default(false),
  isMilestone:       boolean('is_milestone').notNull().default(false),
  isReportingUnit:   boolean('is_reporting_unit').notNull().default(false),
  unitLabel:         text('unit_label'),
  unitContractNo:    text('unit_contract_no'),
  unitContractValue: doublePrecision('unit_contract_value'),
  targetDate:        text('target_date'),
  vol:               doublePrecision('vol'),
  satuan:            text('satuan'),
  price:             doublePrecision('price'),
  bobot:             doublePrecision('bobot'),
  bobotInUnit:       doublePrecision('bobot_in_unit'),
  workstepFactor:    doublePrecision('workstep_factor'),
  progressMethod:    text('progress_method').$type<ProgressMethod>().notNull().default('lumpsum'),
  qtyTotal:          doublePrecision('qty_total'),
  linkedCategoryId:  text('linked_category_id'),
  linkedStage:       text('linked_stage').$type<DocStage>(),
  workKind:          text('work_kind'),
  workPart:          text('work_part'),
  barLabel:          text('bar_label'),
  forecastDate:      text('forecast_date'),
  forecastSource:    text('forecast_source'),
  forecastRung:      text('forecast_rung'),
  forecastWeek:      integer('forecast_week'),
  waitsFor:          text('waits_for'),
  createdAt:         now(),
}, (t) => [
  index('wbs_project_idx').on(t.projectId),
  index('wbs_parent_idx').on(t.parentId),
  uniqueIndex('wbs_project_code_idx').on(t.projectId, t.wbsCode),
]);

/* ------------------------------------------------------------- bar styles */

export type BarCondition =
  | 'always' | 'summary' | 'milestone' | 'task' | 'in_unit'
  | 'past_target' | 'unscheduled' | 'in_progress' | 'unpriced'
  | 'weight_above' | 'weight_below' | 'critical';

export type BarPaint =
  | 'unit' | 'foreground' | 'warn' | 'danger' | 'ok' | 'muted'
  | 'plan-1' | 'plan-2' | 'plan-3' | 'plan-4' | 'plan-5' | 'plan-6'
  | 'plan-7' | 'plan-8' | 'plan-9' | 'plan-10';

export type BarPreset = 'type' | 'package';
export type BarShape  = 'auto' | 'bar' | 'bracket' | 'diamond';

export const barStyles = pgTable('bar_styles', {
  id:             id(),
  projectId:      text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  order:          integer('sort_order').notNull().default(0),
  label:          text('label').notNull(),
  condition:      text('condition').$type<BarCondition>().notNull(),
  conditionValue: text('condition_value'),
  paint:          text('paint').$type<BarPaint>().notNull().default('unit'),
  shape:          text('shape').$type<BarShape>().notNull().default('auto'),
  hatched:        boolean('hatched').notNull().default(false),
  enabled:        boolean('enabled').notNull().default(true),
}, (t) => [index('bar_styles_project_idx').on(t.projectId)]);

export const milestones = pgTable('milestones', {
  id:     id(),
  nodeId: text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  label:  text('label').notNull(),
  weight: doublePrecision('weight').notNull(),
  order:  integer('sort_order').notNull().default(0),
}, (t) => [index('milestones_node_idx').on(t.nodeId)]);

/* --------------------------------------------------------------- schedule */

export type BaselineKind = 'contractual' | 'active';

export const baselines = pgTable('baselines', {
  id:         id(),
  projectId:  text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  kind:       text('kind').$type<BaselineKind>().notNull(),
  revisionNo: integer('revision_no').notNull().default(0),
  label:      text('label'),
  reason:     text('reason'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedAt: text('approved_at'),
  createdAt:  now(),
}, (t) => [index('baselines_project_idx').on(t.projectId)]);

export const nodeSchedules = pgTable('node_schedules', {
  id:           id(),
  baselineId:   text('baseline_id').notNull().references(() => baselines.id, { onDelete: 'cascade' }),
  nodeId:       text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  startDate:    text('start_date').notNull(),
  finishDate:   text('finish_date').notNull(),
  durationDays: integer('duration_days').notNull(),
}, (t) => [uniqueIndex('node_schedules_baseline_node_idx').on(t.baselineId, t.nodeId)]);

/* ---------------------------------------------------------------- weekly */

export type WeekStatus = 'open' | 'submitted' | 'approved';

export const weeks = pgTable('weeks', {
  id:        id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  weekNo:    integer('week_no').notNull(),
  startDate: text('start_date').notNull(),
  endDate:   text('end_date').notNull(),
  status:    text('status').$type<WeekStatus>().notNull().default('open'),
  createdAt: now(),
}, (t) => [uniqueIndex('weeks_project_no_idx').on(t.projectId, t.weekNo)]);

export const leafProgress = pgTable('leaf_progress', {
  id:             id(),
  weekId:         text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  nodeId:         text('node_id').notNull().references(() => wbsNodes.id, { onDelete: 'cascade' }),
  method:         text('method').$type<ProgressMethod>().notNull(),
  cumProgressPct: doublePrecision('cum_progress_pct').notNull().default(0),
  qtyDone:        doublePrecision('qty_done'),
  note:           text('note'),
  source:         text('source'),
  recordedBy:     text('recorded_by').references(() => users.id),
  recordedAt:     text('recorded_at'),
}, (t) => [uniqueIndex('leaf_progress_week_node_idx').on(t.weekId, t.nodeId)]);

export const milestoneProgress = pgTable('milestone_progress', {
  id:          id(),
  weekId:      text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  milestoneId: text('milestone_id').notNull().references(() => milestones.id, { onDelete: 'cascade' }),
  achieved:    boolean('achieved').notNull().default(false),
  recordedBy:  text('recorded_by').references(() => users.id),
  recordedAt:  text('recorded_at'),
}, (t) => [uniqueIndex('milestone_progress_week_ms_idx').on(t.weekId, t.milestoneId)]);

export const approvals = pgTable('approvals', {
  id:                 id(),
  weekId:             text('week_id').notNull().references(() => weeks.id, { onDelete: 'cascade' }),
  approvedBy:         text('approved_by').notNull().references(() => users.id),
  approvedAt:         text('approved_at').notNull(),
  snapshotActualPct:  doublePrecision('snapshot_actual_pct').notNull(),
  snapshotPlanPct:    doublePrecision('snapshot_plan_pct').notNull(),
  signerName:         text('signer_name').notNull(),
  signerTitle:        text('signer_title'),
  signerCompany:      text('signer_company'),
  note:               text('note'),
}, (t) => [index('approvals_week_idx').on(t.weekId)]);

export const auditLog = pgTable('audit_log', {
  id:         id(),
  projectId:  text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId:     text('user_id').references(() => users.id),
  entityType: text('entity_type').notNull(),
  entityId:   text('entity_id').notNull(),
  field:      text('field'),
  oldValue:   text('old_value'),
  newValue:   text('new_value'),
  at:         text('at').notNull().default(sql`now()::text`),
}, (t) => [
  index('audit_project_at_idx').on(t.projectId, t.at),
  index('audit_entity_idx').on(t.entityType, t.entityId),
]);

/* ------------------------------------------------------- document control */

export type RegisterKind = 'edl' | 'vdrl';

export const docCategories = pgTable('doc_categories', {
  id:           id(),
  projectId:    text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register:     text('register').$type<RegisterKind>().notNull().default('edl'),
  parentId:     text('parent_id'),
  code:         text('code').notNull(),
  name:         text('name').notNull(),
  order:        integer('sort_order').notNull().default(0),
  plannedCount: integer('planned_count'),
}, (t) => [
  index('doc_categories_project_idx').on(t.projectId, t.register),
  uniqueIndex('doc_categories_project_code_idx').on(t.projectId, t.register, t.code),
]);

export const documents = pgTable('documents', {
  id:            id(),
  projectId:     text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register:      text('register').$type<RegisterKind>().notNull().default('edl'),
  categoryId:    text('category_id').notNull().references(() => docCategories.id, { onDelete: 'cascade' }),
  docNo:         text('doc_no'),
  existingDwgNo: text('existing_dwg_no'),
  revision:      text('revision'),
  title:         text('title').notNull(),
  kind:          text('kind'),
  size:          text('size'),
  sheets:        integer('sheets'),
  priority:      text('priority'),
  pic:           text('pic'),
  status:        text('status'),
  remarks:       text('remarks'),
  order:         integer('sort_order').notNull().default(0),
}, (t) => [
  index('documents_category_idx').on(t.categoryId),
  index('documents_project_register_idx').on(t.projectId, t.register),
]);

export type BaseStage  = 'IFR' | 'RE_IFR' | 'IFA' | 'RE_IFA' | 'AFC' | 'RE_AFC1' | 'RE_AFC2' | 'ASBUILT';
export type AddedStage = `S${number}` | `RE_S${number}`;
export type DocStage   = BaseStage | AddedStage;

export const docStages = pgTable('doc_stages', {
  id:                   id(),
  documentId:           text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  stage:                text('stage').$type<DocStage>().notNull(),
  order:                integer('sort_order').notNull().default(0),
  planSubmitDate:       text('plan_submit_date'),
  submitted:            boolean('submitted').notNull().default(false),
  submittedAt:          text('submitted_at'),
  submitTransmittalId:  text('submit_transmittal_id').references(() => transmittals.id),
  returnedAt:           text('returned_at'),
  returnTransmittalId:  text('return_transmittal_id').references(() => transmittals.id),
  returnCode:           text('return_code'),
}, (t) => [uniqueIndex('doc_stages_doc_stage_idx').on(t.documentId, t.stage)]);

export const docStageWeights = pgTable('doc_stage_weights', {
  id:        id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register:  text('register').$type<RegisterKind>().notNull().default('edl'),
  stage:     text('stage').$type<DocStage>().notNull(),
  weight:    doublePrecision('weight').notNull(),
  order:     integer('sort_order').notNull().default(0),
  label:     text('label'),
  fullName:  text('full_name'),
  color:     text('color'),
  revStart:  text('rev_start'),
}, (t) => [uniqueIndex('doc_stage_weights_project_stage_idx').on(t.projectId, t.register, t.stage)]);

export const docNumbering = pgTable('doc_numbering', {
  id:          id(),
  projectId:   text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register:    text('register').$type<RegisterKind>().notNull().default('edl'),
  prefix:      text('prefix').notNull(),
  disciplines: text('disciplines').notNull().default('{}'),
  types:       text('types').notNull().default('{}'),
  digits:      integer('digits').notNull().default(3),
  area:        text('area'),
  codes:       text('codes'),
}, (t) => [uniqueIndex('doc_numbering_project_idx').on(t.projectId, t.register)]);

export const transmittals = pgTable('transmittals', {
  id:        id(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  register:  text('register').$type<RegisterKind>().notNull().default('edl'),
  no:        text('no').notNull(),
  direction: text('direction').$type<'out' | 'in'>().notNull(),
  date:      text('date').notNull(),
  note:      text('note'),
}, (t) => [uniqueIndex('transmittals_project_no_dir_idx').on(t.projectId, t.register, t.no, t.direction)]);
