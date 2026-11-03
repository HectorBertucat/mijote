// « Où j'en suis » (Santé) : l'objectif, la tendance et son rythme face au rythme visé, la cible du jour et
// d'où elle vient, ce qui manque pour qu'elle s'ajuste au prochain lundi, les protéines visées et
// atteintes, et ce que ça change pour les portions. Module pur, sans accès à la base
// (tests/sante-status.test.ts) ; la base est lue par ./status-store.ts.
//
// La règle du lundi est celle de ./core (adaptiveTdee) : sur les 21 jours qui finissent le dimanche,
// 12 journées complètes (4 par semaine) et 3 pesées, la première pesée au plus tard au début de la
// fenêtre. On compte ce qui est déjà là, et ce qui reste faisable d'ici dimanche.
import { AUTO_REF, refLabel, type MealRef } from "@/lib/eaters/core";
import { addDays } from "@/lib/week/propose";
import { dailyWeights, DEFAULT_PROTEIN_G_PER_KG, MIN_COMPLETE_PER_WEEK, rateOf, trendSeries, weeklyRate, WINDOW_DAYS, type Confidence, type Goal, type IntakeDay, type Profile, type WeeklyReview, type WeighIn } from "./core";
import { PROTEIN_MAX, PROTEIN_MIN } from "./goals";

export const CONFIDENCE_WORD: Record<Confidence, string> = { adaptive: "mesurée", holding: "en attente", estimate: "estimation" };

/** Rythme réel face au visé : stable (maintien tenu), dans le rythme, plus lent, plus rapide, à l'inverse, ou un écart au maintien. */
export type Pace = "stable" | "rythme" | "lent" | "rapide" | "inverse" | "ecart";

export interface StatusInput {
  today: string;
  profile: Profile;
  targetWeightKg?: number | null;
  review: Pick<WeeklyReview, "tdee" | "confidence" | "targets"> | null;
  weighIns: WeighIn[];
  intake: IntakeDay[];
  /** Le repère d'un repas de la personne (src/lib/eaters/store.ts, eaterOf). */
  meal: { mode: "auto" | "fixe"; ref: MealRef | null; targetRef: MealRef | null; limited: boolean };
}

