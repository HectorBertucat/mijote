import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { eq } from "drizzle-orm";
import { baseFamily, baseShares, boxesFor, dishFreezeNote, eatableWithoutPlan, familyOfFood, freezeBase, freezeDish, isLow, linkBases, remakePlan, remakeTarget, separableBases, stockLevels, type StockIn } from "@/lib/reserve/bases";
import { closeBase, freezeList, listBases, remakeBase, weighBase } from "@/lib/reserve/bases-store";
import { reserveState, type ReserveGroup, type Target } from "@/lib/reserve/core";
import { serveGroups } from "@/lib/reserve/groups";
import { eatPortion, listDishes, saveReserve } from "@/lib/reserve/store";
import { openDb } from "@/lib/db/open";
import { baseStocks, cookSessions, mealSlots, recipes, weekPlans } from "@/lib/db/schema";
import { upsertRecipe } from "@/lib/recipes/store";
import { load, seedTest } from "./helpers";

// ─── Base séparée ou mélangée ───

test("base séparée : le riz et les haricots du teriyaki ; mélangée : le one-pot, pâtes et haricots dans la même eau", () => {
  const t = load("poulet-teriyaki-riz.json");
  assert.deepEqual(separableBases(t, serveGroups(t)), { riz: "riz", "haricots-verts": "haricots-verts" });
  // L'orzo cuit dans la sauce : il est dans le plat.
  const o = load("one-pot-orzo-poulet-epinards-parmesan.json");
  assert.deepEqual(separableBases(o, serveGroups(o)), {});
  // Pâtes et haricots verts dans la même eau : deux bases mêlées, elles restent dans la recette.
  const m = load("medaillons-moutarde.json");
  assert.deepEqual(separableBases(m, serveGroups(m)), {});
  // Les patates douces rôties avec le poulet : c'est le plat ; le riz à part, une base.
  const p = load("poulet-paprika-fume-patates-douces.json");
  assert.deepEqual(separableBases(p, serveGroups(p)), { riz: "riz" });
});

test("base déclarée par la fiche : la semoule du couscous ; `base: false` la garde dans la recette", () => {
  const r = load("couscous-poulet-merguez.json");
  const raw = JSON.parse(fs.readFileSync("src/seed/recipes/couscous-poulet-merguez.json", "utf8"));
  assert.deepEqual(separableBases(r, serveGroups(r, raw.serve), raw.serve), { semoule: "semoule" });
  const kept = raw.serve.map((d: { label: string }) => (/semoule/i.test(d.label) ? { ...d, base: false } : d));
  assert.deepEqual(separableBases(r, serveGroups(r, kept), kept), {});
  assert.equal(familyOfFood("riz_basmati")?.key, "riz");
  assert.equal(familyOfFood("pomme_de_terre")?.key, "pommes-de-terre");
  assert.equal(familyOfFood("poulet"), null);
});

// ─── La part de base d'un plat ───

const at = "2026-11-01T17:00:00.000Z";
const G = (key: string, kind: ReserveGroup["kind"], g: number, kcal: number, protein: number): ReserveGroup => ({ key, label: key, kind, g, at, kcalG: kcal / g, proteinG: protein / g });
const tgt = (id: string, kcal: number, protein: number): Target => ({ id, name: id, units: 5, kcal, kcalMax: kcal + 150, protein, proteinMin: protein - 10 });

test("base reliée : sa part suit le plat, elle ne compte pas dans ce qui reste ; une pesée du plat ne la change pas", () => {
  const groups = linkBases([G("plat", "main", 1200, 2300, 260), G("riz", "starch", 1000, 1550, 34), G("sauce", "other", 100, 50, 1)], { riz: "riz" });
  assert.equal(groups[1].base, "riz");
  assert.ok(Math.abs(groups[1].ratio! - 1000 / 1200) < 1e-9);
  assert.equal(groups[0].base, undefined);
  assert.deepEqual(baseShares(groups, { plat: 600, riz: 0, sauce: 50 }), { plat: 600, riz: 500, sauce: 50 });
  // Le plat repesé plus léger (il a perdu de l'eau), mêmes kcal : la part de riz ne bouge pas.
  const lighter = groups.map((g) => (g.key === "plat" ? { ...g, g: 1000, kcalG: 2300 / 1000 } : g));
  assert.equal(baseShares(lighter, { plat: 1000 })["riz"], 1000);
  // Une portion : plat et riz ; le plat mangé, la réserve est vide même si le riz du récipient reste.
  const st = reserveState(groups, { alex: 2 }, [tgt("alex", 700, 70)], [], []);
  assert.ok(st.shares[0].portion!.grams.riz > 0 && st.shares[0].portion!.grams.plat > 0);
  const done = reserveState(groups, { alex: 1 }, [tgt("alex", 700, 70)], [{ id: "s", personId: "alex", at: "2026-11-02T12:00:00Z", source: "recipient", boxId: null, grams: { plat: 1200, sauce: 100 } }], []);
  assert.equal(done.empty, true);
});

