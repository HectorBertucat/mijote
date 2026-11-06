CREATE TABLE `recipe_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`from_food` text,
	`to_food` text NOT NULL,
	`session_id` text,
	`reserve_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reserve_id`) REFERENCES `reserves`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_swaps_recipe` ON `recipe_swaps` (`recipe_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `taste_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`person_id` text NOT NULL,
	`rating` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`note` text,
	`serving_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serving_id`) REFERENCES `reserve_servings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_taste_feedback_recipe` ON `taste_feedback` (`recipe_id`,`person_id`,`created_at`);