import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { eq } from "drizzle-orm";
import { splitPot, type PotModel } from "@/lib/boxes/core";
import { eatBox, listStock } from "@/lib/boxes/store";
import { defaultCounts, defaultFreezer, initialCounts, leftInPot, macrosOf, reserveState, reweigh, servingLabel, splitGroups, weighedGroups, type BoxIn, type CalcModel, type ReserveGroup, type ServingIn, type Target } from "@/lib/reserve/core";
import { keyOf, serveGroups } from "@/lib/reserve/groups";
import { adjustReserve, adoptLegacyBoxes, calcModel, eatPortion, listDishes, recentServings, saveReserve, sessionReserves, undoServing } from "@/lib/reserve/store";
import { deleteEntry, listEntries } from "@/lib/health/log";
import { openDb } from "@/lib/db/open";
import { cookSessions, foodLog, mealBoxes, mealSlots, recipes, reserves, weekPlans } from "@/lib/db/schema";
import { upsertRecipe } from "@/lib/recipes/store";
import { load, seedTest } from "./helpers";

// ─── Les groupes d'une recette ───

test("groupes déduits des étapes : plat, riz et haricots verts du teriyaki ; un seul groupe pour un one-pot", () => {
  const t = serveGroups(load("poulet-teriyaki-riz.json"));
  assert.deepEqual(t.map((g) => [g.key, g.kind]), [["plat", "main"], ["riz", "starch"], ["haricots-verts", "veg"]]);
  // La sauce (bol C) et l'huile hors bol vont avec le poulet.
  const r = load("poulet-teriyaki-riz.json");
  assert.deepEqual(t[0].items.map((n) => r.ingredients[n].group ?? "-").sort(), ["-", "B", "C", "C", "C", "C", "C"]);
  assert.ok(t[1].estG > 1000, "riz cuit ≈ 2,5 × cru");
  assert.deepEqual(serveGroups(load("one-pot-orzo-poulet-epinards-parmesan.json")).map((g) => g.key), ["plat"]);
  // Le gratin : rôtis puis assemblés au four, un seul plat.
  assert.deepEqual(serveGroups(load("gratin-facon-moussaka.json")).map((g) => g.key), ["plat"]);
});

test("groupes : les champignons poêlés rejoignent la cocotte ; les œufs du caramel aussi ; pâtes et haricots dans la même eau", () => {
  assert.deepEqual(serveGroups(load("chasseur-porc.json")).map((g) => g.key), ["plat", "riz", "haricots-verts"]);
  assert.deepEqual(serveGroups(load("porc-caramel.json")).map((g) => g.key), ["plat", "riz"]);
  const m = serveGroups(load("medaillons-moutarde.json"));
  assert.deepEqual(m.map((g) => [g.kind, g.label]), [["main", "plat"], ["starch", "haricots verts et pâtes"]]);
  // Le poulet rôti avec les patates douces : c'est le plat, pas un féculent.
  const p = load("poulet-paprika-fume-patates-douces.json");
  assert.deepEqual(serveGroups(p).map((g) => g.kind), ["main", "starch", "other"]);
});

test("groupes déclarés par la fiche : le premier reçoit ce qui n'est dans aucun bol", () => {
  const r = load("couscous-poulet-merguez.json");
  const raw = JSON.parse(fs.readFileSync("src/seed/recipes/couscous-poulet-merguez.json", "utf8"));
  const g = serveGroups(r, raw.serve);
  assert.deepEqual(g.map((x) => [x.key, x.kind]), [["plat", "main"], ["semoule", "starch"]]);
  assert.ok(g[0].items.some((n) => r.ingredients[n].item.startsWith("Merguez")));
  assert.ok(g[0].items.some((n) => r.ingredients[n].item.startsWith("Huile")));
  assert.equal(keyOf("Œufs durs"), "oeufs-durs");
});

// ─── La répartition ───

const G = (key: string, kind: ReserveGroup["kind"], g: number, kcal: number, protein: number): ReserveGroup => ({ key, label: key, kind, g, at: "2026-11-01T17:00:00.000Z", kcalG: kcal / g, proteinG: protein / g });
const ref = (kcal: number, protein: number) => ({ kcalMin: kcal - 150, kcalMax: kcal + 150, proteinMin: protein - 10, proteinMax: protein + 10 });
const tgt = (id: string, name: string, kcal: number, protein: number | null, units = 5): Target => ({ id, name, units, kcal, kcalMax: protein != null ? kcal + 150 : null, protein, proteinMin: protein != null ? protein - 10 : null });
const sumOf = (s: ReturnType<typeof splitGroups>, counts: Record<string, number>, key: string) => Object.entries(s.portions).reduce((x, [id, p]) => x + counts[id] * (p.grams[key] ?? 0), 0);