// ─── Ce qui reste dans les récipients ───

const S = (id: string, cookedOn: string, createdAt: string, g: number, extra: Partial<StockIn> = {}): StockIn => ({ id, family: "riz", cookedOn, createdAt, cookedG: g, g, at: createdAt, ...extra });

test("récipients : premier cuit, premier servi ; une pesée remplace ce qui reste ; un récipient fini ne sert plus", () => {
  const a = S("a", "2026-11-01", "2026-11-01T17:00:00Z", 1000);
  const b = S("b", "2026-11-03", "2026-11-03T19:00:00Z", 1500);
  const take = (t: string, g: number, family = "riz") => ({ family, at: t, g });
  // 800 g pris dans a, puis 400 g : a se vide (200), le reste dans b.
  assert.deepEqual(stockLevels([a, b], [take("2026-11-02T12:00:00Z", 800), take("2026-11-04T12:00:00Z", 400), take("2026-11-04T12:00:00Z", 999, "pates")]), { a: 0, b: 1300 });
  // Avant que b existe, rien n'en sort : la prise de trop se perd.
  assert.deepEqual(stockLevels([a, b], [take("2026-11-02T12:00:00Z", 1200)]), { a: 0, b: 1500 });
  // a repesé à 600 g après la première prise : ce qui reste, c'est la pesée.
  const a2 = { ...a, g: 600, at: "2026-11-02T20:00:00Z" };
  assert.deepEqual(stockLevels([a2], [take("2026-11-02T12:00:00Z", 100), take("2026-11-03T12:00:00Z", 150)]), { a: 450 });
  // a fini (jeté) : les portions suivantes puisent dans b.
  const a3 = { ...a, closedAt: "2026-11-03T20:00:00Z" };
  assert.deepEqual(stockLevels([a3, b], [take("2026-11-04T12:00:00Z", 300)]), { a: 1000, b: 1200 });
  // Une boîte rangée à l'instant de la pesée en sort ; une portion mangée à cet instant-là était déjà sortie.
  assert.deepEqual(stockLevels([a2], [{ family: "riz", at: a2.at, g: 100, box: true }, { family: "riz", at: a2.at, g: 50 }]), { a: 500 });
  assert.ok(isLow(250, 150) && !isLow(300, 150));
});

// ─── Refaire ───

const POTS = [
  { id: "casserole-16", name: "Casserole 16 cm", liters: 1.8 },
  { id: "casserole-20", name: "Casserole 20 cm", liters: 3 },
  { id: "faitout", name: "Faitout", liters: 6 },
];

