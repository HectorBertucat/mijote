// La réserve vue par la base : la marmite pesée en fin de session (groupes, portions de chacun, boîtes
// du congélo), les portions mangées (avec leur ligne du journal), l'annulation, le réajustement, et
// les anciennes boîtes reprises dans une réserve. Le calcul est dans ./core et ./groups (purs, testés).
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, mealBoxes, mealSlots, people, recipeIngredients, recipes, reserves, reserveServings, weekPlans } from "@/lib/db/schema";
import { DEFAULT_FRIDGE_DAYS, daysBetween, freshness, limitOf, mealAt, type Place } from "@/lib/boxes/core";
import { portionUnits } from "@/lib/eaters/core";
import { loadEaters } from "@/lib/eaters/store";
import { addEntry, deleteEntry, type LogMeal } from "@/lib/health/log";
import { todayParis } from "@/lib/health/store";
import { computeNutrition } from "@/lib/nutrition/compute";
import { loadPlannerRecipes } from "@/lib/session/store";
import type { SessionPlan } from "@/lib/session/planner";
import { defaultPeriod } from "@/lib/week/period";
import { addDays, mondayOf } from "@/lib/week/propose";
import { periodPlans } from "@/lib/week/store";
import { leftInPot, macrosOf, reserveState, reweigh, servingLabel, splitGroups, weighedGroups, type BoxIn, type CalcModel, type Grams, type ReserveGroup, type ServingIn, type ShareState, type Target } from "./core";
import { serveGroups, type ServeDecl } from "./groups";

type ReserveRow = typeof reserves.$inferSelect;
type BoxRow = typeof mealBoxes.$inferSelect;

/** Ce qu'il faut pour viser la portion de chacun, d'après les kcal d'une unité de la marmite. */
export function targetsOf(db: Db, macros: { kcalUnit: number | null; proteinUnit: number | null }, now = new Date()): Target[] {
  return loadEaters(db, now).map((e) => {
    const units = portionUnits(e, macros);
    return {
      id: e.id,
      name: e.name,
      units,
      kcal: macros.kcalUnit != null && macros.kcalUnit > 0 ? units * macros.kcalUnit : null,
      kcalMax: e.ref?.kcalMax ?? null,
      protein: e.ref ? (e.ref.proteinMin + e.ref.proteinMax) / 2 : null,
      proteinMin: e.ref?.proteinMin ?? null,
    };
  });
}

/** La marmite d'une recette, prête à peser : groupes et macros (× multiplicateur), foyer, repas prévus. */
export function calcModel(db: Db, slug: string, opts: { scale?: number; cookedOn?: string; week?: boolean } = {}, now = new Date()): CalcModel | null {
  const r = db.select().from(recipes).where(eq(recipes.slug, slug)).get();
  if (!r) return null;
  const scale = opts.scale ?? 1;
  const cookedOn = opts.cookedOn ?? todayParis(now);
  const planner = loadPlannerRecipes(db, [slug], { [slug]: scale })[0];
  const groups = serveGroups(planner, r.serveJson as ServeDecl[] | null);
  const ings = db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id)).orderBy(asc(recipeIngredients.position)).all();
  const nut = (idx: number[]) => computeNutrition(idx.map((n) => ings[n]).map((i) => ({ item: i.item, food: i.foodId, grams: i.grams, units: i.units, yield: i.yield })), 1);
  // Comme la fiche : sans 80 % des ingrédients connus, pas de kcal pour le partage.
  const known = nut(ings.map((i, n) => (i.optional ? -1 : n)).filter((n) => n >= 0)).coverage >= 0.8;
  const cookedUnits = r.servingsUnits * scale;
  const modelGroups = groups.map((g) => {
    const t = nut(g.items).total;
    return { key: g.key, label: g.label, kind: g.kind, kcal: known ? t.kcal * scale : null, protein: known ? t.protein * scale : null, estG: g.estG };
  });
  const kcal = known ? modelGroups.reduce((s, g) => s + g.kcal!, 0) : null;
  const protein = known ? modelGroups.reduce((s, g) => s + g.protein!, 0) : null;
  const macros = { kcalUnit: kcal != null ? kcal / cookedUnits : null, proteinUnit: protein != null ? protein / cookedUnits : null };
  const fridgeDays = r.fridgeDays ?? DEFAULT_FRIDGE_DAYS;
  const planned = opts.week ? plannedSlots(db, r.id, cookedOn) : new Map<string, { date: string }[]>();
  return {
    recipeId: r.id,
    slug: r.slug,
    name: r.name,
    cookedUnits,
    ...macros,
    fridgeDays,
    freezerOk: r.freezerOk,
    cookedOn,
    groups: modelGroups,
    people: targetsOf(db, macros, now).map((t) => {
      const slots = planned.get(t.id) ?? [];
      return { ...t, planned: slots.length, late: slots.filter((s) => daysBetween(cookedOn, s.date) > fridgeDays).length };
    }),
  };
}

