DROP INDEX `doc_categories_project_idx`;--> statement-breakpoint
DROP INDEX `doc_categories_project_code_idx`;--> statement-breakpoint
ALTER TABLE `doc_categories` ADD `register` text DEFAULT 'edl' NOT NULL;--> statement-breakpoint
CREATE INDEX `doc_categories_project_idx` ON `doc_categories` (`project_id`,`register`);--> statement-breakpoint
CREATE UNIQUE INDEX `doc_categories_project_code_idx` ON `doc_categories` (`project_id`,`register`,`code`);--> statement-breakpoint
DROP INDEX `doc_stage_weights_project_stage_idx`;--> statement-breakpoint
ALTER TABLE `doc_stage_weights` ADD `register` text DEFAULT 'edl' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `doc_stage_weights_project_stage_idx` ON `doc_stage_weights` (`project_id`,`register`,`stage`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`register` text DEFAULT 'edl' NOT NULL,
	`category_id` text NOT NULL,
	`doc_no` text,
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
INSERT INTO `__new_documents`("id", "project_id", "register", "category_id", "doc_no", "existing_dwg_no", "revision", "title", "kind", "size", "sheets", "priority", "pic", "status", "remarks", "sort_order") SELECT "id", "project_id", 'edl', "category_id", "doc_no", "existing_dwg_no", "revision", "title", "kind", "size", "sheets", "priority", "pic", "status", "remarks", "sort_order" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_category_idx` ON `documents` (`category_id`);--> statement-breakpoint
CREATE INDEX `documents_project_register_idx` ON `documents` (`project_id`,`register`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_project_no_idx` ON `documents` (`project_id`,`register`,`doc_no`);--> statement-breakpoint
ALTER TABLE `wbs_nodes` ADD `linked_stage` text;