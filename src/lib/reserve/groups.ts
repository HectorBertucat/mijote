// Les groupes d'un plat servis séparément (pur, testé : tests/reserve.test.ts) : « le poulet et sa
// sauce », « le riz », « les haricots verts ». Chaque groupe se pèse en fin de session et chaque
// portion en a ses grammes.
//
// Règles :
// - une fiche peut les déclarer (`serve` : libellé et bols) ; sinon ils se déduisent des étapes ;
// - deux bols cuits à la même étape, ou dans le même récipient à deux étapes de cuisson qui se
//   suivent, vont ensemble ; une étape qui reprend le produit d'une autre (products.ts : « le poulet
//   saisi dans la sauce ») les réunit ; un bol repris plus tard (les champignons poêlés, ajoutés à la
//   cocotte) aussi ;
// - un ingrédient hors bol va avec la première étape de cuisson qui le nomme (la viande hors bol : la
//   première saisie sans bol), sinon avec le plat ;
// - une garniture cuite à part (`side` de la fiche) est toujours son propre groupe ;
// - un groupe de moins de 4 % des grammes crus (une sauce d'herbes) rejoint le plat, sauf féculent
//   ou légume ;
// - le plat (`main`) est le plus lourd des groupes qui ne sont ni féculent ni légume ; il passe en tête.
import { recipeFlow } from "@/lib/session/products";
import { gramsOfIngredient } from "@/lib/session/capacity";
import type { PlannerIngredient, PlannerRecipe, PlannerStep } from "@/lib/session/planner";

export type GroupKind = "main" | "starch" | "veg" | "other";

/** Un groupe déclaré dans une fiche : son libellé, ses bols, et ce qu'il est (sinon déduit). */
export interface ServeDecl {
  label: string;
  bowls: string[];
  kind?: GroupKind;
  /** `false` : un féculent servi à part qui reste dans la recette, pas une base du foyer (bases.ts). */
  base?: boolean;
}

export interface ServeGroup {
  key: string;
  label: string;
  kind: GroupKind;
  /** Rangs des ingrédients (dans la fiche) qui le composent. */
  items: number[];
  /** Poids cuit estimé d'après les grammes crus (× scale), quand on ne l'a pas pesé. */
  estG: number;
}

/** Les féculents (poids cuit ÷ cru) et les légumes servis à part. */
const STARCH: [RegExp, string, number][] = [
  [/^riz/, "riz", 2.5],
  [/^(pates|orzo|spaghetti|penne|coquillettes|macaroni|fusilli|tagliatelles)/, "pâtes", 2.2],
  [/^semoule/, "semoule", 2.2],
  [/^quinoa/, "quinoa", 2.6],
  [/^boulgour/, "boulgour", 2.5],
  [/^pomme_de_terre/, "pommes de terre", 0.95],
  [/^patate_douce/, "patates douces", 0.9],
];
const VEG: [RegExp, string][] = [
  [/^haricots_verts/, "haricots verts"],
  [/^brocoli/, "brocoli"],
  [/^chou_fleur/, "chou-fleur"],
  [/^petits_pois/, "petits pois"],
  [/^epinards/, "épinards"],
  [/^courgette/, "courgettes"],
  [/^carotte/, "carottes"],
];
/** Le plat cuit perd de l'eau : poids cuit ≈ 82 % du cru. */
export const DISH_YIELD = 0.82;
/** Sous 4 % des grammes crus, un groupe rejoint le plat. */
export const MIN_GROUP_SHARE = 0.04;

const MEAT = /^(poulet|filet_poulet|haut_cuisse|porc|saute_porc|echine|filet_mignon|boeuf|veau|agneau|dinde|canard|merguez|saucisse|chorizo|lardons|jambon|saumon|cabillaud|thon|crevette)/;
const isMeat = (food: string | null | undefined) => !!food && MEAT.test(food);
const starchOf = (food: string | null | undefined) => (food ? STARCH.find(([re]) => re.test(food)) : undefined);
const vegOf = (food: string | null | undefined) => (food ? VEG.find(([re]) => re.test(food)) : undefined);
const cooks = (s: PlannerStep) => s.kind !== "prep" && s.kind !== "cool";

/** « Haricots verts » → « haricots-verts » : une clé stable, sans accent. */
export const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "groupe";

