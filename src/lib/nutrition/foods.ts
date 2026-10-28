// Table de référence nutritionnelle, pour 100 g d'aliment tel qu'il est pesé dans la
// recette (cru, ou égoutté pour les conserves). Valeurs moyennes arrondies, d'après la
// table Ciqual de l'Anses et les étiquettes des produits courants du drive.
// Les calculs restent en code : aucune valeur ne vient de l'IA.

export interface Food {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  pieceG?: number; // poids d'une pièce (œuf, gousse, oignon…)
  trimPct?: number; // défaut : % du poids acheté retiré (os, peau, gras, couenne)
  panLossPct?: number; // défaut : % des lipides qui restent dans la poêle ou sont jetés
}

/** Repères documentés pour la part du gras de cuisson qui n'est pas mangée (en %). */
export const PAN_LOSS = {
  saisie: 30, // saisie à la poêle, poêle essuyée ou lavée ensuite
  saisieDeglacee: 15, // saisie, puis poêle déglacée à l'eau et jus versé dans le plat
  sauceMemePoele: 5, // la sauce se fait dans la même poêle, tout part dans l'assiette
  sauce: 0, // huile d'une sauce, d'un mijoté en cocotte, d'une marinade, des pâtes
} as const;

const f = (name: string, kcal: number, protein: number, carbs: number, fat: number, fiber = 0, pieceG?: number, extra: Pick<Food, "trimPct" | "panLossPct"> = {}): Food => ({
  name,
  kcal,
  protein,
  carbs,
  fat,
  fiber,
  pieceG,
  ...extra,
});

export const FOODS = {
  // Viandes, œufs
  echine_porc: f("Échine de porc crue", 205, 18, 0, 15),
  saute_porc: f("Sauté de porc (épaule) cru", 165, 19.5, 0, 9.5),
  filet_mignon_porc: f("Filet mignon de porc cru", 120, 21.5, 0, 3.5),
  filet_poulet: f("Filet de poulet cru", 110, 23.5, 0, 1.5),
  saucisse_toulouse: f("Saucisse de Toulouse crue", 270, 15, 1, 23),
  // Pièces avec os ou peau : valeurs de la viande mangée, poids acheté dans la recette.
  cuisse_poulet: f("Cuisse de poulet entière (viande sans peau)", 120, 19.5, 0, 4.8, 0, undefined, { trimPct: 35 }), // os ~22 %, peau et gras ~13 %
  haut_cuisse_poulet: f("Haut de cuisse de poulet désossé (viande sans peau)", 125, 19, 0, 5.5, 0, undefined, { trimPct: 12 }), // vendu avec la peau : peau et gras ~12 %
  poulet_entier: f("Poulet entier (viande sans peau)", 120, 21.5, 0, 3.8, 0, undefined, { trimPct: 42 }), // carcasse et os ~30 %, peau et gras ~12 %
  cuisse_dinde: f("Cuisse de dinde (viande sans peau)", 110, 19.5, 0, 3.5, 0, undefined, { trimPct: 28 }), // os et tendons ~20 %, peau ~8 %
  poitrine_porc: f("Poitrine de porc (sans couenne)", 260, 15.5, 0, 22, 0, undefined, { trimPct: 10 }), // couenne ~10 %
  oeuf: f("Œuf entier", 140, 12.5, 0.7, 9.7, 0, 60),
  // Féculents (crus, secs)
  riz_basmati: f("Riz basmati cru", 350, 7.5, 78, 0.6, 1.3),
  pates: f("Pâtes sèches", 355, 12.5, 71, 1.5, 3),
  pomme_de_terre: f("Pomme de terre crue", 80, 2, 17, 0.1, 1.8),
  pois_chiches: f("Pois chiches égouttés", 120, 7, 14, 2.5, 6),
  farine: f("Farine de blé", 345, 10, 72, 1.2, 3),
  maizena: f("Fécule de maïs", 350, 0.3, 88, 0, 0.5),
  // Légumes, fruits
  oignon: f("Oignon", 35, 1.2, 7, 0.2, 1.8, 150),
  echalote: f("Échalote", 70, 1.5, 15, 0.1, 1.5, 30),
  ail: f("Ail", 135, 6, 28, 0.5, 2, 5),
  gingembre: f("Gingembre frais", 75, 1.8, 15, 0.8, 2),
  champignon: f("Champignon de Paris", 22, 3, 1, 0.3, 1.5),
  courgette: f("Courgette", 17, 1.2, 2, 0.3, 1, 200),
  poivron: f("Poivron", 28, 1, 5, 0.3, 1.8, 150),
  carotte: f("Carotte", 36, 0.8, 7, 0.3, 2.5, 100),
  haricots_verts: f("Haricots verts", 30, 1.8, 4, 0.2, 3),
  pulpe_tomate: f("Pulpe de tomate", 25, 1.2, 4, 0.2, 1.2),
  concentre_tomate: f("Concentré de tomate", 90, 4, 16, 0.5, 4),
  persil: f("Persil", 40, 3, 6, 0.8, 4),
  citron_vert: f("Citron vert (jus et zeste)", 30, 0.4, 8, 0.2, 0.3, 60),
  // Laitiers, matières grasses
  ricotta: f("Ricotta", 140, 8, 4, 10),
  emmental_rape: f("Emmental râpé", 380, 28, 0, 29),
  creme_legere: f("Crème légère 15 %", 165, 2.8, 4, 15),
  beurre: f("Beurre", 740, 0.7, 0.6, 82),
  huile: f("Huile", 900, 0, 0, 100, 0, undefined, { panLossPct: 30 }), // défaut : saisie à la poêle (PAN_LOSS.saisie)
  // Épicerie
  sucre: f("Sucre", 400, 0, 100, 0),
  miel: f("Miel", 320, 0.3, 80, 0),
  nuoc_mam: f("Nuoc-mâm", 35, 5, 4, 0),
  sauce_soja: f("Sauce soja", 55, 8, 5, 0),
  moutarde: f("Moutarde forte", 150, 7, 4, 11),
  colombo: f("Poudre à colombo", 300, 12, 40, 10, 20),
  bouillon_cube: f("Cube de bouillon", 250, 10, 30, 10, 0, 10),
  vin_blanc_cuit: f("Vin blanc réduit à la cuisson", 20, 0.1, 2, 0), // l'alcool s'évapore
  // Sans apport notable : sel, poivre, herbes, eau
  zero: f("Sans apport notable (sel, poivre, herbes)", 0, 0, 0, 0),
} satisfies Record<string, Food>;

export type FoodId = keyof typeof FOODS;
export const isFoodId = (id: string | null | undefined): id is FoodId => id != null && id in FOODS;
