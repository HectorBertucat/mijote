// Les bases du foyer vues par la base : les gros récipients de riz, de haricots verts… (table
// base_stocks), remplis par les plats d'une session ou par « Refaire », vidés par les portions des plats
// qui les prennent ; ce qu'il faut pour en refaire, ce qui est à congeler. Le calcul est dans ./bases (pur).
import { randomUUID } from "crypto";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { baseStocks, mealBoxes, recipeIngredients, reserves, reserveServings } from "@/lib/db/schema";
import { daysBetween, freshness, gramsLabel } from "@/lib/boxes/core";
import { addDays } from "@/lib/week/propose";
import { listLots } from "@/lib/costs/pantry";
import { todayParis } from "@/lib/health/store";
import { loadKitchen } from "@/lib/kitchen/store";
import { kitchenEquipment } from "@/lib/kitchen/presets";
import { vesselLiters } from "@/lib/session/capacity";
import {
  BASE_FAMILIES,
  baseFamily,
  boxesFor,
  DEFAULT_BASE_PORTION_G,
  dishFreezeNote,
  eatableWithoutPlan,
  freezeBase,
  freezeDish,
  isLow,
  remakePlan,
  remakeTarget,
  stockLevels,
  type BaseFamily,
  type BigBoxes,
  type RemakePlan,
  type StockIn,
  type TakeIn,
} from "./bases";
import { CRUMBS_G, type ReserveGroup } from "./core";
import { plannedSlots, ReserveError, type DishView } from "./store";

type StockRow = typeof baseStocks.$inferSelect;

/** Les stocks se lisent sur 40 jours : au-delà, un récipient est fini depuis longtemps. */
const WINDOW_DAYS = 40;

/**
 * Met les bases d'une marmite dans le récipient de leur session : sa part (`parts[reserveId]`) ; ce qui
 * reste suit la somme des parts tant que le récipient n'a pas été pesé à part.
 */
export function syncBases(db: Db, reserve: { id: string; sessionId: string | null; cookedOn: string }, groups: ReserveGroup[], at: string) {
  for (const g of groups) {
    if (!g.base) continue;
    const f = baseFamily(g.base);
    if (!f) continue;
    const same = and(eq(baseStocks.family, f.key), reserve.sessionId ? eq(baseStocks.sessionId, reserve.sessionId) : eq(baseStocks.cookedOn, reserve.cookedOn));
    const row = db.select().from(baseStocks).where(same).get();
    const parts = { ...(row?.parts ?? {}), [reserve.id]: { g: Math.round(g.g), estimated: !!g.estimated } };
    const cookedG = Object.values(parts).reduce((s, p) => s + p.g, 0);
    const estimated = Object.values(parts).some((p) => p.estimated);
    if (!row) {
      db.insert(baseStocks).values({ id: randomUUID(), family: f.key, label: f.label, sessionId: reserve.sessionId, cookedOn: reserve.cookedOn, fridgeDays: f.fridgeDays, cookedG, g: cookedG, at, estimated, parts, createdAt: at, updatedAt: at }).run();
    } else {
      db.update(baseStocks)
        .set({ parts, cookedG, ...(row.weighed ? {} : { g: cookedG, estimated }), updatedAt: at })
        .where(eq(baseStocks.id, row.id))
        .run();
    }
  }
}

/** Les récipients lus (ouverts, et finis depuis peu : ils ont servi les portions d'avant) et ce qui en est sorti. */
function loadStocks(db: Db, now: Date) {
  const since = addDays(todayParis(now), -WINDOW_DAYS);
  const rows = db.select().from(baseStocks).where(or(eq(baseStocks.status, "open"), gte(baseStocks.cookedOn, since))).all();
  const families = new Set(rows.map((r) => r.family));
  const res = families.size ? db.select({ id: reserves.id, groups: reserves.groups, status: reserves.status }).from(reserves).where(gte(reserves.cookedOn, addDays(since, -1))).all() : [];
  const linked = res.map((r) => ({ ...r, bases: r.groups.filter((g) => g.base && families.has(g.base)) })).filter((r) => r.bases.length);
  const ids = linked.map((r) => r.id);
  const takes: TakeIn[] = [];
  if (ids.length) {
    const byId = new Map(linked.map((r) => [r.id, r.bases]));
    for (const s of db.select().from(reserveServings).where(and(inArray(reserveServings.reserveId, ids), eq(reserveServings.source, "recipient"))).all())
      for (const g of byId.get(s.reserveId)!) if ((s.grams[g.key] ?? 0) > 0) takes.push({ family: g.base!, at: s.at, g: s.grams[g.key] });
    for (const b of db.select().from(mealBoxes).where(inArray(mealBoxes.reserveId, ids)).all())
      for (const g of byId.get(b.reserveId!)!) if ((b.portion?.[g.key] ?? 0) > 0) takes.push({ family: g.base!, at: b.createdAt, g: b.portion![g.key], box: true });
  }
  const levels = stockLevels(rows.map(stockIn), takes);
  return { rows, levels };
}

