CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`actions` text,
	`page` text,
	`model` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_assistant_person` ON `assistant_messages` (`person_id`,`created_at`);