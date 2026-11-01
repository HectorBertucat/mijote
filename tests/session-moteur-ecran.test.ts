// L'écran branché sur le moteur : titres et détails du plan, « Prends » et « Pèse et verse » depuis les
// ingrédients mis à l'échelle, les groupes du moment hors des bols à préparer, l'attention et les
// rappels du plan dans le fil et sous le bouton, le partage d'une base commune (et sa pesée de fin),
// les fournées, les bols qui manquent. Situation rejouée : trois recettes, une cuisine ordinaire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSession, type PlannerResources, type PlanStep, type SessionMode, type SessionPlan } from "@/lib/session/planner";
import { reduce, type SessionEvent } from "@/lib/session/state";
import { attentionOf, batchesLabel, containerNote, isContainerWarning, lanesOf, mainAction, mainEvents, missingText, remindersOf, sharedBases, shareOf, takeAt, takeOf, weighLine, type Ev } from "@/lib/session/guide";
import { momentBowls, prepBowls } from "@/lib/session/flow";
import { stepHead, stepTitleOf } from "@/lib/session/text";
import { splitShared } from "@/lib/boxes/core";
import { DEFAULT_KITCHEN, kitchenEquipment, type KitchenConfig } from "@/lib/kitchen/presets";
import { typo } from "@/lib/typo";
import { load, RES } from "./helpers";

const KITCHEN: KitchenConfig = {
  ...DEFAULT_KITCHEN,
  hobSizes: [28, 21, 14.5],
  pans: [{ material: "inox", cm: 28 }],
  casseroles: [{ cm: 14, liters: 1 }, { cm: 16, liters: 2 }, { cm: 18, liters: 2.5 }],
  faitout: { liters: 6, ovenSafe: false },
  cocotte: { liters: 6, ovenSafe: true },
  plats: 2,
};
const resOf = (k: KitchenConfig): PlannerResources => {
  const { equipment, fits } = kitchenEquipment(k);
  return {
    equipment: equipment.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1, capacityL: e.capacityL ?? null })),
    fits: fits.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
  };
};
const THREE = ["poulet-paprika-fume-patates-douces", "butter-chicken-express", "poulet-teriyaki-riz"].map((s) => load(`${s}.json`));
const cache = new Map<string, SessionPlan>();
const planOf = (mode: SessionMode = "solo", k = KITCHEN) => {
  const key = `${mode}|${JSON.stringify(k.containers)}`;
  if (!cache.has(key)) cache.set(key, planSession(THREE, resOf(k), { mode }));
  return cache.get(key)!;
};
const stepOf = (plan: SessionPlan, id: string) => plan.steps.find((s) => s.id === id)!;
const T0 = Date.parse("2026-11-01T09:00:00Z");

function play(plan: SessionPlan) {
  const events: SessionEvent[] = [];
  let n = 0;
  const write = (evs: Ev[], min: number) => {
    for (const e of evs) events.push({ id: e.id ?? `e${++n}`, at: new Date(T0 + min * 60000).toISOString(), kind: e.kind, ref: e.ref ?? null, payload: e.payload ?? null });
  };
  return {
    state: () => reduce("cooking", events),
    act: (step: PlanStep, min: number) => write(mainEvents(plan, reduce("cooking", events), step, T0 + min * 60000, { sessionId: "s-1", person: null, id: () => `e${++n}` }), min),
  };
}

test("titres : l'écran lit le titre et le détail du plan, et retombe sur le texte pour un plan d'avant", () => {
  const plan = planOf();
  for (const s of plan.steps) {
    assert.ok(s.title, `${s.id} a un titre`);
    assert.equal(stepHead(s).head, typo(s.title!));
    assert.equal(stepHead(s).rest, typo(s.detail ?? ""));
    assert.ok(stepTitleOf(s).length <= 65, stepTitleOf(s));
  }
  const old = { text: "Cocotte sur le grand foyer à 5. Beurre, bol E 8 min.", kind: "braise" as const };
  assert.equal(stepHead(old).head, typo("Cocotte sur le grand foyer à 5"));
  assert.equal(stepHead(old).rest, typo("Beurre, bol E 8 min."));
});

