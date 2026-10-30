import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { RecipeInput } from "@/lib/recipes/format";
import { computeNutrition } from "@/lib/nutrition/compute";
import {
  assign,
  daysAfterSession,
  defaultPlace,
  autoSize,
  AUTO_MAX_FACTOR,
  defaultWeek,
  mondayOf,
  propose,
  swap,
  type Meal,
  type SlotIn,
  type WeekRecipe,
} from "@/lib/week/propose";

const DIR = "src/seed/recipes";
const library: WeekRecipe[] = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const r = RecipeInput.parse(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));
    const n = computeNutrition(
      r.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null })),
      r.servingsUnits
    );
    return {
      slug: r.slug,
      name: r.name,
      tags: r.tags,
      fridgeDays: r.fridgeDays ?? null,
      freezerOk: r.freezerOk ?? false,
      servingsUnits: r.servingsUnits,
      kcalUnit: n.perUnit.kcal,
      proteinUnit: n.perUnit.protein,
      status: r.status ?? "liked",
      steps: r.steps.map((s) => ({ kind: s.kind, durationMin: s.durationMin ?? null, activeMin: s.activeMin ?? null, equipmentId: s.equipmentId ?? null, ovenTemp: s.ovenTemp ?? null })),
    };
  });
const bySlug = new Map(library.map((r) => [r.slug, r]));
const UNITS: Record<string, number> = { alex: 5, sam: 4 };

/** Semaine type du foyer de test : Sam part du jeudi soir au dimanche. */
const usual = (day: number, meal: Meal, person: string): SlotIn["place"] => (person === "sam" && (day > 3 || (day === 3 && meal === "dinner")) ? "away" : defaultPlace(day, meal, person));

function week(place: (day: number, meal: Meal, person: string) => SlotIn["place"] = usual): SlotIn[] {
  const out: SlotIn[] = [];
  for (let day = 0; day < 7; day++)
    for (const meal of ["lunch", "dinner"] as const)
      for (const personId of ["alex", "sam"]) out.push({ day, meal, personId, place: place(day, meal, personId), portionUnits: UNITS[personId] });
  return out;
}

/** Aucun repas servi au-delà du frigo, sauf congelé pour une recette qui le supporte. */
function checkFridge(p: ReturnType<typeof assign>) {
  for (const rp of p.recipes) {
    const r = bySlug.get(rp.slug)!;
    for (const m of rp.meals) {
      const late = daysAfterSession(m.day) > (r.fridgeDays ?? 3);
      assert.equal(m.frozen, late, `${rp.slug} ${m.day} ${m.meal}`);
      if (late) assert.ok(r.freezerOk, `${rp.slug} servi congelé sans être congelable`);
    }
  }
}

test("présence par défaut : tout le monde mange à tous les repas, midi au bureau en semaine", () => {
  assert.equal(defaultPlace(0, "lunch", "alex"), "office");
  assert.equal(defaultPlace(0, "dinner", "sam"), "home");
  assert.equal(defaultPlace(3, "dinner", "sam"), "home");
  assert.equal(defaultPlace(6, "lunch", "sam"), "home");
  assert.equal(defaultPlace(5, "dinner", "alex"), "home");
  const units = week().filter((s) => s.place !== "away").reduce((s, x) => s + x.portionUnits, 0);
  assert.equal(units, 14 * 5 + 7 * 4);
});

test("quantités automatiques : les recettes choisies couvrent la semaine, jamais au-delà du double de la fiche", () => {
  const slots = week();
  const congelables = library.filter((r) => r.freezerOk && r.servingsUnits >= 20).slice(0, 3);
  assert.equal(congelables.length, 3);
  const sized = autoSize(congelables, slots);
  assert.ok(sized.every((r) => (r.factor ?? 1) <= AUTO_MAX_FACTOR && (r.factor ?? 1) >= 0.5));
  const a = assign(sized, slots);
  const before = assign(congelables.map((r) => ({ ...r, factor: 1 })), slots);
  assert.ok(a.coveredUnits >= before.coveredUnits, "jamais moins couvert qu'à la taille de la fiche");
  assert.equal(a.uncovered.length, 0, "trois recettes congelables couvrent toute la semaine");
  // Une seule recette pour deux soirs : la marmite rétrécit au lieu de laisser un gros reste.
  const short = week((day, meal) => (day < 2 && meal === "dinner" ? "home" : "away"));
  const one = autoSize([congelables[0]], short);
  assert.ok((one[0].factor ?? 1) < 1, `facteur ${one[0].factor}`);
  assert.equal(assign(one, short).uncovered.length, 0);
});

