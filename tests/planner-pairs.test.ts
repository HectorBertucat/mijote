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
// s'il la raccourcit, baisser le plafond ici. Paires des recettes ajoutées le 30/10/2026 : durée mesurée ce jour-là.
const CEIL: Record<string, [solo: number, duo: number]> = {
  "butter-chicken-express+cannelloni-bolognaise": [145, 130],
  "butter-chicken-express+chasseur-porc": [180, 148],
  "butter-chicken-express+colombo-porc": [146, 124],
  "butter-chicken-express+couscous-poulet-merguez": [122, 97],
  "butter-chicken-express+dahl-pois-casses-poulet": [134, 109],
  "butter-chicken-express+gratin-facon-moussaka": [114, 99],
  "butter-chicken-express+medaillons-filet-mignon-moutarde": [90, 76],
  "butter-chicken-express+one-pot-orzo-poulet-champignons-citron": [123, 79],
  "butter-chicken-express+one-pot-orzo-poulet-epice": [119, 77],
  "butter-chicken-express+one-pot-orzo-poulet-epinards-parmesan": [108, 77],
  "butter-chicken-express+pasta-al-forno-saucisse-ricotta": [161, 111],
  "butter-chicken-express+porc-caramel-oeufs": [164, 119],
  "butter-chicken-express+poulet-basquaise": [136, 109],
  "butter-chicken-express+poulet-cremeux-ail-parmesan": [121, 84],
  "butter-chicken-express+poulet-paprika-fume-patates-douces": [124, 90],
  "butter-chicken-express+poulet-teriyaki-riz": [115, 81],
  "butter-chicken-express+saute-minute-porc-gingembre-miel": [92, 77],
  "cannelloni-bolognaise+chasseur-porc": [192, 148],
  "cannelloni-bolognaise+colombo-porc": [165, 133],
  "cannelloni-bolognaise+couscous-poulet-merguez": [142, 130],
  "cannelloni-bolognaise+dahl-pois-casses-poulet": [144, 130],
  "cannelloni-bolognaise+gratin-facon-moussaka": [151, 136],
  "cannelloni-bolognaise+medaillons-filet-mignon-moutarde": [133, 128],
  "cannelloni-bolognaise+one-pot-orzo-poulet-champignons-citron": [136, 128],
  "cannelloni-bolognaise+one-pot-orzo-poulet-epice": [135, 129],
  "cannelloni-bolognaise+one-pot-orzo-poulet-epinards-parmesan": [136, 129],
  "cannelloni-bolognaise+pasta-al-forno-saucisse-ricotta": [185, 175],
  "cannelloni-bolognaise+porc-caramel-oeufs": [169, 131],
  "cannelloni-bolognaise+poulet-basquaise": [153, 130],
  "cannelloni-bolognaise+poulet-cremeux-ail-parmesan": [177, 141],
  "cannelloni-bolognaise+poulet-paprika-fume-patates-douces": [169, 145],
  "cannelloni-bolognaise+poulet-teriyaki-riz": [134, 128],
  "cannelloni-bolognaise+saute-minute-porc-gingembre-miel": [134, 128],
  "chasseur-porc+colombo-porc": [255, 220],
  "chasseur-porc+couscous-poulet-merguez": [181, 148],
  "chasseur-porc+dahl-pois-casses-poulet": [185, 148],
  "chasseur-porc+gratin-facon-moussaka": [176, 148],
  "chasseur-porc+medaillons-filet-mignon-moutarde": [176, 148],
  "chasseur-porc+one-pot-orzo-poulet-champignons-citron": [184, 149],
  "chasseur-porc+one-pot-orzo-poulet-epice": [180, 148],
  "chasseur-porc+one-pot-orzo-poulet-epinards-parmesan": [174, 148],
  "chasseur-porc+pasta-al-forno-saucisse-ricotta": [217, 163],
  "chasseur-porc+porc-caramel-oeufs": [269, 232],
  "chasseur-porc+poulet-basquaise": [188, 148],
  "chasseur-porc+poulet-cremeux-ail-parmesan": [175, 148],
  "chasseur-porc+poulet-paprika-fume-patates-douces": [174, 148],
  "chasseur-porc+poulet-teriyaki-riz": [168, 148],
  "chasseur-porc+saute-minute-porc-gingembre-miel": [179, 148],
  "colombo-porc+couscous-poulet-merguez": [149, 124],
  "colombo-porc+dahl-pois-casses-poulet": [157, 124],
  "colombo-porc+gratin-facon-moussaka": [154, 124],
  "colombo-porc+medaillons-filet-mignon-moutarde": [141, 124],
  "colombo-porc+one-pot-orzo-poulet-champignons-citron": [141, 124],
  "colombo-porc+one-pot-orzo-poulet-epice": [142, 124],
  "colombo-porc+one-pot-orzo-poulet-epinards-parmesan": [144, 124],
  "colombo-porc+pasta-al-forno-saucisse-ricotta": [173, 126],
  "colombo-porc+porc-caramel-oeufs": [188, 142],
  "colombo-porc+poulet-basquaise": [162, 126],
  "colombo-porc+poulet-cremeux-ail-parmesan": [146, 124],
  "colombo-porc+poulet-paprika-fume-patates-douces": [143, 124],
  "colombo-porc+poulet-teriyaki-riz": [142, 124],
  "colombo-porc+saute-minute-porc-gingembre-miel": [147, 127],
  "couscous-poulet-merguez+dahl-pois-casses-poulet": [132, 106],
  "couscous-poulet-merguez+gratin-facon-moussaka": [119, 100],
  "couscous-poulet-merguez+medaillons-filet-mignon-moutarde": [101, 94],
  "couscous-poulet-merguez+one-pot-orzo-poulet-champignons-citron": [115, 95],
  "couscous-poulet-merguez+one-pot-orzo-poulet-epice": [108, 96],
  "couscous-poulet-merguez+one-pot-orzo-poulet-epinards-parmesan": [105, 96],
  "couscous-poulet-merguez+pasta-al-forno-saucisse-ricotta": [158, 112],
  "couscous-poulet-merguez+porc-caramel-oeufs": [160, 119],
  "couscous-poulet-merguez+poulet-basquaise": [146, 109],
  "couscous-poulet-merguez+poulet-cremeux-ail-parmesan": [120, 107],
  "couscous-poulet-merguez+poulet-paprika-fume-patates-douces": [124, 96],
  "couscous-poulet-merguez+poulet-teriyaki-riz": [115, 95],
  "couscous-poulet-merguez+saute-minute-porc-gingembre-miel": [102, 95],
  "dahl-pois-casses-poulet+gratin-facon-moussaka": [124, 109],
  "dahl-pois-casses-poulet+medaillons-filet-mignon-moutarde": [112, 101],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-champignons-citron": [120, 106],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-epice": [122, 106],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-epinards-parmesan": [124, 107],
  "dahl-pois-casses-poulet+pasta-al-forno-saucisse-ricotta": [156, 117],
  "dahl-pois-casses-poulet+porc-caramel-oeufs": [165, 121],
  "dahl-pois-casses-poulet+poulet-basquaise": [147, 113],
  "dahl-pois-casses-poulet+poulet-cremeux-ail-parmesan": [129, 106],
  "dahl-pois-casses-poulet+poulet-paprika-fume-patates-douces": [128, 108],
  "dahl-pois-casses-poulet+poulet-teriyaki-riz": [119, 103],
  "dahl-pois-casses-poulet+saute-minute-porc-gingembre-miel": [113, 102],
  "gratin-facon-moussaka+medaillons-filet-mignon-moutarde": [100, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-champignons-citron": [109, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-epice": [102, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-epinards-parmesan": [102, 99],
  "gratin-facon-moussaka+pasta-al-forno-saucisse-ricotta": [174, 146],
  "gratin-facon-moussaka+porc-caramel-oeufs": [150, 119],
  "gratin-facon-moussaka+poulet-basquaise": [124, 109],
  "gratin-facon-moussaka+poulet-cremeux-ail-parmesan": [123, 117],
  "gratin-facon-moussaka+poulet-paprika-fume-patates-douces": [137, 122],
  "gratin-facon-moussaka+poulet-teriyaki-riz": [102, 99],
  "gratin-facon-moussaka+saute-minute-porc-gingembre-miel": [100, 99],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-champignons-citron": [83, 63],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-epice": [78, 59],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-epinards-parmesan": [69, 53],
  "medaillons-filet-mignon-moutarde+pasta-al-forno-saucisse-ricotta": [129, 102],
  "medaillons-filet-mignon-moutarde+porc-caramel-oeufs": [145, 119],
  "medaillons-filet-mignon-moutarde+poulet-basquaise": [114, 106],
  "medaillons-filet-mignon-moutarde+poulet-cremeux-ail-parmesan": [85, 78],
  "medaillons-filet-mignon-moutarde+poulet-paprika-fume-patates-douces": [92, 79],
  "medaillons-filet-mignon-moutarde+poulet-teriyaki-riz": [73, 53],
  "medaillons-filet-mignon-moutarde+saute-minute-porc-gingembre-miel": [49, 33],
  "one-pot-orzo-poulet-champignons-citron+one-pot-orzo-poulet-epice": [119, 72],
  "one-pot-orzo-poulet-champignons-citron+one-pot-orzo-poulet-epinards-parmesan": [110, 68],
  "one-pot-orzo-poulet-champignons-citron+pasta-al-forno-saucisse-ricotta": [145, 106],
  "one-pot-orzo-poulet-champignons-citron+porc-caramel-oeufs": [148, 119],
  "one-pot-orzo-poulet-champignons-citron+poulet-basquaise": [130, 107],
  "one-pot-orzo-poulet-champignons-citron+poulet-cremeux-ail-parmesan": [114, 78],
  "one-pot-orzo-poulet-champignons-citron+poulet-paprika-fume-patates-douces": [113, 85],
  "one-pot-orzo-poulet-champignons-citron+poulet-teriyaki-riz": [108, 70],
  "one-pot-orzo-poulet-champignons-citron+saute-minute-porc-gingembre-miel": [78, 63],
  "one-pot-orzo-poulet-epice+one-pot-orzo-poulet-epinards-parmesan": [104, 64],
  "one-pot-orzo-poulet-epice+pasta-al-forno-saucisse-ricotta": [145, 107],
  "one-pot-orzo-poulet-epice+porc-caramel-oeufs": [145, 119],
  "one-pot-orzo-poulet-epice+poulet-basquaise": [122, 109],
  "one-pot-orzo-poulet-epice+poulet-cremeux-ail-parmesan": [108, 78],
  "one-pot-orzo-poulet-epice+poulet-paprika-fume-patates-douces": [106, 85],
  "one-pot-orzo-poulet-epice+poulet-teriyaki-riz": [102, 66],
  "one-pot-orzo-poulet-epice+saute-minute-porc-gingembre-miel": [78, 60],
  "one-pot-orzo-poulet-epinards-parmesan+pasta-al-forno-saucisse-ricotta": [144, 108],
  "one-pot-orzo-poulet-epinards-parmesan+porc-caramel-oeufs": [143, 119],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-basquaise": [117, 108],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-cremeux-ail-parmesan": [100, 78],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-paprika-fume-patates-douces": [105, 85],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-teriyaki-riz": [93, 63],
  "one-pot-orzo-poulet-epinards-parmesan+saute-minute-porc-gingembre-miel": [71, 53],
  "pasta-al-forno-saucisse-ricotta+porc-caramel-oeufs": [185, 127],
  "pasta-al-forno-saucisse-ricotta+poulet-basquaise": [169, 122],
  "pasta-al-forno-saucisse-ricotta+poulet-cremeux-ail-parmesan": [156, 129],
  "pasta-al-forno-saucisse-ricotta+poulet-paprika-fume-patates-douces": [152, 129],
  "pasta-al-forno-saucisse-ricotta+poulet-teriyaki-riz": [131, 102],
  "pasta-al-forno-saucisse-ricotta+saute-minute-porc-gingembre-miel": [128, 102],
  "porc-caramel-oeufs+poulet-basquaise": [172, 123],
  "porc-caramel-oeufs+poulet-cremeux-ail-parmesan": [154, 119],
  "porc-caramel-oeufs+poulet-paprika-fume-patates-douces": [152, 119],
  "porc-caramel-oeufs+poulet-teriyaki-riz": [142, 119],
  "porc-caramel-oeufs+saute-minute-porc-gingembre-miel": [144, 122],
  "poulet-basquaise+poulet-cremeux-ail-parmesan": [129, 107],
  "poulet-basquaise+poulet-paprika-fume-patates-douces": [136, 108],
  "poulet-basquaise+poulet-teriyaki-riz": [126, 107],
  "poulet-basquaise+saute-minute-porc-gingembre-miel": [117, 107],
  "poulet-cremeux-ail-parmesan+poulet-paprika-fume-patates-douces": [119, 91],
  "poulet-cremeux-ail-parmesan+poulet-teriyaki-riz": [107, 78],
  "poulet-cremeux-ail-parmesan+saute-minute-porc-gingembre-miel": [84, 78],
  "poulet-paprika-fume-patates-douces+poulet-teriyaki-riz": [106, 80],
  "poulet-paprika-fume-patates-douces+saute-minute-porc-gingembre-miel": [92, 80],
  "poulet-teriyaki-riz+saute-minute-porc-gingembre-miel": [69, 49],
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
