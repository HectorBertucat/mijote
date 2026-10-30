// Instance neuve : foyer, réglages, cuisine réglable (src/lib/household.ts, src/lib/settings.ts,
// src/lib/kitchen/). Une instance doit marcher pour 1 à N personnes et toutes les cuisines.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { equipment, mealSlots, people, preferences, weighIns } from "@/lib/db/schema";
import { addPerson, personId, removePerson, renamePerson } from "@/lib/household";
import { getSetting, isSetupDone, setSetting, SETTING, storeLabel } from "@/lib/settings";
import { householdMembers, householdUnits, leadOf, loadEaters } from "@/lib/eaters/store";
import { DEFAULT_KITCHEN, kitchenEquipment, parseKitchen, type KitchenConfig } from "@/lib/kitchen/presets";
import { applyKitchen, loadKitchen } from "@/lib/kitchen/store";
import { loadPlannerRecipes, loadResources } from "@/lib/session/store";
import { planSession, validatePlan } from "@/lib/session/planner";
import { syncRecipes } from "@/seed/bootstrap";
import { seedBase } from "@/seed/seed";
import { listPeople } from "@/lib/health/store";
import { ensureWeek } from "@/lib/week/store";

const fresh = () => {
  const { db } = openDb(":memory:");
  seedBase(db);
  return db;
};
const RECIPES = path.join(process.cwd(), "src/seed/recipes");

// ─── Instance neuve ───

test("instance neuve : personne, mise en route à faire, et les recettes de démo s'importent quand même", () => {
  const db = fresh();
  assert.equal(listPeople(db).length, 0);
  assert.equal(isSetupDone(db), false);
  assert.ok(db.select().from(equipment).all().length > 10, "cuisine standard posée");
  const done = syncRecipes(db, RECIPES);
  assert.equal(done.length, fs.readdirSync(RECIPES).filter((f) => f.endsWith(".json")).length);
  // Sans mangeur, rien ne casse : part de base, pas de repère.
  assert.deepEqual(loadEaters(db), []);
  assert.equal(leadOf([]).ref, null);
  assert.ok(householdUnits([]) > 0);
  assert.deepEqual(householdMembers(db), []);
  // Le seed repasse sans doublon.
  const n = db.select().from(preferences).all().length;
  seedBase(db);
  assert.equal(db.select().from(preferences).all().length, n);
});

// ─── Foyer ───

test("foyer : ids lisibles et uniques, ordre d'arrivée, pesée de départ, bornes de part", () => {
  const db = fresh();
  const a = addPerson(db, { name: "  Léa ", portionUnits: 4, weightKg: 61.5, sex: "f", heightCm: 165 });
  const b = addPerson(db, { name: "Léa", portionUnits: 50 });
  const c = addPerson(db, { name: "Émile-Jean", portionUnits: 0 });
  assert.deepEqual([a, b, c], ["lea", "lea-2", "emile-jean"]);
  assert.equal(personId(db, "LÉA"), "lea-3");
  const ps = listPeople(db);
  assert.deepEqual(ps.map((p) => [p.id, p.rank]), [["lea", 0], ["lea-2", 1], ["emile-jean", 2]]);
  assert.equal(ps[0].name, "Léa");
  assert.equal(ps[1].portionUnits, 8, "part bornée en haut");
  assert.equal(ps[2].portionUnits, 2, "part bornée en bas");
  assert.equal(db.select().from(weighIns).where(eq(weighIns.personId, "lea")).all()[0]?.kg, 61.5);
  assert.throws(() => addPerson(db, { name: "   ", portionUnits: 4 }), /prénom/);
});

test("foyer : renommer, retirer tant qu'il n'y a pas d'historique, et pas après", () => {
  const db = fresh();
  const a = addPerson(db, { name: "Alex", portionUnits: 5 });
  const b = addPerson(db, { name: "Sam", portionUnits: 4 });
  renamePerson(db, a, "Alexandre", 6);
  assert.deepEqual(listPeople(db).map((p) => [p.name, p.portionUnits]), [["Alexandre", 6], ["Sam", 4]]);
  db.insert(preferences).values({ id: "x1", personId: b, kind: "dislike", text: "Brocoli", tags: [] }).run();
  assert.equal(removePerson(db, b).ok, true, "goûts retirés avec la personne");
  // Une semaine ouverte crée ses cases : Alexandre a un historique.
  ensureWeek(db, "2026-10-26");
  assert.ok(db.select().from(mealSlots).where(eq(mealSlots.personId, a)).all().length > 0);
  const r = removePerson(db, a);
  assert.equal(r.ok, false);
  assert.match(r.error!, /historique/);
  assert.equal(listPeople(db).length, 1);
});

