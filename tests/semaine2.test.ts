// Semaine 2 : recettes combinées sans gaspillage (paquets entamés à travers toutes les
// recettes), unités par recette, liste de courses reliée à la semaine, goûts de Sam et
// d'Alex. Résolveur simulé : aucune requête vers chronocatalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { migrate, openDb } from "@/lib/db/open";
import * as schema from "@/lib/db/schema";
import { mealSlots, recipes, shoppingItems, shoppingItemSources, shoppingLists, weekPlans, weekRecipes } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import { TEST_PREFERENCES as PREFERENCES } from "./helpers";
import type { ResolveResponse, ResolvedProduct } from "@/lib/chronocatalog";
import { buildShoppingList, planList, type Ing } from "@/lib/shopping/build";
import { orderedIngredientsFor } from "@/lib/shopping/ordered";
import { assign, defaultPlace, propose, scoreSelection, stepFactor, unitsOf, type SlotIn, type WeekRecipe } from "@/lib/week/propose";
import { selectionWaste, wastePenalty, type PackProfiles } from "@/lib/week/waste";
import { buildProfiles } from "@/lib/week/packs";
import { adjustFor, leadPart, selectionLeftovers, type LeftoverRecipe } from "@/lib/week/leftovers";
import { dislikeRules, dislikesIn, exclusionsOf } from "@/lib/week/tastes";
import { composerHref, parseSelection } from "@/lib/week/selection";
import { addRecipe, ensureWeek, loadSelection, removeRecipe, setExtra, setFactor, weekList, weekView } from "@/lib/week/store";

// ─── Catalogue simulé ───

const CATALOG: Record<string, { slug: string; name: string; cat: string; packG: number; price: number }> = {
  jambonneau: { slug: "jambonneau", name: "Jambonneau", cat: "viande", packG: 600, price: 6 },
  pulpe: { slug: "pulpe_tomate", name: "Pulpe de tomates", cat: "epicerie_salee", packG: 400, price: 1 },
  creme: { slug: "creme_fraiche", name: "Crème fraîche légère", cat: "laitier", packG: 200, price: 1.5 },
  persil: { slug: "persil_frais", name: "Persil plat frais", cat: "legume", packG: 100, price: 1 },
  pates: { slug: "pates", name: "Pâtes penne", cat: "epicerie_salee", packG: 500, price: 1 },
  brocoli: { slug: "brocoli", name: "Brocoli", cat: "legume", packG: 500, price: 2 },
  poulet: { slug: "filet_poulet", name: "Filet de poulet", cat: "viande", packG: 1000, price: 10 },
};

const product = (k: string): ResolvedProduct => {
  const c = CATALOG[k];
  return {
    id: `p-${c.slug}`, name: c.name, slug: c.slug, productUrl: "", imageUrl: null, brandName: null, quantityLabel: `${c.packG} g`, weightG: c.packG, isFrozen: false,
    currentPrice: c.price, currentPricePerKg: null, promoPriceEur: null, stockStatus: "HIGH_STOCK", source: "chronodrive", isFavorite: false,
    availability: { status: "available", stockStatus: "HIGH_STOCK", label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false },
  };
};

const asked: string[] = [];
async function fakeResolve(q: string): Promise<ResolveResponse> {
  asked.push(q);
  const m = q.match(/^(\d+(?:\.\d+)?)\s*(g|kg)?\s+(.*)$/i);
  const grams = m ? Number(m[1]) * (m[2]?.toLowerCase() === "kg" ? 1000 : 1) : null;
  const name = (m ? m[3] : q).toLowerCase();
  const k = Object.keys(CATALOG).find((key) => name.includes(key) || name.includes(CATALOG[key].name.toLowerCase()));
  if (!k) return { query: q, source: "t", matchedTypes: [], none: { reason: "no_match", why: "" } };
  const c = CATALOG[k];
  return {
    query: q, source: "t",
    matchedTypes: [{ id: c.slug, slug: c.slug, name: c.name, broadCategory: c.cat, unit: "kg", products: [product(k)] }],
    quantity: grams != null && m?.[2] ? { value: grams, unit: "g", grams, pieces: null, basis: "t" } : null,
    purchase: null, none: null, confidence: 0.9,
  };
}

