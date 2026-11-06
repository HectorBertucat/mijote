CREATE TABLE `reserve_servings` (
	`id` text PRIMARY KEY NOT NULL,
	`reserve_id` text NOT NULL,
	`person_id` text NOT NULL,
	`at` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`source` text NOT NULL,
	`box_id` text,
	`grams` text DEFAULT '{}' NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`food_log_id` text,
	FOREIGN KEY (`reserve_id`) REFERENCES `reserves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `meal_boxes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_reserve_servings_reserve` ON `reserve_servings` (`reserve_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_reserve_servings_person` ON `reserve_servings` (`person_id`,`at`);--> statement-breakpoint
CREATE INDEX `idx_reserve_servings_log` ON `reserve_servings` (`food_log_id`);--> statement-breakpoint
CREATE TABLE `reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`recipe_id` text,
	`name` text NOT NULL,
	`cooked_on` text NOT NULL,
	`fridge_days` integer NOT NULL,
	`freezer_ok` integer DEFAULT false NOT NULL,
	`cooked_units` real,
	`kcal_unit` real,
	`protein_unit` real,
	`groups` text DEFAULT '[]' NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_reserves_status` ON `reserves` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reserves_session` ON `reserves` (`session_id`,`recipe_id`);--> statement-breakpoint
ALTER TABLE `meal_boxes` ADD `reserve_id` text REFERENCES reserves(id);--> statement-breakpoint
ALTER TABLE `meal_boxes` ADD `portion_json` text;--> statement-breakpoint
ALTER TABLE `recipes` ADD `serve_json` text;