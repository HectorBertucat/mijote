CREATE TABLE `run_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`effort` integer,
	`pain` integer,
	`pain_where` text,
	`sick` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_run_feedback_day` ON `run_feedback` (`person_id`,`date`);--> statement-breakpoint
CREATE TABLE `run_profiles` (
	`person_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`started_on` text,
	`days` text NOT NULL,
	`per_week` integer DEFAULT 3 NOT NULL,
	`goal` text DEFAULT 'plus_longtemps' NOT NULL,
	`goal_note` text,
	`long_run_day` integer,
	`time` text,
	`hr_max` integer,
	`hr_rest` integer,
	`hr_threshold` integer,
	`threshold_source` text,
	`fixed` text,
	`pauses` text NOT NULL,
	`overrides` text NOT NULL,
	`watch` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`week_start` text NOT NULL,
	`role` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`kind` text NOT NULL,
	`minutes` integer NOT NULL,
	`session` text NOT NULL,
	`hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'prevue' NOT NULL,
	`edit` text,
	`sample_id` text,
	`watch_version` integer,
	`watch_at` text,
	`watch_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_run_sessions_person` ON `run_sessions` (`person_id`,`date`);--> statement-breakpoint
CREATE TABLE `workout_details` (
	`sample_id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`date` text NOT NULL,
	`hr` blob,
	`hr_points` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL,
	`effort` real,
	`temp_c` real,
	`humidity_pct` real,
	`indoor` integer,
	`planned_id` text,
	`peak` integer,
	`doubtful` integer DEFAULT false NOT NULL,
	`analysis` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`sample_id`) REFERENCES `health_samples`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workout_details_person` ON `workout_details` (`person_id`,`date`);