/** Repas prévus par la Semaine avec cette recette, du jour de la cuisson aux deux semaines suivantes. */
export function plannedSlots(db: Db, recipeId: string, cookedOn: string): Map<string, { date: string; meal: "lunch" | "dinner" }[]> {
  const monday = mondayOf(new Date(`${cookedOn}T12:00:00Z`));
  const weeks = [monday, addDays(monday, 7)];
  const rows = db
    .select({ weekStart: weekPlans.weekStart, day: mealSlots.day, meal: mealSlots.meal, personId: mealSlots.personId })
    .from(mealSlots)
    .innerJoin(weekPlans, eq(weekPlans.id, mealSlots.weekPlanId))
    .where(and(eq(mealSlots.recipeId, recipeId), ne(mealSlots.place, "away"), inArray(weekPlans.weekStart, weeks)))
    .all();
  const out = new Map<string, { date: string; meal: "lunch" | "dinner" }[]>();
  for (const r of rows) {
    const date = addDays(r.weekStart, r.day);
    const d = daysBetween(cookedOn, date);
    if (d < 0 || d >= 14) continue;
    out.set(r.personId, [...(out.get(r.personId) ?? []), { date, meal: r.meal }]);
  }
  return out;
}

const cookedOnOf = (s: { endedAt: string | null; startedAt: string | null }) => todayParis(new Date(s.endedAt ?? s.startedAt ?? Date.now()));

/** Une réserve rangée, telle que le calculateur la rouvre. */
export interface SavedReserve {
  id: string;
  groups: ReserveGroup[];
  /** Portions restantes de chacun. */
  counts: Record<string, number>;
  /** Boîtes du congélo de chacun, encore en stock. */
  freezer: Record<string, number>;
  /** Grammes restants dans le grand récipient. */
  left: Grams;
  eaten: number;
}

/** Fin de session : les marmites à peser, et les réserves déjà rangées. */
export function sessionReserves(db: Db, sessionId: string, now = new Date()): { models: CalcModel[]; saved: Record<string, SavedReserve> } | null {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).get();
  if (!s?.planJson) return null;
  const plan = s.planJson as SessionPlan;
  const cookedOn = cookedOnOf(s);
  const models = plan.recipes.map((r) => calcModel(db, r.slug, { scale: r.scale, cookedOn, week: true }, now)).filter((m): m is CalcModel => m != null);
  const saved: Record<string, SavedReserve> = {};
  for (const row of db.select().from(reserves).where(eq(reserves.sessionId, sessionId)).all()) {
    if (!row.recipeId) continue;
    const { servings, boxes } = loadParts(db, [row.id]);
    const mine = boxes.filter((b) => b.reserveId === row.id);
    const freezer: Record<string, number> = {};
    for (const b of mine) if (b.status === "stock" && b.place === "freezer" && b.personId) freezer[b.personId] = (freezer[b.personId] ?? 0) + 1;
    const served = servings.filter((x) => x.reserveId === row.id);
    const left = Object.fromEntries(Object.entries(row.counts).map(([id, n]) => [id, Math.max(0, n - served.filter((x) => x.personId === id).length)]));
    saved[row.recipeId] = { id: row.id, groups: row.groups, counts: left, freezer, left: leftInPot(row.groups, servings.filter((x) => x.reserveId === row.id).map(servingIn), mine.map(boxIn)), eaten: servings.filter((x) => x.reserveId === row.id).length };
  }
  return { models, saved };
}

const checkGrams = (w: Record<string, number | null | undefined>, max: number) => {
  for (const v of Object.values(w)) if (v != null && !(Number.isFinite(v) && v >= 0 && v <= max)) throw new Error(`Poids entre 0 et ${max / 1000} kg.`);
};
const checkCounts = (c: Record<string, number>) => {
  for (const v of Object.values(c)) if (!(Number.isInteger(v) && v >= 0 && v <= 30)) throw new Error("Entre 0 et 30 portions.");
};

