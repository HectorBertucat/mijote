// Description de la cuisine (src/lib/kitchen/presets.ts) : préréglages de plaque, récipients détaillés,
// compatibilités foyer × récipient, ancien format, et l'air fryer dans le planificateur de session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { equipment } from "@/lib/db/schema";
import {
  CATALOG_KITCHEN,
  DEFAULT_KITCHEN,
  HOB_PRESETS,
  casseroleSlots,
  hobPresets,
  kitchenEquipment,
  kitchenHobs,
  kitchenSummary,
  matchHobPreset,
  normalizeKitchen,
  panRoles,
  parseKitchen,
  vesselFitsHob,
  type KitchenConfig,
} from "@/lib/kitchen/presets";
import { applyKitchen } from "@/lib/kitchen/store";
import { loadResources } from "@/lib/session/store";
import { convertForSwap, planSession, validatePlan, type PlannerRecipe, type PlannerResources } from "@/lib/session/planner";
import { seedBase } from "@/seed/seed";
import { load } from "./helpers";

const D = DEFAULT_KITCHEN;
const resOf = (c: KitchenConfig): PlannerResources => {
  const k = kitchenEquipment(c);
  return {
    equipment: k.equipment.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1 })),
    fits: k.fits.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
  };
};
const on = (c: KitchenConfig, id: string) => kitchenEquipment(c).fits.filter((f) => f.equipmentId === id).map((f) => f.hobId).sort();

// ─── Préréglages ───

test("préréglages de plaque : chacun donne ses foyers, la poêle et la cocotte trouvent un foyer idéal", () => {
  for (const type of ["induction", "gaz"] as const)
    for (const p of hobPresets(type)) {
      const c = { ...D, hobType: type, hobSizes: p.sizes };
      const { equipment: eqs, fits } = kitchenEquipment(c);
      const hobs = eqs.filter((e) => e.kind === "hob");
      assert.equal(hobs.length, p.sizes.length, p.id);
      assert.equal(new Set(hobs.map((h) => h.id)).size, hobs.length, `${p.id} : ids uniques`);
      for (const v of ["poele-28", "cocotte", "faitout", "casserole-14"]) assert.ok(fits.some((f) => f.equipmentId === v && f.preferred), `${p.id} : ${v}`);
      assert.equal(matchHobPreset(type, p.sizes)?.id, p.id);
    }
  const trois = HOB_PRESETS.find((p) => p.id === "trois-28")!;
  assert.deepEqual(trois.sizes, D.hobSizes, "la plaque par défaut est le préréglage à 3 foyers");
  assert.ok(trois.sizes.includes(28));
  assert.deepEqual(HOB_PRESETS.map((p) => p.sizes.length).sort(), [2, 3, 4, 5]);
  assert.equal(matchHobPreset("induction", [24, 12]), null, "plaque sur mesure");
});

test("foyers : du plus grand au plus petit, nommés par rang, deux foyers de même taille gardent des ids distincts", () => {
  const hobs = kitchenHobs([18, 21, 18, 14.5]);
  assert.deepEqual(hobs.map((h) => h.id), ["hob-21", "hob-18", "hob-18b", "hob-14"]);
  assert.deepEqual(hobs.map((h) => h.name), ["Grand foyer", "Foyer moyen", "Foyer 3", "Petit foyer"]);
  assert.deepEqual(kitchenHobs(D.hobSizes).map((h) => h.id), ["hob-28", "hob-21", "hob-14"], "ids d'avant inchangés");
  assert.deepEqual(kitchenHobs([40, 3]).map((h) => h.cm), [36, 10], "diamètres bornés");
});

// ─── Compatibilités ───

