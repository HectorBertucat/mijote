// Paquets entamés à travers toutes les recettes d'une sélection : ce qui reste d'un
// paquet après la session (jambonneau 600 g dont 400 g utilisés). Module pur : les
// tailles de paquet viennent d'un profil calculé une fois par recette depuis /resolve
// (src/lib/week/packs.ts), mêmes clés que la liste de courses (type chronocatalog).

/** Une ligne de recette achetée, à la taille de la fiche (facteur 1). */
export interface PackLine {
  ingredientId: string;
  key: string; // « type:<slug> » ou « item:<nom> », comme src/lib/shopping/build.ts
  label: string;
  grams: number | null;
  pieces: number | null;
  packG: number | null; // poids d'un paquet du produit retenu
  price: number | null; // prix effectif d'un paquet
  perishable: boolean; // boucherie, crèmerie, fruits et légumes : un reste ouvert se perd
}

export type PackProfiles = Map<string, PackLine[]>;

export interface SelectionItem {
  slug: string;
  factor?: number;
  extras?: Record<string, number>; // recipe_ingredient_id → grammes en plus
}

export interface WasteLine {
  key: string;
  label: string;
  needG: number;
  packs: number;
  packG: number;
  orderedG: number;
  restG: number;
  price: number | null;
  perishable: boolean;
  /** recettes de la sélection qui utilisent ce produit, avec leurs grammes */
  uses: { slug: string; ingredientId: string; grams: number }[];
}

// Épicerie sèche : un paquet ouvert se garde au placard (le reste ne se perd pas).
const DRY = /p[âa]tes|spaghetti|penne|fusilli|lasagne|riz\b|farine|sucre|\bsel\b|poivre|[ée]pice|curry|colombo|paprika|cumin|ma[iï]zena|f[ée]cule|lentille|semoule|quinoa|huile|vinaigre|miel|soja|nuoc|bouillon|chapelure|levure|cacao|chocolat|moutarde|caf[ée]|th[ée]\b|herbes de provence|laurier|thym s[ée]ch|\bvins?\b|bi[èe]re|cidre/i;

/** Un reste de ce produit se perd s'il n'est pas utilisé vite (frais, ou boîte ouverte). */
export const isPerishable = (aisle: string, label: string) => aisle !== "Surgelés" && !DRY.test(label);

/** Même arrondi que la liste de courses (src/lib/shopping/rules.ts packsFor). */
export const packsOf = (needG: number, packG: number) => Math.max(1, Math.ceil(needG / packG - 0.05));

/** Un reste qui compte : au moins 30 g et 15 % d'un paquet. */
export const isLeftover = (restG: number, packG: number) => restG >= 30 && restG >= 0.15 * packG;

/** Agrège les lignes de la sélection par produit et calcule le reste de chaque paquet. */
export function selectionWaste(sel: SelectionItem[], profiles: PackProfiles): WasteLine[] {
  const by = new Map<string, Omit<WasteLine, "packs" | "orderedG" | "restG"> & { ok: boolean }>();
  for (const s of sel) {
    const f = s.factor ?? 1;
    for (const l of profiles.get(s.slug) ?? []) {
      if (l.grams == null) continue;
      const g = l.grams * f + (s.extras?.[l.ingredientId] ?? 0);
      const cur = by.get(l.key) ?? { key: l.key, label: l.label, needG: 0, packG: l.packG ?? 0, price: l.price, perishable: l.perishable, uses: [], ok: l.packG != null && l.packG > 0 };
      cur.needG += g;
      cur.uses.push({ slug: s.slug, ingredientId: l.ingredientId, grams: g });
      by.set(l.key, cur);
    }
  }
  const out: WasteLine[] = [];
  for (const { ok, ...w } of by.values()) {
    if (!ok || w.needG <= 0) continue;
    const packs = packsOf(w.needG, w.packG);
    const orderedG = packs * w.packG;
    out.push({ ...w, needG: Math.round(w.needG), packs, orderedG: Math.round(orderedG), restG: Math.max(0, Math.round(orderedG - w.needG)) });
  }
  return out.filter((w) => isLeftover(w.restG, w.packG)).sort((a, b) => Number(b.perishable) - Number(a.perishable) || b.restG / b.packG - a.restG / a.packG);
}

/** Points de score (propose.ts) : valeur du reste en euros × 2, moitié moins pour l'épicerie qui se garde. */
export function wastePenalty(lines: WasteLine[]): number {
  let p = 0;
  for (const w of lines) {
    const value = (w.restG / w.packG) * (w.price ?? 2);
    p += value * (w.perishable ? 2 : 1);
  }
  return p;
}