/**
 * Range la marmite d'une recette de la session : ses groupes pesés, les portions de chacun, et les
 * boîtes du congélo (`freezer` : combien par personne). Ranger à nouveau refait la pesée et les
 * boîtes encore en stock ; les portions déjà mangées restent. Le partage est refait ici.
 */
export function saveReserve(db: Db, sessionId: string, recipeId: string, input: { weights: Record<string, number | null>; counts: Record<string, number>; freezer?: Record<string, number> }, now = new Date()): { reserveId: string; boxes: number } {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).get();
  if (!s?.planJson) throw new Error("Session introuvable.");
  if (s.test) throw new Error("Une session test ne range rien.");
  const r = db.select().from(recipes).where(eq(recipes.id, recipeId)).get();
  const inPlan = r && (s.planJson as SessionPlan).recipes.find((x) => x.slug === r.slug);
  if (!r || !inPlan) throw new Error("Cette recette n'est pas dans la session.");
  checkGrams(input.weights, 50_000);
  checkCounts(input.counts);
  checkCounts(input.freezer ?? {});
  const cookedOn = cookedOnOf(s);
  const model = calcModel(db, r.slug, { scale: inPlan.scale, cookedOn, week: true }, now)!;
  const at = now.toISOString();
  const ids = new Set(model.people.map((p) => p.id));
  // `counts` : les portions restantes de chacun ; le total y ajoute celles déjà mangées.
  const counts = Object.fromEntries(Object.entries(input.counts).filter(([id]) => ids.has(id)));
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const existing = t.select().from(reserves).where(and(eq(reserves.sessionId, sessionId), eq(reserves.recipeId, recipeId))).get();
    const reserveId = existing?.id ?? randomUUID();
    const eaten = existing ? t.select().from(reserveServings).where(eq(reserveServings.reserveId, reserveId)).all() : [];
    for (const e of eaten) counts[e.personId] = (counts[e.personId] ?? 0) + 1;
    // Rien de mangé : la pesée de la marmite entière. Sinon, une nouvelle pesée de ce qui reste (kcal restantes gardées).
    let groups = weighedGroups(model, input.weights, at);
    if (existing && eaten.length) {
      const left = leftInPot(existing.groups, eaten.map(servingIn), []);
      groups = existing.groups.map((g) => (input.weights[g.key] != null && input.weights[g.key]! > 0 ? reweigh(g, left[g.key] ?? 0, input.weights[g.key]!, at) : g));
    }
    const fields = { name: r.name, cookedOn, fridgeDays: model.fridgeDays, freezerOk: model.freezerOk, cookedUnits: model.cookedUnits, kcalUnit: model.kcalUnit, proteinUnit: model.proteinUnit, groups, counts, status: "open" as const, closedAt: null, updatedAt: at };
    if (existing) t.update(reserves).set(fields).where(eq(reserves.id, reserveId)).run();
    else t.insert(reserves).values({ id: reserveId, sessionId, recipeId, ...fields }).run();
    // Les boîtes du congélo : refaites (celles déjà mangées restent).
    t.delete(mealBoxes).where(and(eq(mealBoxes.reserveId, reserveId), eq(mealBoxes.status, "stock"))).run();
    // Une portion de chacun, sur la marmite entière (les portions restantes de chacun : total − mangées).
    const left = Object.fromEntries(model.people.map((p) => [p.id, Math.max(0, (counts[p.id] ?? 0) - eaten.filter((e) => e.personId === p.id).length)]));
    const split = splitGroups(groups, Object.fromEntries(groups.map((g) => [g.key, g.g])), model.people, left);
    let n = 0;
    for (const p of model.people) {
      const k = Math.min(left[p.id] ?? 0, (input.freezer ?? {})[p.id] ?? 0);
      const portion = split.portions[p.id];
      if (!portion || !model.freezerOk) continue;
      for (let i = 0; i < k; i++, n++) insertBox(t, { reserveId, sessionId, recipeId, name: r.name, personId: p.id, groups, grams: portion.grams, cookedOn, fridgeDays: model.fridgeDays, place: "freezer", at });
    }
    return { reserveId, boxes: n };
  });
}