test("compatibilités : la taille du récipient décide du foyer", () => {
  assert.ok(vesselFitsHob("poele", 28, 28) && vesselFitsHob("poele", 28, 21) && !vesselFitsHob("poele", 28, 14.5));
  assert.ok(!vesselFitsHob("poele", 20, 28), "petite poêle sur un grand foyer : non");
  assert.ok(vesselFitsHob("cocotte", 26, 28) && !vesselFitsHob("cocotte", 26, 21));
  assert.ok(vesselFitsHob("casserole", 14, 14.5) && !vesselFitsHob("casserole", 14, 21));
  assert.ok(vesselFitsHob("faitout", 21, 28) && vesselFitsHob("faitout", 21, 14.5));

  assert.deepEqual(on(D, "casserole-14"), ["hob-14"]);
  assert.deepEqual(on(D, "cocotte"), ["hob-28", "oven"]);
  const pan = kitchenEquipment(D).fits.filter((f) => f.equipmentId === "poele-28");
  assert.deepEqual(pan.filter((f) => f.preferred).map((f) => f.hobId), ["hob-28"], "la poêle de 28 cm préfère le foyer de 28 cm");
});

test("cocotte et faitout : au four seulement s'ils y passent et qu'il y a un four", () => {
  assert.ok(!on({ ...D, cocotte: { liters: 6, ovenSafe: false } }, "cocotte").includes("oven"));
  assert.ok(!on({ ...D, oven: false }, "cocotte").includes("oven"));
  assert.ok(on({ ...D, faitout: { liters: 8, ovenSafe: true } }, "faitout").includes("oven"));
  assert.ok(!on(D, "faitout").includes("oven"));
  const cocotte = kitchenEquipment({ ...D, cocotte: { liters: 4, ovenSafe: true } }).equipment.find((e) => e.id === "cocotte")!;
  assert.equal(cocotte.capacityL, 4);
  assert.equal(cocotte.dimsJson?.ovenSafe, 1);
});

test("casseroles : rangées sur le rôle de leur taille (une seule grande = la grande casserole)", () => {
  assert.deepEqual(casseroleSlots([{ cm: 20, liters: null }]).map((k) => k.id), ["casserole-18"]);
  assert.deepEqual(casseroleSlots([{ cm: 20, liters: 3 }, { cm: 14, liters: null }]).map((k) => k.id), ["casserole-14", "casserole-18"]);
  assert.deepEqual(casseroleSlots(D.casseroles).map((k) => k.id), ["casserole-14", "casserole-16", "casserole-18"]);
  const k = kitchenEquipment({ ...D, casseroles: [{ cm: 16, liters: 2.5 }, { cm: 14, liters: null }] }).equipment.filter((e) => e.id.startsWith("casserole"));
  assert.deepEqual(k.map((e) => [e.id, e.capacityL]), [["casserole-14", 1], ["casserole-16", 2.5]], "contenance donnée, ou estimée d'après le diamètre");
});

test("poêles : la plus grande en inox ou en fonte saisit, sa fournée suit son diamètre", () => {
  const roles = panRoles([{ material: "antiadhesive", cm: 28 }, { material: "inox", cm: 24 }]);
  assert.deepEqual(roles.map((r) => [r.id, r.pan.material]), [["poele-28", "inox"], ["poele-2", "antiadhesive"]]);
  const eqs = kitchenEquipment({ ...D, pans: [{ material: "antiadhesive", cm: 28 }, { material: "inox", cm: 24 }] }).equipment;
  const main = eqs.find((e) => e.id === "poele-28")!;
  assert.equal(main.name, "Poêle inox 24 cm");
  assert.equal(main.maxBatchG, 350);
  assert.equal(eqs.find((e) => e.id === "poele-28" && e.kind === "pan")?.dimsJson?.diameterCm, 24);
  assert.equal(kitchenEquipment({ ...D, poeleMaxG: 700 }).equipment.find((e) => e.id === "poele-28")!.maxBatchG, 700, "fournée réglée à la main");
  assert.ok(!kitchenEquipment({ ...D, pans: [] }).equipment.some((e) => e.kind === "pan"));
});

