import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { planSession, validatePlan, type SessionMode } from "@/lib/session/planner";
import { auditPlan } from "@/lib/session/audit";
import { load, RES } from "./helpers";

// Toutes les paires de recettes du seed, seul et à deux (audit du 25/10/2026, `pnpm plan:audit`).
// Pas un fichier *.test.ts : les paires sont réparties entre planner-pairs-1…4.test.ts, que
// `node --test` lance en parallèle (une paire coûte ~40 ms et leur nombre croît comme n²).
// Chaque paire est vérifiée par exactement un morceau ; le premier vérifie la couverture.
const R = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);
const pairs = R.flatMap((a, i) => R.slice(i + 1).map((b) => [a, b] as const));
const key = (a: { slug: string }, b: { slug: string }) => `${a.slug}+${b.slug}`;
export const PARTS = 4;

// Plafonds : la durée totale mesurée le 25/10/2026, après les essais multiples, le faitout de
// rechange du colombo, les suites dans le même récipient qui n'attendent plus (un peu plus long
// sur pasta + caramel : la cocotte ne patiente plus entre deux étapes) et, seul, les gestes
// glissés dans la cuisson par moments d'au moins 5 min
// (moyenne 182 → 168 min seul, 142 → 136 min à deux). Un changement du planificateur ne doit pas rallonger une session ;
// s'il la raccourcit, baisser le plafond ici. Paires des recettes ajoutées le 30/10/2026 : durée mesurée ce jour-là.
// 01/11/2026, attention par étape (mains, surveille, libre), bases communes, à-côtés attendus : 124 plafonds
// baissés, 99 relevés. 95 des relevés venaient d'un plan qui demandait deux gestes « mains » en même temps
// (148 plans seuls sur 153 en avaient au moins un), 2 d'une étape partie avant l'à-côté qu'elle attend
// (« Poulet dans la sauce » avant la saisie du poulet, le montage du gratin avant sa sauce) ; 2 seulement par
// l'ordre glouton (+2 et +7 min à deux). Moyennes : seul 134,5 → 134,3 min, à deux 110,1 → 105,7 min.
const CEIL: Record<string, [solo: number, duo: number]> = {
  "butter-chicken-express+cannelloni-bolognaise": [146, 130],
  "butter-chicken-express+chasseur-porc": [179, 148],
  "butter-chicken-express+colombo-porc": [154, 124],
  "butter-chicken-express+couscous-poulet-merguez": [121, 97],
  "butter-chicken-express+dahl-pois-casses-poulet": [139, 95],
  "butter-chicken-express+gratin-facon-moussaka": [121, 99],
  "butter-chicken-express+medaillons-filet-mignon-moutarde": [90, 56],
  "butter-chicken-express+one-pot-orzo-poulet-champignons-citron": [131, 83],
  "butter-chicken-express+one-pot-orzo-poulet-epice": [122, 82],
  "butter-chicken-express+one-pot-orzo-poulet-epinards-parmesan": [118, 80],
  "butter-chicken-express+pasta-al-forno-saucisse-ricotta": [168, 111],
  "butter-chicken-express+porc-caramel-oeufs": [156, 120],
  "butter-chicken-express+poulet-basquaise": [119, 104],
  "butter-chicken-express+poulet-cremeux-ail-parmesan": [131, 83],
  "butter-chicken-express+poulet-paprika-fume-patates-douces": [114, 74],
  "butter-chicken-express+poulet-teriyaki-riz": [118, 79],
  "butter-chicken-express+saute-minute-porc-gingembre-miel": [92, 58],
  "cannelloni-bolognaise+chasseur-porc": [189, 148],
  "cannelloni-bolognaise+colombo-porc": [169, 133],
  "cannelloni-bolognaise+couscous-poulet-merguez": [156, 129],
  "cannelloni-bolognaise+dahl-pois-casses-poulet": [142, 130],
  "cannelloni-bolognaise+gratin-facon-moussaka": [155, 136],
  "cannelloni-bolognaise+medaillons-filet-mignon-moutarde": [140, 128],
  "cannelloni-bolognaise+one-pot-orzo-poulet-champignons-citron": [136, 128],
  "cannelloni-bolognaise+one-pot-orzo-poulet-epice": [139, 129],
  "cannelloni-bolognaise+one-pot-orzo-poulet-epinards-parmesan": [136, 129],
  "cannelloni-bolognaise+pasta-al-forno-saucisse-ricotta": [185, 175],
  "cannelloni-bolognaise+porc-caramel-oeufs": [174, 130],
  "cannelloni-bolognaise+poulet-basquaise": [150, 130],
  "cannelloni-bolognaise+poulet-cremeux-ail-parmesan": [173, 137],
  "cannelloni-bolognaise+poulet-paprika-fume-patates-douces": [153, 142],
  "cannelloni-bolognaise+poulet-teriyaki-riz": [155, 128],
  "cannelloni-bolognaise+saute-minute-porc-gingembre-miel": [142, 128],
  "chasseur-porc+colombo-porc": [229, 177],
  "chasseur-porc+couscous-poulet-merguez": [184, 148],
  "chasseur-porc+dahl-pois-casses-poulet": [170, 148],
  "chasseur-porc+gratin-facon-moussaka": [188, 148],
  "chasseur-porc+medaillons-filet-mignon-moutarde": [169, 148],
  "chasseur-porc+one-pot-orzo-poulet-champignons-citron": [174, 149],
  "chasseur-porc+one-pot-orzo-poulet-epice": [173, 148],
  "chasseur-porc+one-pot-orzo-poulet-epinards-parmesan": [166, 148],
  "chasseur-porc+pasta-al-forno-saucisse-ricotta": [222, 158],
  "chasseur-porc+porc-caramel-oeufs": [266, 232],
  "chasseur-porc+poulet-basquaise": [171, 148],
  "chasseur-porc+poulet-cremeux-ail-parmesan": [168, 148],
  "chasseur-porc+poulet-paprika-fume-patates-douces": [167, 148],
  "chasseur-porc+poulet-teriyaki-riz": [168, 148],
  "chasseur-porc+saute-minute-porc-gingembre-miel": [173, 148],
  "colombo-porc+couscous-poulet-merguez": [158, 124],
  "colombo-porc+dahl-pois-casses-poulet": [153, 124],
  "colombo-porc+gratin-facon-moussaka": [156, 124],
  "colombo-porc+medaillons-filet-mignon-moutarde": [146, 124],
  "colombo-porc+one-pot-orzo-poulet-champignons-citron": [146, 124],
  "colombo-porc+one-pot-orzo-poulet-epice": [146, 124],
  "colombo-porc+one-pot-orzo-poulet-epinards-parmesan": [150, 124],
  "colombo-porc+pasta-al-forno-saucisse-ricotta": [186, 129],
  "colombo-porc+porc-caramel-oeufs": [196, 142],
  "colombo-porc+poulet-basquaise": [151, 124],
  "colombo-porc+poulet-cremeux-ail-parmesan": [167, 124],
  "colombo-porc+poulet-paprika-fume-patates-douces": [150, 124],
  "colombo-porc+poulet-teriyaki-riz": [151, 124],
  "colombo-porc+saute-minute-porc-gingembre-miel": [154, 127],
  "couscous-poulet-merguez+dahl-pois-casses-poulet": [116, 97],
  "couscous-poulet-merguez+gratin-facon-moussaka": [128, 105],
  "couscous-poulet-merguez+medaillons-filet-mignon-moutarde": [110, 94],
  "couscous-poulet-merguez+one-pot-orzo-poulet-champignons-citron": [117, 95],
  "couscous-poulet-merguez+one-pot-orzo-poulet-epice": [118, 96],
  "couscous-poulet-merguez+one-pot-orzo-poulet-epinards-parmesan": [106, 96],
  "couscous-poulet-merguez+pasta-al-forno-saucisse-ricotta": [154, 114],
  "couscous-poulet-merguez+porc-caramel-oeufs": [166, 119],
  "couscous-poulet-merguez+poulet-basquaise": [123, 97],
  "couscous-poulet-merguez+poulet-cremeux-ail-parmesan": [125, 101],
  "couscous-poulet-merguez+poulet-paprika-fume-patates-douces": [107, 96],
  "couscous-poulet-merguez+poulet-teriyaki-riz": [119, 95],
  "couscous-poulet-merguez+saute-minute-porc-gingembre-miel": [112, 95],
  "dahl-pois-casses-poulet+gratin-facon-moussaka": [115, 99],
  "dahl-pois-casses-poulet+medaillons-filet-mignon-moutarde": [87, 78],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-champignons-citron": [107, 84],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-epice": [103, 84],
  "dahl-pois-casses-poulet+one-pot-orzo-poulet-epinards-parmesan": [98, 84],
  "dahl-pois-casses-poulet+pasta-al-forno-saucisse-ricotta": [140, 109],
  "dahl-pois-casses-poulet+porc-caramel-oeufs": [160, 120],
  "dahl-pois-casses-poulet+poulet-basquaise": [128, 104],
  "dahl-pois-casses-poulet+poulet-cremeux-ail-parmesan": [117, 88],
  "dahl-pois-casses-poulet+poulet-paprika-fume-patates-douces": [101, 86],
  "dahl-pois-casses-poulet+poulet-teriyaki-riz": [112, 81],
  "dahl-pois-casses-poulet+saute-minute-porc-gingembre-miel": [89, 80],
  "gratin-facon-moussaka+medaillons-filet-mignon-moutarde": [110, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-champignons-citron": [117, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-epice": [110, 99],
  "gratin-facon-moussaka+one-pot-orzo-poulet-epinards-parmesan": [112, 99],
  "gratin-facon-moussaka+pasta-al-forno-saucisse-ricotta": [186, 148],
  "gratin-facon-moussaka+porc-caramel-oeufs": [169, 119],
  "gratin-facon-moussaka+poulet-basquaise": [119, 100],
  "gratin-facon-moussaka+poulet-cremeux-ail-parmesan": [147, 121],
  "gratin-facon-moussaka+poulet-paprika-fume-patates-douces": [142, 129],
  "gratin-facon-moussaka+poulet-teriyaki-riz": [127, 99],
  "gratin-facon-moussaka+saute-minute-porc-gingembre-miel": [107, 99],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-champignons-citron": [83, 63],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-epice": [78, 59],
  "medaillons-filet-mignon-moutarde+one-pot-orzo-poulet-epinards-parmesan": [73, 52],
  "medaillons-filet-mignon-moutarde+pasta-al-forno-saucisse-ricotta": [128, 103],
  "medaillons-filet-mignon-moutarde+porc-caramel-oeufs": [159, 119],
  "medaillons-filet-mignon-moutarde+poulet-basquaise": [98, 83],
  "medaillons-filet-mignon-moutarde+poulet-cremeux-ail-parmesan": [89, 75],
  "medaillons-filet-mignon-moutarde+poulet-paprika-fume-patates-douces": [72, 57],
  "medaillons-filet-mignon-moutarde+poulet-teriyaki-riz": [75, 49],
  "medaillons-filet-mignon-moutarde+saute-minute-porc-gingembre-miel": [52, 31],
  "one-pot-orzo-poulet-champignons-citron+one-pot-orzo-poulet-epice": [128, 72],
  "one-pot-orzo-poulet-champignons-citron+one-pot-orzo-poulet-epinards-parmesan": [109, 67],
  "one-pot-orzo-poulet-champignons-citron+pasta-al-forno-saucisse-ricotta": [159, 108],
  "one-pot-orzo-poulet-champignons-citron+porc-caramel-oeufs": [154, 119],
  "one-pot-orzo-poulet-champignons-citron+poulet-basquaise": [112, 84],
  "one-pot-orzo-poulet-champignons-citron+poulet-cremeux-ail-parmesan": [124, 75],
  "one-pot-orzo-poulet-champignons-citron+poulet-paprika-fume-patates-douces": [115, 70],
  "one-pot-orzo-poulet-champignons-citron+poulet-teriyaki-riz": [114, 69],
  "one-pot-orzo-poulet-champignons-citron+saute-minute-porc-gingembre-miel": [88, 63],
  "one-pot-orzo-poulet-epice+one-pot-orzo-poulet-epinards-parmesan": [102, 64],
  "one-pot-orzo-poulet-epice+pasta-al-forno-saucisse-ricotta": [153, 109],
  "one-pot-orzo-poulet-epice+porc-caramel-oeufs": [155, 119],
  "one-pot-orzo-poulet-epice+poulet-basquaise": [108, 86],
  "one-pot-orzo-poulet-epice+poulet-cremeux-ail-parmesan": [118, 75],
  "one-pot-orzo-poulet-epice+poulet-paprika-fume-patates-douces": [112, 68],
  "one-pot-orzo-poulet-epice+poulet-teriyaki-riz": [114, 66],
  "one-pot-orzo-poulet-epice+saute-minute-porc-gingembre-miel": [80, 60],
  "one-pot-orzo-poulet-epinards-parmesan+pasta-al-forno-saucisse-ricotta": [148, 107],
  "one-pot-orzo-poulet-epinards-parmesan+porc-caramel-oeufs": [143, 119],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-basquaise": [101, 86],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-cremeux-ail-parmesan": [117, 75],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-paprika-fume-patates-douces": [90, 63],
  "one-pot-orzo-poulet-epinards-parmesan+poulet-teriyaki-riz": [92, 62],
  "one-pot-orzo-poulet-epinards-parmesan+saute-minute-porc-gingembre-miel": [71, 52],
  "pasta-al-forno-saucisse-ricotta+porc-caramel-oeufs": [193, 136],
  "pasta-al-forno-saucisse-ricotta+poulet-basquaise": [158, 111],
  "pasta-al-forno-saucisse-ricotta+poulet-cremeux-ail-parmesan": [162, 135],
  "pasta-al-forno-saucisse-ricotta+poulet-paprika-fume-patates-douces": [154, 128],
  "pasta-al-forno-saucisse-ricotta+poulet-teriyaki-riz": [154, 103],
  "pasta-al-forno-saucisse-ricotta+saute-minute-porc-gingembre-miel": [131, 103],
  "porc-caramel-oeufs+poulet-basquaise": [160, 120],
  "porc-caramel-oeufs+poulet-cremeux-ail-parmesan": [167, 119],
  "porc-caramel-oeufs+poulet-paprika-fume-patates-douces": [146, 119],
  "porc-caramel-oeufs+poulet-teriyaki-riz": [151, 119],
  "porc-caramel-oeufs+saute-minute-porc-gingembre-miel": [153, 122],
  "poulet-basquaise+poulet-cremeux-ail-parmesan": [111, 85],
  "poulet-basquaise+poulet-paprika-fume-patates-douces": [111, 86],
  "poulet-basquaise+poulet-teriyaki-riz": [106, 84],
  "poulet-basquaise+saute-minute-porc-gingembre-miel": [94, 85],
  "poulet-cremeux-ail-parmesan+poulet-paprika-fume-patates-douces": [114, 75],
  "poulet-cremeux-ail-parmesan+poulet-teriyaki-riz": [121, 75],
  "poulet-cremeux-ail-parmesan+saute-minute-porc-gingembre-miel": [81, 75],
  "poulet-paprika-fume-patates-douces+poulet-teriyaki-riz": [100, 58],
  "poulet-paprika-fume-patates-douces+saute-minute-porc-gingembre-miel": [73, 58],
  "poulet-teriyaki-riz+saute-minute-porc-gingembre-miel": [74, 46],
};

/** Le morceau `part` (1 à `parts`) : une paire sur `parts`, dans l'ordre des noms. */
export function pairsOf<T>(all: readonly T[], part: number, parts: number): T[] {
  if (!Number.isInteger(parts) || parts < 1 || !Number.isInteger(part) || part < 1 || part > parts) throw new Error(`morceau ${part}/${parts} invalide`);
  return all.filter((_, k) => k % parts === part - 1);
}

/** Déclare les tests du morceau `part` sur `PARTS`. */
export function pairTests(part: number) {
  const mine = pairsOf(pairs, part, PARTS);
  // Jamais « 0 paire testée → vert ».
  test(`paires, morceau ${part}/${PARTS} : au moins une paire`, () => {
    assert.ok(R.length >= 2, "moins de deux recettes dans src/seed/recipes");
    assert.ok(mine.length > 0, `aucune paire dans le morceau ${part}/${PARTS}`);
  });
  if (part === 1) {
    test("paires : chacune dans un seul morceau, un plafond pour chacune, aucun plafond orphelin", () => {
      const all = pairs.map(([a, b]) => key(a, b)).sort();
      const covered = Array.from({ length: PARTS }, (_, k) => pairsOf(pairs, k + 1, PARTS)).flat().map(([a, b]) => key(a, b));
      assert.deepEqual(covered.sort(), all);
      assert.deepEqual(Object.keys(CEIL).sort(), all);
    });
    test("paires : un fichier par morceau, chacun lance le sien", () => {
      const files = fs.readdirSync("tests").filter((f) => /^planner-pairs-\d+\.test\.ts$/.test(f)).sort();
      assert.deepEqual(files, Array.from({ length: PARTS }, (_, k) => `planner-pairs-${k + 1}.test.ts`).sort());
      for (let k = 1; k <= PARTS; k++) assert.match(fs.readFileSync(`tests/planner-pairs-${k}.test.ts`, "utf8"), new RegExp(`pairTests\\(${k}\\)`));
    });
    test("pairsOf : partage exact, morceau invalide refusé", () => {
      for (let n = 0; n <= 12; n++) {
        const all = Array.from({ length: n }, (_, k) => k);
        for (let parts = 1; parts <= 5; parts++) {
          const got = Array.from({ length: parts }, (_, k) => pairsOf(all, k + 1, parts));
          assert.deepEqual(got.flat().sort((x, y) => x - y), all);
          assert.ok(got.every((g) => Math.abs(g.length - n / parts) < 1));
        }
      }
      for (const [part, parts] of [[0, 4], [5, 4], [1, 0], [1.5, 4]]) assert.throws(() => pairsOf([1], part, parts));
    });
  }

  // Durée d'une recette seule : calculée une fois par recette et par mode (elle ne dépend que d'elle).
  const aloneMin = new Map<string, number>();
  const alone = (r: (typeof R)[number], mode: SessionMode) => {
    const k = `${r.slug}:${mode}`;
    if (!aloneMin.has(k)) aloneMin.set(k, planSession([r], RES, { mode }).totalMin);
    return aloneMin.get(k)!;
  };

  for (const [a, b] of mine) {
    test(`paire ${a.slug} + ${b.slug} : plans valides et audités, en parallèle, à deux plus court`, () => {
      const total: Partial<Record<SessionMode, number>> = {};
      for (const mode of ["solo", "duo"] as SessionMode[]) {
        const p = planSession([a, b], RES, { mode });
        assert.deepEqual(p.errors, [], p.errors.map((e) => e.message).join("\n"));
        assert.deepEqual(validatePlan(p, RES), []);
        // Récipients assez grands, bols en nombre, bases regroupées, quantités partout, une tâche « mains » à la fois.
        assert.deepEqual(auditPlan(p, RES).map((i) => `${mode} [${i.kind}] ${i.message}`), []);
        const one = [alone(a, mode), alone(b, mode)];
        // Jamais plus long que les deux recettes à la suite, ni nettement plus court que la plus longue
        // seule (le plan d'une recette seule n'est pas forcément le meilleur possible : 10 % de marge).
        assert.ok(p.totalMin <= one[0] + one[1] + 0.5, `${mode} : ${p.totalMin} > ${one[0]} + ${one[1]}`);
        assert.ok(p.totalMin >= Math.max(...one) * 0.9, `${mode} : ${p.totalMin} < ${Math.max(...one)}`);
        total[mode] = p.totalMin;
      }
      assert.ok(total.duo! <= total.solo!, `à deux ${total.duo} > seul ${total.solo}`);
      const ceil = CEIL[key(a, b)];
      assert.ok(ceil, `plafond manquant pour ${key(a, b)}`);
      assert.ok(Math.round(total.solo!) <= ceil[0], `seul : ${Math.round(total.solo!)} > ${ceil[0]}`);
      assert.ok(Math.round(total.duo!) <= ceil[1], `à deux : ${Math.round(total.duo!)} > ${ceil[1]}`);
    });
  }
}
