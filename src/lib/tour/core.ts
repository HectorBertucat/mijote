// Prise en main (pur et testé, tests/visite.test.ts) : la visite guidée qui suit la mise en route (quelles étapes,
// dans quel ordre, quand la proposer) et les « premiers pas » de l’accueil, qui se cochent au fil de l’usage réel
// (une cible réglée, des plats choisis, une liste, une session, des boîtes rangées) puis disparaissent.
// Les textes passent par typo() à l’affichage.
import type { ActionId, FoodArtId } from "@/lib/illus/art";
import type { DishRecipe } from "@/lib/illus/dish";

/** Ce qu’une étape montre : la boîte d’un plat, un aliment ou un geste de la banque de dessins. */
export type TourArt = { kind: "dish"; recipe: DishRecipe } | { kind: "food"; id: FoodArtId } | { kind: "step"; id: ActionId };

export type TourStepId = "cycle" | "semaine" | "courses" | "session" | "frigo" | "sante" | "recherche" | "profil" | "fin";

export interface TourStep {
  id: TourStepId;
  /** Élément de l’interface montré (attribut data-tour) ; sans lui, ou s’il n’est pas affiché, l’étape s’ouvre au centre. */
  anchor?: string;
  title: string;
  body: string;
  art: TourArt[];
}

export interface TourContext {
  /** Catalogue configuré (CHRONOCATALOG_URL) : les produits du drive, avec leur prix. */
  catalog: boolean;
  /** Personnes du foyer : le sélecteur de profil n’existe qu’à partir de deux. */
  profiles: number;
  /** Écran large : la recherche ⌘K n’est affichée qu’au bureau. */
  desktop: boolean;
}

// Trois plats d’exemple, dessinés par DishBox depuis leurs ingrédients (aucune recette de l’instance n’est lue).
const ing = (item: string, grams: number) => ({ item, grams });
export const SAMPLE_DISHES: DishRecipe[] = [
  { slug: "visite-poulet", name: "Poulet aux champignons", ingredients: [ing("haut de cuisse de poulet", 900), ing("champignons de Paris", 400), ing("crème légère", 200), ing("oignon", 150)], steps: [{ kind: "simmer", text: "Laisser mijoter" }] },
  { slug: "visite-pates", name: "Pâtes tomate et ricotta", ingredients: [ing("pâtes", 500), ing("pulpe de tomate", 800), ing("ricotta", 250), ing("persil", 20)] },
  { slug: "visite-riz", name: "Riz, carottes et pois chiches", ingredients: [ing("pois chiches", 500), ing("carotte", 400), ing("riz basmati", 300), ing("citron vert", 50)] },
];

const dish = (i: number): TourArt => ({ kind: "dish", recipe: SAMPLE_DISHES[i] });

/** Les étapes de la visite, de A à Z : le cycle de la semaine, puis les outils de tous les jours. */
export function tourSteps(ctx: TourContext): TourStep[] {
  const steps: (TourStep | null)[] = [
    {
      id: "cycle",
      title: "Choisir, acheter, cuisiner, ranger",
      body: "Tu cuisines une fois pour toute la semaine. Je calcule les quantités, la part de chacun et l'ordre des gestes ; toi, tu choisis et tu goûtes.",
      art: [dish(0)],
    },
    {
      id: "semaine",
      anchor: "semaine",
      title: "Choisis tes plats",
      body: "Deux ou trois plats dans Semaine suffisent. Je répartis qui mange quoi, midi et soir, selon qui est là, et je dis s'il manque des repas.",
      art: [dish(0), dish(1), dish(2)],
    },
    {
      id: "courses",
      anchor: "courses",
      title: "Fais les courses",
      body: ctx.catalog
        ? "La liste se fait depuis les plats, rangée par rayon. Les produits du drive arrivent avec leur prix : tu remplis le panier depuis la liste."
        : "La liste se fait depuis les plats, rangée par rayon : tu coches en avançant dans les allées.",
      art: [{ kind: "food", id: "carotte" }, { kind: "food", id: "oignon" }, { kind: "food", id: "pates" }],
    },
    {
      id: "session",
      title: "Cuisine, le téléphone à côté du feu",
      body: "Une étape à la fois, en grand, et les minuteurs sonnent tout seuls. L'ordre tient compte de tes feux, de ton four et de tes casseroles.",
      art: [{ kind: "step", id: "chop" }, { kind: "step", id: "simmer" }],
    },
    {
      id: "frigo",
      anchor: "frigo",
      title: "Range les boîtes",
      body: "À la fin, pèse la marmite : je dis combien de grammes mettre dans la boîte de chacun, et ce qui part au congélo. Le Frigo dit quoi manger en premier.",
      art: [{ kind: "step", id: "portion" }, dish(1)],
    },
    {
      id: "sante",
      anchor: "sante",
      title: "Ta part suit ta cible",
      body: "Dans Santé, chacun règle son objectif. La part de chaque plat se cale dessus, et tes pesées l'affinent de semaine en semaine.",
      art: [{ kind: "food", id: "oeuf" }, { kind: "food", id: "filet_poulet" }, { kind: "food", id: "pois_chiches" }],
    },
    ctx.desktop
      ? {
          id: "recherche",
          anchor: "recherche",
          title: "Trouve une recette",
          body: "⌘K, ou Ctrl K, cherche une recette par son nom ou par un ingrédient, depuis n'importe quelle page.",
          art: [],
        }
      : null,
    ctx.profiles > 1
      ? {
          id: "profil",
          anchor: "profil",
          title: "Change de profil",
          body: "Chaque initiale est une personne du foyer. Choisis la tienne : l'accueil montre alors tes repas et ta part.",
          art: [],
        }
      : null,
    {
      id: "fin",
      anchor: "premiers-pas",
      title: "Tes premiers pas",
      body: "Cette liste, sur l'accueil, se coche au fil de ta première semaine, puis disparaît. La visite se relance dans Réglages.",
      art: [{ kind: "step", id: "season" }],
    },
  ];
  return steps.filter((s): s is TourStep => s != null);
}

