// Les bases du foyer (pur, testé : tests/bases.test.ts) : le riz, les haricots verts, les pommes de terre
// cuits à part en grande quantité et gardés dans de gros récipients, où chacun se sert à chaque repas ;
// quand le récipient de riz est vide, on en refait un.
//
// Règles :
// - un groupe servi à part (groups.ts) est une base quand c'est un féculent ou un légume d'un seul aliment
//   de base (riz, pâtes, semoule, pommes de terre, haricots verts…) ; mélangé au plat (riz cuit dans la
//   sauce, one-pot : il est dans le groupe du plat), ou deux bases dans la même eau (pâtes et haricots),
//   il reste dans la recette ; une fiche peut le dire (`serve[].base: false`) ;
// - la base d'un plat suit la proportion de la marmite (`ratio` : grammes de base par gramme de plat, à la
//   pesée) : elle ne compte pas dans ce qui reste du plat, et chaque portion mangée la retire du stock ;
// - un stock par base et par session (la somme des parts de ses plats), ou par cuisson « Refaire » ; une
//   portion puise dans le plus ancien récipient qui en a encore (premier cuit, premier servi) ; une
//   nouvelle pesée remplace ce qui reste ;
// - « à refaire » sous deux portions (la plus grande portion de base servie, 150 g sans portion connue) ;
// - refaire : de quoi servir les portions restantes des plats qui la prennent, au moins un gros récipient,
//   au plus tous ; le cru (÷ rendement), l'eau, la plus petite casserole de la cuisine qui la tient (sinon
//   en fournées), la durée ;
// - congeler : ce qui dépasse ce qui sera mangé avant la date limite au frigo, en portions, seulement ce
//   qui se congèle bien (la fiche pour un plat, l'aliment pour une base).
import { FILL, gramsOfIngredient } from "@/lib/session/capacity";
import type { PlannerRecipe } from "@/lib/session/planner";
import type { ReserveGroup } from "./core";
import type { ServeDecl, ServeGroup } from "./groups";

export interface BaseFamily {
  /** Clé stable, celle du groupe d'une marmite (« riz », « haricots-verts »). */
  key: string;
  label: string;
  /** « le riz », « les haricots verts ». */
  the: string;
  /** « du riz », « des haricots verts ». */
  some: string;
  /** « cru », « crues ». */
  raw: string;
  foods: RegExp;
  /** Poids cuit ÷ cru. */
  cookedYield: number;
  /** À l'absorption (l'eau mesurée) ou à grande eau (égouttée). */
  method: "absorb" | "bath";
  /** Litres d'eau par kilo de cru (et au moins `minWaterL` à grande eau). */
  waterLPerKg: number;
  cookMin: number;
  /** Repos à couvert, hors du feu. */
  restMin: number;
  rinse: boolean;
  fridgeDays: number;
  freeze: { ok: boolean; how: string };
  /** Kilos de cuit par litre de récipient (tassé sans écraser). */
  kgPerL: number;
}

const F = (key: string, label: string, the: string, some: string, raw: string, foods: RegExp, x: Omit<BaseFamily, "key" | "label" | "the" | "some" | "raw" | "foods">): BaseFamily => ({ key, label, the, some, raw, foods, ...x });