const stockIn = (r: StockRow): StockIn => ({ id: r.id, family: r.family, cookedOn: r.cookedOn, createdAt: r.createdAt, cookedG: r.cookedG, g: r.g, at: r.at, closedAt: r.status === "closed" ? r.closedAt : null });

// ─── Lecture ───

export interface BaseContainerView {
  id: string;
  cookedOn: string;
  limit: string;
  freshness: "ok" | "soon" | "past";
  leftG: number;
  cookedG: number;
  estimated: boolean;
  sessionId: string | null;
  /** Combien de gros récipients ce qui reste remplit. */
  boxes: number | null;
}

export interface BaseView {
  family: string;
  label: string;
  /** « le riz ». */
  the: string;
  leftG: number;
  containers: BaseContainerView[];
  /** La limite au frigo du récipient le plus pressé qui en a encore. */
  limit: string | null;
  freshness: "ok" | "soon" | "past" | null;
  /** La plus grande portion de base servie en ce moment (150 g sans portion). */
  portionG: number;
  /** Grammes encore prévus dans les portions restantes des plats qui la prennent. */
  needG: number;
  /** Sous deux portions : à refaire. */
  low: boolean;
  dishes: { dishId: string; name: string }[];
  remake: RemakePlan & { pantryG: number | null };
  freeze: { ok: boolean; how: string; portions: number; g: number; by: string | null };
  /** Se garde au frigo (jours). */
  fridgeDays: number;
}

export interface FreezeView {
  dishId: string;
  name: string;
  slug: string | null;
  /** Se congèle (la fiche) : sinon, à manger d'abord. */
  ok: boolean;
  portions: number;
  people: { personId: string; name: string; n: number }[];
  /** Avant la limite au frigo. */
  by: string;
  note: string | null;
}

const bigBoxes = (db: Db): BigBoxes => loadKitchen(db).containers.baseBoxes;
const pots = (db: Db) =>
  kitchenEquipment(loadKitchen(db))
    .equipment.filter((e) => e.kind === "pot")
    .map((e) => ({ id: e.id, name: e.name, liters: vesselLiters({ capacityL: e.capacityL ?? null, dimsJson: e.dimsJson ?? null }) }));

