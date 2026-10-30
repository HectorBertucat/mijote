// La période d'une « semaine » : du premier jour (week_plans.week_start) au dernier, sur
// week_plans.days jours (7 par défaut, 14 au plus). La session de cuisine a lieu la veille du
// premier jour (COOK_DAY) ; meal_slots.day va de 0 au nombre de jours − 1. Module pur.
import { addDays, defaultWeek } from "./propose";

/** Plafond de la période : au-delà, même le congélateur ne suit plus (et la session déborde). */
export const MAX_DAYS = 14;
export const MIN_DAYS = 1;
export const DEFAULT_DAYS = 7;

/** Raccourcis du sélecteur de période. */
export const PERIOD_PRESETS = [
  { days: 7, label: "1 semaine" },
  { days: 10, label: "10 jours" },
  { days: 14, label: "2 semaines" },
] as const;

const WEEKDAY = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
const WEEKDAY_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;
const LETTER = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Une date AAAA-MM-JJ qui existe (pas de 31 février). */
export const isDay = (s: string | undefined | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Jour de la semaine d'une date, 0 = lundi. */
export const weekdayOf = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Nombre de jours de `from` à `to`, les deux compris (0 ou moins si `to` est avant `from`). */
export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export const clampDays = (n: number) => (Number.isFinite(n) ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(n))) : DEFAULT_DAYS);

/** Dernier jour de la période. */
export const endOf = (start: string, days: number) => addDays(start, days - 1);

export interface PeriodDay {
  /** Indice du jour dans la période (meal_slots.day). */
  i: number;
  date: string;
  /** 0 = lundi */
  weekday: number;
  /** « lun » */
  short: string;
  /** « Lundi » */
  long: string;
  /** « L » */
  letter: string;
  /** Numéro du jour dans le mois. */
  num: number;
}

/** Les jours de la période, dans l'ordre. */
export function periodDays(start: string, days: number): PeriodDay[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const wd = weekdayOf(date);
    return { i, date, weekday: wd, short: WEEKDAY[wd], long: WEEKDAY_LONG[wd], letter: LETTER[wd], num: Number(date.slice(8, 10)) };
  });
}

/** Le jour de la période qui tombe à `date`, ou null hors de la période. */
export function dayIndexIn(start: string, days: number, date: string): number | null {
  const i = spanDays(start, date) - 1;
  return i >= 0 && i < days ? i : null;
}

/**
 * Lit « du … au … » saisi par l'utilisateur : la date de début et le nombre de jours, le dernier
 * jour ramené dans [1, MAX_DAYS] (une fin avant le début = un seul jour). null si une date manque.
 */
export function parsePeriod(from: string | null | undefined, to: string | null | undefined): { start: string; days: number } | null {
  if (!isDay(from)) return null;
  if (!isDay(to)) return { start: from, days: DEFAULT_DAYS };
  return { start: from, days: clampDays(spanDays(from, to)) };
}

/** Une semaine « classique » : du lundi, 7 jours (ce qu'on crée sans rien dire). */
export const isClassicWeek = (start: string, days: number) => days === DEFAULT_DAYS && weekdayOf(start) === 0;

export interface PlanRef {
  start: string;
  days: number;
  /** Recettes choisies, ou période réglée à la main : un plan que l'utilisateur a touché. */
  touched: boolean;
}

/** Plus que ce nombre de jours dans la période en cours : on l'affiche encore ; sinon on prépare la suivante. */
const SWITCH_LEFT = 3;

/**
 * La période affichée par défaut, en code :
 * 1. celle qui contient aujourd'hui (touchée), tant qu'il reste plus de 3 jours ;
 * 2. sinon la prochaine touchée qui commence après aujourd'hui ;
 * 3. sinon la suivante de celle en cours (le lendemain de sa fin, même longueur) ;
 * 4. sinon la semaine du lundi (en cours du lundi au jeudi, la suivante à partir du vendredi).
 */
export function defaultPeriod(plans: PlanRef[], now: Date): { start: string; days: number } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
  const touched = plans.filter((p) => p.touched).sort((a, b) => a.start.localeCompare(b.start));
  const current = [...touched].reverse().find((p) => dayIndexIn(p.start, p.days, today) != null);
  if (current && spanDays(today, endOf(current.start, current.days)) > SWITCH_LEFT) return { start: current.start, days: current.days };
  const next = touched.find((p) => p.start > today);
  if (next) return { start: next.start, days: next.days };
  if (current) return { start: addDays(current.start, current.days), days: current.days };
  return { start: defaultWeek(now), days: DEFAULT_DAYS };
}

/**
 * Période voisine (navigation ‹ ›) : un plan existant qui touche celle-ci bout à bout, sinon une
 * période de même longueur, juste avant ou juste après.
 */
export function neighbour(plans: Pick<PlanRef, "start" | "days">[], start: string, days: number, dir: 1 | -1): { start: string; days: number } {
  if (dir > 0) {
    const s = addDays(start, days);
    const found = plans.find((p) => p.start === s);
    return { start: s, days: found?.days ?? days };
  }
  const found = plans.filter((p) => p.start < start && addDays(p.start, p.days) === start).sort((a, b) => b.start.localeCompare(a.start))[0];
  return found ? { start: found.start, days: found.days } : { start: addDays(start, -days), days };
}

/**
 * Présences d'une période déplacée ou allongée : chaque repas garde la présence qu'il avait à la
 * même date ; un jour nouveau prend la présence par défaut. Renvoie les créneaux de la nouvelle période.
 */
export function remapPlaces<P extends string, M extends string>(
  old: { start: string; slots: { day: number; meal: M; personId: string; place: P }[] },
  next: { start: string; days: number },
  meals: readonly M[],
  personIds: string[],
  fallback: (weekday: number, meal: M, personId: string) => P
): { day: number; meal: M; personId: string; place: P }[] {
  const kept = new Map(old.slots.map((s) => [`${addDays(old.start, s.day)}:${s.meal}:${s.personId}`, s.place]));
  const out: { day: number; meal: M; personId: string; place: P }[] = [];
  for (const d of periodDays(next.start, next.days))
    for (const meal of meals)
      for (const personId of personIds) out.push({ day: d.i, meal, personId, place: kept.get(`${d.date}:${meal}:${personId}`) ?? fallback(d.weekday, meal, personId) });
  return out;
}

/** Libellé court : « semaine du 2 novembre » pour une semaine classique, « du 5 au 15 novembre » sinon. */
export function periodLabel(start: string, days: number, month: "long" | "short" = "long"): string {
  const end = endOf(start, days);
  const f = (ymd: string, withMonth: boolean) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", ...(withMonth ? { month } : {}), timeZone: "UTC" });
  if (isClassicWeek(start, days)) return `semaine du ${f(start, true)}`;
  if (days === 1) return `le ${f(start, true)}`;
  return `du ${f(start, start.slice(0, 7) !== end.slice(0, 7))} au ${f(end, true)}`;
}

/** Le même, en titre : « Semaine du 2 novembre », « Du 5 au 15 novembre ». */
export function periodHeading(start: string, days: number): string {
  const l = periodLabel(start, days);
  return l.charAt(0).toUpperCase() + l.slice(1);
}
