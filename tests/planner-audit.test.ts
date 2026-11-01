import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { planSession, validatePlan, type PlannerResources, type SessionMode } from "@/lib/session/planner";
import { auditPlan, WARNED } from "@/lib/session/audit";
import { DEFAULT_KITCHEN, kitchenEquipment, type KitchenConfig } from "@/lib/kitchen/presets";
import { load, RES } from "./helpers";

const paprika = load("poulet-paprika-fume-patates-douces.json");
const butter = load("butter-chicken-express.json");
const teriyaki = load("poulet-teriyaki-riz.json");
const chasseur = load("chasseur-porc.json");
const trio = [paprika, butter, teriyaki];
const MODES: SessionMode[] = ["solo", "duo", "veille"];

const resOf = (k: KitchenConfig): PlannerResources => {
  const { equipment, fits } = kitchenEquipment(k);
  return {
    equipment: equipment.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1, capacityL: e.capacityL ?? null })),
    fits: fits.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
  };
};

test("trois recettes au riz : deux cuissons de riz au lieu de trois, jamais dans une casserole trop petite", () => {
  for (const mode of MODES) {
    const p = planSession(trio, RES, { mode });
    assert.deepEqual(auditPlan(p, RES), [], mode);
    const rice = p.steps.filter((s) => s.base === "riz");
    // 1,3 kg de riz ne tiennent dans aucun récipient de la cuisine : deux cuissons, dont une partagée.
    assert.equal(rice.length, 2, mode);
    const shared = rice.find((s) => s.shared)!;
    assert.equal(shared.shared!.length, 2);
    assert.equal(shared.shared!.reduce((x, s) => x + s.share, 0), 1);
    assert.ok(shared.shared!.every((s) => s.cookedG > s.rawG * 2), "le poids cuit est dit");
    assert.match(shared.phases![shared.phases!.length - 1].text, /^Partage le riz : .*cuit pour/);
    assert.ok(p.decisions?.some((d) => d.startsWith("Riz : une seule cuisson pour")));
    for (const s of rice) assert.ok(s.load!.liters <= s.load!.usableL!, `${s.id} : ${s.load!.liters} L dans ${s.equipmentId}`);
    // La casserole moyenne (2 L) ne reçoit jamais 400 g de riz ou plus.
    assert.ok(!rice.some((s) => s.equipmentId === "casserole-16"));
  }
});

test("trois recettes : moins de bols, rangés dans l'inventaire, et ce qui se verse au moment n'en prend pas", () => {
  for (const mode of MODES) {
    const p = planSession(trio, RES, { mode });
    const c = p.containers!;
    assert.ok(c.peak <= 8 && c.peak <= c.owned, `${mode} : ${c.peak} contenants`);
    assert.deepEqual(c.missing, []);
    assert.ok(c.moment >= 4, "riz, pulpe, crème : au moment");
    const pulpe = p.bowls.find((b) => b.items.some((i) => i.food === "pulpe_tomate"))!;
    assert.equal(pulpe.holder, "moment");
    assert.equal(pulpe.container, null);
    const marinade = p.bowls.find((b) => b.recipeSlug === butter.slug && b.items.some((i) => i.food === "skyr"))!;
    assert.ok(marinade.holder === "bol" || marinade.holder === "boite");
    assert.ok(marinade.containerLabel);
    // Les pesées au moment ne sont plus des gestes de prep.
    for (const t of p.prep.tasks) if (t.kind === "weigh") assert.ok(!t.bowls?.includes(pulpe.letter));
  }
});

test("chaque étape : titre complet, attention, mains, ingrédients en quantités", () => {
  const p = planSession(trio, RES, { mode: "solo" });
  for (const s of p.steps) {
    assert.ok(s.title && s.title.length <= 72, `${s.id} : ${s.title}`);
    assert.equal((s.title.match(/\(/g) ?? []).length, (s.title.match(/\)/g) ?? []).length, s.title);
    assert.ok(["mains", "surveille", "libre"].includes(s.attention!));
    assert.ok(Array.isArray(s.hands) && Array.isArray(s.reminders) && Array.isArray(s.ingredients));
    for (const [a, b] of s.hands!) assert.ok(a >= s.startMin - 1e-6 && b <= s.endMin + 1e-6 && b > a, `${s.id} : ${a}-${b}`);
  }
  const preheat = p.steps.find((s) => s.kind === "preheat");
  if (preheat) assert.match(preheat.title!, /^Allume le four à \d+ °C$/);
  // « Pèse et verse : pulpe de tomate 800 g, concentré 30 g, miel 15 g » à la sous-étape du bol.
  const sauce = p.steps.find((s) => s.id === `${butter.slug}#2`)!;
  const pulpe = sauce.ingredients!.filter((i) => i.holder === "moment");
  assert.deepEqual(pulpe.map((i) => [i.name, i.qty]), [["Pulpe de tomate", "800 g"], ["Concentré de tomate", "30 g"], ["Miel", "15 g"]]);
  assert.ok(pulpe.every((i) => i.phase === 1 && i.bowl === pulpe[0].bowl));
  assert.match(sauce.phases![i0(sauce.phases!, (x) => x.wait)].reminder?.text ?? "", /Remue la sauce/);
  // Le texte suit le foyer choisi : plus d'avertissement « le texte parle du foyer moyen ».
  assert.ok(!p.warnings.some((w) => /le texte parle du/.test(w)));
  assert.match(sauce.text, new RegExp(`sur le ${RES.equipment.find((e) => e.id === sauce.hobId)!.name.toLowerCase()}`, "i"));
  // Hors bol : l'huile de la saisie.
  const sear = p.steps.find((s) => s.id === `${teriyaki.slug}#4`)!;
  assert.ok(sear.ingredients!.some((i) => i.bowl == null && i.food === "huile" && i.grams === 20));
  // Les quantités suivent le multiplicateur.
  const x2 = planSession([{ ...butter, scale: 2 }], RES).steps.find((s) => s.id === `${butter.slug}#2`)!;
  assert.equal(x2.ingredients!.find((i) => i.food === "pulpe_tomate")!.grams, 1600);
});

