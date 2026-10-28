// Gestes de prep : reconnaître la découpe dans le nom d'un ingrédient, et un temps de
// référence par geste. Ces temps sont des points de départ : les durées réelles de
// chaque session (journal cook_events) serviront à les corriger.

const CUT = /(émincé|ciselé|haché|râpé|écrasé|pressé|égoutté|quartiers|dés\b|cubes|rondelles|lanières|lamelles|morceaux|bâtonnets|médaillons|boyau|zeste)/i;
const INLINE_CUT = /\s*\b(en (?:\d+ )?(?:cubes|dés|lanières|lamelles|rondelles|morceaux|quartiers|bâtonnets|médaillons)[^,()]*)/i;

export interface Gesture {
  base: string; // « Oignons »
  gesture: string | null; // « émincés », « en cubes de 4 cm » ; null = rien à couper, juste peser
}

/** Sépare le nom de l'ingrédient et le geste (« Oignons, émincés » → Oignons / émincés). */
export function parseGesture(item: string): Gesture {
  const plain = item.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const comma = plain.indexOf(",");
  if (comma > 0) {
    const base = plain.slice(0, comma).trim();
    const rest = plain.slice(comma + 1).trim();
    if (CUT.test(rest)) return { base, gesture: rest };
    return { base, gesture: null };
  }
  const m = plain.match(INLINE_CUT);
  if (m) return { base: plain.replace(m[0], "").trim(), gesture: m[1].trim() };
  return { base: plain, gesture: null };
}

// Minutes par pièce, poids moyen d'une pièce, minutes par kilo.
const PER_PIECE: Record<string, number> = { oignon: 1.5, echalote: 1, ail: 0.5, courgette: 1.5, carotte: 1, poivron: 1.5, citron_vert: 1, oeuf: 0.3 };
const PIECE_G: Record<string, number> = { oignon: 150, echalote: 30, courgette: 200, carotte: 100, poivron: 150, ail: 5 };
const PER_KG: Record<string, number> = {
  champignon: 8,
  pomme_de_terre: 7,
  saute_porc: 6,
  echine_porc: 8,
  filet_poulet: 8,
  filet_mignon_porc: 6,
  saucisse_toulouse: 5,
  gingembre: 60,
  persil: 100,
  pois_chiches: 2,
};

/** Temps de référence d'un geste sur une quantité (minutes). */
export function gestureMinutes(food: string | null, grams: number | null, units: number | null): number {
  const f = food ?? "";
  if (PER_PIECE[f] != null) {
    const pieces = units ?? (grams != null && PIECE_G[f] ? grams / PIECE_G[f] : 1);
    return PER_PIECE[f] * pieces;
  }
  const kg = (grams ?? 200) / 1000;
  return (PER_KG[f] ?? 4) * kg + (PER_KG[f] ? 0 : 1);
}

const MEAT = /porc|poulet|saucisse|boeuf|bœuf|dinde|veau|agneau|canard|saumon|thon|lieu|poisson/;
/** La viande se coupe en dernier (planche et couteau propres pour les légumes d'abord). */
export const isMeat = (food: string | null, base: string) => MEAT.test(`${food ?? ""} ${base.toLowerCase()}`);

export const WEIGH_MIN = 0.5; // peser et verser un ingrédient dans son bol

// ─── Prep la veille ───
// Ce qui se prépare la veille (au frigo, filmé) et ce qui attend le jour même. Règles
// fixées à l'usage ; l'ordre compte : les « pas la veille » d'abord.
export interface Ahead {
  eve: boolean;
  reason: string;
}
const NOT_AHEAD: [RegExp, string][] = [
  [/courgette/, "courgettes râpées et salées : elles rendent leur eau, le jour même"],
  [/champignon/, "champignons coupés : ils noircissent, le jour même"],
  [/persil|coriandre|ciboulette|basilic|aneth|menthe|estragon|cerfeuil/, "herbes ciselées : elles s'oxydent, au dernier moment"],
  [/surgel/, "surgelé : il reste au congélateur"],
  [/\bp[aâ]tes\b|rigatoni|spaghetti|penne|fusilli|tagliatelle|lasagne|\briz\b|riz_|semoule|quinoa/, "pâtes et riz : le jour même"],
];
const AROMATIC = /\b(oignons?|échalotes?|echalotes?|ail|gingembre|citronnelle)\b|oignon|echalote|gingembre/;
const DAIRY = /ricotta|crème|creme|mascarpone|fromage|râpé|rape\b|emmental|parmesan|mozzarella|\blait\b|yaourt|skyr|beurre/;

/** Un ingrédient se prépare-t-il la veille ? `gesture` = la découpe lue dans son nom (null = juste peser). */
export function prepAhead(ing: { item: string; foodId?: string | null; pantry?: boolean | null }, gesture: string | null): Ahead {
  const text = `${ing.foodId ?? ""} ${ing.item}`.toLowerCase();
  for (const [re, reason] of NOT_AHEAD) if (re.test(text)) return { eve: false, reason };
  if (AROMATIC.test(text) && gesture) return { eve: true, reason: "aromates ciselés : au frigo, filmés" };
  if (isMeat(ing.foodId ?? null, ing.item) && gesture) {
    return /boyau/i.test(ing.item) ? { eve: true, reason: "saucisse sortie du boyau : au frigo" } : { eve: true, reason: "viande en dés : au frigo, filmée" };
  }
  if (DAIRY.test(text)) return { eve: true, reason: "mélange laitier : au frigo, filmé" };
  if (!gesture) return { eve: true, reason: "pesée du placard" };
  return { eve: true, reason: "se garde au frigo, filmé" };
}

/** Les gestes sans bol (tamponner la viande, la recouper) se font juste avant la saisie. */
export const otherAhead = (text: string): Ahead =>
  /tamponne|sèche|seche|juste avant/i.test(text) ? { eve: false, reason: "viande à tamponner juste avant la saisie" } : { eve: false, reason: "juste avant de cuire" };
