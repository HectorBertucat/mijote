CREATE TABLE `adjust_proposals` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`proposal` text NOT NULL,
	`exchanges` text DEFAULT '[]' NOT NULL,
	`recipe_updated_at` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`screen` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `idx_ai_calls_at` ON `ai_calls` (`at`);--> statement-breakpoint
CREATE INDEX `idx_ai_calls_screen` ON `ai_calls` (`screen`,`at`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`proposal` text,
	`notes` text,
	`suggestions` text,
	`status` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_coach_person` ON `coach_messages` (`person_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`payload_json` text,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cook_events_session` ON `cook_events` (`session_id`,`at`);--> statement-breakpoint
CREATE TABLE `cook_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text,
	`started_at` text,
	`ended_at` text,
	`plan_json` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`mode` text DEFAULT 'solo' NOT NULL,
	`shopping_list_id` text,
	`test` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shopping_list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cook_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`recipe_id` text NOT NULL,
	`lot_id` text,
	`grams` real NOT NULL,
	`cooked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`value` real,
	`item` text,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `pantry_lots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cook_usages_recipe` ON `cook_usages` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `day_logs` (
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`person_id`, `date`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `duration_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`ref` text NOT NULL,
	`label` text NOT NULL,
	`grams` real,
	`units` real,
	`est_min` real NOT NULL,
	`planned_min` real NOT NULL,
	`real_min` real NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`via` text,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_duration_samples_key` ON `duration_samples` (`key`);--> statement-breakpoint
CREATE INDEX `idx_duration_samples_session` ON `duration_samples` (`session_id`);--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`dims_json` text,
	`capacity_l` real,
	`max_batch_g` integer,
	`count` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`owned` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equipment_fit` (
	`equipment_id` text NOT NULL,
	`hob_id` text NOT NULL,
	`preferred` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`equipment_id`, `hob_id`),
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hob_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_art` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`svg` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_log` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`kind` text NOT NULL,
	`recipe_id` text,
	`template_id` text,
	`units` real,
	`label` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real,
	`carbs_g` real,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_food_log_person_date` ON `food_log` (`person_id`,`date`);--> statement-breakpoint
CREATE TABLE `food_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`label` text NOT NULL,
	`meal` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real,
	`carbs_g` real,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `health_links` (
	`person_id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_sync_at` text,
	`last_month_at` text,
	`last_history_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_links_key_unique` ON `health_links` (`key`);--> statement-breakpoint
CREATE TABLE `health_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`meta` text,
	`external_id` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_health_sample` ON `health_samples` (`person_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_health_samples_person` ON `health_samples` (`person_id`,`kind`,`start`);--> statement-breakpoint
CREATE TABLE `ingredient_products` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`label` text NOT NULL,
	`food_id` text,
	`product_id` text NOT NULL,
	`status` text NOT NULL,
	`preferred` integer DEFAULT false NOT NULL,
	`product_json` text,
	`decided_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ingredient_product` ON `ingredient_products` (`key`,`scope`,`product_id`);--> statement-breakpoint
CREATE INDEX `idx_ingredient_products_key` ON `ingredient_products` (`key`);--> statement-breakpoint
CREATE TABLE `meal_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text NOT NULL,
	`day` integer NOT NULL,
	`meal` text NOT NULL,
	`person_id` text NOT NULL,
	`place` text NOT NULL,
	`recipe_id` text,
	`units` real,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_meal_slot` ON `meal_slots` (`week_plan_id`,`day`,`meal`,`person_id`);--> statement-breakpoint
CREATE TABLE `pantry_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text,
	`item` text NOT NULL,
	`grams_left` real NOT NULL,
	`value_left` real NOT NULL,
	`opened_at` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`grams_initial` real,
	`value_initial` real,
	`closed_at` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`portion_units` integer NOT NULL,
	`notes` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`sex` text,
	`birth_date` text,
	`height_cm` real,
	`activity` text,
	`goal` text,
	`rate_pct` real,
	`protein_g_per_kg` real,
	`protein_g` real,
	`target_weight_kg` real,
	`target_date` text,
	`sport_plan` text,
	`constraints` text,
	`outside_kcal` real,
	`outside_protein_g` real,
	`setup_done_at` text
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text,
	`chrono_product_id` text,
	`name` text NOT NULL,
	`bought_at` text NOT NULL,
	`packs` integer DEFAULT 1 NOT NULL,
	`pack_g` real,
	`price_paid` real NOT NULL,
	`promo` integer DEFAULT false NOT NULL,
	`shopping_item_id` text,
	`item` text,
	`price_estimated` real,
	`chrono_order_id` text,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shopping_item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`line_raw` text NOT NULL,
	`item` text NOT NULL,
	`grams` real,
	`units` real,
	`group` text,
	`optional` integer DEFAULT false NOT NULL,
	`pantry` integer DEFAULT false NOT NULL,
	`food_id` text,
	`yield` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_ingredients_recipe` ON `recipe_ingredients` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`person_id` text,
	`category` text NOT NULL,
	`text` text NOT NULL,
	`rating` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_notes_recipe` ON `recipe_notes` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`order` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`duration_min` real,
	`active_min` real,
	`equipment_kind` text,
	`equipment_id` text,
	`equipment_alt` text,
	`hob_level` integer,
	`oven_temp` integer,
	`bowl_refs` text DEFAULT '[]' NOT NULL,
	`cue` text,
	`phases` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_recipe_steps_recipe` ON `recipe_steps` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`servings_units` integer NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`fridge_days` integer,
	`freezer_ok` integer DEFAULT false NOT NULL,
	`kcal_unit` real,
	`protein_unit` real,
	`carbs_unit` real,
	`fat_unit` real,
	`fiber_unit` real,
	`nutrition_coverage` real,
	`fixture_hash` text,
	`status` text DEFAULT 'to_try' NOT NULL,
	`source` text,
	`tips` text,
	`parent_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_slug_unique` ON `recipes` (`slug`);--> statement-breakpoint
CREATE TABLE `shopping_item_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`recipe_ingredient_id` text,
	`recipe_id` text NOT NULL,
	`line_raw` text NOT NULL,
	`grams` real,
	`units` real,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_item_sources_item` ON `shopping_item_sources` (`item_id`);--> statement-breakpoint
CREATE INDEX `idx_item_sources_recipe` ON `shopping_item_sources` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`item` text NOT NULL,
	`need_g` real,
	`recipe_ids` text DEFAULT '[]' NOT NULL,
	`chrono_product_id` text,
	`packs` integer,
	`unit_price` real,
	`checked_at` text,
	`availability_json` text,
	`state` text,
	`aisle` text,
	`line` text,
	`product_json` text,
	`alternatives_json` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	`total_price` real,
	`pantry` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`in_cart_at` text,
	`live_request_id` text,
	`live_status` text,
	`live_asked_at` text,
	`assoc_key` text,
	`assoc_scope` text,
	`chrono_id` text,
	`drive_outcome` text,
	`drive_qty` integer,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_shopping_items_list` ON `shopping_items` (`list_id`);--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text,
	`recipe_slugs` text DEFAULT '[]' NOT NULL,
	`build_done` integer,
	`build_total` integer,
	`build_error` text,
	`ordered_at` text,
	`recipe_scales` text DEFAULT '{}' NOT NULL,
	`recipe_extras` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`drive_job_id` text,
	`drive_status` text,
	`drive_at` text,
	`drive_error` text,
	`drive_summary` text,
	`order_job_id` text,
	`order_status` text,
	`order_error` text,
	`chrono_order_id` text,
	`order_imported_at` text,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`label` text NOT NULL,
	`step_ref` text,
	`ends_at` text NOT NULL,
	`done_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `cook_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `training_live` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`workout_id` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_training_live_person` ON `training_live` (`person_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `training_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`program` text NOT NULL,
	`source` text NOT NULL,
	`request` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_training_programs_person` ON `training_programs` (`person_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `waist_measures` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`cm` real NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_waist_person_date` ON `waist_measures` (`person_id`,`date`);--> statement-breakpoint
CREATE TABLE `week_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_plans_week_start_unique` ON `week_plans` (`week_start`);--> statement-breakpoint
CREATE TABLE `week_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`factor` real DEFAULT 1 NOT NULL,
	`extras` text DEFAULT '{}' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_week_recipe` ON `week_recipes` (`week_plan_id`,`recipe_id`);--> statement-breakpoint
CREATE TABLE `weekly_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`week_start` text NOT NULL,
	`tdee_kcal` real NOT NULL,
	`kcal_target` real NOT NULL,
	`protein_g` real NOT NULL,
	`fat_min_g` real NOT NULL,
	`confidence` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weekly_target` ON `weekly_targets` (`person_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `weigh_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`measured_at` text NOT NULL,
	`kg` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`external_id` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_weigh_ins_person_date` ON `weigh_ins` (`person_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_weigh_in_external` ON `weigh_ins` (`person_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`ts` integer NOT NULL,
	`type` text NOT NULL,
	`minutes` integer,
	`note` text,
	`entries` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_workouts_person` ON `workouts` (`person_id`,`ts`);