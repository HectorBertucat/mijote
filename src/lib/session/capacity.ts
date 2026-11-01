// Capacités réelles : le volume qu'occupe ce qu'on cuit, celui qu'offre un récipient, la surface du
// four, la taille des bols de prep. Module pur (tests/capacite.test.ts), sans base ni réseau.
//
// Les coefficients sont des repères de cuisine arrondis, pas des mesures de laboratoire :
// - un récipient se remplit au plus aux trois quarts quand ça bout (mousse, remous) et à 85 % pour
//   un mijoté ou une sauce ;
// - riz à l'absorption (1,5 fois son volume d'eau) : 450 g de basmati font environ 0,56 L sec,
//   0,85 L d'eau, puis 1,7 L de riz cuit, soit 3,8 L par kilo de riz cru au plus fort ;
// - pâtes à grande eau : 8 L d'eau par kilo (2 L au moins) et 1,5 L par kilo de pâtes ;
// - légumes ou œufs à l'eau : 2,5 L d'eau par kilo (1,5 L au moins) et 1,5 L par kilo de légumes ;
// - dans un mijoté, tout compte pour 1 L par kilo (la sauce remplit les vides), les feuilles 1,5 ;
// - dans un bol de prep, les morceaux crus prennent de la place : oignons émincés 1,6 L/kg,
//   champignons 2,2, haricots verts 1,8, feuilles 5, viande en morceaux 1 ; un bol se remplit à 90 % ;
// - au four, une plaque ou un plat rôtit en une couche environ 1,5 g par cm².
import type { PlannerEquipment, PlannerIngredient, PlannerRecipe, PlannerStep, StepKind } from "./planner";

/** Remplissage maximal d'un récipient : à l'ébullition, ou pour un mijoté, une sauce. */
export const FILL = { boil: 0.75, stew: 0.85 } as const;
/** Remplissage maximal d'un bol ou d'une boîte de prep. */
export const BOWL_FILL = 0.9;
/** Rôtir en une couche : grammes par cm² de plaque ou de plat. */
export const ROAST_G_PER_CM2 = 1.5;

/** Poids d'une pièce quand la fiche ne donne que le nombre (œufs, gousses, citrons). */
const PIECE_G: Record<string, number> = { oeuf: 60, ail: 5, oignon: 150, echalote: 30, citron: 120, citron_vert: 70, poivron: 150, courgette: 200, carotte: 100 };

export function gramsOfIngredient(i: Pick<PlannerIngredient, "grams" | "units" | "foodId">, scale = 1): number {
  if (i.grams != null) return i.grams * scale;
  if (i.units != null) return i.units * (PIECE_G[i.foodId ?? ""] ?? 0) * scale;
  return 0;
}

// ─── Bases : riz, pâtes, semoule, légumes à l'eau ───

export type BaseMethod = "absorb" | "bath";
export interface BaseFood {
  /** Famille : deux recettes qui cuisent la même famille de la même façon partagent une cuisson. */
  family: string;
  label: string;
  /** Poids cuit ÷ poids cru, pour dire combien de riz cuit revient à chacun. */
  cookedYield: number;
}
const BASES: [RegExp, BaseFood][] = [
  [/^riz/, { family: "riz", label: "riz", cookedYield: 2.5 }],
  [/^(pates|orzo|spaghetti|penne|coquillettes|macaroni|fusilli|tagliatelles)/, { family: "pates", label: "pâtes", cookedYield: 2.2 }],
  [/^semoule/, { family: "semoule", label: "semoule", cookedYield: 2.2 }],
  [/^quinoa/, { family: "quinoa", label: "quinoa", cookedYield: 2.6 }],
  [/^boulgour/, { family: "boulgour", label: "boulgour", cookedYield: 2.5 }],
  [/^haricots_verts/, { family: "haricots_verts", label: "haricots verts", cookedYield: 1 }],
  [/^(brocoli|chou_fleur|petits_pois)/, { family: "legumes_eau", label: "légumes", cookedYield: 1 }],
];
export function baseFood(food: string | null | undefined): BaseFood | null {
  if (!food) return null;
  return BASES.find(([re]) => re.test(food))?.[1] ?? null;
}
const ABSORB_FAMILIES = new Set(["riz", "semoule", "quinoa", "boulgour"]);
const ABSORB_TEXT = /fois son volume|\d+\s*(?:ml|cl|l)\s+d'eau|feu minimum/i;

