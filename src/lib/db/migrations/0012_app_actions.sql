CREATE TABLE `app_actions` (
	`person_id` text NOT NULL,
	`action_id` text NOT NULL,
	`route` text NOT NULL,
	`at` integer NOT NULL,
	`reply` text NOT NULL,
	PRIMARY KEY(`person_id`, `action_id`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_app_actions_at` ON `app_actions` (`at`);