CREATE TABLE `recipe_creations` (
	`id` text PRIMARY KEY NOT NULL,
	`envie` text NOT NULL,
	`envie_key` text NOT NULL,
	`research` text,
	`proposals` text DEFAULT '[]' NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_creations_key` ON `recipe_creations` (`envie_key`);--> statement-breakpoint
CREATE INDEX `idx_recipe_creations_updated` ON `recipe_creations` (`updated_at`);