test("deux groupes : la même portion que les boîtes (plat + féculent)", () => {
  // La marmite de boxes.test.ts : 3000 g de plat (3600 kcal, 450 g de protéines), 1400 g de riz (1820 kcal, 42 g).
  const m: PotModel = {
    recipeId: "r",
    slug: "r",
    name: "R",
    cookedUnits: 28,
    dish: { kcal: 3600, protein: 450 },
    side: { label: "riz", kcal: 1820, protein: 42 },
    fridgeDays: 4,
    freezerOk: true,
    people: [
      { id: "alex", name: "Alex", baseUnits: 5, ref: ref(750, 70), planned: [] },
      { id: "sam", name: "Sam", baseUnits: 4, ref: ref(600, 35), planned: [] },
    ],
  };
  const pot = splitPot(m, { dishG: 3000, sideG: 1400 });
  const counts = Object.fromEntries(pot.byPerson.map((p) => [p.personId, p.count]));
  const kcalUnit = 5420 / 28;
  const people = m.people.map((p) => ({ id: p.id, name: p.name, units: p.baseUnits, kcal: Math.min(1.6 * p.baseUnits, Math.max(0.6 * p.baseUnits, Math.round(((p.ref!.kcalMin + p.ref!.kcalMax) / 2 / kcalUnit) * 2) / 2)) * kcalUnit, kcalMax: p.ref!.kcalMax, protein: (p.ref!.proteinMin + p.ref!.proteinMax) / 2, proteinMin: p.ref!.proteinMin }));
  const s = splitGroups([G("plat", "main", 3000, 3600, 450), G("riz", "starch", 1400, 1820, 42)], { plat: 3000, riz: 1400 }, people, counts);
  for (const p of pot.byPerson) {
    assert.ok(Math.abs(s.portions[p.personId].grams.plat - p.dishG!) <= 10, `${p.name} plat ${s.portions[p.personId].grams.plat} / ${p.dishG}`);
    assert.ok(Math.abs(s.portions[p.personId].grams.riz - p.sideG!) <= 10, `${p.name} riz`);
  }
});

const TERIYAKI = [G("plat", "main", 1500, 2400, 270), G("riz", "starch", 1100, 1430, 33), G("haricots-verts", "veg", 600, 180, 12)];
const POT = { plat: 1500, riz: 1100, "haricots-verts": 600 };

test("trois groupes : tout est réparti, les haricots suivent le plat, moins de riz pour qui manque de protéines", () => {
  // Alex vise 75 g de protéines pour 700 kcal : la proportion de la marmite n'en donne que 55.
  const people = [tgt("alex", "Alex", 700, 75), tgt("sam", "Sam", 550, 30, 4)];
  const counts = { alex: 4, sam: 3 };
  const s = splitGroups(TERIYAKI, POT, people, counts);
  for (const k of Object.keys(POT)) assert.ok(Math.abs(sumOf(s, counts, k) - POT[k as keyof typeof POT]) <= 5 * 7, `${k} réparti`);
  const a = s.portions.alex.grams;
  const b = s.portions.sam.grams;
  // Haricots / plat : la proportion de la marmite pour les deux.
  assert.ok(Math.abs(a["haricots-verts"] / a.plat - b["haricots-verts"] / b.plat) < 0.05);
  // Alex vise plus de protéines par kcal : moins de riz par gramme de plat.
  assert.ok(a.riz / a.plat < b.riz / b.plat);
  assert.notEqual(s.portions.alex.mode, "simple");
  // Alex, jamais plus de riz que la proportion de la marmite ; ce qu'il en laisse revient aux autres (le récipient est vidé).
  assert.ok(a.riz / a.plat <= 1100 / 1500);
  assert.equal(s.portions.alex.kcal, macrosOf(TERIYAKI, a).kcal);
});

