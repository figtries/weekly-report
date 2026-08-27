DROP INDEX `transmittals_project_no_dir_idx`;--> statement-breakpoint
ALTER TABLE `transmittals` ADD `register` text DEFAULT 'edl' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `transmittals_project_no_dir_idx` ON `transmittals` (`project_id`,`register`,`no`,`direction`);