test("foyer : la personne demandée passe en tête, avec ses goûts (retirés exclus)", () => {
  const db = fresh();
  addPerson(db, { name: "Alex", portionUnits: 5 });
  const sam = addPerson(db, { name: "Sam", portionUnits: 4 });
  db.insert(preferences).values([
    { id: "d1", personId: sam, kind: "dislike", text: "Brocoli", tags: ["ingredient"] },
    { id: "d2", personId: sam, kind: "dislike", text: "Olives", tags: ["retiré"] },
  ]).run();
  const m = householdMembers(db, sam);
  assert.deepEqual(m.map((x) => x.id), ["sam", "alex"]);
  assert.deepEqual(m[0].dislikes, ["Brocoli"]);
  assert.equal(householdMembers(db, "inconnu")[0].id, "alex");
  assert.equal(leadOf(loadEaters(db), sam).name, "Sam");
  assert.equal(householdUnits(loadEaters(db)), 9);
});

// ─── Réglages ───

test("réglages : écrire, relire, effacer avec une valeur vide", () => {
  const db = fresh();
  assert.equal(storeLabel(db), null);
  setSetting(db, SETTING.storeLabel, "Le drive de Rennes");
  setSetting(db, SETTING.storeLabel, "Le marché du samedi");
  assert.equal(storeLabel(db), "Le marché du samedi");
  setSetting(db, SETTING.storeLabel, "");
  assert.equal(getSetting(db, SETTING.storeLabel), null);
  setSetting(db, SETTING.setupDone, "2026-10-28T10:00:00Z");
  assert.equal(isSetupDone(db), true);
});

// ─── Cuisine ───

const CONFIGS: [string, KitchenConfig][] = [
  ["défaut", DEFAULT_KITCHEN],
  ["studio : 2 foyers, pas de four", { ...DEFAULT_KITCHEN, hobs: 2, oven: false, vessels: { ...DEFAULT_KITCHEN.vessels, casseroles: 1, plats: 0 } }],
  ["gaz 4 feux, sans niveaux", { ...DEFAULT_KITCHEN, hobType: "gaz", hobs: 4, levels: 0 }],
  ["un seul foyer", { ...DEFAULT_KITCHEN, hobs: 1 }],
  ["grande cuisine", { ...DEFAULT_KITCHEN, hobs: 5, levels: 12, ovenLevels: 7, extras: { microOndes: true, congelateur: true, mixeur: true } }],
  ["valeurs absurdes", { ...DEFAULT_KITCHEN, hobs: 40, levels: -3, ovenLevels: 0, vessels: { ...DEFAULT_KITCHEN.vessels, casseroles: 9, plats: -1, poeleMaxG: 1 } }],
];

for (const [name, c] of CONFIGS) {
  test(`cuisine « ${name} » : équipement cohérent, chaque récipient a un foyer`, () => {
    const { equipment: eq, fits } = kitchenEquipment(c);
    const ids = new Set(eq.map((e) => e.id));
    assert.equal(ids.size, eq.length, "ids uniques");
    const hobs = eq.filter((e) => e.kind === "hob");
    assert.ok(hobs.length >= 1 && hobs.length <= 5);
    assert.equal(ids.has("oven"), c.oven);
    if (!c.oven) assert.ok(!eq.some((e) => e.kind === "dish"), "pas de plat à four sans four");
    for (const f of fits) assert.ok(ids.has(f.equipmentId) && ids.has(f.hobId), `${f.equipmentId} → ${f.hobId}`);
    for (const v of eq.filter((e) => e.kind === "pan" || e.kind === "pot")) {
      const mine = fits.filter((f) => f.equipmentId === v.id && hobs.some((h) => h.id === f.hobId));
      assert.ok(mine.length > 0, `${v.id} sans foyer`);
      assert.ok(mine.some((f) => f.preferred), `${v.id} sans foyer idéal`);
    }
    const pan = eq.find((e) => e.id === "poele-28");
    if (pan) assert.ok(pan.maxBatchG! >= 200 && pan.maxBatchG! <= 1500);
  });
}

test("cuisine : une petite casserole ne va pas sur le grand foyer, la cocotte seulement sur le grand", () => {
  const { fits } = kitchenEquipment(DEFAULT_KITCHEN);
  const on = (id: string) => fits.filter((f) => f.equipmentId === id).map((f) => f.hobId).sort();
  assert.deepEqual(on("casserole-14"), ["hob-14"]);
  assert.deepEqual(on("cocotte"), ["hob-28", "oven"]);
  assert.deepEqual(on("faitout"), ["hob-14", "hob-21", "hob-28"]);
});

test("cuisine : réglage relu avec tolérance (JSON cassé, champs manquants)", () => {
  assert.deepEqual(parseKitchen(null), DEFAULT_KITCHEN);
  assert.deepEqual(parseKitchen("{pas du json"), DEFAULT_KITCHEN);
  const p = parseKitchen(JSON.stringify({ hobs: 2, vessels: { cocotte: false } }));
  assert.equal(p.hobs, 2);
  assert.equal(p.vessels.cocotte, false);
  assert.equal(p.vessels.poele, true, "le reste prend la valeur par défaut");
});