test("Prends / Pèse et verse : les quantités mises à l'échelle, les groupes du moment sans bol", () => {
  const plan = planOf();
  const sauce = stepOf(plan, "butter-chicken-express#2");
  const t = takeOf(plan, sauce);
  // Bol E (oignons, ail, gingembre, beurre) dans un vrai bol de la cuisine ; G (pulpe, concentré, miel) au moment.
  assert.deepEqual(t.bowls.map((b) => b.letter), ["E"]);
  assert.ok(t.bowls[0].container, "le contenant de la cuisine est nommé");
  assert.deepEqual(t.bowls[0].items.map((i) => i.qty), ["2 · 300 g", "4", "25 g", "40 g"]);
  assert.equal(weighLine(t.moment), "pulpe de tomate 800 g, concentré de tomate 30 g, miel 15 g");
  // Pendant la sous-étape « Bol G, à demi couvert », c'est la pesée du moment qui est en avant.
  const g = sauce.phases!.findIndex((p) => /[Bb]ol G/.test(p.text));
  assert.equal(takeAt(t, g).moment.length, 3);
  assert.deepEqual(takeAt(t, 0).bowls, ["E"]);
  // Saisie : la poêle prend le bol F, l'huile vient du placard.
  const sear = takeOf(plan, stepOf(plan, "butter-chicken-express#3"));
  assert.deepEqual(sear.bowls.map((b) => b.letter), ["F"]);
  assert.equal(weighLine(sear.loose), "huile 20 g");
  // La crème se verse au moment : pas de bol H à préparer.
  assert.equal(weighLine(takeOf(plan, stepOf(plan, "butter-chicken-express#4")).moment), "crème légère 15 % 200 g");
});

test("bols : ceux du moment ne sont jamais à préparer (seul, à deux, la veille)", () => {
  for (const mode of ["solo", "duo", "veille"] as SessionMode[]) {
    const plan = planOf(mode);
    const moment = momentBowls(plan).map((b) => b.letter);
    assert.ok(moment.includes("G") && moment.includes("H"), `${mode} : pulpe et crème au moment`);
    // Le soir de la veille (ce qui passe la nuit au frigo), puis le jour J.
    for (const st of [reduce("prep", []), { ...reduce("prep", []), eveDone: true }]) {
      const prep = prepBowls(plan, st).map((b) => b.letter);
      assert.ok(prep.every((l) => !moment.includes(l)), `${mode} : ${prep.join(",")}`);
    }
    // Chaque bol du moment sert une étape (le riz commun compris).
    for (const l of moment) assert.ok(plan.bowls.find((b) => b.letter === l)!.usedBy, `${mode} : bol ${l} sert une étape`);
  }
});

test("base commune : le riz de deux recettes en une ligne, le partage par recette, la pesée de fin juste", () => {
  const plan = planOf();
  const rice = plan.steps.find((s) => s.shared?.length)!;
  assert.ok(rice, "le riz est partagé");
  const t = takeOf(plan, rice);
  assert.equal(t.bowls.length, 0);
  assert.equal(t.moment.length, 1, "une ligne de riz");
  const total = rice.shared!.reduce((x, p) => x + p.rawG, 0);
  assert.equal(t.moment[0].parts?.length, 2);
  assert.equal(t.moment[0].qty, `${total} g`);
  assert.equal(t.moment[0].phase, 0, "le riz entre à la première sous-étape");
  assert.match(rice.phases![0].text, /bols [A-Z] et [A-Z]/, "la sous-étape cite les deux bols");
  const sh = shareOf(plan, rice)!;
  assert.equal(sh.the, "le riz");
  assert.deepEqual(sh.lines.map((l) => l.recipeSlug), rice.shared!.map((p) => p.recipeSlug));
  assert.ok(sh.lines.every((l) => l.qty.endsWith("cuit") && l.color));
  assert.equal(sharedBases(plan).length, 1);
  // 2,1 kg de riz cuit pesés d'un coup : chaque recette sa part, à 5 g près, rien de perdu.
  const parts = splitShared(2130, sh.lines.map((l) => ({ key: l.recipeSlug, share: l.share })));
  assert.equal(Object.values(parts).reduce((x, y) => x + y, 0), 2130);
  assert.ok(Object.values(parts).every((g) => g % 5 === 0));
  assert.ok(Math.abs(parts[sh.lines[0].recipeSlug] - 2130 * sh.lines[0].share) <= 10);
  assert.deepEqual(splitShared(1000, [{ key: "a", share: 1 }, { key: "b", share: 1 }, { key: "c", share: 1 }]), { a: 335, b: 335, c: 330 });
  assert.equal(shareOf(plan, stepOf(plan, "poulet-teriyaki-riz#2")), null, "le riz cuit seul n'est pas partagé");
});

test("fournées : celles que la fiche découpe, dites en clair", () => {
  const plan = planOf();
  const teri = stepOf(plan, "poulet-teriyaki-riz#4");
  assert.equal(teri.batches, 3, "trois tiers de poulet (la sauce ne se saisit pas)");
  assert.equal(batchesLabel(teri), "En 3 fournées");
  assert.equal(batchesLabel({ batches: 2, base: "riz" }), "En 2 fois, dans la même eau");
  assert.equal(batchesLabel({ batches: null }), null);
});

