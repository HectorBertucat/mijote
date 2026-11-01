// API de l'app iPhone (Mijote Santé) : tout Santé et Sport en natif. Même clé que l'import (X-Mijote-Key,
// src/lib/health/import-api.ts), qui désigne la personne : l'app ne lit et n'écrit que ce qui est à elle.
// Les écritures passent par les mêmes fonctions que l'interface (journal, pesées, séance guidée) ; une
// séance se pilote par gestes (`act`, appliqué ici avec l'heure du serveur), jamais en écrivant l'état.
// Sans Next : la route (src/app/api/app/v1/[...path]/route.ts) passe base, en-têtes, chemin, requête et
// corps ; les tests aussi. Contrat : docs/api-app.md (additif : on ajoute, on ne retire rien).
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { byKey, type ApiReply } from "@/lib/health/import-api";
import { overview } from "@/lib/health/overview";
import { DEFAULT_PERIOD, isPeriod, lineGrainOf } from "@/lib/health/series";
import { addWeighIn, currentReview, getPerson, listPeople, listWaist, listWeighIns, todayParis, type Person } from "@/lib/health/store";
import { goalSummary } from "@/lib/health/objectives";
import { addEntry, addRecipeEntry, deleteEntry, isComplete, listEntries, listTemplates, MEALS, pending, plannedMeals, setComplete, setEntryUnits, totals, type LogMeal } from "@/lib/health/log";
import { recentWorkouts } from "@/lib/health/samples";
import { courseView } from "@/lib/running/page";
import { getRunProfile } from "@/lib/running/store";
import { act, clockOf, normOpts, optsOf, suggestedReps, type Live, type LiveAction } from "@/lib/training/live";
import { activeLive, createDuo, createLive, endLive, getLive, guideOpts, setGuideOpts, writeLive, type LiveRow } from "@/lib/training/live-store";
import { GEAR_LABEL, META } from "@/lib/training/library";
import { guideMotion, motionOf } from "@/lib/training/figures";
import { cycleDuration } from "@/lib/training/motion";
import { lastFor, levelFor, nextType, ready, type Program, type Workout } from "@/lib/training/program";
import { programById, programFor } from "@/lib/training/programs";
import { listWorkouts } from "@/lib/training/store";
import { DRAWING, figureData, musclesData } from "./figures";
import { ACTIONS, actionOf, clean, phaseOf } from "./state";
import { healthSamples } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export const API_VERSION = 1;
/** Ce que sait faire ce Mijote : l'app n'affiche que ce qui est annoncé. */
export const FEATURES = ["sante", "series", "jour", "pesee", "course", "sorties", "sport", "seance", "actions", "attente", "figures", "muscles", "rythme"] as const;

export interface AppRequest {
  method: "GET" | "POST";
  path: string[];
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  now?: number;
}

const fail = (error: string, status = 400): ApiReply => ({ status, body: { ok: false, error } });
const ok = (body: Record<string, unknown>): ApiReply => ({ status: 200, body: { ok: true, ...body } });
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

// ─── Santé ───

function sante(db: Db, p: Person, q: URLSearchParams, today: string) {
  const periode = q.get("periode");
  const o = overview(db, p, isPeriod(periode) ? periode : DEFAULT_PERIOD, today);
  return ok({ overview: o, series: seriesOf(o), goals: goalSummary(db, p), review: currentReview(db, p), waist: listWaist(db, p.id).slice(-30) });
}

