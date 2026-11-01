// Le foyer de la démo, en données pures datées par rapport à aujourd'hui : Alex et Sam, le foyer fictif
// des tests (tests/helpers.ts), avec des profils Santé complets, leurs goûts, leurs habitudes du matin,
// huit semaines de séances guidées, un an de pesées et d'Apple Santé, et les plats de trois semaines. ./seed.ts l'écrit en base
// avec les fonctions de l'appli.
import type { InferInsertModel } from "drizzle-orm";
import type { people, preferences } from "@/lib/db/schema";
import { habitMacros, type HabitItem } from "@/lib/eaters/habits";
import type { Program, WorkoutEntry } from "@/lib/training/program";
import { DEFAULT_KITCHEN, type KitchenConfig } from "@/lib/kitchen/presets";
import { addDays } from "@/lib/week/propose";
import { weekdayOf } from "@/lib/week/period";
import { buildPlan, type DoneRun, type PlanSettings } from "@/lib/running/plan";
import type { Alert, RunSession } from "@/lib/running/workout";
import { zonesOf } from "@/lib/running/zones";

// ─── Le calendrier : tout est daté par rapport à aujourd'hui ───

export interface DemoCalendar {
  today: string;
  /** Semaine précédente : cuisinée, mangée, deux boîtes de marge parties au congélo. */
  previous: { start: string; cookedOn: string; listOn: string };
  /** Semaine en cours : la session de dimanche dernier, des boîtes au frigo et au congélo. */
  current: { start: string; cookedOn: string; listOn: string };
  /** Semaine suivante : les plats choisis, la liste de courses à faire. */
  next: { start: string };
  /** Premier jour avec Mijote (mise en route, carnet de séances) ; Apple Santé remonte un an plus tôt (HEALTH_DAYS). */
  historyFrom: string;
}

export const HISTORY_DAYS = 56;

/** La semaine en cours commence le lundi de cette semaine ; la session a eu lieu le dimanche d'avant. */
export function demoCalendar(today: string): DemoCalendar {
  const start = addDays(today, -weekdayOf(today));
  const prev = addDays(start, -7);
  return {
    today,
    previous: { start: prev, cookedOn: addDays(prev, -1), listOn: addDays(prev, -2) },
    current: { start, cookedOn: addDays(start, -1), listOn: addDays(start, -2) },
    next: { start: addDays(start, 7) },
    historyFrom: addDays(today, -HISTORY_DAYS),
  };
}

/** Bruit pseudo-aléatoire stable (même graine, même suite) : la démo est la même chaque jour. */
export function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10_000) / 10_000 - 0.5;
  };
}

/** Pesées du matin sur la période : une tendance linéaire, un peu de bruit, quelques jours sans pesée. */
export function weightSeries(from: string, today: string, startKg: number, endKg: number, seed: number): { date: string; kg: number }[] {
  const rnd = noise(seed);
  const out: { date: string; kg: number }[] = [];
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  for (let i = 0; i <= days; i++) {
    const skip = rnd();
    if (i > 0 && i < days && skip > 0.3) continue; // à peu près deux matins sur dix sans balance
    const kg = startKg + ((endKg - startKg) * i) / Math.max(1, days) + rnd() * 0.8;
    out.push({ date: addDays(from, i), kg: Math.round(kg * 10) / 10 });
  }
  return out;
}

/** Jours de séance : deux par semaine (`weekdays`, 0 = lundi), sur la période, aujourd'hui exclu. */
export function sessionDays(from: string, today: string, weekdays: number[]): string[] {
  const out: string[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d))) out.push(d);
  return out;
}

