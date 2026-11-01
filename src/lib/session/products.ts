// Produits intermédiaires d'une recette (pur, testé : tests/session-produits.test.ts). Une étape fait
// quelque chose (« le poulet saisi », « la sauce », « le riz ») qu'une étape suivante reprend
// (« Poulet dans la sauce, 8 min à 3 » reprend le poulet saisi à la poêle et la sauce de la cocotte).
// Rien n'est écrit dans les fiches : le produit d'une étape se déduit de ce qu'elle cuit (ses bols, une
// cuisson de base, un mot de plat comme « sauce » ou « béchamel ») ; ce qu'une étape reprend, des mots
// de son texte qui nomment le produit d'une étape d'avant (hors des incises « pendant que… », « dès
// que… », et hors de ses propres bols pas encore cuits). Le planificateur en tire des dépendances (une
// étape ne part pas avant ce qu'elle reprend) et l'écran les nomme, avec d'où elles viennent.
import type { PlannerIngredient, PlannerRecipe, PlannerStep, StepKind } from "./planner";
import { parseGesture } from "./gestures";
import { baseFood } from "./capacity";

type Gender = "m" | "f";
interface Noun {
  /** Le mot, au singulier et au pluriel (« patate douce|patates douces »). */
  re: string;
  /** Le nom tel qu'on le dit (« patates douces ») et son genre, son nombre. */
  name: string;
  g: Gender;
  pl?: boolean;
  /** Une viande : « la viande » d'une consigne la désigne. */
  meat?: boolean;
  /** Un plat ou une préparation (« la sauce ») : c'est le produit de l'étape qui le fait. */
  dish?: boolean;
}

// Les aliments qu'une étape cuit et qu'une autre reprend, avec leur genre (pour « saisi », « rôties »).
const NOUNS: Noun[] = [
  { re: "poulets?", name: "poulet", g: "m", meat: true },
  { re: "porc|(?:côtes? )?échines?|filet mignon", name: "porc", g: "m", meat: true },
  { re: "b(?:œ|oe)uf", name: "bœuf", g: "m", meat: true },
  { re: "veau", name: "veau", g: "m", meat: true },
  { re: "agneau", name: "agneau", g: "m", meat: true },
  { re: "dinde", name: "dinde", g: "f", meat: true },
  { re: "canard", name: "canard", g: "m", meat: true },
  { re: "merguez", name: "merguez", g: "f", pl: true, meat: true },
  { re: "saucisses?", name: "saucisses", g: "f", pl: true, meat: true },
  { re: "chorizo", name: "chorizo", g: "m", meat: true },
  { re: "lardons?", name: "lardons", g: "m", pl: true, meat: true },
  { re: "médaillons?", name: "médaillons", g: "m", pl: true, meat: true },
  { re: "lanières?", name: "lanières", g: "f", pl: true, meat: true },
  { re: "saumon", name: "saumon", g: "m" },
  { re: "cabillaud", name: "cabillaud", g: "m" },
  { re: "crevettes?", name: "crevettes", g: "f", pl: true },
  { re: "(?:œ|oe)ufs?", name: "œufs", g: "m", pl: true },
  { re: "patates? douces?", name: "patates douces", g: "f", pl: true },
  { re: "pommes? de terre", name: "pommes de terre", g: "f", pl: true },
  { re: "aubergines?", name: "aubergines", g: "f", pl: true },
  { re: "courgettes?", name: "courgettes", g: "f", pl: true },
  { re: "champignons?", name: "champignons", g: "m", pl: true },
  { re: "carottes?", name: "carottes", g: "f", pl: true },
  { re: "poivrons?", name: "poivrons", g: "m", pl: true },
  { re: "haricots? verts?", name: "haricots verts", g: "m", pl: true },
  { re: "brocolis?", name: "brocoli", g: "m" },
  { re: "épinards?", name: "épinards", g: "m", pl: true },
  { re: "pois chiches?", name: "pois chiches", g: "m", pl: true },
  { re: "lentilles?", name: "lentilles", g: "f", pl: true },
  { re: "riz", name: "riz", g: "m" },
  { re: "pâtes", name: "pâtes", g: "f", pl: true },
  { re: "rigatoni", name: "pâtes", g: "f", pl: true },
  { re: "cannelloni", name: "cannelloni", g: "m", pl: true },
  { re: "semoule", name: "semoule", g: "f" },
  { re: "orzo", name: "orzo", g: "m" },
  { re: "quinoa", name: "quinoa", g: "m" },
  { re: "boulgour", name: "boulgour", g: "m" },
  // Les préparations : le mot dit le produit de l'étape (« La sauce mijote »).
  { re: "sauce", name: "sauce", g: "f", dish: true },
  { re: "bolognaise", name: "bolognaise", g: "f", dish: true },
  { re: "béchamel", name: "béchamel", g: "f", dish: true },
  { re: "caramel", name: "caramel", g: "m", dish: true },
  { re: "dahl", name: "dahl", g: "m", dish: true },
  { re: "purée", name: "purée", g: "f", dish: true },
];
const nounRe = (n: Noun) => new RegExp(`(?<!\\p{L})(?:${n.re})(?!\\p{L})`, "iu");
const MEAT_WORD = /(?<!\p{L})viandes?(?!\p{L})/iu;