let n = 0;
const ing = (recipeId: string, lineRaw: string, item: string, grams: number | null, foodId: string | null, extra: Partial<Ing> = {}): Ing => ({
  id: `${recipeId}-i${++n}`, recipeId, position: n, lineRaw, item, grams, units: null, group: null, optional: false, pantry: false, foodId, yield: null, ...extra,
});

const R1: LeftoverRecipe = {
  id: "r1", slug: "chasseur", name: "Chasseur", servingsUnits: 9, factor: 1, extras: {},
  ingredients: [
    ing("r1", "400 g jambonneau", "Jambonneau", 400, "echine_porc"),
    ing("r1", "100 g creme", "Crème légère", 100, "creme_legere"),
    ing("r1", "20 g persil", "Persil, ciselé", 20, "persil"),
    ing("r1", "sel", "Sel", null, "zero", { pantry: true }),
  ],
};
const R2: LeftoverRecipe = {
  id: "r2", slug: "forno", name: "Forno", servingsUnits: 36, factor: 1, extras: {},
  ingredients: [ing("r2", "1000 g pulpe", "Pulpe de tomates", 1000, "pulpe_tomate"), ing("r2", "50 g creme", "Crème", 50, "creme_legere"), ing("r2", "300 g pates", "Pâtes", 300, "pates")],
};
const R3: LeftoverRecipe = { id: "r3", slug: "saute", name: "Sauté de jambonneau", servingsUnits: 9, factor: 1, extras: {}, ingredients: [ing("r3", "200 g jambonneau", "Jambonneau", 200, "echine_porc")] };
const R4: LeftoverRecipe = { id: "r4", slug: "gratin-brocoli", name: "Gratin de brocoli", servingsUnits: 18, factor: 1, extras: {}, ingredients: [ing("r4", "500 g brocoli", "Brocoli", 500, null)] };
const LIB = [R1, R2, R3, R4].map((r) => ({ slug: r.slug, name: r.name, tags: [], fridgeDays: 4, steps: [], status: "liked" }));

// ─── 1. Paquets entamés à travers toutes les recettes ───

test("paquets entamés : agrégés sur toute la sélection, avec le multiplicateur", async () => {
  const profiles = await buildProfiles([R1, R2, R3, R4].map((r) => ({ slug: r.slug, ingredients: r.ingredients })), fakeResolve);
  assert.equal(profiles.get("chasseur")!.length, 3); // le sel est au placard
  const w = selectionWaste([{ slug: "chasseur" }, { slug: "forno" }], profiles);
  const by = new Map(w.map((x) => [x.key, x]));
  assert.equal(by.get("type:jambonneau")!.restG, 200); // 600 g dont 400 g utilisés
  assert.equal(by.get("type:pulpe_tomate")!.packs, 3); // 3 × 400 g pour 1 000 g
  assert.equal(by.get("type:pulpe_tomate")!.restG, 200);
  assert.equal(by.get("type:creme_fraiche")!.restG, 50); // 100 + 50 g sur 200 g : les deux recettes comptent
  assert.equal(by.get("type:pates")!.perishable, false);
  // ×1,5 : 600 g de jambonneau, le paquet est fini.
  const w2 = selectionWaste([{ slug: "chasseur", factor: 1.5 }, { slug: "forno" }], profiles);
  assert.ok(!w2.some((x) => x.key === "type:jambonneau"));
  // 200 g ajoutés au chasseur : pareil.
  const jid = R1.ingredients[0].id;
  assert.ok(!selectionWaste([{ slug: "chasseur", extras: { [jid]: 200 } }], profiles).some((x) => x.key === "type:jambonneau"));
  assert.ok(wastePenalty(w) > wastePenalty(w2));
});

