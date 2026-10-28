// Réponses simulées de l'IA pour le dev (MIJOTE_AI_MOCK=1, jamais en production) :
// elles transforment vraiment la recette, pour voir le diff, les restes et les ruptures.
import { FOODS, isFoodId } from "@/lib/nutrition/foods";
import type { RecipeInput } from "@/lib/recipes/format";
import type { AdjustOutput, AiRecipe, AtelierOutput } from "./schema";
import { toAiRecipe } from "./schema";
import type { CreationRequest } from "./prompt";
import { norm } from "./verify";

const MEATS = new Set(["echine_porc", "saute_porc", "filet_mignon_porc", "filet_poulet", "saucisse_toulouse"]);
const FATS = new Set(["huile", "beurre", "creme_legere", "emmental_rape"]);

/** L'id de la table nutritionnelle le plus probable pour un nom de produit. */
export function guessFood(name: string): string | null {
  const n = norm(name);
  let best: { id: string; score: number } | null = null;
  for (const id of Object.keys(FOODS)) {
    if (id === "zero") continue;
    const words = id.split("_").filter((w) => w.length > 2);
    if (!words.length || !words.every((w) => n.includes(w.replace(/e$/, "")))) continue;
    if (!best || words.length > best.score) best = { id, score: words.length };
  }
  return best?.id ?? null;
}

const nextLetter = (r: AiRecipe) => {
  const used = new Set(r.ingredients.map((i) => i.group).filter(Boolean));
  for (const l of "ABCDEFGHIJ") if (!used.has(l)) return l;
  return "J";
};

const setGrams = (i: AiRecipe["ingredients"][number], g: number) => {
  const old = i.grams;
  i.grams = Math.round(g / 10) * 10;
  if (old) i.lineRaw = i.lineRaw.replace(/^\s*[\d.,]+\s*(kg|g)\b/i, `${i.grams} g`);
  if (!/^\s*\d/.test(i.lineRaw)) i.lineRaw = `${i.grams} g ${i.lineRaw}`;
};

export function mockAdjust(recipe: RecipeInput, request: string): AdjustOutput {
  const r = structuredClone(toAiRecipe(recipe));
  const q = norm(request);
  const meat = [...r.ingredients].filter((i) => isFoodId(i.food) && MEATS.has(i.food)).sort((a, b) => (b.grams ?? 0) - (a.grams ?? 0))[0];
  const changes: string[] = [];
  const lighter = /baisse|moins|kcal|leger|equilibre|legumes/.test(q) && !/prise de masse|ajoute environ/.test(q);
  if (/prise de masse|ajoute environ|proteines a la part/.test(q) && meat?.grams) {
    setGrams(meat, meat.grams * 1.25);
    changes.push(`${meat.item} : +25 %`);
  }
  if (lighter) {
    for (const i of r.ingredients)
      if (isFoodId(i.food) && FATS.has(i.food) && i.grams) {
        setGrams(i, Math.max(5, i.grams * 0.5));
        changes.push(`${i.item} : moitié moins`);
      }
    if (meat?.grams && meat.grams >= 400) {
      setGrams(meat, meat.grams * 0.8);
      changes.push(`${meat.item} : −20 %`);
    }
    const letter = nextLetter(r);
    r.ingredients.push({ lineRaw: "400 g courgettes", item: "Courgettes, en demi-lunes", grams: 400, units: null, group: letter, optional: false, pantry: false, food: "courgette" });
    r.steps.push({
      kind: "sear",
      text: `Bol ${letter} : saisir les courgettes à la poêle en une couche, sans les remuer pendant 3 min, puis 2 min en sautant. Saler à la fin.`,
      durationMin: 6,
      activeMin: 6,
      equipmentId: "poele-28",
      equipmentAlt: null,
      hobLevel: 7,
      ovenTemp: null,
      bowls: [letter],
      cue: "Bords brun doré, grésillement vif ; elles restent fermes au centre",
      phases: [
        { text: `Courgettes (bol ${letter}) en une couche, ne touche pas`, min: 3, hobLevel: 7, batch: null, wait: false },
        { text: "Saute, encore 2 min, sel à la fin", min: 2, hobLevel: 7, batch: null, wait: false },
      ],
    });
    changes.push("Courgettes saisies ajoutées");
  }
  if (/goji|introuvable/.test(q)) {
    r.ingredients.push({ lineRaw: "50 g baies de goji séchées bio du Tibet", item: "Baies de goji", grams: 50, units: null, group: null, optional: false, pantry: false, food: null });
    changes.push("Baies de goji (test d'un produit introuvable)");
  }
  r.slug = lighter ? "allegee" : "proteinee";
  r.name = `${recipe.name} (${lighter ? "allégée" : "plus protéinée"})`;
  return {
    recipe: r,
    explanation: "Réponse simulée (MIJOTE_AI_MOCK) : la recette est transformée en code pour tester le diff, les restes de paquet et la vérification catalogue.",
    changes: changes.length ? changes : ["Aucun changement simulé pour cette demande"],
  };
}

