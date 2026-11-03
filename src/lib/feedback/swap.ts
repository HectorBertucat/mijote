// Variantes réelles (pur, testé : tests/gouts.test.ts) : un ingrédient remplacé en cuisinant (patate douce
// → pomme de terre). Le remplacement se fait poids pour poids, par un aliment de la même famille de la
// table nutritionnelle ; la nutrition se recalcule avec la table (jamais de chiffre saisi).
//
// - `swapOptions` : les remplaçants possibles d'un aliment (même famille : viande, féculent, légume…) ;
// - `swapRecipe` : la fiche avec ses lignes remplacées, et les mots du texte (nom, étapes, conseil) ;
// - `swapRows` : les lignes de la base remplacées, pour la nutrition d'une session ou d'une réserve ;
// - `rescaleGroups` : une réserve déjà rangée garde ses grammes pesés, ses kcal et protéines par gramme
//   suivent le rapport entre les groupes avant et après le remplacement.
import { FOODS, isFoodId, type FoodId } from "@/lib/nutrition/foods";
import type { RecipeInput } from "@/lib/recipes/format";

export type SwapFamily = "viande" | "feculent" | "legume" | "laitier" | "fromage" | "gras";

const FAMILIES: Record<SwapFamily, FoodId[]> = {
  viande: ["filet_poulet", "haut_cuisse_poulet", "cuisse_poulet", "poulet_entier", "cuisse_dinde", "saute_porc", "echine_porc", "filet_mignon_porc", "poitrine_porc", "saucisse_toulouse", "merguez", "boeuf_hache_5"],
  feculent: ["riz_basmati", "pates", "semoule", "pomme_de_terre", "patate_douce", "pois_chiches"],
  legume: ["courgette", "poivron", "carotte", "haricots_verts", "epinards", "aubergine", "brocoli", "navet", "champignon"],
  laitier: ["skyr", "yaourt", "creme_legere", "ricotta", "lait_coco", "lait_demi"],
  fromage: ["emmental_rape", "parmesan", "mozzarella"],
  gras: ["huile", "beurre"],
};

/** Les mots d'un aliment dans le texte d'une fiche : singulier, pluriel. */
const WORDS: Partial<Record<FoodId, [string, string]>> = {
  filet_poulet: ["filet de poulet", "filets de poulet"],
  haut_cuisse_poulet: ["haut de cuisse de poulet", "hauts de cuisse de poulet"],
  cuisse_poulet: ["cuisse de poulet", "cuisses de poulet"],
  cuisse_dinde: ["cuisse de dinde", "cuisses de dinde"],
  saute_porc: ["sauté de porc", "sautés de porc"],
  echine_porc: ["échine de porc", "échines de porc"],
  filet_mignon_porc: ["filet mignon", "filets mignons"],
  boeuf_hache_5: ["bœuf haché", "bœuf haché"],
  riz_basmati: ["riz", "riz"],
  pates: ["pâtes", "pâtes"],
  semoule: ["semoule", "semoule"],
  pomme_de_terre: ["pomme de terre", "pommes de terre"],
  patate_douce: ["patate douce", "patates douces"],
  pois_chiches: ["pois chiche", "pois chiches"],
  courgette: ["courgette", "courgettes"],
  poivron: ["poivron", "poivrons"],
  carotte: ["carotte", "carottes"],
  haricots_verts: ["haricot vert", "haricots verts"],
  epinards: ["épinard", "épinards"],
  aubergine: ["aubergine", "aubergines"],
  brocoli: ["brocoli", "brocolis"],
  navet: ["navet", "navets"],
  champignon: ["champignon", "champignons"],
  skyr: ["skyr", "skyr"],
  yaourt: ["yaourt", "yaourts"],
  creme_legere: ["crème", "crème"],
  ricotta: ["ricotta", "ricotta"],
  lait_coco: ["lait de coco", "lait de coco"],
  emmental_rape: ["emmental", "emmental"],
  parmesan: ["parmesan", "parmesan"],
  mozzarella: ["mozzarella", "mozzarellas"],
  huile: ["huile", "huiles"],
  beurre: ["beurre", "beurre"],
};

export function familyOfFood(food: string | null | undefined): SwapFamily | null {
  if (!isFoodId(food)) return null;
  return (Object.keys(FAMILIES) as SwapFamily[]).find((k) => FAMILIES[k].includes(food)) ?? null;
}

/** Le nom court d'un aliment, au pluriel si demandé (« pommes de terre »). */
export function foodWord(food: string, plural = true): string {
  const w = isFoodId(food) ? WORDS[food] : undefined;
  if (w) return plural ? w[1] : w[0];
  return isFoodId(food) ? FOODS[food].name.replace(/\s+(crue?s?|cru)$/i, "").toLowerCase() : food;
}

/** Les remplaçants possibles d'un aliment : les autres aliments de sa famille. */
export function swapOptions(food: string | null | undefined): { food: FoodId; label: string }[] {
  const fam = familyOfFood(food);
  if (!fam) return [];
  return FAMILIES[fam].filter((f) => f !== food).map((f) => ({ food: f, label: FOODS[f].name }));
}

export const canSwap = (from: string | null | undefined, to: string) => isFoodId(to) && familyOfFood(from) != null && familyOfFood(from) === familyOfFood(to) && from !== to;

