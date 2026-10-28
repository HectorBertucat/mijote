// Dessins d'aliments par l'IA, pour les ingrédients qui tombent sur un dessin générique de la banque
// (resolve.ts, exact = false). Sonnet dessine un fragment SVG 64 × 64 dans le style de la banque ;
// le code le filtre (sanitizeIllu) avant de le garder (table food_art). Un dessin refusé repart
// une fois avec ses erreurs ; s'il reste refusé, l'ingrédient garde son générique.
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { foodArt as foodArtTable } from "@/lib/db/schema";
import { MODELS, structured } from "@/lib/ai";
import { FOOD_CATEGORIES, FOODS } from "./art";
import { foodArt } from "./resolve";
import { artKey, ILLU_ANIMATIONS, ILLU_TOKENS, sanitizeIllu } from "./sanitize";

const Drawing = z.object({
  item: z.string().describe("L'ingrédient, recopié tel quel"),
  label: z.string().describe("Nom court de l'aliment (« Poireau »)"),
  category: z.enum(FOOD_CATEGORIES),
  svg: z.string().describe("Fragment SVG (sans la balise <svg>), viewBox 0 0 64 64"),
});
const Drawings = z.object({ drawings: z.array(Drawing) });

const EXAMPLES = ["tomate", "oignon", "carotte", "persil"].filter((id) => id in FOODS) as (keyof typeof FOODS)[];

export function drawingSystem(): string {
  const examples = EXAMPLES.map((id) => `${FOODS[id].label} :\n${FOODS[id].svg.replace(/\s+/g, " ").replace(/var\(--i-/g, "var(--i-")}`).join("\n\n");
  return `Tu dessines des aliments pour une appli de cuisine, dans un style d'illustration simple et chaleureux : formes pleines, un trait commun (posé par l'appli : ne mets pas de stroke sur les formes pleines sauf pour un détail), vue de face ou de trois quarts, l'aliment centré, environ 44 px de large dans un cadre 64 × 64.

Contraintes (un programme vérifie, tout écart est refusé) :
- Un fragment SVG, sans la balise <svg>. Balises permises : g, path, circle, ellipse, rect, line, polyline, polygon. 3 à 25 formes. Pas de texte.
- Couleurs : uniquement des jetons var(--i-…), parmi : ${ILLU_TOKENS.join(", ")}. Ou fill="none".
- Attributs permis : d, points, cx, cy, r, rx, ry, x, y, width, height, x1, y1, x2, y2, fill, stroke, stroke-width, opacity, class, transform (translate, rotate, scale), style (seulement « transform-origin: X% Y% »), stroke-linecap, stroke-linejoin.
- Animation discrète facultative : class sur un <g> ou une forme, parmi ${ILLU_ANIMATIONS.join(", ")} (a-wobble, a-sway pour balancer, a-shine pour un reflet, a-steam pour une vapeur). Le dessin au repos doit se suffire.
- Nombres entre 0 et 64.

Exemples de la banque :
${examples}`;
}

export interface DrawResult {
  saved: { item: string; label: string }[];
  failed: { item: string; errors: string[] }[];
}

/** Ingrédients de la liste qui n'ont qu'un dessin générique et pas encore de dessin de l'IA. */
export function missingArt(db: Db, items: { item: string; food?: string | null }[]): string[] {
  const known = new Set(db.select({ key: foodArtTable.key }).from(foodArtTable).all().map((r) => r.key));
  const out = new Map<string, string>();
  for (const i of items) {
    const key = artKey(i.item);
    if (!key || known.has(key) || foodArt(i.food ?? null, i.item).exact) continue;
    out.set(key, i.item.split(/[,(]/)[0].trim());
  }
  return [...out.values()].slice(0, 8);
}

export async function drawFoods(db: Db, items: string[]): Promise<DrawResult> {
  const system = drawingSystem();
  const res: DrawResult = { saved: [], failed: [] };
  if (!items.length) return res;
  const ask = (list: string[], feedback = "") =>
    structured({
      db,
      screen: "dessins",
      model: MODELS.plan,
      effort: "low",
      maxTokens: 12000,
      system,
      prompt: `${feedback}Dessine ces aliments (un dessin chacun) :\n${list.map((x) => `- ${x}`).join("\n")}`,
      schema: Drawings,
      devMock: () => ({ drawings: list.map((item) => ({ item, label: item, category: "legume" as const, svg: FOODS.tomate.svg })) }),
    });
  const keep = (d: z.infer<typeof Drawing>) => {
    const s = sanitizeIllu(d.svg);
    if (!s.svg) return s.errors;
    db.insert(foodArtTable)
      .values({ key: artKey(d.item), label: d.label.slice(0, 40), category: d.category, svg: s.svg })
      .onConflictDoUpdate({ target: foodArtTable.key, set: { label: d.label.slice(0, 40), category: d.category, svg: s.svg } })
      .run();
    res.saved.push({ item: d.item, label: d.label });
    return null;
  };
  const first = await ask(items);
  const retry: { item: string; errors: string[] }[] = [];
  for (const item of items) {
    const d = first.drawings.find((x) => artKey(x.item) === artKey(item));
    if (!d) retry.push({ item, errors: ["dessin manquant"] });
    else {
      const errors = keep(d);
      if (errors) retry.push({ item, errors });
    }
  }
  if (retry.length) {
    const second = await ask(
      retry.map((r) => r.item),
      `Ces dessins ont été refusés par le programme de vérification :\n${retry.map((r) => `- ${r.item} : ${r.errors.join(" ; ")}`).join("\n")}\nRedessine-les en respectant les contraintes.\n\n`
    );
    for (const r of retry) {
      const d = second.drawings.find((x) => artKey(x.item) === artKey(r.item));
      const errors = d ? keep(d) : ["dessin manquant"];
      if (errors) res.failed.push({ item: r.item, errors });
    }
  }
  return res;
}

/** Tous les dessins de l'IA, pour le contexte des composants (clé → SVG filtré). */
export function loadCustomArt(db: Db): Record<string, string> {
  return Object.fromEntries(db.select({ key: foodArtTable.key, svg: foodArtTable.svg }).from(foodArtTable).all().map((r) => [r.key, r.svg]));
}

export const deleteArt = (db: Db, key: string) => db.delete(foodArtTable).where(eq(foodArtTable.key, key)).run();
