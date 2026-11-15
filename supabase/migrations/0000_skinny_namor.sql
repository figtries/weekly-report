CREATE TABLE "app_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"active_project_id" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"week_id" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" text NOT NULL,
	"snapshot_actual_pct" double precision NOT NULL,
	"snapshot_plan_pct" double precision NOT NULL,
	"signer_name" text NOT NULL,
	"signer_title" text,
	"signer_company" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bar_styles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"condition" text NOT NULL,
	"condition_value" text,
	"paint" text DEFAULT 'unit' NOT NULL,
	"shape" text DEFAULT 'auto' NOT NULL,
	"hatched" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision_no" integer DEFAULT 0 NOT NULL,
	"label" text,
	"reason" text,
	"approved_by" text,
	"approved_at" text,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"register" text DEFAULT 'edl' NOT NULL,
	"parent_id" text,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"planned_count" integer
);
--> statement-breakpoint
CREATE TABLE "doc_numbering" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"register" text DEFAULT 'edl' NOT NULL,
	"prefix" text NOT NULL,
	"disciplines" text DEFAULT '{}' NOT NULL,
	"types" text DEFAULT '{}' NOT NULL,
	"digits" integer DEFAULT 3 NOT NULL,
	"area" text,
	"codes" text
);
--> statement-breakpoint
CREATE TABLE "doc_stage_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"register" text DEFAULT 'edl' NOT NULL,
	"stage" text NOT NULL,
	"weight" double precision NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"label" text,
	"full_name" text,
	"color" text,
	"rev_start" text
);
--> statement-breakpoint
CREATE TABLE "doc_stages" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"stage" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"plan_submit_date" text,
	"submitted" boolean DEFAULT false NOT NULL,
	"submitted_at" text,
	"submit_transmittal_id" text,
	"returned_at" text,
	"return_transmittal_id" text,
	"return_code" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"register" text DEFAULT 'edl' NOT NULL,
	"category_id" text NOT NULL,
	"doc_no" text,
	"existing_dwg_no" text,
	"revision" text,
	"title" text NOT NULL,
	"kind" text,
	"size" text,
	"sheets" integer,
	"priority" text,
	"pic" text,
	"status" text,
	"remarks" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaf_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"week_id" text NOT NULL,
	"node_id" text NOT NULL,
	"method" text NOT NULL,
	"cum_progress_pct" double precision DEFAULT 0 NOT NULL,
	"qty_done" double precision,
	"note" text,
	"source" text,
	"recorded_by" text,
	"recorded_at" text
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestone_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"week_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"achieved" boolean DEFAULT false NOT NULL,
	"recorded_by" text,
	"recorded_at" text
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"label" text NOT NULL,
	"weight" double precision NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"baseline_id" text NOT NULL,
	"node_id" text NOT NULL,
	"start_date" text NOT NULL,
	"finish_date" text NOT NULL,
	"duration_days" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"alias" text,
	"client_name" text,
	"contractor_name" text,
	"contract_no" text,
	"doc_no_prefix" text,
	"contract_value" double precision,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"weight_basis" text DEFAULT 'boq' NOT NULL,
	"bar_preset" text,
	"bar_view" text,
	"field" text,
	"start_date" text,
	"finish_date" text,
	"current_week" integer,
	"created_at" text DEFAULT now()::text NOT NULL,
	"archived_at" text,
	"updated_at" text,
	"legacy_json_id" text,
	"work_location" text,
	"document_no_weekly" text,
	"document_no_daily" text,
	"signature_left" text,
	"signature_right" text
);
--> statement-breakpoint
CREATE TABLE "transmittals" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"register" text DEFAULT 'edl' NOT NULL,
	"no" text NOT NULL,
	"direction" text NOT NULL,
	"date" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wbs_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"wbs_code" text NOT NULL,
	"deskripsi" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"is_leaf" boolean DEFAULT false NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"is_reporting_unit" boolean DEFAULT false NOT NULL,
	"unit_label" text,
	"unit_contract_no" text,
	"unit_contract_value" double precision,
	"target_date" text,
	"vol" double precision,
	"satuan" text,
	"price" double precision,
	"bobot" double precision,
	"bobot_in_unit" double precision,
	"workstep_factor" double precision,
	"progress_method" text DEFAULT 'lumpsum' NOT NULL,
	"qty_total" double precision,
	"linked_category_id" text,
	"linked_stage" text,
	"work_kind" text,
	"work_part" text,
	"bar_label" text,
	"forecast_date" text,
	"forecast_source" text,
	"forecast_rung" text,
	"forecast_week" integer,
	"waits_for" text,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"week_no" integer NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_state" ADD CONSTRAINT "app_state_active_project_id_projects_id_fk" FOREIGN KEY ("active_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bar_styles" ADD CONSTRAINT "bar_styles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_categories" ADD CONSTRAINT "doc_categories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_numbering" ADD CONSTRAINT "doc_numbering_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stage_weights" ADD CONSTRAINT "doc_stage_weights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stages" ADD CONSTRAINT "doc_stages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stages" ADD CONSTRAINT "doc_stages_submit_transmittal_id_transmittals_id_fk" FOREIGN KEY ("submit_transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_stages" ADD CONSTRAINT "doc_stages_return_transmittal_id_transmittals_id_fk" FOREIGN KEY ("return_transmittal_id") REFERENCES "public"."transmittals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_doc_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."doc_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_progress" ADD CONSTRAINT "leaf_progress_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_progress" ADD CONSTRAINT "leaf_progress_node_id_wbs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_progress" ADD CONSTRAINT "leaf_progress_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_node_id_wbs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_schedules" ADD CONSTRAINT "node_schedules_baseline_id_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_schedules" ADD CONSTRAINT "node_schedules_node_id_wbs_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."wbs_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transmittals" ADD CONSTRAINT "transmittals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wbs_nodes" ADD CONSTRAINT "wbs_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_week_idx" ON "approvals" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "audit_project_at_idx" ON "audit_log" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "bar_styles_project_idx" ON "bar_styles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "baselines_project_idx" ON "baselines" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "doc_categories_project_idx" ON "doc_categories" USING btree ("project_id","register");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_categories_project_code_idx" ON "doc_categories" USING btree ("project_id","register","code");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_numbering_project_idx" ON "doc_numbering" USING btree ("project_id","register");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_stage_weights_project_stage_idx" ON "doc_stage_weights" USING btree ("project_id","register","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_stages_doc_stage_idx" ON "doc_stages" USING btree ("document_id","stage");--> statement-breakpoint
CREATE INDEX "documents_category_idx" ON "documents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "documents_project_register_idx" ON "documents" USING btree ("project_id","register");--> statement-breakpoint
CREATE UNIQUE INDEX "leaf_progress_week_node_idx" ON "leaf_progress" USING btree ("week_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_project_user_idx" ON "memberships" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_progress_week_ms_idx" ON "milestone_progress" USING btree ("week_id","milestone_id");--> statement-breakpoint
CREATE INDEX "milestones_node_idx" ON "milestones" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "node_schedules_baseline_node_idx" ON "node_schedules" USING btree ("baseline_id","node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transmittals_project_no_dir_idx" ON "transmittals" USING btree ("project_id","register","no","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "wbs_project_idx" ON "wbs_nodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "wbs_parent_idx" ON "wbs_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wbs_project_code_idx" ON "wbs_nodes" USING btree ("project_id","wbs_code");--> statement-breakpoint
CREATE UNIQUE INDEX "weeks_project_no_idx" ON "weeks" USING btree ("project_id","week_no");