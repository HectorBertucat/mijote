// Prompts de l'atelier. Le système est stable (mis en cache) : règles, table
// nutritionnelle, équipement, préférences. La recette et la demande vont dans le message.
import { FOODS } from "@/lib/nutrition/foods";
import type { Member } from "@/lib/eaters/core";
import { computeNutrition } from "@/lib/nutrition/compute";
import { densityTarget, fitLine, recipeFits } from "@/lib/week/fit";
import type { RecipeInput } from "@/lib/recipes/format";
import { toAiRecipe } from "./schema";

export interface PromptContext {
  preferences: { who: string | null; kind: string; text: string }[];
  equipment: { id: string; name: string; notes: string | null; maxBatchG: number | null }[];
  /** Le foyer, personne de référence en tête. */
  household: Member[];
  /** Les foyers de la plaque (nombre, niveaux de puissance, type). */
  hob: { count: number; levels: number | null; kind: string | null };
  /** Où se font les courses (« le drive Chronodrive de … »), ou null. */
  store: string | null;
}

const KIND_LABEL: Record<string, string> = { like: "aime", dislike: "n'aime pas", avoid_task: "tâche pénible", rule: "règle" };

/** Unités cuites par défaut : deux repas pour tout le foyer. */
export const defaultBatchUnits = (household: Member[]) => Math.max(8, 2 * household.reduce((s, m) => s + m.units, 0));

export function systemPrompt(ctx: PromptContext): string {
  const foods = Object.entries(FOODS)
    .map(([id, f]) => `${id} : ${f.name}`)
    .join("\n");
  const eq = ctx.equipment
    .map((e) => `${e.id} : ${e.name}${e.maxBatchG ? ` (${e.maxBatchG} g de viande au plus par fournée)` : ""}${e.notes ? `, ${e.notes}` : ""}`)
    .join("\n");
  const prefs = ctx.preferences.map((p) => `- ${p.who ? `${p.who} ` : ""}${KIND_LABEL[p.kind] ?? p.kind} : ${p.text}`).join("\n");
  const people = ctx.household.length ? ctx.household : [{ id: "x", name: "la personne", units: 4, ref: null }];
  const names = people.map((m) => m.name).join(", ");
  const parts = people.map((m) => `${m.name} mange ${m.units} unités par repas${m.ref ? ` (repère : ${m.ref.kcalMin}-${m.ref.kcalMax} kcal et ${m.ref.proteinMin}-${m.ref.proteinMax} g de protéines)` : ""}`).join(" ; ");
  const unit = defaultBatchUnits(people);
  // La part de chacun suit ses kcal : ce sont les protéines pour 100 kcal qui décident si la recette tombe bien.
  const dense = people.filter((m) => m.ref).map((m) => ({ name: m.name, d: densityTarget(m.ref!) })).sort((x, y) => y.d - x.d);
  const density = dense.length ? ` La part de chacun s'ajuste à ses kcal : ce qui compte, ce sont les protéines pour 100 kcal (au moins ${dense.map((x) => `${x.d.toLocaleString("fr-FR")} g pour ${x.name}`).join(", ")}).` : "";
  const levels = ctx.hob.levels ? `${ctx.hob.levels} niveaux` : "un réglage de puissance";
  const hob = `Plaque ${ctx.hob.kind ?? "de cuisson"}, ${ctx.hob.count} foyer${ctx.hob.count > 1 ? "s" : ""}, ${levels}`;
  return `Tu es le cuisinier du foyer (${names}). Tu écris des recettes de batch cooking en français, au format JSON demandé, qu'un programme vérifie ensuite (catalogue du magasin, nutrition, équipement).

Ce qui compte :
- Le goût d'abord. Jamais de recette triste pour gagner des calories : on garde la saisie, les sucs, les aromates, l'acidité douce du citron, une sauce. On allège en retirant le gras caché, pas le plaisir.
- Les portions : ${parts}. Une recette de batch fait en général ${unit} unités environ (deux repas pour tout le foyer), un plat minute la moitié.${density}
- Le matériel réel (ci-dessous). ${hob}. Toute étape de saisie (kind « sear ») donne le niveau du foyer (hobLevel, sur l'échelle de la plaque), la durée, et un repère visuel ou sonore (cue) : poêle préchauffée à vide, test de la goutte d'eau (elle glisse comme une bille), on baisse d'un cran, viande bien sèche, pas trop de viande par fournée (respecte la limite du récipient), on ne touche pas tant qu'elle ne se décolle pas seule (réaction de Maillard : croûte brun doré, grésillement franc), puis on déglace les sucs.
- Des étapes simples : prep en bols lettrés (A, B, C…), puis la cuisson dit « bol C ». Durées réalistes. Riz et pâtes à part.
- Sous-étapes chronométrées (phases), obligatoires : en session, chaque sous-étape a son minuteur et la suivante démarre quand il sonne. Toute étape de cuisson (sear, braise, boil, bake) de 2 min de geste ou plus, et toute saisie, les découpe dans l'ordre : préchauffe à vide (2 à 3 min à feu vif), test de la goutte (30 s), ajout, cuisson sans toucher, retournement… Chaque sous-étape : un geste court à l'impératif, sa durée (min, 0,5 = 30 s), son niveau de foyer s'il change, et « batch » 1, 2, 3 quand une saisie se fait en plusieurs fournées (une série de sous-étapes par fournée). Leur somme ne dépasse jamais durationMin : ce qui reste est le minuteur d'attente de l'étape (mijotage, four, cuisson du riz). wait = true pour une attente sans geste (l'eau chauffe, le riz cuit 11 min, le gratin dore) : l'écran passe à autre chose et sa fin sonne pour rappeler la sous-étape suivante (« Dès que ça bout : pâtes », « Hors du feu, repos », « Inverse les plats »). Une cuisson à l'eau ou au four s'écrit ainsi de bout en bout : geste, attente, geste, attente, égoutter. Une sous-étape qui cite un bol le cite aussi dans bowls. phases = [] pour une prep, un repos ou un geste unique.
- Les produits viennent ${ctx.store ? `de ${ctx.store}` : "d'un supermarché courant"} : des produits courants. lineRaw est la ligne de la liste de courses, avec la quantité et un nom de produit simple (« 500 g sauté de porc », « 2 courgettes », « 200 g crème légère 15 % »).
- Chaque ingrédient a ses grammes crus (grams), et l'id de la table nutritionnelle ci-dessous (food) s'il y figure ; « zero » pour sel, poivre, herbes, eau ; null s'il n'y est pas. N'invente pas d'id. Les valeurs nutritionnelles sont calculées par le programme, pas par toi.
- pantry = true pour le placard (sel, poivre, huile, épices, sauces en bouteille, bouillon). optional = true seulement si on peut s'en passer.

Table nutritionnelle (id : aliment) :
${foods}

Équipement (equipmentId : récipient) :
${eq}

Goûts et règles de la maison :
${prefs || "- (aucune préférence notée)"}`;
}