function i0<T>(xs: T[], f: (x: T) => unknown) {
  return xs.findIndex((x) => f(x));
}

test("un à-côté (« pendant que la sauce mijote, saisis le poulet ») passe avant l'étape qui l'attend", () => {
  for (const mode of MODES)
    for (const rs of [[butter], trio]) {
      const p = planSession(rs, RES, { mode });
      const sear = p.steps.find((s) => s.id === `${butter.slug}#3`)!;
      const inSauce = p.steps.find((s) => s.id === `${butter.slug}#4`)!;
      assert.ok(inSauce.startMin >= sear.endMin - 1e-6, `${mode} : « Poulet dans la sauce » à ${inSauce.startMin}, saisie finie à ${sear.endMin}`);
    }
});

test("jamais deux tâches « mains » à la fois ; validatePlan le voit", () => {
  const p = planSession(trio, RES, { mode: "solo" });
  const busy = p.steps.filter((s) => s.hands?.length);
  const [a, b] = busy;
  const bad = { ...p, steps: p.steps.map((s) => (s === b ? { ...s, hands: a.hands } : s)) };
  assert.ok(validatePlan(bad, RES).some((i) => i.kind === "hands_busy"));
  const duo = planSession(trio, RES, { mode: "duo" });
  const x = duo.steps.find((s) => s.hands?.length && s.person === "A")!;
  const y = duo.steps.find((s) => s !== x && s.hands?.length && s.person === "A")!;
  assert.ok(validatePlan({ ...duo, steps: duo.steps.map((s) => (s === y ? { ...s, hands: x.hands } : s)) }, RES).some((i) => i.kind === "person_busy"));
});

test("des triplets au hasard (graine fixe) : audit sans écart, seul et à deux", () => {
  const R = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let n = 0; n < 6; n++) {
    const picks = new Set<number>();
    while (picks.size < 3) picks.add(Math.floor(rnd() * R.length));
    const rs = [...picks].map((i) => R[i]);
    for (const mode of ["solo", "duo"] as SessionMode[]) assert.deepEqual(auditPlan(planSession(rs, RES, { mode }), RES).map((i) => `${rs.map((r) => r.slug).join(" + ")} ${mode} [${i.kind}] ${i.message}`), []);
  }
});

test("petite cuisine : le haricot en deux fournées dans la même eau, la limite dite en clair", () => {
  const small = resOf({ ...DEFAULT_KITCHEN, hobSizes: [21, 16], casseroles: [{ cm: 16, liters: 1.5 }, { cm: 20, liters: 3 }], faitout: { liters: 4, ovenSafe: false }, cocotte: { liters: 4, ovenSafe: true } });
  const p = planSession([chasseur], small, { mode: "solo" });
  const beans = p.steps.find((s) => s.base === "haricots verts")!;
  assert.equal(beans.batches, 2);
  assert.ok(beans.phases!.some((x) => /fournée 2 sur 2/.test(x.text)));
  assert.ok(beans.load!.liters <= beans.load!.usableL!);
  // Ce qui ne tient vraiment pas (le chasseur entier dans 4 L) est dit, pas caché.
  const issues = auditPlan(p, small);
  assert.ok(issues.every((i) => WARNED.includes(i.kind)), issues.map((i) => i.message).join("\n"));
  // Sans faitout, le riz et les haricots prennent un autre récipient qui les tient.
  const noFaitout = resOf({ ...DEFAULT_KITCHEN, faitout: null, casseroles: [{ cm: 16, liters: 2 }, { cm: 22, liters: 5 }] });
  const q = planSession([chasseur], noFaitout, { mode: "solo" });
  assert.deepEqual(q.errors, []);
  assert.ok(q.steps.filter((s) => s.base).every((s) => s.equipmentId !== "faitout"));
});

test("four : où étaler ce qui rôtit, et quand la surface manque", () => {
  const p = planSession([paprika], RES, { mode: "solo" });
  const bake = p.steps.find((s) => s.id === `${paprika.slug}#2`)!;
  assert.ok(bake.dishes && bake.dishes.haveCm2 >= bake.dishes.needCm2, JSON.stringify(bake.dishes));
  assert.ok(bake.notes.some((n) => n.startsWith("Étale en une couche sur ")));
  const noTray = resOf({ ...DEFAULT_KITCHEN, plats: 1, containers: { ...DEFAULT_KITCHEN.containers, ovenTrays: 0 } });
  const q = planSession([paprika], noTray, { mode: "solo" });
  assert.ok(q.warnings.some((w) => /à rôtir en une couche demandent environ/.test(w)));
});