export interface DemoHabit {
  id: string;
  personId: string;
  label: string;
  meal: "breakfast" | "snack";
  items: HabitItem[];
  weekdays: number[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface DemoWorkout {
  id: string;
  personId: string;
  date: string;
  ts: number;
  type: string;
  minutes: number;
  entries: WorkoutEntry[];
}

export interface DemoHousehold {
  calendar: DemoCalendar;
  homeName: string;
  storeLabel: string;
  kitchen: KitchenConfig;
  people: (InferInsertModel<typeof people> & { id: string })[];
  preferences: InferInsertModel<typeof preferences>[];
  habits: DemoHabit[];
  weighIns: { personId: string; date: string; kg: number }[];
  waist: { personId: string; date: string; cm: number }[];
  /** Le programme suivi par chacun (modèle de l'appli) et ses jours de séance (0 = lundi). */
  programs: { personId: string; template: "kb" | "renfo"; id: string; weekdays: number[] }[];
  /** Les plats de chaque semaine (fiches de src/seed/recipes que personne n'a en horreur). */
  weeks: { previous: string[]; current: string[]; next: string[] };
}

/** Goûts : les mêmes que le foyer des tests. */
const PREFERENCES: InferInsertModel<typeof preferences>[] = [
  { id: "pref-demo-1", personId: "alex", kind: "dislike", text: "Câpres", tags: ["ingredient"] },
  { id: "pref-demo-2", personId: "alex", kind: "dislike", text: "Cornichons", tags: ["ingredient"] },
  { id: "pref-demo-3", personId: "alex", kind: "like", text: "Les plats mijotés", tags: ["plat"] },
  { id: "pref-demo-4", personId: "sam", kind: "dislike", text: "Brocoli", tags: ["ingredient"] },
  { id: "pref-demo-5", personId: "sam", kind: "dislike", text: "Concombre", tags: ["ingredient"] },
  { id: "pref-demo-6", personId: "sam", kind: "like", text: "Le gingembre et les épices douces", tags: ["gout"] },
];

const habit = (h: Omit<DemoHabit, "kcal" | "proteinG" | "carbsG" | "fatG">): DemoHabit => ({ ...h, ...habitMacros(h.items) });

export function demoHousehold(today: string): DemoHousehold {
  const calendar = demoCalendar(today);
  const from = calendar.historyFrom;
  return {
    calendar,
    homeName: "Chez Alex et Sam",
    storeLabel: "le supermarché du quartier",
    kitchen: {
      ...DEFAULT_KITCHEN,
      pans: [
        { material: "inox", cm: 28 },
        { material: "antiadhesive", cm: 24 },
      ],
      mixers: { plongeant: true, blender: false, hachoir: false },
    },
    people: [
      {
        id: "alex",
        name: "Alex",
        rank: 0,
        portionUnits: 5,
        sex: "m",
        birthDate: "1990-06-13",
        heightCm: 180,
        activity: "moderate",
        goal: "recomp",
        ratePct: -0.4,
        proteinG: 160,
        targetWeightKg: 79,
        targetDate: addDays(today, 120),
        sportPlan: [
          { kind: "kettlebell", perWeek: 2, minutes: 35 },
          { kind: "course", perWeek: 1, minutes: 30 },
        ],
        constraints: "Un kettlebell de 16 kg, 35 minutes en semaine, un genou qui n'aime pas sauter.",
        setupDoneAt: `${from}T19:00:00.000Z`,
      },
      {
        id: "sam",
        name: "Sam",
        rank: 1,
        portionUnits: 4,
        sex: "f",
        birthDate: "1992-03-08",
        heightCm: 167,
        activity: "light",
        goal: "maintain",
        ratePct: 0,
        proteinGPerKg: 1.6,
        sportPlan: [
          { kind: "renfo", perWeek: 2, minutes: 30 },
          { kind: "yoga", perWeek: 1, minutes: 45 },
        ],
        constraints: "Une mini-bande et un tapis, plutôt le soir.",
        setupDoneAt: `${from}T19:10:00.000Z`,
      },
    ],
    preferences: PREFERENCES,
    habits: [
      habit({
        id: "habit-demo-shaker",
        personId: "alex",
        label: "Shaker du matin",
        meal: "breakfast",
        items: [
          { food: "skyr", grams: 150 },
          { food: "lait_demi", grams: 200 },
          { food: "whey", grams: 25 },
          { food: "banane", grams: 100 },
        ],
        weekdays: [0, 1, 2, 3, 4],
      }),
      habit({
        id: "habit-demo-petitdej",
        personId: "sam",
        label: "Tartines et yaourt",
        meal: "breakfast",
        items: [
          { food: "pain", grams: 80 },
          { food: "beurre", grams: 10 },
          { food: "confiture", grams: 20 },
          { food: "yaourt", grams: 125 },
        ],
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      }),
    ],
    // Un an de pesées (balance connectée) : Alex perd doucement, plus vite depuis Mijote ; Sam reste stable.
    weighIns: [
      ...weightYear(today, [[365, 86.8], [250, 85.2], [180, 84.9], [100, 85.3], [HISTORY_DAYS, 83.4], [0, 81.2]], 11).map((w) => ({ personId: "alex", ...w })),
      ...weightYear(today, [[365, 63.4], [200, 62.6], [90, 63.1], [HISTORY_DAYS, 62.8], [0, 62.5]], 23).map((w) => ({ personId: "sam", ...w })),
    ],
    waist: Array.from({ length: 8 }, (_, i) => ({ personId: "alex", date: addDays(from, 7 * i + 1), cm: Math.round((92.5 - i * 0.4) * 10) / 10 })),
    programs: [
      { personId: "alex", template: "kb", id: "demo-kb-alex", weekdays: [0, 3] },
      { personId: "sam", template: "renfo", id: "demo-renfo-sam", weekdays: [1, 5] },
    ],
    weeks: {
      previous: ["poulet-basquaise", "porc-caramel-oeufs", "dahl-pois-casses-poulet"],
      current: ["butter-chicken-express", "chasseur-porc", "one-pot-orzo-poulet-champignons-citron"],
      next: ["colombo-porc", "couscous-poulet-merguez", "pasta-al-forno-saucisse-ricotta"],
    },
  };
}

/**
 * Le carnet d'entraînement d'une personne : ses jours de séance depuis le début de l'historique, séances
 * A et B en alternance, répétitions qui montent doucement dans la fourchette de chaque exercice.
 */
export function demoWorkouts(program: Program, personId: string, from: string, today: string, weekdays: number[], seed: number): DemoWorkout[] {
  const types = Object.keys(program.sessions);
  const days = sessionDays(from, today, weekdays);
  const rnd = noise(seed);
  return days.map((date, n) => {
    const type = types[n % types.length];
    const progress = days.length > 1 ? n / (days.length - 1) : 1;
    const entries: WorkoutEntry[] = [];
    for (const b of program.sessions[type].blocks) {
      for (const ex of b.items) {
        const e = program.exercises[ex];
        if (!e) continue;
        if (b.emom) {
          entries.push({ ex, sets: [b.emom.rounds * b.emom.reps], level: 0 });
          continue;
        }
        const [lo, hi] = e.reps;
        const reps = Math.round(lo + (hi - lo) * progress);
        // La dernière série coûte parfois une répétition.
        const sets = Array.from({ length: b.sets ?? 1 }, (_, k) => Math.max(lo, reps - (k === (b.sets ?? 1) - 1 && rnd() > 0.2 ? 1 : 0)));
        entries.push({ ex, sets, level: progress > 0.6 && e.ladder.length > 1 ? 1 : 0 });
      }
    }
    const minutes = 30 + Math.round((rnd() + 0.5) * 10);
    return { id: `demo-${personId}-${date}`, personId, date, ts: Date.parse(`${date}T18:30:00Z`) + minutes * 60_000, type, minutes, entries };
  });
}

// ─── Un an d'Apple Santé : ce que l'app iPhone aurait envoyé (format v2, docs/sante.md) ───

/** Jours d'historique envoyés par « l'iPhone » de la démo (pas, énergie, cœur, séances, pesées). */
export const HEALTH_DAYS = 365;
/** Nuits envoyées (le sommeil pèse le plus en lignes : quatre mois suffisent aux graphiques). */
export const SLEEP_NIGHTS = 120;

/** Le paquet v2 d'une personne, tel que l'app l'enverrait, prêt pour `parseV2` puis `ingestV2`. */
export interface DemoHealthPayload {
  version: 2;
  samples: { uuid: string; type: string; start: string; end: string; value: number; unit: string }[];
  daily: { type: string; date: string; value: number; unit: string }[];
  workouts: { uuid: string; activity: string; start: string; end: string; durationMin: number; kcal: number; distanceM?: number; hrAvg?: number }[];
  sleep: { uuid: string; stage: "core" | "deep" | "rem" | "awake"; start: string; end: string }[];
}

/** Une courbe par étapes (jours avant aujourd'hui → valeur), interpolée, pour des saisons crédibles. */
function along(steps: [number, number][], daysAgo: number) {
  const s = [...steps].sort((a, b) => b[0] - a[0]);
  if (daysAgo >= s[0][0]) return s[0][1];
  for (let k = 1; k < s.length; k++) {
    const [a, va] = s[k - 1];
    const [b, vb] = s[k];
    if (daysAgo >= b) return va + ((vb - va) * (a - daysAgo)) / (a - b);
  }
  return s[s.length - 1][1];
}

/** Pesées sur un an : la courbe passe par les étapes, un peu de bruit, des matins sans balance. */
export function weightYear(today: string, steps: [number, number][], seed: number): { date: string; kg: number }[] {
  const rnd = noise(seed);
  const out: { date: string; kg: number }[] = [];
  for (let ago = HEALTH_DAYS; ago >= 0; ago--) {
    const skip = rnd();
    if (ago > 0 && ago < HEALTH_DAYS && skip > (ago > HISTORY_DAYS ? 0.1 : 0.3)) continue; // plus régulier depuis Mijote
    out.push({ date: addDays(today, -ago), kg: Math.round((along(steps, ago) + rnd() * 0.8) * 10) / 10 });
  }
  return out;
}

interface Habit {
  /** Pas par jour en semaine et le week-end, au fil de l'année (jours avant aujourd'hui → pas). */
  steps: [number, number][];
  weekendSteps: number;
  restingHr: number;
  hrv: number;
  vo2max: [number, number][];
  /** Heure du coucher (UTC, en heures) et durée de la nuit (minutes). */
  bed: number;
  sleepMin: number;
  /** Séances enregistrées par la montre : jour de la semaine (0 = lundi), activité, minutes, km (0 sans distance). */
  workouts: { weekday: number; activity: string; minutes: number; km: number; every?: number; until?: number }[];
  bodyFat?: [number, number][];
  /** Une semaine de vacances (marche, montagne) et une semaine malade : jours avant aujourd'hui. */
  holiday: number;
  sick: number;
}

const HABITS: Record<"alex" | "sam", Habit> = {
  alex: {
    steps: [[365, 6400], [240, 7200], [120, 8800], [60, 8200], [0, 9100]],
    weekendSteps: 1.25,
    restingHr: 61,
    hrv: 44,
    vo2max: [[365, 39.5], [120, 41.8], [0, 43.4]],
    bed: 21.75,
    sleepMin: 432,
    workouts: [
      { weekday: 5, activity: "running", minutes: 38, km: 6.4 },
      { weekday: 2, activity: "traditional_strength_training", minutes: 35, km: 0, until: HISTORY_DAYS },
      { weekday: 6, activity: "cycling", minutes: 75, km: 24, every: 2 },
    ],
    bodyFat: [[365, 23.5], [0, 20.8]],
    holiday: 92,
    sick: 255,
  },
  sam: {
    steps: [[365, 8800], [200, 9600], [100, 10400], [0, 9800]],
    weekendSteps: 0.85,
    restingHr: 56,
    hrv: 58,
    vo2max: [[365, 38.2], [0, 39.6]],
    bed: 21.25,
    sleepMin: 455,
    workouts: [
      { weekday: 2, activity: "yoga", minutes: 45, km: 0 },
      { weekday: 6, activity: "swimming", minutes: 40, km: 1.5, every: 2 },
      { weekday: 3, activity: "walking", minutes: 50, km: 4.2 },
      { weekday: 1, activity: "functional_strength_training", minutes: 30, km: 0, until: HISTORY_DAYS },
    ],
    holiday: 85,
    sick: 150,
  },
};

const iso = (date: string, hours: number) => new Date(Date.parse(`${date}T00:00:00Z`) + hours * 3_600_000).toISOString();

/**
 * L'année d'Apple Santé d'une personne de la démo : pas, énergie active et minutes d'exercice chaque jour,
 * FC au repos et variabilité chaque matin, VO2max tous les quinze jours, masse grasse chaque semaine (Alex,
 * balance connectée), les nuits des quatre derniers mois par phase, et les séances de la montre. Une
 * semaine de vacances (beaucoup de marche) et une semaine malade (cœur plus haut, peu de pas) donnent du
 * relief. Pur : même graine, mêmes données ; aujourd'hui n'est pas fini (pas du matin seulement).
 */
export function demoHealth(personId: "alex" | "sam", today: string, seed: number): DemoHealthPayload {
  const h = HABITS[personId];
  const rnd = noise(seed);
  const out: DemoHealthPayload = { version: 2, samples: [], daily: [], workouts: [], sleep: [] };
  const id = (kind: string, date: string, k = 0) => `demo-${personId}-${kind}-${date}-${k}`;
  for (let ago = HEALTH_DAYS; ago >= 0; ago--) {
    const date = addDays(today, -ago);
    const wd = weekdayOf(date);
    const holiday = ago <= h.holiday && ago > h.holiday - 7;
    const sick = ago <= h.sick && ago > h.sick - 6;
    const base = along(h.steps, ago) * (wd >= 5 ? h.weekendSteps : 1) * (holiday ? 1.7 : sick ? 0.35 : 1);
    const steps = Math.max(800, Math.round(base * (1 + rnd() * 0.45)));
    const part = ago === 0 ? 0.32 : 1; // aujourd'hui : la matinée seulement
    out.daily.push({ type: "steps", date, value: Math.round(steps * part), unit: "count" });

    // Séances de la montre ce jour-là.
    let workoutMin = 0;
    for (const [k, w] of h.workouts.entries()) {
      if (wd !== w.weekday || ago === 0 || sick || (w.until != null && ago < w.until)) continue;
      if (w.every && Math.floor(ago / 7) % w.every) continue;
      if (rnd() > -0.32) {
        const minutes = Math.round(w.minutes * (1 + rnd() * 0.3));
        const start = iso(date, wd >= 5 ? 8.5 : 17.5);
        const km = w.km ? Math.round(w.km * (minutes / w.minutes) * 100) / 100 : 0;
        out.workouts.push({ uuid: id("w", date, k), activity: w.activity, start, end: iso(date, (wd >= 5 ? 8.5 : 17.5) + minutes / 60), durationMin: minutes, kcal: Math.round(minutes * (w.km ? 9 : 6) * (1 + rnd() * 0.2)), ...(km ? { distanceM: Math.round(km * 1000) } : {}), hrAvg: Math.round(118 + rnd() * 30) });
        workoutMin += minutes;
      }
    }
    out.daily.push({ type: "active_energy", date, value: Math.round((steps * 0.034 + workoutMin * 6.5 + 60) * part), unit: "kcal" });
    out.daily.push({ type: "exercise_min", date, value: Math.round((Math.max(0, steps - 4000) / 260 + workoutMin) * part), unit: "min" });

    // Le cœur, mesuré chaque matin : plus haut et moins variable quand on est malade.
    const fit = (HEALTH_DAYS - ago) / HEALTH_DAYS; // un peu meilleur au fil de l'année
    out.samples.push({ uuid: id("rhr", date), type: "resting_hr", start: iso(date, 5), end: iso(date, 5), value: Math.round(h.restingHr - fit * 2 + (sick ? 7 : 0) + rnd() * 3), unit: "bpm" });
    out.samples.push({ uuid: id("hrv", date), type: "hrv_sdnn", start: iso(date, 5.5), end: iso(date, 5.5), value: Math.round(h.hrv + fit * 5 - (sick ? 14 : 0) + rnd() * 16), unit: "ms" });
    if (ago % 14 === 3) out.samples.push({ uuid: id("vo2", date), type: "vo2max", start: iso(date, 9), end: iso(date, 9), value: Math.round((along(h.vo2max, ago) + rnd() * 0.6) * 10) / 10, unit: "mL/kg/min" });
    if (h.bodyFat && wd === 0) out.samples.push({ uuid: id("fat", date), type: "body_fat", start: iso(date, 5.2), end: iso(date, 5.2), value: Math.round((along(h.bodyFat, ago) + rnd() * 0.6) * 10) / 10, unit: "%" });

    // La nuit qui finit ce matin : léger, profond, léger, paradoxal, un réveil bref.
    if (ago < SLEEP_NIGHTS) {
      const total = h.sleepMin * (sick ? 1.08 : 1) * (wd >= 5 ? 1.06 : 1) + rnd() * 70;
      const bed = h.bed + (wd >= 5 ? 0.6 : 0) + rnd() * 0.8 - 24; // la veille au soir
      const parts: [DemoHealthPayload["sleep"][number]["stage"], number][] = [
        ["core", total * 0.12],
        ["deep", total * (0.16 + rnd() * 0.06)],
        ["core", total * 0.3],
        ["rem", total * (0.2 + rnd() * 0.05)],
        ["awake", 6 + rnd() * 6],
      ];
      parts.push(["core", total - parts.reduce((s, [st, m]) => s + (st === "awake" ? 0 : m), 0)]);
      let t = bed;
      for (const [k, [stage, min]] of parts.entries()) {
        if (min <= 0) continue;
        out.sleep.push({ uuid: id("sleep", date, k), stage, start: iso(date, t), end: iso(date, t + min / 60) });
        t += min / 60;
      }
    }
  }
  return out;
}

// ─── La course d'Alex : six semaines de plan, avec le détail que la montre envoie (contrat v2.1) ───

/** Alex a activé le module Course il y a six semaines, un lundi ; avant, une sortie le samedi (Apple Santé ci-dessus). */
export const runStart = (today: string) => addDays(today, -weekdayOf(today) - 42);
/** Ses réglages : mardi, jeudi et dimanche (sortie longue), trois sorties, « courir plus longtemps ». */
export const DEMO_RUN_SETTINGS = {
  enabled: true,
  days: [
    { weekday: 1, time: "18:30" },
    { weekday: 3, time: "18:30" },
    { weekday: 6, time: "09:30" },
  ],
  perWeek: 3,
  goal: "plus_longtemps" as const,
  goalNote: "Tenir une heure sans m'arrêter, et un 10 km au printemps.",
  longRunDay: 6,
  time: "18:30",
};

export interface DemoRun {
  uuid: string;
  activity: "running";
  start: string;
  end: string;
  durationMin: number;
  kcal: number;
  distanceM: number;
  hrAvg: number;
  hrMax: number;
  sourceName: string;
  details: {
    hr: [number, number][];
    splits: { km: number; sec: number; hrAvg: number; elevGainM: number; elevLossM: number }[];
    cadenceAvg: number;
    strideM: number;
    elevGainM: number;
    elevLossM: number;
    indoor: false;
    pausesSec: number;
    source: { name: string; model: string };
    effort: number;
    weather: { tempC: number; humidityPct: number };
  };
}

/** Allure et FC d'un morceau de séance, d'après son libellé et son alerte. */
function effortOf(label: string, purpose: string, alert: Alert): "walk" | "trot" | "easy" | "stride" | "steady" {
  if (/marche/i.test(label) && !/trot/i.test(label)) return "walk";
  if (/ligne droite|montée/i.test(label)) return "stride";
  if (alert && "hr" in alert && purpose === "work" && /soutenu|tempo/i.test(label)) return "steady";
  if (/trot|lent/i.test(label)) return "trot";
  return "easy";
}

/** Une séance faite comme prévue : FC seconde par seconde (avec retard et dérive), temps au kilomètre. */
function recordRun(date: string, s: RunSession, week: number, long: boolean, rnd: () => number, effort: number): DemoRun {
  const parts: { sec: number; kind: ReturnType<typeof effortOf> }[] = [];
  const edge = (st: RunSession["warmup"], first: boolean) => {
    const sec = typeof st.goal === "object" && "time" in st.goal ? st.goal.time : 0;
    if (/puis trot/i.test(st.label)) parts.push({ sec: sec / 2, kind: "walk" }, { sec: sec / 2, kind: "trot" });
    else parts.push({ sec, kind: first ? "walk" : effortOf(st.label, "edge", null) });
  };
  edge(s.warmup, true);
  for (const b of s.blocks) for (let i = 0; i < b.iterations; i++) for (const st of b.steps) parts.push({ sec: typeof st.goal === "object" && "time" in st.goal ? st.goal.time : 0, kind: effortOf(st.label, st.purpose, st.alert) });
  edge(s.cooldown, false);

  const easyPace = (long ? 392 : 380) - week * 2.2 + rnd() * 8; // s/km, un peu plus vite au fil des semaines
  const speed = { walk: 1.55, trot: 1000 / (easyPace + 45), easy: 1000 / easyPace, stride: 4.2, steady: 1000 / (easyPace - 55) };
  const target = { walk: 104, trot: 124, easy: (long ? 137 : 135) - week * 0.4, stride: 150, steady: 158 };
  const total = Math.round(parts.reduce((t, x) => t + x.sec, 0));
  const hr: [number, number][] = [];
  const perSec: { v: number; bpm: number }[] = [];
  let bpm = 92;
  let t = 0;
  for (const part of parts)
    for (let k = 0; k < part.sec; k++, t++) {
      const drift = part.kind === "easy" ? ((long ? 6 : 3.5) * t) / total : 0;
      bpm += (target[part.kind] + drift - bpm) / 30; // la FC suit l'effort avec ~30 s de retard
      perSec.push({ v: speed[part.kind] * (1 + rnd() * 0.06), bpm });
      if (t % 5 === 0) hr.push([t, Math.round(bpm + rnd() * 3)]);
    }
  const splits: DemoRun["details"]["splits"] = [];
  let dist = 0;
  let from = 0;
  let gain = 0;
  let loss = 0;
  const cut = (end: number, km: number) => {
    const xs = perSec.slice(from, end);
    const g = Math.max(0, Math.round((6 + rnd() * 9) * (km - (splits.at(-1)?.km ?? 0))));
    const l = Math.max(0, Math.round((6 + rnd() * 9) * (km - (splits.at(-1)?.km ?? 0))));
    gain += g;
    loss += l;
    splits.push({ km: Math.round(km * 100) / 100, sec: end - from, hrAvg: Math.round(xs.reduce((a, x) => a + x.bpm, 0) / Math.max(1, xs.length)), elevGainM: g, elevLossM: l });
    from = end;
  };
  for (let i = 0; i < perSec.length; i++) {
    dist += perSec[i].v;
    if (dist >= (splits.length + 1) * 1000) cut(i + 1, splits.length + 1);
  }
  if (perSec.length - from >= 30) cut(perSec.length, dist / 1000);
  const start = iso(date, long ? 8.5 : 17.5);
  const bpms = hr.map(([, v]) => v);
  return {
    uuid: `demo-alex-run-${date}`,
    activity: "running",
    start,
    end: iso(date, (long ? 8.5 : 17.5) + total / 3600),
    durationMin: Math.round((total / 60) * 10) / 10,
    kcal: Math.round((dist / 1000) * 74),
    distanceM: Math.round(dist),
    hrAvg: Math.round(bpms.reduce((a, v) => a + v, 0) / bpms.length),
    hrMax: Math.max(...bpms),
    sourceName: "Apple Watch",
    details: {
      hr,
      splits,
      cadenceAvg: Math.round(163 + rnd() * 4),
      strideM: Math.round((1000 / easyPace / (164 / 60)) * 100) / 100,
      elevGainM: gain,
      elevLossM: loss,
      indoor: false,
      pausesSec: 0,
      source: { name: "Apple Watch", model: "Watch7,1" },
      effort,
      weather: { tempC: Math.round((12 - week * 0.7 + rnd() * 4) * 10) / 10, humidityPct: Math.round(80 + rnd() * 14) },
    },
  };
}

/**
 * Les courses d'Alex depuis la mise en route : chaque jour, le plan (src/lib/running/plan.ts, pur) donne la
 * séance, et Alex la fait comme prévue, à peu de chose près ; un footing sauté la 5e semaine. `before` : ses
 * sorties d'avant (celles d'Apple Santé), pour le point de départ du plan. Pur : même graine, mêmes courses.
 */
export function demoRuns(today: string, seed: number, before: { date: string; minutes: number; km: number | null }[]): { runs: DemoRun[]; efforts: { date: string; effort: number }[] } {
  const rnd = noise(seed);
  const from = runStart(today);
  const zones = zonesOf({ max: 183, maxSource: "age", rest: 59, restSource: "mesuree", threshold: 159, thresholdSource: "estimee" });
  const settings: PlanSettings = { ...DEMO_RUN_SETTINGS, fixed: [{ weekday: 0, kind: "kettlebell" }, { weekday: 3, kind: "kettlebell" }] };
  const done: DoneRun[] = before.map((b) => ({ date: b.date, minutes: b.minutes, km: b.km, continuousMin: b.minutes, effort: null, pain: null, completed: null, hrHighShare: 0.05, decoupling: null, heat: false }));
  const runs: DemoRun[] = [];
  const efforts: { date: string; effort: number }[] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const plan = buildPlan({ today: d, startedOn: from, settings, zones, runs: done, feedback: [], pauses: [], overrides: [], morning: null, intensityOk: null });
    const s = plan.sessions.find((x) => x.date === d && !x.cancelled);
    if (!s) continue;
    const week = Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (7 * 86_400_000));
    if (week === 4 && weekdayOf(d) === 3) continue; // un jeudi de pluie : footing sauté
    const long = s.kind === "sortie_longue";
    const effort = long ? 4 : s.kind === "footing_lignes" ? 4 : 3;
    const r = recordRun(d, s.session, week, long, rnd, effort);
    runs.push(r);
    efforts.push({ date: d, effort });
    done.push({ date: d, minutes: r.durationMin, km: r.distanceM / 1000, continuousMin: s.minutes - 10, effort, pain: 0, completed: true, hrHighShare: 0.05, decoupling: 3, heat: false, planned: { kind: s.kind, minutes: s.minutes, level: s.session.level ?? null } });
  }
  return { runs, efforts };
}
