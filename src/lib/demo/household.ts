// Le foyer de la démo, en données pures datées par rapport à aujourd'hui : Alex et Sam, le foyer fictif
// des tests (tests/helpers.ts), avec des profils Santé complets, leurs goûts, leurs habitudes du matin,
// huit semaines de pesées et de séances, et les plats de trois semaines. ./seed.ts l'écrit en base
// avec les fonctions de l'appli.
import type { InferInsertModel } from "drizzle-orm";
import type { people, preferences } from "@/lib/db/schema";
import { habitMacros, type HabitItem } from "@/lib/eaters/habits";
import type { Program, WorkoutEntry } from "@/lib/training/program";
import { DEFAULT_KITCHEN, type KitchenConfig } from "@/lib/kitchen/presets";
import { addDays } from "@/lib/week/propose";
import { weekdayOf } from "@/lib/week/period";

// ─── Le calendrier : tout est daté par rapport à aujourd'hui ───

export interface DemoCalendar {
  today: string;
  /** Semaine précédente : cuisinée, mangée, deux boîtes de marge parties au congélo. */
  previous: { start: string; cookedOn: string; listOn: string };
  /** Semaine en cours : la session de dimanche dernier, des boîtes au frigo et au congélo. */
  current: { start: string; cookedOn: string; listOn: string };
  /** Semaine suivante : les plats choisis, la liste de courses à faire. */
  next: { start: string };
  /** Premier jour de l'historique Santé (pesées, séances). */
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
    weighIns: [
      ...weightSeries(from, today, 83.4, 81.2, 11).map((w) => ({ personId: "alex", ...w })),
      ...weightSeries(from, today, 62.8, 62.5, 23).map((w) => ({ personId: "sam", ...w })),
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
