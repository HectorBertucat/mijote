// L'accueil en code : l'action du moment (une seule) et la phrase-titre de la semaine, à partir
// de l'état de la période (plats, repas couverts, liste de courses, session). Module pur.
import { addDays, COOK_DAY } from "@/lib/week/propose";
import { spanDays } from "@/lib/week/period";
import { firstOfMonth } from "@/lib/typo";

/** Espace insécable (avant « : », dans « 2 h 40 », avant « kcal »). */
export const NBSP = " ";

export interface HomeState {
  /** Session lancée (prep, frigo la veille, cuisson). */
  active: { id: string } | null;
  /** Plats retenus pour la période. */
  dishes: number;
  /** Repas de la période sans plat (hors absences). */
  missing: number;
  /** Une session de cette période est finie. */
  cooked: boolean;
  list: { id: string; ordered: boolean; changed: boolean; building: boolean } | null;
  /** Jour de la session (AAAA-MM-JJ), la veille du premier jour. */
  cookDay: string;
  today: string;
}

export type HomeStep =
  | { kind: "resume"; sessionId: string }
  | { kind: "choose" }
  | { kind: "cover"; missing: number }
  | { kind: "eat" }
  | { kind: "list"; changed: boolean }
  | { kind: "wait"; listId: string }
  | { kind: "shop"; listId: string }
  | { kind: "cook"; listId: string };

/**
 * Ce qu'il y a à faire maintenant, dans l'ordre du batch : reprendre une session lancée ;
 * choisir les plats ; couvrir les repas qui manquent ; une fois cuisiné, manger ; sinon la liste,
 * les courses, puis cuisiner.
 */
export function nextStep(s: HomeState): HomeStep {
  if (s.active) return { kind: "resume", sessionId: s.active.id };
  if (!s.dishes) return { kind: "choose" };
  if (s.missing > 0) return { kind: "cover", missing: s.missing };
  if (s.cooked) return { kind: "eat" };
  if (!s.list || s.list.changed) return { kind: "list", changed: !!s.list?.changed };
  if (s.list.building) return { kind: "wait", listId: s.list.id };
  if (!s.list.ordered) return { kind: "shop", listId: s.list.id };
  return { kind: "cook", listId: s.list.id };
}

const WEEKDAY = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const weekday = (ymd: string) => WEEKDAY[(new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7];

/**
 * Un jour dit par rapport à aujourd'hui : « aujourd'hui », « demain », « dimanche » (dans la
 * semaine qui vient), « dimanche 8 novembre » plus loin, « hier » ou « dimanche dernier » avant.
 */
export function dayWord(ymd: string, today: string): string {
  const d = spanDays(today, ymd) - 1;
  if (d === 0) return "aujourd’hui";
  if (d === 1) return "demain";
  if (d === -1) return "hier";
  if (d > 1 && d < 7) return weekday(ymd);
  if (d < 0 && d > -7) return `${weekday(ymd)} dernier`;
  return firstOfMonth(new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
}

/** Durée arrondie à 5 min : « 2 h 40 », « 45 min ». */
export function minutesText(m: number): string {
  const r = Math.max(5, Math.round(m / 5) * 5);
  return r >= 60 ? `${Math.floor(r / 60)}${NBSP}h${NBSP}${String(r % 60).padStart(2, "0")}` : `${r}${NBSP}min`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n}${NBSP}${n > 1 ? many : one}`;

/**
 * La semaine en un titre, des chiffres plutôt que des adjectifs, une ligne par idée :
 * ["3 plats,", "28 repas,", "2 h 40 dimanche."]. Sans plat : ["28 repas", "à prévoir."].
 */
export function headline(p: { dishes: number; meals: number; minutes: number | null; cookDay: string; today: string; cooked?: boolean }): string[] {
  if (!p.dishes) return [plural(p.meals, "repas", "repas"), "à prévoir."];
  const when = dayWord(p.cookDay, p.today);
  const last = p.cooked ? `cuisinés ${when}.` : p.minutes != null ? `${minutesText(p.minutes)} ${when}.` : `en cuisine ${when}.`;
  return [`${plural(p.dishes, "plat")},`, `${plural(p.meals, "repas", "repas")},`, last];
}

/** Libellé du bouton de l'action du moment. */
export function stepLabel(step: HomeStep, cookDay: string, today: string): string {
  switch (step.kind) {
    case "resume":
      return "Reprendre la session";
    case "choose":
      return "Choisir les plats de la semaine";
    case "cover":
      return step.missing > 1 ? `Couvrir les ${step.missing} repas qui manquent` : "Couvrir le repas qui manque";
    case "eat":
      return "Ouvrir le frigo";
    case "list":
      return step.changed ? "Refaire la liste de courses" : "Faire la liste de courses";
    case "wait":
      return "Voir la liste qui se prépare";
    case "shop":
      return "Faire les courses";
    case "cook": {
      const d = spanDays(today, cookDay) - 1;
      if (d <= 0) return "Cuisiner maintenant";
      return `Cuisiner ${dayWord(cookDay, today)}`;
    }
  }
}

/** Jour de session d'une période (la veille du premier jour, cf. COOK_DAY). */
export const cookDayOf = (start: string) => addDays(start, COOK_DAY);
