import { test } from "node:test";
import assert from "node:assert/strict";
import { baseFood, baseLiters, baseMethod, baseOfStep, bowlLiquids, bowlLiters, dishArea, holds, liquidInText, potLiters, stepLoads, usableLiters, vesselLiters, vesselNeeds } from "@/lib/session/capacity";
import { load, RES } from "./helpers";

const eq = (id: string) => RES.equipment.find((e) => e.id === id)!;
const isPot = (id: string) => RES.equipment.find((e) => e.id === id)?.kind === "pot";
const isPan = (id: string) => RES.equipment.find((e) => e.id === id)?.kind === "pan";

test("contenance : notée, sinon estimée d'après le fond et la hauteur, sinon inconnue", () => {
  assert.equal(vesselLiters({ capacityL: 2.5, dimsJson: { baseCm: 18 } }), 2.5);
  // 18 cm de fond, 10 cm de haut : π/4 × 18² × 10 ≈ 2,5 L.
  assert.equal(vesselLiters({ capacityL: null, dimsJson: { baseCm: 18, heightCm: 10 } }), 2.5);
  assert.ok(Math.abs(vesselLiters({ dimsJson: { diameterCm: 16 } })! - 1.8) < 0.1, "hauteur estimée à 0,55 × le diamètre");
  assert.equal(vesselLiters({ dimsJson: { cm: "24x18" } }), null);
  // Remplissage : trois quarts quand ça bout, 85 % pour un mijoté.
  assert.equal(usableLiters({ capacityL: 2 }, "boil"), 1.5);
  assert.equal(usableLiters({ capacityL: 2 }, "stew"), 1.7);
  assert.equal(usableLiters({ capacityL: null, dimsJson: null }, "boil"), null);
});

test("riz : 450 g ne tiennent pas dans une casserole de 2 L, oui dans 2,5 L ; 1,3 kg dépassent un faitout de 6 L", () => {
  const riz = baseFood("riz_basmati")!;
  assert.equal(riz.family, "riz");
  assert.equal(baseMethod(riz, "Riz (bol D), 1,5 fois son volume d'eau salée"), "absorb");
  const l450 = baseLiters(riz, "absorb", 0.45);
  assert.ok(l450 > 1.5 && l450 < 1.875, `${l450}`);
  assert.equal(holds({ capacityL: 2 }, { liters: l450, mode: "boil" }), false);
  assert.equal(holds({ capacityL: 2.5 }, { liters: l450, mode: "boil" }), true);
  assert.equal(holds({ capacityL: 6 }, { liters: baseLiters(riz, "absorb", 1.3), mode: "boil" }), false);
  assert.equal(holds({ dimsJson: null }, { liters: 99, mode: "boil" }), null, "contenance inconnue : on ne peut pas dire non");
  // Légumes et pâtes à grande eau : l'eau a un minimum.
  const hv = baseFood("haricots_verts")!;
  assert.equal(baseMethod(hv, "Faitout d'eau salée à 9"), "bath");
  assert.equal(baseLiters(hv, "bath", 0.2), 1.5 + 0.3);
  assert.equal(baseLiters(hv, "bath", 1), 2.5 + 1.5);
  assert.ok(baseLiters(baseFood("pates")!, "bath", 0.5) > baseLiters(hv, "bath", 0.5), "les pâtes veulent plus d'eau");
  assert.equal(baseFood("poulet"), null);
});

test("liquides écrits : « + 540 ml d'eau », « 1,3 L d'eau chaude » dans un bol, pas une contenance", () => {
  assert.equal(liquidInText("Riz rincé (bol G) + 540 ml d'eau dans le faitout"), 0.54);
  assert.equal(liquidInText("Déglace la poêle avec 150 ml d'eau et verse dans la cocotte"), 0.15);
  assert.equal(liquidInText("Eau à hauteur (environ 500 ml)"), 0.5);
  assert.equal(liquidInText("Une casserole de 2 L"), 0);
  const m = bowlLiquids(["Bol A : oignon + ail. Bol C : 2 cubes de bouillon dans 1,3 L d'eau chaude (bouilloire). Bol D : crème."]);
  assert.equal(m.get("C"), 1.3);
  assert.equal(m.has("A"), false);
});

test("volumes : un bol de morceaux crus prend plus de place que le même poids dans la sauce", () => {
  const ings = [{ grams: 600, foodId: "champignon" }, { grams: 300, foodId: "oignon" }];
  assert.ok(bowlLiters(ings) > potLiters(ings));
  assert.equal(potLiters([{ grams: 1000, foodId: "pulpe_tomate" }], 1, 0.5), 1.5);
  assert.equal(bowlLiters([{ units: 4, foodId: "oeuf" }]), 0.24, "60 g par œuf");
  assert.equal(potLiters([{ grams: 500, foodId: "x" }], 2), 1, "à l'échelle de la session");
});

test("récipient principal : la cocotte du butter chicken reçoit le poulet saisi à la poêle", () => {
  const r = load("butter-chicken-express.json");
  const loads = stepLoads(r, isPot, isPan);
  const sauce = loads.get(1)!; // étape 2 : oignons, pulpe
  const fin = loads.get(3)!; // étape 4 : le poulet saisi, la crème
  assert.equal(sauce.mode, "stew");
  assert.ok(fin.liters > sauce.liters + 1.2, `${sauce.liters} → ${fin.liters}`);
  // Le riz, une cuisson de base, à part : ébullition.
  assert.equal(loads.get(4)!.mode, "boil");
  assert.ok(baseOfStep(r, r.steps[4]));
  assert.equal(baseOfStep(r, r.steps[1]), null);
  // Une fois et demie : la cocotte de 6 L tient encore, pas la grande casserole ; au double, plus rien.
  const need = vesselNeeds({ ...r, scale: 1.5 }, isPot, isPan).get("cocotte")!;
  assert.equal(holds(eq("cocotte"), need), true);
  assert.equal(holds(eq("casserole-18"), need), false);
  assert.equal(holds(eq("cocotte"), vesselNeeds({ ...r, scale: 2 }, isPot, isPan).get("cocotte")!), false);
});

test("four : surface d'un plat ou d'une plaque", () => {
  assert.equal(dishArea({ dimsJson: { innerCm: "28x21" } }), 588);
  assert.equal(dishArea({ dimsJson: { cm: "24x18" } }), 432);
  assert.equal(dishArea({ dimsJson: { innerCm: "40x30", depthCm: 2 } }), 1200);
  assert.equal(dishArea({ dimsJson: null }), null);
});
