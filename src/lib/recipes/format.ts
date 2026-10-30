// Format standard d'une recette à importer (fichiers de src/seed/recipes/, ou sortie
// de l'IA « Crée ou adapte une recette »). Le même schéma sert aux deux.
import { z } from "zod";

export const STEP_KINDS = ["prep", "sear", "braise", "boil", "bake", "rest", "cool"] as const;
export const NOTE_CATEGORIES = ["taste", "prep", "painful_ingredient", "storage", "reheat", "other"] as const;
export const EQUIPMENT_KINDS = ["hob", "oven", "pan", "pot", "dish", "appliance"] as const;

// Ce qui est réellement mangé d'une ligne. Sans ce champ, les défauts de l'aliment
// s'appliquent (src/lib/nutrition/foods.ts : parure des pièces avec os ou peau, huile).
export const IngredientYieldInput = z.object({
  usedGrams: z.number().nonnegative().nullable().optional().describe("Part du paquet réellement utilisée, quand `grams` est le paquet entier (râpé : 150 sur 200)"),
  usedPct: z.number().min(0).max(100).nullable().optional().describe("Idem en % : « la moitié du pot » = 50"),
  trimPct: z.number().min(0).max(100).nullable().optional().describe("% du poids acheté retiré avant de manger : os, peau et gras du poulet, couenne"),
  panLossPct: z.number().min(0).max(100).nullable().optional().describe("% des lipides qui restent dans la poêle ou sont jetés : 30 saisie, 15 saisie déglacée dans le plat, 5 sauce dans la même poêle, 0 sauce ou mijoté"),
  note: z.string().nullable().optional().describe("Pourquoi ce rendement, affiché sur la fiche"),
});

export const IngredientInput = z.object({
  lineRaw: z.string().describe("Ligne de courses, avec la quantité : « 1 kg échine de porc » (envoyée au catalogue s'il y en a un)"),
  item: z.string().describe("Nom court de l'ingrédient"),
  grams: z.number().nullable().optional(),
  units: z.number().nullable().optional().describe("Nombre de pièces quand le poids n'a pas de sens (œufs, gousses)"),
  group: z.string().nullable().optional().describe("Lettre du bol de prep (A, B, C…)"),
  optional: z.boolean().optional(),
  pantry: z.boolean().optional().describe("Placard : à vérifier chez soi, pas forcément à acheter"),
  side: z
    .boolean()
    .optional()
    .describe("Garniture cuite et gardée à part (riz, semoule, pâtes) : pesée à part en fin de session, pour régler plat et féculent de chacun"),
  food: z.string().nullable().optional().describe("Id de la table nutritionnelle (src/lib/nutrition/foods.ts), « zero » si sans apport"),
  yield: IngredientYieldInput.nullable().optional().describe("Ce qui est réellement mangé (part du paquet, parure, gras de la poêle)"),
});

// Sous-étape chronométrée : en session, chaque sous-étape a son minuteur, et la suivante démarre
// quand il sonne (« Préchauffe à vide, 3 min » → « Huile + bol B, niveau 5, 5 min » → « Farine, 1 min »).
export const StepPhase = z.object({
  text: z.string().describe("Le geste, court et à l'impératif : « Huile + échalotes (bol B), remue de temps en temps »"),
  min: z.number().positive().describe("Durée du minuteur de cette sous-étape, en minutes (0,5 = 30 s)"),
  hobLevel: z.number().int().min(1).max(9).nullable().optional().describe("Niveau d'induction pendant cette sous-étape, s'il change"),
  batch: z.number().int().positive().nullable().optional().describe("Fournée (1, 2, 3…) quand l'étape se répète faute de place : « Fournée 2 sur 3 » s'affiche"),
  wait: z
    .boolean()
    .nullable()
    .optional()
    .describe("Attente sans geste (l'eau chauffe, le riz cuit, le gratin dore) : l'écran passe à autre chose, et une sonnerie rappelle la sous-étape suivante"),
});
export type StepPhase = z.infer<typeof StepPhase>;

export const StepInput = z.object({
  kind: z.enum(STEP_KINDS),
  text: z.string(),
  durationMin: z.number().nullable().optional(),
  activeMin: z.number().nullable().optional(),
  equipmentId: z.string().nullable().optional().describe("Id d'équipement : poele-28, cocotte, faitout, oven…"),
  equipmentAlt: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Récipients de rechange (ids) si celui-ci est pris par une autre recette : « faitout » pour un mijotage sur la plaque. À mettre sur toutes les étapes de ce récipient"),
  hobLevel: z.number().int().min(1).max(9).nullable().optional(),
  ovenTemp: z.number().int().nullable().optional(),
  bowls: z.array(z.string()).optional().describe("Lettres des bols utilisés à cette étape"),
  cue: z.string().nullable().optional().describe("Signe visuel ou sonore qui dit que c'est prêt"),
  phases: z
    .array(StepPhase)
    .nullable()
    .optional()
    .describe("Sous-étapes chronométrées de la partie active, dans l'ordre (préchauffe, ajout, cuisson…). Leur somme ≈ activeMin. Vide si l'étape est un seul geste"),
});

export const RecipeInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().nullable().optional(),
  servingsUnits: z.number().int().positive().describe("Unités cuites (une part d'adulte fait 4 à 5 unités)"),
  tags: z.array(z.string()).default([]),
  fridgeDays: z.number().int().nullable().optional(),
  freezerOk: z.boolean().default(false),
  kcalUnit: z.number().nullable().optional(),
  proteinUnit: z.number().nullable().optional(),
  status: z.enum(["liked", "to_try", "archived"]).default("liked"),
  source: z.string().nullable().optional(),
  tips: z.string().nullable().optional(),
  ingredients: z.array(IngredientInput),
  steps: z.array(StepInput),
});

export type RecipeInput = z.infer<typeof RecipeInput>;

export const NOTE_LABELS: Record<(typeof NOTE_CATEGORIES)[number], string> = {
  taste: "Goût",
  prep: "Préparation",
  painful_ingredient: "Ingrédient pénible",
  storage: "Conservation",
  reheat: "Réchauffage",
  other: "Autre",
};

export const STEP_LABELS: Record<(typeof STEP_KINDS)[number], string> = {
  prep: "Prep",
  sear: "Saisie",
  braise: "Mijotage",
  boil: "Cuisson à l'eau",
  bake: "Four",
  rest: "Repos",
  cool: "Refroidir",
};
