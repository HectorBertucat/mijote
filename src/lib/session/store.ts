// Sessions de cuisine en base : création (planificateur), journal cook_events, minuteurs.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Db } from "@/lib/db/open";
import { cookEvents, cookSessions, durationSamples, equipment, equipmentFit, recipeIngredients, recipes, recipeSteps, shoppingLists, timers } from "@/lib/db/schema";
import { orderedIngredientsFor } from "@/lib/shopping/ordered";
import { modeOf, planSession, type DurationInput, type EveDone, type OrderedIngredient, type SessionMode, type OrderedIngredientsProvider, type PlannerRecipe, type PlannerResources, type SessionPlan } from "./planner";
import { reduce, type SessionEvent, type EventKind } from "./state";
import { cookedEnough, learn, measureSession, plannerInput, WINDOW, type Correction, type StoredSample } from "./durations";

export function loadResources(db: Db): PlannerResources {
  return {
    equipment: db.select({ id: equipment.id, kind: equipment.kind, name: equipment.name, maxBatchG: equipment.maxBatchG, dimsJson: equipment.dimsJson, count: equipment.count }).from(equipment).where(eq(equipment.owned, true)).all(),
    fits: db.select().from(equipmentFit).all(),
  };
}

/**
 * Recettes pour le planificateur, aux unités choisies : `scales` (slug → multiplicateur) et
 * `extras` (recipe_ingredient_id → grammes ajoutés pour toute la cuisson, p. ex. finir un paquet).
 * Le planificateur multiplie les grammes par le multiplicateur : les grammes ajoutés y entrent divisés.
 */
export function loadPlannerRecipes(db: Db, slugs: string[], scales: Record<string, number> = {}, extras: Record<string, number> = {}): PlannerRecipe[] {
  if (!slugs.length) return [];
  const rs = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name }).from(recipes).where(inArray(recipes.slug, slugs)).all();
  const ids = rs.map((r) => r.id);
  const ings = db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, ids)).orderBy(asc(recipeIngredients.position)).all();
  const steps = db.select().from(recipeSteps).where(inArray(recipeSteps.recipeId, ids)).orderBy(asc(recipeSteps.order)).all();
  return slugs
    .map((slug) => rs.find((r) => r.slug === slug))
    .filter((r): r is (typeof rs)[number] => Boolean(r))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      scale: scales[r.slug] ?? 1,
      ingredients: ings
        .filter((i) => i.recipeId === r.id)
        .map((i) => ({ id: i.id, item: i.item, grams: i.grams != null && extras[i.id] ? i.grams + extras[i.id] / (scales[r.slug] ?? 1) : i.grams, units: i.units, group: i.group, optional: i.optional, pantry: i.pantry, foodId: i.foodId })),
      steps: steps
        .filter((s) => s.recipeId === r.id)
        .map((s) => ({
          kind: s.kind,
          text: s.text,
          durationMin: s.durationMin,
          activeMin: s.activeMin,
          equipmentId: s.equipmentId,
          equipmentAlt: s.equipmentAlt ?? null,
          hobLevel: s.hobLevel,
          ovenTemp: s.ovenTemp,
          bowls: s.bowlRefs,
          cue: s.cue,
          phases: s.phases ?? null,
        })),
    }));
}

/** Unités choisies à la création d'une liste de courses (Composer, Semaine). */
export function listUnits(db: Db, listId: string): { scales: Record<string, number>; extras: Record<string, number> } | null {
  const l = db.select({ scales: shoppingLists.recipeScales, extras: shoppingLists.recipeExtras }).from(shoppingLists).where(eq(shoppingLists.id, listId)).get();
  return l ? { scales: l.scales ?? {}, extras: l.extras ?? {} } : null;
}

// Fournisseur des ingrédients commandés : par défaut, la liste de courses (src/lib/shopping/ordered.ts).
// Les besoins de la liste sont déjà aux unités de la liste ; le planificateur, lui, multiplie
// le besoin par le multiplicateur de la session : on le ramène donc à ×1 (pas de double facteur).
function fromShoppingList(db: Db): OrderedIngredientsProvider {
  return (listId) => {
    const listScales = listUnits(db, listId)?.scales ?? {};
    return orderedIngredientsFor(db, listId).flatMap((r) =>
      r.ingredients
        .filter((i) => i.recipeIngredientId && i.product && !i.pantry)
        .map((i) => ({
          recipeIngredientId: i.recipeIngredientId!,
          productName: i.product!.name,
          brand: i.product!.brandName,
          packLabel: i.product!.quantityLabel,
          packs: i.product!.packs,
          gramsBought: i.boughtG,
          gramsNeeded: i.needG != null ? i.needG / (listScales[r.slug] ?? 1) : null,
        }))
    );
  };
}
let orderedProvider: OrderedIngredientsProvider | null = null;
export function setOrderedIngredientsProvider(p: OrderedIngredientsProvider | null) {
  orderedProvider = p;
}