/** Le placard en a-t-il (lots ouverts dont le nom dit la base) : grammes, ou null sans placard suivi. */
function pantryOf(db: Db, f: BaseFamily): number | null {
  const word = f.label.split(" ")[0].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const lots = listLots(db).filter((l) => `${l.lot.item} ${l.name ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(word));
  return lots.length ? Math.round(lots.reduce((s, l) => s + l.lot.gramsLeft, 0)) : null;
}

/**
 * Ce qu'une personne mangera d'un plat d'ici `limit` : ses repas prévus par la Semaine dans la fenêtre,
 * sinon deux repas par jour partagés entre ses plats (bases.ts, eatableWithoutPlan).
 */
function eatPlanner(db: Db, dishes: DishView[], today: string) {
  const slots = new Map<string, Map<string, { date: string }[]>>();
  const open = (personId: string) => dishes.filter((d) => d.status === "cooked" && (d.people.find((p) => p.personId === personId)?.left ?? 0) > 0).length;
  return (d: DishView, personId: string, limit: string) => {
    if (!d.recipeId || !d.cookedOn) return 0;
    if (!slots.has(d.id)) slots.set(d.id, plannedSlots(db, d.recipeId, d.cookedOn));
    const mine = slots.get(d.id)!.get(personId);
    if (mine?.length) return mine.filter((s) => s.date >= today && s.date <= limit).length;
    return eatableWithoutPlan(daysBetween(today, limit), open(personId));
  };
}

const looseOf = (p: DishView["people"][number]) => Math.max(0, p.left - p.inBoxes);

/** Les bases du foyer : ce qui reste dans chaque récipient, à refaire, à congeler. */
export function listBases(db: Db, dishes: DishView[], now = new Date()): BaseView[] {
  const today = todayParis(now);
  const { rows, levels } = loadStocks(db, now);
  const cooked = dishes.filter((d) => d.status === "cooked");
  const box = bigBoxes(db);
  const potList = pots(db);
  const eatBefore = eatPlanner(db, dishes, today);
  const at = now.toISOString();
  const families = new Set([...rows.filter((r) => r.status === "open").map((r) => r.family), ...cooked.flatMap((d) => d.groups.filter((g) => g.base).map((g) => g.base!))]);
  const out: BaseView[] = [];
  for (const key of families) {
    const f = baseFamily(key);
    if (!f) continue;
    const linked = cooked.filter((d) => d.groups.some((g) => g.base === key));
    const gramsOf = (lines: { base?: string; g: number }[] | undefined) => lines?.filter((l) => l.base === key).reduce((s, l) => s + l.g, 0) ?? 0;
    const portions = linked.flatMap((d) => d.people.map((p) => (p.next?.source === "recipient" ? gramsOf(p.next.grams) : 0))).filter((g) => g > 0);
    const portionG = portions.length ? Math.max(...portions) : DEFAULT_BASE_PORTION_G;
    const needG = linked.reduce((s, d) => s + d.people.reduce((x, p) => x + looseOf(p) * gramsOf(p.portion?.grams), 0), 0);
    // Un récipient vide se ferme quand un autre a pris le relais, ou quand plus aucun plat ne le prend.
    const mine = rows.filter((r) => r.family === key && r.status === "open");
    const newest = mine.map((r) => r.createdAt).sort().at(-1);
    for (const r of mine) {
      if ((levels[r.id] ?? 0) > CRUMBS_G || (r.createdAt === newest && linked.length)) continue;
      db.update(baseStocks).set({ status: "closed", closedAt: at, updatedAt: at }).where(eq(baseStocks.id, r.id)).run();
      r.status = "closed";
    }
    const containers = mine
      .filter((r) => r.status === "open")
      .sort((a, b) => a.cookedOn.localeCompare(b.cookedOn) || a.createdAt.localeCompare(b.createdAt))
      .map((r) => {
        const limit = addDays(r.cookedOn, r.fridgeDays);
        const leftG = levels[r.id] ?? 0;
        return { id: r.id, cookedOn: r.cookedOn, limit, freshness: freshness(limit, today), leftG, cookedG: Math.round(r.cookedG), estimated: r.estimated, sessionId: r.sessionId, boxes: leftG > CRUMBS_G ? (boxesFor(f, leftG, box)?.n ?? null) : 0 };
      });
    if (!containers.length && !linked.length) continue;
    const leftG = containers.reduce((s, c) => s + c.leftG, 0);
    const first = containers.find((c) => c.leftG > CRUMBS_G);
    const limit = first?.limit ?? null;
    // Ce qui sera servi avant la limite : les portions de chacun mangées d'ici là.
    const demand = limit ? linked.reduce((s, d) => s + d.people.reduce((x, p) => x + Math.min(looseOf(p), eatBefore(d, p.personId, limit)) * gramsOf(p.portion?.grams), 0), 0) : 0;
    const fz = freezeBase(f, leftG, demand, portionG);
    out.push({
      family: key,
      label: f.label,
      the: f.the,
      leftG,
      containers,
      limit,
      freshness: limit ? freshness(limit, today) : null,
      portionG: Math.round(portionG),
      needG: Math.round(needG),
      low: isLow(leftG, portionG),
      dishes: linked.map((d) => ({ dishId: d.id, name: d.name })),
      remake: { ...remakePlan(f, remakeTarget(f, needG - leftG, box), potList, box), pantryG: pantryOf(db, f) },
      freeze: { ok: f.freeze.ok, how: f.freeze.how, ...fz, by: fz.portions > 0 ? limit : null },
      fridgeDays: f.fridgeDays,
    });
  }
  return out.sort((a, b) => Number(b.low) - Number(a.low) || BASE_FAMILIES.findIndex((f) => f.key === a.family) - BASE_FAMILIES.findIndex((f) => f.key === b.family));
}

/** Les plats dont des portions ne seront pas mangées avant la limite au frigo : à congeler (ou à manger d'abord). */
export function freezeList(db: Db, dishes: DishView[], now = new Date()): FreezeView[] {
  const today = todayParis(now);
  const eatBefore = eatPlanner(db, dishes, today);
  const out: FreezeView[] = [];
  for (const d of dishes) {
    if (d.status !== "cooked" || !d.limit || d.freshness === "past") continue;
    const fz = freezeDish({ freezerOk: freezerOkOf(db, d), people: d.people.map((p) => ({ personId: p.personId, name: p.name, loose: p.portion ? looseOf(p) : 0, eatBefore: eatBefore(d, p.personId, d.limit!) })) });
    if (!fz.portions) continue;
    const foods = d.recipeId ? db.select({ food: recipeIngredients.foodId }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, d.recipeId)).all().map((r) => r.food) : [];
    out.push({ dishId: d.id, name: d.name, slug: d.slug, ok: fz.ok, portions: fz.portions, people: fz.people, by: d.limit, note: fz.ok ? dishFreezeNote(foods) : null });
  }
  return out.sort((a, b) => a.by.localeCompare(b.by));
}

const freezerOkOf = (db: Db, d: DishView) => db.select({ ok: reserves.freezerOk }).from(reserves).where(eq(reserves.id, d.id)).get()?.ok ?? false;

// ─── Gestes ───

/** Une nouvelle pesée d'un récipient : elle devient ce qui reste. */
export function weighBase(db: Db, stockId: string, grams: number, now = new Date()) {
  if (!(Number.isFinite(grams) && grams >= 0 && grams <= 50_000)) throw new ReserveError("Poids entre 0 et 50 kg.", 400);
  const row = db.select().from(baseStocks).where(eq(baseStocks.id, stockId)).get();
  if (!row) throw new ReserveError("Ce récipient n'existe plus.", 404);
  const at = now.toISOString();
  db.update(baseStocks).set({ g: Math.round(grams), at, weighed: true, estimated: false, status: "open", closedAt: null, updatedAt: at }).where(eq(baseStocks.id, stockId)).run();
  return { label: row.label };
}

/** « C'est fini » : le récipient est vide, ou jeté. */
export function closeBase(db: Db, stockId: string, now = new Date()) {
  const row = db.select().from(baseStocks).where(eq(baseStocks.id, stockId)).get();
  if (!row) throw new ReserveError("Ce récipient n'existe plus.", 404);
  db.update(baseStocks).set({ status: "closed", closedAt: now.toISOString(), updatedAt: now.toISOString() }).where(eq(baseStocks.id, stockId)).run();
  return { label: row.label };
}

/**
 * « C'est cuit » : un nouveau récipient de la base, d'après le cru (`rawG` × rendement, estimé) ou pesé
 * cuit (`grams`). Les portions suivantes y puisent une fois les plus anciens vides.
 */
export function remakeBase(db: Db, family: string, input: { rawG?: number | null; grams?: number | null }, now = new Date()) {
  const f = baseFamily(family);
  if (!f) throw new ReserveError("Base inconnue.", 404);
  const weighed = input.grams != null && Number.isFinite(input.grams) && input.grams > 0;
  const raw = input.rawG != null && Number.isFinite(input.rawG) && input.rawG > 0 ? input.rawG : null;
  if (!weighed && raw == null) throw new ReserveError("Dis combien de cru, ou pèse le cuit.", 400);
  const g = Math.round(weighed ? input.grams! : raw! * f.cookedYield);
  if (g > 50_000) throw new ReserveError("Poids entre 0 et 50 kg.", 400);
  const at = now.toISOString();
  const id = randomUUID();
  db.insert(baseStocks).values({ id, family: f.key, label: f.label, sessionId: null, cookedOn: todayParis(now), fridgeDays: f.fridgeDays, cookedG: g, g, at, estimated: !weighed, weighed, parts: {}, createdAt: at, updatedAt: at }).run();
  return { id, label: f.label, g, message: `${f.the.charAt(0).toLocaleUpperCase("fr") + f.the.slice(1)} : ${gramsLabel(g)}${weighed ? "" : " (estimé d'après le cru)"} au frigo, ${f.fridgeDays} jours.` };
}