/** Les bases connues : rendement, cuisson, conservation, congélation (repères de cuisine arrondis). */
export const BASE_FAMILIES: BaseFamily[] = [
  F("riz", "riz", "le riz", "du riz", "cru", /^riz/, { cookedYield: 2.5, method: "absorb", waterLPerKg: 1.9, cookMin: 12, restMin: 10, rinse: true, fridgeDays: 4, freeze: { ok: true, how: "en portions, à plat dans des sacs ; il se réchauffe sans décongeler" }, kgPerL: 0.7 }),
  F("pates", "pâtes", "les pâtes", "des pâtes", "crues", /^(pates|orzo|spaghetti|penne|coquillettes|macaroni|fusilli|tagliatelles)/, { cookedYield: 2.2, method: "bath", waterLPerKg: 8, cookMin: 10, restMin: 0, rinse: false, fridgeDays: 4, freeze: { ok: true, how: "en portions, un peu plus molles ensuite : à réchauffer dans la sauce" }, kgPerL: 0.55 }),
  F("semoule", "semoule", "la semoule", "de la semoule", "crue", /^semoule/, { cookedYield: 2.2, method: "absorb", waterLPerKg: 1.1, cookMin: 1, restMin: 5, rinse: false, fridgeDays: 4, freeze: { ok: true, how: "en portions ; égrène-la au réchauffage" }, kgPerL: 0.6 }),
  F("quinoa", "quinoa", "le quinoa", "du quinoa", "cru", /^quinoa/, { cookedYield: 2.6, method: "absorb", waterLPerKg: 2.4, cookMin: 15, restMin: 5, rinse: true, fridgeDays: 5, freeze: { ok: true, how: "en portions, à plat" }, kgPerL: 0.6 }),
  F("boulgour", "boulgour", "le boulgour", "du boulgour", "cru", /^boulgour/, { cookedYield: 2.5, method: "absorb", waterLPerKg: 2.2, cookMin: 12, restMin: 5, rinse: false, fridgeDays: 5, freeze: { ok: true, how: "en portions, à plat" }, kgPerL: 0.6 }),
  F("pommes-de-terre", "pommes de terre", "les pommes de terre", "des pommes de terre", "crues", /^pomme_de_terre/, { cookedYield: 0.95, method: "bath", waterLPerKg: 2.5, cookMin: 25, restMin: 0, rinse: false, fridgeDays: 3, freeze: { ok: false, how: "elles deviennent farineuses et rendent de l'eau : à manger au frigo" }, kgPerL: 0.65 }),
  F("patates-douces", "patates douces", "les patates douces", "des patates douces", "crues", /^patate_douce/, { cookedYield: 0.9, method: "bath", waterLPerKg: 2.5, cookMin: 20, restMin: 0, rinse: false, fridgeDays: 4, freeze: { ok: true, how: "en morceaux ou en purée, en portions" }, kgPerL: 0.6 }),
  F("haricots-verts", "haricots verts", "les haricots verts", "des haricots verts", "crus", /^haricots_verts/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 8, restMin: 0, rinse: false, fridgeDays: 4, freeze: { ok: true, how: "blanchis, à plat dans des sacs" }, kgPerL: 0.4 }),
  F("brocoli", "brocoli", "le brocoli", "du brocoli", "cru", /^brocoli/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 6, restMin: 0, rinse: false, fridgeDays: 3, freeze: { ok: true, how: "blanchi, en bouquets" }, kgPerL: 0.35 }),
  F("chou-fleur", "chou-fleur", "le chou-fleur", "du chou-fleur", "cru", /^chou_fleur/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 8, restMin: 0, rinse: false, fridgeDays: 3, freeze: { ok: true, how: "blanchi, en bouquets" }, kgPerL: 0.4 }),
  F("petits-pois", "petits pois", "les petits pois", "des petits pois", "crus", /^petits_pois/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 6, restMin: 0, rinse: false, fridgeDays: 3, freeze: { ok: true, how: "en portions" }, kgPerL: 0.6 }),
  F("epinards", "épinards", "les épinards", "des épinards", "crus", /^epinards/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 3, restMin: 0, rinse: true, fridgeDays: 2, freeze: { ok: true, how: "pressés, en galets" }, kgPerL: 0.5 }),
  F("courgettes", "courgettes", "les courgettes", "des courgettes", "crues", /^courgette/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 8, restMin: 0, rinse: false, fridgeDays: 3, freeze: { ok: false, how: "elles rendent leur eau et deviennent molles : à manger au frigo" }, kgPerL: 0.5 }),
  F("carottes", "carottes", "les carottes", "des carottes", "crues", /^carotte/, { cookedYield: 1, method: "bath", waterLPerKg: 2.5, cookMin: 15, restMin: 0, rinse: false, fridgeDays: 4, freeze: { ok: true, how: "en rondelles, en portions" }, kgPerL: 0.55 }),
];

export const familyOfFood = (food: string | null | undefined): BaseFamily | null => (food ? (BASE_FAMILIES.find((f) => f.foods.test(food)) ?? null) : null);
export const baseFamily = (key: string): BaseFamily | null => BASE_FAMILIES.find((f) => f.key === key) ?? null;

/** Portion de base par défaut, sans portion servie connue. */
export const DEFAULT_BASE_PORTION_G = 150;
/** À grande eau : au moins 1,5 L (légumes), 2 L (pâtes). */
const minWaterL = (f: BaseFamily) => (f.key === "pates" ? 2 : 1.5);
/** Un gros récipient se remplit à 90 %. */
export const BOX_FILL = 0.9;

// ─── Base séparée ou mélangée ───

/**
 * Les groupes d'une marmite qui sont des bases (clé du groupe → clé de la base) : un féculent ou un légume
 * servi à part, fait d'un seul aliment de base (ceux de plus de 10 % du groupe, qui en font au moins 85 %).
 * Le groupe du plat n'en est jamais une (le riz cuit dans la sauce y est).
 */