/** Une boîte de la réserve (les colonnes d'avant gardent plat et garniture, pour l'affichage d'avant). */
function insertBox(db: Db, b: { reserveId: string; sessionId: string | null; recipeId: string | null; name: string; personId: string | null; groups: ReserveGroup[]; grams: Grams; cookedOn: string; fridgeDays: number; place: Place; at: string }) {
  const m = macrosOf(b.groups, b.grams);
  const starch = b.groups.filter((g) => g.kind === "starch");
  const of = (gs: ReserveGroup[]) => gs.reduce((s, g) => s + (b.grams[g.key] ?? 0), 0);
  db.insert(mealBoxes)
    .values({
      id: randomUUID(),
      sessionId: b.sessionId,
      recipeId: b.recipeId,
      reserveId: b.reserveId,
      name: b.name,
      personId: b.personId,
      grams: of(b.groups.filter((g) => g.kind !== "starch")),
      sideGrams: starch.length ? of(starch) : null,
      sideLabel: starch.length ? starch.map((g) => g.label).join(" et ") : null,
      portion: b.grams,
      kcal: m.kcal,
      proteinG: m.protein,
      cookedOn: b.cookedOn,
      place: b.place,
      fridgeDays: b.fridgeDays,
      frozenOn: b.place === "freezer" ? b.cookedOn : null,
      createdAt: b.at,
    })
    .run();
}

// ─── Lecture ───

const servingIn = (s: typeof reserveServings.$inferSelect): ServingIn => ({ id: s.id, personId: s.personId, at: s.at, source: s.source, boxId: s.boxId, grams: s.grams });

/** Les grammes par groupe d'une boîte : ceux de la réserve, sinon plat et garniture des boîtes d'avant. */
function boxGrams(b: BoxRow, groups: ReserveGroup[]): Grams {
  if (b.portion) return b.portion;
  const main = groups.find((g) => g.kind === "main") ?? groups[0];
  const side = groups.find((g) => g.kind === "starch");
  const out: Grams = {};
  if (main && b.grams != null) out[main.key] = b.grams;
  if (side && b.sideGrams != null) out[side.key] = b.sideGrams;
  return out;
}

const boxIn = (b: BoxRow & { groupsOf?: ReserveGroup[] }): BoxIn => ({
  id: b.id,
  personId: b.personId,
  status: b.status,
  place: b.place,
  thawed: b.thawedOn != null,
  limit: limitOf(b),
  createdAt: b.createdAt,
  grams: b.portion ?? {},
});

function loadParts(db: Db, ids: string[]) {
  if (!ids.length) return { servings: [], boxes: [] };
  return {
    servings: db.select().from(reserveServings).where(inArray(reserveServings.reserveId, ids)).orderBy(asc(reserveServings.at)).all(),
    boxes: db.select().from(mealBoxes).where(inArray(mealBoxes.reserveId, ids)).all(),
  };
}

export interface GramLine {
  key: string;
  label: string;
  g: number;
}

export interface DishBoxView {
  id: string;
  personId: string | null;
  place: Place;
  thawed: boolean;
  limit: string;
  freshness: "ok" | "soon" | "past";
  grams: GramLine[];
  kcal: number | null;
  protein: number | null;
}

export interface ShareView {
  personId: string;
  name: string;
  total: number;
  eaten: number;
  left: number;
  inBoxes: number;
  portion: { grams: GramLine[]; kcal: number | null; protein: number | null } | null;
  next: { source: "recipient" | "boite"; boxId?: string; grams: GramLine[]; kcal: number | null; protein: number | null } | null;
}

export interface DishView {
  id: string;
  recipeId: string | null;
  slug: string | null;
  name: string;
  status: "cooked" | "planned";
  cookedOn: string | null;
  limit: string | null;
  freshness: "ok" | "soon" | "past" | null;
  groups: { key: string; label: string; kind: ReserveGroup["kind"]; leftG: number | null; estimated: boolean }[];
  people: ShareView[];
  rest: { grams: GramLine[]; kcal: number | null } | null;
  boxes: DishBoxView[];
  /** Le récipient ne couvre pas les portions visées (fill < 0,97). */
  short: boolean;
}

export interface ServingView {
  id: string;
  dishId: string;
  name: string;
  slug: string | null;
  personId: string;
  date: string;
  meal: LogMeal;
  at: string;
  source: "recipient" | "boite";
  boxId: string | null;
  grams: GramLine[];
  kcal: number;
  protein: number;
  entryId: string | null;
}

const lines = (groups: Pick<ReserveGroup, "key" | "label">[], grams: Grams): GramLine[] => groups.filter((g) => (grams[g.key] ?? 0) > 0).map((g) => ({ key: g.key, label: g.label, g: Math.round(grams[g.key]) }));

