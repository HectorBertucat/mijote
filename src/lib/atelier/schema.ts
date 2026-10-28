// Ce que l'IA renvoie pour « Ajuster » et « Atelier » : une recette au format
// RecipeInput, en version stricte (tous les champs présents, null quand ils ne
// servent pas), plus une courte explication. Le code normalise ensuite la sortie
// (slug, types d'étape, niveaux, ids nutrition) et la passe à RecipeInput.parse().
// Les enums restent des chaînes : le helper zodOutputFormat ne les impose pas,
// c'est la normalisation qui les vérifie.
import { z } from "zod";
import { RecipeInput, STEP_KINDS, type StepPhase } from "@/lib/recipes/format";
import { isFoodId } from "@/lib/nutrition/foods";

export const AiIngredient = z.object({
  lineRaw: z.string().describe("Ligne envoyée au catalogue Chronodrive, quantité comprise : « 400 g hauts de cuisse de poulet »"),
  item: z.string().describe("Nom affiché. Pour un ingrédient gardé de la recette d'origine, recopier exactement son item"),
  grams: z.number().nullable().describe("Poids cru en grammes (null seulement pour des pièces sans poids utile)"),
  units: z.number().nullable().describe("Nombre de pièces (œufs, gousses), sinon null"),
  group: z.string().nullable().describe("Lettre du bol de prep (A, B, C…)"),
  optional: z.boolean(),
  pantry: z.boolean().describe("Placard : sel, poivre, huile, épices, sauce soja…"),
  food: z.string().nullable().describe("Id de la table nutritionnelle (liste du système), « zero » si sans apport, null si absent de la liste"),
});

export const AiPhase = z.object({
  text: z.string().describe("Le geste, court, à l'impératif : « Poêle vide sur le foyer », « Huile + oignons (bol A), remue »"),
  min: z.number().describe("Durée de son minuteur en minutes (0,5 = 30 s)"),
  hobLevel: z.number().int().nullable().describe("Niveau d'induction pendant cette sous-étape, null hors du feu"),
  batch: z.number().int().nullable().describe("Fournée 1, 2, 3… quand le geste se répète faute de place, sinon null"),
  wait: z.boolean().describe("true pour une attente sans geste (l'eau chauffe, le riz cuit, le gratin dore) : l'écran passe à autre chose et la fin sonne"),
});

export const AiStep = z.object({
  kind: z.string().describe(`Un de : ${STEP_KINDS.join(", ")}`),
  text: z.string(),
  durationMin: z.number().nullable(),
  activeMin: z.number().nullable(),
  equipmentId: z.string().nullable().describe("Id d'équipement de la liste du système"),
  equipmentAlt: z.array(z.string()).nullable().describe("Récipients de rechange (ids de la liste) si celui-ci est pris par une autre recette de la session, sur toutes les étapes de ce récipient : « faitout » pour un mijotage sur la plaque. null sinon"),
  hobLevel: z.number().int().nullable().describe("Niveau d'induction 1 à 9"),
  ovenTemp: z.number().int().nullable(),
  bowls: z.array(z.string()),
  cue: z.string().nullable().describe("Repère visuel ou sonore (obligatoire pour une saisie)"),
  phases: z
    .array(AiPhase)
    .describe("Sous-étapes chronométrées, obligatoires pour toute cuisson (saisie, mijotage, eau, four) de 2 min de geste ou plus ; [] pour une prep ou un geste unique"),
});

export const AiRecipe = z.object({
  slug: z.string().describe("minuscules, chiffres et tirets"),
  name: z.string(),
  description: z.string().nullable(),
  servingsUnits: z.number().int().describe("Unités cuites : la somme des parts du foyer par repas, × le nombre de repas"),
  tags: z.array(z.string()),
  fridgeDays: z.number().int().nullable(),
  freezerOk: z.boolean(),
  tips: z.string().nullable(),
  ingredients: z.array(AiIngredient),
  steps: z.array(AiStep),
});

export const AdjustOutput = z.object({
  recipe: AiRecipe,
  explanation: z.string().describe("2 ou 3 phrases : ce qui change et pourquoi le goût tient"),
  changes: z.array(z.string()).describe("Les changements, un par ligne, très courts"),
});

export const AtelierOutput = z.object({
  recipe: AiRecipe,
  explanation: z.string().describe("2 ou 3 phrases : l'idée du plat et pourquoi il va plaire"),
});

export type AiRecipe = z.infer<typeof AiRecipe>;
export type AdjustOutput = z.infer<typeof AdjustOutput>;
export type AtelierOutput = z.infer<typeof AtelierOutput>;

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "recette"
  );
}

const KINDS = new Set<string>(STEP_KINDS);