export function separableBases(r: Pick<PlannerRecipe, "ingredients" | "scale">, groups: ServeGroup[], decl?: (ServeDecl & { base?: boolean })[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of groups) {
    if (g.kind !== "starch" && g.kind !== "veg") continue;
    if (decl?.some((d) => d.label === g.label && d.base === false)) continue;
    const items = g.items.map((n) => r.ingredients[n]).filter((i) => i && !i.optional);
    const w = (i: (typeof items)[number]) => gramsOfIngredient(i, r.scale ?? 1);
    const total = items.reduce((s, i) => s + w(i), 0);
    if (total <= 0) continue;
    const big = items.filter((i) => w(i) >= 0.1 * total);
    const fams = new Set(big.map((i) => familyOfFood(i.foodId)?.key ?? "-"));
    if (fams.size !== 1 || fams.has("-")) continue;
    if (big.reduce((s, i) => s + w(i), 0) < 0.85 * total) continue;
    out[g.key] = [...fams][0];
  }
  return out;
}

/**
 * Relie les bases d'une marmite à leur stock : `base` et la proportion de la marmite, par gramme de plat
 * (`ratio`) et par kcal de plat (`perKcal`, quand elles sont connues).
 */
export function linkBases(groups: ReserveGroup[], bases: Record<string, string>): ReserveGroup[] {
  const main = groups.find((g) => g.kind === "main");
  if (!main || main.g <= 0) return groups;
  const kcal = main.kcalG != null && main.kcalG > 0 ? main.g * main.kcalG : null;
  return groups.map((g) => (g !== main && bases[g.key] ? { ...g, base: bases[g.key], ratio: g.g / main.g, ...(kcal ? { perKcal: g.g / kcal } : {}) } : g));
}

/** Ce qui revient au plat d'une base, d'après ce qui reste du plat (la proportion de la marmite). */
export function baseShares(groups: Pick<ReserveGroup, "key" | "kind" | "base" | "ratio" | "perKcal" | "kcalG">[], left: Record<string, number>): Record<string, number> {
  const main = groups.find((g) => g.kind === "main");
  const out = { ...left };
  for (const g of groups) {
    if (!g.base || g.ratio == null) continue;
    const m = main ? (left[main.key] ?? 0) : 0;
    out[g.key] = Math.round(g.perKcal != null && main?.kcalG != null ? g.perKcal * m * main.kcalG : g.ratio * m);
  }
  return out;
}

// ─── Ce qui reste dans les récipients ───

export interface StockIn {
  id: string;
  family: string;
  /** Jour de cuisson : le plus ancien est servi d'abord. */
  cookedOn: string;
  createdAt: string;
  /** Grammes cuits au départ. */
  cookedG: number;
  /** Dernière pesée (grammes) et son instant : ce qui reste à cet instant. */
  g: number;
  at: string;
  /** Fini (vidé, jeté) : il ne sert plus ensuite. */
  closedAt?: string | null;
}

export interface TakeIn {
  family: string;
  at: string;
  g: number;
  /** Une boîte rangée à l'instant d'une pesée en sort ; une portion mangée à cet instant-là était déjà sortie. */
  box?: boolean;
}

/** Ce qui reste dans chaque récipient : chaque prise puise dans le plus ancien qui en a encore. */
export function stockLevels(stocks: StockIn[], takes: TakeIn[]): Record<string, number> {
  type Ev = { t: string; o: number; run: () => void };
  const rem = new Map<string, number>();
  const open: StockIn[] = [];
  const ev: Ev[] = [];
  for (const s of stocks) {
    ev.push({ t: s.createdAt, o: 1, run: () => (rem.set(s.id, s.cookedG), open.push(s)) });
    if (s.at > s.createdAt) ev.push({ t: s.at, o: 1, run: () => rem.set(s.id, s.g) });
    if (s.closedAt) ev.push({ t: s.closedAt, o: 3, run: () => open.splice(open.indexOf(s), 1) });
  }
  for (const k of takes) {
    ev.push({
      t: k.at,
      o: k.box ? 2 : 0,
      run: () => {
        let x = k.g;
        const fifo = open.filter((s) => s.family === k.family).sort((a, b) => a.cookedOn.localeCompare(b.cookedOn) || a.createdAt.localeCompare(b.createdAt));
        for (const s of fifo) {
          if (x <= 0) break;
          const d = Math.min(rem.get(s.id) ?? 0, x);
          rem.set(s.id, (rem.get(s.id) ?? 0) - d);
          x -= d;
        }
      },
    });
  }
  ev.sort((a, b) => a.t.localeCompare(b.t) || a.o - b.o);
  for (const e of ev) e.run();
  return Object.fromEntries(stocks.map((s) => [s.id, Math.max(0, Math.round(rem.get(s.id) ?? s.g))]));
}