test("cuisine appliquée : seul l'équipement coché compte, les recettes s'importent toujours", () => {
  const db = fresh();
  applyKitchen(db, { ...DEFAULT_KITCHEN, hobs: 2, oven: false, vessels: { ...DEFAULT_KITCHEN.vessels, cocotte: false, plats: 0 } });
  assert.equal(loadKitchen(db).hobs, 2);
  const res = loadResources(db);
  assert.ok(!res.equipment.some((e) => e.id === "cocotte" || e.id === "oven"));
  assert.equal(res.equipment.filter((e) => e.kind === "hob").length, 2);
  // Les recettes citent la cocotte et le four : elles s'importent (clé étrangère) sans planter.
  assert.ok(db.select().from(equipment).where(eq(equipment.id, "cocotte")).get(), "la cocotte existe, non possédée");
  assert.equal(syncRecipes(db, RECIPES).length, fs.readdirSync(RECIPES).filter((f) => f.endsWith(".json")).length);
  // Réappliquer une cuisine complète rend tout.
  applyKitchen(db, DEFAULT_KITCHEN);
  assert.ok(loadResources(db).equipment.some((e) => e.id === "cocotte"));
});

test("planificateur dans une petite cuisine : un plan ou des erreurs claires, jamais un plantage", () => {
  const db = fresh();
  syncRecipes(db, RECIPES);
  const slugs = fs.readdirSync(RECIPES).map((f) => JSON.parse(fs.readFileSync(path.join(RECIPES, f), "utf8")).slug as string);
  for (const [name, c] of CONFIGS) {
    applyKitchen(db, c);
    const res = loadResources(db);
    for (let i = 0; i < slugs.length; i++) {
      const pair = [slugs[i], slugs[(i + 1) % slugs.length]];
      const plan = planSession(loadPlannerRecipes(db, pair), res);
      if (plan.errors.length) for (const e of plan.errors) assert.ok(e.message.length > 10, `${name} ${pair} : ${e.kind}`);
      else assert.deepEqual(validatePlan(plan, res), [], `${name} ${pair}`);
      assert.ok(Number.isFinite(plan.totalMin));
    }
  }
});

test("personnes en base : le rang ordonne aussi la Semaine", () => {
  const db = fresh();
  addPerson(db, { name: "Zoé", portionUnits: 3 });
  addPerson(db, { name: "Adam", portionUnits: 5 });
  assert.deepEqual(listPeople(db).map((p) => p.name), ["Zoé", "Adam"]);
  db.update(people).set({ rank: 5 }).where(eq(people.id, "zoe")).run();
  assert.deepEqual(listPeople(db).map((p) => p.name), ["Adam", "Zoé"]);
});

test("cuisine réappliquée : les noms et notes donnés aux récipients restent", () => {
  const db = fresh();
  applyKitchen(db, DEFAULT_KITCHEN);
  db.update(equipment).set({ name: "Poêle inox de famille", notes: "Préchauffer à vide." }).where(eq(equipment.id, "poele-28")).run();
  applyKitchen(db, { ...DEFAULT_KITCHEN, vessels: { ...DEFAULT_KITCHEN.vessels, poeleMaxG: 600 } });
  const pan = db.select().from(equipment).where(eq(equipment.id, "poele-28")).get()!;
  assert.equal(pan.name, "Poêle inox de famille");
  assert.equal(pan.notes, "Préchauffer à vide.");
  assert.equal(pan.maxBatchG, 600);
});

test("cuisine réappliquée : un équipement ajouté à la main n'est pas retiré", () => {
  const db = fresh();
  db.insert(equipment).values({ id: "sous-vide", kind: "appliance", name: "Appareil sous-vide" }).run();
  applyKitchen(db, { ...DEFAULT_KITCHEN, hobs: 2 });
  assert.equal(db.select().from(equipment).where(eq(equipment.id, "sous-vide")).get()!.owned, true);
});

test("import des recettes : les fichiers cachés (métadonnées macOS « ._x.json ») sont ignorés", () => {
  const db = fresh();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recettes-"));
  fs.copyFileSync(path.join(RECIPES, "chasseur-porc.json"), path.join(dir, "chasseur-porc.json"));
  fs.writeFileSync(path.join(dir, "._chasseur-porc.json"), Buffer.from([0, 5, 22, 7, 0, 2, 0, 0]));
  fs.mkdirSync(path.join(dir, ".cache"));
  fs.writeFileSync(path.join(dir, ".cache", "x.json"), "pas du json");
  assert.deepEqual(syncRecipes(db, dir).map((r) => r.file), ["chasseur-porc.json"]);
});