export interface CreateSessionInput {
  slugs: string[];
  shoppingListId?: string | null;
  /** Multiplicateur par recette. Absent : celui de la liste de courses, s'il y en a une, sinon ×1. */
  scales?: Record<string, number>;
  ordered?: OrderedIngredient[]; // sinon, demandé au fournisseur si la session vient d'une liste
  /** Grammes ajoutés (recipe_ingredient_id → g). Absents : ceux de la liste de courses, s'il y en a une. */
  extras?: Record<string, number>;
  mode?: SessionMode;
  /** Prep la veille reprise à deux : ce que la soirée a laissé. */
  eve?: EveDone;
  /** Durées réelles : par défaut, celles des dernières sessions terminées ; false = durées de référence. */
  durations?: DurationInput | false;
  /** Session test (pour montrer l'appli) : ses durées ne servent pas aux suivantes. */
  test?: boolean;
  /** Seul : false = toute la prep avant la cuisson (par défaut, des gestes se glissent dans la cuisson). */
  interleave?: boolean;
}

export function buildPlan(db: Db, input: CreateSessionInput): SessionPlan {
  const provider = orderedProvider ?? fromShoppingList(db);
  const ordered = input.ordered ?? (input.shoppingListId ? provider(input.shoppingListId) : undefined);
  const durations = input.durations === false ? undefined : (input.durations ?? learnedDurations(db).input);
  const fromList = input.shoppingListId ? listUnits(db, input.shoppingListId) : null;
  const scales = input.scales ?? fromList?.scales ?? {};
  const extras = input.extras ?? fromList?.extras ?? {};
  const plan = planSession(loadPlannerRecipes(db, input.slugs, scales, extras), loadResources(db), { ordered, mode: input.mode ?? "solo", eve: input.eve, durations, interleave: input.interleave });
  if (Object.keys(extras).length) plan.extras = extras;
  return plan;
}

export function createSession(db: Db, input: CreateSessionInput): string {
  const id = randomUUID();
  const plan = buildPlan(db, input);
  if (input.test) clearTestSessions(db);
  db.insert(cookSessions)
    .values({ id, planJson: plan, status: "prep", mode: modeOf(plan), startedAt: new Date().toISOString(), shoppingListId: input.shoppingListId ?? null, test: Boolean(input.test) })
    .run();
  return id;
}

/** Les anciennes sessions test s'effacent quand on en lance une autre (finies, ou lancées il y a plus de 12 h). */
export function clearTestSessions(db: Db, now = Date.now()): number {
  const old = db
    .select({ id: cookSessions.id, status: cookSessions.status, startedAt: cookSessions.startedAt })
    .from(cookSessions)
    .where(eq(cookSessions.test, true))
    .all()
    .filter((s) => s.status === "done" || s.status === "abandoned" || !s.startedAt || now - Date.parse(s.startedAt) > 12 * 3600_000)
    .map((s) => s.id);
  if (old.length) db.delete(cookSessions).where(inArray(cookSessions.id, old)).run();
  return old.length;
}

/** Refait le plan avec d'autres facteurs (réduction au prorata d'un ingrédient manquant). Le journal est gardé. */
export function rescaleSession(db: Db, id: string, scales: Record<string, number>, reason: "scale" | "recipe" = "scale") {
  const s = getSession(db, id);
  if (!s) return;
  const eve = s.plan.eve ? { doneTasks: s.plan.eve.doneTasks, readyBowls: s.plan.eve.bowls } : undefined;
  const plan = buildPlan(db, { slugs: s.plan.recipes.map((r) => r.slug), shoppingListId: s.shoppingListId, scales, extras: s.plan.extras, mode: modeOf(s.plan), eve });
  db.update(cookSessions).set({ planJson: plan }).where(eq(cookSessions.id, id)).run();
  // Les autres écrans rechargent le plan.
  addEvent(db, id, { kind: "note", payload: { replan: true, reason } });
}

/** Une fiche réimportée (recette corrigée en pleine session) : les sessions pas finies qui la cuisinent refont leur plan, mêmes facteurs, journal gardé. */
export function replanSessionsFor(db: Db, slugs: string[]): string[] {
  if (!slugs.length) return [];
  const open = db.select({ id: cookSessions.id }).from(cookSessions).where(inArray(cookSessions.status, ["planned", "prep", "fridge", "cooking"])).all();
  const done: string[] = [];
  for (const { id } of open) {
    const s = getSession(db, id);
    if (!s?.plan?.recipes?.some((r) => slugs.includes(r.slug))) continue;
    rescaleSession(db, id, Object.fromEntries(s.plan.recipes.map((r) => [r.slug, r.scale])), "recipe");
    done.push(id);
  }
  return done;
}

