CREATE TABLE `doc_numbering` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`register` text DEFAULT 'edl' NOT NULL,
	`prefix` text NOT NULL,
	`disciplines` text DEFAULT '{}' NOT NULL,
	`types` text DEFAULT '{}' NOT NULL,
	`digits` integer DEFAULT 3 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `doc_numbering_project_idx` ON `doc_numbering` (`project_id`,`register`);