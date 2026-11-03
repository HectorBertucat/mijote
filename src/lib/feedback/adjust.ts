// Ajustements tirés des retours de goût (pur, testé : tests/gouts.test.ts). Des règles en code, d'abord :
// chaque étiquette négative change des quantités de la fiche, sans jamais passer sous le bas du repère de
// protéines de quelqu'un qui l'atteignait. Le résultat est une variante (l'originale ne bouge pas), avec
// l'aperçu chiffré de la part de chacun avant et après. L'IA reste en option, par l'atelier (« Ajuster »).
//
// Règles :
// - remplacements notés (patate douce → pomme de terre) : appliqués d'abord (swap.ts) ;
// - « sec » : la sauce (laitages, crème, coulis) × 1,5 ; sans sauce, un bouillon versé sur le plat ; la
//   sauce servie à part va dans chaque portion (elle est pesée avec, src/lib/reserve/groups.ts) ;
// - « trop dense » : la viande × 0,85, remontée par pas de 0,05 tant que quelqu'un passerait
//   sous son bas de protéines ; les légumes × 1,4, ou des poivrons rôtis avec le féculent ou la viande ;
// - « trop gras » : huile et beurre × 0,7 ;
// - « fade » : un citron pressé au service, et le conseil (herbes, sel) ;
// - « trop épicé » : les épices piquantes pesées × 0,6, le reste à table ;
// - « portion trop grosse » : rien dans la fiche (la part suit le repère de chacun) : un conseil.
import { computeNutrition, type Macros } from "@/lib/nutrition/compute";
import { portionOf, type Member } from "@/lib/eaters/core";
import type { RecipeInput } from "@/lib/recipes/format";
import { TAG_LABEL, type TasteTag } from "./core";
import { familyOfFood, foodWord, swapRecipe, type Swap } from "./swap";

type Ing = RecipeInput["ingredients"][number];

export const SAUCE_FOODS = new Set(["skyr", "yaourt", "creme_legere", "lait_coco", "pulpe_tomate", "lait_demi"]);
const FAT_FOODS = new Set(["huile", "beurre"]);
const SPICY = /piment|harissa|chili|cayenne|sriracha|tabasco|curry|colombo|espelette/i;
/** Aromates : pas des légumes qui allègent une portion. */
const AROMATIC = new Set(["oignon", "echalote", "ail", "gingembre", "persil"]);

export const SAUCE_FACTOR = 1.5;
export const MEAT_FACTOR = 0.85;
export const VEG_FACTOR = 1.4;
export const FAT_FACTOR = 0.7;
export const SPICE_FACTOR = 0.6;

export interface Change {
  tag: TasteTag | "swap";
  /** Ce qui change, en clair : « Skyr nature : 200 → 300 g ». */
  text: string;
}

export interface PreviewRow {
  personId: string;
  name: string;
  before: { units: number; kcal: number | null; protein: number | null };
  after: { units: number; kcal: number | null; protein: number | null };
  proteinMin: number | null;
}

export interface Adjustment {
  recipe: RecipeInput;
  changes: Change[];
  /** Conseils ajoutés au « conseil » de la fiche. */
  notes: string[];
  preview: PreviewRow[];
  /** Pour le nom de la variante : « plus moelleuse », « aux pommes de terre ». */
  title: string;
  /** Les étiquettes prises en compte. */
  tags: TasteTag[];
  /** Rien ne change (aucune règle ne s'applique). */
  empty: boolean;
}

const roundG = (g: number) => (g >= 500 ? Math.round(g / 50) * 50 : g >= 100 ? Math.round(g / 10) * 10 : Math.round(g));
const fmtG = (g: number) => (g >= 1000 ? `${(g / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg` : `${Math.round(g)} g`);
const short = (item: string) => item.split(/[,(]/)[0].trim();
const nut = (r: RecipeInput) =>
  computeNutrition(
    r.ingredients.filter((i) => !i.optional).map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })),
    r.servingsUnits
  );