/** Le plan du jour J d'une prep la veille repris à deux (sans l'enregistrer). */
export function dayPlan(db: Db, id: string, events?: SessionEvent[]): SessionPlan | null {
  const s = getSession(db, id);
  if (!s || modeOf(s.plan) !== "veille") return null;
  const st = reduce("prep", events ?? eventsAfter(db, id, 0));
  const scales = Object.fromEntries(s.plan.recipes.map((r) => [r.slug, r.scale]));
  return buildPlan(db, { slugs: s.plan.recipes.map((r) => r.slug), shoppingListId: s.shoppingListId, scales, extras: s.plan.extras, mode: "duo", eve: { doneTasks: [...st.prepDone], readyBowls: [...st.bowlsReady] } });
}

/**
 * Reprise d'une prep la veille : seul, le plan reste celui de la veille (le jour J y est
 * déjà) ; à deux, le planificateur refait le jour J (reste de la prep + cuisson) avec
 * les bols du frigo et le journal gardés. Les autres écrans rechargent le plan (replan).
 */
export function resumeSession(db: Db, id: string, dayMode: "solo" | "duo", eventId?: string) {
  const s = getSession(db, id);
  if (!s) return null;
  if (s.status !== "fridge" || modeOf(s.plan) !== "veille") return null;
  if (dayMode === "duo") {
    const plan = dayPlan(db, id);
    if (!plan) return null;
    db.update(cookSessions).set({ planJson: plan }).where(eq(cookSessions.id, id)).run();
  }
  return addEvent(db, id, { id: eventId, kind: "note", payload: { status: "prep", resume: true, dayMode, ...(dayMode === "duo" ? { replan: true } : {}) } });
}

export function getSession(db: Db, id: string) {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, id)).get();
  if (!s) return null;
  return { ...s, plan: s.planJson as SessionPlan };
}

export function activeSession(db: Db) {
  const s = db
    .select()
    .from(cookSessions)
    .where(inArray(cookSessions.status, ["prep", "fridge", "cooking"]))
    // Une vraie session passe toujours avant une session test.
    .orderBy(asc(cookSessions.test), desc(cookSessions.startedAt))
    .get();
  if (!s) return null;
  const plan = s.planJson as SessionPlan;
  return { id: s.id, status: s.status, mode: modeOf(plan), title: plan.recipes.map((r) => r.name).join(" + "), test: s.test };
}

const toEvent = (r: { rowid: number; id: string; at: string; kind: string; ref: string | null; payload_json: string | null }): SessionEvent => ({
  seq: r.rowid,
  id: r.id,
  at: r.at,
  kind: r.kind as EventKind,
  ref: r.ref,
  payload: r.payload_json ? JSON.parse(r.payload_json) : null,
});

/** Événements d'une session après un numéro de séquence (rowid SQLite, croissant). */
export function eventsAfter(db: Db, sessionId: string, after = 0): SessionEvent[] {
  const rows = db.all<{ rowid: number; id: string; at: string; kind: string; ref: string | null; payload_json: string | null }>(
    sql`select rowid, id, at, kind, ref, payload_json from cook_events where session_id = ${sessionId} and rowid > ${after} order by rowid`
  );
  return rows.map(toEvent);
}

