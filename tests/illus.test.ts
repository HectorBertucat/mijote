// Banque d'illustrations : jamais d'aliment ni d'étape sans dessin, dessins bien formés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, FOODS, FOOD_CATEGORIES } from "../src/lib/illus/art";
import { actionArt, foodArt } from "../src/lib/illus/resolve";
import { FOODS as NUTRITION } from "../src/lib/nutrition/foods";
import { RecipeInput, STEP_KINDS } from "../src/lib/recipes/format";

const recipes = readdirSync(join(process.cwd(), "src/seed/recipes"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => RecipeInput.parse(JSON.parse(readFileSync(join(process.cwd(), "src/seed/recipes", f), "utf8"))));

test("chaque aliment de la table nutritionnelle a son propre dessin", () => {
  for (const id of Object.keys(NUTRITION)) {
    if (id === "zero") continue;
    const a = foodArt(id, "");
    assert.ok(a.exact, `${id} sans dessin`);
    assert.ok(FOODS[a.id].svg.length > 0);
  }
});

test("chaque ingrédient des recettes a son propre dessin", () => {
  for (const r of recipes) for (const i of r.ingredients) assert.ok(foodArt(i.food, i.item).exact, `${r.slug} : ${i.item}`);
});

test("un aliment inconnu prend le dessin de sa famille, sinon le générique", () => {
  assert.deepEqual(foodArt(null, "Bœuf haché 5 %"), { id: "_viande", exact: false });
  assert.deepEqual(foodArt(null, "Pavé de saumon"), { id: "_poisson", exact: false });
  assert.deepEqual(foodArt(null, "Épinards frais"), { id: "_legume", exact: false });
  assert.deepEqual(foodArt(null, "Truc mystère"), { id: "_ingredient", exact: false });
  assert.equal(foodArt("zero", "Thym, 2 feuilles de laurier").id, "thym");
  assert.equal(foodArt("zero", "Sel, poivre").id, "sel");
  assert.equal(foodArt(null, "Poivron rouge").id, "poivron");
});

test("chaque famille a un générique dessiné", () => {
  for (const c of FOOD_CATEGORIES) {
    const g = FOODS[`_${c}` as keyof typeof FOODS];
    assert.ok(g && g.svg.length > 0, c);
  }
});

test("chaque étape et sous-étape a un geste dessiné", () => {
  for (const k of [...STEP_KINDS, "preheat"]) assert.ok(ACTIONS[actionArt(k, "").id], k);
  for (const r of recipes)
    for (const s of r.steps) {
      assert.ok(ACTIONS[actionArt(s.kind, s.text).id]);
      for (const p of s.phases ?? []) assert.ok(ACTIONS[actionArt(s.kind, p.text).id]);
    }
});

test("le geste suit le premier verbe", () => {
  assert.equal(actionArt("sear", "Déglace la poêle avec 150 ml d'eau").id, "deglaze");
  assert.equal(actionArt("sear", "Poêle vide 2 à 3 min à 6-7, test de la goutte").id, "preheat");
  assert.equal(actionArt("prep", "Coupe l'échine en cubes de 4 cm. Émince les oignons").id, "chop");
  assert.equal(actionArt("boil", "Riz pendant le mijotage : 300 g rincés").id, "boil");
  assert.equal(actionArt("braise", "Bol E + le porc et son jus, porte à ébullition").id, "simmer");
  assert.equal(actionArt("cool", "Pèse le total, répartis dans 2 plats").id, "portion");
});

test("dessins : couleurs en jetons seulement, balises équilibrées", () => {
  for (const [id, a] of [...Object.entries(ACTIONS), ...Object.entries(FOODS)]) {
    assert.doesNotMatch(a.svg, /#[0-9a-f]{3,6}\b|rgb\(/i, `${id} : couleur en dur`);
    for (const tag of ["g", "path", "rect", "circle", "ellipse"]) {
      const open = (a.svg.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;
      const closed = (a.svg.match(new RegExp(`<${tag}\\b[^>]*/>`, "g")) ?? []).length + (a.svg.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(open, closed, `${id} : <${tag}> mal fermé`);
    }
  }
});

// ─── Dessins de l'IA : liste blanche ───
import { artKey, sanitizeIllu } from "@/lib/illus/sanitize";

test("dessins de l'IA : la banque passe le filtre, le reste est refusé", () => {
  for (const [id, a] of Object.entries(FOODS)) {
    const r = sanitizeIllu(a.svg);
    assert.deepEqual(r.errors, [], `${id} : ${r.errors.join(" ; ")}`);
  }
  const bad = [
    '<script>alert(1)</script><circle cx="1" cy="1" r="1" fill="none"/>',
    '<circle cx="32" cy="32" r="10" fill="#ff0000"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<circle cx="32" cy="32" r="10" onload="alert(1)" fill="none"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<image href="x.png"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<circle cx="32" cy="32" r="10" fill="url(#g)"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<circle cx="32" cy="32" r="10" style="fill:red"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<text x="1" y="1">a</text><circle cx="2" cy="2" r="1" fill="none"/>',
    '<g class="evil"><circle cx="2" cy="2" r="1" fill="none"/><circle cx="2" cy="2" r="1" fill="none"/></g>',
    '<circle cx="2" cy="2" r="1" fill="var(--c-ink)"/><circle cx="2" cy="2" r="1" fill="none"/>',
    '<g><circle cx="2" cy="2" r="1" fill="none"/>',
  ];
  for (const b of bad) assert.equal(sanitizeIllu(b).svg, null, b);
  const ok = sanitizeIllu('<g class="a-wobble" style="transform-origin:50% 90%"><circle cx="32" cy="36" r="22" fill="var(--i-tomato)"/><path d="M22 16 L32 20 Z" fill="var(--i-leaf-2)"/></g>');
  assert.ok(ok.svg);
  assert.equal(artKey("Poireaux, émincés (2)"), "poireaux");
});