/** Le premier mot d'un ingrédient, en minuscules (« Merguez (6) » → « merguez »). */
const firstWord = (item: string) => item.split(/[\s,(]/)[0].toLowerCase();

function find(parent: Map<string, string>, x: string): string {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  parent.set(x, r);
  return r;
}

/** Les groupes d'une recette, le plat en tête. `decl` : ceux de la fiche, s'il y en a. */
export function serveGroups(r: PlannerRecipe, decl?: ServeDecl[] | null): ServeGroup[] {
  const scale = r.scale ?? 1;
  const used = r.ingredients.map((i, n) => ({ i, n })).filter(({ i }) => !i.optional);
  const grams = (i: PlannerIngredient) => gramsOfIngredient(i, scale);
  const comps = decl?.length ? declared(r, decl) : deduced(r);
  // Les composantes → groupes : leurs ingrédients (non facultatifs), leur nature.
  let raw = comps
    .map((c) => {
      const items = used.filter(({ n }) => c.items.includes(n));
      const g = items.reduce((s, { i }) => s + grams(i), 0);
      const starchy = items.filter(({ i }) => starchOf(i.foodId));
      const veggy = items.filter(({ i }) => vegOf(i.foodId));
      const sw = starchy.reduce((s, { i }) => s + grams(i), 0);
      const vw = veggy.reduce((s, { i }) => s + grams(i), 0);
      // Féculent : les féculents y pèsent au moins 30 % (pâtes et haricots dans la même eau) ; légume : les
      // légumes plus de 80 %. Avec de la viande ou du poisson, c'est le plat (poulet rôti avec les patates douces).
      const meat = items.some(({ i }) => isMeat(i.foodId));
      const kind: GroupKind = c.kind ?? (meat ? "other" : sw > 0 && sw >= 0.3 * g ? "starch" : vw > 0 && vw > 0.8 * g ? "veg" : "other");
      const labels = [...new Set([...starchy, ...veggy].sort((a, b) => grams(b.i) - grams(a.i)).map(({ i }) => starchOf(i.foodId)?.[1] ?? vegOf(i.foodId)![1]))];
      const heaviest = [...items].sort((a, b) => grams(b.i) - grams(a.i))[0];
      const label = c.label ?? (kind === "starch" || kind === "veg" ? labels.join(" et ") : heaviest ? firstWord(heaviest.i.item) : "plat");
      const estG = items.reduce((s, { i }) => s + grams(i) * (starchOf(i.foodId)?.[2] ?? (kind === "veg" ? 1 : DISH_YIELD)), 0);
      return { label, kind, items: items.map(({ n }) => n), g, estG, side: c.side, declared: c.label != null, meat };
    })
    .filter((c) => c.items.length);
  const total = raw.reduce((s, c) => s + c.g, 0) || 1;
  const mainOf = (list: typeof raw) => {
    const others = list.filter((c) => c.kind === "other" || c.kind === "main");
    return [...(others.length ? others : list)].sort((a, b) => (b.kind === "main" ? 1 : 0) - (a.kind === "main" ? 1 : 0) || Number(b.meat) - Number(a.meat) || b.g - a.g)[0];
  };
  // Les petits groupes rejoignent le plat.
  const main = mainOf(raw);
  if (main) {
    for (const c of raw) {
      if (c === main || c.declared || (c.g > 0 && (c.side || c.kind === "starch" || c.kind === "veg" || c.g / total >= MIN_GROUP_SHARE))) continue;
      main.items.push(...c.items);
      main.g += c.g;
      main.estG += c.estG;
      c.items = [];
    }
    raw = raw.filter((c) => c.items.length);
    main.kind = "main";
    if (!main.declared) main.label = "plat";
  }
  const order: GroupKind[] = ["main", "starch", "veg", "other"];
  const sorted = raw.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.g - a.g);
  const keys = new Set<string>();
  return sorted.map((c) => {
    let key = keyOf(c.label);
    for (let k = 2; keys.has(key); k++) key = `${keyOf(c.label)}-${k}`;
    keys.add(key);
    return { key, label: c.label, kind: c.kind, items: c.items.sort((a, b) => a - b), estG: Math.round(c.estG) };
  });
}

interface Comp {
  items: number[];
  label?: string;
  kind?: GroupKind;
  side?: boolean;
}

/** Les groupes déclarés : chacun ses bols ; ce qui n'y est pas va dans le premier (le plat). */
function declared(r: PlannerRecipe, decl: ServeDecl[]): Comp[] {
  const comps: Comp[] = decl.map((d) => ({ items: [], label: d.label, kind: d.kind }));
  r.ingredients.forEach((i, n) => {
    const k = decl.findIndex((d) => i.group && d.bowls.includes(i.group));
    comps[k >= 0 ? k : 0].items.push(n);
  });
  return comps;
}

