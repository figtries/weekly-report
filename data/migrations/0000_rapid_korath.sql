CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`week_id` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text NOT NULL,
	`snapshot_actual_pct` real NOT NULL,
	`snapshot_plan_pct` real NOT NULL,
	`signer_name` text NOT NULL,
	`signer_title` text,
	`signer_company` text,
	`note` text,
	FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approvals_week_idx` ON `approvals` (`week_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text,
	`old_value` text,
	`new_value` text,
	`at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_project_at_idx` ON `audit_log` (`project_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision_no` integer DEFAULT 0 NOT NULL,
	`label` text,
	`reason` text,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `baselines_project_idx` ON `baselines` (`project_id`);--> statement-breakpoint
CREATE TABLE `doc_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`planned_count` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_categories_project_idx` ON `doc_categories` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `doc_categories_project_code_idx` ON `doc_categories` (`project_id`,`code`);--> statement-breakpoint
CREATE TABLE `doc_stage_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`weight` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_stage_weights_project_stage_idx` ON `doc_stage_weights` (`project_id`,`stage`);--> statement-breakpoint
CREATE TABLE `doc_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`stage` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`plan_submit_date` text,
	`submitted_at` text,
	`submit_transmittal_id` text,
	`returned_at` text,
	`return_transmittal_id` text,
	`return_code` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submit_transmittal_id`) REFERENCES `transmittals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`return_transmittal_id`) REFERENCES `transmittals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_stages_doc_stage_idx` ON `doc_stages` (`document_id`,`stage`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`existing_dwg_no` text,
	`revision` text,
	`title` text NOT NULL,
	`kind` text,
	`size` text,
	`sheets` integer,
	`priority` text,
	`pic` text,
	`status` text,
	`remarks` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `doc_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `documents_category_idx` ON `documents` (`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_project_no_idx` ON `documents` (`project_id`,`doc_no`);--> statement-breakpoint
CREATE TABLE `leaf_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`week_id` text NOT NULL,
	`node_id` text NOT NULL,
	`method` text NOT NULL,
	`cum_progress_pct` real DEFAULT 0 NOT NULL,
	`qty_done` real,
	`note` text,
	`recorded_by` text,
	`recorded_at` text,
	FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `wbs_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaf_progress_week_node_idx` ON `leaf_progress` (`week_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_project_user_idx` ON `memberships` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `milestone_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`week_id` text NOT NULL,
	`milestone_id` text NOT NULL,
	`achieved` integer DEFAULT false NOT NULL,
	`recorded_by` text,
	`recorded_at` text,
	FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestone_progress_week_ms_idx` ON `milestone_progress` (`week_id`,`milestone_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`label` text NOT NULL,
	`weight` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `wbs_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestones_node_idx` ON `milestones` (`node_id`);--> statement-breakpoint
CREATE TABLE `node_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`baseline_id` text NOT NULL,
	`node_id` text NOT NULL,
	`start_date` text NOT NULL,
	`finish_date` text NOT NULL,
	`duration_days` integer NOT NULL,
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `wbs_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_schedules_baseline_node_idx` ON `node_schedules` (`baseline_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client_name` text,
	`contractor_name` text,
	`contract_no` text,
	`doc_no_prefix` text,
	`contract_value` real,
	`currency` text DEFAULT 'IDR' NOT NULL,
	`weight_basis` text DEFAULT 'boq' NOT NULL,
	`start_date` text,
	`finish_date` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE TABLE `transmittals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`no` text NOT NULL,
	`direction` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transmittals_project_no_dir_idx` ON `transmittals` (`project_id`,`no`,`direction`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wbs_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`wbs_code` text NOT NULL,
	`deskripsi` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`is_leaf` integer DEFAULT false NOT NULL,
	`is_reporting_unit` integer DEFAULT false NOT NULL,
	`unit_label` text,
	`unit_contract_no` text,
	`unit_contract_value` real,
	`vol` real,
	`satuan` text,
	`price` real,
	`bobot` real,
	`bobot_in_unit` real,
	`workstep_factor` real,
	`progress_method` text DEFAULT 'lumpsum' NOT NULL,
	`qty_total` real,
	`linked_category_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wbs_project_idx` ON `wbs_nodes` (`project_id`);--> statement-breakpoint
CREATE INDEX `wbs_parent_idx` ON `wbs_nodes` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wbs_project_code_idx` ON `wbs_nodes` (`project_id`,`wbs_code`);--> statement-breakpoint
CREATE TABLE `weeks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`week_no` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weeks_project_no_idx` ON `weeks` (`project_id`,`week_no`);