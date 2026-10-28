// Goûts : ce que chacun n'aime pas (table preferences, kind « dislike », tags
// « ingredient » ou « plat »), cherché en code dans le nom et les ingrédients des
// recettes. Module pur. Les dislikes de goût ou de texture (« l'acidité en général »,
// « les viandes maigres qui sèchent ») ne se cherchent pas dans une fiche : ignorés ici.

export interface DislikePref {
  personId: string | null;
  kind: string;
  text: string;
  tags: string[];
}

export interface TasteRecipe {
  slug: string;
  name: string;
  ingredients: { item: string; lineRaw?: string | null; food?: string | null }[];
}

export interface DislikeRule {
  personId: string;
  /** Ce qui s'affiche : « brocoli », « bœuf haché ». */
  label: string;
  /** Où chercher : « ingredient » (ingrédients et nom) ou « plat » (nom de la recette). */
  scope: "ingredient" | "plat";
  patterns: RegExp[];
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Expressions qui contiennent le mot sans être l'aliment (« huile d'olive » n'est pas une olive).
const NOT_THE_FOOD: RegExp[] = [/\bhuiles? d olives?\b/g];

// Synonymes connus (forme repliée, sans accents). Le reste suit la règle générale.
const SYNONYMS: Record<string, string[]> = {
  "boeuf hache": ["boeuf hache", "hache de boeuf", "steak hache", "steaks haches", "viande hachee de boeuf", "hache boeuf", "boulettes de boeuf"],
  brocoli: ["brocoli", "brocolis"],
  capres: ["capre", "capres"],
  olives: ["olive", "olives", "tapenade"],
  cornichons: ["cornichon", "cornichons"],
  concombre: ["concombre", "concombres", "tzatziki"],
  "hachis parmentier": ["hachis parmentier", "parmentier"],
};

// Qualificatifs qui précisent un dislike sans changer l'aliment à éviter (« bœuf haché sec »).
const QUALIFIERS = new Set(["sec", "seche", "secs", "seches", "cuit", "cru", "crue", "en", "general"]);

const plural = (w: string) => (w.endsWith("s") || w.endsWith("x") ? w : `${w}s?`);

function patternsFor(key: string): RegExp[] {
  const forms = SYNONYMS[key] ?? [key];
  return forms.map((f) => new RegExp(`\\b${f.split(" ").map(plural).join(" ")}\\b`));
}

/** Les règles d'exclusion tirées des préférences en base. */
export function dislikeRules(prefs: DislikePref[]): DislikeRule[] {
  const out: DislikeRule[] = [];
  for (const p of prefs) {
    if (p.kind !== "dislike" || !p.personId) continue;
    const scope = p.tags.includes("plat") ? "plat" : p.tags.includes("ingredient") ? "ingredient" : null;
    if (!scope) continue;
    const words = fold(p.text.split(/[(:,;]/)[0]).split(" ").filter((w) => w && !QUALIFIERS.has(w));
    if (!words.length) continue;
    const key = words.join(" ");
    const label = p.text.split(/[(:,;]/)[0].trim().toLowerCase().replace(/\s+(sec|sèche|secs|sèches)$/, "");
    out.push({ personId: p.personId, label, scope, patterns: patternsFor(key) });
  }
  return out;
}

function haystack(r: TasteRecipe, scope: DislikeRule["scope"]): string {
  const parts = scope === "plat" ? [r.name] : [r.name, ...r.ingredients.flatMap((i) => [i.item, i.lineRaw ?? "", (i.food ?? "").replace(/_/g, " ")])];
  let s = ` ${parts.map(fold).join(" | ")} `;
  for (const re of NOT_THE_FOOD) s = s.replace(re, " ");
  return s;
}

/** Ce qu'une recette contient de ce que chacun n'aime pas : personne → libellés. */
export function dislikesIn(r: TasteRecipe, rules: DislikeRule[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const hay = { ingredient: haystack(r, "ingredient"), plat: haystack(r, "plat") };
  for (const rule of rules) {
    if (!rule.patterns.some((re) => re.test(hay[rule.scope]))) continue;
    out.set(rule.personId, [...(out.get(rule.personId) ?? []), rule.label]);
  }
  return out;
}

/** slug → personnes à qui ne pas servir la recette (pour propose/assign). */
export function exclusionsOf(recipes: TasteRecipe[], rules: DislikeRule[]): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const r of recipes) {
    const d = dislikesIn(r, rules);
    if (d.size) out.set(r.slug, d);
  }
  return out;
}

/** « brocoli, concombre et bœuf haché » */
export function joinFr(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`;
}