test("sans kcal connues : la proportion simple, selon la part de base", () => {
  const groups = TERIYAKI.map((g) => ({ ...g, kcalG: null, proteinG: null }));
  const s = splitGroups(groups, POT, [tgt("alex", "Alex", 700, 60, 5), { ...tgt("sam", "Sam", 550, 30, 4), kcal: null }], { alex: 2, sam: 2 });
  assert.equal(s.portions.alex.mode, "simple");
  assert.equal(s.portions.alex.kcal, null);
  assert.ok(s.portions.alex.grams.plat > s.portions.sam.grams.plat);
});

test("surplus : chacun au haut de son repère, le reste pour qui veut ; manque : tout rapetisse", () => {
  const people = [tgt("alex", "Alex", 700, 60), tgt("sam", "Sam", 550, 30, 4)];
  const big = splitGroups(TERIYAKI, POT, people, { alex: 2, sam: 2 });
  assert.ok(big.rest, "un reste pour qui veut");
  assert.ok(big.portions.alex.kcal! <= 850 + 10);
  const small = splitGroups(TERIYAKI, POT, people, { alex: 6, sam: 6 });
  assert.ok(small.fill < 1);
  assert.equal(small.rest, null);
});

test("portions de départ : les repas prévus, puis la marge tour à tour", () => {
  // 3 × 700 + 2 × 550 = 3200 prévus : 300 de plus ne font pas 3/4 d'une part.
  assert.deepEqual(initialCounts([{ id: "a", planned: 3, share: 700 }, { id: "b", planned: 2, share: 550 }], 3500), { a: 3, b: 2 });
  // 1500 de plus : une pour chacun, tour à tour (il reste 250).
  assert.deepEqual(initialCounts([{ id: "a", planned: 3, share: 700 }, { id: "b", planned: 2, share: 550 }], 4700), { a: 4, b: 3 });
  assert.deepEqual(initialCounts([{ id: "a", planned: 0, share: 700 }, { id: "b", planned: 0, share: 500 }], 2500), { a: 2, b: 2 });
  assert.deepEqual(initialCounts([{ id: "a", planned: 0, share: 700 }], 100), { a: 1 });
});

// ─── L'état d'une réserve ───

const AT = "2026-11-01T17:00:00.000Z";
const serving = (id: string, personId: string, grams: Record<string, number>, at = "2026-11-02T11:00:00.000Z"): ServingIn => ({ id, personId, at, source: "recipient", boxId: null, grams });

test("une portion mangée : le récipient diminue, les portions restantes se recalculent pour tout répartir", () => {
  const people = [tgt("alex", "Alex", 700, 60), tgt("sam", "Sam", 550, 30, 4)];
  const counts = { alex: 4, sam: 3 };
  const before = reserveState(TERIYAKI, counts, people, [], []);
  const alex0 = before.shares.find((s) => s.personId === "alex")!;
  assert.deepEqual([alex0.total, alex0.left, alex0.eaten], [4, 4, 0]);
  assert.equal(alex0.next?.source, "recipient");
  // Alex mange sa portion : il lui en reste 3, le récipient a perdu ses grammes.
  const s1 = serving("s1", "alex", alex0.portion!.grams);
  const after = reserveState(TERIYAKI, counts, people, [s1], []);
  assert.equal(after.left.plat, 1500 - alex0.portion!.grams.plat);
  const alex1 = after.shares.find((s) => s.personId === "alex")!;
  assert.deepEqual([alex1.total, alex1.left, alex1.eaten], [4, 3, 1]);
  // Rien ne change pour les autres (la portion servie était la sienne, au gramme près).
  assert.ok(Math.abs(after.shares.find((s) => s.personId === "sam")!.portion!.grams.plat - before.shares.find((s) => s.personId === "sam")!.portion!.grams.plat) <= 5);
  // Une grosse portion prise : les autres rapetissent.
  const greedy = reserveState(TERIYAKI, counts, people, [serving("s1", "alex", { plat: 500, riz: 300, "haricots-verts": 100 })], []);
  assert.ok(greedy.shares.find((s) => s.personId === "sam")!.portion!.grams.plat < before.shares.find((s) => s.personId === "sam")!.portion!.grams.plat);
  // Annuler (la portion disparaît) : l'état d'avant, exactement.
  assert.deepEqual(reserveState(TERIYAKI, counts, people, [], []), before);
});

test("deux portions le même jour, et plus que prévu : le total suit, rien ne devient négatif", () => {
  const people = [tgt("alex", "Alex", 700, 60)];
  const st = reserveState(TERIYAKI, { alex: 1 }, people, [serving("s1", "alex", { plat: 200 }), serving("s2", "alex", { plat: 200 }, "2026-11-02T19:00:00.000Z")], []);
  const a = st.shares[0];
  assert.deepEqual([a.total, a.eaten, a.left], [2, 2, 0]);
  assert.equal(a.next, null);
  assert.equal(st.empty, false, "il reste du plat dans le récipient");
});

