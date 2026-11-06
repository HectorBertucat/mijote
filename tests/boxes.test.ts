// Les boîtes : le rapport féculent / plat, la marge jusqu'aux plafonds, les dates limites (src/lib/boxes/core.ts).
// La réserve, qui s'en sert, est testée dans tests/reserve.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillUp, freshness, limitOf, mealAt, sideRatio } from "@/lib/boxes/core";

test("garniture à part : la proportion de la marmite dans le repère, le riz glisse dans le sens qui corrige", () => {
  const dish = { kcalG: 1.2, proteinG: 0.15 };
  const rice = { kcalG: 1.3, proteinG: 0.03 };
  // À 0,8 (la marmite), 700 kcal donnent 700 × (0,15 + 0,8 × 0,03) / (1,2 + 0,8 × 1,3) ≈ 54 g : dans 45-60, rien ne bouge.
  assert.deepEqual(sideRatio({ kcal: 700, protein: 52, proteinMin: 45, proteinMax: 60 }, dish, rice, 0.8), { ratio: 0.8, mode: "simple" });
  // Il en manque (58-65 visés) : moins de riz, plus de plat, jusqu'à entrer dans le repère.
  const low = sideRatio({ kcal: 700, protein: 60, proteinMin: 58, proteinMax: 65 }, dish, rice, 0.8);
  assert.equal(low.mode, "cible");
  assert.ok(low.ratio < 0.8 && low.ratio >= 0.4, String(low.ratio));
  const at = (t: number) => (700 * (dish.proteinG + t * rice.proteinG)) / (dish.kcalG + t * rice.kcalG);
  assert.ok(at(low.ratio) >= 58);
  // Il y en a trop (30-40 visés) : plus de riz, moins de plat, jamais plus d'une fois et demie la marmite.
  const high = sideRatio({ kcal: 700, protein: 35, proteinMin: 30, proteinMax: 40 }, dish, rice, 0.8);
  assert.ok(high.ratio > 0.8 && high.ratio <= 1.2 + 1e-9, String(high.ratio));
  assert.equal(high.mode, "borne"); // même à 1,2, 700 kcal font plus de 40 g
  // Sans haut de repère : un surplus ne bouge rien.
  assert.deepEqual(sideRatio({ kcal: 700, protein: 5, proteinMin: 4 }, dish, rice, 0.8), { ratio: 0.8, mode: "simple" });
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
