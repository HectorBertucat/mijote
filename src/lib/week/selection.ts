// Une sélection de recettes avec leurs unités, telle qu'elle voyage dans une URL du
// Composer (`?r=chasseur-porc*1.5,pasta-al-forno&x=<ingredientId>:200`) ou dans un
// formulaire. Module pur.
import { isFactor } from "./propose";

export interface Selection {
  slugs: string[];
  scales: Record<string, number>; // slug → multiplicateur (absent = 1)
  extras: Record<string, number>; // recipe_ingredient_id → grammes ajoutés
}

export function parseSelection(r: string | undefined, x?: string | undefined): Selection {
  const slugs: string[] = [];
  const scales: Record<string, number> = {};
  for (const part of (r ?? "").split(",")) {
    const [slug, f] = part.split("*");
    if (!slug || !/^[a-z0-9-]+$/.test(slug) || slugs.includes(slug)) continue;
    slugs.push(slug);
    const n = Number(f);
    if (f && isFactor(n) && n !== 1) scales[slug] = n;
  }
  const extras: Record<string, number> = {};
  for (const part of (x ?? "").split(",")) {
    const [id, g] = part.split(":");
    const n = Math.round(Number(g));
    if (id && /^[0-9a-f-]{8,}$/i.test(id) && n > 0 && n <= 5000) extras[id] = n;
  }
  return { slugs, scales, extras };
}

export function formatSelection(s: Selection): { r: string; x: string } {
  return {
    r: s.slugs.map((slug) => (s.scales[slug] && s.scales[slug] !== 1 ? `${slug}*${s.scales[slug]}` : slug)).join(","),
    x: Object.entries(s.extras)
      .filter(([, g]) => g > 0)
      .map(([id, g]) => `${id}:${Math.round(g)}`)
      .join(","),
  };
}

export function composerHref(s: Selection): string {
  if (!s.slugs.length) return "/composer";
  const { r, x } = formatSelection(s);
  return `/composer?r=${r}${x ? `&x=${x}` : ""}`;
}

/** « ×1,5 » */
export const factorLabel = (f: number) => `×${String(f).replace(".", ",")}`;
