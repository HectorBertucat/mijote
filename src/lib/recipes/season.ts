// Saison des fruits et légumes (calendrier France métropolitaine, pleine saison seulement) : le cachet « De saison »
// d'une recette, et le motif de saison de l'en-tête. Pur : seuls les produits qui ont une vraie saison comptent
// (oignon, carotte, champignon de Paris, ail… sont là toute l'année et ne donnent jamais le cachet).

export type Season = "hiver" | "printemps" | "ete" | "automne";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Mois de pleine saison (1 = janvier). `words` : mots entiers à trouver dans le nom de l'ingrédient (sans accents,
// pluriel en « s » accepté ; « courge » ne prend pas « courgettes », « pomme » ne prend pas « pomme de terre »).
const PRODUCE: { words: string[]; food?: string; months: number[]; name: string }[] = [
  { name: "courgette", words: ["courgette"], food: "courgette", months: [6, 7, 8, 9] },
  { name: "poivron", words: ["poivron"], food: "poivron", months: [7, 8, 9, 10] },
  { name: "haricot vert", words: ["haricot vert", "haricots verts"], food: "haricots_verts", months: [6, 7, 8, 9] },
  { name: "tomate", words: ["tomate fraiche", "tomates fraiches", "tomate cerise", "tomates cerises", "tomate grappe"], months: [7, 8, 9] },
  { name: "aubergine", words: ["aubergine"], months: [7, 8, 9] },
  { name: "potiron", words: ["potiron", "potimarron", "butternut", "courge"], months: [10, 11, 12, 1] },
  { name: "poireau", words: ["poireau"], months: [10, 11, 12, 1, 2, 3] },
  { name: "chou", words: ["chou", "choux", "chou-fleur"], months: [10, 11, 12, 1, 2, 3] },
  { name: "brocoli", words: ["brocoli"], months: [9, 10, 11] },
  { name: "épinard", words: ["epinard"], months: [3, 4, 5, 9, 10, 11] },
  { name: "asperge", words: ["asperge"], months: [4, 5, 6] },
  { name: "petit pois", words: ["petit pois", "petits pois"], months: [5, 6, 7] },
  { name: "patate douce", words: ["patate douce"], months: [10, 11, 12] },
  { name: "panais", words: ["panais"], months: [10, 11, 12, 1, 2] },
  { name: "céleri", words: ["celeri"], months: [10, 11, 12, 1, 2] },
  { name: "endive", words: ["endive"], months: [11, 12, 1, 2, 3] },
  { name: "radis", words: ["radis"], months: [4, 5, 6] },
  { name: "concombre", words: ["concombre"], months: [6, 7, 8, 9] },
  { name: "fraise", words: ["fraise"], months: [5, 6, 7] },
  { name: "pomme", words: ["pomme(?! de terre)"], months: [9, 10, 11, 12, 1, 2] },
  { name: "poire", words: ["poire"], months: [9, 10, 11, 12] },
  { name: "clémentine", words: ["clementine", "mandarine"], months: [11, 12, 1, 2] },
  { name: "orange", words: ["orange"], months: [12, 1, 2, 3] },
];

const cache = new Map<string, RegExp>();
function wordRe(w: string): RegExp {
  let re = cache.get(w);
  if (!re) {
    // « pomme(?! de terre) » : le pluriel se glisse avant la condition.
    const [head, tail = ""] = w.split(/(?=\(\?!)/);
    re = new RegExp(`(?:^|[^a-z])${head}s?${tail}(?:[^a-z]|$)`);
    cache.set(w, re);
  }
  return re;
}

/** Les produits de saison d'une liste d'ingrédients, pour le mois donné (1 à 12). */
export function inSeason(ingredients: { item: string; food?: string | null }[], month: number): string[] {
  const out = new Set<string>();
  for (const ing of ingredients) {
    const name = fold(ing.item);
    for (const p of PRODUCE) {
      if (!p.months.includes(month)) continue;
      if ((p.food && ing.food === p.food) || p.words.some((w) => wordRe(w).test(name))) out.add(p.name);
    }
  }
  return [...out];
}

/** Mois en cours à Paris (1 à 12). */
export function parisMonth(d = new Date()): number {
  return Number(d.toLocaleDateString("en-GB", { month: "numeric", timeZone: "Europe/Paris" }));
}

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return "hiver";
  if (month <= 5) return "printemps";
  if (month <= 8) return "ete";
  return "automne";
}
