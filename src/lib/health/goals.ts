// Objectifs d'une personne : poids visé, rythme, protéines, sport réaliste. Module pur, sans base.
//
// Le coach (IA) propose ; ce module vérifie et corrige avant qu'on applique (« l'IA propose, le code
// vérifie ») :
// - rythme borné : −1 % à +0,5 % du poids par semaine, signe cohérent avec l'objectif ;
// - protéines entre 1,2 et 2,4 g/kg de la tendance ;
// - poids visé dans un IMC de 18,5 à 30, échéance réaliste calculée du rythme ;
// - calories jamais sous le métabolisme de base ni sous 1 200 (femme) / 1 500 (homme) kcal :
//   sinon le rythme est réduit jusqu'à tenir ;
// - séances par semaine : 0 à 14, durée 10 à 180 min ; l'activité du profil suit le plan de sport.
import { addDays } from "@/lib/week/propose";
import { ACTIVITY_FACTOR, ageOn, DEFAULT_RATE, KCAL_PER_KG, mifflin, type Activity, type Goal, type Profile, type Sex } from "./core";

export const SPORTS = {
  kettlebell: "Kettlebell",
  natation: "Natation",
  pilates: "Pilates",
  course: "Course",
  velo: "Vélo",
  marche: "Marche",
  renfo: "Renforcement",
  yoga: "Yoga",
  autre: "Autre sport",
} as const;
export type Sport = keyof typeof SPORTS;
export const SPORT_KEYS = Object.keys(SPORTS) as Sport[];

export interface SportPlanItem {
  kind: Sport;
  perWeek: number;
  minutes: number;
}

export const RATE_MIN = -1;
export const RATE_MAX = 0.5;
export const PROTEIN_MIN = 1.2;
export const PROTEIN_MAX = 2.4;
export const BMI_MIN = 18.5;
export const BMI_MAX = 30;
export const KCAL_FLOOR: Record<Sex, number> = { f: 1200, m: 1500 };

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fr = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

/** Ce qu'une proposition peut changer. Tout est facultatif : null ou absent = inchangé. */
export interface GoalProposal {
  sex?: Sex | null;
  birthDate?: string | null;
  heightCm?: number | null;
  weightKg?: number | null; // pesée du jour, si la personne n'en a pas
  activity?: Activity | null;
  goal?: Goal | null;
  ratePct?: number | null;
  proteinGPerKg?: number | null;
  proteinG?: number | null;
  targetWeightKg?: number | null;
  targetDate?: string | null;
  sportPlan?: SportPlanItem[] | null;
  constraints?: string | null;
}

export interface GoalContext {
  profile: Profile & { targetWeightKg?: number | null };
  trendKg: number | null; // tendance du poids (ou dernière pesée)
  tdee: number | null; // dépense de la semaine (mesurée ou estimée)
  today: string;
}

/** Niveau d'activité du profil d'après le plan de sport (séances par semaine). */
export function activityFromPlan(plan: SportPlanItem[]): Activity {
  const n = plan.reduce((s, p) => s + p.perWeek, 0);
  return n === 0 ? "sedentary" : n <= 2 ? "light" : n <= 5 ? "moderate" : n <= 7 ? "active" : "very_active";
}

/** Poids aux bornes d'IMC pour une taille. */
export const weightForBmi = (bmi: number, cm: number) => round1(bmi * (cm / 100) ** 2);

/** Semaines et date pour aller de `from` à `to` kg au rythme `ratePct` (% du poids par semaine). */
export function projection(fromKg: number, toKg: number, ratePct: number, today: string): { weeks: number; date: string } | null {
  const diff = toKg - fromKg;
  if (Math.abs(diff) < 0.3) return { weeks: 0, date: today };
  const perWeek = (ratePct / 100) * fromKg;
  if (perWeek === 0 || Math.sign(perWeek) !== Math.sign(diff)) return null;
  const weeks = Math.ceil(diff / perWeek);
  return { weeks, date: addDays(today, weeks * 7) };
}

/** Plancher calorique : métabolisme de base, et jamais sous 1 200 / 1 500 kcal. */
export function kcalFloor(p: Profile, kg: number, today: string): number | null {
  if (!p.sex) return null;
  const bmr = p.birthDate && p.heightCm ? mifflin(p.sex, kg, p.heightCm, ageOn(p.birthDate, today)) : 0;
  return Math.round(Math.max(KCAL_FLOOR[p.sex], bmr));
}

export interface Checked {
  patch: GoalProposal; // ce qui sera appliqué, corrigé
  notes: string[]; // ce que la vérification a corrigé ou signale, en clair
  eta: { weeks: number; date: string } | null; // échéance réaliste vers le poids visé
}

/**
 * Vérifie une proposition (du coach ou du formulaire) et la corrige si besoin. Les valeurs non
 * proposées gardent celles du profil pour les contrôles croisés (objectif ↔ rythme, poids visé ↔ taille).
 */