/** La méthode d'une cuisson de base : à l'absorption (riz, semoule) ou à grande eau (pâtes, légumes). */
export function baseMethod(base: BaseFood, text: string): BaseMethod {
  return ABSORB_FAMILIES.has(base.family) || ABSORB_TEXT.test(text) ? "absorb" : "bath";
}

/** Litres au plus fort d'une cuisson de base, pour `kg` d'aliment cru. */
export function baseLiters(base: BaseFood, method: BaseMethod, kg: number): number {
  if (kg <= 0) return 0;
  if (method === "absorb") return 3.8 * kg;
  if (base.family === "pates") return Math.max(2, 8 * kg) + 1.5 * kg;
  return Math.max(1.5, 2.5 * kg) + 1.5 * kg;
}

/**
 * Une étape « de base » : une cuisson à l'eau dont les bols ne contiennent qu'un même aliment de base
 * (« Riz (bol D) dans la grande casserole… »). Elle se partage entre recettes et ne dépend pas du reste
 * de la recette (le riz se garde à part).
 */
export function baseOfStep(r: PlannerRecipe, s: PlannerStep): { base: BaseFood; method: BaseMethod; food: string; grams: number } | null {
  if (s.kind !== "boil" || !s.bowls?.length || s.hobId) return null;
  const ings = r.ingredients.filter((i) => i.group && s.bowls!.includes(i.group));
  if (!ings.length) return null;
  const foods = new Set(ings.map((i) => i.foodId ?? ""));
  if (foods.size !== 1) return null;
  const food = [...foods][0];
  const base = baseFood(food);
  if (!base) return null;
  const grams = ings.reduce((x, i) => x + gramsOfIngredient(i, r.scale ?? 1), 0);
  return grams > 0 ? { base, method: baseMethod(base, s.text), food, grams } : null;
}

// ─── Liquides écrits dans les textes ───