test("appareils : air fryer avec sa contenance, mixeurs et autres", () => {
  const eqs = kitchenEquipment({ ...D, airFryerL: 5.5, mixers: { plongeant: true, blender: true, hachoir: false } }).equipment;
  const af = eqs.find((e) => e.id === "air-fryer")!;
  assert.equal(af.kind, "appliance");
  assert.equal(af.capacityL, 5.5);
  assert.equal(af.maxBatchG, 850);
  assert.ok(eqs.some((e) => e.id === "mixeur") && eqs.some((e) => e.id === "blender") && !eqs.some((e) => e.id === "hachoir"));
  assert.ok(!kitchenEquipment(D).equipment.some((e) => e.id === "air-fryer"), "pas d'air fryer par défaut");
  // Le catalogue contient tout ce qu'une recette peut citer.
  const all = new Set(kitchenEquipment(CATALOG_KITCHEN).equipment.map((e) => e.id));
  for (const id of ["poele-28", "poele-2", "poele-3", "cocotte", "faitout", "casserole-14", "casserole-16", "casserole-18", "plat-grand", "plat-moyen", "plat-four", "oven", "air-fryer", "mixeur", "blender", "hachoir"]) assert.ok(all.has(id), id);
});

// ─── Lecture, ancien format, « je ne sais pas » ───

test("ancien format de cuisine (nombre de foyers, cases à cocher) : traduit sans rien perdre", () => {
  const old = parseKitchen(JSON.stringify({ hobType: "gaz", hobs: 2, levels: 0, oven: true, ovenLevels: 4, vessels: { poele: true, poeleMaxG: 600, cocotte: false, faitout: true, casseroles: 1, plats: 2 }, extras: { microOndes: false, congelateur: true, mixeur: true }, duo: false }));
  assert.equal(old.hobType, "gaz");
  assert.deepEqual(old.hobSizes, [28, 21]);
  assert.equal(old.poeleMaxG, 600);
  assert.equal(old.cocotte, null);
  assert.ok(old.faitout);
  assert.deepEqual(old.casseroles.map((k) => k.cm), [14]);
  assert.equal(old.plats, 2);
  assert.equal(old.mixers.plongeant, true);
  assert.equal(old.extras.microOndes, false);
  assert.equal(old.duo, false);
  const ids = kitchenEquipment(old).equipment.map((e) => e.id);
  assert.deepEqual(ids.filter((id) => /^(hob|poele|casserole|plat)/.test(id)), ["hob-28", "hob-21", "poele-28", "casserole-14", "plat-grand", "plat-moyen"]);
  // L'ancienne cuisine par défaut donne le même équipement qu'avant.
  const legacyDefault = parseKitchen(JSON.stringify({ hobType: "induction", hobs: 3, levels: 9, oven: true, ovenLevels: 5, vessels: { poele: true, poeleMaxG: 500, cocotte: true, faitout: true, casseroles: 3, plats: 3 }, extras: { microOndes: true, congelateur: true, mixeur: false }, duo: true }));
  assert.deepEqual(kitchenEquipment(legacyDefault).fits, kitchenEquipment(D).fits);
});

test("cuisine relue : JSON cassé, types faux, « je ne sais pas » noté", () => {
  assert.deepEqual(parseKitchen("{pas du json"), D);
  assert.deepEqual(normalizeKitchen(D), D, "la cuisine par défaut est stable");
  const c = normalizeKitchen({ hobType: "plasma", hobSizes: ["x", 21], pans: [{ material: "cuivre", cm: 50 }], airFryerL: -2, unsure: ["pans", "inconnu", "hobSizes"] });
  assert.equal(c.hobType, "induction");
  assert.deepEqual(c.hobSizes, [21]);
  assert.deepEqual(c.pans, [{ material: "inox", cm: 36 }]);
  assert.equal(c.airFryerL, 0);
  assert.deepEqual(c.unsure, ["hobSizes", "pans"]);
  const sum = kitchenSummary(c);
  assert.ok(sum.find((r) => r.label === "Plaque")!.unsure);
  assert.ok(sum.find((r) => r.label === "Poêles")!.unsure);
  assert.ok(!sum.find((r) => r.label === "Four")!.unsure);
  assert.match(kitchenSummary({ ...D, airFryerL: 5 }).find((r) => r.label === "Appareils")!.text, /air fryer 5 L/);
});

