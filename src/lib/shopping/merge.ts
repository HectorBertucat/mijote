// Un même aliment demandé par plusieurs recettes : une ligne de courses, la quantité totale dans
// une unité commune quand c'est possible, et le détail par recette. Pur (testé, importé par
// build.ts et par la page de la liste).
//
// - Même aliment : même type du catalogue, sinon même nom d'achat (nameKey : « Ail, haché » et
//   « Ail, râpé » → « ail » ; « Oignons, émincés » et « Oignon, haché » → « oignon »). Un nom
//   différent reste une autre ligne (« Oignon rouge », « Pulpe de tomates concassées »).
// - Unité commune : les grammes, ou un compte de pièces de même unité (« gousse », pièce sans
//   unité). Le poids d'une pièce de la table nutritionnelle (FOODS.pieceG : la gousse d'ail, l'oignon)
//   convertit l'un en l'autre : « 3 gousses » et « 20 g » d'ail font 7 gousses (35 g).
// - Sans conversion possible (« 1 tête d'ail » et « 20 g d'ail ») : une ligne par unité, côte à
//   côte dans la liste (clusterRows), jamais une somme fausse.
import { FOODS, isFoodId } from "@/lib/nutrition/foods";
import { buyName } from "./label";

/** Le nom qui identifie un aliment à l'achat : sans préparation, parenthèses, quantité, accents ni pluriel. */
export function nameKey(item: string): string {
  return buyName(item)
    .split(/\s:\s/)[0]
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
    .join(" ");
}

