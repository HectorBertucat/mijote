// Règles déterministes de la liste de courses : rayon, choix du produit, pastille.
// Charte : docs/vision.md §4.5.
import { catalogEnabled, type MatchedType, type ResolvedProduct } from "@/lib/chronocatalog";
import { isCounterProduct, packsFor, rankForNeed, usable, type Prefs } from "@/lib/products/core";

export const AISLES = ["Boucherie", "Crèmerie", "Fruits et légumes", "Épicerie", "Surgelés", "Boissons", "Placard"] as const;
export type Aisle = (typeof AISLES)[number];

export function aisleFor(broadCategory: string | undefined, product?: Pick<ResolvedProduct, "isFrozen"> | null): Aisle {
  if (product?.isFrozen || broadCategory === "surgele") return "Surgelés";
  switch (broadCategory) {
    case "viande":
    case "poisson":
      return "Boucherie";
    case "laitier":
    case "oeuf":
      return "Crèmerie";
    case "legume":
    case "fruit":
      return "Fruits et légumes";
    case "boisson":
    case "alcool":
      return "Boissons";
    default:
      return "Épicerie";
  }
}

// Sans catalogue : le rayon se devine au nom de la ligne (l'ordre compte : surgelé et conserves d'abord).
const GUESS: [RegExp, Aisle][] = [
  [/surgel/, "Surgelés"],
  [/pulpe|concentr|conserve|bo[iî]te|coulis|sauce|bouillon|cube|p[âa]tes|riz|farine|lentilles|pois chiches|semoule|huile|vinaigre|sucre|miel|[ée]pice|curry|moutarde/, "Épicerie"],
  [/porc|poulet|volaille|b(oe|œ)uf|veau|agneau|dinde|canard|saucisse|chipolata|merguez|lardons|jambon|viande|escalope|steak|poisson|saumon|cabillaud|lieu|crevette|filet mignon|[ée]chine|travers/, "Boucherie"],
  [/lait|cr[èe]me|beurre|fromage|yaourt|skyr|ricotta|mozzarella|parmesan|emmental|comt[ée]|feta|ch[èe]vre|r[âa]p[ée]|(oe|œ)ufs?\b/, "Crèmerie"],
  [/oignon|[ée]chalote|\bail\b|carotte|courgette|tomate|poivron|champignon|salade|[ée]pinard|pomme|citron|banane|persil|coriandre|basilic|ciboulette|gingembre|poireau|brocoli|chou|aubergine|haricots? vert|patate|navet|c[ée]leri|concombre|avocat|thym|laurier|romarin|menthe|fruit|l[ée]gume/, "Fruits et légumes"],
  [/\bvin\b|bi[èe]re|\bjus\b|cidre/, "Boissons"],
];

/** Rayon deviné au nom (sans catalogue relié) ; Épicerie par défaut. */
export function guessAisle(label: string): Aisle {
  const s = label.toLowerCase();
  return GUESS.find(([re]) => re.test(s))?.[1] ?? "Épicerie";
}

const FRESH_H = 4; // vert : vérifié il y a moins de 4 h
const STALE_H = 24;

export { isCounterProduct, packsFor };

export interface PickOptions {
  /** Produits associés à l'ingrédient (src/lib/products) : acceptés, refusés, préféré. */
  prefs?: Prefs | null;
  /** Le besoin : sert à choisir parmi les produits acceptés (format, coût pour le besoin). */
  needG?: number | null;
  pieces?: number | null;
  /** Cartes à jour de produits acceptés que /resolve n'a pas renvoyés (recherche). */
  extra?: ResolvedProduct[];
}

export interface ProductPick {
  product: ResolvedProduct;
  type: MatchedType;
  alternatives: ResolvedProduct[];
  /** preferred : le produit préféré ; accepted : le meilleur des acceptés ; catalog : le choix du catalogue. */
  via: "preferred" | "accepted" | "catalog";
  notes: string[];
}

const fallbackType = (label: string): MatchedType => ({ id: "", slug: "", name: label, broadCategory: "autre", unit: "kg", products: [] });

/**
 * Le produit d'une ligne. Sans produit associé : le premier produit du premier type, sauf s'il est
 * en rupture, ancien ou vendu au détail (comme avant). Avec des produits acceptés : le préféré s'il
 * est commandable, sinon le meilleur des acceptés pour ce besoin (dispo, coût, prix au kilo) ; les
 * autres acceptés en premières alternatives. Un produit refusé n'est jamais pris, ni proposé.
 */
export function pickProduct(types: MatchedType[], opts: PickOptions = {}): ProductPick | null {
  const prefs = opts.prefs ?? null;
  const refused = prefs?.refused ?? new Set<string>();
  const ok = (p: ResolvedProduct) => !refused.has(p.id);
  const type = types[0] ?? null;
  const catalog = [...(type?.products ?? []), ...(types[1]?.products ?? [])].filter(ok);

  if (prefs && prefs.accepted.length) {
    // La carte la plus récente de chaque produit accepté : /resolve, puis la recherche, puis celle du jour du choix.
    const fresh = new Map([...(opts.extra ?? []), ...types.flatMap((t) => t.products)].map((p) => [p.id, p]));
    const accepted = prefs.accepted.map((p) => fresh.get(p.id) ?? p);
    const ranked = rankForNeed(accepted, { needG: opts.needG ?? null, pieces: opts.pieces ?? null });
    const pref = prefs.preferredId ? accepted.find((p) => p.id === prefs.preferredId) : undefined;
    const notes: string[] = [];
    let product: ResolvedProduct;
    let via: ProductPick["via"];
    if (pref && usable(pref)) {
      product = pref;
      via = "preferred";
    } else {
      product = ranked[0].product;
      via = "accepted";
      if (pref && product.id !== pref.id) notes.push(`${pref.name} (préféré) indisponible : ${product.name} à la place`);
    }
    const others = ranked.map((r) => r.product).filter((p) => p.id !== product.id);
    const fill = catalog.filter((p) => p.id !== product.id && !others.some((o) => o.id === p.id) && !isCounterProduct(p));
    const alternatives = [...others, ...fill].slice(0, Math.max(3, others.length));
    return { product, type: type ?? fallbackType(product.name), alternatives, via, notes };
  }

  if (!type) return null;
  const products = type.products.filter(ok);
  if (products.length === 0) {
    // Tout le premier type est refusé : le second type, s'il y en a un.
    const second = types.slice(1).find((t) => t.products.some(ok));
    if (!second) return null;
    return pickProduct([{ ...second, products: second.products.filter(ok) }, ...types.slice(1).filter((t) => t !== second)], { ...opts, prefs: null });
  }
  const product = products.find(usable) ?? products[0];
  const alternatives = catalog.filter((p) => p.id !== product.id && !isCounterProduct(p)).slice(0, 3);
  return { product, type, alternatives, via: "catalog", notes: [] };
}