function shareView(groups: ReserveGroup[], s: ShareState): ShareView {
  return {
    personId: s.personId,
    name: s.name,
    total: s.total,
    eaten: s.eaten,
    left: s.left,
    inBoxes: s.inBoxes,
    portion: s.portion ? { grams: lines(groups, s.portion.grams), kcal: s.portion.kcal, protein: s.portion.protein } : null,
    next: s.next ? { source: s.next.source, ...(s.next.source === "boite" ? { boxId: s.next.boxId } : {}), grams: lines(groups, s.next.grams), kcal: s.next.kcal, protein: s.next.protein } : null,
  };
}

/** L'état d'une réserve, calculé sur ses portions mangées et ses boîtes. */
function stateOf(db: Db, row: ReserveRow, parts: ReturnType<typeof loadParts>, now: Date) {
  const servings = parts.servings.filter((s) => s.reserveId === row.id);
  const boxes = parts.boxes.filter((b) => b.reserveId === row.id);
  const targets = targetsOf(db, { kcalUnit: row.kcalUnit, proteinUnit: row.proteinUnit }, now);
  const bx = boxes.map((b) => ({ ...boxIn(b), grams: boxGrams(b, row.groups) }));
  return { servings, boxes, bx, state: reserveState(row.groups, row.counts, targets, servings.map(servingIn), bx) };
}

/** Le plat d'une réserve, tel que l'affichent le site et l'app : la personne `me` d'abord. */
function dishView(db: Db, row: ReserveRow, parts: ReturnType<typeof loadParts>, me: string | null, today: string, now: Date): DishView & { empty: boolean } {
  const { bx, state } = stateOf(db, row, parts, now);
  const slug = row.recipeId ? (db.select({ slug: recipes.slug }).from(recipes).where(eq(recipes.id, row.recipeId)).get()?.slug ?? null) : null;
  const anyLeft = Object.values(state.left).some((g) => g > 0);
  const limit = anyLeft ? limitOf({ place: "fridge", cookedOn: row.cookedOn, fridgeDays: row.fridgeDays, frozenOn: null, thawedOn: null }) : null;
  const shares = [...state.shares].sort((a, b) => Number(b.personId === me) - Number(a.personId === me));
  return {
    id: row.id,
    recipeId: row.recipeId,
    slug,
    name: row.name,
    status: "cooked",
    cookedOn: row.cookedOn,
    limit,
    freshness: limit ? freshness(limit, today) : null,
    groups: row.groups.map((g) => ({ key: g.key, label: g.label, kind: g.kind, leftG: Math.round(state.left[g.key] ?? 0), estimated: !!g.estimated })),
    people: shares.map((s) => shareView(row.groups, s)),
    rest: state.rest ? { grams: lines(row.groups, state.rest.grams), kcal: state.rest.kcal } : null,
    boxes: bx
      .filter((b) => b.status === "stock")
      .sort((a, b) => a.limit.localeCompare(b.limit))
      .map((b) => ({ id: b.id, personId: b.personId, place: b.place, thawed: b.thawed, limit: b.limit, freshness: freshness(b.limit, today), grams: lines(row.groups, b.grams), ...macrosOf(row.groups, b.grams) })),
    short: state.fill < 0.97,
    empty: state.empty,
  };
}

/** Les plats de la période pas encore cuisinés : les portions prévues de chacun, sans grammes. */
function plannedDishes(db: Db, cooked: Set<string>, me: string | null, now: Date): DishView[] {
  const period = defaultPeriod(periodPlans(db), now);
  const plan = db.select().from(weekPlans).where(eq(weekPlans.weekStart, period.start)).get();
  if (!plan) return [];
  const rows = db
    .select({ recipeId: mealSlots.recipeId, personId: mealSlots.personId, name: recipes.name, slug: recipes.slug })
    .from(mealSlots)
    .innerJoin(recipes, eq(recipes.id, mealSlots.recipeId))
    .where(and(eq(mealSlots.weekPlanId, plan.id), ne(mealSlots.place, "away")))
    .all();
  const names = new Map(db.select({ id: people.id, name: people.name, rank: people.rank }).from(people).orderBy(asc(people.rank)).all().map((p) => [p.id, p.name]));
  const byRecipe = new Map<string, { name: string; slug: string; counts: Map<string, number> }>();
  for (const r of rows) {
    if (!r.recipeId || cooked.has(r.recipeId)) continue;
    const d = byRecipe.get(r.recipeId) ?? { name: r.name, slug: r.slug, counts: new Map() };
    d.counts.set(r.personId, (d.counts.get(r.personId) ?? 0) + 1);
    byRecipe.set(r.recipeId, d);
  }
  return [...byRecipe.entries()].map(([recipeId, d]) => ({
    id: `prevu:${recipeId}`,
    recipeId,
    slug: d.slug,
    name: d.name,
    status: "planned" as const,
    cookedOn: null,
    limit: null,
    freshness: null,
    groups: [],
    people: [...names.keys()]
      .filter((id) => d.counts.has(id))
      .sort((a, b) => Number(b === me) - Number(a === me))
      .map((id) => ({ personId: id, name: names.get(id)!, total: d.counts.get(id)!, eaten: 0, left: d.counts.get(id)!, inBoxes: 0, portion: null, next: null })),
    rest: null,
    boxes: [],
    short: false,
  }));
}

