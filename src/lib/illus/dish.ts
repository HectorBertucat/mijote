// La boîte d'un plat (docs/design/identite/identite.md, « Visuels de plats sans photos », voie 1) :
// pur et testé (tests/dish.test.ts). Même recette, même boîte : tout vient des ingrédients et des
// étapes, le hasard est tiré du slug. <DishBox> (src/components/ui/dish.tsx) dessine ces couches.
//
// Couches : la sauce (couleur --i-* tirée du liquide ou de la base), la garniture (les 2 ou 3
// ingrédients les plus lourds, avec leur dessin), le compartiment du féculent cuit à part (riz,
// semoule, avec le légume cuit à part), la touche finale (herbe, citron, graines). Trois modèles :
// « garni » (morceaux posés), « mijote » (morceaux dans la sauce), « veloute » (mixé), « gratine »
// (fromage doré dessus).
import { FOODS, type FoodArtId, type FoodCategory } from "./art";
import { foodArt } from "./resolve";

/** Ce qu'il faut d'une recette : la ligne de la base (`foodId`) ou du fichier (`food`). */
export interface DishIngredient {
  item: string;
  grams?: number | null;
  units?: number | null;
  food?: string | null;
  foodId?: string | null;
  group?: string | null;
  side?: boolean | null;
  optional?: boolean | null;
}
export interface DishStep {
  kind: string;
  text?: string | null;
  equipmentId?: string | null;
  bowls?: string[] | null;
}
export interface DishRecipe {
  slug: string;
  name: string;
  ingredients: DishIngredient[];
  steps?: DishStep[];
}

export type DishModel = "garni" | "mijote" | "veloute" | "gratine";
export type SauceTone = "tomate" | "creme" | "curry" | "coco" | "laque" | "moutarde" | "bouillon" | "fromage" | "nature";
export type SideKind = "riz" | "semoule" | "pates" | "pomme_de_terre" | "legume";
export type FinishKind = "herbe" | "citron" | "graines";

