CREATE TABLE `base_stocks` (
	`id` text PRIMARY KEY NOT NULL,
	`family` text NOT NULL,
	`label` text NOT NULL,
	`session_id` text,
	`cooked_on` text NOT NULL,
	`fridge_days` integer NOT NULL,
	`cooked_g` real NOT NULL,
	`g` real NOT NULL,
	`at` text NOT NULL,
	`estimated` integer DEFAULT true NOT NULL,
	`weighed` integer DEFAULT false NOT NULL,
	`parts_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_base_stocks_family` ON `base_stocks` (`family`,`status`);--> statement-breakpoint
CREATE INDEX `idx_base_stocks_session` ON `base_stocks` (`session_id`);