export function checkProposal(prop: GoalProposal, ctx: GoalContext): Checked {
  const notes: string[] = [];
  const patch: GoalProposal = {};
  const p = ctx.profile;
  const sex = prop.sex ?? p.sex;
  const height = prop.heightCm ?? p.heightCm;
  const today = ctx.today;

  if (prop.sex) patch.sex = prop.sex;
  if (prop.birthDate) {
    const age = /^\d{4}-\d{2}-\d{2}$/.test(prop.birthDate) ? ageOn(prop.birthDate, today) : -1;
    if (age >= 14 && age <= 100) patch.birthDate = prop.birthDate;
    else notes.push("Date de naissance ignorée : elle n'est pas lisible.");
  }
  if (prop.heightCm != null) {
    if (prop.heightCm >= 120 && prop.heightCm <= 220) patch.heightCm = Math.round(prop.heightCm);
    else notes.push(`Taille ignorée : ${prop.heightCm} cm n'est pas plausible.`);
  }
  if (prop.weightKg != null) {
    if (prop.weightKg > 30 && prop.weightKg < 250) patch.weightKg = round1(prop.weightKg);
    else notes.push(`Poids ignoré : ${prop.weightKg} kg n'est pas plausible.`);
  }
  const kg = ctx.trendKg ?? patch.weightKg ?? null;

  // Sport : bornes, puis activité du profil d'après le plan.
  if (prop.sportPlan) {
    const plan = prop.sportPlan
      .filter((s) => SPORT_KEYS.includes(s.kind))
      .map((s) => ({ kind: s.kind, perWeek: clamp(Math.round(s.perWeek), 0, 14), minutes: clamp(Math.round(s.minutes / 5) * 5, 10, 180) }))
      .filter((s) => s.perWeek > 0);
    patch.sportPlan = plan;
    if (!prop.activity) patch.activity = activityFromPlan(plan);
  }
  if (prop.activity) patch.activity = prop.activity;
  if (prop.constraints != null) patch.constraints = prop.constraints.trim().slice(0, 600) || null;

  // Objectif et rythme, de signe cohérent.
  const goal = prop.goal ?? p.goal;
  if (prop.goal) patch.goal = prop.goal;
  let rate = prop.ratePct ?? (prop.goal ? DEFAULT_RATE[prop.goal] : null);
  if (rate != null) {
    if (goal === "maintain" && rate !== 0) {
      rate = 0;
      notes.push("Maintien : rythme ramené à 0.");
    }
    if ((goal === "lose" || goal === "recomp") && rate > 0) {
      rate = -Math.abs(rate);
      notes.push("Perte ou recomposition : le rythme doit être négatif, signe corrigé.");
    }
    if (goal === "gain" && rate < 0) {
      rate = Math.abs(rate);
      notes.push("Prise de muscle : le rythme doit être positif, signe corrigé.");
    }
    const bounded = clamp(rate, RATE_MIN, RATE_MAX);
    if (bounded !== rate) notes.push(`Rythme ramené de ${fr(rate, 2)} à ${fr(bounded, 2)} % par semaine (au-delà, on perd du muscle ou on prend surtout du gras).`);
    rate = bounded;
  }

  // Plancher calorique : on réduit le rythme si la cible passerait dessous.
  const profileAfter: Profile = { ...p, sex: sex ?? null, heightCm: height ?? null, birthDate: patch.birthDate ?? p.birthDate, activity: patch.activity ?? p.activity };
  if (rate != null && rate < 0 && kg && profileAfter.sex) {
    const floor = kcalFloor(profileAfter, kg, today);
    const tdee = ctx.tdee ?? (profileAfter.birthDate && profileAfter.heightCm && profileAfter.activity ? mifflin(profileAfter.sex, kg, profileAfter.heightCm, ageOn(profileAfter.birthDate, today)) * ACTIVITY_FACTOR[profileAfter.activity] : null);
    if (floor && tdee) {
      const kcal = tdee + ((rate / 100) * kg * KCAL_PER_KG) / 7;
      if (kcal < floor) {
        const safe = Math.min(0, Math.ceil((((floor - tdee) * 7) / (kg * KCAL_PER_KG)) * 100 * 20) / 20);
        notes.push(`À ${fr(rate, 2)} %/sem., la cible tomberait à ${Math.round(kcal)} kcal, sous le plancher de ${floor} kcal : rythme ramené à ${fr(safe, 2)} %.`);
        rate = safe;
      }
    }
  }
  if (rate != null) patch.ratePct = rate;

  // Protéines.
  if (prop.proteinG != null && kg) {
    const perKg = prop.proteinG / kg;
    const g = Math.round(clamp(perKg, PROTEIN_MIN, PROTEIN_MAX) * kg);
    if (g !== Math.round(prop.proteinG)) notes.push(`Protéines ramenées de ${Math.round(prop.proteinG)} à ${g} g (entre ${fr(PROTEIN_MIN)} et ${fr(PROTEIN_MAX)} g/kg).`);
    patch.proteinG = g;
    patch.proteinGPerKg = null;
  } else if (prop.proteinG != null) {
    // Sans pesée, on ne peut que borner grossièrement.
    const g = Math.round(clamp(prop.proteinG, 40, 300));
    if (g !== Math.round(prop.proteinG)) notes.push(`Protéines ramenées à ${g} g.`);
    patch.proteinG = g;
    patch.proteinGPerKg = null;
  } else if (prop.proteinGPerKg != null) {
    const v = round1(clamp(prop.proteinGPerKg, PROTEIN_MIN, PROTEIN_MAX));
    if (v !== round1(prop.proteinGPerKg)) notes.push(`Protéines ramenées à ${fr(v)} g/kg.`);
    patch.proteinGPerKg = v;
    patch.proteinG = null;
  }

  // Poids visé : IMC sain, puis échéance réaliste au rythme retenu.
  let eta: Checked["eta"] = null;
  if (prop.targetWeightKg != null) {
    let t = round1(prop.targetWeightKg);
    if (height) {
      const lo = weightForBmi(BMI_MIN, height);
      const hi = weightForBmi(BMI_MAX, height);
      if (t < lo) {
        notes.push(`Poids visé relevé à ${fr(lo)} kg : en dessous, l'IMC passe sous ${fr(BMI_MIN)}.`);
        t = lo;
      } else if (t > hi) {
        notes.push(`Poids visé ramené à ${fr(hi)} kg (IMC ${BMI_MAX}).`);
        t = hi;
      }
    }
    patch.targetWeightKg = t;
  }
  const target = patch.targetWeightKg ?? p.targetWeightKg ?? null;
  const finalRate = patch.ratePct ?? p.ratePct ?? (goal ? DEFAULT_RATE[goal] : null);
  if (target != null && kg && finalRate != null) {
    eta = projection(kg, target, finalRate, today);
    if (!eta && Math.abs(target - kg) >= 0.3) notes.push(`Le poids visé (${fr(target)} kg) va dans l'autre sens que l'objectif : à revoir.`);
  }
  if (prop.targetDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prop.targetDate) || prop.targetDate <= today) notes.push("Échéance ignorée : elle doit être dans le futur.");
    else {
      patch.targetDate = prop.targetDate;
      if (eta && eta.date > prop.targetDate) notes.push(`Au rythme retenu, ${fr(target!)} kg arrive plutôt vers le ${eta.date.split("-").reverse().join("/")}, après l'échéance souhaitée.`);
    }
  }
  return { patch, notes, eta };
}