/** Visite proposée d’elle-même : une fois, après la mise en route, tant que personne n’a encore cuisiné. */
export function offerTour({ setupDone, seen, cooked }: { setupDone: boolean; seen: boolean; cooked: boolean }): boolean {
  return setupDone && !seen && !cooked;
}

/** Étape suivante (ou précédente) ; null quand on sort de la visite par la fin. */
export function stepAfter(at: number, total: number, dir: 1 | -1): number | null {
  const next = at + dir;
  if (next >= total) return null;
  return Math.max(0, next);
}

// ─── Premiers pas ───

/** Ce que l’instance a déjà fait, lu en base (src/lib/tour/store.ts). */
export interface FirstStepsFacts {
  /** Le profil ouvert a fini sa mise en route dans Santé (sa cible, sa part). */
  target: boolean;
  /** Des plats retenus pour une période. */
  dishes: boolean;
  /** Une liste de courses. */
  list: boolean;
  /** Une session lancée pour de vrai (pas une session test). */
  session: boolean;
  /** Des boîtes rangées. */
  boxes: boolean;
}

export type FirstStepId = keyof FirstStepsFacts;

export const FIRST_STEPS: { id: FirstStepId; label: string; hint: string; href: string }[] = [
  { id: "target", label: "Régler ta part", hint: "Dans Santé : ton objectif, et ta part de chaque plat.", href: "/sante/demarrer" },
  { id: "dishes", label: "Choisir deux ou trois plats", hint: "Dans Semaine : je répartis les repas.", href: "/semaine#recettes" },
  { id: "list", label: "Faire la liste de courses", hint: "Depuis les plats, rangée par rayon.", href: "/courses" },
  { id: "session", label: "Lancer une session", hint: "Le téléphone à côté du feu.", href: "/composer" },
  { id: "boxes", label: "Ranger les boîtes", hint: "Les grammes de chacun, au frigo ou au congélo.", href: "/frigo" },
];

export interface FirstStepsView {
  items: ((typeof FIRST_STEPS)[number] & { done: boolean })[];
  done: number;
  total: number;
  /** Le premier pas pas encore fait, dans l’ordre du cycle. */
  next: FirstStepId | null;
  complete: boolean;
}

export function firstSteps(facts: FirstStepsFacts): FirstStepsView {
  const items = FIRST_STEPS.map((s) => ({ ...s, done: facts[s.id] }));
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, next: items.find((i) => !i.done)?.id ?? null, complete: done === items.length };
}

/** La liste s’affiche sur l’accueil tant qu’il reste un pas et qu’on ne l’a pas masquée. */
export function showFirstSteps({ setupDone, hidden, facts }: { setupDone: boolean; hidden: boolean; facts: FirstStepsFacts }): boolean {
  return setupDone && !hidden && !firstSteps(facts).complete;
}
