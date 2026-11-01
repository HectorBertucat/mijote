-- Contenants de la cuisine (src/lib/kitchen/presets.ts, containerRows) : bols de prep, boîtes de prep et
-- de conservation, plaque du four. L'inventaire par défaut, que la cuisine réglée remplace à
-- l'enregistrement (Réglages › Cuisine). Le planificateur range les bols de la session dedans.
INSERT OR IGNORE INTO `equipment` (`id`, `kind`, `name`, `dims_json`, `capacity_l`, `count`, `owned`) VALUES
  ('bol-petit', 'container', 'Petits bols', '{"role":"bol","label":"Petit bol"}', 0.5, 4, 1),
  ('bol-moyen', 'container', 'Bols moyens', '{"role":"bol","label":"Bol moyen"}', 1.5, 3, 1),
  ('bol-grand', 'container', 'Grands bols, saladiers', '{"role":"bol","label":"Grand bol"}', 3, 2, 1),
  ('boite-prep', 'container', 'Boîtes de prep', '{"role":"prep","label":"Boîte"}', 1, 4, 1),
  ('boite-frigo', 'container', 'Boîtes de conservation', '{"role":"frigo","label":"Boîte de conservation"}', 1, 10, 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `equipment` (`id`, `kind`, `name`, `dims_json`, `count`, `owned`)
  SELECT 'plaque-four', 'dish', 'Plaque du four', '{"innerCm":"40x30","depthCm":2}', 1, 1 FROM `equipment` WHERE `id` = 'oven' AND `owned` = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO `equipment_fit` (`equipment_id`, `hob_id`, `preferred`)
  SELECT 'plaque-four', 'oven', 1 FROM `equipment` WHERE `id` = 'plaque-four';