/** Les courbes de la vue d'ensemble, à plat pour les graphiques de l'app : un point par paquet mesuré. */
function seriesOf(o: ReturnType<typeof overview>) {
  const grain = o.period.grain;
  const pts = (b: { start: string; value: number | null }[] | null) => (b ?? []).filter((x) => x.value != null).map((x) => ({ date: x.start, value: Math.round(x.value! * 10) / 10 }));
  const out: Record<string, { unit: string; grain: string; points: { date: string; value: number }[]; mode: "mean" | "sum"; extra?: unknown }> = {
    steps: { unit: "pas/jour", grain, mode: "mean", points: pts(o.bars.steps) },
    activeKcal: { unit: "kcal/jour", grain, mode: "mean", points: pts(o.bars.activeKcal) },
    exercise: { unit: "min", grain, mode: "sum", points: pts(o.bars.exercise) },
    restingHr: { unit: "bpm", grain: lineGrainOf(grain), mode: "mean", points: pts(o.lines.restingHr) },
    hrv: { unit: "ms", grain: lineGrainOf(grain), mode: "mean", points: pts(o.lines.hrv) },
    sleep: { unit: "min/nuit", grain, mode: "mean", points: pts(o.sleep) },
    weight: {
      unit: "kg",
      grain,
      mode: "mean",
      points: o.weight.filter((x) => x.kg != null).map((x) => ({ date: x.date, value: x.kg! })),
      // La tendance lissée et sa fourchette, un point par paquet.
      extra: { trend: o.weight.map((x) => ({ date: x.date, value: Math.round(x.trend * 100) / 100, ...(x.lo != null && x.hi != null ? { range: [x.lo, x.hi] } : {}) })) },
    },
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.points.length || (v.extra as { trend?: unknown[] })?.trend?.length));
}

function jour(db: Db, p: Person, date: string) {
  const entries = listEntries(db, p.id, date);
  const templates = listTemplates(db, p.id);
  return {
    date,
    entries,
    totals: totals(entries),
    complete: isComplete(db, p.id, date),
    todo: pending(plannedMeals(db, p.id, date), templates, entries, date),
    review: currentReview(db, p),
  };
}

const Meal = z.enum(MEALS as [LogMeal, ...LogMeal[]]);
const JourAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recette"), date: z.string(), meal: Meal, recipeId: z.string().max(80), units: z.number().positive().max(20), plan: z.boolean().optional() }),
  z.object({ action: z.literal("habitude"), date: z.string(), templateId: z.string().max(80) }),
  z.object({ action: z.literal("libre"), date: z.string(), meal: Meal, label: z.string().min(1).max(120), kcal: z.number().min(0).max(5000), proteinG: z.number().min(0).max(400), fatG: z.number().min(0).max(400).nullish(), carbsG: z.number().min(0).max(800).nullish() }),
  z.object({ action: z.literal("parts"), date: z.string(), id: z.string().max(80), units: z.number().positive().max(20) }),
  z.object({ action: z.literal("retirer"), date: z.string(), id: z.string().max(80) }),
  z.object({ action: z.literal("complete"), date: z.string(), complete: z.boolean() }),
]);

function jourPost(db: Db, p: Person, body: unknown, today: string): ApiReply {
  const parsed = JourAction.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
  const a = parsed.data;
  if (!isDate(a.date) || a.date > today) return fail("date AAAA-MM-JJ attendue, pas dans le futur");
  // Une entrée à modifier doit être à la personne de la clé.
  const own = (id: string) => listEntries(db, p.id, a.date).some((e) => e.id === id);
  try {
    let message: string;
    switch (a.action) {
      case "recette": {
        const e = addRecipeEntry(db, p.id, a.date, a.meal, a.recipeId, a.units, a.plan ? "plan" : "manual");
        message = `${e.label} : ${e.kcal} kcal, ${Math.round(e.proteinG)} g de protéines.`;
        break;
      }
      case "habitude": {
        const t = listTemplates(db, p.id).find((x) => x.id === a.templateId);
        if (!t) return fail("habitude introuvable", 404);
        addEntry(db, { personId: p.id, date: a.date, meal: t.meal, kind: "template", templateId: t.id, label: t.label, kcal: t.kcal, proteinG: t.proteinG, fatG: t.fatG, carbsG: t.carbsG });
        message = `${t.label} noté.`;
        break;
      }
      case "libre":
        addEntry(db, { personId: p.id, date: a.date, meal: a.meal, kind: "free", label: a.label, kcal: a.kcal, proteinG: a.proteinG, fatG: a.fatG, carbsG: a.carbsG });
        message = `${a.label} noté.`;
        break;
      case "parts":
        if (!own(a.id)) return fail("entrée introuvable", 404);
        setEntryUnits(db, a.id, a.units);
        message = "Part mise à jour.";
        break;
      case "retirer":
        if (!own(a.id)) return fail("entrée introuvable", 404);
        deleteEntry(db, a.id);
        message = "Retiré du journal.";
        break;
      case "complete":
        setComplete(db, p.id, a.date, a.complete);
        message = a.complete ? "Journée complète : elle compte pour la cible." : "Journée marquée incomplète.";
        break;
    }
    return ok({ message, jour: jour(db, p, a.date) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "action impossible");
  }
}

function pesee(db: Db, p: Person, body: unknown, now: number): ApiReply {
  const parsed = z.object({ kg: z.number().min(25).max(350) }).safeParse(body);
  if (!parsed.success) return fail("kg entre 25 et 350 attendu");
  try {
    addWeighIn(db, p.id, parsed.data.kg, new Date(now));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "pesée refusée");
  }
  return ok({ message: `${parsed.data.kg.toFixed(1).replace(".", ",")} kg noté.`, weighIns: listWeighIns(db, p.id).slice(-60) });
}

