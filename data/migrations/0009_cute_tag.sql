CREATE TABLE `bar_styles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`condition` text NOT NULL,
	`condition_value` text,
	`paint` text DEFAULT 'unit' NOT NULL,
	`shape` text DEFAULT 'auto' NOT NULL,
	`hatched` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bar_styles_project_idx` ON `bar_styles` (`project_id`);