export interface Judgement {
  state: "ok" | "warn" | "ko";
  warnings: string[];
}

/** La pastille : vert, orange (à vérifier), rouge (rupture, limite dépassée, rien trouvé). */
export function judge(input: {
  product: ResolvedProduct | null;
  packs: number;
  aisle: Aisle;
  confidence?: number;
  /** Aucun catalogue relié : une ligne sans produit est normale (à prendre en magasin). */
  offline?: boolean;
}): Judgement {
  const { product: p, packs } = input;
  if (!p) return (input.offline ?? !catalogEnabled()) ? { state: "ok", warnings: [] } : { state: "ko", warnings: ["rien trouvé dans le catalogue sous ce nom"] };
  const a = p.availability;
  const ko: string[] = [];
  const warn: string[] = [];
  if (a?.status === "out_of_stock") ko.push("en rupture");
  if (a?.status === "unavailable") ko.push(a.label ?? "indisponible");
  if (a?.maxQuantity != null && packs > a.maxQuantity) ko.push(`limité à ${a.maxQuantity} par commande (il en faut ${packs})`);
  if (a?.remainingStock != null && packs > a.remainingStock) ko.push(`plus que ${a.remainingStock} en stock (il en faut ${packs})`);
  if (isCounterProduct(p)) warn.push("vendu au détail : poids et prix à vérifier");
  if (a?.status === "low_stock") warn.push(a.remainingStock != null ? `stock faible (${a.remainingStock})` : "stock faible");
  if (a?.ageHours != null && a.ageHours >= STALE_H) warn.push(`vérifié il y a ${Math.round(a.ageHours / 24)} j`);
  else if (a?.ageHours != null && a.ageHours >= FRESH_H) warn.push(`vérifié il y a ${Math.round(a.ageHours)} h`);
  else if (!a?.lastCheckedAt) warn.push("jamais vérifié");
  if (packs >= 3 && p.weightG != null && p.weightG < 50) warn.push(`${packs} petits sachets de ${p.weightG} g : un autre format ?`);
  if (input.confidence != null && input.confidence < 0.5) warn.push("correspondance incertaine");
  if (ko.length) return { state: "ko", warnings: [...ko, ...warn] };
  return { state: warn.length ? "warn" : "ok", warnings: warn };
}

// ─── Variantes de nom quand /resolve ne trouve rien (« no_match ») ───

const QTY_PREFIX = /^\s*[\d.,/]+\s*(?:(?:kg|g|mg|cl|ml|dl|l|c\.\s*à\s*[sc]\.?|cuill[eè]res?\s+à\s+(?:soupe|café)|gousses?|cubes?|bo[iî]tes?|tranches?|sachets?|pots?|barquettes?|bottes?|pincées?)(?=[\s.]|$))?\s*(?:de\s+|d['’]\s*)?/i;
const QUALIFIERS = [
  /\bsans os\b/gi,
  /\blabel rouge\b/gi,
  /\bfra[iî]s(ses?)?\b/gi,
  /\bbio(logiques?)?\b/gi,
  /\bextra\b/gi,
  /\bAOP\b|\bAOC\b|\bIGP\b/g,
  /\bfermiers?\b|\bfermières?\b/gi,
  /\bde saison\b/gi,
  /\bfran[cç]ais(es?)?\b|\bd['’]origine france\b/gi,
  /\bentiers?\b|\bentières?\b/gi,
];
const STOP = new Set(["de", "d'", "d’", "du", "des", "à", "au", "aux", "en", "la", "le", "les", "et"]);

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Variantes de plus en plus courtes d'un nom d'ingrédient, sans la quantité. */
export function nameVariants(lineRaw: string, item?: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = squash(s);
    if (v.length >= 3 && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  const bases = [lineRaw.replace(QTY_PREFIX, ""), ...(item ? [item] : [])].map((b) => squash(b.split(/[,(]/)[0]));
  for (const b of bases) push(b);
  for (const b of bases) push(QUALIFIERS.reduce((s, re) => s.replace(re, " "), b));
  for (const b of [...out]) {
    const words = b.split(" ");
    for (const n of [3, 2]) {
      if (words.length <= n) continue;
      const w = words.slice(0, n);
      while (w.length > 1 && STOP.has(w[w.length - 1].toLowerCase())) w.pop();
      push(w.join(" "));
    }
  }
  return out;
}

/** La quantité à remettre devant une variante (« 2000 g », « 3 »). */
export function qtyPrefix(ing: { grams: number | null; units: number | null }): string {
  if (ing.grams) return `${Math.round(ing.grams)} g `;
  if (ing.units) return `${ing.units} `;
  return "";
}
