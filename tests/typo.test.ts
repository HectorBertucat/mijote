import { test } from "node:test";
import assert from "node:assert/strict";
import { firstOfMonth, typo } from "@/lib/typo";

test("micro-typographie : apostrophe courbe, ponctuation haute, guillemets, unités", () => {
  assert.equal(typo("Faitout d'eau salée, jusqu'à ébullition"), "Faitout d’eau salée, jusqu’à ébullition");
  assert.equal(typo("Repère : bien doré ; c'est prêt ?"), "Repère : bien doré ; c’est prêt ?");
  assert.equal(typo('Le "test de la goutte"'), "Le « test de la goutte »");
  assert.equal(typo("« Sauce épaisse »"), "« Sauce épaisse »");
  assert.equal(typo("Cuire 8 min à 200 °C, 1,5 kg de poulet, 4,01 €"), "Cuire 8 min à 200 °C, 1,5 kg de poulet, 4,01 €");
  assert.equal(typo("3 grandes cuillères"), "3 grandes cuillères", "un mot qui commence comme une unité ne bouge pas");
  assert.equal(typo("https://exemple.fr"), "https://exemple.fr");
  assert.equal(typo(null), null);
});

test("premier du mois : « 1er » dans une date formatée, rien d’autre ne bouge", () => {
  assert.equal(firstOfMonth("1 novembre"), "1er novembre");
  assert.equal(firstOfMonth("dim. 1 nov., 09:30"), "dim. 1er nov., 09:30");
  assert.equal(firstOfMonth("1"), "1er");
  assert.equal(firstOfMonth("11 novembre"), "11 novembre");
  assert.equal(firstOfMonth("dimanche 21 novembre"), "dimanche 21 novembre");
});