// ─── Activité ───

export interface Session {
  date: string; // AAAA-MM-JJ
  kind: Sport;
  label: string;
  minutes: number | null;
  source: "carnet" | "apple";
}

/** Type d'une séance d'Apple Santé (libellé déjà traduit à l'import) → sport du plan. */
export function sportOf(label: string): Sport {
  const l = label.toLowerCase();
  if (/kettle/.test(l)) return "kettlebell";
  if (/nata|swim|piscine/.test(l)) return "natation";
  if (/pilates/.test(l)) return "pilates";
  if (/course|run/.test(l)) return "course";
  if (/v[ée]lo|cycl/.test(l)) return "velo";
  if (/marche|walk|rando/.test(l)) return "marche";
  if (/yoga/.test(l)) return "yoga";
  if (/renfo|strength|hiit|gainage|muscu|fonctionnel/.test(l)) return "renfo";
  return "autre";
}

/**
 * Séances du carnet (kettlebell guidé) et d'Apple Santé, sans doublon : une séance de renforcement
 * enregistrée par la montre le même jour qu'une séance du carnet est la même séance.
 */
export function mergeSessions(carnet: Session[], apple: Session[]): Session[] {
  const kbDays = new Set(carnet.filter((s) => s.kind === "kettlebell").map((s) => s.date));
  const keep = apple.filter((s) => !((s.kind === "renfo" || s.kind === "kettlebell" || s.kind === "autre") && kbDays.has(s.date)));
  return [...carnet, ...keep].sort((a, b) => b.date.localeCompare(a.date));
}

/** Séances par sport sur la semaine qui commence `weekStart` (lundi), face au plan. */
export function weekAgainstPlan(sessions: Session[], plan: SportPlanItem[], weekStart: string) {
  const end = addDays(weekStart, 6);
  const inWeek = sessions.filter((s) => s.date >= weekStart && s.date <= end);
  const kinds = new Set<Sport>([...plan.map((p) => p.kind), ...inWeek.map((s) => s.kind)]);
  return [...kinds].map((kind) => ({
    kind,
    done: inWeek.filter((s) => s.kind === kind).length,
    planned: plan.find((p) => p.kind === kind)?.perWeek ?? 0,
  }));
}

/** Nombre de séances par semaine sur les `weeks` dernières semaines (la plus ancienne d'abord). */
export function weeklyCounts(sessions: Session[], currentMonday: string, weeks = 12) {
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(currentMonday, -7 * (weeks - 1 - i));
    const end = addDays(start, 6);
    return { weekStart: start, count: sessions.filter((s) => s.date >= start && s.date <= end).length };
  });
}
