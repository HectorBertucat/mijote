// Objectifs → recettes : score d'une recette pour chacun, adéquation d'une sélection, suggestion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mealRef } from "@/lib/eaters/core";
import { adjustPrompt, systemPrompt } from "@/lib/atelier/prompt";
import { densityOf, densityTarget, fitBadge, fitLine, fitRank, fitsAll, fitSummary, proteinDense, recipeFit, recipeFits, weekFit, wheyFor, type FitEater, type FitRecipe } from "@/lib/week/fit";

// Alex : recomposition, très protéiné. Sam : perte de poids, petit gabarit, un shaker le matin.
const alex: FitEater = { id: "alex", name: "Alex", baseUnits: 5, ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 } };
const samTarget = { kcal: 1500, proteinG: 110 };
const samShaker = { kcal: 250, protein: 30 };
const sam: FitEater = { id: "sam", name: "Sam", baseUnits: 4, ref: mealRef(samTarget, samShaker), dayTarget: samTarget, outside: samShaker, hasShaker: true };
const both = [alex, sam];

const r = (slug: string, kcalUnit: number | null, proteinUnit: number | null, status = "liked"): FitRecipe => ({ slug, name: slug[0].toUpperCase() + slug.slice(1).replace(/-/g, " "), kcalUnit, proteinUnit, status });
const tikka = r("poulet-tikka", 140, 13); // très protéiné
const pates = r("pates-creme", 160, 6); // pauvre en protéines
const chili = r("chili", 150, 10); // un peu juste pour Alex
const gratin = r("gratin-savoyard", 340, 15); // très riche
const dinde = r("dinde-curry", 130, 14);
const mystere = r("mystere", null, null);

test("repère de Sam : le shaker baisse ce qu'un repas doit apporter", () => {
  assert.deepEqual(sam.ref, { kcalMin: 550, kcalMax: 700, proteinMin: 36, proteinMax: 47 });
});

test("recette très protéinée : bien pour les deux, protéines au-dessus du repère sans gêne", () => {
  const a = recipeFit(alex, tikka);
  assert.equal(a.units, 5);
  assert.equal(a.kcal, 700);
  assert.equal(a.protein, 65);
  assert.equal(a.level, "bien");
  const s = recipeFit(sam, tikka);
  assert.equal(s.units, 4.5);
  assert.equal(s.protein, 59); // au-dessus de 47 : pas un défaut
  assert.equal(s.level, "bien");
  // Une pastille verte seulement pour une recette qui se distingue (proteinDense) : sinon rien.
  assert.equal(fitBadge(recipeFits(both, tikka)), null);
  assert.deepEqual(fitBadge(recipeFits(both, tikka), true), { tone: "ok", text: "Protéiné pour Alex et Sam" });
});

test("recette pauvre en protéines : même la plus grande part sous le plafond de kcal n'atteint pas le repère", () => {
  const a = recipeFit(alex, pates);
  assert.equal(a.units, 4.5);
  assert.equal(a.protein, 27);
  assert.equal(a.proteinBest, 27); // 760 / 160 = 4,75 → 4,5 u au plus
  assert.equal(a.level, "loin");
  assert.equal(a.issue, "proteines");
  assert.deepEqual(fitBadge(recipeFits(both, pates)), { tone: "warn", text: "Peu protéiné pour Alex" });
  assert.equal(fitsAll(recipeFits(both, pates)), false);
});

test("petit écart : « juste », sans pastille", () => {
  const a = recipeFit(alex, chili);
  assert.equal(a.protein, 50);
  assert.equal(a.level, "juste");
  // Sam y est bien : une pastille « Protéiné » ne nomme que Sam
  assert.equal(fitBadge(recipeFits(both, chili)), null);
  assert.deepEqual(fitBadge(recipeFits(both, chili), true), { tone: "ok", text: "Protéiné pour Sam" });
  assert.equal(fitBadge([recipeFit(alex, chili)], true), null);
});

test("plat très riche : la part de Sam est déjà au plus petit (60 %), trop riche quand même", () => {
  const s = recipeFit(sam, gratin);
  assert.equal(s.units, 2.5);
  assert.equal(s.kcal, 850);
  assert.equal(s.level, "loin");
  assert.equal(s.issue, "trop-riche");
  // Alex aussi (3 u au moins : 1 020 kcal), plus loin encore : c'est Alex que la pastille nomme.
  assert.deepEqual(fitBadge(recipeFits(both, gratin)), { tone: "warn", text: "Trop riche pour Alex" });
});

test("sans repère ou sans macros : pas de niveau, pas de pastille", () => {
  const nobody: FitEater = { id: "x", name: "Léo", baseUnits: 4, ref: null };
  assert.deepEqual(recipeFits([nobody], tikka), []);
  assert.equal(recipeFit(alex, mystere).level, null);
  assert.equal(fitBadge(recipeFits(both, mystere)), null);
});