const num = (s: string) => Number(s.replace(",", "."));
const toL = (n: number, unit: string) => (/^m/i.test(unit) ? n / 1000 : /^c/i.test(unit) ? n / 100 : n);
const LIQUID = /(\d+(?:[,.]\d+)?)\s*(ml|cl|l|litres?)\b(?:\s+(?:d'eau|de bouillon|de lait|de vin))?/gi;

/** Litres d'eau ou de bouillon écrits dans un texte (« + 540 ml d'eau », « eau à hauteur (environ 500 ml) »). */
export function liquidInText(text: string): number {
  let l = 0;
  for (const m of text.matchAll(LIQUID)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 3);
    // « 10 cl d'eau » d'une maïzena délayée compte aussi ; « 2 L » d'une contenance de récipient, non.
    if (/^\s*[A-Z]/.test(after)) continue;
    if (!/d'eau|de bouillon|de lait|de vin|eau|bouillon/i.test(text.slice(Math.max(0, m.index! - 30), m.index! + m[0].length + 20))) continue;
    l += toL(num(m[1]), m[2]);
  }
  return Math.round(l * 100) / 100;
}

/** Liquides des bols décrits dans le texte de prep : « Bol C : 2 cubes de bouillon dans 1,3 L d'eau chaude ». */
export function bowlLiquids(prepTexts: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of prepTexts) {
    const parts = t.split(/\b[Bb]ol ([A-Z])\s*:/);
    for (let k = 1; k < parts.length; k += 2) {
      const l = liquidInText(parts[k + 1].split(/\.\s/)[0]);
      if (l > 0) out.set(parts[k], (out.get(parts[k]) ?? 0) + l);
    }
  }
  return out;
}

// ─── Volumes ───

const POT_BULK: [RegExp, number][] = [[/epinard|salade|roquette|blette|kale/, 1.5]];
const BOWL_BULK: [RegExp, number][] = [
  [/epinard|salade|roquette|blette|kale|persil|coriandre|basilic|ciboulette/, 5],
  [/champignon/, 2.2],
  [/haricots_verts|brocoli|chou_fleur|poivron|courgette|aubergine|navet/, 1.8],
  [/oignon|echalote|poireau|gingembre|ail/, 1.6],
  [/patate|pomme_de_terre|carotte|potiron|butternut/, 1.4],
  [/emmental|parmesan|mozzarella|rape|fromage/, 1.6],
  [/riz|pates|semoule|quinoa|boulgour|lentille|pois_casses|farine|sucre/, 1.25],
  [/poulet|porc|boeuf|dinde|veau|agneau|merguez|saucisse|chorizo|filet|echine|saute/, 1],
];
const bulk = (table: [RegExp, number][], food: string | null | undefined) => table.find(([re]) => re.test(food ?? ""))?.[1] ?? 1;

/** Litres d'un mélange dans un récipient sur le feu (mijoté, sauce, one-pot). */
export function potLiters(ings: Pick<PlannerIngredient, "grams" | "units" | "foodId">[], scale = 1, liquidL = 0): number {
  return ings.reduce((x, i) => x + (gramsOfIngredient(i, scale) / 1000) * bulk(POT_BULK, i.foodId), 0) + liquidL;
}

/** Litres d'un bol de prep (morceaux crus, liquides du bol compris). */
export function bowlLiters(ings: Pick<PlannerIngredient, "grams" | "units" | "foodId">[], scale = 1, liquidL = 0): number {
  return ings.reduce((x, i) => x + (gramsOfIngredient(i, scale) / 1000) * bulk(BOWL_BULK, i.foodId), 0) + liquidL;
}

/** Contenance d'un récipient : celle notée, sinon estimée d'après ses mesures (fond × hauteur), sinon inconnue. */
export function vesselLiters(e: Pick<PlannerEquipment, "capacityL" | "dimsJson">): number | null {
  if (e.capacityL != null && e.capacityL > 0) return e.capacityL;
  const d = e.dimsJson ?? {};
  const cm = typeof d.diameterCm === "number" ? d.diameterCm : typeof d.baseCm === "number" ? d.baseCm : null;
  if (cm == null) return null;
  const h = typeof d.heightCm === "number" ? d.heightCm : cm * 0.55;
  return Math.round(((Math.PI / 4) * cm * cm * h) / 100) / 10;
}

/** Ce qu'on peut y mettre pour une étape : contenance × remplissage (à l'ébullition, ou mijoté). */
export function usableLiters(e: Pick<PlannerEquipment, "capacityL" | "dimsJson">, kind: StepKind | "boil" | "stew"): number | null {
  const l = vesselLiters(e);
  return l == null ? null : l * (kind === "boil" ? FILL.boil : FILL.stew);
}

/** Surface utile d'un plat ou d'une plaque (cm²), d'après « 28x21 ». */
export function dishArea(e: Pick<PlannerEquipment, "dimsJson">): number | null {
  const d = e.dimsJson ?? {};
  const v = d.innerCm ?? d.cm ?? d.baseCm;
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/);
  return m ? Math.round(num(m[1]) * num(m[2])) : null;
}

// ─── Ce que contient chaque récipient, étape par étape ───

