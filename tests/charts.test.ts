// Kit de graphiques (src/components/ui/charts/core.ts) : graduations rondes, repères de dates, chemins SVG
// coupés aux trous, point le plus proche du pointeur, niveaux du calendrier, textes à la française.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPath, bigNum, dateTicks, dayNum, dotsPath, fmt, fmtDay, hmin, levelOf, linePath, nearest, niceDomain, niceStep, NO_DATA, shiftDay, tableRows, tickText, tipText } from "@/components/ui/charts/core";

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
  assert.equal(tickText(-50), "−50", "un vrai moins sur les repères");
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

test("tableau des lecteurs d'écran : une suite sans mesure en une ligne, les mesures une par une", () => {
  const v = (title: string, value: string) => ({ title, rows: [{ value, label: "pas" }] });
  const none = (title: string) => ({ title, rows: [{ value: NO_DATA }] });
  const rows = tableRows([none("janvier 2020"), none("février 2020"), none("mars 2020"), v("avril 2020", "8 000"), none("mai 2020"), v("juin 2020", "7 500"), { title: "juillet 2020", rows: [] }, { title: "août 2020", rows: [] }]);
  assert.deepEqual(
    rows.map((r) => [r.title, r.rows[0]?.value ?? "—"]),
    [
      ["janvier 2020 – mars 2020", NO_DATA],
      ["avril 2020", "8 000"],
      ["mai 2020", NO_DATA],
      ["juin 2020", "7 500"],
      ["juillet 2020 – août 2020", "—"],
    ]
  );
  assert.deepEqual(tableRows([]), []);
});

test("formats : les formateurs gardés rendent la même chose que toLocaleString", () => {
  for (const [v, d] of [[8400, 0], [81.25, 1], [-0.5, 2], [1234567.891, 1]] as const) {
    assert.equal(fmt(v, d), v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
    assert.equal(fmt(v, d), fmt(v, d), "deuxième appel, même formateur");
  }
  assert.equal(fmtDay("2026-11-03", "weekday"), new Date("2026-11-03T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }));
  assert.equal(fmtDay("2026-11-03", "full"), "3 nov. 2026");
});