test("refaire du riz : le cru, l'eau, la plus petite casserole qui le tient, les gros récipients", () => {
  const riz = baseFamily("riz")!;
  const box = { count: 4, liters: 2 };
  assert.deepEqual(boxesFor(riz, 2000, box), { n: 2, perBoxG: 1260 });
  // De quoi servir 1,8 kg : au moins un récipient, au plus tous.
  assert.equal(remakeTarget(riz, 1800, box), 1800);
  assert.equal(remakeTarget(riz, -200, box), 1250);
  assert.equal(remakeTarget(riz, 99_000, box), 5050);
  assert.equal(remakeTarget(riz, 100, { count: 0, liters: 2 }), 600);
  const p = remakePlan(riz, 1800, POTS, box);
  assert.equal(p.rawG, 700);
  assert.equal(p.waterL, 1.3);
  // 0,7 kg à l'absorption : 2,7 L au plus fort, la casserole de 3 L ne le tient pas (2,25 L utiles), le faitout oui.
  assert.equal(p.pot?.id, "faitout");
  assert.equal(p.batches, 1);
  assert.equal(p.boxes, 2);
  assert.match(p.steps[0], /^Pèse 700 g de riz \(cru\), rince/);
  assert.match(p.steps[1], /1,3 L d'eau salée dans faitout.*12 min.*10 min hors du feu/);
  assert.match(p.steps[2], /remplis 2 gros récipients \(2 L\) : 4 jours au frigo/);
  // Trop pour la cuisine : en fournées dans la plus grande.
  const big = remakePlan(riz, 5000, POTS.slice(0, 2), box);
  assert.equal(big.pot?.id, "casserole-20");
  assert.ok(big.batches >= 3);
  assert.match(big.steps[0], /en \d fournées/);
  // Les haricots verts, à grande eau ; les épinards : « d'épinards ».
  const hv = remakePlan(baseFamily("haricots-verts")!, 800, POTS, box);
  assert.equal(hv.rawG, 800);
  assert.match(hv.steps[1], /égoutte/);
  assert.match(remakePlan(baseFamily("epinards")!, 400, POTS, box).steps[0], /d'épinards/);
});

// ─── Congeler ───

test("congeler : ce qui ne sera pas mangé avant la limite, si ça se congèle ; les pommes de terre non", () => {
  const fz = freezeDish({ freezerOk: true, people: [{ personId: "alex", name: "Alex", loose: 4, eatBefore: 2 }, { personId: "sam", name: "Sam", loose: 2, eatBefore: 3 }] });
  assert.deepEqual(fz, { ok: true, portions: 2, people: [{ personId: "alex", name: "Alex", n: 2 }] });
  assert.equal(freezeDish({ freezerOk: false, people: [{ personId: "alex", name: "Alex", loose: 3, eatBefore: 1 }] }).ok, false);
  // Sans repas prévus : deux repas par jour, partagés entre les plats ouverts.
  assert.equal(eatableWithoutPlan(2, 3), 2);
  assert.equal(eatableWithoutPlan(-1, 1), 2);
  assert.deepEqual(freezeBase(baseFamily("riz")!, 1300, 500, 160), { portions: 5, g: 800 });
  assert.deepEqual(freezeBase(baseFamily("pommes-de-terre")!, 1300, 500, 160), { portions: 0, g: 0 });
  assert.equal(baseFamily("pommes-de-terre")!.freeze.ok, false);
  assert.match(dishFreezeNote(["poulet", "pomme_de_terre"])!, /farineuses/);
  assert.equal(dishFreezeNote(["poulet", "riz_basmati"]), null);
});

// ─── En base ───

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  upsertRecipe(db, JSON.parse(fs.readFileSync("src/seed/recipes/poulet-teriyaki-riz.json", "utf8")));
  const r = db.select().from(recipes).where(eq(recipes.slug, "poulet-teriyaki-riz")).get()!;
  const plan = { version: 1, recipes: [{ slug: r.slug, name: r.name, color: "var(--c-recipe-1)", scale: 1 }] };
  db.insert(cookSessions).values({ id: "S", planJson: plan, status: "done", startedAt: "2026-11-01T14:00:00Z", endedAt: "2026-11-01T17:00:00Z" }).run();
  db.insert(weekPlans).values({ id: "W", weekStart: "2026-11-02" }).run();
  const slot = (day: number, meal: "lunch" | "dinner", personId: string) => ({ id: `${day}${meal}${personId}`, weekPlanId: "W", day, meal, personId, place: "home" as const, recipeId: r.id });
  db.insert(mealSlots).values([slot(0, "lunch", "alex"), slot(1, "lunch", "alex"), slot(5, "lunch", "alex"), slot(0, "dinner", "sam"), slot(2, "dinner", "sam")]).run();
  return { db, r };
}
const NOW = new Date("2026-11-01T17:30:00Z");

test("en base : le riz du plat va dans son récipient, chaque portion le décompte ; refaire, repeser, finir", () => {
  const { db, r } = setup();
  saveReserve(db, "S", r.id, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts: { alex: 4, sam: 3 }, freezer: {} }, NOW);
  const stocks = db.select().from(baseStocks).all();
  assert.deepEqual(stocks.map((s) => [s.family, s.cookedG, s.estimated]).sort(), [["haricots-verts", 600, false], ["riz", 1100, false]]);
  // Ranger à nouveau ne double pas le récipient : la part de ce plat est remplacée.
  saveReserve(db, "S", r.id, { weights: { plat: 1500, riz: 1000, "haricots-verts": 600 }, counts: { alex: 4, sam: 3 }, freezer: {} }, NOW);
  assert.equal(db.select().from(baseStocks).where(eq(baseStocks.family, "riz")).get()!.cookedG, 1000);

  const later = new Date("2026-11-02T11:30:00Z");
  let dish = listDishes(db, "alex", later).find((d) => d.status === "cooked")!;
  const riz = dish.people[0].next!.grams.find((g) => g.key === "riz")!;
  assert.equal(riz.base, "riz");
  let bases = listBases(db, listDishes(db, "alex", later), later);
  assert.deepEqual(bases.map((b) => b.family), ["riz", "haricots-verts"]);
  assert.equal(bases[0].leftG, 1000);
  assert.equal(bases[0].containers[0].limit, "2026-11-05");
  assert.ok(bases[0].needG > 0 && !bases[0].low);

  // Une portion mangée : le récipient de riz perd ses grammes.
  const s = eatPortion(db, dish.id, "alex", {}, later);
  const took = s.grams.find((g) => g.key === "riz")!.g;
  bases = listBases(db, listDishes(db, "alex", later), later);
  assert.equal(bases[0].leftG, 1000 - took);

  // Le riz pesé à 200 g (un peu servi à côté) : sous deux portions, à refaire.
  weighBase(db, bases[0].containers[0].id, 200, new Date("2026-11-02T13:00:00Z"));
  const t2 = new Date("2026-11-02T13:30:00Z");
  bases = listBases(db, listDishes(db, "alex", t2), t2);
  assert.equal(bases[0].leftG, 200);
  assert.equal(bases[0].low, true);
  assert.ok(bases[0].remake.rawG >= 400 && bases[0].remake.steps.length === 3);
  assert.equal(bases[0].remake.boxes, 1);

  // Refait : un nouveau récipient ; les portions vident d'abord l'ancien.
  remakeBase(db, "riz", { rawG: 500 }, new Date("2026-11-02T18:00:00Z"));
  const t3 = new Date("2026-11-02T19:00:00Z");
  dish = listDishes(db, "alex", t3).find((d) => d.status === "cooked")!;
  const s2 = eatPortion(db, dish.id, "sam", {}, t3);
  const took2 = s2.grams.find((g) => g.key === "riz")!.g;
  bases = listBases(db, listDishes(db, "alex", t3), t3);
  const old = Math.max(0, 200 - took2);
  assert.equal(bases[0].leftG, old + 1250 - Math.max(0, took2 - 200));
  assert.equal(bases[0].low, false);
  // Fini : l'ancien sort ; il reste le nouveau.
  closeBase(db, bases[0].containers[0].id, new Date("2026-11-02T20:00:00Z"));
  const t4 = new Date("2026-11-02T20:30:00Z");
  assert.equal(listBases(db, listDishes(db, "alex", t4), t4)[0].containers.length, 1);
  assert.throws(() => weighBase(db, "inconnu", 100), /n'existe plus/);
  assert.throws(() => remakeBase(db, "riz", {}), /cru/);
});

test("en base : à congeler, ce qui ne sera pas mangé avant la limite au frigo", () => {
  const { db, r } = setup();
  // Beaucoup plus de portions que de repas prévus avant la limite (le 5).
  saveReserve(db, "S", r.id, { weights: { plat: 3000, riz: 2200, "haricots-verts": 1200 }, counts: { alex: 7, sam: 5 }, freezer: {} }, NOW);
  const later = new Date("2026-11-02T08:00:00Z");
  const dishes = listDishes(db, "alex", later);
  const fz = freezeList(db, dishes, later);
  assert.equal(fz.length, 1);
  assert.equal(fz[0].ok, true);
  assert.equal(fz[0].by, "2026-11-05");
  // Alex : 7 portions, 2 repas prévus d'ici le 5 ; Sam : 5, 2 repas.
  assert.deepEqual(fz[0].people.map((p) => [p.personId, p.n]), [["alex", 5], ["sam", 3]]);
  const riz = listBases(db, dishes, later).find((b) => b.family === "riz")!;
  assert.ok(riz.freeze.ok && riz.freeze.portions > 0 && riz.freeze.by === "2026-11-05");
});