test("restes de la sélection : recette qui va avec (a), finir le paquet dans une recette (b), sinon l'atelier (c)", async () => {
  const profiles = await buildProfiles([R1, R2, R3, R4].map((r) => ({ slug: r.slug, ingredients: r.ingredients })), fakeResolve);
  const rules = dislikeRules(PREFERENCES.map((p) => ({ personId: p.personId ?? null, kind: p.kind, text: p.text, tags: p.tags ?? [] })));
  const dislikes = exclusionsOf([R1, R2, R3, R4], rules);
  const out = await selectionLeftovers([R1, R2], { library: LIB, profiles, dislikes, names: { sam: "Sam" }, resolveLine: fakeResolve, resolveTotal: fakeResolve });
  const by = new Map(out.map((l) => [l.key, l]));
  // « Il restera 200 g de jambonneau » : le sauté de jambonneau le finit.
  const j = by.get("type:jambonneau")!;
  assert.equal(j.restG, 200);
  assert.equal(j.orderedG, 600);
  assert.equal(j.add[0].slug, "saute");
  assert.equal(j.add[0].restAfterG, 0);
  assert.equal(j.add[0].morePacks, false);
  // b) 200 g de pulpe en plus dans le forno (36 unités) : la part d'Alex bouge à peine.
  const p = by.get("type:pulpe_tomate")!;
  assert.ok(p.adjust, "ajustement proposé");
  assert.equal(p.adjust!.slug, "forno");
  assert.equal(p.adjust!.extraG, 200);
  assert.ok(p.adjust!.after.kcal >= p.adjust!.before.kcal);
  // c) persil : 20 g sur 100 g, aucune recette, trop pour l'ajouter à la ligne → l'atelier.
  const pe = by.get("type:persil_frais")!;
  assert.equal(pe.restG, 80);
  assert.equal(pe.add.length, 0);
  assert.equal(pe.adjust, null);
  assert.match(pe.atelierHref!, /^\/atelier\?envie=Une%20recette%20qui%20utilise%2080%20g%20de%20persil/);
  // Les pâtes se gardent : signalées, sans proposition.
  const pa = by.get("type:pates")!;
  assert.equal(pa.perishable, false);
  assert.equal(pa.atelierHref, null);
  // Les restes périssables d'abord.
  assert.ok(out.findIndex((l) => !l.perishable) > out.findIndex((l) => l.perishable));
});

test("b) refusé quand la part d'Alex sort du repère et s'en éloigne", () => {
  // Une part d'Alex par cuisson (5 unités) : pâtes + crème ≈ dans le repère ; 100 g de crème en plus l'en sortent.
  const dense: LeftoverRecipe = {
    id: "r8", slug: "dense", name: "Pâtes à la crème", servingsUnits: 5, factor: 1, extras: {},
    ingredients: [ing("r8", "100 g pates", "Pâtes", 100, "pates"), ing("r8", "100 g creme", "Crème", 100, "creme_legere"), ing("r8", "200 g poulet", "Poulet", 200, "filet_poulet")],
  };
  const uses = [{ slug: "dense", ingredientId: dense.ingredients[1].id, grams: 100, units: null }];
  const before = leadPart(dense, {}, 5);
  const after = leadPart(dense, { [dense.ingredients[1].id]: 100 }, 5);
  assert.ok(after.kcal > before.kcal + 30, `${before.kcal} → ${after.kcal}`);
  const lead = { units: 5, ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 } };
  assert.equal(adjustFor([dense], uses, 100, lead), null);
  // 20 g de plus restent dans la tolérance.
  const ok = adjustFor([dense], uses, 20, lead);
  assert.ok(ok, JSON.stringify(before));
  assert.equal(ok!.extraG, 20);
  // Jamais plus que la ligne elle-même (pas de crème × 3).
  assert.equal(adjustFor([{ ...dense, servingsUnits: 500 }], uses, 150, lead), null);
});

test("la proposition de la semaine pénalise le gaspillage", () => {
  const steps = [{ kind: "braise" as const, durationMin: 60, activeMin: 10, equipmentId: null, ovenTemp: null }];
  const mk = (slug: string, name: string): WeekRecipe => ({ slug, name, tags: [], fridgeDays: 4, steps, servingsUnits: 18, freezerOk: true, kcalUnit: 145, proteinUnit: 12, status: "liked" });
  const lib = [mk("a", "Poulet A"), mk("b", "Dinde B"), mk("c", "Saucisse C")];
  const profiles: PackProfiles = new Map([
    ["a", [{ ingredientId: "a1", key: "type:x", label: "X", grams: 600, pieces: null, packG: 600, price: 6, perishable: true }]],
    ["b", [{ ingredientId: "b1", key: "type:y", label: "Y", grams: 300, pieces: null, packG: 600, price: 6, perishable: true }]],
    ["c", [{ ingredientId: "c1", key: "type:z", label: "Z", grams: 1000, pieces: null, packG: 1000, price: 6, perishable: true }]],
  ]);
  const slots: SlotIn[] = [];
  for (let day = 0; day < 3; day++) for (const meal of ["lunch", "dinner"] as const) slots.push({ day, meal, personId: "alex", place: "home", portionUnits: 5 });
  const noWaste = scoreSelection([lib[0], lib[2]], slots, { profiles });
  const waste = scoreSelection([lib[1], lib[2]], slots, { profiles });
  assert.equal(noWaste.waste.length, 0);
  assert.equal(waste.waste[0].restG, 300);
  assert.ok(waste.score > noWaste.score);
  const p = propose(lib, slots, { profiles })!;
  assert.ok(!p.slugs.includes("b"), p.slugs.join());
  // Sans profils, le score ne change pas (tests existants).
  assert.equal(scoreSelection([lib[1], lib[2]], slots).waste.length, 0);
});