// ─── En base ───

test("cuisine appliquée : un foyer retiré n'est plus possédé, un nom jamais retouché suit la description", () => {
  const { db } = openDb(":memory:");
  seedBase(db);
  applyKitchen(db, { ...D, hobSizes: [21, 18, 18, 14.5] });
  assert.deepEqual(loadResources(db).equipment.filter((e) => e.kind === "hob").map((e) => e.id).sort(), ["hob-14", "hob-18", "hob-18b", "hob-21"]);
  applyKitchen(db, { ...D, hobSizes: [21, 16] });
  assert.deepEqual(loadResources(db).equipment.filter((e) => e.kind === "hob").map((e) => e.id).sort(), ["hob-16", "hob-21"]);

  db.update(equipment).set({ name: "Casserole 1 (petite)" }).where(eq(equipment.id, "casserole-14")).run();
  db.update(equipment).set({ name: "La casserole de famille" }).where(eq(equipment.id, "casserole-16")).run();
  applyKitchen(db, { ...D, casseroles: [{ cm: 14, liters: 1 }, { cm: 16, liters: null }] });
  assert.equal(db.select().from(equipment).where(eq(equipment.id, "casserole-14")).get()!.name, "Petite casserole 14 cm");
  assert.equal(db.select().from(equipment).where(eq(equipment.id, "casserole-16")).get()!.name, "La casserole de famille");
  applyKitchen(db, { ...D, pans: [{ material: "fonte", cm: 26 }] });
  assert.equal(db.select().from(equipment).where(eq(equipment.id, "poele-28")).get()!.name, "Poêle fonte 26 cm", "nom donné par la cuisine précédente : suit");
});

// ─── Air fryer et planificateur ───

/** Pommes de terre rôties : écrites pour l'air fryer, avec le grand plat au four en rechange. */
const potatoes = (grams = 600, alt = ["plat-grand"]): PlannerRecipe => ({
  slug: "pommes-de-terre-rotie",
  name: "Pommes de terre rôties",
  ingredients: [{ id: "pdt", item: "pommes de terre", grams, group: "A" }],
  steps: [
    { kind: "prep", text: "Bol A : pommes de terre en quartiers, huile, sel.", durationMin: 6, bowls: ["A"] },
    { kind: "bake", text: "Pommes de terre (bol A) dans l'air fryer, 20 min à 180 °C. Secoue à mi-cuisson.", durationMin: 20, activeMin: 2, equipmentId: "air-fryer", equipmentAlt: alt, ovenTemp: 180, bowls: ["A"] },
  ],
});

test("air fryer : récipient du planificateur, ni foyer ni four, avec sa note", () => {
  const res = resOf({ ...D, airFryerL: 5 });
  const plan = planSession([potatoes()], res);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validatePlan(plan, res), []);
  const s = plan.steps.find((x) => x.equipmentId === "air-fryer")!;
  assert.ok(s, JSON.stringify(plan.steps.map((x) => x.equipmentId)));
  assert.equal(s.oven, null, "le four reste libre");
  assert.equal(s.hobId, null);
  assert.equal(s.durationMin, 20);
  assert.ok(s.notes.some((n) => /Air fryer à 180 °C/.test(n)), JSON.stringify(s.notes));
  assert.ok(!plan.steps.some((x) => x.kind === "preheat"), "pas de préchauffage du four");
});

