-- ============================================================
-- FASE 3: Initial schema — PostgreSQL translation of lib/schema.ts
-- Run once against a fresh Supabase project.
-- ============================================================

-- ─── profiles (linked to Supabase auth.users) ──────────────────────────────
-- Keeps auth (Supabase) separate from app-level access metadata.
-- FASE 4 wires up per-area access; this gives every signed-in user a row.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text        not null default 'viewer',
  area_access jsonb      not null default '{}',
  created_at timestamptz not null default now()
);
comment on table profiles is 'Per-user access metadata, one row per auth.users row.';

-- ─── users (app-level user registry) ──────────────────────────────────────
create table if not exists users (
  id         text primary key,
  email      text not null,
  name       text not null,
  created_at text not null default now()::text
);
create unique index if not exists users_email_idx on users(email);

-- ─── projects ─────────────────────────────────────────────────────────────
create table if not exists projects (
  id                  text primary key,
  name                text not null,
  alias               text,
  client_name         text,
  contractor_name     text,
  contract_no         text,
  doc_no_prefix       text,
  contract_value      double precision,
  currency            text not null default 'IDR',
  weight_basis        text not null default 'boq',
  bar_preset          text,
  bar_view            text,
  field               text,
  start_date          text,
  finish_date         text,
  current_week        integer,
  created_at          text not null default now()::text,
  archived_at         text,
  updated_at          text,
  legacy_json_id      text,
  work_location       text,
  document_no_weekly  text,
  document_no_daily   text,
  signature_left      text,
  signature_right     text
);

-- ─── memberships ───────────────────────────────────────────────────────────
create table if not exists memberships (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id    text not null references users(id) on delete cascade,
  role       text not null,
  created_at text not null default now()::text
);
create unique index if not exists memberships_project_user_idx on memberships(project_id, user_id);

-- ─── app_state (singleton: which project is open) ─────────────────────────
create table if not exists app_state (
  id                text primary key default 'singleton',
  active_project_id text references projects(id) on delete set null,
  updated_at        text
);
insert into app_state (id) values ('singleton') on conflict do nothing;

-- ─── wbs_nodes ─────────────────────────────────────────────────────────────
create table if not exists wbs_nodes (
  id                  text primary key,
  project_id          text    not null references projects(id) on delete cascade,
  parent_id           text,
  wbs_code            text    not null,
  deskripsi           text    not null,
  sort_order          integer not null default 0,
  depth               integer not null default 0,
  is_leaf             boolean not null default false,
  is_milestone        boolean not null default false,
  is_reporting_unit   boolean not null default false,
  unit_label          text,
  unit_contract_no    text,
  unit_contract_value double precision,
  target_date         text,
  vol                 double precision,
  satuan              text,
  price               double precision,
  bobot               double precision,
  bobot_in_unit       double precision,
  workstep_factor     double precision,
  progress_method     text    not null default 'lumpsum',
  qty_total           double precision,
  linked_category_id  text,
  linked_stage        text,
  work_kind           text,
  work_part           text,
  bar_label           text,
  forecast_date       text,
  forecast_source     text,
  forecast_rung       text,
  forecast_week       integer,
  waits_for           text,
  created_at          text    not null default now()::text
);
create index        if not exists wbs_project_idx      on wbs_nodes(project_id);
create index        if not exists wbs_parent_idx       on wbs_nodes(parent_id);
create unique index if not exists wbs_project_code_idx on wbs_nodes(project_id, wbs_code);

-- ─── bar_styles ────────────────────────────────────────────────────────────
create table if not exists bar_styles (
  id              text    primary key,
  project_id      text    not null references projects(id) on delete cascade,
  sort_order      integer not null default 0,
  label           text    not null,
  condition       text    not null,
  condition_value text,
  paint           text    not null default 'unit',
  shape           text    not null default 'auto',
  hatched         boolean not null default false,
  enabled         boolean not null default true
);
create index if not exists bar_styles_project_idx on bar_styles(project_id);

-- ─── milestones ────────────────────────────────────────────────────────────
create table if not exists milestones (
  id         text             primary key,
  node_id    text             not null references wbs_nodes(id) on delete cascade,
  label      text             not null,
  weight     double precision not null,
  sort_order integer          not null default 0
);
create index if not exists milestones_node_idx on milestones(node_id);

-- ─── baselines ─────────────────────────────────────────────────────────────
create table if not exists baselines (
  id          text    primary key,
  project_id  text    not null references projects(id) on delete cascade,
  kind        text    not null,
  revision_no integer not null default 0,
  label       text,
  reason      text,
  approved_by text    references users(id),
  approved_at text,
  created_at  text    not null default now()::text
);
create index if not exists baselines_project_idx on baselines(project_id);

-- ─── node_schedules ────────────────────────────────────────────────────────
create table if not exists node_schedules (
  id            text    primary key,
  baseline_id   text    not null references baselines(id) on delete cascade,
  node_id       text    not null references wbs_nodes(id) on delete cascade,
  start_date    text    not null,
  finish_date   text    not null,
  duration_days integer not null
);
create unique index if not exists node_schedules_baseline_node_idx on node_schedules(baseline_id, node_id);