// ─── Sport ───

/** Un exercice tel que l'app l'affiche : fiche, matériel, muscles, carnet. */
function exerciseView(p: Program, workouts: Workout[], id: string) {
  const ex = p.exercises[id];
  const meta = META[id];
  return {
    id,
    ...ex,
    gear: (meta?.gear ?? []).map((g) => ({ id: g, label: GEAR_LABEL[g] })),
    pattern: meta?.pattern ?? null,
    muscles: musclesData(id, ex),
    level: levelFor(workouts, id),
    last: lastFor(workouts, id),
    ready: ready(p, workouts, id),
    hasFigure: !!motionOf(p, id),
    // Durée d'une répétition au rythme guidé (secondes) : celle de la figure, ou de la planche sans figure.
    cycle: cycleDuration(guideMotion(p, id)),
  };
}

function sport(db: Db, p: Person, today: string) {
  const program = programFor(db, p.id);
  const workouts = listWorkouts(db, p.id);
  const live = activeLive(db, p.id);
  const partner = listPeople(db)
    .filter((x) => x.id !== p.id)
    .map((x) => ({ id: x.id, name: x.name, program: programFor(db, x.id) }))
    .find((x) => x.program);
  return ok({
    today,
    program: program && {
      id: program.id,
      name: program.name,
      source: program.source ?? null,
      sessions: program.sessions,
      warmup: program.warmup,
      short: program.short,
      perWeek: program.perWeek,
      weekPlan: program.weekPlan,
      alsoTrack: program.alsoTrack,
      bonus: program.bonus,
      principles: program.principles,
      weekNote: program.weekNote,
      next: nextType(program, workouts),
      exercises: Object.keys(program.exercises).map((id) => exerciseView(program, workouts, id)),
      // Les figures dont chaque séance a besoin, à télécharger avant de partir.
      figureIds: Object.fromEntries(Object.entries(program.sessions).map(([k, def]) => [k, [...new Set([...def.blocks.flatMap((b) => b.items), ...(program.bonus?.items ?? [])])].filter((id) => motionOf(program, id))])),
    },
    workouts,
    apple: recentWorkouts(db, p.id, 20).map((w) => ({ start: w.start, type: String(w.meta?.type ?? "Séance"), minutes: w.value, distanceM: typeof w.meta?.distanceM === "number" ? w.meta.distanceM : null })),
    guide: guideOpts(db, p.id),
    live: live ? { id: live.id, type: live.live.type, pair: live.live.pair ?? null } : null,
    partner: partner ? { id: partner.id, name: partner.name, programId: partner.program!.id } : null,
  });
}

function figure(db: Db, p: Person, id: string, q: URLSearchParams): ApiReply {
  const program = (q.get("programme") ? programById(db, q.get("programme")!) : null) ?? programFor(db, p.id);
  const m = motionOf(program, id);
  if (!m) return fail("figure inconnue", 404);
  return ok({ id, ...figureData(m), muscles: musclesData(id, program?.exercises[id]) });
}