export interface StepLoad {
  /** Litres au plus fort de l'étape, dans son récipient. */
  liters: number;
  /** Ce qui compte pour un récipient sur le feu : à l'ébullition, ou mijoté. */
  mode: "boil" | "stew";
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
const STOP = new Set(["les", "des", "pour", "dans", "avec", "frais", "fraîche", "nature", "sans", "une", "facultatif", "morceaux", "cubes", "émincés", "émincé", "râpé", "râpés"]);

/**
 * Litres au plus fort de chaque étape de cuisson dans un récipient de `potIds` (casseroles, faitout,
 * cocotte) : ce que ses bols y ont mis depuis le début dans ce récipient, l'eau écrite dans les textes,
 * l'eau des cuissons de base ; à la dernière étape du récipient principal (le dernier mijoté), ce qui a
 * été saisi à la poêle avant et la viande hors bol (« le porc et son jus »).
 */
export function stepLoads(r: PlannerRecipe, isPot: (id: string) => boolean, isPan: (id: string) => boolean): Map<number, StepLoad> {
  const out = new Map<number, StepLoad>();
  const scale = r.scale ?? 1;
  const liquids = bowlLiquids(r.steps.filter((s) => s.kind === "prep").map((s) => s.text));
  const ingsOf = (bowls: string[] | undefined) => r.ingredients.filter((i) => i.group && (bowls ?? []).includes(i.group));
  const cooking = r.steps.map((s, si) => ({ s, si })).filter(({ s }) => s.kind !== "prep" && s.kind !== "cool");
  const main = [...cooking].reverse().find(({ s }) => s.equipmentId && isPot(s.equipmentId) && !baseOfStep(r, s));
  const mainLast = main ? Math.max(...cooking.filter(({ s }) => s.equipmentId === main.s.equipmentId).map(({ si }) => si)) : -1;
  const potTexts = main ? cooking.filter(({ s }) => s.equipmentId === main.s.equipmentId || (s.equipmentId && isPan(s.equipmentId))).map(({ s }) => s.text.toLowerCase()).join(" ") : "";
  const loose = r.ingredients.filter((i) => !i.group && !i.pantry && !i.side && words(i.item).some((w) => potTexts.includes(w)));
  const seen = new Map<string, { ings: PlannerIngredient[]; liquid: number; bowls: Set<string> }>();
  for (const { s, si } of cooking) {
    const v = s.equipmentId;
    if (!v || !isPot(v)) continue;
    const b = baseOfStep(r, s);
    if (b) {
      out.set(si, { liters: baseLiters(b.base, b.method, b.grams / 1000), mode: "boil" });
      continue;
    }
    const acc = seen.get(v) ?? { ings: [], liquid: 0, bowls: new Set<string>() };
    for (const g of s.bowls ?? []) {
      if (acc.bowls.has(g)) continue;
      acc.bowls.add(g);
      acc.ings.push(...ingsOf([g]));
      acc.liquid += liquids.get(g) ?? 0;
    }
    acc.liquid += liquidInText(s.text);
    seen.set(v, acc);
    let ings = acc.ings;
    let liquid = acc.liquid;
    if (si === mainLast) {
      const pans = cooking.filter(({ s: p, si: pi }) => pi < si && p.equipmentId && isPan(p.equipmentId));
      const panBowls = [...new Set(pans.flatMap(({ s: p }) => p.bowls ?? []))].filter((g) => !acc.bowls.has(g));
      ings = [...ings, ...ingsOf(panBowls), ...loose];
      liquid += panBowls.reduce((x, g) => x + (liquids.get(g) ?? 0), 0);
      // « Eau jusqu'à couvrir » sans quantité : environ 40 % du volume des solides.
      if (/jusqu'à couvrir|à hauteur|couvre d'eau/i.test(cooking.filter(({ s: p }) => p.equipmentId === v).map(({ s: p }) => p.text).join(" ")) && liquid < 0.1) liquid += 0.4 * potLiters(ings, scale);
    }
    const boiling = s.kind === "boil";
    out.set(si, { liters: Math.round((potLiters(ings, scale, liquid) + (boiling && !ings.length ? 1.5 : 0)) * 100) / 100, mode: boiling ? "boil" : "stew" });
  }
  return out;
}

/** Litres nécessaires dans chaque récipient d'une recette (le plus fort de ses étapes) et le mode qui compte. */
export function vesselNeeds(r: PlannerRecipe, isPot: (id: string) => boolean, isPan: (id: string) => boolean): Map<string, StepLoad> {
  const out = new Map<string, StepLoad>();
  for (const [si, load] of stepLoads(r, isPot, isPan)) {
    const v = r.steps[si].equipmentId!;
    const cur = out.get(v);
    // Comparer à remplissage égal : un litre qui bout pèse plus qu'un litre qui mijote.
    const eff = (x: StepLoad) => x.liters / (x.mode === "boil" ? FILL.boil : FILL.stew);
    if (!cur || eff(load) > eff(cur)) out.set(v, load);
  }
  return out;
}

/** Le récipient tient-il ce volume ? `null` = contenance inconnue (on ne peut pas dire non). */
export function holds(e: Pick<PlannerEquipment, "capacityL" | "dimsJson">, load: StepLoad): boolean | null {
  const u = usableLiters(e, load.mode);
  return u == null ? null : u + 1e-6 >= load.liters;
}

/** « 1,7 L » */
export const fmtL = (l: number) => `${(Math.round(l * 10) / 10).toLocaleString("fr-FR")} L`;