/**
 * Les plats : les réserves ouvertes (le plus pressé d'abord), puis ceux de la période pas encore
 * cuisinés. Une réserve vide se ferme d'elle-même.
 */
export function listDishes(db: Db, me: string | null, now = new Date()): DishView[] {
  adoptLegacyBoxes(db);
  const today = todayParis(now);
  const rows = db.select().from(reserves).where(eq(reserves.status, "open")).all();
  const parts = loadParts(db, rows.map((r) => r.id));
  const out: DishView[] = [];
  for (const row of rows) {
    const { empty, ...v } = dishView(db, row, parts, me, today, now);
    if (empty) {
      db.update(reserves).set({ status: "closed", closedAt: now.toISOString() }).where(eq(reserves.id, row.id)).run();
      continue;
    }
    out.push(v);
  }
  const limitOfDish = (d: DishView) => [d.limit, ...d.boxes.filter((b) => b.place === "fridge").map((b) => b.limit)].filter((x): x is string => !!x).sort()[0] ?? "9";
  out.sort((a, b) => limitOfDish(a).localeCompare(limitOfDish(b)) || a.name.localeCompare(b.name, "fr"));
  // Une recette en réserve cuisinée depuis le début de la période n'est plus « à cuisiner ».
  const since = addDays(defaultPeriod(periodPlans(db), now).start, -3);
  const cooked = new Set(rows.filter((r) => r.recipeId && r.cookedOn >= since).map((r) => r.recipeId!));
  return [...out, ...plannedDishes(db, cooked, me, now)];
}

/** Les portions mangées par la personne depuis `days` jours, la plus récente d'abord. */
export function recentServings(db: Db, personId: string, now = new Date(), days = 3): ServingView[] {
  const from = addDays(todayParis(now), -(days - 1));
  return db
    .select({ s: reserveServings, r: reserves, slug: recipes.slug })
    .from(reserveServings)
    .innerJoin(reserves, eq(reserves.id, reserveServings.reserveId))
    .leftJoin(recipes, eq(recipes.id, reserves.recipeId))
    .where(and(eq(reserveServings.personId, personId), gte(reserveServings.date, from)))
    .orderBy(desc(reserveServings.at))
    .all()
    .map(({ s, r, slug }) => ({ id: s.id, dishId: r.id, name: r.name, slug, personId: s.personId, date: s.date, meal: s.meal, at: s.at, source: s.source, boxId: s.boxId, grams: lines(r.groups, s.grams), kcal: Math.round(s.kcal), protein: Math.round(s.proteinG), entryId: s.foodLogId }));
}

// ─── Gestes ───

const parisHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(d));

export class ReserveError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

/**
 * « J'ai mangé une portion » : la portion de la personne (le grand récipient, sinon sa boîte), une
 * boîte précise (`boxId`), ou ce qu'elle a vraiment pris (`grams`). Une ligne au journal (kcal et
 * protéines de la portion) ; une personne sans portion restante en a une de plus.
 */