test("sans air fryer : la recette passe au four (rechange), température et durée converties", () => {
  const res = resOf(D);
  const plan = planSession([potatoes()], res);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validatePlan(plan, res), []);
  const s = plan.steps.find((x) => x.equipmentId === "plat-grand")!;
  assert.ok(s, JSON.stringify(plan.steps.map((x) => x.equipmentId)));
  assert.equal(s.oven?.temp, 200);
  assert.equal(s.durationMin, 25);
  assert.match(s.text, /dans le grand plat, 25 min à 200 °C/);
  assert.ok(plan.decisions?.some((d) => /grand plat au lieu de l'air fryer/.test(d)), JSON.stringify(plan.decisions));
  // Sans rechange ni air fryer : erreur claire, pas de plantage.
  const bare = planSession([potatoes(600, [])], res);
  assert.ok(bare.errors.some((e) => e.kind === "unknown_equipment" && /air-fryer/.test(e.message)));
});

test("le four pris à une autre température : le planificateur passe une plaque à l'air fryer", () => {
  const forno = load("pasta-al-forno.json"); // four à 200 °C
  const veg: PlannerRecipe = {
    slug: "legumes-rotis",
    name: "Légumes rôtis",
    ingredients: [{ id: "leg", item: "légumes", grams: 500, group: "A" }],
    steps: [
      { kind: "prep", text: "Bol A : légumes en morceaux, huile.", durationMin: 8, bowls: ["A"] },
      { kind: "bake", text: "Enfourne le grand plat (bol A) : 30 min à 160 °C.", durationMin: 30, activeMin: 2, equipmentId: "plat-grand", equipmentAlt: ["air-fryer"], ovenTemp: 160, bowls: ["A"] },
    ],
  };
  const res = resOf({ ...D, airFryerL: 5 });
  const plan = planSession([forno, veg], res);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validatePlan(plan, res), []);
  const s = plan.steps.find((x) => x.recipeSlug === "legumes-rotis" && x.kind === "bake")!;
  assert.equal(s.equipmentId, "air-fryer");
  assert.equal(s.oven, null);
  assert.equal(s.durationMin, 24);
  assert.match(s.text, /^Mets le tout dans l'air fryer \(bol [A-Z]\) : 24 min à 140 °C\.$/);
  // Trop pour le panier : pas de rechange vers l'air fryer.
  const big = { ...veg, ingredients: [{ id: "leg", item: "légumes", grams: 2000, group: "A" }] };
  const p2 = planSession([forno, big], res);
  assert.ok(!p2.steps.some((x) => x.equipmentId === "air-fryer"));
});

test("conversion four ↔ air fryer : températures et minutes du texte suivent", () => {
  const s = { kind: "bake" as const, text: "Au four, 20 à 25 min à 200 °C, puis 5 min de repos.", durationMin: 30, activeMin: 2, ovenTemp: 200 };
  const af = convertForSwap(s, "plat-grand", "air-fryer");
  assert.equal(af.ovenTemp, 180);
  assert.equal(af.durationMin, 24);
  assert.equal(af.text, "Au four, 16 à 20 min à 180 °C, puis 4 min de repos.");
  const back = convertForSwap(af, "air-fryer", "plat-grand");
  assert.equal(back.ovenTemp, 200);
  assert.equal(back.durationMin, 30);
  assert.equal(convertForSwap(s, "cocotte", "faitout"), s, "les autres rechanges ne convertissent rien");
  assert.equal(convertForSwap({ ...s, ovenTemp: 150 }, "plat-grand", "air-fryer").ovenTemp, 140, "jamais sous 140 °C");
});

test("air fryer partagé par deux recettes : jamais en même temps", () => {
  const res = resOf({ ...D, airFryerL: 5 });
  const other = { ...potatoes(), slug: "frites", name: "Frites" };
  const plan = planSession([potatoes(600, []), { ...other, steps: other.steps.map((s) => ({ ...s, equipmentAlt: [] })) }], res);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(validatePlan(plan, res), []);
  const [a, b] = plan.steps.filter((x) => x.equipmentId === "air-fryer");
  assert.ok(a.endMin <= b.startMin + 1e-6 || b.endMin <= a.startMin + 1e-6);
});
