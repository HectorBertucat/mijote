// Import Apple Santé, format v1 : ce qu'envoyait le Raccourci iOS (gardé pour les Raccourcis déjà
// installés), et l'historique lu dans l'export de Santé (le navigateur lit le fichier et envoie par
// paquets). L'app Mijote Santé envoie le format v2 : ./ingest-v2.ts.
// Tout est dédoublonné (même pesée envoyée deux fois = une ligne) : renvoyer ne coûte rien.
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { healthSamples, weighIns } from "@/lib/db/schema";
import { todayParis } from "./store";

// Les Raccourcis envoient parfois les nombres en texte, avec une virgule (« 73,8 »).
const num = z.union([z.number(), z.string().transform((s) => Number(s.replace(",", ".").replace(/[^\d.-]/g, "")))]).pipe(z.number().finite());
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : v), num.optional());
const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "date illisible (ISO 8601 attendu)");

export const ImportPayload = z.object({
  person: z.string().min(1),
  weights: z.array(z.object({ kg: num, at: when, unit: z.string().optional() })).default([]),
  steps: z.array(z.object({ date: when, count: num })).default([]),
  activeKcal: z.array(z.object({ date: when, kcal: num })).default([]),
  workouts: z
    .array(
      z.object({
        type: z.string().default(""),
        name: z.string().optional(), // la séance telle que le Raccourci l'écrit en texte, si le type est vague
        start: when,
        end: z.preprocess((v) => (v === "" ? undefined : v), when.optional()),
        kcal: optNum,
        distanceM: optNum,
        durationMin: optNum,
      })
    )
    .default([]),
  source: z.enum(["shortcut", "export"]).default("shortcut"),
  window: optNum, // jours relus par le Raccourci (GET /api/sante/import)
});
export type ImportPayload = z.infer<typeof ImportPayload>;

export interface ImportResult {
  weights: number;
  steps: number;
  activeKcal: number;
  workouts: number;
  skipped: number;
}

// Ce que Santé appelle une séance quand il ne dit pas laquelle.
const VAGUE = /^(workouts?|entra[iî]nements?|s[ée]ances?|other|autre)?$/i;

// Types de l'export d'Apple Santé (HKWorkoutActivityType…) les plus courants chez nous.
const FR: Record<string, string> = {
  Swimming: "Natation",
  Pilates: "Pilates",
  Walking: "Marche",
  Running: "Course",
  Cycling: "Vélo",
  Yoga: "Yoga",
  Hiking: "Randonnée",
  TraditionalStrengthTraining: "Renforcement",
  FunctionalStrengthTraining: "Renforcement",
  HighIntensityIntervalTraining: "HIIT",
  CoreTraining: "Gainage",
  Elliptical: "Elliptique",
  Rowing: "Rameur",
  MixedCardio: "Cardio",
  CrossTraining: "Entraînement croisé",
  Dance: "Danse",
  SocialDance: "Danse",
  Cardio: "Cardio",
  Barre: "Barre au sol",
  Boxing: "Boxe",
  Kickboxing: "Kick-boxing",
  MartialArts: "Arts martiaux",
  Climbing: "Escalade",
  Tennis: "Tennis",
  TableTennis: "Tennis de table",
  Badminton: "Badminton",
  Soccer: "Football",
  Basketball: "Basket",
  Golf: "Golf",
  StairClimbing: "Escaliers",
  Stairs: "Escaliers",
  StepTraining: "Step",
  JumpRope: "Corde à sauter",
  WaterFitness: "Aquagym",
  PaddleSports: "Pagaie",
  SurfingSports: "Surf",
  DownhillSkiing: "Ski",
  CrossCountrySkiing: "Ski de fond",
  Flexibility: "Souplesse",
  MindAndBody: "Corps et esprit",
  Cooldown: "Retour au calme",
  Other: "Séance",
};

/** Nom lisible d'une séance : le type s'il est précis, sinon le texte envoyé, sinon « Séance ». */
export function workoutLabel(type: string, name?: string) {
  const t = type.replace(/^HKWorkoutActivityType/, "").trim();
  if (FR[t]) return FR[t];
  if (!VAGUE.test(t)) return t;
  const n = (name ?? "").split(/[\n,]/)[0].trim();
  return n && !VAGUE.test(n) ? n : "Séance";
}

/**
 * Nom lisible d'une séance de l'app : `activity` est le HKWorkoutActivityType en snake_case
 * (`traditional_strength_training`). Connu : en français ; sinon les mots tels quels.
 */
export function activityLabel(activity: string) {
  const words = activity.trim().toLowerCase().split(/[_\s]+/).filter(Boolean);
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  if (FR[pascal]) return FR[pascal];
  if (VAGUE.test(pascal)) return "Séance";
  const text = words.join(" ");
  return text[0].toUpperCase() + text.slice(1);
}

/** Poids en kg ; accepte aussi des livres si l'unité le dit. */
export function toKg(v: number, unit?: string) {
  return unit && /lb/i.test(unit) ? v * 0.45359237 : v;
}

export function ingest(db: Db, p: ImportPayload): ImportResult {
  const r: ImportResult = { weights: 0, steps: 0, activeKcal: 0, workouts: 0, skipped: 0 };
  const source = p.source === "export" ? "import" : "health";
  db.transaction((tx) => {
    for (const w of p.weights) {
      const kg = Math.round(toKg(w.kg, w.unit) * 100) / 100;
      if (!(kg > 25 && kg < 300)) {
        r.skipped++;
        continue;
      }
      const at = new Date(w.at);
      const res = tx
        .insert(weighIns)
        .values({ id: randomUUID(), personId: p.person, date: todayParis(at), measuredAt: at.toISOString(), kg, source, externalId: `w:${at.toISOString()}` })
        .onConflictDoNothing()
        .run();
      r.weights += res.changes;
    }
    // Pas et énergie active : un total par jour, qui grossit dans la journée → on remplace.
    const daily = (kind: "steps" | "active_kcal", date: string, value: number, unit: string) => {
      const day = todayParis(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
      tx.insert(healthSamples)
        .values({ id: randomUUID(), personId: p.person, kind, start: day, value, unit, externalId: `${kind}:${day}` })
        .onConflictDoUpdate({ target: [healthSamples.personId, healthSamples.kind, healthSamples.externalId], set: { value } })
        .run();
    };
    for (const s of p.steps) daily("steps", s.date, Math.round(s.count), "count"), r.steps++;
    for (const a of p.activeKcal) daily("active_kcal", a.date, Math.round(a.kcal), "kcal"), r.activeKcal++;
    for (const w of p.workouts) {
      const start = new Date(w.start).toISOString();
      const end = w.end ? new Date(w.end).toISOString() : null;
      const minutes = w.durationMin ?? (end ? (Date.parse(end) - Date.parse(start)) / 60000 : null);
      const res = tx
        .insert(healthSamples)
        .values({ id: randomUUID(), personId: p.person, kind: "workout", start, end, value: Math.round((minutes ?? 0) * 10) / 10, unit: "min", meta: { type: workoutLabel(w.type, w.name), kcal: w.kcal ?? null, distanceM: w.distanceM ?? null }, externalId: `workout:${start}` })
        .onConflictDoNothing()
        .run();
      r.workouts += res.changes;
    }
  });
  return r;
}