test("la semaine par défaut : 2 à 4 recettes, presque tout couvert, frigo respecté", () => {
  const p = propose(library, week());
  assert.ok(p);
  assert.ok(p.slugs.length >= 2 && p.slugs.length <= 4, p.slugs.join());
  // 78 unités à manger : au plus une part reste à prévoir (les fiches font 36 + 36 + 9).
  assert.ok(p.uncovered.length <= 1, JSON.stringify(p.uncovered));
  assert.ok(p.coveredUnits >= p.neededUnits - 5);
  checkFridge(p);
  // Chaque recette retenue nourrit au moins un repas.
  for (const r of p.recipes) assert.ok(r.unitsUsed > 0, r.slug);
  // Cuites à la taille de la fiche : on ne mange pas plus que ce qui est cuit.
  for (const r of p.recipes) assert.ok(r.unitsLeft >= 0);
  // Déterministe.
  assert.deepEqual(propose(library, week())!.slugs, p.slugs);
});

test("les plats minute (frigo J+1) ne servent pas au-delà du lundi", () => {
  const a = assign([bySlug.get("medaillons-filet-mignon-moutarde")!, bySlug.get("porc-caramel-oeufs")!], week());
  const med = a.recipes.find((r) => r.slug === "medaillons-filet-mignon-moutarde")!;
  assert.ok(med.meals.length > 0);
  for (const m of med.meals) assert.equal(m.day, 0);
  checkFridge(a);
});

test("sans recette congelable, les repas de fin de semaine restent non couverts", () => {
  const fresh = library.filter((r) => !r.freezerOk);
  const a = assign(fresh, week());
  assert.ok(a.uncovered.length > 0);
  for (const s of a.uncovered) assert.ok(daysAfterSession(s.day) > 1);
  checkFridge(a);
});

test("un repas pris ensemble vient d'une seule recette", () => {
  const p = propose(library, week())!;
  const lunch0 = ["alex", "sam"].map((id) => p.bySlot.get(`0:lunch:${id}`));
  assert.ok(lunch0[0]);
  assert.equal(lunch0[0], lunch0[1]);
});

test("une semaine courte se couvre entièrement, sans congélateur", () => {
  const p = propose(library, week((day, meal, person) => (day <= 2 ? usual(day, meal, person) : "away")))!;
  assert.equal(p.uncovered.length, 0);
  assert.equal(p.frozenUnits, 0);
  checkFridge(p);
});

test("personne à la maison : rien à cuisiner", () => {
  const p = propose(library, week(() => "away"))!;
  assert.equal(p.neededUnits, 0);
});

test("échanger une recette garde les autres et retire celle-ci", () => {
  const p = propose(library, week())!;
  const out = p.slugs[0];
  const s = swap(library, week(), p.slugs, out);
  assert.ok(s);
  assert.ok(!s.slugs.includes(out));
  for (const k of p.slugs.slice(1)) assert.ok(s.slugs.includes(k), k);
  assert.equal(s.slugs.length, p.slugs.length);
  checkFridge(s);
});

test("variété : pas deux fois la même protéine quand une autre couvre aussi bien", () => {
  const p = propose(library, week())!;
  // La bibliothèque a 5 recettes au porc et une au poulet-saucisse : le forno est retenu.
  assert.ok(p.slugs.includes("pasta-al-forno-saucisse-ricotta"), p.slugs.join());
});

test("lundi de la semaine, à l'heure de Paris", () => {
  assert.equal(mondayOf(new Date("2026-10-20T10:00:00Z")), "2026-10-19");
  assert.equal(mondayOf(new Date("2026-10-25T21:30:00Z")), "2026-10-19"); // dimanche 23 h 30 à Paris
  assert.equal(mondayOf(new Date("2026-10-25T23:30:00Z")), "2026-10-26"); // déjà lundi à Paris
  assert.equal(defaultWeek(new Date("2026-10-20T10:00:00Z")), "2026-10-19");
  assert.equal(defaultWeek(new Date("2026-10-24T10:00:00Z")), "2026-10-26"); // samedi : on prépare la suivante
});
