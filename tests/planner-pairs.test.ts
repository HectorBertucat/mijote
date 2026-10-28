import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { planSession, validatePlan, type SessionMode } from "@/lib/session/planner";
import { load, RES } from "./helpers";

// Toutes les paires de recettes du seed, seul et à deux (audit du 25/10/2026, `pnpm plan:audit`).
const R = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);
const pairs = R.flatMap((a, i) => R.slice(i + 1).map((b) => [a, b] as const));

// Plafonds : la durée totale mesurée le 25/10/2026, après les essais multiples, le faitout de
// rechange du colombo, les suites dans le même récipient qui n'attendent plus (un peu plus long
// sur pasta + caramel : la cocotte ne patiente plus entre deux étapes) et, seul, les gestes
// glissés dans la cuisson par moments d'au moins 5 min
// (moyenne 182 → 168 min seul, 142 → 136 min à deux). Un changement du planificateur ne doit pas rallonger une session ;
// s'il la raccourcit, baisser le plafond ici.
const CEIL: Record<string, [solo: number, duo: number]> = {
  "chasseur-porc+colombo-porc": [255, 220],
  "chasseur-porc+medaillons-filet-mignon-moutarde": [176, 148],
  "chasseur-porc+pasta-al-forno-saucisse-ricotta": [217, 163],
  "chasseur-porc+porc-caramel-oeufs": [269, 232],
  "chasseur-porc+saute-minute-porc-gingembre-miel": [179, 148],
  "colombo-porc+medaillons-filet-mignon-moutarde": [141, 124],
  "colombo-porc+pasta-al-forno-saucisse-ricotta": [173, 126],
  "colombo-porc+porc-caramel-oeufs": [188, 142],
  "colombo-porc+saute-minute-porc-gingembre-miel": [147, 127],
  "medaillons-filet-mignon-moutarde+pasta-al-forno-saucisse-ricotta": [129, 102],
  "medaillons-filet-mignon-moutarde+porc-caramel-oeufs": [145, 119],
  "medaillons-filet-mignon-moutarde+saute-minute-porc-gingembre-miel": [49, 33],
  "pasta-al-forno-saucisse-ricotta+porc-caramel-oeufs": [185, 127],
  "pasta-al-forno-saucisse-ricotta+saute-minute-porc-gingembre-miel": [128, 102],
  "porc-caramel-oeufs+saute-minute-porc-gingembre-miel": [144, 122],
};

for (const [a, b] of pairs) {
  test(`paire ${a.slug} + ${b.slug} : plans valides, en parallèle, à deux plus court`, () => {
    const total: Partial<Record<SessionMode, number>> = {};
    for (const mode of ["solo", "duo"] as SessionMode[]) {
      const p = planSession([a, b], RES, { mode });
      assert.deepEqual(p.errors, [], p.errors.map((e) => e.message).join("\n"));
      assert.deepEqual(validatePlan(p, RES), []);
      const alone = [a, b].map((r) => planSession([r], RES, { mode }).totalMin);
      // Jamais plus long que les deux recettes à la suite, ni nettement plus court que la plus longue
      // seule (le plan d'une recette seule n'est pas forcément le meilleur possible : 10 % de marge).
      assert.ok(p.totalMin <= alone[0] + alone[1] + 0.5, `${mode} : ${p.totalMin} > ${alone[0]} + ${alone[1]}`);
      assert.ok(p.totalMin >= Math.max(...alone) * 0.9, `${mode} : ${p.totalMin} < ${Math.max(...alone)}`);
      total[mode] = p.totalMin;
    }
    assert.ok(total.duo! <= total.solo!, `à deux ${total.duo} > seul ${total.solo}`);
    const ceil = CEIL[`${a.slug}+${b.slug}`];
    assert.ok(ceil, `plafond manquant pour ${a.slug}+${b.slug}`);
    assert.ok(Math.round(total.solo!) <= ceil[0], `seul : ${Math.round(total.solo!)} > ${ceil[0]}`);
    assert.ok(Math.round(total.duo!) <= ceil[1], `à deux : ${Math.round(total.duo!)} > ${ceil[1]}`);
  });
}
