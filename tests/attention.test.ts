import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalsOverlap, stepTimeline } from "@/lib/session/attention";
import { load } from "./helpers";

const butter = load("butter-chicken-express.json");
const teriyaki = load("poulet-teriyaki-riz.json");
const paprika = load("poulet-paprika-fume-patates-douces.json");
const chasseur = load("chasseur-porc.json");
const handsOf = (t: { hands: [number, number][] }) => t.hands.reduce((x, [a, b]) => x + b - a, 0);

test("riz : on verse, on surveille l'ébullition, puis attente pure ; le geste final égrène", () => {
  const s = butter.steps[4]; // 22 min dont 2 actives
  const t = stepTimeline(s, 22, 2, true);
  assert.equal(t.attention, "surveille");
  assert.equal(t.phases[0].attention, "surveille", "porter à ébullition : on revient");
  assert.deepEqual(t.phases.slice(1, 3).map((p) => p.attention), ["libre", "libre"], "couvert, puis repos sans ouvrir");
  assert.equal(t.phases[3].attention, "mains");
  assert.equal(t.hands[0][0], 0);
  assert.equal(t.hands[t.hands.length - 1][1], 22, "égrener, à la fin");
  assert.ok(handsOf(t) <= 2 + 1e-6, `${handsOf(t)} min de mains pour 2 min actives`);
  assert.deepEqual(t.reminders, []);
});

test("mijoté : on surveille avec un rappel toutes les 5 min, pas un simple compte à rebours", () => {
  const t = stepTimeline(butter.steps[1], 27, 12, true);
  assert.equal(t.attention, "surveille");
  const simmer = t.phases[2]; // « La sauce mijote »
  assert.equal(simmer.attention, "surveille");
  assert.deepEqual(simmer.reminder, { everyMin: 5, text: "Remue la sauce, gratte le fond" });
  // « Beurre + bol A, remue de temps en temps » : on verse (1 min aux mains), puis on surveille, rappel toutes les 2 min.
  assert.equal(t.phases[0].attention, "surveille");
  assert.equal(t.phases[0].reminder?.everyMin, 2);
  assert.deepEqual(t.hands[0], [0, 1]);
  assert.ok(t.reminders.some((r) => r.everyMin === 5 && r.untilMin - r.fromMin >= 10));
  // Le même mijoté au four ne se remue pas.
  assert.ok(stepTimeline(butter.steps[1], 27, 12, false).phases.filter((p) => p.attention === "libre").length >= 1);
});

test("saisie : les mains tout du long, sauf la poêle vide qui chauffe", () => {
  const s = teriyaki.steps[3];
  const t = stepTimeline(s, 25, 25, true);
  assert.equal(t.attention, "mains");
  assert.equal(t.phases[0].attention, "surveille", "poêle vide, préchauffe : on la pose et on revient");
  assert.ok(t.phases.slice(1).every((p) => p.attention === "mains"));
  assert.ok(handsOf(t) >= 22);
});

test("four : on étale, on retourne à mi-cuisson, on sort ; le reste est libre et le geste du milieu peut glisser", () => {
  const t = stepTimeline(paprika.steps[1], 35, 4, false);
  assert.equal(t.attention, "surveille");
  assert.equal(t.hands.length, 3);
  assert.ok(t.phases.some((p) => p.attention === "libre"));
  // Le geste du milieu glisse de 2 min au plus (attentes autour), le dernier peut attendre 2 min, pas avancer.
  assert.equal(t.slack[1].lo, -2);
  assert.equal(t.slack[1].hi, 2);
  assert.deepEqual([t.slack[2].lo, t.slack[2].hi], [0, 2]);
  assert.deepEqual([t.slack[0].lo, t.slack[0].hi], [0, 0], "le premier geste ne glisse pas");
  // Égoutter ne recule pas : ça cuirait trop.
  const hv = stepTimeline(chasseur.steps[10], 15, 3, true);
  assert.deepEqual([hv.slack[hv.slack.length - 1].lo, hv.slack[hv.slack.length - 1].hi], [0, 0]);
});

test("sans sous-étape : l'action au début, puis l'attente selon le genre d'étape", () => {
  const cool = stepTimeline({ kind: "cool", text: "Mets en boîtes, frigo." }, 10, 3, false);
  assert.deepEqual(cool.hands, [[0, 3]]);
  assert.equal(cool.phases[1].attention, "libre");
  const braise = stepTimeline({ kind: "braise", text: "Couvre et laisse mijoter, remue de temps en temps." }, 40, 2, true);
  assert.equal(braise.phases[1].attention, "surveille");
  assert.ok(braise.reminders.length);
  assert.equal(stepTimeline({ kind: "bake", text: "Au four." }, 30, 0, false).attention, "libre");
});

test("les sous-étapes plus longues ou plus courtes que l'étape s'y ajustent (durées réelles)", () => {
  const s = butter.steps[4];
  const t = stepTimeline(s, 30, 2, true); // 8 min de plus que la fiche : les attentes s'allongent
  assert.equal(t.phases[t.phases.length - 1].toMin, 30);
  assert.equal(t.phases[0].toMin - t.phases[0].fromMin, 4, "le temps d'action ne bouge pas");
});

test("chevauchement d'intervalles", () => {
  assert.equal(intervalsOverlap([[0, 2]], [[2, 3]]), false);
  assert.equal(intervalsOverlap([[0, 2.5]], [[2, 3]]), true);
  assert.equal(intervalsOverlap([], [[0, 9]]), false);
});