test("boîtes : des portions figées, retirées du récipient quand elles sont faites après la pesée", () => {
  const people = [tgt("alex", "Alex", 700, 60), tgt("sam", "Sam", 550, 30, 4)];
  const box = (id: string, personId: string, place: "fridge" | "freezer", createdAt = AT): BoxIn => ({ id, personId, status: "stock", place, thawed: false, limit: place === "fridge" ? "2026-11-05" : "2027-01-30", createdAt, grams: { plat: 200, riz: 140, "haricots-verts": 80 } });
  const st = reserveState(TERIYAKI, { alex: 4, sam: 3 }, people, [], [box("b1", "sam", "freezer"), box("b2", "sam", "freezer")]);
  assert.equal(st.left.plat, 1100);
  const sam = st.shares.find((s) => s.personId === "sam")!;
  assert.deepEqual([sam.left, sam.inBoxes], [3, 2]);
  assert.equal(sam.next?.source, "recipient", "le grand récipient d'abord");
  // Une boîte d'avant la pesée (une nouvelle pesée du récipient seul) ne s'en retire pas.
  assert.equal(leftInPot(TERIYAKI.map((g) => ({ ...g, at: "2026-11-03T08:00:00.000Z" })), [], [box("b1", "sam", "freezer")]).plat, 1500);
  // Plus rien dans le récipient pour Sam : sa boîte (celle du frigo d'abord).
  const onlyBoxes = reserveState(TERIYAKI, { alex: 0, sam: 2 }, people, [], [box("b1", "sam", "freezer"), box("b2", "sam", "fridge")]);
  const n = onlyBoxes.shares.find((s) => s.personId === "sam")!.next!;
  assert.equal(n.source, "boite");
  assert.equal(n.source === "boite" && n.boxId, "b2");
});

test("nouvelle pesée : elle remplace ce qui reste, sans changer les kcal restantes", () => {
  const g = TERIYAKI[0];
  const r = reweigh(g, 1000, 900, "2026-11-03T08:00:00.000Z");
  assert.equal(r.g, 900);
  assert.ok(Math.abs(900 * r.kcalG! - 1000 * g.kcalG!) < 1e-6);
  assert.equal(servingLabel("Teriyaki", TERIYAKI, { plat: 180, riz: 150 }), "Teriyaki (plat 180 g, riz 150 g)");
});

