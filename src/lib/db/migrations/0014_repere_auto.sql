ALTER TABLE `people` ADD `meal_ref_auto` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `weekly_targets` ADD `meal_ref` text;--> statement-breakpoint
-- Qui avait déjà un repère fixe le garde : le mode automatique ne s'impose qu'aux autres.
UPDATE `people` SET `meal_ref_auto` = 0 WHERE `fixed_meal_ref` IS NOT NULL;