export interface Swap {
  position: number;
  toFood: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Remplace les mots d'un aliment par ceux d'un autre dans un texte, pluriel et majuscule gardés. */
export function replaceWords(text: string, from: string, to: string): string {
  const a = isFoodId(from) ? WORDS[from] : undefined;
  const b = isFoodId(to) ? WORDS[to] : undefined;
  if (!a || !b || !text) return text;
  // Le pluriel d'abord (« patates douces » avant « patate douce »).
  const forms: [string, string][] = a[1] === a[0] ? [[a[0], b[0]]] : [[a[1], b[1]], [a[0], b[0]]];
  let out = text;
  for (const [x, y] of forms) out = out.replace(new RegExp(`(^|[^\\p{L}])(${escape(x)})(?![\\p{L}])`, "giu"), (_m, pre: string, w: string) => `${pre}${w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? capital(y) : y}`);
  return out;
}

type Ing = RecipeInput["ingredients"][number];

/** Une ligne de fiche remplacée : aliment, libellé, ligne de courses ; le poids est gardé (les pièces passent en grammes). */
export function swapIngredient(i: Ing, toFood: string): Ing {
  const from = i.food ?? "";
  const word = replaceWords(i.item, from, toFood);
  const item = word !== i.item ? word : `${capital(foodWord(toFood))}${i.item.includes(",") ? i.item.slice(i.item.indexOf(",")) : ""}`;
  const line = replaceWords(i.lineRaw, from, toFood);
  const piece = isFoodId(from) ? FOODS[from].pieceG : undefined;
  const grams = i.grams ?? (i.units != null && piece ? i.units * piece : null);
  const lineRaw = line !== i.lineRaw ? line : grams != null ? `${grams >= 1000 ? `${(grams / 1000).toLocaleString("fr-FR")} kg` : `${Math.round(grams)} g`} ${foodWord(toFood)}` : foodWord(toFood);
  // Le rendement propre à l'ancien aliment (parure, part du paquet) ne vaut plus : défauts du nouveau.
  return { ...i, food: toFood, item, lineRaw, grams, units: i.grams != null ? i.units : null, yield: i.yield?.panLossPct != null ? { panLossPct: i.yield.panLossPct, note: i.yield.note ?? null } : null };
}

/** La fiche avec ses remplacements : lignes, et mots du nom, de la description, des étapes et du conseil. */
export function swapRecipe(r: RecipeInput, swaps: Swap[]): RecipeInput {
  let out: RecipeInput = { ...r, ingredients: [...r.ingredients], steps: r.steps.map((s) => ({ ...s, phases: s.phases?.map((p) => ({ ...p })) ?? s.phases })) };
  for (const s of swaps) {
    const i = out.ingredients[s.position];
    if (!i || !canSwap(i.food, s.toFood)) continue;
    const from = i.food!;
    out.ingredients[s.position] = swapIngredient(i, s.toFood);
    const w = (t: string | null | undefined) => (t ? replaceWords(t, from, s.toFood) : t);
    out = {
      ...out,
      // Les autres lignes qui en parlent (« huile pour les patates douces ») suivent.
      ingredients: out.ingredients.map((x, n) => (n === s.position ? x : { ...x, item: w(x.item)!, lineRaw: w(x.lineRaw)! })),
      name: w(out.name)!,
      description: w(out.description),
      tips: w(out.tips),
      tags: out.tags.map((t) => w(t)!),
      steps: out.steps.map((st) => ({ ...st, text: w(st.text)!, cue: w(st.cue), phases: st.phases?.map((p) => ({ ...p, text: w(p.text)! })) ?? st.phases })),
      serve: out.serve?.map((g) => ({ ...g, label: w(g.label)! })) ?? out.serve,
    };
  }
  return out;
}

/** Les lignes de la base (rangées par position) avec leurs remplacements : seul l'aliment change pour la nutrition. */
export function swapRows<T extends { position: number; foodId: string | null; item: string; yield?: unknown }>(rows: T[], swaps: Swap[]): T[] {
  if (!swaps.length) return rows;
  return rows.map((r) => {
    const s = [...swaps].reverse().find((x) => x.position === r.position);
    if (!s || !canSwap(r.foodId, s.toFood)) return r;
    return { ...r, foodId: s.toFood, item: replaceWords(r.item, r.foodId!, s.toFood), ...("yield" in r ? { yield: null } : {}) };
  });
}

/** Les groupes d'une réserve rangée, après un remplacement : grammes gardés, kcal et protéines au prorata. */
export function rescaleGroups<G extends { key: string; kcalG: number | null; proteinG: number | null }>(
  groups: G[],
  before: { key: string; kcal: number | null; protein: number | null }[],
  after: { key: string; kcal: number | null; protein: number | null }[]
): G[] {
  return groups.map((g) => {
    const b = before.find((x) => x.key === g.key);
    const a = after.find((x) => x.key === g.key);
    const k = (x: number | null, y: number | null | undefined, z: number | null | undefined) => (x == null || y == null || z == null || y <= 0 ? x : x * (z / y));
    return { ...g, kcalG: k(g.kcalG, b?.kcal, a?.kcal), proteinG: k(g.proteinG, b?.protein, a?.protein) };
  });
}
