DROP INDEX `documents_project_no_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_project_no_idx` ON `documents` (`project_id`,`register`,`doc_no`) WHERE "documents"."register" = 'edl';