export function eatPortion(db: Db, reserveId: string, personId: string, opts: { boxId?: string | null; grams?: Grams | null; date?: string; meal?: LogMeal } = {}, now = new Date()): ServingView {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const row = t.select().from(reserves).where(eq(reserves.id, reserveId)).get();
    if (!row || row.status !== "open") throw new ReserveError("Ce plat n'est plus en réserve.", 404);
    const parts = loadParts(t, [row.id]);
    const { state, bx } = stateOf(t, row, parts, now);
    const share = state.shares.find((s) => s.personId === personId);
    if (!share) throw new ReserveError("Personne inconnue.", 404);
    let grams: Grams;
    let box: BoxIn | undefined;
    if (opts.boxId) {
      box = bx.find((b) => b.id === opts.boxId && b.status === "stock");
      if (!box) throw new ReserveError("Cette boîte n'est plus là.", 404);
      grams = box.grams;
    } else if (opts.grams) {
      checkGrams(opts.grams, 3000);
      grams = Object.fromEntries(row.groups.map((g) => [g.key, Math.round(opts.grams![g.key] ?? 0)]));
      if (!Object.values(grams).some((g) => g > 0)) throw new ReserveError("Rien de pris.", 400);
    } else if (share.next) {
      if (share.next.source === "boite") box = bx.find((b) => b.id === (share.next as { boxId: string }).boxId);
      grams = share.next.grams;
    } else {
      // Plus de portion pour elle : une portion à sa mesure, prise sur ce qui reste.
      const targets = targetsOf(t, { kcalUnit: row.kcalUnit, proteinUnit: row.proteinUnit }, now);
      const loose = Object.fromEntries(state.shares.map((s) => [s.personId, s.personId === personId ? 1 : s.left - s.inBoxes]));
      const split = splitGroups(row.groups, state.left, targets.filter((p) => (loose[p.id] ?? 0) > 0), loose);
      const mine = split.portions[personId];
      if (!mine || !Object.values(mine.grams).some((g) => g > 0)) throw new ReserveError("Il ne reste plus rien de ce plat.", 409);
      grams = mine.grams;
    }
    // Une boîte garde les kcal figées à son rangement.
    const m = macrosOf(row.groups, grams);
    const boxRow = box ? parts.boxes.find((b) => b.id === box!.id) : undefined;
    const kcal = boxRow?.kcal ?? m.kcal;
    const protein = boxRow?.proteinG ?? m.protein;
    const date = opts.date ?? todayParis(now);
    const meal = opts.meal ?? mealAt(parisHour(now));
    const entry = addEntry(t, { personId, date, meal, kind: "recipe", recipeId: row.recipeId, label: servingLabel(row.name, row.groups, grams), kcal: kcal ?? 0, proteinG: protein ?? 0, source: "manual" });
    const id = randomUUID();
    t.insert(reserveServings).values({ id, reserveId: row.id, personId, at: now.toISOString(), date, meal, source: box ? "boite" : "recipient", boxId: box?.id ?? null, grams, kcal: kcal ?? 0, proteinG: protein ?? 0, foodLogId: entry.id }).run();
    if (box) t.update(mealBoxes).set({ status: "eaten", closedAt: now.toISOString(), eatenBy: personId, foodLogId: entry.id }).where(eq(mealBoxes.id, box.id)).run();
    // Une portion de plus que prévu : son total suit (les autres portions rapetissent).
    if (share.left <= 0) t.update(reserves).set({ counts: { ...row.counts, [personId]: share.eaten + 1 }, updatedAt: now.toISOString() }).where(eq(reserves.id, row.id)).run();
    return recentServings(t, personId, now, 400).find((s) => s.id === id)!;
  });
}

/** Annule une portion mangée : sa ligne du journal part, ses grammes (ou sa boîte) reviennent. */
export function undoServing(db: Db, servingId: string, personId?: string): { name: string } {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const s = t.select().from(reserveServings).where(eq(reserveServings.id, servingId)).get();
    if (!s || (personId && s.personId !== personId)) throw new ReserveError("Portion introuvable.", 404);
    const r = t.select().from(reserves).where(eq(reserves.id, s.reserveId)).get();
    if (s.foodLogId) deleteEntry(t, s.foodLogId);
    t.delete(reserveServings).where(eq(reserveServings.id, servingId)).run();
    if (s.boxId) t.update(mealBoxes).set({ status: "stock", closedAt: null, eatenBy: null, foodLogId: null }).where(eq(mealBoxes.id, s.boxId)).run();
    if (r?.status === "closed") t.update(reserves).set({ status: "open", closedAt: null }).where(eq(reserves.id, r.id)).run();
    return { name: r?.name ?? "Plat" };
  });
}

/**
 * Réajuster après coup : une nouvelle pesée de ce qui reste dans le grand récipient (`weights`, par
 * groupe) et les portions restantes voulues pour chacun (`left`).
 */