test("calculateur : groupes pesés ou estimés, portions et congélo par défaut", () => {
  const m: CalcModel = {
    recipeId: "r",
    slug: "r",
    name: "R",
    cookedUnits: 26,
    kcalUnit: 4010 / 26,
    proteinUnit: 315 / 26,
    fridgeDays: 4,
    freezerOk: true,
    cookedOn: "2026-11-01",
    groups: [
      { key: "plat", label: "plat", kind: "main", kcal: 2400, protein: 270, estG: 1400 },
      { key: "riz", label: "riz", kind: "starch", kcal: 1430, protein: 33, estG: 1125 },
      { key: "haricots-verts", label: "haricots verts", kind: "veg", kcal: 180, protein: 12, estG: 600 },
    ],
    people: [
      { ...tgt("alex", "Alex", 700, 60), planned: 3, late: 1 },
      { ...tgt("sam", "Sam", 550, 30, 4), planned: 2, late: 0 },
    ],
  };
  const groups = weighedGroups(m, { plat: 1500, riz: null }, AT);
  assert.deepEqual(groups.map((g) => [g.g, !!g.estimated]), [[1500, false], [1125, true], [600, true]]);
  assert.ok(Math.abs(groups[0].kcalG! * 1500 - 2400) < 1e-6);
  const counts = defaultCounts(m);
  assert.ok(counts.alex >= 3 && counts.sam >= 2);
  const fz = defaultFreezer(m, counts);
  assert.equal(fz.alex, 1 + counts.alex - 3);
  assert.deepEqual(defaultFreezer({ ...m, freezerOk: false }, counts), { alex: 0, sam: 0 });
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

test("fin de session : la marmite pesée devient une réserve ; manger, deux fois, annuler, réajuster", () => {
  const { db, r } = setup();
  const m = calcModel(db, r.slug, { cookedOn: "2026-11-01", week: true }, NOW)!;
  assert.deepEqual(m.groups.map((g) => g.key), ["plat", "riz", "haricots-verts"]);
  assert.deepEqual(m.people.map((p) => [p.id, p.planned, p.late]), [["alex", 3, 1], ["sam", 2, 0]]);
  const data = sessionReserves(db, "S", NOW)!;
  assert.equal(data.models.length, 1);
  assert.deepEqual(data.saved, {});

  const counts = { alex: 4, sam: 3 };
  const saved = saveReserve(db, "S", r.id, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts, freezer: { alex: 1 } }, NOW);
  assert.equal(saved.boxes, 1);
  const box = db.select().from(mealBoxes).get()!;
  assert.equal(box.place, "freezer");
  assert.equal(box.reserveId, saved.reserveId);
  assert.ok(box.portion!.plat > 0 && box.portion!.riz > 0);

  const later = new Date("2026-11-02T11:30:00Z");
  let dish = listDishes(db, "alex", later).find((d) => d.status === "cooked")!;
  assert.deepEqual(dish.people.map((p) => [p.name, p.total, p.left, p.inBoxes]), [["Alex", 4, 4, 1], ["Sam", 3, 3, 0]]);
  assert.equal(dish.groups[0].leftG, 1500 - box.portion!.plat);
  assert.deepEqual(dish.people[0].portion!.grams.map((g) => g.key), ["plat", "riz", "haricots-verts"]);
  assert.equal(dish.limit, "2026-11-05");
  // La personne active d'abord.
  assert.equal(listDishes(db, "sam", later)[0].people[0].name, "Sam");

  // Alex mange une portion, puis une deuxième le soir : deux lignes au journal.
  const s1 = eatPortion(db, dish.id, "alex", {}, later);
  assert.equal(s1.meal, "lunch");
  assert.equal(s1.source, "recipient");
  const s2 = eatPortion(db, dish.id, "alex", {}, new Date("2026-11-02T18:30:00Z"));
  assert.equal(s2.meal, "dinner");
  const entries = listEntries(db, "alex", "2026-11-02");
  assert.equal(entries.length, 2);
  assert.match(entries[0].label, /^Poulet teriyaki.*\(plat \d+ g, riz \d+ g, haricots verts \d+ g\)$/);
  assert.equal(entries[0].kcal, s1.kcal);
  dish = listDishes(db, "alex", later).find((d) => d.id === dish.id)!;
  assert.deepEqual([dish.people[0].eaten, dish.people[0].left], [2, 2]);

  // Sam prend plus que sa portion (saisi) : les autres portions restantes rapetissent.
  const samBefore = dish.people.find((p) => p.name === "Sam")!.portion!.grams[0].g;
  const alexBefore = dish.people[0].portion!.grams[0].g;
  eatPortion(db, dish.id, "sam", { grams: { plat: 400, riz: 100 } }, later);
  dish = listDishes(db, "alex", later).find((d) => d.id === dish.id)!;
  assert.ok(dish.people[0].portion!.grams[0].g < alexBefore);
  assert.ok(dish.people.find((p) => p.name === "Sam")!.portion!.grams[0].g < samBefore);

  // Annuler la deuxième portion d'Alex : la ligne du journal part, la portion revient.
  undoServing(db, s2.id, "alex");
  assert.equal(listEntries(db, "alex", "2026-11-02").length, 1);
  assert.equal(listDishes(db, "alex", later).find((d) => d.id === dish.id)!.people[0].left, 3);
  assert.throws(() => undoServing(db, s1.id, "sam"), /introuvable/);
  // Retirer la ligne du journal annule aussi la portion.
  deleteEntry(db, s1.entryId!);
  assert.equal(recentServings(db, "alex", later).length, 0);
  assert.equal(listDishes(db, "alex", later).find((d) => d.id === dish.id)!.people[0].left, 4);

  // Réajuster : nouvelle pesée du plat, une portion de moins pour Sam.
  adjustReserve(db, dish.id, { weights: { plat: 900 }, left: { sam: 1 } }, new Date("2026-11-03T08:00:00Z"));
  dish = listDishes(db, "alex", later).find((d) => d.id === dish.id)!;
  assert.equal(dish.groups[0].leftG, 900);
  assert.deepEqual(dish.people.find((p) => p.name === "Sam")!.left, 1);
  assert.throws(() => adjustReserve(db, dish.id, { left: { sam: -1 } }), /portions/);

  // Ranger à nouveau depuis la session : les portions mangées restent comptées.
  const again = sessionReserves(db, "S", NOW)!.saved[r.id];
  assert.equal(again.counts.sam, 1);
});

test("manger la boîte, puis tout : la réserve se ferme ; annuler la rouvre", () => {
  const { db, r } = setup();
  const { reserveId } = saveReserve(db, "S", r.id, { weights: { plat: 400, riz: 300, "haricots-verts": 100 }, counts: { alex: 1, sam: 0 }, freezer: {} }, NOW);
  const s = eatPortion(db, reserveId, "alex", {}, new Date("2026-11-02T11:30:00Z"));
  assert.equal(listDishes(db, "alex", new Date("2026-11-02T12:00:00Z")).filter((d) => d.status === "cooked").length, 0);
  assert.equal(db.select().from(reserves).get()!.status, "closed");
  undoServing(db, s.id);
  assert.equal(listDishes(db, "alex", new Date("2026-11-02T12:00:00Z")).filter((d) => d.status === "cooked").length, 1);
  // Plus de portion pour Sam : il en mange une quand même, à sa mesure ; son total monte.
  eatPortion(db, reserveId, "sam", {}, new Date("2026-11-02T19:00:00Z"));
  const dish = listDishes(db, "alex", new Date("2026-11-02T20:00:00Z")).find((d) => d.status === "cooked")!;
  assert.deepEqual(dish.people.find((p) => p.personId === "sam")!.total, 1);
  assert.throws(() => eatPortion(db, "inconnu", "alex"), /plus en réserve/);
});

test("boîtes d'avant : reprises dans une réserve, toujours au frigo, mangées comme avant", () => {
  const { db, r } = setup();
  const box = (id: string, personId: string | null, place: "fridge" | "freezer") => ({ id, sessionId: "S", recipeId: r.id, name: r.name, personId, grams: 300, sideGrams: 150, sideLabel: "riz", kcal: 600, proteinG: 40, cookedOn: "2026-11-01", place, fridgeDays: 4, createdAt: "2026-11-01T17:00:00.000Z" });
  db.insert(mealBoxes).values([box("b1", "alex", "fridge"), box("b2", "alex", "freezer"), box("b3", "sam", "fridge"), box("b4", null, "fridge")]).run();
  assert.equal(adoptLegacyBoxes(db), 1);
  assert.equal(adoptLegacyBoxes(db), 0);
  const dish = listDishes(db, "alex", new Date("2026-11-02T11:00:00Z")).find((d) => d.status === "cooked")!;
  assert.deepEqual(dish.groups.map((g) => [g.key, g.label, g.leftG]), [["plat", "plat", 0], ["garniture", "riz", 0]]);
  assert.deepEqual(dish.people.map((p) => [p.name, p.left, p.inBoxes, p.next?.source]), [["Alex", 2, 2, "boite"], ["Sam", 1, 1, "boite"]]);
  assert.equal(dish.people[0].next!.boxId, "b1", "celle du frigo d'abord");
  assert.equal(dish.boxes.length, 4);
  // Le Frigo d'avant lit toujours ses boîtes ; « Je la mange » passe par la réserve.
  assert.equal(listStock(db, "2026-11-02").length, 4);
  const e = eatBox(db, "b1", "alex", new Date("2026-11-02T11:30:00Z"));
  assert.equal(e.kcal, 600);
  assert.match(e.label, /\(plat 300 g, riz 150 g\)/);
  assert.equal(listStock(db, "2026-11-02").length, 3);
  const after = listDishes(db, "alex", new Date("2026-11-02T12:00:00Z")).find((d) => d.status === "cooked")!;
  assert.deepEqual([after.people[0].left, after.people[0].eaten], [1, 1]);
  // Annuler depuis le journal : la boîte revient au frigo.
  deleteEntry(db, e.id);
  assert.equal(listStock(db, "2026-11-02").length, 4);
  assert.equal(db.select().from(foodLog).all().length, 0);
});

test("plats prévus pas encore cuisinés : les portions prévues de chacun", () => {
  const { db } = setup();
  const planned = listDishes(db, "sam", new Date("2026-11-01T09:00:00Z")).filter((d) => d.status === "planned");
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0].people.map((p) => [p.name, p.total]), [["Sam", 2], ["Alex", 3]]);
});
