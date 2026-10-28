// Cachet « De saison » : seuls les produits qui ont une vraie saison comptent, au bon mois.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inSeason, seasonOf } from "../src/lib/recipes/season";
import { stampAngle } from "../src/components/ui/angle";

test("un poivron est de saison en octobre, pas en février", () => {
  const ings = [{ item: "Poivron rouge", food: "poivron" }, { item: "Oignon jaune", food: "oignon" }];
  assert.deepEqual(inSeason(ings, 10), ["poivron"]);
  assert.deepEqual(inSeason(ings, 2), []);
});

test("les produits de toute l'année ne donnent jamais le cachet", () => {
  const ings = [{ item: "Champignons de Paris", food: "champignon" }, { item: "Carottes", food: "carotte" }, { item: "Ail", food: "ail" }];
  for (let m = 1; m <= 12; m++) assert.deepEqual(inSeason(ings, m), []);
});

test("le nom suffit quand l'aliment n'est pas dans la table, et la pulpe en boîte ne compte pas", () => {
  assert.deepEqual(inSeason([{ item: "Potimarron, en cubes" }], 11), ["potiron"]);
  assert.deepEqual(inSeason([{ item: "Pulpe de tomate", food: "pulpe_tomate" }], 8), []);
});

test("mots entiers : la courgette n'est pas une courge, la pomme de terre pas une pomme", () => {
  assert.deepEqual(inSeason([{ item: "Courgettes (1 kg), râpées", food: "courgette" }], 10), []);
  assert.deepEqual(inSeason([{ item: "Pommes de terre", food: "pomme_de_terre" }], 10), []);
  assert.deepEqual(inSeason([{ item: "Pommes, en quartiers" }], 10), ["pomme"]);
  assert.deepEqual(inSeason([{ item: "Chou vert, émincé" }], 11), ["chou"]);
});

test("saisons et angle des cachets", () => {
  assert.equal(seasonOf(10), "automne");
  assert.equal(seasonOf(1), "hiver");
  assert.equal(seasonOf(4), "printemps");
  assert.equal(seasonOf(7), "ete");
  const a = stampAngle("liste-42");
  assert.equal(a, stampAngle("liste-42"));
  assert.ok(Math.abs(a) >= 3 && Math.abs(a) <= 9);
});