/** La part de chacun d'une fiche (repère compris), d'après ses macros par unité. */
function parts(perUnit: Macros, household: Member[]) {
  return household.map((m) => ({ m, p: portionOf({ baseUnits: m.units, ref: m.ref }, { kcalUnit: perUnit.kcal > 0 ? perUnit.kcal : null, proteinUnit: perUnit.protein }) }));
}

/** Les ingrédients qui pèsent (non facultatifs), avec leur rang. */
const lines = (r: RecipeInput, test: (i: Ing) => boolean) => r.ingredients.map((i, n) => ({ i, n })).filter(({ i }) => !i.optional && test(i));

function scaleLine(r: RecipeInput, n: number, k: number): { recipe: RecipeInput; text: string } | null {
  const i = r.ingredients[n];
  if (i.grams == null || i.grams <= 0) return null;
  const g = roundG(i.grams * k);
  if (g === i.grams) return null;
  const ingredients = [...r.ingredients];
  const lineRaw = i.lineRaw.replace(/^\s*\d+(?:[.,]\d+)?\s*(kg|g|ml|cl|l)\b/i, (m, unit: string) => {
    const u = unit.toLowerCase();
    const v = u === "kg" || u === "l" ? g / 1000 : u === "cl" ? g / 10 : g;
    return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${unit}`;
  });
  ingredients[n] = { ...i, grams: g, lineRaw: lineRaw === i.lineRaw && !/^\s*\d/.test(i.lineRaw) ? `${fmtG(g)} ${i.lineRaw}` : lineRaw };
  return { recipe: { ...r, ingredients }, text: `${short(i.item)} : ${fmtG(i.grams)} → ${fmtG(g)}` };
}

/** Ces lignes × k, chaque changement noté. */
function scaleLines(r: RecipeInput, ns: number[], k: number, tag: TasteTag, changes: Change[]): RecipeInput {
  let out = r;
  for (const n of ns) {
    const s = scaleLine(out, n, k);
    if (!s) continue;
    out = s.recipe;
    changes.push({ tag, text: s.text });
  }
  return out;
}

/** Le bol où ranger un ajout : celui du féculent rôti ou des légumes (hors garniture à part), sinon de la viande. */
function bowlFor(r: RecipeInput): string | null {
  const g = (i: Ing) => i.grams ?? 0;
  const pick = (test: (i: Ing) => boolean) => [...lines(r, (i) => !!i.group && !i.side && test(i))].sort((a, b) => g(b.i) - g(a.i))[0]?.i.group ?? null;
  return pick((i) => familyOfFood(i.food) === "feculent" || familyOfFood(i.food) === "legume") ?? pick((i) => familyOfFood(i.food) === "viande");
}

/** Ajoute une phrase au texte de la première prep qui prend ce bol (ou à la première prep). */
function sayInPrep(r: RecipeInput, bowl: string | null, sentence: string): RecipeInput {
  const k = r.steps.findIndex((s) => s.kind === "prep" && (!bowl || (s.bowls ?? []).includes(bowl)));
  const at = k >= 0 ? k : r.steps.findIndex((s) => s.kind === "prep");
  if (at < 0) return r;
  const steps = [...r.steps];
  steps[at] = { ...steps[at], text: `${steps[at].text.replace(/\s+$/, "")} ${sentence}` };
  return { ...r, steps };
}

const meatLines = (r: RecipeInput) => lines(r, (i) => familyOfFood(i.food) === "viande" && i.grams != null);

/** Applique « trop dense » avec un facteur de viande donné (et les légumes). */
function lighten(r: RecipeInput, meatK: number): { recipe: RecipeInput; changes: Change[] } {
  let out = r;
  const changes: Change[] = [];
  out = scaleLines(out, meatLines(out).map(({ n }) => n), meatK, "dense", changes);
  const veg = lines(out, (i) => familyOfFood(i.food) === "legume" && !AROMATIC.has(i.food ?? "") && !i.side && i.grams != null);
  if (veg.length) out = scaleLines(out, veg.map(({ n }) => n), VEG_FACTOR, "dense", changes);
  else {
    // Pas de légume : des poivrons, rôtis ou cuits avec le féculent (ou la viande), un quart du poids de viande.
    const meatG = meatLines(r).reduce((s, { i }) => s + (i.grams ?? 0), 0);
    const g = Math.max(200, Math.round((meatG * 0.25) / 50) * 50);
    const n = Math.max(1, Math.round(g / 150));
    const bowl = bowlFor(out);
    out = {
      ...out,
      ingredients: [...out.ingredients, { lineRaw: `${n} poivron${n > 1 ? "s" : ""}`, item: "Poivrons, en lanières", grams: g, group: bowl, food: "poivron" }],
    };
    out = sayInPrep(out, bowl, bowl ? `Bol ${bowl} : ajoute les poivrons en lanières.` : "Poivrons en lanières.");
    changes.push({ tag: "dense", text: `Poivrons en plus : ${fmtG(g)}${bowl ? ` (bol ${bowl})` : ""}` });
  }
  return { recipe: out, changes };
}

/**
 * Les ajustements d'une fiche pour ces étiquettes (et ces remplacements), avec l'aperçu de la part de
 * chacun. `household` : le foyer et ses repères (bas de protéines gardé).
 */
export function adjustRecipe(original: RecipeInput, tags: TasteTag[], household: Member[], swaps: Swap[] = []): Adjustment {
  const changes: Change[] = [];
  const notes: string[] = [];
  const titles: string[] = [];
  let r = original;

  // Remplacements d'abord.
  if (swaps.length) {
    const before = r;
    r = swapRecipe(r, swaps);
    for (const s of swaps) {
      const a = before.ingredients[s.position];
      const b = r.ingredients[s.position];
      if (a && b && a.food !== b.food) {
        changes.push({ tag: "swap", text: `${short(a.item)} → ${short(b.item)}` });
        titles.push(`aux ${foodWord(b.food!)}`);
      }
    }
  }

  if (tags.includes("sec")) {
    const sauce = lines(r, (i) => SAUCE_FOODS.has(i.food ?? "") && !i.side && i.grams != null);
    if (sauce.length) r = scaleLines(r, sauce.map(({ n }) => n), SAUCE_FACTOR, "sec", changes);
    else {
      const bowl = meatLines(r)[0]?.i.group ?? null;
      r = { ...r, ingredients: [...r.ingredients, { lineRaw: "1 cube de bouillon", item: "Bouillon (1 cube dans 25 cl d’eau), versé sur le plat en fin de cuisson", grams: 10, group: bowl, pantry: true, food: "bouillon_cube" }] };
      changes.push({ tag: "sec", text: "Bouillon versé sur le plat en fin de cuisson : 25 cl" });
    }
    // Une sauce servie à part va dans chaque portion (pesée avec, groupes de la réserve).
    const sauceBowls = new Set(lines(r, (i) => SAUCE_FOODS.has(i.food ?? "") && !!i.group).map(({ i }) => i.group!));
    const apart = r.serve?.find((g) => g.kind !== "main" && g.kind !== "starch" && g.kind !== "veg" && g.bowls.some((b) => sauceBowls.has(b)));
    if (apart) notes.push(`La ${apart.label} est pesée dans chaque portion : sers-la avec, dans un petit pot par boîte.`);
    if (meatLines(r).some(({ i }) => i.food === "filet_poulet" || i.food === "filet_mignon_porc")) notes.push("Viande maigre : sors-la dès qu’elle est cuite à cœur, elle sèche vite.");
    titles.push("plus moelleuse");
  }

  if (tags.includes("dense")) {
    // Le facteur de viande le plus bas qui garde chacun au-dessus de son bas de protéines (s'il l'atteignait).
    const base = parts(nut(r).perUnit, household);
    let k = MEAT_FACTOR;
    let tried = lighten(r, k);
    const ok = (x: RecipeInput) =>
      parts(nut(x).perUnit, household).every(({ m, p }, idx) => {
        const min = m.ref?.proteinMin;
        const was = base[idx].p.protein;
        return min == null || p.protein == null || was == null || was < min || p.protein >= min;
      });
    while (!ok(tried.recipe) && k < 1 - 1e-9) {
      k = Math.min(1, Math.round((k + 0.05) * 100) / 100);
      tried = lighten(r, k);
    }
    r = tried.recipe;
    changes.push(...tried.changes);
    if (k >= 1) notes.push("La viande reste : en retirer ferait passer quelqu’un sous son repère de protéines.");
    titles.push("plus légère en viande");
  }

  if (tags.includes("gras")) {
    r = scaleLines(r, lines(r, (i) => FAT_FOODS.has(i.food ?? "") && i.grams != null).map(({ n }) => n), FAT_FACTOR, "gras", changes);
    titles.push("moins grasse");
  }

  if (tags.includes("fade")) {
    if (!r.ingredients.some((i) => i.food === "citron" || i.food === "citron_vert")) {
      r = { ...r, ingredients: [...r.ingredients, { lineRaw: "1 citron", item: "Citron, le jus au service", units: 1, food: "citron" }] };
      changes.push({ tag: "fade", text: "Un citron pressé au service" });
    }
    notes.push("Au service : un trait de citron, des herbes fraîches, une pincée de sel.");
    titles.push("relevée");
  }

  if (tags.includes("epice")) {
    r = scaleLines(r, lines(r, (i) => SPICY.test(i.item) && i.grams != null).map(({ n }) => n), SPICE_FACTOR, "epice", changes);
    notes.push("Moitié des épices piquantes ; le reste à table, pour qui en veut.");
    titles.push("plus douce");
  }

  if (tags.includes("portion")) notes.push("La part suit le repère de chacun : pour des portions plus petites, revois l’objectif dans Santé.");

  if (notes.length) r = { ...r, tips: [r.tips, ...notes].filter(Boolean).join(" ") };

  const before = nut(original).perUnit;
  const after = nut(r).perUnit;
  const pb = parts(before, household);
  const pa = parts(after, household);
  const preview: PreviewRow[] = household.map((m, i) => ({
    personId: m.id,
    name: m.name,
    before: { units: pb[i].p.units, kcal: pb[i].p.kcal, protein: pb[i].p.protein },
    after: { units: pa[i].p.units, kcal: pa[i].p.kcal, protein: pa[i].p.protein },
    proteinMin: m.ref?.proteinMin ?? null,
  }));
  const used = tags.filter((t) => t !== "referais");
  return { recipe: r, changes, notes, preview, title: titles.join(", "), tags: used, empty: changes.length === 0 && notes.length === 0 };
}

/** Le nom et le slug d'une variante ajustée : « … (plus moelleuse) », slug « aux-pommes-de-terre » ou « ajustee ». */
export function variantNaming(original: Pick<RecipeInput, "name" | "slug">, adjusted: Pick<RecipeInput, "name">, a: Pick<Adjustment, "title" | "changes">): { name: string; slug: string } {
  const swapped = a.changes.some((c) => c.tag === "swap") && adjusted.name !== original.name;
  const rest = a.title
    .split(", ")
    .filter((t) => !(swapped && t.startsWith("aux ")))
    .join(", ");
  // Le nom garde le premier changement seulement : « … (plus moelleuse) ».
  const first = rest.split(", ")[0];
  const name = `${adjusted.name}${first ? ` (${first})` : ""}`;
  const slugPart = (swapped ? a.title.split(", ").find((t) => t.startsWith("aux ")) : null) ?? "ajustee";
  const slug = slugPart
    .toLowerCase()
    .replace(/œ/g, "oe")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { name, slug };
}

/** Une ligne lisible des étiquettes prises en compte : « sec, trop dense ». */
export const tagsLine = (tags: TasteTag[]) => tags.map((t) => TAG_LABEL[t]).join(", ");