test("attention : le fil et le bouton lisent l'attention et les rappels du plan", () => {
  const plan = planOf();
  const sauce = stepOf(plan, "butter-chicken-express#2");
  // « Beurre + bol E, remue de temps en temps » : à surveiller, « Remue » toutes les 2 min (le plan, pas le texte).
  assert.equal(attentionOf(sauce, 0), "surveille");
  assert.deepEqual(remindersOf(sauce, 0, 8), [{ text: "Remue", everyMin: 2 }]);
  const simmer = sauce.phases!.findIndex((p) => p.wait);
  assert.deepEqual(remindersOf(sauce, simmer, 14), [{ text: "Remue la sauce, gratte le fond", everyMin: 5 }]);
  assert.equal(attentionOf(sauce, sauce.phases!.length - 1), "mains", "mixer : les mains");
  // Riz couvert : libre, aucun rappel (le plan n'en met pas, même si le texte dit « ça cuit »).
  const rice = plan.steps.find((s) => s.shared?.length)!;
  const covered = rice.phases!.findIndex((p) => /Couvert/.test(p.text));
  assert.equal(attentionOf(rice, covered), "libre");
  assert.deepEqual(remindersOf(rice, covered, 12), []);
  // Le bouton : lancer le minuteur d'une sous-étape à surveiller dit ce qu'on peut faire entre-temps.
  const j = play(plan);
  j.act(sauce, 0);
  const a = mainAction(plan, j.state(), sauce);
  assert.equal(a.kind, "phase-timer");
  assert.match(a.hint, /remue toutes les 2 min/);
  // Le fil : la sauce lancée est à surveiller, les mains sont libres pour l'étape suivante.
  j.act(sauce, 0);
  const l = lanesOf(plan, j.state(), T0 + 60000, sauce);
  assert.equal(l.now?.attention, "surveille");
  assert.equal(l.freeHands, true);
  assert.deepEqual(l.now?.reminders, [{ text: "Remue", everyMin: 2 }]);
  // La poêle qui saisit : les mains.
  const sear = stepOf(plan, "butter-chicken-express#3");
  assert.equal(attentionOf(sear, 1), "mains");
});

test("attention : un plan d'avant (sans attention) garde la lecture du texte", () => {
  const plan = planSession([load("butter-chicken-express.json")], RES);
  const old = structuredClone(plan.steps.find((s) => s.id === "butter-chicken-express#2")!);
  delete old.attention;
  delete old.reminders;
  delete old.hands;
  for (const p of old.phases ?? []) {
    delete p.attention;
    delete p.reminder;
  }
  assert.equal(attentionOf(old, 0), "surveille");
  assert.deepEqual(remindersOf(old, 0), [{ text: "Remue", everyMin: 4 }]);
  // Et sans ingrédients : les bols de l'étape, en entier.
  delete old.ingredients;
  const t = takeOf({ bowls: plan.bowls.map((b) => ({ ...b, holder: undefined })) }, old);
  assert.deepEqual(t.bowls.map((b) => b.letter), old.bowls);
  assert.equal(t.moment.length, 0);
});

test("contenants : ce qui manque se dit avant de commencer, une seule fois", () => {
  const few: KitchenConfig = { ...KITCHEN, containers: { bowls: { petit: { count: 1, liters: 0.5 }, moyen: { count: 1, liters: 1.5 }, grand: { count: 1, liters: 3 } }, prepBoxes: { count: 0, liters: 1 }, storageBoxes: { count: 6, liters: 1 }, ovenTrays: 1 } };
  const plan = planOf("solo", few);
  const note = containerNote(plan)!;
  assert.ok(note.moment.some((m) => m.names.some((n) => /Pulpe/.test(n))), "la pulpe se pèse au moment");
  assert.ok(note.missing || note.order.length, "trois bols ne suffisent pas : il en manque, ou un ordre de remplissage");
  if (note.missing) {
    const m = missingText(note.missing);
    assert.match(m.title, /^Il te faut \d+ bols? de plus$/);
    assert.ok(plan.warnings.some(isContainerWarning), "l'avertissement du planificateur est reconnu (pas de doublon)");
  }
  // Une cuisine bien pourvue : rien ne manque, seuls les groupes du moment sont dits.
  const ok = containerNote(planOf())!;
  assert.equal(ok.missing, null);
  assert.ok(!planOf().warnings.some(isContainerWarning));
});