export function adjustReserve(db: Db, reserveId: string, input: { weights?: Record<string, number | null>; left?: Record<string, number> }, now = new Date()) {
  checkGrams(input.weights ?? {}, 50_000);
  checkCounts(input.left ?? {});
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const row = t.select().from(reserves).where(eq(reserves.id, reserveId)).get();
    if (!row) throw new ReserveError("Ce plat n'est plus en réserve.", 404);
    const parts = loadParts(t, [row.id]);
    const { state } = stateOf(t, row, parts, now);
    const at = now.toISOString();
    const groups = row.groups.map((g) => {
      const w = input.weights?.[g.key];
      return w != null ? reweigh(g, state.left[g.key] ?? 0, w, at) : g;
    });
    const counts = { ...row.counts };
    for (const [id, n] of Object.entries(input.left ?? {})) {
      const s = state.shares.find((x) => x.personId === id);
      if (!s) throw new ReserveError("Personne inconnue.", 404);
      counts[id] = s.eaten + n;
    }
    t.update(reserves).set({ groups, counts, status: "open", closedAt: null, updatedAt: at }).where(eq(reserves.id, row.id)).run();
  });
}

/** « C'est fini » : la réserve sort de la liste (ce qui reste est jeté ou mangé hors compte). */
export function closeReserve(db: Db, reserveId: string, now = new Date()) {
  db.update(reserves).set({ status: "closed", closedAt: now.toISOString() }).where(eq(reserves.id, reserveId)).run();
}

// ─── Les boîtes d'avant ───

/**
 * Les boîtes rangées avant la réserve deviennent des portions : une réserve par marmite (session,
 * recette, jour de cuisson), le grand récipient vide (tout est en boîtes), un groupe « plat » et un
 * groupe pour la garniture, chacun pour ses boîtes. Idempotent.
 */
export function adoptLegacyBoxes(db: Db) {
  const loose = db.select().from(mealBoxes).where(and(isNull(mealBoxes.reserveId), eq(mealBoxes.status, "stock"))).all();
  if (!loose.length) return 0;
  const byPot = new Map<string, BoxRow[]>();
  for (const b of loose) {
    const k = [b.sessionId ?? "", b.recipeId ?? b.name, b.cookedOn].join("|");
    byPot.set(k, [...(byPot.get(k) ?? []), b]);
  }
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    for (const boxes of byPot.values()) {
      const b0 = boxes[0];
      const r = b0.recipeId ? t.select().from(recipes).where(eq(recipes.id, b0.recipeId)).get() : undefined;
      const dishG = boxes.reduce((s, b) => s + (b.grams ?? 0), 0);
      const sideG = boxes.reduce((s, b) => s + (b.sideGrams ?? 0), 0);
      const kcal = boxes.reduce((s, b) => s + (b.kcal ?? 0), 0);
      const protein = boxes.reduce((s, b) => s + (b.proteinG ?? 0), 0);
      const known = boxes.every((b) => b.kcal != null);
      // kcal par gramme : la même densité pour plat et garniture faute de mieux (le récipient est vide).
      const grams = dishG + sideG;
      const at = b0.createdAt;
      const dens = (x: number) => (known && grams > 0 ? x / grams : null);
      const groups: ReserveGroup[] = [{ key: "plat", label: "plat", kind: "main", g: 0, at, kcalG: dens(kcal), proteinG: dens(protein) }];
      if (sideG > 0) groups.push({ key: "garniture", label: b0.sideLabel ?? "garniture", kind: "starch", g: 0, at, kcalG: dens(kcal), proteinG: dens(protein) });
      const counts: Record<string, number> = {};
      for (const b of boxes) if (b.personId) counts[b.personId] = (counts[b.personId] ?? 0) + 1;
      const id = randomUUID();
      t.insert(reserves)
        .values({ id, sessionId: b0.sessionId, recipeId: b0.recipeId, name: b0.name, cookedOn: b0.cookedOn, fridgeDays: b0.fridgeDays, freezerOk: r?.freezerOk ?? true, cookedUnits: null, kcalUnit: r?.kcalUnit ?? null, proteinUnit: r?.proteinUnit ?? null, groups, counts, createdAt: at, updatedAt: at })
        .run();
      for (const b of boxes) {
        const portion: Grams = {};
        if (b.grams != null) portion.plat = b.grams;
        if (b.sideGrams != null && sideG > 0) portion.garniture = b.sideGrams;
        t.update(mealBoxes).set({ reserveId: id, portion }).where(eq(mealBoxes.id, b.id)).run();
      }
    }
  });
  return byPot.size;
}

/** Le journal d'une portion : pour savoir si une ligne vient d'une portion (annulable). */
export const servingOfEntry = (db: Db, entryId: string) => db.select().from(reserveServings).where(eq(reserveServings.foodLogId, entryId)).get() ?? null;
