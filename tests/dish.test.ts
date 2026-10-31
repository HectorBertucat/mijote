// La boîte d'un plat (src/lib/illus/dish.ts) : déterministe, compartiment du féculent à part,
// gratin, sauces, et jamais de plantage sur une recette sans dessin propre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FOODS } from "../src/lib/illus/art";
import { dishArt, type DishRecipe } from "../src/lib/illus/dish";
import { DishBox } from "../src/components/ui/dish";
import { RecipeInput } from "../src/lib/recipes/format";

const dir = join(process.cwd(), "src/seed/recipes");
const seeds = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => RecipeInput.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
const seed = (slug: string) => seeds.find((r) => r.slug === slug)!;

test("même recette, même boîte ; deux recettes, deux boîtes", () => {
  for (const r of seeds) assert.deepEqual(dishArt(r), dishArt(structuredClone(r)), r.slug);
  const keys = new Set(seeds.map((r) => dishArt(r).key));
  assert.equal(keys.size, seeds.length);
});

test("chaque recette de départ : une sauce, une garniture dessinée, des coordonnées finies", () => {
  for (const r of seeds) {
    const a = dishArt(r);
    assert.ok(a.sauce.fill.startsWith("var(--i-") || a.sauce.fill.startsWith("color-mix(in srgb, var(--i-"), `${r.slug} : ${a.sauce.fill}`);
    assert.ok(a.main.length >= 1 && a.main.length <= 3, r.slug);
    assert.ok(a.pieces.length >= 1, r.slug);
    for (const p of [...a.pieces, ...(a.side?.pieces ?? [])]) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.scale > 0, r.slug);
      if (p.art) assert.ok(FOODS[p.art].svg.length > 0, `${r.slug} : ${p.art}`);
    }
  }
});

test("riz cuit à part : un compartiment, jamais dans la garniture", () => {
  const a = dishArt(seed("poulet-teriyaki-riz"));
  assert.equal(a.side?.kind, "riz");
  assert.ok(a.side!.grains.length > 10);
  assert.ok(!a.main.some((m) => m.art === "riz_basmati"));
  // Les haricots verts bouillis à part vont avec le riz.
  assert.deepEqual([...new Set(a.side!.pieces.map((p) => p.art))], ["haricots_verts"]);
  assert.equal(a.main[0].art, "haut_cuisse_poulet");
  assert.equal(a.sauce.tone, "laque");
  assert.equal(a.finish?.kind, "graines");
  // La semoule du couscous, les pâtes des médaillons.
  assert.equal(dishArt(seed("couscous-poulet-merguez")).side?.kind, "semoule");
  assert.equal(dishArt(seed("medaillons-filet-mignon-moutarde")).side?.kind, "pates");
  // Les pâtes d'un one pot restent dans le plat.
  const orzo = dishArt(seed("one-pot-orzo-poulet-epice"));
  assert.equal(orzo.side, null);
  assert.ok(orzo.main.some((m) => m.art === "pates"));
});

test("gratin : fromage doré dessus, pas de compartiment", () => {
  for (const slug of ["cannelloni-bolognaise", "gratin-facon-moussaka", "pasta-al-forno-saucisse-ricotta"]) {
    const a = dishArt(seed(slug));
    assert.equal(a.model, "gratine", slug);
    assert.ok(a.crust && a.crust.spots.length > 0, slug);
    assert.equal(a.side, null, slug);
    assert.ok(!a.main.some((m) => ["emmental_rape", "parmesan", "mozzarella"].includes(m.art)), slug);
  }
  // « Ail, râpé » n'est pas du fromage.
  assert.notEqual(dishArt(seed("poulet-paprika-fume-patates-douces")).model, "gratine");
});

test("sauces et modèles tirés des ingrédients", () => {
  assert.equal(dishArt(seed("poulet-basquaise")).sauce.tone, "tomate");
  assert.equal(dishArt(seed("poulet-basquaise")).model, "mijote");
  assert.equal(dishArt(seed("butter-chicken-express")).sauce.tone, "curry");
  assert.equal(dishArt(seed("dahl-pois-casses-poulet")).sauce.tone, "coco");
  assert.equal(dishArt(seed("dahl-pois-casses-poulet")).model, "veloute");
  assert.equal(dishArt(seed("one-pot-orzo-poulet-epinards-parmesan")).sauce.tone, "creme");
  assert.match(dishArt(seed("medaillons-filet-mignon-moutarde")).sauce.fill, /--i-mustard/);
  // Oignon, ail, farine fondent dans la sauce.
  for (const r of seeds) for (const m of dishArt(r).main) assert.ok(!["oignon", "ail", "farine", "maizena", "pulpe_tomate"].includes(m.art), `${r.slug} : ${m.art}`);
});

test("variante : « sans poivron » enlève le poivron", () => {
  const r = seed("poulet-basquaise");
  assert.ok(dishArt(r).main.some((m) => m.art === "poivron"));
  const sans = dishArt(r, { without: ["poivron"] });
  assert.ok(!sans.main.some((m) => m.art === "poivron"));
  assert.notEqual(sans.key, dishArt(r).key);
});

test("recette sans dessin propre : générique, sans planter", () => {
  const r: DishRecipe = {
    slug: "tofu-mystere",
    name: "Tofu mystère au tamarin",
    ingredients: [
      { item: "Tofu fumé", grams: 400 },
      { item: "Quenelles de brochet", grams: 300 },
      { item: "Pâte de tamarin", grams: 30 },
      { item: "Sel" },
    ],
  };
  const a = dishArt(r);
  assert.ok(a.main.length >= 1);
  assert.ok(a.main.some((m) => !m.exact));
  assert.ok(a.pieces.some((p) => p.art === null), "un aliment sans dessin de morceau → morceau générique");
  assert.equal(a.sauce.tone, "nature");
  // Rien du tout : une boîte vide mais dessinée.
  const vide = dishArt({ slug: "vide", name: "Vide", ingredients: [] });
  assert.equal(vide.pieces.length, 0);
  assert.equal(vide.side, null);
});

test("<DishBox> : image nommée, couleurs par jetons, pas de NaN", () => {
  for (const size of ["sm", "md", "lg", "hero"] as const) {
    const html = renderToStaticMarkup(createElement(DishBox, { recipe: seed("chasseur-porc"), size }));
    assert.match(html, /role="img"/);
    assert.match(html, /aria-label="Chasseur de porc"/);
    assert.match(html, /var\(--c-accent\)/);
    assert.match(html, /var\(--c-recipe-\d\)/);
    assert.ok(!/NaN|undefined/.test(html), size);
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(html.replace(/href="#[^"]+"|url\(#[^)]+\)/g, "")), `${size} : couleur en dur`);
  }
  assert.match(renderToStaticMarkup(createElement(DishBox, { recipe: seed("chasseur-porc"), size: "hero" })), /a-steam/);
});