-- ─── weeks ─────────────────────────────────────────────────────────────────
create table if not exists weeks (
  id         text    primary key,
  project_id text    not null references projects(id) on delete cascade,
  week_no    integer not null,
  start_date text    not null,
  end_date   text    not null,
  status     text    not null default 'open',
  created_at text    not null default now()::text
);
create unique index if not exists weeks_project_no_idx on weeks(project_id, week_no);

-- ─── leaf_progress ─────────────────────────────────────────────────────────
create table if not exists leaf_progress (
  id              text             primary key,
  week_id         text             not null references weeks(id) on delete cascade,
  node_id         text             not null references wbs_nodes(id) on delete cascade,
  method          text             not null,
  cum_progress_pct double precision not null default 0,
  qty_done        double precision,
  note            text,
  source          text,
  recorded_by     text             references users(id),
  recorded_at     text
);
create unique index if not exists leaf_progress_week_node_idx on leaf_progress(week_id, node_id);

-- ─── milestone_progress ────────────────────────────────────────────────────
create table if not exists milestone_progress (
  id           text    primary key,
  week_id      text    not null references weeks(id) on delete cascade,
  milestone_id text    not null references milestones(id) on delete cascade,
  achieved     boolean not null default false,
  recorded_by  text    references users(id),
  recorded_at  text
);
create unique index if not exists milestone_progress_week_ms_idx on milestone_progress(week_id, milestone_id);

-- ─── approvals ─────────────────────────────────────────────────────────────
create table if not exists approvals (
  id                   text             primary key,
  week_id              text             not null references weeks(id) on delete cascade,
  approved_by          text             not null references users(id),
  approved_at          text             not null,
  snapshot_actual_pct  double precision not null,
  snapshot_plan_pct    double precision not null,
  signer_name          text             not null,
  signer_title         text,
  signer_company       text,
  note                 text
);
create index if not exists approvals_week_idx on approvals(week_id);

-- ─── audit_log ─────────────────────────────────────────────────────────────
create table if not exists audit_log (
  id          text primary key,
  project_id  text not null references projects(id) on delete cascade,
  user_id     text references users(id),
  entity_type text not null,
  entity_id   text not null,
  field       text,
  old_value   text,
  new_value   text,
  at          text not null default now()::text
);
create index if not exists audit_project_at_idx on audit_log(project_id, at);
create index if not exists audit_entity_idx     on audit_log(entity_type, entity_id);

-- ─── transmittals (defined before doc_stages which references it) ───────────
create table if not exists transmittals (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  register   text not null default 'edl',
  no         text not null,
  direction  text not null,
  date       text not null,
  note       text
);
create unique index if not exists transmittals_project_no_dir_idx on transmittals(project_id, register, no, direction);

-- ─── doc_categories ────────────────────────────────────────────────────────
create table if not exists doc_categories (
  id            text    primary key,
  project_id    text    not null references projects(id) on delete cascade,
  register      text    not null default 'edl',
  parent_id     text,
  code          text    not null,
  name          text    not null,
  sort_order    integer not null default 0,
  planned_count integer
);
create index        if not exists doc_categories_project_idx      on doc_categories(project_id, register);
create unique index if not exists doc_categories_project_code_idx on doc_categories(project_id, register, code);

-- ─── documents ─────────────────────────────────────────────────────────────
create table if not exists documents (
  id             text    primary key,
  project_id     text    not null references projects(id) on delete cascade,
  register       text    not null default 'edl',
  category_id    text    not null references doc_categories(id) on delete cascade,
  doc_no         text,
  existing_dwg_no text,
  revision       text,
  title          text    not null,
  kind           text,
  size           text,
  sheets         integer,
  priority       text,
  pic            text,
  status         text,
  remarks        text,
  sort_order     integer not null default 0
);
create index if not exists documents_category_idx         on documents(category_id);
create index if not exists documents_project_register_idx on documents(project_id, register);

-- ─── doc_stages ────────────────────────────────────────────────────────────
create table if not exists doc_stages (
  id                     text    primary key,
  document_id            text    not null references documents(id) on delete cascade,
  stage                  text    not null,
  sort_order             integer not null default 0,
  plan_submit_date       text,
  submitted              boolean not null default false,
  submitted_at           text,
  submit_transmittal_id  text    references transmittals(id),
  returned_at            text,
  return_transmittal_id  text    references transmittals(id),
  return_code            text
);
create unique index if not exists doc_stages_doc_stage_idx on doc_stages(document_id, stage);

-- ─── doc_stage_weights ─────────────────────────────────────────────────────
create table if not exists doc_stage_weights (
  id         text             primary key,
  project_id text             not null references projects(id) on delete cascade,
  register   text             not null default 'edl',
  stage      text             not null,
  weight     double precision not null,
  sort_order integer          not null default 0,
  label      text,
  full_name  text,
  color      text,
  rev_start  text
);
create unique index if not exists doc_stage_weights_project_stage_idx on doc_stage_weights(project_id, register, stage);

-- ─── doc_numbering ─────────────────────────────────────────────────────────
create table if not exists doc_numbering (
  id          text    primary key,
  project_id  text    not null references projects(id) on delete cascade,
  register    text    not null default 'edl',
  prefix      text    not null,
  disciplines text    not null default '{}',
  types       text    not null default '{}',
  digits      integer not null default 3,
  area        text,
  codes       text
);
create unique index if not exists doc_numbering_project_idx on doc_numbering(project_id, register);