// ─── 2. Unités par recette ───

test("unités : multiplicateur par pas, couverture et liste de courses suivent", async () => {
  assert.equal(stepFactor(1, 1), 1.25);
  assert.equal(stepFactor(2, 1), 2.5);
  assert.equal(stepFactor(0.5, -1), 0.5);
  assert.equal(stepFactor(1.1, -1), 1);
  const r: WeekRecipe = { slug: "a", name: "A", tags: [], fridgeDays: 4, steps: [], servingsUnits: 18, freezerOk: false, kcalUnit: 150, proteinUnit: 12 };
  assert.equal(unitsOf({ ...r, factor: 1.5 }), 27);
  const slots: SlotIn[] = [0, 1, 2].flatMap((day) => (["lunch", "dinner"] as const).map((meal) => ({ day, meal, personId: "alex", place: "home" as const, portionUnits: 5 })));
  assert.equal(assign([r], slots).uncovered.length, 3); // 18 u pour 30 u
  assert.equal(assign([{ ...r, factor: 1.75 }], slots).uncovered.length, 0); // 32 u
  // Liste : grammes × facteur, pièces arrondies au-dessus, grammes ajoutés.
  const onions = ing("r9", "3 oignons", "Oignons", null, "oignon", { units: 3 });
  const pulpe = ing("r9", "1000 g pulpe", "Pulpe", 1000, "pulpe_tomate");
  const plan = await planList([onions, pulpe], { scaleOf: (i) => ({ factor: 1.5, extraG: i.id === pulpe.id ? 200 : 0 }), resolveLine: fakeResolve, resolveTotal: fakeResolve });
  const pl = plan.lines.find((l) => l.need.key === "type:pulpe_tomate")!;
  assert.equal(pl.need.grams, 1700);
  assert.equal(pl.packs, 5);
  const on = plan.lines.find((l) => l.need.label.toLowerCase().includes("oignon"))!;
  assert.equal(on.need.pieces, 5); // 4,5 → 5 oignons
});

test("sélection du Composer dans l'URL : unités et grammes ajoutés", () => {
  const s = parseSelection("chasseur-porc*1.5,pasta-al-forno,chasseur-porc,bad slug*9", "0f9c1a2b-1111-2222-3333-444455556666:200,xx:5");
  assert.deepEqual(s.slugs, ["chasseur-porc", "pasta-al-forno"]);
  assert.deepEqual(s.scales, { "chasseur-porc": 1.5 });
  assert.deepEqual(s.extras, { "0f9c1a2b-1111-2222-3333-444455556666": 200 });
  assert.equal(composerHref(s), "/composer?r=chasseur-porc*1.5,pasta-al-forno&x=0f9c1a2b-1111-2222-3333-444455556666:200");
  assert.deepEqual(parseSelection("a*7").scales, {}); // hors des pas
});

// ─── 3. Liste de courses reliée à la semaine (base en mémoire) ───

function seeded() {
  const o = openDb(":memory:");
  bootstrap(o.db, o.sqlite);
  return o;
}