/** Un dessin posé dans la boîte, dans le repère 200 × 140 de <DishBox>. */
export interface Piece {
  /** Dessin 64 × 64 de art.ts ; `null` : un morceau générique (aliment sans dessin de morceau). */
  art: FoodArtId | null;
  item: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Dot {
  x: number;
  y: number;
  r: number;
  rotate: number;
}

export interface DishArt {
  model: DishModel;
  /** Empreinte des couches : sert de préfixe d'ids SVG (deux variantes d'une recette diffèrent). */
  key: string;
  sauce: { tone: SauceTone; fill: string; area: Rect };
  /** Garniture principale : les ingrédients retenus, du plus lourd au plus léger. */
  main: { art: FoodArtId; item: string; exact: boolean }[];
  pieces: Piece[];
  side: { kind: SideKind; fill: string; area: Rect; grains: Dot[]; pieces: Piece[] } | null;
  /** Fromage gratiné : la croûte et ses taches dorées. */
  crust: { path: string; spots: Dot[] } | null;
  finish: { kind: FinishKind; art: FoodArtId; dots: Dot[] } | null;
}

// ─── Hasard déterministe ───

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

// ─── Lecture des ingrédients ───

const v = (name: string) => `var(--i-${name})`;
const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${v(a)} ${pct}%, ${v(b)})`;
const norm = (s: string) => s.toLowerCase().normalize("NFC");

interface Line {
  ing: DishIngredient;
  name: string;
  art: FoodArtId;
  exact: boolean;
  cat: FoodCategory;
  weight: number;
}

/** Poids indicatif d'une ligne : les grammes, sinon les pièces (œuf 60 g, gousse 5 g). */
function weightOf(ing: DishIngredient, art: FoodArtId): number {
  if (ing.grams && ing.grams > 0) return ing.grams;
  if (ing.units && ing.units > 0) return ing.units * (art === "oeuf" ? 60 : art === "bouillon_cube" ? 10 : art === "ail" ? 5 : 50);
  return 0;
}

// Ce qui fond dans la sauce : jamais dessiné en morceaux.
const MELTS = new Set<FoodArtId>(["oignon", "echalote", "ail", "gingembre", "concentre_tomate", "pulpe_tomate", "tomate", "farine", "maizena"]);
const PIECE_CATEGORIES = new Set<FoodCategory>(["viande", "volaille", "poisson", "oeuf", "feculent", "legume", "fruit", "ingredient"]);
// Dessins servis dans un bol (riz, semoule…) : dans la boîte, un morceau générique les remplace.
const BOWLED = new Set<FoodArtId>(["riz_basmati", "semoule", "flocons_avoine", "_feculent", "_ingredient"]);
const CHEESE_ART = new Set<FoodArtId>(["emmental_rape", "parmesan", "mozzarella"]);
const CHEESE_NAME = /mozzarella|parmesan|emmental|gruy[eè]re|comt[eé]|cheddar|fromage r[aâ]p|^r[aâ]p[eé]/;
const isCheese = (l: { art: FoodArtId; name: string }) => CHEESE_ART.has(l.art) || CHEESE_NAME.test(l.name);
// Féculents toujours servis à part dans la boîte, même sans `side` (riz du placard).
const ALWAYS_APART = new Set<FoodArtId>(["riz_basmati", "semoule"]);
const STARCH_SIDE: [RegExp, SideKind][] = [
  [/riz/, "riz"],
  [/semoule|boulgour|quinoa/, "semoule"],
  [/p[aâ]tes|tagliatelle|penne|spaghetti|fusilli|coquillettes|rigatoni/, "pates"],
  [/pomme de terre|pommes de terre|pur[eé]e/, "pomme_de_terre"],
];

const SIDE_FILL: Record<SideKind, string> = {
  riz: v("rice"),
  semoule: v("grain"),
  pates: v("pasta"),
  pomme_de_terre: v("potato"),
  legume: v("plate"),
};

// Couleur de chaque base de sauce, et ce qui la porte (nom de l'ingrédient, aliment, poids compté).
const TONES: { tone: SauceTone; color: string; test: RegExp; weight?: (g: number) => number }[] = [
  { tone: "curry", color: "curry", test: /curry|colombo|garam|curcuma|ras el hanout|tikka|masala/, weight: () => 600 },
  { tone: "coco", color: "cream", test: /coco/ },
  { tone: "tomate", color: "tomato", test: /tomate|coulis|passata/, weight: (g) => g },
  { tone: "laque", color: "soy", test: /soja|soy|teriyaki|nuoc|caramel|\bsucre\b/, weight: (g) => g * 3 },
  { tone: "laque", color: "honey", test: /miel|sirop/, weight: (g) => g * 2 },
  { tone: "moutarde", color: "mustard", test: /moutarde/, weight: (g) => g * 3 },
  { tone: "creme", color: "cream", test: /cr[eè]me|lait\b|lait demi|skyr|yaourt|ricotta|b[eé]chamel|mascarpone|parmesan/ },
  { tone: "bouillon", color: "onion", test: /bouillon|fond de|vin blanc|vin rouge/, weight: () => 120 },
  { tone: "nature", color: "seared", test: /paprika|piment d'espelette/, weight: () => 80 },
];

function sauceOf(lines: Line[], model: DishModel): { tone: SauceTone; fill: string } {
  const score = new Map<string, { tone: SauceTone; color: string; w: number }>();
  for (const l of lines) {
    for (const t of TONES) {
      if (!t.test.test(l.name)) continue;
      const w = (t.weight ?? ((g: number) => g))(l.weight || 0);
      if (w <= 0) continue;
      // Une couleur, un score : la première base qui l'apporte donne son nom.
      const cur = score.get(t.color) ?? { tone: t.tone, color: t.color, w: 0 };
      cur.w += w;
      score.set(t.color, cur);
      break;
    }
  }
  const ranked = [...score.values()].sort((a, b) => b.w - a.w || a.color.localeCompare(b.color));
  // Le curry colore tout ; le lait de coco l'adoucit.
  if (score.has("curry")) {
    const coco = lines.some((l) => /coco/.test(l.name));
    const other = ranked.find((s) => s.color !== "curry");
    return { tone: coco ? "coco" : "curry", fill: other ? mix("curry", other.color, coco ? 55 : 70) : v("curry") };
  }
  // Laqué : la sauce soja seule serait noire ; le miel ou le caramel l'éclaircit.
  if (ranked[0]?.tone === "laque") return { tone: "laque", fill: mix("soy", "honey", 55) };
  if (!ranked.length) return model === "gratine" ? { tone: "fromage", fill: v("cream-2") } : { tone: "nature", fill: mix("seared", "onion", 35) };
  const [a, b] = ranked;
  if (!b || a.w > b.w * 4) return { tone: a.tone, fill: v(a.color) };
  const pct = Math.round(Math.min(85, Math.max(55, (a.w / (a.w + b.w)) * 100)));
  return { tone: a.tone, fill: mix(a.color, b.color, pct) };
}

// ─── Modèle ───

function modelOf(r: DishRecipe, lines: Line[]): DishModel {
  const steps = r.steps ?? [];
  const text = norm([r.name, ...steps.map((s) => s.text ?? "")].join(" "));
  const cheese = lines.some(isCheese);
  const gratin = steps.some((s) => s.kind === "bake" && (/^plat/.test(s.equipmentId ?? "") || /gratin|parsème|parseme|par-dessus|dessus/.test(norm(s.text ?? ""))));
  if (cheese && gratin) return "gratine";
  // Velouté : le nom le dit, ou tout est mixé sans morceau de viande.
  const meat = lines.some((l) => l.cat === "viande" || l.cat === "volaille" || l.cat === "poisson");
  if (/velout|soupe|potage|\bdahl?\b/.test(norm(r.name)) || (/\bmix(e|é)/.test(text) && !meat)) return "veloute";
  const braise = steps.filter((s) => s.kind === "braise").length;
  const sear = steps.filter((s) => s.kind === "sear").length;
  return braise > 0 && braise >= sear ? "mijote" : "garni";
}

/** Cuit à part : marqué `side`, ou bouilli à part sans jamais rejoindre la cocotte, la poêle ou le four. */
function apartGroups(r: DishRecipe): Set<string> {
  const boiled = new Set<string>();
  const joined = new Set<string>();
  for (const s of r.steps ?? []) {
    for (const b of s.bowls ?? []) (s.kind === "boil" ? boiled : s.kind === "prep" ? null : joined)?.add(b);
  }
  return new Set([...boiled].filter((b) => !joined.has(b)));
}

// ─── Mise en place ───

const GLASS: Rect = { x: 14, y: 34, w: 172, h: 88 };
const INNER: Rect = { x: 24, y: 44, w: 152, h: 66 };
const SIDE_W = 58;
const GAP = 6;

/** Cases en grille (2 rangées), mélangées : les morceaux s'y posent sans trop se chevaucher. */
function slots(area: Rect, rand: () => number, rows = 2): { x: number; y: number }[] {
  const cols = Math.max(2, Math.round(area.w / 34));
  const out: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      out.push({
        x: area.x + ((col + 0.5 + (row % 2 ? 0.35 : 0)) * area.w) / (cols + 0.35) + (rand() - 0.5) * 6,
        y: area.y + ((row + 0.5) * area.h) / rows + (rand() - 0.5) * 6,
      });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function place(ids: { art: FoodArtId | null; item: string; weight: number }[], area: Rect, rand: () => number, base: number, rows = 2): Piece[] {
  if (!ids.length) return [];
  const free = slots(area, rand, rows);
  const total = ids.reduce((s, i) => s + i.weight, 0) || 1;
  // Au moins un morceau chacun, le reste au prorata du poids.
  const count = ids.map((i) => 1 + Math.floor(((free.length - ids.length) * i.weight) / total));
  const pieces: Piece[] = [];
  ids.forEach((id, rank) => {
    for (let k = 0; k < count[rank] && free.length; k++) {
      const at = free.pop()!;
      const scale = r1((base - rank * 0.05 + (rand() - 0.5) * 0.08) * 100) / 100;
      pieces.push({ art: id.art, item: id.item, x: r1(at.x - 32 * scale), y: r1(at.y - 32 * scale), scale, rotate: Math.round((rand() - 0.5) * 36) });
    }
  });
  // Les plus gros au fond, les plus petits devant.
  return pieces.sort((a, b) => a.y - b.y || b.scale - a.scale);
}

function scatter(area: Rect, n: number, rand: () => number, r: [number, number]): Dot[] {
  return Array.from({ length: n }, () => ({
    x: r1(area.x + 3 + rand() * (area.w - 6)),
    y: r1(area.y + 3 + rand() * (area.h - 6)),
    r: r1(r[0] + rand() * (r[1] - r[0])),
    rotate: Math.round(rand() * 180),
  }));
}

/** Croûte gratinée : bord du haut festonné, du fromage sur presque toute la surface. */
function crustPath(area: Rect, rand: () => number): string {
  const top = area.y + 8;
  const n = 7;
  let d = `M${area.x} ${area.y + area.h} V${top + 4}`;
  for (let i = 0; i < n; i++) {
    const x0 = area.x + (i * area.w) / n;
    const x1 = area.x + ((i + 1) * area.w) / n;
    d += ` Q${r1((x0 + x1) / 2)} ${r1(top - 6 - rand() * 6)} ${r1(x1)} ${r1(top + 2 + rand() * 4)}`;
  }
  return `${d} V${area.y + area.h} Z`;
}

const FINISH: [RegExp, FinishKind][] = [
  [/persil|coriandre|ciboulette|basilic|aneth|menthe|estragon/, "herbe"],
  [/citron/, "citron"],
  [/s[eé]same|pignon|cacahu/, "graines"],
  [/thym|origan|herbes de provence|romarin/, "herbe"],
];

/** Les couches de la boîte d'une recette. `without` : noms d'ingrédients retirés (variante « sans brocoli »). */
export function dishArt(recipe: DishRecipe, opts: { without?: string[] } = {}): DishArt {
  const without = (opts.without ?? []).map(norm).filter(Boolean);
  const lines: Line[] = recipe.ingredients
    .filter((ing) => !without.some((w) => norm(ing.item).includes(w)))
    .map((ing) => {
      const food = ing.food ?? ing.foodId ?? null;
      const r = foodArt(food, ing.item);
      return { ing, name: norm(ing.item), art: r.id, exact: r.exact, cat: FOODS[r.id].category, weight: weightOf(ing, r.id) };
    });

  const model = modelOf(recipe, lines);
  const apart = apartGroups(recipe);
  const isApart = (l: Line) =>
    !!l.ing.side ||
    (model !== "gratine" && (ALWAYS_APART.has(l.art) || (!!l.ing.group && apart.has(l.ing.group) && (l.cat === "feculent" || l.cat === "legume"))));

  // Compartiment : le féculent cuit à part le plus lourd, et les légumes cuits à part avec lui.
  const apartLines = lines.filter((l) => isApart(l) && l.weight > 0);
  const starch = apartLines.filter((l) => l.cat === "feculent").sort((a, b) => b.weight - a.weight)[0];
  const sideVeg = apartLines.filter((l) => l.cat === "legume").sort((a, b) => b.weight - a.weight);
  const sideKind: SideKind | null = starch ? (STARCH_SIDE.find(([re]) => re.test(starch.name))?.[1] ?? "riz") : sideVeg.length ? "legume" : null;

  const inDish = lines.filter((l) => !apartLines.includes(l));
  const main = inDish
    .filter((l) => l.weight > 0 && !l.ing.optional && PIECE_CATEGORIES.has(l.cat) && !MELTS.has(l.art) && !isCheese(l))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
    .slice(0, model === "veloute" ? 1 : 3);

  const sauce = sauceOf(inDish, model);
  const finishLine = FINISH.map(([re, kind]) => {
    const l = lines.find((x) => re.test(x.name));
    return l ? { kind, art: l.art } : null;
  }).find(Boolean);

  const key = hash(
    [recipe.slug, model, sauce.fill, sideKind, ...main.map((m) => m.art), ...sideVeg.map((s) => s.art), finishLine?.kind ?? ""].join("|"),
  ).toString(36);
  const rand = rng(hash(recipe.slug));

  const mainArea: Rect = sideKind ? { ...INNER, w: INNER.w - SIDE_W - GAP } : INNER;
  const sideArea: Rect = { x: INNER.x + INNER.w - SIDE_W, y: INNER.y, w: SIDE_W, h: INNER.h };

  const asPiece = (l: Line) => ({ art: BOWLED.has(l.art) ? null : l.art, item: l.ing.item, weight: l.weight });
  // Velouté : une seule rangée de morceaux, en surface ; gratin : petits, sous la croûte.
  const pieceArea: Rect =
    model === "veloute" ? { x: mainArea.x + 8, y: mainArea.y + 26, w: mainArea.w - 16, h: 24 } : model === "gratine" ? { ...mainArea, y: mainArea.y + 4, h: 36 } : mainArea;
  const pieces = place(main.map(asPiece), pieceArea, rand, model === "gratine" ? 0.4 : model === "veloute" ? 0.32 : 0.48, model === "veloute" ? 1 : 2).slice(
    0,
    model === "veloute" ? 3 : undefined,
  );

  const side = sideKind
    ? {
        kind: sideKind,
        fill: SIDE_FILL[sideKind],
        area: sideArea,
        grains: sideKind === "riz" ? scatter(sideArea, 34, rand, [1.4, 1.6]) : sideKind === "semoule" ? scatter(sideArea, 46, rand, [0.8, 1.2]) : sideKind === "pates" ? scatter(sideArea, 9, rand, [3, 3.4]) : sideKind === "pomme_de_terre" ? scatter(sideArea, 7, rand, [5, 6.5]) : [],
        pieces: place(
          sideVeg.slice(0, 1).map(asPiece),
          sideKind === "legume" ? sideArea : { x: sideArea.x + 6, y: sideArea.y + 4, w: sideArea.w - 12, h: 28 },
          rand,
          0.46,
          1,
        ).slice(0, sideKind === "legume" ? 3 : 1),
      }
    : null;

  const crust = model === "gratine" ? { path: crustPath(mainArea, rand), spots: scatter({ ...mainArea, y: mainArea.y + 14, h: mainArea.h - 16 }, 12, rand, [1.6, 3.4]) } : null;

  const finishArea: Rect = { x: mainArea.x + 6, y: mainArea.y + 6, w: mainArea.w - 12, h: mainArea.h - 12 };
  const finish = finishLine
    ? { ...finishLine, dots: scatter(finishArea, finishLine.kind === "citron" ? 1 : finishLine.kind === "graines" ? 14 : 9, rand, finishLine.kind === "citron" ? [7, 8] : [1, 1.8]) }
    : null;

  return {
    model,
    key,
    sauce: { ...sauce, area: mainArea },
    main: main.map((m) => ({ art: m.art, item: m.ing.item, exact: m.exact })),
    pieces,
    side,
    crust,
    finish,
  };
}

/** Repère de la boîte : le verre (pour <DishBox>). */
export const DISH_GLASS = GLASS;