const UNIT_RE =
  /^\s*[\d.,/½¼¾⅓⅔]+\s*(gousses?|cubes?|bo[iî]tes?|tranches?|sachets?|pots?|barquettes?|bottes?|brins?|feuilles?|t[eê]tes?|morceaux?|poign[ée]es?|pinc[ée]es?|bouquets?|briques?|bocaux|bocal)(?=[\s.'’]|$)/i;
const SINGULAR: Record<string, string> = { morceaux: "morceau", morceau: "morceau", bocaux: "bocal", bocal: "bocal" };

/** L'unité d'un compte de pièces lue dans la ligne (« 3 gousses d'ail » → « gousse »), null pour des pièces nues (« 2 oignons »). */
export function pieceUnit(lineRaw: string): string | null {
  const m = UNIT_RE.exec(lineRaw);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return SINGULAR[w] ?? w.replace(/s$/, "");
}

/** L'unité dont FOODS.pieceG donne le poids (sinon la pièce nue). */
const NATURAL: Record<string, string> = { ail: "gousse" };

/** Poids d'une pièce de cette unité pour cet aliment, s'il est connu. */
export function pieceGrams(foodId: string | null | undefined, unit: string | null): number | null {
  if (!isFoodId(foodId)) return null;
  const g = FOODS[foodId].pieceG;
  return g && (NATURAL[foodId] ?? null) === unit ? g : null;
}

/** Une ligne de recette, quantités déjà multipliées. */
export interface QtyLine {
  grams: number | null;
  pieces: number | null;
  unit: string | null; // unité des pièces
  pieceG: number | null; // poids d'une pièce de cette unité (conversion)
}

const quantified = (q: QtyLine) => q.grams != null || q.pieces != null;
const gramsOf = (q: QtyLine) => q.grams ?? (q.pieces != null && q.pieceG ? q.pieces * q.pieceG : null);

/**
 * Les lignes d'un même aliment, en groupes qui s'additionnent (indices, dans l'ordre) : un seul groupe
 * quand une unité commune existe, sinon les grammes (et ce qui s'y convertit) puis un groupe par unité de pièce.
 * Une ligne sans quantité (« coriandre ») suit le premier groupe.
 */
export function partition(lines: QtyLine[]): number[][] {
  const q = lines.map((l, i) => ({ l, i })).filter((x) => quantified(x.l));
  const free = lines.map((l, i) => ({ l, i })).filter((x) => !quantified(x.l)).map((x) => x.i);
  if (!q.length) return [lines.map((_, i) => i)];
  const sameUnit = q.every((x) => x.l.pieces != null && x.l.unit === q[0].l.unit);
  const allGrams = q.every((x) => gramsOf(x.l) != null);
  if (sameUnit || allGrams) return [lines.map((_, i) => i)];
  const groups = new Map<string, number[]>();
  for (const x of q) {
    const k = gramsOf(x.l) != null ? "g" : `pc:${x.l.unit ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), x.i]);
  }
  const out = [...groups.values()];
  out[0] = [...out[0], ...free].sort((a, b) => a - b);
  return out;
}

export interface Total {
  grams: number | null;
  pieces: number | null;
  unit: string | null;
  /** On achète en pièces (« 7 gousses », « 3 oignons ») plutôt qu'au poids. */
  allPieces: boolean;
}

/**
 * La quantité totale d'un groupe compatible. En pièces si chaque ligne compte des pièces entières, ou si
 * l'aliment se compte (une ligne en pièces seules) et que les grammes s'y convertissent ; sinon au poids.
 */
export function total(lines: QtyLine[]): Total {
  const q = lines.filter(quantified);
  if (!q.length) return { grams: null, pieces: null, unit: null, allPieces: false };
  const unit = q.find((l) => l.pieces != null)?.unit ?? null;
  const counted = q.every((l) => l.pieces != null && Number.isInteger(l.pieces) && l.unit === unit);
  // Les grammes connus (convertis au besoin) ; null si aucune ligne n'en a.
  const gs = q.map(gramsOf).filter((g): g is number => g != null);
  const grams = gs.length ? gs.reduce((s, g) => s + g, 0) : null;
  // Des pièces seules et des grammes, convertibles : l'aliment se compte (l'ail en gousses).
  const pieceG = q.find((l) => l.pieceG)?.pieceG ?? null;
  const convert = !counted && pieceG != null && q.some((l) => l.pieces != null && l.grams == null) && q.every((l) => l.pieces != null ? l.unit === unit : l.grams != null);
  if (convert) {
    const n = q.reduce((s, l) => s + (l.pieces ?? l.grams! / pieceG), 0);
    return { grams, pieces: Math.ceil(n - 1e-6), unit, allPieces: true };
  }
  const pcs = q.filter((l) => l.pieces != null && Number.isInteger(l.pieces) && l.unit === unit);
  return { grams, pieces: pcs.length ? pcs.reduce((s, l) => s + l.pieces!, 0) : null, unit, allPieces: counted };
}

const PLURAL: Record<string, string> = { morceau: "morceaux", bocal: "bocaux" };
const fmtG = (g: number) => (g >= 1000 ? `${(Math.round(g / 10) / 100).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toLocaleString("fr-FR"));

/** « 7 gousses », « 1 gousse », « 3 » (pièces nues), « 350 g », « 1,2 kg » ; null sans quantité. */
export function qtyLabel(t: Pick<Total, "grams" | "pieces" | "unit" | "allPieces">): string | null {
  if (t.allPieces && t.pieces != null) return t.unit ? `${fmtN(t.pieces)} ${t.pieces > 1 ? (PLURAL[t.unit] ?? `${t.unit}s`) : t.unit}` : fmtN(t.pieces);
  if (t.grams != null && t.grams > 0) return fmtG(t.grams);
  if (t.pieces != null) return t.unit ? `${fmtN(t.pieces)} ${t.pieces > 1 ? (PLURAL[t.unit] ?? `${t.unit}s`) : t.unit}` : fmtN(t.pieces);
  return null;
}

/** Une source enregistrée (shopping_item_sources) vue comme une ligne de quantité. */
export function sourceQty(s: { lineRaw: string; grams: number | null; units: number | null }, foodId: string | null | undefined): QtyLine {
  const unit = s.units != null ? pieceUnit(s.lineRaw) : null;
  return { grams: s.grams, pieces: s.units, unit, pieceG: pieceGrams(foodId, unit) };
}

/**
 * Le détail d'une ligne regroupée, recette par recette : « 2 gousses pour Colombo, 1 pour Dahl ».
 * L'unité d'une pièce n'est pas redite d'une recette à l'autre ; les grammes, si.
 */
export function perRecipe(parts: { recipe: string; qty: QtyLine }[]): string | null {
  const by = new Map<string, QtyLine[]>();
  for (const p of parts) by.set(p.recipe, [...(by.get(p.recipe) ?? []), p.qty]);
  let prevUnit: string | null | undefined;
  const out: string[] = [];
  for (const [recipe, lines] of by) {
    const t = total(lines);
    let label = qtyLabel(t);
    if (!label) {
      out.push(recipe);
      continue;
    }
    const piece = t.allPieces || (t.grams == null && t.pieces != null);
    if (piece && prevUnit !== undefined && prevUnit === t.unit && t.unit) label = fmtN(t.pieces!);
    prevUnit = piece ? t.unit : undefined;
    out.push(`${label} pour ${recipe}`);
  }
  return out.length ? out.join(", ") : null;
}

/**
 * Lignes d'un même rayon, celles du même aliment côte à côte (à la place de la première), la suite
 * marquée « cont » : deux unités impossibles à additionner, ou une liste enregistrée avant le regroupement.
 */
export function clusterRows<T>(rows: T[], keyOf: (r: T) => string): { row: T; cont: boolean }[] {
  const order: string[] = [];
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!by.has(k)) order.push(k);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return order.flatMap((k) => by.get(k)!.map((row, i) => ({ row, cont: i > 0 })));
}