const level = (n: number | null | undefined) => (n != null && n >= 1 && n <= 9 ? Math.round(n) : null);

/** Sous-étapes de l'IA : texte non vide, durée ramenée à la demi-minute (au moins 30 s), niveau 1 à 9. */
function normalizePhases(ph: AiRecipe["steps"][number]["phases"] | undefined): StepPhase[] | null {
  const out = (ph ?? [])
    .filter((p) => p.text.trim() && Number.isFinite(p.min) && p.min > 0)
    .map((p) => ({
      text: p.text.trim(),
      min: Math.max(0.5, Math.round(p.min * 2) / 2),
      hobLevel: level(p.hobLevel),
      batch: p.batch != null && p.batch >= 1 ? Math.round(p.batch) : null,
      ...(p.wait ? { wait: true } : {}),
    }));
  return out.length ? out : null;
}

/** Sortie de l'IA → RecipeInput valide. Le code tranche : rien n'est pris tel quel. */
export function normalizeRecipe(ai: AiRecipe, opts: { equipmentIds?: Set<string> } = {}): RecipeInput {
  const num = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null);
  return RecipeInput.parse({
    slug: slugify(ai.slug || ai.name),
    name: ai.name.trim() || "Recette sans nom",
    description: ai.description?.trim() || null,
    servingsUnits: Math.max(1, Math.round(ai.servingsUnits || 18)),
    tags: [...new Set(ai.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
    fridgeDays: ai.fridgeDays != null ? Math.min(5, Math.max(0, ai.fridgeDays)) : null,
    freezerOk: ai.freezerOk,
    // Jamais les chiffres de l'IA : la nutrition est recalculée en code.
    kcalUnit: null,
    proteinUnit: null,
    status: "to_try",
    tips: ai.tips?.trim() || null,
    ingredients: ai.ingredients
      .filter((i) => i.item.trim())
      .map((i) => ({
        lineRaw: i.lineRaw.trim() || i.item.trim(),
        item: i.item.trim(),
        grams: num(i.grams),
        units: num(i.units),
        group: i.group?.trim().toUpperCase().slice(0, 1) || null,
        optional: i.optional,
        pantry: i.pantry,
        food: i.food === "zero" || isFoodId(i.food) ? i.food : null,
      })),
    steps: ai.steps
      .filter((s) => s.text.trim())
      .map((s) => ({
        kind: KINDS.has(s.kind) ? s.kind : "prep",
        text: s.text.trim(),
        durationMin: num(s.durationMin),
        activeMin: num(s.activeMin),
        equipmentId: s.equipmentId && (!opts.equipmentIds || opts.equipmentIds.has(s.equipmentId)) ? s.equipmentId : null,
        equipmentAlt: (s.equipmentAlt ?? []).filter((x) => x !== s.equipmentId && (!opts.equipmentIds || opts.equipmentIds.has(x))),
        hobLevel: level(s.hobLevel),
        ovenTemp: s.ovenTemp != null && s.ovenTemp >= 50 && s.ovenTemp <= 280 ? Math.round(s.ovenTemp) : null,
        bowls: s.bowls.map((b) => b.trim().toUpperCase().slice(0, 1)).filter(Boolean),
        cue: s.cue?.trim() || null,
        phases: normalizePhases(s.phases),
      })),
  });
}

/** Le chemin inverse : une recette de la base → le format de l'IA (pour le prompt). */
export function toAiRecipe(r: RecipeInput): AiRecipe {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description ?? null,
    servingsUnits: r.servingsUnits,
    tags: r.tags,
    fridgeDays: r.fridgeDays ?? null,
    freezerOk: r.freezerOk,
    tips: r.tips ?? null,
    ingredients: r.ingredients.map((i) => ({
      lineRaw: i.lineRaw,
      item: i.item,
      grams: i.grams ?? null,
      units: i.units ?? null,
      group: i.group ?? null,
      optional: i.optional ?? false,
      pantry: i.pantry ?? false,
      food: i.food ?? null,
    })),
    steps: r.steps.map((s) => ({
      kind: s.kind,
      text: s.text,
      durationMin: s.durationMin ?? null,
      activeMin: s.activeMin ?? null,
      equipmentId: s.equipmentId ?? null,
      equipmentAlt: s.equipmentAlt ?? null,
      hobLevel: s.hobLevel ?? null,
      ovenTemp: s.ovenTemp ?? null,
      bowls: s.bowls ?? [],
      cue: s.cue ?? null,
      phases: (s.phases ?? []).map((p) => ({ text: p.text, min: p.min, hobLevel: p.hobLevel ?? null, batch: p.batch ?? null, wait: p.wait === true })),
    })),
  };
}
