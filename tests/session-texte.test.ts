import { test } from "node:test";
import assert from "node:assert/strict";
import { rewriteHob, splitTitle } from "@/lib/session/text";

test("titre court et complet : jamais coupé dans une parenthèse, le détail à part", () => {
  // Le défaut vu en session : « Règle le four à 220 °C chaleur tournante (préchauffage 10 min, pour ».
  const four = splitTitle("Règle le four à 220 °C chaleur tournante (préchauffage 10 min, pour : Poulet au paprika fumé, patates douces rôties et riz).");
  assert.equal(four.title, "Règle le four à 220 °C chaleur tournante");
  assert.equal(four.detail, "Préchauffage 10 min, pour : Poulet au paprika fumé, patates douces rôties et riz.");
  // La première phrase, si elle tient.
  const riz = splitTitle("Riz (bol D) dans la grande casserole. Couvert à 2 pendant 12 min.");
  assert.equal(riz.title, "Riz (bol D) dans la grande casserole");
  assert.equal(riz.detail, "Couvert à 2 pendant 12 min.");
  // Trop longue : aux deux-points, ou à la virgule, hors parenthèse.
  const longue = splitTitle("Poulet (bol B) en trois fournées de 450 g, sans toucher pendant 3 min puis retourne, encore 3 min, et réserve dans un plat.");
  assert.equal(longue.title, "Poulet (bol B) en trois fournées de 450 g");
  assert.match(longue.detail, /^Sans toucher/);
  // « Pendant que… : » seul ne dit pas quoi faire : le geste reste dans le titre.
  const pendant = splitTitle("Pendant que la sauce mijote : poêle vide, 2 à 3 min à 7, test de la goutte, huile. Poulet mariné (bol B) en trois fournées.");
  assert.equal(pendant.title, "Pendant que la sauce mijote : poêle vide");
  // Une abréviation n'est pas une fin de phrase.
  assert.equal(splitTitle("Ajoute 1 c. à s. d'huile. Remue.").title, "Ajoute 1 c. à s. d'huile");
  for (const t of [four, riz, longue, pendant]) {
    assert.ok(t.title.length <= 72, t.title);
    assert.equal((t.title.match(/\(/g) ?? []).length, (t.title.match(/\)/g) ?? []).length, `parenthèse coupée : ${t.title}`);
    assert.ok(!/[,;:]$/.test(t.title));
  }
  assert.deepEqual(splitTitle(""), { title: "", detail: "" });
});

test("le foyer du texte suit le foyer choisi", () => {
  assert.equal(rewriteHob("Cocotte sur le foyer moyen à 5 : beurre.", "Grand foyer"), "Cocotte sur le grand foyer à 5 : beurre.");
  assert.equal(rewriteHob("Poêle sur le grand foyer.", "Grand foyer"), "Poêle sur le grand foyer.");
  assert.equal(rewriteHob("Sur le petit foyer, puis le grand foyer.", "Foyer moyen"), "Sur le petit foyer, puis le grand foyer.", "deux foyers cités : on ne touche pas");
  assert.equal(rewriteHob("Faitout d'eau salée à 9.", "Petit foyer"), "Faitout d'eau salée à 9.");
  assert.equal(rewriteHob("Grand foyer à 7.", "Foyer moyen"), "Foyer moyen à 7.");
  assert.equal(rewriteHob("Cocotte sur le foyer moyen.", null), "Cocotte sur le foyer moyen.");
});