export function mockCreate(req: CreationRequest, current: RecipeInput | null): AtelierOutput {
  const e = norm(req.envie);
  const porc = /porc/.test(e);
  const base: AiRecipe = current
    ? structuredClone(toAiRecipe(current))
    : {
        slug: porc ? "saute-porc-roti-four-legumes" : "poulet-roti-four-courgettes-citron",
        name: porc ? "Sauté de porc rôti au four, légumes fondants" : "Poulet rôti au four, courgettes et pommes de terre au citron",
        description: "Une plaque au four : la viande saisie d'abord à la poêle pour le goût, puis tout finit ensemble au four.",
        servingsUnits: 18,
        tags: [porc ? "porc" : "poulet", "four"],
        fridgeDays: 4,
        freezerOk: false,
        tips: "Les pommes de terre se réchauffent mieux coupées en petits cubes.",
        ingredients: [
          { lineRaw: porc ? "1 kg sauté de porc" : "1 kg filets de poulet", item: porc ? "Sauté de porc, en cubes de 3 cm" : "Filets de poulet, en gros morceaux", grams: 1000, units: null, group: "A", optional: false, pantry: false, food: porc ? "saute_porc" : "filet_poulet" },
          { lineRaw: "1 kg pommes de terre", item: "Pommes de terre, en cubes de 2 cm", grams: 1000, units: null, group: "B", optional: false, pantry: false, food: "pomme_de_terre" },
          { lineRaw: "600 g courgettes", item: "Courgettes, en tronçons", grams: 600, units: null, group: "B", optional: false, pantry: false, food: "courgette" },
          { lineRaw: "2 oignons", item: "Oignons, en quartiers", grams: 300, units: 2, group: "B", optional: false, pantry: false, food: "oignon" },
          { lineRaw: "4 gousses d'ail", item: "Ail, écrasé", grams: null, units: 4, group: "C", optional: false, pantry: false, food: "ail" },
          { lineRaw: "1 citron vert", item: "Citron vert, zeste et jus", grams: null, units: 1, group: "C", optional: false, pantry: false, food: "citron_vert" },
          { lineRaw: "3 c. à s. huile d'olive", item: "Huile d'olive", grams: 30, units: null, group: null, optional: false, pantry: true, food: "huile" },
          { lineRaw: "sel, poivre, thym", item: "Sel, poivre, thym", grams: null, units: null, group: null, optional: false, pantry: true, food: "zero" },
        ],
        steps: [
          { kind: "prep", text: "Bol A : la viande en morceaux, bien séchée au papier. Bol B : légumes coupés, avec 2 c. à s. d'huile et le sel. Bol C : ail et citron.", durationMin: 20, activeMin: 20, equipmentId: null, equipmentAlt: null, hobLevel: null, ovenTemp: null, bowls: ["A", "B", "C"], cue: null, phases: [] },
          { kind: "bake", text: "Bol B dans la lèchefrite, au four à 210 °C, 25 min.", durationMin: 25, activeMin: 2, equipmentId: "oven", equipmentAlt: null, hobLevel: null, ovenTemp: 210, bowls: ["B"], cue: "Bords des pommes de terre dorés", phases: [{ text: "Bol B étalé dans la lèchefrite", min: 1.5, hobLevel: null, batch: null, wait: false }, { text: "Au four, à mi-hauteur", min: 0.5, hobLevel: null, batch: null, wait: false }] },
          { kind: "sear", text: "Bol A en deux fournées de 500 g : Poêle préchauffée à vide au niveau 7, test de Leidenfrost, on baisse à 6, huile, la viande sans y toucher 3 min, puis 2 min de l'autre côté.", durationMin: 14, activeMin: 14, equipmentId: "poele-28", equipmentAlt: null, hobLevel: 6, ovenTemp: null, bowls: ["A"], cue: "La viande se décolle seule, croûte brun doré, grésillement franc", phases: [
            { text: "Poêle vide, préchauffe", min: 2.5, hobLevel: 7, batch: null, wait: false },
            { text: "Test de Leidenfrost : la goutte glisse ? Niveau 6, huile", min: 0.5, hobLevel: 6, batch: null, wait: false },
            { text: "500 g du bol A, ne touche pas", min: 3, hobLevel: 6, batch: 1, wait: false },
            { text: "Retourne, 2 min, réserve", min: 2, hobLevel: 6, batch: 1, wait: false },
            { text: "500 g du bol A, ne touche pas", min: 3, hobLevel: 6, batch: 2, wait: false },
            { text: "Retourne, 2 min", min: 2, hobLevel: 6, batch: 2, wait: false },
          ] },
          { kind: "bake", text: "La viande et le bol C sur les légumes, 15 min de plus au four.", durationMin: 15, activeMin: 2, equipmentId: "oven", equipmentAlt: null, hobLevel: null, ovenTemp: 210, bowls: ["C"], cue: "Jus clair à cœur", phases: [{ text: "La viande et le bol C sur les légumes", min: 1.5, hobLevel: null, batch: null, wait: false }, { text: "Au four", min: 0.5, hobLevel: null, batch: null, wait: false }] },
        ],
      };
  for (const rm of req.remove) {
    const k = norm(rm);
    base.ingredients = base.ingredients.filter((i) => norm(i.item) !== k);
  }
  for (const add of req.add) {
    const food = guessFood(add);
    base.ingredients.push({ lineRaw: `200 g ${add}`, item: add, grams: 200, units: null, group: nextLetter(base), optional: false, pantry: false, food });
  }
  if (req.avoid.length) base.slug = `${base.slug}-bis`;
  return {
    recipe: base,
    explanation: "Réponse simulée (MIJOTE_AI_MOCK) : une base fixe, modifiée selon les aliments ajoutés ou retirés, pour tester l'atelier sans appeler l'API.",
  };
}