test("semaine en base : unités, ajout, retrait, grammes ajoutés, nutrition par part", () => {
  const { db } = seeded();
  const w = "2026-10-26";
  const planId = ensureWeek(db, w);
  addRecipe(db, w, "chasseur-porc");
  addRecipe(db, w, "pasta-al-forno-saucisse-ricotta");
  let v = weekView(db, w);
  assert.deepEqual(v.selected.map((r) => r.slug), ["chasseur-porc", "pasta-al-forno-saucisse-ricotta"]);
  const ch = v.selected[0];
  const before = v.assignment.recipes.find((r) => r.slug === ch.slug)!;
  setFactor(db, w, "chasseur-porc", 1.5);
  v = weekView(db, w);
  const after = v.assignment.recipes.find((r) => r.slug === ch.slug)!;
  assert.equal(after.unitsUsed + after.unitsLeft, Math.round(ch.servingsUnits * 1.5));
  assert.ok(after.unitsUsed + after.unitsLeft > before.unitsUsed + before.unitsLeft);
  // Nutrition par part inchangée par le multiplicateur.
  assert.equal(v.selected[0].kcalUnit, ch.kcalUnit);
  assert.throws(() => setFactor(db, w, "chasseur-porc", 7));
  // Grammes ajoutés : la part change, recalculée.
  const sauce = v.ingredients.get(ch.id)!.find((i) => i.grams && i.grams >= 100)!;
  setExtra(db, w, "chasseur-porc", sauce.id, 200);
  v = weekView(db, w);
  assert.equal(v.extraLines.length, 1);
  assert.notEqual(Math.round(v.selected[0].kcalUnit! * 10), Math.round(ch.kcalUnit! * 10));
  setExtra(db, w, "chasseur-porc", sauce.id, 0);
  assert.deepEqual(loadSelection(db, planId)[0].extras, {});
  // Pas plus de 4 recettes.
  for (const s of ["colombo-porc", "porc-caramel-oeufs", "medaillons-filet-mignon-moutarde"]) addRecipe(db, w, s);
  assert.equal(loadSelection(db, planId).length, 4);
  removeRecipe(db, w, "colombo-porc");
  assert.equal(loadSelection(db, planId).length, 3);
  // Les repas pointent vers les recettes retenues seulement.
  const ids = new Set(db.select({ id: recipes.id }).from(recipes).all().filter((r) => true).map((r) => r.id));
  for (const s of db.select().from(mealSlots).where(eq(mealSlots.weekPlanId, planId)).all()) if (s.recipeId) assert.ok(ids.has(s.recipeId));
});

test("« Faire la liste de courses » depuis la semaine : week_plan_id, unités, état affiché", async () => {
  const { db } = seeded();
  const w = "2026-11-02";
  const planId = ensureWeek(db, w);
  addRecipe(db, w, "chasseur-porc");
  setFactor(db, w, "chasseur-porc", 2);
  const sel = loadSelection(db, planId);
  assert.equal(weekList(db, planId, sel), null);
  asked.length = 0;
  const id = await buildShoppingList(db, ["chasseur-porc"], { weekPlanId: planId, scales: { "chasseur-porc": 2 }, resolveLine: fakeResolve, resolveTotal: fakeResolve });
  const l = db.select().from(shoppingLists).where(eq(shoppingLists.id, id)).get()!;
  assert.equal(l.weekPlanId, planId);
  assert.deepEqual(l.recipeScales, { "chasseur-porc": 2 });
  // Les besoins de la liste sont ceux des unités choisies (× 2).
  const chasseur = db.select().from(recipes).where(eq(recipes.slug, "chasseur-porc")).get()!;
  const src = db.select().from(shoppingItemSources).all().find((s) => s.recipeId === chasseur.id && s.grams);
  const ingRow = db.select().from(schema.recipeIngredients).all().find((i) => i.lineRaw === src!.lineRaw)!;
  assert.ok(src!.grams! >= ingRow.grams! * 2 - 1, `${src!.grams} vs ${ingRow.grams}`);
  assert.ok(db.select().from(shoppingItems).where(eq(shoppingItems.listId, id)).all().length > 0);
  assert.equal(orderedIngredientsFor(db, id)[0].slug, "chasseur-porc");
  let st = weekList(db, planId, sel)!;
  assert.equal(st.id, id);
  assert.equal(st.ordered, false);
  assert.equal(st.changed, false);
  setFactor(db, w, "chasseur-porc", 1.5);
  st = weekList(db, planId, loadSelection(db, planId))!;
  assert.equal(st.changed, true); // la semaine a changé depuis la liste
  db.update(shoppingLists).set({ status: "ordered" }).where(eq(shoppingLists.id, id)).run();
  assert.equal(weekList(db, planId, sel)!.ordered, true);
});