test("habitudes hors batch : avec un petit-déjeuner classique au lieu du shaker, la même recette devient juste", () => {
  const plain = { kcalUnit: 150, proteinUnit: 9.5 };
  const bread = { kcal: 300, protein: 22 };
  const noShaker: FitEater = { ...sam, ref: mealRef(samTarget, bread), outside: bread, hasShaker: false };
  assert.equal(recipeFit(sam, plain).level, "bien"); // 4 u : 600 kcal, 38 g ; repère 36 g avec le shaker
  assert.equal(recipeFit(noShaker, plain).level, "juste"); // repère 40 g sans
});

test("tri « Pour nos objectifs » : bien d'abord, loin en dernier", () => {
  const lib = [pates, chili, tikka, gratin];
  const sorted = [...lib].sort((x, y) => fitRank(recipeFits(both, x)) - fitRank(recipeFits(both, y))).map((x) => x.slug);
  assert.equal(sorted[0], "poulet-tikka");
  assert.equal(sorted[1], "chili");
  assert.ok(sorted.indexOf("pates-creme") > 1 && sorted.indexOf("gratin-savoyard") > 1);
});

test("sélection protéinée : rien à dire, un résumé d'une ligne", () => {
  const w = weekFit(both, [tikka, dinde]);
  assert.equal(w.ok, true);
  assert.equal(w.warnings.length, 0);
  assert.equal(fitSummary(w), "Protéines et kcal dans le repère d’Alex et Sam.");
  const a = w.people.find((p) => p.personId === "alex")!;
  assert.equal(a.level, "bien");
  assert.equal(a.perMeal!.protein, 71); // (65 + 77) / 2
});

test("sélection pauvre en protéines : un avertissement concret, une recette vérifiée et le shaker chiffré", () => {
  const w = weekFit(both, [tikka, pates], { library: [tikka, pates, chili, gratin, dinde, mystere] });
  assert.equal(w.ok, false);
  const a = w.people.find((p) => p.personId === "alex")!;
  assert.equal(a.perMeal!.protein, 46); // (65 + 27) / 2
  assert.equal(a.proteinShort, 6);
  assert.equal(a.level, "loin");
  assert.equal(w.warnings.length, 1);
  const warn = w.warnings[0];
  assert.equal(warn.personId, "alex");
  assert.equal(warn.issue, "proteines");
  assert.equal(warn.text, "~46 g de protéines par repas pour 52 visés");
  // La dinde fait le plus gagner (le chili, juste, beaucoup moins) ; jamais une recette déjà choisie.
  assert.deepEqual(warn.suggestion.recipe, { slug: "dinde-curry", name: "Dinde curry" });
  assert.equal(warn.suggestion.shakerG, 15); // 2 × 6 g par jour, arrondi à 5
  assert.match(warn.suggestion.text, /Dinde curry.*shaker de ~15 g/);
  assert.equal(wheyFor(15), 20);
});

test("la répartition compte : peu de repas de pâtes pour Alex, pas d'avertissement", () => {
  const served = new Map([["alex", new Map([["poulet-tikka", 8], ["pates-creme", 2]])], ["sam", new Map([["poulet-tikka", 5], ["pates-creme", 5]])]]);
  const w = weekFit(both, [tikka, pates], { served });
  const a = w.people.find((p) => p.personId === "alex")!;
  assert.equal(a.meals, 10);
  assert.equal(a.perMeal!.protein, Math.round((65 * 8 + 27 * 2) / 10));
  assert.equal(w.warnings.some((x) => x.personId === "alex"), false);
});

test("pas de recette à suggérer au-delà de quatre plats ; un shaker déjà pris → un en-cas", () => {
  const poor = [r("a", 160, 5), r("b", 160, 5), r("c", 160, 5), r("d", 160, 5)];
  const w = weekFit([sam], poor, { library: [...poor, dinde] });
  const warn = w.warnings[0];
  assert.equal(warn.issue, "proteines");
  assert.equal(warn.suggestion.recipe, null);
  assert.equal(warn.suggestion.shakerG, null);
  assert.match(warn.suggestion.text, /en-cas protéiné de plus/);
});

test("une recette que la personne n'aime pas n'est ni comptée ni suggérée pour elle", () => {
  const excluded = new Map([["pates-creme", new Set(["alex"])], ["dinde-curry", new Set(["alex"])]]);
  const w = weekFit(both, [tikka, pates], { excluded, library: [tikka, pates, dinde, chili] });
  const a = w.people.find((p) => p.personId === "alex")!;
  assert.equal(a.perMeal!.protein, 65); // seulement le tikka
  assert.equal(w.warnings.length, 0);
});