/** Sous deux portions : à refaire. */
export const isLow = (leftG: number, portionG: number) => leftG < 2 * Math.max(portionG, 1);

// ─── Les gros récipients ───

export interface BigBoxes {
  count: number;
  liters: number;
}

/** Combien de gros récipients remplit une quantité cuite, et combien en tient un. */
export function boxesFor(f: BaseFamily, cookedG: number, box: BigBoxes): { n: number; perBoxG: number } | null {
  if (box.count <= 0 || box.liters <= 0) return null;
  const perBoxG = Math.round(box.liters * f.kgPerL * 1000 * BOX_FILL);
  return { n: Math.max(1, Math.ceil(cookedG / perBoxG)), perBoxG };
}

// ─── Refaire ───

export interface PotIn {
  id: string;
  name: string;
  liters: number | null;
}

export interface RemakePlan {
  family: string;
  /** Grammes cuits visés. */
  cookedG: number;
  rawG: number;
  /** Eau d'une fournée (litres). */
  waterL: number;
  pot: { id: string; name: string } | null;
  batches: number;
  /** De la casserole sur le feu au récipient rempli. */
  minutes: number;
  boxes: number | null;
  steps: string[];
}

const round = (x: number, step: number) => Math.max(step, Math.round(x / step) * step);
const fmtL = (l: number) => `${(Math.round(l * 10) / 10).toLocaleString("fr-FR")} L`;
const fmtG = (g: number) => (g >= 1000 ? `${(Math.round(g / 100) / 10).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);

/** Litres au plus fort d'une cuisson de `kg` de cru : 3,8 L par kilo à l'absorption, l'eau et 1,5 L par kilo à grande eau. */
export function remakeLiters(f: BaseFamily, kg: number): number {
  return f.method === "absorb" ? 3.8 * kg : Math.max(minWaterL(f), f.waterLPerKg * kg) + 1.5 * kg;
}

/**
 * Combien en cuire : de quoi servir ce qui est encore prévu (`needG`, au-delà de ce qui reste), au moins
 * un gros récipient, au plus tous ; sans gros récipient, au moins 600 g cuits.
 */
export function remakeTarget(f: BaseFamily, needG: number, box: BigBoxes): number {
  const b = boxesFor(f, 1, box);
  const min = b ? b.perBoxG : 600;
  const max = b ? b.perBoxG * box.count : Infinity;
  return Math.round(Math.min(max, Math.max(min, needG)) / 50) * 50;
}

/** Ce qu'il faut pour refaire une base : le cru, l'eau, la casserole, la durée, les gestes. */
export function remakePlan(f: BaseFamily, cookedG: number, pots: PotIn[], box: BigBoxes): RemakePlan {
  const rawG = round(cookedG / f.cookedYield, 50);
  const sized = pots.filter((p) => p.liters != null && p.liters > 0).sort((a, b) => a.liters! - b.liters!);
  const need = remakeLiters(f, rawG / 1000);
  let pot = sized.find((p) => p.liters! * FILL.boil + 1e-6 >= need) ?? null;
  let batches = 1;
  if (!pot && sized.length) {
    pot = sized[sized.length - 1];
    batches = Math.ceil(need / (pot.liters! * FILL.boil));
  }
  const kg = rawG / 1000 / batches;
  const waterL = Math.round((f.method === "absorb" ? f.waterLPerKg * kg : Math.max(minWaterL(f), f.waterLPerKg * kg)) * 10) / 10;
  const heat = Math.min(20, Math.round(6 + 2 * waterL));
  const minutes = batches * (heat + f.cookMin) + f.restMin + 15;
  const boxes = boxesFor(f, rawG * f.cookedYield, box);
  const where = pot ? `dans ${pot.name.toLocaleLowerCase("fr")}` : "dans ta plus grande casserole";
  const per = batches > 1 ? ` (en ${batches} fournées de ${fmtG(rawG / batches)})` : "";
  const steps = [
    `Pèse ${fmtG(rawG)} ${/^[aeéiouy]/i.test(f.label) ? "d'" : "de "}${f.label} (${f.raw})${f.rinse ? ", rince à l'eau froide" : ""}${per}.`,
    f.method === "absorb"
      ? `${fmtL(waterL)} d'eau salée ${where} ; à l'ébullition, verse ${f.the}, couvre, feu au minimum ${f.cookMin} min${f.restMin ? `, puis ${f.restMin} min hors du feu sans ouvrir` : ""}.`
      : `${fmtL(waterL)} d'eau salée ${where} ; à l'ébullition, ${f.the} ${f.cookMin} min, puis égoutte.`,
    `Laisse tiédir 15 min, puis ${boxes ? `remplis ${boxes.n > 1 ? `${boxes.n} gros récipients` : "un gros récipient"} (${fmtL(box.liters)})` : "mets dans un récipient fermé"} : ${f.fridgeDays} jours au frigo.`,
  ];
  return { family: f.key, cookedG: Math.round(rawG * f.cookedYield), rawG, waterL, pot: pot ? { id: pot.id, name: pot.name } : null, batches, minutes, boxes: boxes?.n ?? null, steps };
}

// ─── Congeler ───

/** Ce qu'on pourra encore manger d'un plat avant sa limite, sans repas prévu : deux repas par jour partagés entre ses plats. */
export function eatableWithoutPlan(daysLeft: number, dishesOpen: number): number {
  return Math.max(0, Math.floor(((Math.max(0, daysLeft) + 1) * 2) / Math.max(1, dishesOpen)));
}

export interface FreezeDishIn {
  freezerOk: boolean;
  people: { personId: string; name: string; /** Portions dans le récipient (hors boîtes). */ loose: number; /** Mangées d'ici la limite. */ eatBefore: number }[];
}

/**
 * Les portions d'un plat qui ne seront pas mangées avant la limite au frigo : à congeler si la fiche le
 * permet (`ok`), sinon à manger d'abord.
 */
export function freezeDish(x: FreezeDishIn): { ok: boolean; portions: number; people: { personId: string; name: string; n: number }[] } {
  const people = x.people.map((p) => ({ personId: p.personId, name: p.name, n: Math.max(0, p.loose - Math.max(0, p.eatBefore)) })).filter((p) => p.n > 0);
  return { ok: x.freezerOk, portions: people.reduce((s, p) => s + p.n, 0), people };
}

/** Ce qu'on peut congeler d'une base : ce qui dépasse ce qui sera servi avant la limite, en portions entières. */
export function freezeBase(f: BaseFamily, leftG: number, demandG: number, portionG: number): { portions: number; g: number } {
  if (!f.freeze.ok || portionG <= 0) return { portions: 0, g: 0 };
  const portions = Math.floor(Math.max(0, leftG - demandG) / portionG);
  return { portions, g: portions * Math.round(portionG) };
}

/** Ce qui se congèle mal dans un plat, d'après ses aliments : une note, sans changer la fiche. */
export function dishFreezeNote(foods: (string | null | undefined)[]): string | null {
  const has = (re: RegExp) => foods.some((f) => f && re.test(f));
  if (has(/^pomme_de_terre/)) return "les pommes de terre deviennent farineuses : mange-les d'abord, ou congèle sans";
  if (has(/^courgette/)) return "les courgettes rendent leur eau au réchauffage";
  if (has(/^creme/)) return "la sauce à la crème peut trancher : remue bien en réchauffant";
  return null;
}

/** L'aliment d'une base, pour son dessin (FoodIllu). */
export const BASE_FOOD: Record<string, string> = { riz: "riz_basmati", pates: "pates", semoule: "semoule", quinoa: "quinoa", boulgour: "boulgour", "pommes-de-terre": "pomme_de_terre", "patates-douces": "patate_douce", "haricots-verts": "haricots_verts", brocoli: "brocoli", "chou-fleur": "chou_fleur", "petits-pois": "petits_pois", epinards: "epinards", courgettes: "courgette", carottes: "carotte" };

/** Les bases d'une session, toutes recettes ensemble : grammes cuits et gros récipients à remplir. */
export function basesToFill(groups: { base?: string; g: number }[], box: BigBoxes): { family: string; label: string; the: string; cookedG: number; boxes: number | null; liters: number }[] {
  const by = new Map<string, number>();
  for (const g of groups) if (g.base && g.g > 0) by.set(g.base, (by.get(g.base) ?? 0) + g.g);
  return BASE_FAMILIES.filter((f) => by.has(f.key)).map((f) => {
    const cookedG = Math.round(by.get(f.key)!);
    return { family: f.key, label: f.label, the: f.the, cookedG, boxes: boxesFor(f, cookedG, box)?.n ?? null, liters: box.liters };
  });
}
