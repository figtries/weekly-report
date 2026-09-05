CREATE TABLE `app_state` (
	`id` text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	`active_project_id` text,
	`updated_at` text,
	FOREIGN KEY (`active_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `legacy_json_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `work_location` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `document_no_weekly` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `document_no_daily` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `signature_left` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `signature_right` text;--> statement-breakpoint
ALTER TABLE `wbs_nodes` ADD `is_milestone` integer DEFAULT false NOT NULL;