/** Le produit d'une étape : son nom (« le poulet saisi »), ses mots (« poulet ») et ce qu'il contient. */
export interface Product {
  name: string;
  /** Ce qu'on cuit, sans la cuisson (« le poulet »), pour un titre (« Saisis le poulet »). */
  object: string;
  /** Les noms de ce qui le compose (« poulet », « sauce ») : une consigne d'après le désigne par l'un d'eux. */
  words: string[];
  /** Un plat ou une préparation (« la sauce ») plutôt qu'un aliment cuit. */
  dish: boolean;
  meat: boolean;
}

/** Une étape reprend le produit de l'étape `from` (rang dans la fiche, 1 = première), à la sous-étape `phase` (null : dès le début). */
export interface ProductUse {
  from: number;
  /** Le mot de la consigne qui le désigne. */
  word: string;
  phase: number | null;
}

const art = (n: { name: string; g: Gender; pl?: boolean }) => (n.pl ? "les" : /^[aeéèêiouyhœ]/i.test(n.name) ? "l’" : n.g === "f" ? "la" : "le");
const withArt = (n: Noun) => {
  const a = art(n);
  return a.endsWith("’") ? `${a}${n.name}` : `${a} ${n.name}`;
};

/** Ce que fait une cuisson, accordé : « saisi », « rôties ». */
const PARTICIPLE: Partial<Record<StepKind, string>> = { sear: "saisi", bake: "rôti", boil: "cuit" };
function agree(p: string, g: Gender, pl: boolean) {
  return `${p}${g === "f" ? "e" : ""}${pl ? "s" : ""}`;
}

