// Kit de graphiques (src/components/ui/charts/core.ts) : graduations rondes, repères de dates, chemins SVG
// coupés aux trous, point le plus proche du pointeur, niveaux du calendrier, textes à la française.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPath, dateTicks, dayNum, dotsPath, fmt, hmin, levelOf, linePath, nearest, niceDomain, niceStep, shiftDay, tickText, tipText } from "@/components/ui/charts/core";

test("pas ronds et domaines : zéro en bas pour des barres, une série plate s'ouvre", () => {
  assert.equal(niceStep(10, 4), 2.5);
  assert.equal(niceStep(13_400, 4), 5000);
  assert.equal(niceStep(0, 4), 1);
  const bars = niceDomain([8200, 13_400, null, 9100], { zero: true });
  assert.deepEqual([bars.lo, bars.hi, bars.ticks], [0, 15_000, [0, 5000, 10_000, 15_000]]);
  const kg = niceDomain([81.2, 82.9], { minSpan: 2 });
  assert.ok(kg.lo <= 81.05 && kg.hi >= 83.05 - 0.01, `${kg.lo}–${kg.hi}`);
  const flat = niceDomain([60, 60, 60]);
  assert.ok(flat.hi > flat.lo);
  assert.deepEqual(niceDomain([]).ticks.length > 1, true);
});

test("textes : chiffres français, « 12 k », heures et minutes", () => {
  assert.equal(fmt(8412), "8 412");
  assert.equal(fmt(81.24, 1), "81,2");
  assert.equal(tickText(15_000), "15 k");
  assert.equal(tickText(5000), "5 000");
  assert.equal(tickText(2.5, 1), "2,5");
  assert.equal(tickText(5, 1), "5", "pas de « 5,0 » sur un repère rond");
  assert.equal(hmin(453), "7 h 33");
  assert.equal(hmin(45), "45 min");
  assert.equal(tipText({ title: "lun. 3 nov.", rows: [{ value: "8 412 pas" }, { value: "81,2 kg", label: "tendance" }] }), "lun. 3 nov. : 8 412 pas, tendance 81,2 kg");
});

test("repères de dates : jours, lundis, mois ou années selon la durée, le plus récent gardé", () => {
  assert.equal(dateTicks("2026-10-26", "2026-11-01").length, 7);
  assert.equal(dateTicks("2026-10-26", "2026-11-01")[0].label, "lun.");
  const month = dateTicks("2026-10-03", "2026-11-01");
  assert.deepEqual(month.map((t) => t.date), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  const year = dateTicks("2025-11-03", "2026-11-01");
  assert.ok(year.length <= 6 && year.every((t) => t.date.endsWith("-01")));
  assert.ok(year.some((t) => t.label === "2026"), "janvier porte l'année");
  assert.ok(dateTicks("2019-03-01", "2026-11-01").every((t) => /^\d{4}$/.test(t.label)));
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(dayNum("1970-01-02"), 1);
});

test("chemins : la ligne et la bande se coupent aux trous, un point par valeur", () => {
  assert.equal(
    linePath([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: null },
      { x: 3, y: 4 },
    ]),
    "M0 1L1 2M3 4"
  );
  assert.equal(
    bandPath([
      { x: 0, lo: 1, hi: 3 },
      { x: 1, lo: 2, hi: 4 },
      { x: 2, lo: null, hi: null },
      { x: 3, lo: 1, hi: 2 },
    ]),
    "M0 3L1 4L1 2L0 1Z"
  );
  assert.equal(
    dotsPath([
      { x: 0, y: 5 },
      { x: 1, y: null },
    ]),
    "M0 5h0"
  );
});

test("pointeur et niveaux : le point le plus proche, les seuils du calendrier", () => {
  const xs = [0.05, 0.15, 0.25, 0.35];
  assert.equal(nearest(xs, 0), 0);
  assert.equal(nearest(xs, 0.21), 2);
  assert.equal(nearest(xs, 0.99), 3);
  assert.equal(nearest([], 0.5), -1);
  const levels = [1, 20, 40, 60, 90];
  assert.deepEqual([null, 0, 10, 20, 45, 89, 120].map((v) => levelOf(v, levels)), [0, 0, 1, 2, 3, 4, 5]);
});