// ─── 4. Goûts de Sam et d'Alex ───

const RULES = dislikeRules(PREFERENCES.map((p) => ({ personId: p.personId ?? null, kind: p.kind, text: p.text, tags: p.tags ?? [] })));

test("goûts : règles tirées des préférences (ingrédients et plats seulement)", () => {
  const labels = RULES.map((r) => `${r.personId}:${r.label}`).sort();
  assert.deepEqual(labels, ["alex:cornichons", "alex:câpres", "alex:olives", "sam:brocoli", "sam:bœuf haché", "sam:concombre", "sam:hachis parmentier"]);
  const t = (name: string, items: string[]) => dislikesIn({ slug: "x", name, ingredients: items.map((item) => ({ item, lineRaw: item })) }, RULES);
  assert.deepEqual(t("Pâtes", ["Huile d'olive", "Ail, haché"]).size, 0); // l'huile d'olive n'est pas une olive
  assert.deepEqual(t("Salade", ["Concombres", "Olives noires"]).get("sam"), ["concombre"]);
  assert.deepEqual(t("Salade", ["Concombres", "Olives noires"]).get("alex"), ["olives"]);
  assert.deepEqual(t("Tagliatelles", ["400 g de bœuf haché 5 %"]).get("sam"), ["bœuf haché"]);
  assert.deepEqual(t("Hachis Parmentier de canard", ["Canard"]).get("sam"), ["hachis parmentier"]);
  assert.deepEqual(t("Poulet", ["Brocolis en fleurettes"]).get("sam"), ["brocoli"]);
  assert.deepEqual(t("Tartare", ["Câpres"]).get("alex"), ["câpres"]);
});

test("goûts : la bibliothèque actuelle n'écarte rien (pas d'olive pour l'huile d'olive)", () => {
  const { db } = seeded();
  const v = weekView(db, "2026-10-19");
  assert.equal(v.tastes.dislikes.size, 0, [...v.tastes.dislikes.keys()].join());
});

test("goûts : une recette au brocoli n'est jamais servie à Sam, mais peut l'être à Alex", () => {
  const steps = [{ kind: "braise" as const, durationMin: 40, activeMin: 10, equipmentId: null, ovenTemp: null }];
  const brocoli: WeekRecipe = { slug: "poulet-brocoli", name: "Poulet brocoli", tags: [], fridgeDays: 4, steps, servingsUnits: 45, freezerOk: true, kcalUnit: 150, proteinUnit: 12, status: "liked" };
  const autre: WeekRecipe = { slug: "colombo", name: "Colombo de porc", tags: [], fridgeDays: 4, steps, servingsUnits: 12, freezerOk: true, kcalUnit: 150, proteinUnit: 12, status: "liked" };
  const ex = exclusionsOf([{ slug: "poulet-brocoli", name: "Poulet brocoli", ingredients: [{ item: "Brocoli" }] }], RULES);
  const excluded = new Map([...ex].map(([s, m]) => [s, new Set(m.keys())]));
  const slots: SlotIn[] = [];
  for (let day = 0; day < 5; day++) for (const meal of ["lunch", "dinner"] as const) for (const personId of ["alex", "sam"]) slots.push({ day, meal, personId, place: defaultPlace(day, meal, personId), portionUnits: personId === "alex" ? 5 : 4 });
  const a = assign([brocoli, autre], slots, { excluded });
  for (const [k, slug] of a.bySlot) if (k.endsWith(":sam")) assert.notEqual(slug, "poulet-brocoli", k);
  assert.ok([...a.bySlot].some(([k, s]) => k.endsWith(":alex") && s === "poulet-brocoli"));
  // Sans exclusion, Sam en aurait mangé.
  assert.ok([...assign([brocoli, autre], slots).bySlot].some(([k, s]) => k.endsWith(":sam") && s === "poulet-brocoli"));
  // propose : quand Sam est là toute la semaine, la recette au brocoli perd face à une autre.
  const p = propose([brocoli, { ...autre, servingsUnits: 45 }], slots, { excluded })!;
  assert.ok(p.slugs.includes("colombo"));
});