test("trop riche pour Sam : un plat plus léger, vérifié pour Alex aussi", () => {
  const w = weekFit(both, [gratin], { library: [gratin, pates, tikka] });
  const warn = w.warnings.find((x) => x.personId === "sam")!;
  assert.equal(warn.issue, "trop-riche");
  assert.equal(warn.text, "~850 kcal par repas pour 700 au plus");
  // Les pâtes allégeraient, mais elles sont loin pour Alex : c'est le tikka.
  assert.deepEqual(warn.suggestion.recipe, { slug: "poulet-tikka", name: "Poulet tikka" });
});

test("jour moyen : deux repas et le hors batch", () => {
  const w = weekFit([sam], [tikka]);
  const s = w.people[0];
  assert.deepEqual(s.perDay, { kcal: 2 * 630 + 250, protein: 2 * 59 + 30 });
});

test("atelier : les protéines pour 100 kcal qu'une recette doit apporter, dans le prompt", () => {
  assert.equal(densityTarget(alex.ref!), 7.1); // 52 g pour 730 kcal
  const prompt = systemPrompt({ preferences: [], equipment: [], household: [{ id: "alex", name: "Alex", units: 5, ref: alex.ref }, { id: "sam", name: "Sam", units: 4, ref: sam.ref }], hob: { count: 2, levels: 9, kind: null }, store: null });
  assert.match(prompt, /au moins 7,1 g pour Alex, 5,8 g pour Sam/);
  // Une recette à 7,1 g pour 100 kcal tombe bien pour Alex.
  assert.equal(recipeFit(alex, { kcalUnit: 146, proteinUnit: 10.4 }).level, "bien");
});

test("une personne absente de la répartition (tous ses repas ailleurs) ne compte aucun repas", () => {
  const served = new Map([["sam", new Map([["pates-creme", 6]])]]);
  const w = weekFit(both, [tikka, pates], { served });
  const a = w.people.find((p) => p.personId === "alex")!;
  assert.equal(a.meals, 0);
  assert.equal(a.level, null);
  assert.equal(w.warnings.some((x) => x.personId === "alex"), false);
});

test("ligne compacte pour l'assistant et l'atelier : qui la recette sert bien, où elle coince", () => {
  assert.equal(fitLine(recipeFits(both, tikka)), "Alex bien ; Sam bien");
  assert.equal(fitLine(recipeFits(both, pates)), "Alex loin, peu protéiné (27 g de protéines pour 52 visés, 27 au mieux) ; Sam loin, peu protéiné (24 g de protéines pour 36 visés, 24 au mieux)");
  assert.match(fitLine(recipeFits(both, gratin)), /^Alex loin, trop riche \(1\s020 kcal à la part la plus petite\)/);
  assert.equal(fitLine(recipeFits(both, mystere)), "");
});

test("atelier : la recette à ajuster arrive avec son adéquation calculée par l'appli", () => {
  const recipe = {
    slug: "pates-creme",
    name: "Pâtes à la crème",
    servingsUnits: 10,
    ingredients: [
      { item: "pâtes", lineRaw: "500 g pâtes", food: "pates", grams: 500 },
      { item: "crème", lineRaw: "200 g crème", food: "creme_legere", grams: 200 },
    ],
    steps: [],
  } as unknown as Parameters<typeof adjustPrompt>[0];
  const household = [{ id: "alex", name: "Alex", units: 5, ref: alex.ref }];
  assert.match(adjustPrompt(recipe, "plus protéiné", household), /Adéquation actuelle aux repères \(calcul de l'appli : bien, juste ou loin\) : Alex loin, peu protéiné/);
  // Sans repère : rien.
  assert.doesNotMatch(adjustPrompt(recipe, "plus protéiné"), /Adéquation/);
});

test("« Protéiné » : le quart le plus dense de la bibliothèque, et assez dense pour le plus exigeant", () => {
  // Densités (g pour 100 kcal) : dinde 10,8 ; tikka 9,3 ; chili 6,7 ; pâtes 3,8 ; gratin 4,4. Alex demande 7,1.
  assert.equal(Math.round(densityOf(dinde)! * 10) / 10, 10.8);
  assert.equal(densityOf(mystere), null);
  const lib = [dinde, tikka, chili, pates, gratin, mystere, r("lentilles", 120, 8), r("saumon", 150, 11)];
  // 7 recettes connues → 1 au plus.
  assert.deepEqual([...proteinDense(lib, both)], ["dinde-curry"]);
  const big = [...lib, r("thon", 110, 12), r("oeufs", 140, 11), r("tofu", 120, 9)];
  assert.deepEqual([...proteinDense(big, both)].sort(), ["dinde-curry", "thon"]);
  // Sans repère : rien. Une bibliothèque pauvre : rien non plus (sous ce qu'il faut à Alex).
  assert.equal(proteinDense(lib, [{ ref: null }]).size, 0);
  assert.equal(proteinDense([pates, gratin, r("riz", 150, 5), r("pain", 250, 8)], both).size, 0);
});