const json = (r: RecipeInput) => JSON.stringify(toAiRecipe(r));

/**
 * Adéquation de la recette au repère de chacun, calculée par l'appli (src/lib/week/fit.ts) : la part
 * suit les kcal de chacun, la ligne dit qui elle sert bien et où elle coince. Vide sans repère.
 */
export function fitContext(recipe: Pick<RecipeInput, "ingredients" | "servingsUnits">, household: Member[]): string {
  const withRef = household.filter((m) => m.ref);
  if (!withRef.length || recipe.servingsUnits <= 0) return "";
  const n = computeNutrition(
    recipe.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })),
    recipe.servingsUnits
  );
  const line = fitLine(recipeFits(withRef.map((m) => ({ id: m.id, name: m.name, baseUnits: m.units, ref: m.ref })), { kcalUnit: n.perUnit.kcal, proteinUnit: n.perUnit.protein }));
  return line ? `\nAdéquation actuelle aux repères (calcul de l'appli : bien, juste ou loin) : ${line}.\n` : "";
}

export function adjustPrompt(recipe: RecipeInput, request: string, household: Member[] = []): string {
  return `Recette actuelle (JSON) :
${json(recipe)}
${fitContext(recipe, household)}
Demande : ${request}

Rends la recette complète ajustée.
- Pour chaque ingrédient que tu gardes, même avec une autre quantité, recopie exactement son « item » d'origine (le programme compare les deux versions). Mets à jour lineRaw et grams avec la nouvelle quantité.
- Un nouvel ingrédient a un nouvel item. Un ingrédient retiré disparaît de la liste.
- Réécris les étapes touchées (quantités, nouvelle étape de saisie avec niveau, durée et repère).
- Garde le même nombre d'unités (servingsUnits = ${recipe.servingsUnits}) et un slug court qui dit la variante.
- explanation : 2 ou 3 phrases, ce qui change et pourquoi le goût tient. changes : la liste des changements, très courts.`;
}

export interface CreationRequest {
  envie: string;
  add: string[]; // aliments à ajouter (noms de produits du catalogue)
  remove: string[]; // ingrédients à retirer (item)
  avoid: string[]; // recettes trop proches déjà proposées
}

export function creationPrompt(input: { request: CreationRequest; library: { name: string; main: string[] }[]; current: RecipeInput | null; household?: Member[] }): string {
  const { request, library, current } = input;
  const people = input.household?.length ? input.household : null;
  const units = people ? defaultBatchUnits(people) : 18;
  const split = people ? ` (deux repas pour ${people.map((m) => `${m.name} ${m.units}`).join(" + ")})` : "";
  const lib = library.map((r) => `- ${r.name} (${r.main.join(", ")})`).join("\n");
  const base = current
    ? `Recette en cours (JSON) :
${json(current)}
${fitContext(current, people ?? [])}
Modifie-la :
${request.add.length ? `- Ajoute : ${request.add.join(", ")} (intègre-les vraiment au plat, quantités et étapes).\n` : ""}${request.remove.length ? `- Retire : ${request.remove.join(", ")} (et ce qui ne sert plus).\n` : ""}- Pour chaque ingrédient gardé, recopie exactement son « item ».`
    : `Crée une recette.`;
  return `Envie : ${request.envie}

Bibliothèque existante (ne propose pas un doublon de ces plats, ni un plat qui a les mêmes ingrédients principaux) :
${lib}
${request.avoid.length ? `\nDéjà proposé et refusé car trop proche de la bibliothèque : ${request.avoid.join(", ")}.\n` : ""}
${base}

Règles : ${units} unités par défaut${split}, tags courts (protéine, mode de cuisson), fridgeDays réaliste (3 à 4), status implicite « à essayer ». explanation : 2 ou 3 phrases.`;
}
