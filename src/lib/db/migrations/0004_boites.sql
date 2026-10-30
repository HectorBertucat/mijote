CREATE TABLE `meal_boxes` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`recipe_id` text,
	`name` text NOT NULL,
	`person_id` text,
	`grams` real,
	`side_grams` real,
	`side_label` text,
	`kcal` real,
	`protein_g` real,
	`cooked_on` text NOT NULL,
	`planned_for` text,
	`planned_meal` text,
	`place` text NOT NULL,
	`fridge_days` integer NOT NULL,
	`frozen_on` text,
	`thawed_on` text,
	`status` text DEFAULT 'stock' NOT NULL,
	`closed_at` text,
	`eaten_by` text,
	`food_log_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`eaten_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_meal_boxes_status` ON `meal_boxes` (`status`,`place`);--> statement-breakpoint
CREATE INDEX `idx_meal_boxes_session` ON `meal_boxes` (`session_id`,`recipe_id`);--> statement-breakpoint
ALTER TABLE `recipe_ingredients` ADD `side` integer DEFAULT false NOT NULL;