/** Les groupes déduits des étapes (voir l'en-tête). */
function deduced(r: PlannerRecipe): Comp[] {
  const parent = new Map<string, string>();
  const node = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(parent, node(a));
    const rb = find(parent, node(b));
    if (ra !== rb) parent.set(ra, rb);
  };
  const sideBowls = new Set(r.ingredients.filter((i) => i.side && i.group).map((i) => i.group!));
  // Chaque étape de cuisson a son nœud ; ses bols s'y rattachent.
  const stepNode = (k: number) => node(`#${k}`);
  r.steps.forEach((s, k) => {
    if (!cooks(s)) return;
    stepNode(k);
    for (const b of s.bowls ?? []) if (!sideBowls.has(b)) union(`#${k}`, `bol:${b}`);
  });
  // Même récipient : deux cuissons qui se suivent sont la suite du même plat ; une poêle ou une cocotte
  // reprise plus tard aussi (les champignons ajoutés à la cocotte), mais pas une eau de cuisson (vidée
  // entre le riz et les haricots) ni le four (deux plaques, deux choses).
  const cooking = r.steps.map((s, k) => ({ s, k })).filter(({ s }) => cooks(s));
  const hasSide = (s: PlannerStep) => (s.bowls ?? []).some((y) => sideBowls.has(y));
  cooking.forEach((b, x) => {
    if (!b.s.equipmentId || hasSide(b.s)) return;
    for (let y = x - 1; y >= 0; y--) {
      const a = cooking[y];
      if (a.s.equipmentId !== b.s.equipmentId || hasSide(a.s)) continue;
      const next = y === x - 1;
      if (next || (a.s.kind !== "boil" && b.s.kind !== "boil" && b.s.equipmentId !== "oven")) union(`#${a.k}`, `#${b.k}`);
      break;
    }
  });
  // Une reprise réunit les deux étapes.
  const { uses } = recipeFlow(r);
  for (const [order, list] of uses) for (const u of list) if (cooks(r.steps[order - 1]) && cooks(r.steps[u.from - 1])) union(`#${order - 1}`, `#${u.from - 1}`);
  // Les ingrédients hors bol : la première cuisson qui les nomme ; la viande hors bol, la première saisie sans bol.
  const words = (i: PlannerIngredient) => [firstWord(i.item), ...(i.foodId ? i.foodId.split("_").filter((w) => w.length > 3) : [])];
  const said = (s: PlannerStep, i: PlannerIngredient) => {
    const text = [s.text, ...(s.phases ?? []).map((p) => p.text)].join(" ").toLowerCase();
    return words(i).some((w) => w.length > 2 && text.includes(w));
  };
  const loose = new Map<number, string>();
  r.ingredients.forEach((i, n) => {
    if (i.group && (i.side || !sideBowls.has(i.group))) {
      loose.set(n, i.side ? `side:${i.group}` : `bol:${i.group}`);
      if (!parent.has(`bol:${i.group}`)) node(`bol:${i.group}`);
      if (i.side) node(`side:${i.group}`);
      return;
    }
    const k = cooking.find(({ s }) => said(s, i))?.k ?? (isMeat(i.foodId) ? cooking.find(({ s }) => s.kind === "sear" && !(s.bowls ?? []).length)?.k : undefined);
    if (k != null) loose.set(n, `#${k}`);
  });
  // Composantes : par racine.
  const byRoot = new Map<string, Comp>();
  const rest: number[] = [];
  r.ingredients.forEach((i, n) => {
    const at = loose.get(n);
    if (!at) return void rest.push(n);
    const root = find(parent, node(at));
    const c = byRoot.get(root) ?? { items: [], side: at.startsWith("side:") };
    c.items.push(n);
    byRoot.set(root, c);
  });
  const comps = [...byRoot.values()];
  // Le reste (sel, huile qu'aucune étape ne nomme) : avec le plat, décidé plus loin (premier groupe « other » le plus lourd).
  if (rest.length) comps.push({ items: rest });
  return mergeRest(r, comps, rest);
}

/** Le reste sans étape rejoint la composante la plus lourde qui n'est ni féculent ni légume. */
function mergeRest(r: PlannerRecipe, comps: Comp[], rest: number[]): Comp[] {
  if (!rest.length) return comps;
  const others = comps.filter((c) => c.items !== rest && !c.side);
  const weight = (c: Comp) => c.items.reduce((s, n) => s + (starchOf(r.ingredients[n].foodId) || vegOf(r.ingredients[n].foodId) ? 0 : gramsOfIngredient(r.ingredients[n])), 0);
  const target = [...others].sort((a, b) => weight(b) - weight(a))[0];
  if (!target || weight(target) === 0) return comps;
  target.items.push(...rest);
  return comps.filter((c) => c.items !== rest);
}