export interface NewEvent {
  id?: string;
  kind: EventKind;
  ref?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Ajoute un événement au journal, avec ses effets (minuteurs, statut). Idempotent sur l'id. */
export function addEvent(db: Db, sessionId: string, e: NewEvent): SessionEvent | null {
  const id = e.id ?? randomUUID();
  return db.transaction((tx) => {
    const dup = tx.select({ id: cookEvents.id }).from(cookEvents).where(eq(cookEvents.id, id)).get();
    if (dup) return null;
    const at = new Date().toISOString();
    const payload = e.payload ?? null;
    if (e.kind === "timer_start" && e.ref) {
      const endsAt = String(payload?.endsAt ?? at);
      const label = String(payload?.label ?? "Minuteur");
      const existing = tx.select({ id: timers.id }).from(timers).where(eq(timers.id, e.ref)).get();
      if (existing) tx.update(timers).set({ endsAt, label, doneAt: null }).where(eq(timers.id, e.ref)).run();
      else tx.insert(timers).values({ id: e.ref, sessionId, label, stepRef: (payload?.stepId as string) ?? null, endsAt }).run();
    }
    if (e.kind === "timer_done" && e.ref) {
      // Deux écrans peuvent arrêter le même minuteur : seul le premier compte.
      const r = tx.update(timers).set({ doneAt: at }).where(and(eq(timers.id, e.ref), isNull(timers.doneAt))).run();
      if (r.changes === 0) return null;
    }
    let status: "prep" | "fridge" | "cooking" | "done" | "abandoned" | null = null;
    if (e.kind === "note" && typeof payload?.status === "string") {
      status = payload.status as NonNullable<typeof status>;
      tx.update(cookSessions)
        .set({ status, ...(status === "done" || status === "abandoned" ? { endedAt: at } : { endedAt: null }) })
        .where(eq(cookSessions.id, sessionId))
        .run();
    }
    tx.insert(cookEvents).values({ id, sessionId, at, kind: e.kind, ref: e.ref ?? null, payloadJson: payload }).run();
    // Session terminée : ses durées réelles servent aux suivantes ; rouverte : plus encore.
    // Une session test ne mesure rien.
    const test = status === "done" && tx.select({ test: cookSessions.test }).from(cookSessions).where(eq(cookSessions.id, sessionId)).get()?.test;
    if (status === "done" && !test) recordDurations(tx as unknown as Db, sessionId);
    else if (status) tx.delete(durationSamples).where(eq(durationSamples.sessionId, sessionId)).run();
    const row = tx.get<{ rowid: number; id: string; at: string; kind: string; ref: string | null; payload_json: string | null }>(
      sql`select rowid, id, at, kind, ref, payload_json from cook_events where id = ${id}`
    );
    return row ? toEvent(row) : null;
    // IMMEDIATE : le verrou d'écriture d'entrée. Une transaction différée qui lit puis
    // écrit échoue tout de suite (SQLITE_BUSY) si un autre processus vient d'écrire ;
    // vu à deux, quand A et B touchent « Fait » ensemble.
  }, { behavior: "immediate" });
}

// ─── Durées réelles (src/lib/session/durations.ts) ───

/** Mesure une session dans son journal et remplace ses mesures en base. Renvoie le nombre de mesures. */
export function recordDurations(db: Db, sessionId: string): number {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).get();
  if (!s?.planJson) return 0;
  const events = eventsAfter(db, sessionId, 0);
  // Terminée dès la prep : rien n'est appris (durations.ts, cookedEnough).
  const samples = cookedEnough(s.planJson as SessionPlan, events) ? measureSession(s.planJson as SessionPlan, events, s.startedAt) : [];
  const at = s.endedAt ?? new Date().toISOString();
  db.delete(durationSamples).where(eq(durationSamples.sessionId, sessionId)).run();
  for (const x of samples) {
    db.insert(durationSamples)
      .values({ id: randomUUID(), sessionId, at, kind: x.kind, key: x.key, ref: x.ref, label: x.label, grams: x.grams, units: x.units, estMin: x.estMin, plannedMin: x.plannedMin, realMin: x.realMin, weight: x.weight, via: x.via })
      .run();
  }
  return samples.length;
}

/**
 * Corrections apprises des WINDOW dernières sessions terminées et vraiment cuisinées (mesurées au besoin :
 * sessions finies avant le 20/10). Une session terminée dès la prep est sautée, même si des mesures
 * en ont été enregistrées avant cette règle : elles restent en base, ignorées.
 */
export function learnedDurations(db: Db): { input: DurationInput; corrections: Map<string, Correction>; sessions: string[] } {
  const recent = db
    .select({ id: cookSessions.id })
    .from(cookSessions)
    .where(and(eq(cookSessions.status, "done"), eq(cookSessions.test, false)))
    .orderBy(desc(cookSessions.endedAt))
    .limit(WINDOW * 3)
    .all();
  const done: string[] = [];
  for (const { id } of recent) {
    if (done.length >= WINDOW) break;
    const plan = db.select({ plan: cookSessions.planJson }).from(cookSessions).where(eq(cookSessions.id, id)).get()?.plan as SessionPlan | null;
    if (plan?.steps && cookedEnough(plan, eventsAfter(db, id, 0))) done.push(id);
  }
  if (!done.length) return { input: { factors: {}, sessions: 0 }, corrections: new Map(), sessions: [] };
  let rows = db.select().from(durationSamples).where(inArray(durationSamples.sessionId, done)).all();
  const measured = new Set(rows.map((r) => r.sessionId));
  const missing = done.filter((id) => !measured.has(id));
  if (missing.length) {
    for (const id of missing) {
      try {
        recordDurations(db, id);
      } catch (e) {
        console.error("[durées] mesure de la session", id, e);
      }
    }
    rows = db.select().from(durationSamples).where(inArray(durationSamples.sessionId, done)).all();
  }
  const samples: StoredSample[] = rows.map((r) => ({ ...r, kind: r.kind, grams: r.grams ?? null, units: r.units ?? null, via: r.via ?? null }));
  const corrections = learn(samples);
  return { input: plannerInput(corrections, done.length), corrections, sessions: done };
}