function figures(db: Db, p: Person, q: URLSearchParams): ApiReply {
  const program = (q.get("programme") ? programById(db, q.get("programme")!) : null) ?? programFor(db, p.id);
  const ids = (q.get("ex") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  const list = ids.length ? ids : Object.keys(program?.exercises ?? {});
  const out: Record<string, unknown> = {};
  for (const id of list) {
    const m = motionOf(program, id);
    if (m) out[id] = { ...figureData(m), muscles: musclesData(id, program?.exercises[id]) };
  }
  return ok({ drawing: DRAWING, figures: out });
}

/** Ce qu'affiche l'app pour une séance : l'état, plus ce que le code calcule (objectif, suite, repos). */
export function liveView(db: Db, row: LiveRow, now: number) {
  const p = programById(db, row.live.program);
  const l = row.live;
  const workouts = listWorkouts(db, row.personId);
  const step = l.steps[l.i];
  const work = (s: Live["steps"][number] | undefined) => (s && (s.k === "ex" || s.k === "emom") ? s : null);
  const next = work(l.steps.slice(l.i + 1).find((s) => s.k === "ex" || s.k === "emom"));
  const cur = work(step);
  const ex = cur && p ? p.exercises[cur.ex] : null;
  const reps = step?.k === "ex" && ex ? (l.cur.reps ?? suggestedReps(l, workouts, step.ex, step.set, ex.reps[0])) : null;
  return {
    ...row,
    now,
    opts: optsOf(l),
    state: phaseOf(l, row.ended, row.version, now, cur && ex && reps != null ? { ex, motion: guideMotion(p, cur.ex), reps } : null),
    figureIds: [...new Set(l.steps.flatMap((s) => (s.k === "ex" || s.k === "emom" ? [s.ex] : [])))].filter((id) => motionOf(p, id)),
    view: {
      step,
      exercise: cur && p ? exerciseView(p, workouts, cur.ex) : null,
      // Objectif de la série en cours : choisi sur un écran, sinon proposé comme sur le web.
      reps,
      restLeft: step?.k === "rest" && l.cur.restEnd != null ? Math.max(0, (l.cur.restEnd - clockOf(l, now)) / 1000) : null,
      next: next && p ? { step: next, exercise: exerciseView(p, workouts, next.ex) } : null,
      paused: l.cur.paused != null,
    },
  };
}

const Geste = z.discriminatedUnion("k", [
  z.object({ k: z.literal("go"), at: z.number().int(), n: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ k: z.literal("record"), at: z.number().int(), ex: z.string().max(60), set: z.number().int().min(1).max(20), value: z.number().min(0).max(1000), level: z.number().int().min(0).max(20).optional() }),
  z.object({ k: z.literal("correct"), ex: z.string().max(60), set: z.number().int().min(1).max(20), value: z.number().min(0).max(1000) }),
  z.object({ k: z.literal("level"), ex: z.string().max(60), level: z.number().int().min(0).max(20) }),
  z.object({ k: z.literal("reps"), at: z.number().int(), reps: z.number().int().min(1).max(500) }),
  z.object({ k: z.literal("guide"), at: z.number().int(), on: z.boolean(), reps: z.number().int().min(1).max(500).optional(), lead: z.number().min(0).max(30).optional() }),
  z.object({ k: z.literal("pause"), at: z.number().int() }),
  z.object({ k: z.literal("resume"), at: z.number().int() }),
  z.object({ k: z.literal("lead+"), at: z.number().int(), sec: z.number().min(-3600).max(60) }),
  z.object({ k: z.literal("rest+"), at: z.number().int(), sec: z.number().min(-600).max(600) }),
  z.object({ k: z.literal("emom"), at: z.number().int() }),
  z.object({ k: z.literal("bonus"), at: z.number().int() }),
  z.object({ k: z.literal("opts"), opts: z.object({ auto: z.boolean().optional(), lead: z.number().optional(), change: z.number().optional() }) }),
]);

/** Applique un geste avec l'heure du serveur ; si un autre écran a écrit entre-temps, on rejoue sur son état. */
export function applyGeste(db: Db, row: LiveRow, a: LiveAction, now: number): LiveRow | null {
  const p = programById(db, row.live.program);
  if (!p) return null;
  let cur: LiveRow | null = row;
  for (let i = 0; i < 4 && cur && !cur.ended; i++) {
    const next = act(p, cur.live, a, now, listWorkouts(db, cur.personId));
    if (next === cur.live) return cur; // le geste ne s'applique plus (étape déjà passée)
    const w = writeLive(db, cur.id, cur.version, next, now);
    if (w.ok) return w.row;
    cur = w.row;
  }
  return cur;
}

function seance(db: Db, p: Person, req: AppRequest, now: number): ApiReply {
  const [, , id, verb] = req.path; // sport/seance/:id/:verb
  if (req.method === "GET" && !id) {
    const live = activeLive(db, p.id, now);
    return ok({ live: live ? liveView(db, live, now) : null });
  }
  if (req.method === "POST" && !id) {
    const parsed = z.object({ type: z.string().min(1).max(10).optional(), duo: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return fail("type de séance attendu");
    const program = programFor(db, p.id);
    if (!program) return fail("aucun programme en cours : choisis-en un dans Santé › Entraînement", 404);
    const type = parsed.data.type ?? nextType(program, listWorkouts(db, p.id));
    if (parsed.data.duo) {
      const other = listPeople(db).map((x) => ({ x, prog: programFor(db, x.id) })).find((o) => o.x.id !== p.id && o.prog);
      if (!other) return fail("personne d'autre n'a de programme", 404);
      const rows = createDuo(db, { personId: p.id, programId: program.id, type }, { personId: other.x.id, programId: other.prog!.id, type: nextType(other.prog!, listWorkouts(db, other.x.id)) }, now);
      if (!rows) return fail("séance impossible");
      return ok({ live: liveView(db, rows[0], now) });
    }
    const row = createLive(db, p.id, program.id, type, now);
    if (!row) return fail("séance inconnue pour ce programme");
    return ok({ live: liveView(db, row, now) });
  }
  const row = id ? getLive(db, id) : null;
  if (!row || row.personId !== p.id) return fail("séance inconnue", 404);
  if (req.method === "GET" && !verb) return ok({ live: liveView(db, row, now) });
  if (req.method === "POST" && verb === "geste") {
    const parsed = Geste.safeParse(req.body);
    if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
    if (row.ended) return fail("séance terminée", 409);
    const next = applyGeste(db, row, parsed.data as LiveAction, now);
    return next ? ok({ live: liveView(db, next, now) }) : fail("geste impossible");
  }
  if (req.method === "POST" && verb === "action") {
    const parsed = z.object({ action: z.enum(ACTIONS), revision: z.number().int().optional(), reps: z.number().min(0).max(1000).optional(), sec: z.number().min(-600).max(600).optional() }).passthrough().safeParse(req.body);
    if (!parsed.success) return fail(`action inconnue : ${ACTIONS.join(", ")}`);
    if (row.ended) return fail("séance terminée", 409);
    // Révision périmée : l'app recharge l'état (renvoyé avec le 409).
    if (parsed.data.revision != null && parsed.data.revision !== row.version) return { status: 409, body: { ok: false, error: "la séance a changé entre-temps : état rechargé", live: liveView(db, row, now) } };
    const step = row.live.steps[row.live.i];
    const v = liveView(db, row, now);
    const cur = step?.k === "ex" ? { ex: step.ex, set: step.set, reps: v.view.reps ?? 0, level: row.live.levels[step.ex] ?? levelFor(listWorkouts(db, row.personId), step.ex) } : null;
    const a = actionOf(row.live, parsed.data, cur);
    if (!a) return fail("rien à faire à cette étape");
    const next = applyGeste(db, row, a, now);
    return next ? ok({ live: liveView(db, next, now) }) : fail("geste impossible");
  }
  if (req.method === "POST" && verb === "fin") {
    const parsed = z.union([z.object({ note: z.string().max(2000) }), z.object({ abandon: z.literal(true) })]).safeParse(req.body);
    if (!parsed.success) return fail("{ note } ou { abandon: true } attendu");
    const r = endLive(db, row.id, "note" in parsed.data ? { note: parsed.data.note } : null, now);
    return r.ok ? ok({ message: r.message, workoutId: r.workoutId ?? null }) : fail(r.message);
  }
  return fail("chemin inconnu", 404);
}

/** Les sorties de course, de la plus récente à la plus ancienne, par pages ; avec l'uuid HealthKit de la séance. */
function sorties(db: Db, p: Person, q: URLSearchParams, now: number): ApiReply {
  const v = getRunProfile(db, p.id)?.enabled ? courseView(db, p.id, new Date(now)) : null;
  if (!v) return ok({ runs: [], more: false });
  const before = q.get("before");
  const limit = Math.max(1, Math.min(100, Number(q.get("limit")) || 20));
  const all = v.runs.filter((r) => !isDate(before) || r.date < before);
  const page = all.slice(0, limit);
  const ids = page.map((r) => r.sampleId);
  const ext = new Map(
    ids.length
      ? db
          .select({ id: healthSamples.id, ext: healthSamples.externalId })
          .from(healthSamples)
          .where(and(eq(healthSamples.personId, p.id), inArray(healthSamples.id, ids)))
          .all()
          .map((r) => [r.id, r.ext])
      : [],
  );
  const uuid = (id: string) => ext.get(id)?.replace(/^hk:/, "");
  return ok({ runs: page.map((r) => ({ ...r, ...(uuid(r.sampleId) ? { uuid: uuid(r.sampleId) } : {}) })), more: all.length > page.length });
}

function reglages(db: Db, p: Person, body: unknown): ApiReply {
  const parsed = z.object({ auto: z.boolean().optional(), lead: z.number().optional(), change: z.number().optional() }).safeParse(body);
  if (!parsed.success) return fail("{ auto, lead, change } attendu");
  const opts = setGuideOpts(db, p.id, parsed.data);
  // Une séance en cours prend les nouveaux réglages tout de suite.
  const live = activeLive(db, p.id);
  if (live) applyGeste(db, live, { k: "opts", opts: normOpts(opts) }, Date.now());
  return ok({ guide: opts });
}

// ─── Routeur ───

/** Réponses des derniers gestes par `actionId` (un renvoi après une coupure ne refait pas le geste). */
const done = new Map<string, ApiReply>();
const DONE_MAX = 500;

export function appApi(db: Db, req: AppRequest): ApiReply {
  const now = req.now ?? Date.now();
  const actionId = req.method === "POST" && req.body && typeof req.body === "object" ? (req.body as { actionId?: unknown }).actionId : undefined;
  const key = typeof actionId === "string" && actionId.length <= 80 ? `${req.headers.get("x-mijote-key") ?? ""}:${actionId}` : null;
  if (key && done.has(key)) return done.get(key)!;
  const r = route(db, req, now);
  const out: ApiReply = { status: r.status, body: { ...(clean(r.body) as Record<string, unknown>), generatedAt: new Date(now).toISOString() } };
  if (key && r.status === 200) {
    done.set(key, out);
    if (done.size > DONE_MAX) done.delete(done.keys().next().value!);
  }
  return out;
}

function route(db: Db, req: AppRequest, now: number): ApiReply {
  const k = byKey(db, req.headers);
  if (!k.link) return k.error;
  const p = getPerson(db, k.link.personId);
  if (!p) return fail("personne inconnue", 404);
  const today = todayParis(new Date(now));
  const [a, b] = req.path;
  const route = `${req.method} ${a ?? ""}${b ? `/${b}` : ""}`;
  switch (route) {
    case "GET moi":
      return ok({ version: API_VERSION, features: FEATURES, person: { id: p.id, name: p.name }, today, running: !!getRunProfile(db, p.id)?.enabled });
    case "GET sante":
      return sante(db, p, req.query, today);
    case "GET jour": {
      const d = req.query.get("date");
      return ok(jour(db, p, isDate(d) && d <= today ? d : today));
    }
    case "POST jour":
      return jourPost(db, p, req.body, today);
    case "POST pesee":
      return pesee(db, p, req.body, now);
    case "GET course": {
      const enabled = !!getRunProfile(db, p.id)?.enabled;
      return ok({ enabled, view: enabled ? courseView(db, p.id, new Date(now)) : null });
    }
    case "GET course/sorties":
      return sorties(db, p, req.query, now);
    case "GET sport":
      return sport(db, p, today);
    case "GET sport/figures":
      return req.path[2] ? figure(db, p, req.path[2], req.query) : figures(db, p, req.query);
    case "POST sport/reglages":
      return reglages(db, p, req.body);
    case "GET sport/seance":
    case "POST sport/seance":
      return seance(db, p, req, now);
  }
  return fail("chemin inconnu", 404);
}