export interface Status {
  goal: Goal | null;
  targetWeightKg: number | null;
  trend: { kg: number; rateKg: number | null; ratePct: number | null; aimedKg: number; aimedPct: number; pace: Pace | null; text: string } | null;
  target: { kcal: number; proteinG: number; tdee: number; confidence: Confidence; word: string; text: string } | null;
  update: {
    /** Le prochain lundi : la cible s'y recalcule. */
    next: string;
    window: { start: string; end: string };
    complete: { have: number; need: number; daysLeft: number };
    weighIns: { have: number; need: number; thisWeek: number };
    /** La première pesée est assez ancienne pour mesurer la variation de la tendance sur la fenêtre. */
    firstWeighOk: boolean;
    /** Tout y est déjà : lundi, la dépense sera mesurée. */
    ready: boolean;
    /** D'où viendra la dépense lundi, si rien de plus n'est noté. */
    nextConfidence: Confidence;
    /** Le premier lundi où la dépense peut être mesurée si chaque journée est notée complète d'ici là. */
    measuredBy: string | null;
  };
  /** Ce qui manque pour que la cible s'ajuste, en phrases courtes. */
  todo: string[];
  /** La phrase de tête : où en est la cible et la première chose à faire. */
  headline: string;
  protein: { target: number | null; avg: number | null; days: number; fromComplete: boolean; mode: "g" | "gkg"; perKg: number | null; suggestPerKg: number | null };
  portions: { mode: "auto" | "fixe"; ref: MealRef | null; targetRef: MealRef | null; follows: boolean; limited: boolean; text: string; next: string | null };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const NB = " ";
const fr = (v: number, digits = 1) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number, digits = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fr(Math.abs(v), digits)}`;
const plural = (n: number, one: string, many = `${one}s`) => (n > 1 ? many : one);
export const frDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Le lundi de la semaine d'un jour (AAAA-MM-JJ). */
export const mondayOfDay = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

/** Ce qu'il faut sur la fenêtre de 21 jours : journées complètes et pesées (comme adaptiveTdee). */
export const NEED_COMPLETE = Math.ceil((MIN_COMPLETE_PER_WEEK * WINDOW_DAYS) / 7);
export const NEED_WEIGH = Math.ceil(WINDOW_DAYS / 7);

export function paceOf(rateKg: number, aimedKg: number): Pace {
  if (Math.abs(aimedKg) < 0.05) return Math.abs(rateKg) <= 0.1 ? "stable" : "ecart";
  const ratio = rateKg / aimedKg;
  if (ratio < 0) return Math.abs(rateKg) <= 0.05 ? "lent" : "inverse";
  if (ratio < 0.5) return "lent";
  if (ratio <= 1.5) return "rythme";
  return "rapide";
}

const PACE_TEXT: Record<Pace, string> = {
  stable: "stable, comme visé",
  rythme: "dans le rythme visé",
  lent: "plus lent que visé",
  rapide: "plus rapide que visé",
  inverse: "dans l’autre sens que visé",
  ecart: "le poids bouge alors que tu vises le maintien",
};

const CONFIDENCE_TEXT: Record<Confidence, string> = {
  adaptive: "Dépense mesurée sur trois semaines : la cible suit ce que disent la balance et ton journal.",
  holding: "En attente d’une nouvelle mesure : la cible garde la dernière dépense mesurée.",
  estimate: "Estimation par formule (taille, âge, activité) : la balance et le journal n’ont pas encore assez parlé.",
};

/** Le premier lundi où la fenêtre aurait ses journées complètes, si chaque jour à partir d'aujourd'hui l'est. */
function firstMeasurable(intake: IntakeDay[], today: string, next: string, firstWeigh: string | null): string | null {
  const done = new Set(intake.filter((d) => d.complete && d.date <= today).map((d) => d.date));
  const from = done.has(today) ? addDays(today, 1) : today;
  for (let m = next, k = 0; k < 6; m = addDays(m, 7), k++) {
    const start = addDays(m, -WINDOW_DAYS);
    const end = addDays(m, -1);
    let n = [...done].filter((d) => d >= start && d <= end).length;
    for (let d = from > start ? from : start; d <= end; d = addDays(d, 1)) n++;
    // La tendance doit exister au début de la fenêtre : une pesée avant, ou dès aujourd'hui.
    const first = firstWeigh ?? today;
    if (n >= NEED_COMPLETE && first <= start) return m;
  }
  return null;
}

export function whereIAm(x: StatusInput): Status {
  const { today, profile } = x;
  const daily = dailyWeights(x.weighIns.filter((w) => w.date <= today));
  const series = trendSeries(daily, today);
  const last = series.at(-1) ?? null;

  // ─── Tendance et rythme ───
  let trend: Status["trend"] = null;
  if (last) {
    const aimedPct = rateOf(profile);
    const aimedKg = (aimedPct / 100) * last.trend;
    const rateKg = weeklyRate(series);
    const pace = rateKg != null ? paceOf(rateKg, aimedKg) : null;
    const text =
      rateKg != null
        ? `${signed(rateKg)}${NB}kg par semaine (visé ${signed(aimedKg)}) : ${PACE_TEXT[pace!]}.`
        : `Visé ${signed(aimedKg)}${NB}kg par semaine ; le rythme réel se calcule sur deux semaines de pesées.`;
    trend = { kg: round1(last.trend), rateKg: rateKg != null ? Math.round(rateKg * 100) / 100 : null, ratePct: rateKg != null ? Math.round((rateKg / last.trend) * 10000) / 100 : null, aimedKg: Math.round(aimedKg * 100) / 100, aimedPct, pace, text };
  }

  // ─── Cible ───
  const target: Status["target"] = x.review
    ? { kcal: x.review.targets.kcal, proteinG: x.review.targets.proteinG, tdee: x.review.tdee, confidence: x.review.confidence, word: CONFIDENCE_WORD[x.review.confidence], text: CONFIDENCE_TEXT[x.review.confidence] }
    : null;

  // ─── Le prochain lundi ───
  const monday = mondayOfDay(today);
  const next = addDays(monday, 7);
  const window = { start: addDays(next, -WINDOW_DAYS), end: addDays(next, -1) };
  const inWin = (d: string) => d >= window.start && d <= today;
  const have = x.intake.filter((d) => d.complete && inWin(d.date)).length;
  const todayDone = x.intake.some((d) => d.date === today && d.complete);
  const daysLeft = dayDiff(today, window.end) + 1 - (todayDone ? 1 : 0);
  const weighDays = daily.map((d) => d.date);
  const haveW = weighDays.filter(inWin).length;
  const thisWeek = weighDays.filter((d) => d >= monday && d <= today).length;
  const weighedToday = weighDays.includes(today);
  const firstWeigh = weighDays[0] ?? null;
  const firstWeighOk = firstWeigh != null && firstWeigh <= window.start;
  const missC = Math.max(0, NEED_COMPLETE - have);
  const missW = Math.max(0, NEED_WEIGH - haveW);
  const ready = missC === 0 && missW === 0 && firstWeighOk;
  const nextConfidence: Confidence = ready ? "adaptive" : x.review && x.review.confidence !== "estimate" ? "holding" : "estimate";
  const measuredBy = ready ? next : firstMeasurable(x.intake, today, next, firstWeigh);

  const todo: string[] = [];
  if (!firstWeigh) todo.push("Pèse-toi : la tendance et la cible partent de la première pesée.");
  if (missC > 0) {
    if (missC <= daysLeft) todo.push(`${missC} ${plural(missC, "journée complète", "journées complètes")} de plus d’ici dimanche (${have} sur les ${NEED_COMPLETE} qu’il faut en trois semaines).`);
    else todo.push(`${have ? `${have} ${plural(have, "journée complète", "journées complètes")}` : "Aucune journée complète"} sur les ${NEED_COMPLETE} qu’il faut en trois semaines : même en notant chaque jour d’ici dimanche, ce ne sera pas assez lundi.`);
  }
  const weighLeft = dayDiff(today, window.end) + 1 - (weighedToday ? 1 : 0);
  if (firstWeigh && missW > 0) todo.push(`Pèse-toi ${missW === 1 ? "une fois" : `${missW}${NB}fois`} de plus d’ici dimanche${missW > weighLeft ? " (un jour sur deux au moins)" : ""} : ${haveW} ${plural(haveW, "pesée")} en trois semaines, il en faut ${NEED_WEIGH}.`);
  else if (firstWeigh && thisWeek === 0) todo.push("Pèse-toi au moins une fois cette semaine : une pesée par semaine garde la mesure juste.");
  if (firstWeigh && !firstWeighOk) todo.push(`La mesure demande trois semaines de pesées : la première date du ${frDay(firstWeigh)}.`);
  if (!ready && measuredBy && measuredBy !== next) todo.push(`En notant chaque journée complète, la dépense sera mesurée le ${frDay(measuredBy)}.`);

  // ─── Protéines ───
  const recent = x.intake.filter((d) => d.date >= addDays(today, -14) && d.date <= today && d.complete && d.proteinG != null);
  const logged = x.intake.filter((d) => d.date >= addDays(today, -7) && d.date < today && (d.proteinG ?? 0) > 0);
  const pool = recent.length ? recent : logged;
  const avg = pool.length ? Math.round(pool.reduce((s, d) => s + (d.proteinG ?? 0), 0) / pool.length) : null;
  const kg = last?.trend ?? null;
  const mode = profile.proteinG ? "g" : "gkg";
  const perKg = mode === "g" ? (kg ? round1(profile.proteinG! / kg) : null) : (profile.proteinGPerKg ?? DEFAULT_PROTEIN_G_PER_KG);
  // Recomposition : des grammes fixes ne suivent pas le poids ; on propose le même apport en g/kg.
  const suggestPerKg = mode === "g" && profile.goal === "recomp" && perKg != null ? Math.min(PROTEIN_MAX, Math.max(PROTEIN_MIN, perKg)) : null;
  const protein: Status["protein"] = { target: x.review?.targets.proteinG ?? null, avg, days: pool.length, fromComplete: recent.length > 0, mode, perKg, suggestPerKg };

  // ─── Portions ───
  const { ref, targetRef } = x.meal;
  let text: string;
  let nextText: string | null = null;
  if (x.meal.mode === "fixe" && ref) {
    text = `Repère fixe : ${refLabel(ref)} par repas. Il ne suit pas ta cible${targetRef ? ` ; avec elle, ce serait ${refLabel(targetRef)}` : ""}.`;
  } else if (ref) {
    text = `Tes parts visent ${refLabel(ref)} par repas : ta cible du jour moins le hors batch, en deux repas.`;
    if (x.meal.limited && targetRef) text += ` Le repère rejoint la cible d’au plus ${AUTO_REF.kcalStep}${NB}kcal par semaine (elle donnerait ${refLabel(targetRef)}).`;
    nextText = "Lundi, si la cible bouge, le repère suit : les parts de la réserve et de la Semaine aussi. Ce qui est déjà mangé ne change pas.";
  } else {
    text = "Pas encore de repère : la part de base, jusqu’à un profil complet et une première pesée.";
  }
  const portions: Status["portions"] = { mode: x.meal.mode, ref, targetRef, follows: x.meal.mode === "auto" && !!ref, limited: x.meal.limited, text, next: nextText };

  // La phrase de tête : la plus utile des choses à faire (le lundi possible plutôt qu'un « pas assez »).
  const headline = !target
    ? "La cible arrive avec un profil complet et une première pesée."
    : ready
      ? target.confidence === "adaptive"
        ? "La cible suit ta dépense mesurée ; lundi, elle se recalcule."
        : "Tout y est : lundi, ta dépense sera mesurée et la cible s’ajustera."
      : !firstWeigh
        ? todo[0]
        : missC > daysLeft && measuredBy
          ? `Note tes journées complètes (tout ce que tu manges) : ta dépense pourra être mesurée le ${frDay(measuredBy)}.`
          : todo[0];

  return {
    headline,
    goal: profile.goal,
    targetWeightKg: x.targetWeightKg ?? null,
    trend,
    target,
    update: { next, window, complete: { have, need: NEED_COMPLETE, daysLeft }, weighIns: { have: haveW, need: NEED_WEIGH, thisWeek }, firstWeighOk, ready, nextConfidence, measuredBy },
    todo,
    protein,
    portions,
  };
}
