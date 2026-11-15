-- ============================================================
-- Lucille — Schema fixes
-- Generated from audit: 2026-11-15
--
-- EXECUTION ORDER:
--   1. SAFE block   — non-breaking, run first
--   2. MODERATE block — verify empty tables first
--
-- DO NOT run SKIP block yet — those require code changes too.
-- ============================================================


-- ============================================================
-- SAFE: Non-breaking fixes (no data loss, no code changes needed)
-- ============================================================

-- FIX 1: app_state singleton row missing from setup.sql
-- (Already in 001_initial.sql; run this if you used setup.sql to init)
INSERT INTO app_state (id) VALUES ('singleton') ON CONFLICT DO NOTHING;


-- FIX 2: Nullable FK columns → ON DELETE set null
-- These all have nullable columns with ON DELETE no action, which blocks
-- user deletion even when the value could just be nulled out.

ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_user_id_users_id_fk,
  ADD CONSTRAINT audit_log_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE baselines
  DROP CONSTRAINT IF EXISTS baselines_approved_by_users_id_fk,
  ADD CONSTRAINT baselines_approved_by_users_id_fk
    FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE leaf_progress
  DROP CONSTRAINT IF EXISTS leaf_progress_recorded_by_users_id_fk,
  ADD CONSTRAINT leaf_progress_recorded_by_users_id_fk
    FOREIGN KEY (recorded_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE milestone_progress
  DROP CONSTRAINT IF EXISTS milestone_progress_recorded_by_users_id_fk,
  ADD CONSTRAINT milestone_progress_recorded_by_users_id_fk
    FOREIGN KEY (recorded_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;


-- FIX 3: doc_stages transmittal FKs → ON DELETE set null
-- Prevents transmittal deletion when doc_stages still reference it.

ALTER TABLE doc_stages
  DROP CONSTRAINT IF EXISTS doc_stages_submit_transmittal_id_transmittals_id_fk,
  ADD CONSTRAINT doc_stages_submit_transmittal_id_transmittals_id_fk
    FOREIGN KEY (submit_transmittal_id) REFERENCES transmittals(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE doc_stages
  DROP CONSTRAINT IF EXISTS doc_stages_return_transmittal_id_transmittals_id_fk,
  ADD CONSTRAINT doc_stages_return_transmittal_id_transmittals_id_fk
    FOREIGN KEY (return_transmittal_id) REFERENCES transmittals(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;


-- FIX 4: wbs_nodes.linked_category_id — add missing FK
-- The "tertaut" progress method depends on this link being valid.
-- ON DELETE SET NULL: if the doc category is deleted, the linked method
-- silently loses its target — code must handle null linked_category_id.

ALTER TABLE wbs_nodes
  ADD CONSTRAINT wbs_nodes_linked_category_id_doc_categories_id_fk
    FOREIGN KEY (linked_category_id) REFERENCES doc_categories(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;


-- FIX 5: Self-referential parent_id FKs (tree integrity)
-- wbs_nodes.parent_id and doc_categories.parent_id have no FK,
-- so orphaned nodes are possible. ON DELETE SET NULL is safer than
-- CASCADE here (CASCADE would recursively delete the entire subtree,
-- which is usually not what you want when removing a single node).

ALTER TABLE wbs_nodes
  ADD CONSTRAINT wbs_nodes_parent_id_wbs_nodes_id_fk
    FOREIGN KEY (parent_id) REFERENCES wbs_nodes(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE doc_categories
  ADD CONSTRAINT doc_categories_parent_id_doc_categories_id_fk
    FOREIGN KEY (parent_id) REFERENCES doc_categories(id)
    ON DELETE SET NULL ON UPDATE NO ACTION;


-- FIX 6: profiles ↔ users bridge column
-- Add a nullable column in profiles pointing to the app-level users row.
-- Nullable because: (a) a fresh Supabase signup has no users row yet,
-- (b) this lets existing profiles keep working without a data migration.
-- FASE 4 wires this up when creating/inviting a user.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS users_id text REFERENCES users(id) ON DELETE SET NULL;


-- ============================================================
-- MODERATE: Check tables are empty before running
-- (These tables have NOT NULL constraints or structural changes)
-- ============================================================

-- FIX 7: approvals.approved_by — make nullable so we can set ON DELETE SET NULL
--
-- BEFORE RUNNING: verify no existing approvals that would become orphaned:
--   SELECT count(*) FROM approvals;  -- should be 0 on a fresh setup
--
-- If there ARE rows: approved_by is a snapshot of who signed — keeping the
-- users row is correct. Skip this fix and instead ensure the users row is
-- never deleted while approvals reference it (handle in app logic).

-- ALTER TABLE approvals
--   ALTER COLUMN approved_by DROP NOT NULL;
--
-- ALTER TABLE approvals
--   DROP CONSTRAINT IF EXISTS approvals_approved_by_users_id_fk,
--   ADD CONSTRAINT approvals_approved_by_users_id_fk
--     FOREIGN KEY (approved_by) REFERENCES users(id)
--     ON DELETE SET NULL ON UPDATE NO ACTION;


-- ============================================================
-- SKIP: Too invasive — requires code changes first
-- ============================================================

-- NOT DOING: Drop bar_styles table
-- Reason: table might have data; also drizzle schema.ts still declares it.
-- To do it properly: (1) remove barStyles from schema.ts, (2) generate
-- migration with drizzle-kit, (3) run migration.
-- For now just leave it empty.

-- NOT DOING: Change text timestamps to timestamptz
-- Reason: all code builds/compares ISO strings via now()::text. Changing
-- to timestamptz would require updating every query that reads/writes dates.
-- Revisit in FASE 4 cleanup.

-- NOT DOING: Change JSON-in-text columns to jsonb (waits_for, bar_view, etc.)
-- Reason: would need to cast all existing data, and all app code uses
-- JSON.stringify/parse. Safe to migrate later with:
--   ALTER TABLE wbs_nodes ALTER COLUMN waits_for TYPE jsonb
--     USING waits_for::jsonb;
-- But only after verifying all stored values are valid JSON.

-- NOT DOING: Change users.id to uuid
-- Reason: all app code generates text IDs (nanoid). Massive breaking change.
-- The SQLite-to-PostgreSQL translation deliberately kept text IDs.
