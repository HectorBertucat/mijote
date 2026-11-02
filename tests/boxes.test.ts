// Les boîtes : le rapport féculent / plat, la marge jusqu'aux plafonds, les dates limites (src/lib/boxes/core.ts).
// La réserve, qui s'en sert, est testée dans tests/reserve.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillUp, freshness, limitOf, mealAt, sideRatio } from "@/lib/boxes/core";

test("garniture à part : la proportion de la marmite tant que les protéines suffisent, moins de riz s'il en manque", () => {
  const dish = { kcalG: 1.2, proteinG: 0.15 };
  const rice = { kcalG: 1.3, proteinG: 0.03 };
  // À 0,8 (la marmite), 700 kcal donnent 700 × (0,15 + 0,8 × 0,03) / (1,2 + 0,8 × 1,3) ≈ 54 g.
  assert.deepEqual(sideRatio({ kcal: 700, protein: 50, proteinMin: 45 }, dish, rice, 0.8), { ratio: 0.8, mode: "simple" });
  // Peu de protéines visées : jamais plus de riz que la marmite (un surplus de protéines ne se compense pas).
  assert.deepEqual(sideRatio({ kcal: 700, protein: 5, proteinMin: 4 }, dish, rice, 0.8), { ratio: 0.8, mode: "simple" });
  // Il en manque : t = (0,15 − (60/700) × 1,2) / ((60/700) × 1,3 − 0,03) ≈ 0,58, entre 0,4 et 0,8.
  const r = sideRatio({ kcal: 700, protein: 60, proteinMin: 56 }, dish, rice, 0.8);
  assert.equal(r.mode, "cible");
  const d = 700 / (dish.kcalG + r.ratio * rice.kcalG);
  assert.ok(Math.abs(d * dish.proteinG + r.ratio * d * rice.proteinG - 60) < 0.01);
  // Plus de protéines que le plat seul n'en donne : le moins de riz permis (la moitié de la marmite).
  assert.deepEqual(sideRatio({ kcal: 700, protein: 120, proteinMin: 110 }, dish, rice, 0.8), { ratio: 0.4, mode: "borne" });
});


test("surplus : chaque boîte grossit du même facteur jusqu'à son plafond, le reste va aux autres", () => {
  // 10 + 5 unités, 3 de plus : facteur 1,2 → 12 et 6 ; la première plafonnée à 11 laisse 7 à la seconde.
  assert.deepEqual(fillUp([{ units: 10, cap: Infinity }, { units: 5, cap: Infinity }], 3), { units: [12, 6], over: 0 });
  assert.deepEqual(fillUp([{ units: 10, cap: 11 }, { units: 5, cap: Infinity }], 3), { units: [11, 7], over: 0 });
  // Tout le monde au plafond : ce qui ne tient nulle part.
  assert.deepEqual(fillUp([{ units: 10, cap: 11 }, { units: 5, cap: 5.5 }], 3), { units: [11, 5.5], over: 1.5 });
});


test("dates limites : frigo, congélateur, décongelée ; le repas du journal selon l'heure", () => {
  const box = { place: "fridge" as const, cookedOn: "2026-11-01", fridgeDays: 4, frozenOn: null, thawedOn: null };
  assert.equal(limitOf(box), "2026-11-05");
  assert.equal(limitOf({ ...box, place: "freezer", frozenOn: "2026-11-03" }), "2027-02-01");
  assert.equal(limitOf({ ...box, thawedOn: "2026-12-10" }), "2026-12-11");
  assert.equal(freshness("2026-11-05", "2026-11-02"), "ok");
  assert.equal(freshness("2026-11-05", "2026-11-04"), "soon");
  assert.equal(freshness("2026-11-05", "2026-11-06"), "past");
  assert.equal(mealAt(12), "lunch");
  assert.equal(mealAt(20), "dinner");
  assert.equal(mealAt(16), "snack");
});