/** Les noms reconnus dans un texte, dans l'ordre où ils viennent. */
function nounsIn(text: string): Noun[] {
  return NOUNS.map((n) => ({ n, at: text.search(nounRe(n)) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.n)
    .filter((n, i, all) => all.findIndex((m) => m.name === n.name) === i);
}

/** Les noms d'un ingrédient (« Filet mignon de porc en médaillons » → porc, médaillons), le premier avant un « ou ». */
function nounsOf(i: PlannerIngredient): Noun[] {
  // « Pulpe de tomate (4 boîtes) : 2 dans la bolognaise » : le nom est avant les deux-points.
  const base = parseGesture(i.item).base.replace(/\([^)]*\)/g, " ").split(/\s[:;]\s/)[0];
  const b = baseFood(i.foodId);
  const fromBase = b && b.family !== "legumes_eau" ? NOUNS.find((x) => x.name === b.label || nounRe(x).test(b.label)) : undefined;
  const [first, ...rest] = base.split(/\bou\b/);
  const out = [...(fromBase ? [fromBase] : []), ...nounsIn(first), ...nounsIn(rest.join(" "))];
  return out.filter((n, k) => out.findIndex((m) => m.name === n.name) === k);
}

/** Les incises de moment (« Pendant que la sauce mijote : », « dès que le riz est égoutté ») ne disent pas ce qu'on reprend. */
export function withoutAsides(text: string): string {
  return text.replace(/(?<!\p{L})(?:pendant|dès|quand|lorsque|une fois|tant que)(?!\p{L})[^:,.;]*/giu, " ");
}

const cooks = (s: PlannerStep) => s.kind !== "prep" && s.kind !== "cool";
const mentions = (text: string, n: Noun) => nounRe(n).test(text);
const mentionsAny = (text: string, names: string[]) => names.some((w) => mentions(text, NOUNS.find((n) => n.name === w)!));

/**
 * Ce que cuit une étape : les ingrédients de ses bols ; sans bol, ceux hors bol que son texte nomme
 * (une saisie sans bol qui ne nomme rien : la viande hors bol).
 */
function ownNouns(r: PlannerRecipe, s: PlannerStep, bowls = s.bowls ?? []): { n: Noun; grams: number; also: string[] }[] {
  const pick = (list: PlannerIngredient[]) =>
    list.flatMap((i) => {
      const ns = nounsOf(i);
      const also = [...new Set([...ns, ...nounsIn(i.item)].map((x) => x.name))];
      return ns.map((n) => ({ n, grams: (i.grams ?? 0) + (i.units ?? 0) * 50, also }));
    });
  const loose = pick(r.ingredients.filter((i) => !i.group && !i.pantry));
  if (bowls.length) {
    const own = pick(r.ingredients.filter((i) => i.group && bowls.includes(i.group)));
    // Une saisie dont les bols ne sont qu'une marinade : la viande hors bol que le texte nomme.
    return s.kind === "sear" && !own.some((o) => o.n.meat) ? [...own, ...loose.filter((x) => x.n.meat && mentionsAny(s.text, x.also))] : own;
  }
  if (s.bowls?.length) return [];
  const said = loose.filter((x) => mentionsAny(s.text, x.also));
  return said.length ? said : s.kind === "sear" ? loose.filter((x) => x.n.meat) : [];
}

/**
 * Le produit d'une étape : une préparation que son texte nomme (« La sauce mijote », la béchamel), sinon
 * ce qu'elle saisit, rôtit ou cuit (viande d'abord, puis le plus lourd), accordé à sa cuisson (« le
 * poulet saisi », « les patates douces et le poulet rôtis »). `used` : les mots qu'elle reprend d'une
 * étape d'avant (« dans le caramel ») ne sont pas son produit ; un assemblage (au four, avec des
 * reprises) n'en a pas. null : une étape qui ne fait rien de nommable (un mijoté continue, une poêle chauffe).
 */
export function productOf(r: PlannerRecipe, s: PlannerStep, used: string[] = []): Product | null {
  if (!cooks(s)) return null;
  const said = withoutAsides([s.text, ...(s.phases ?? []).map((p) => p.text), s.cue ?? ""].join(" "));
  const own = ownNouns(r, s);
  const isOwn = (n: Noun) => own.some((o) => o.n.name === n.name);
  const meats = [...new Set(own.filter((o) => o.n.meat && !used.includes(o.n.name)).map((o) => o.n))];
  const dishes = nounsIn(said).filter((n) => n.dish && !isOwn(n) && !used.includes(n.name));
  if (dishes.length && (s.kind === "braise" || s.kind === "boil" || (s.kind === "sear" && !meats.length))) {
    const d = dishes.find((n) => n.name !== "sauce") ?? dishes[0];
    const meat = meats[0];
    const name = d.name === "sauce" && meat ? `la sauce ${meat.g === "f" ? "à la" : /^[aeéiouyhœ]/i.test(meat.name) ? "à l’" : "au"}${/^[aeéiouyhœ]/i.test(meat.name) && meat.g === "m" ? "" : " "}${meat.name}`.replace("à l’ ", "à l’") : withArt(d);
    return { name, object: name, words: [...new Set([...dishes.map((n) => n.name), ...meats.map((n) => n.name)])], dish: true, meat: meats.length > 0 };
  }
  if (s.kind === "braise" || (s.kind === "rest" && !s.bowls?.length) || (s.kind === "bake" && used.length)) return null;
  // Ce qu'elle cuit : la viande d'abord, puis les plus lourds (deux au plus au four), dans l'ordre du texte.
  const weight = new Map<string, number>();
  for (const o of own) if (!o.n.dish && !used.includes(o.n.name)) weight.set(o.n.name, (weight.get(o.n.name) ?? 0) + o.grams);
  const pool = [...weight.keys()].map((name) => NOUNS.find((n) => n.name === name)!);
  if (!pool.length) return null;
  const heavy = [...pool].sort((a, b) => weight.get(b.name)! - weight.get(a.name)!);
  const m = pool.filter((n) => n.meat);
  const at = (n: Noun) => {
    const i = said.search(nounRe(n));
    return i < 0 ? Infinity : i;
  };
  const picked = (m.length ? [m[0], ...(s.kind === "bake" ? heavy.filter((n) => !n.meat).slice(0, 1) : [])] : heavy.slice(0, s.kind === "bake" ? 2 : 1)).sort((a, b) => at(a) - at(b));
  const names = picked.map(withArt);
  const p = PARTICIPLE[s.kind];
  const base = s.kind === "boil" && picked.length === 1 && r.ingredients.some((i) => i.group && (s.bowls ?? []).includes(i.group) && baseFood(i.foodId));
  const pl = picked.length > 1 || Boolean(picked[0].pl);
  const g: Gender = picked.some((n) => n.g === "m") ? "m" : "f";
  const object = names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}` : names[0];
  const name = `${object}${p && !base ? ` ${agree(p, g, pl)}` : ""}`;
  const words = [...new Set(picked.flatMap((n) => [n.name, ...own.filter((o) => o.n.name === n.name).flatMap((o) => o.also)]))];
  return { name, object, words, dish: false, meat: picked.some((n) => n.meat) };
}

/**
 * Ce que chaque étape fait (`makes`) et reprend (`uses`), par rang dans la fiche (1 = première étape).
 * Une étape reprend le produit de la dernière étape d'avant qui le nomme, quand sa consigne le cite hors
 * des incises de moment ; ses propres bols ne comptent pas, sauf s'ils ont déjà cuit à une étape d'avant
 * (« ajoute les champignons » du bol A, saisis plus tôt). « La viande » désigne la dernière viande cuite.
 * Plusieurs étapes de suite dans le même récipient qui font la même chose (chauffer la poêle, saisir,
 * déglacer) : le produit est celui de la dernière.
 */
export function recipeFlow(r: PlannerRecipe): { makes: Map<number, Product>; uses: Map<number, ProductUse[]> } {
  const makes = new Map<number, Product>();
  const uses = new Map<number, ProductUse[]>();
  r.steps.forEach((s, i) => {
    const order = i + 1;
    if (!cooks(s)) return;
    const before = [...makes.entries()].filter(([o]) => o < order).sort((a, b) => b[0] - a[0]);
    // Ses bols pas encore cuits : leurs aliments sont les siens, pas une reprise.
    const cookedBowls = new Set(r.steps.slice(0, i).filter(cooks).flatMap((x) => x.bowls ?? []));
    const fresh = ownNouns(r, s, (s.bowls ?? []).filter((b) => !cookedBowls.has(b))).map((o) => o.n.name);
    const text = withoutAsides(s.text);
    const phases = (s.phases ?? []).map((ph) => withoutAsides(ph.text));
    const found: ProductUse[] = [];
    const phaseOf = (re: RegExp) => {
      const k = phases.findIndex((t) => re.test(t));
      return k > 0 ? k : null;
    };
    for (const [from, prod] of before) {
      for (const w of prod.words) {
        if (found.some((u) => u.from === from || u.word === w)) break;
        const re = nounRe(NOUNS.find((x) => x.name === w)!);
        if (fresh.includes(w) || !(re.test(text) || phases.some((t) => re.test(t)))) continue;
        found.push({ from, word: w, phase: phaseOf(re) });
      }
      // « La viande » : la dernière viande cuite.
      if (!found.some((u) => u.from === from) && prod.meat && !found.some((u) => u.word === "viande") && (MEAT_WORD.test(text) || phases.some((t) => MEAT_WORD.test(t)))) {
        found.push({ from, word: "viande", phase: phaseOf(MEAT_WORD) });
      }
    }
    if (found.length) uses.set(order, found.sort((a, b) => a.from - b.from));
    const p = productOf(r, s, found.flatMap((u) => [u.word, ...(makes.get(u.from)?.words ?? [])]));
    if (!p) return;
    // La même chose que l'étape d'avant, dans le même récipient, sans la reprendre : c'est la suite.
    const prev = r.steps.slice(0, i).map((x, k) => ({ x, k: k + 1 })).filter(({ x }) => cooks(x)).pop();
    if (prev && prev.x.equipmentId && prev.x.equipmentId === s.equipmentId && makes.get(prev.k)?.name === p.name && !found.some((u) => u.from === prev.k)) makes.delete(prev.k);
    makes.set(order, p);
  });
  return { makes, uses };
}

/** Le mot d'une reprise tel qu'il s'écrit dans les consignes (pour en faire une pastille). */
export function wordPattern(word: string): RegExp {
  const n = NOUNS.find((x) => x.name === word);
  return new RegExp(`(?<!\\p{L})(?:${n ? n.re : word === "viande" ? "viandes?" : word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?!\\p{L})`, "iu");
}

/** Le texte nomme-t-il un aliment ou une préparation (« Riz dans le faitout ») ? Sinon, un titre ne dit que le récipient. */
export const namesFood = (text: string) => nounsIn(text).length > 0;
