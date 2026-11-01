// Produits intermédiaires, prérequis et fenêtre de recette (retours d'une vraie session : poulet au paprika
// fumé, butter chicken, poulet teriyaki). « Poulet dans la sauce » dit quel poulet et d'où il vient ; une
// étape ne part pas avant ce qu'elle reprend ; enfourner pendant que le four chauffe arrête le préchauffage
// (et le retour le relance), sans apprendre de durée ; la suite annoncée est la vraie suite ; tout minuteur
// se termine ou s'arrête ; la fenêtre d'une recette donne ses ingrédients de la session et ses étapes adaptées.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { planSession, type PlannerResources, type PlanStep, type SessionMode, type SessionPlan } from "@/lib/session/planner";
import { focusStep, isReady, needsLeft, reduce, stepStatus, type SessionEvent } from "@/lib/session/state";
import { finishNowEvents, mainAction, mainEvents, startEvents, undoFor, upNext, type Ev } from "@/lib/session/guide";
import { productOf, recipeFlow, withoutAsides } from "@/lib/session/products";
import { productLines, recipeSheet, richParts, usesText } from "@/lib/session/sheet";
import { actionTitle, splitTitle, stepTitleOf } from "@/lib/session/text";
import { namesFood } from "@/lib/session/products";
import { measureSession } from "@/lib/session/durations";
import { auditPlan } from "@/lib/session/audit";
import { DEFAULT_KITCHEN, kitchenEquipment, type KitchenConfig } from "@/lib/kitchen/presets";
import { load } from "./helpers";

// La cuisine de la session rejouée : foyers 28, 21 et 14,5 cm, casseroles 1, 2 et 2,5 L, faitout et cocotte de 6 L, deux plats, poêle de 28.
const KITCHEN: KitchenConfig = {
  ...DEFAULT_KITCHEN,
  hobSizes: [28, 21, 14.5],
  pans: [{ material: "inox", cm: 28 }],
  casseroles: [{ cm: 14, liters: 1 }, { cm: 16, liters: 2 }, { cm: 18, liters: 2.5 }],
  faitout: { liters: 6, ovenSafe: false },
  cocotte: { liters: 6, ovenSafe: true },
  plats: 2,
};
const { equipment, fits } = kitchenEquipment(KITCHEN);
const RES: PlannerResources = {
  equipment: equipment.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1, capacityL: e.capacityL ?? null })),
  fits: fits.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
};
const SLUGS = ["poulet-paprika-fume-patates-douces", "butter-chicken-express", "poulet-teriyaki-riz"];
const THREE = SLUGS.map((s) => load(`${s}.json`));
const ALL = fs.readdirSync("src/seed/recipes").filter((f) => f.endsWith(".json")).sort().map(load);
const byFile = (slug: string) => ALL.find((r) => r.slug === slug)!;
const cache = new Map<SessionMode, SessionPlan>();
const planOf = (mode: SessionMode = "solo") => {
  if (!cache.has(mode)) cache.set(mode, planSession(THREE, RES, { mode }));
  return cache.get(mode)!;
};
const stepOf = (plan: SessionPlan, id: string) => plan.steps.find((s) => s.id === id)!;
const T0 = Date.parse("2026-11-01T09:00:00Z");

function play(plan: SessionPlan) {
  const events: SessionEvent[] = [];
  let n = 0;
  const o = (person?: "A" | "B" | null) => ({ sessionId: "s-1", person: person ?? null, id: () => `e${++n}` });
  const write = (evs: Ev[], min: number) => {
    for (const e of evs) events.push({ id: e.id ?? `e${++n}`, at: new Date(T0 + min * 60000).toISOString(), kind: e.kind, ref: e.ref ?? null, payload: e.payload ?? null });
  };
  const state = () => reduce("cooking", events);
  return {
    events,
    state,
    o,
    write,
    act: (step: PlanStep, min: number, alt = false) => write(mainEvents(plan, state(), step, T0 + min * 60000, o(step.person ?? null), alt), min),
  };
}

// ─── Ce qu'une étape fait, ce qu'une autre reprend ───

test("produits : le butter chicken reprend le poulet saisi et la sauce, le paprika rôtit, le teriyaki saisit", () => {
  const butter = recipeFlow(byFile("butter-chicken-express"));
  assert.equal(butter.makes.get(2)?.name, "la sauce");
  assert.equal(butter.makes.get(3)?.name, "le poulet saisi");
  // « Le poulet saisi et son jus dans la sauce mixée, 8 min à 3 » : les deux produits, dès le début.
  assert.deepEqual(butter.uses.get(4), [
    { from: 2, word: "sauce", phase: null },
    { from: 3, word: "poulet", phase: null },
  ]);
  // La saisie se fait « pendant que la sauce mijote » : l'incise ne vaut pas reprise.
  assert.equal(butter.uses.get(3), undefined);
  assert.equal(recipeFlow(byFile("poulet-paprika-fume-patates-douces")).makes.get(2)?.name, "les patates douces et le poulet rôtis");
  const teri = recipeFlow(byFile("poulet-teriyaki-riz"));
  assert.equal(teri.makes.get(2)?.name, "le riz");
  assert.equal(teri.makes.get(3)?.name, "les haricots verts");
  assert.equal(teri.makes.get(4)?.name, "le poulet saisi");
  // « Sauce (bol C) » du teriyaki est un bol, pas une reprise.
  assert.equal(teri.uses.get(4), undefined);
});

test("produits : déduits pour toutes les fiches (bolognaise, béchamel, la viande, les champignons, les œufs), jamais vers l'avant", () => {
  const cannelloni = recipeFlow(byFile("cannelloni-bolognaise"));
  assert.deepEqual(cannelloni.uses.get(4)?.map((u) => `${cannelloni.makes.get(u.from)?.name}@${u.phase}`), ["la bolognaise@1", "la béchamel@3"]);
  const gratin = recipeFlow(byFile("gratin-facon-moussaka"));
  assert.deepEqual(gratin.uses.get(4)?.map((u) => u.word), ["aubergines", "viande"]);
  assert.equal(gratin.makes.get(3)?.name, "la sauce au bœuf");
  assert.deepEqual(recipeFlow(byFile("chasseur-porc")).uses.get(10)?.map((u) => `${u.from}:${u.word}`), ["8:champignons"]);
  assert.deepEqual(recipeFlow(byFile("chasseur-porc")).uses.get(7)?.map((u) => `${u.from}:${u.word}@${u.phase}`), ["5:porc@1"]);
  assert.deepEqual(recipeFlow(byFile("porc-caramel-oeufs")).uses.get(11)?.map((u) => u.word), ["œufs"]);
  assert.deepEqual(recipeFlow(byFile("pasta-al-forno-saucisse-ricotta")).uses.get(6)?.map((u) => u.word), ["pâtes", "porc", "poulet", "sauce"]);
  // Des saisies de suite dans la même poêle (chauffer, saisir, déglacer) : un seul produit, celui de la dernière.
  assert.deepEqual([...recipeFlow(byFile("chasseur-porc")).makes.keys()].filter((k) => k <= 5), [5]);
  for (const r of ALL) {
    const { uses } = recipeFlow(r);
    for (const [order, list] of uses) for (const u of list) assert.ok(u.from < order, `${r.slug} #${order} reprend #${u.from}`);
  }
  // « Dès que le riz est égoutté » dit un moment, pas une reprise.
  assert.ok(!/riz/.test(withoutAsides("Haricots verts (bol H), pendant le braisage, dès que le riz est égoutté : le faitout rincé")));
  assert.equal(productOf(byFile("butter-chicken-express"), byFile("butter-chicken-express").steps[0]), null, "la prep ne fait pas de produit");
});

test("plan : les reprises nommées avec d'où elles viennent, et jamais avant d'exister (seul, à deux, la veille)", () => {
  for (const mode of ["solo", "duo", "veille"] as SessionMode[]) {
    const plan = planOf(mode);
    const finish = stepOf(plan, "butter-chicken-express#4");
    const sear = stepOf(plan, "butter-chicken-express#3");
    const sauce = stepOf(plan, "butter-chicken-express#2");
    assert.deepEqual(finish.uses?.map((u) => [u.stepId, u.name, u.inPlace ?? false]), [
      [sauce.id, "la sauce", true],
      [sear.id, "le poulet saisi", false],
    ]);
    assert.equal(finish.uses?.[1].where, "Poêle");
    assert.ok(finish.needs?.includes(sear.id) && finish.needs.includes(sauce.id), mode);
    assert.ok(finish.startMin >= sear.endMin - 1e-6 && finish.startMin >= sauce.endMin - 1e-6, `${mode} : le poulet dans la sauce après la saisie et la sauce`);
    assert.deepEqual(auditPlan(plan, RES).filter((x) => x.kind === "before_need"), [], mode);
    // À l'écran : « le poulet saisi (poêle, étape N) et la sauce (déjà dans la cocotte…) ».
    const lines = productLines(plan, reduce("cooking", []), finish);
    assert.match(usesText(lines), new RegExp(`le poulet saisi \\(poêle, étape ${sear.no}\\)`));
    assert.match(lines[0].from, /^déjà dans (la cocotte|le faitout), étape \d+$/);
  }
});

test("plan : le four chaud est un prérequis de l'étape qui enfourne, et l'étape qui commence sur le foyer ne l'attend pas", () => {
  const duo = planOf("duo");
  const oven = duo.steps.find((s) => s.kind === "preheat")!;
  const bake = stepOf(duo, "poulet-paprika-fume-patates-douces#2");
  assert.ok(bake.needs?.includes(oven.id));
  const chasseur = planSession([byFile("chasseur-porc"), byFile("colombo-porc")], RES, { mode: "solo" });
  const braise = stepOf(chasseur, "chasseur-porc#7");
  assert.ok(!(braise.needs ?? []).some((id) => id.startsWith("four#")), "le braisage commence sur le foyer : le four ne compte qu'à l'enfournement");
});

// ─── Des titres qui disent ce qu'on fait ───

test("titres : jamais le récipient seul (« Cocotte sur le grand foyer à 5 ») ; l'action d'abord", () => {
  const plan = planOf("solo");
  assert.match(stepOf(plan, "butter-chicken-express#2").title!, /^Prépare la sauce : (cocotte|faitout) sur le/);
  assert.match(stepOf(plan, "poulet-teriyaki-riz#3").title!, /^Cuis les haricots verts : /);
  assert.match(stepOf(plan, "poulet-teriyaki-riz#4").title!, /^Saisis le poulet/);
  for (const s of plan.steps) {
    if (s.kind === "preheat" || s.kind === "cool" || s.tasks) continue;
    assert.ok(namesFood(s.title!) || /\bbols? [A-Z]\b/i.test(s.title!), `${s.id} : « ${s.title} » dit ce qu'on fait`);
  }
  // Un titre qui nomme déjà un aliment ne change pas ; l'incise « pendant que » passe après l'action.
  assert.deepEqual(actionTitle(splitTitle("Riz dans le faitout. Ébullition."), "boil", { object: "le riz", dish: false }, namesFood).title, "Riz dans le faitout");
  assert.equal(actionTitle(splitTitle("Pendant que la sauce mijote : poêle vide, 2 min à 7."), "sear", { object: "le poulet", dish: false }, namesFood).title, "Saisis le poulet, pendant que la sauce mijote");
});

test("textes : un changement de récipient suit aussi les sous-étapes (« remets dans le faitout »)", () => {
  for (const plan of [planOf("solo"), planOf("duo")]) {
    const sauce = stepOf(plan, "butter-chicken-express#2");
    const vessel = sauce.equipmentName!.toLocaleLowerCase("fr");
    assert.ok(sauce.phases!.some((p) => p.text.includes(`remets dans ${vessel === "faitout" ? "le" : "la"} ${vessel}`)), sauce.phases!.map((p) => p.text).join(" / "));
  }
});

// ─── À l'écran : prérequis, clôture, retour ───

test("enfourner pendant que le four chauffe : « Le four est chaud ? », le préchauffage s'arrête, le retour le relance", () => {
  const plan = planOf("duo");
  const oven = plan.steps.find((s) => s.kind === "preheat")!;
  const bake = stepOf(plan, "poulet-paprika-fume-patates-douces#2");
  const g = play(plan);
  g.act(oven, 0); // commencer
  g.act(oven, 0); // lancer 10 min de préchauffage
  assert.equal([...g.state().timers.values()].filter((t) => t.stepId === oven.id && t.doneAt == null).length, 1);
  assert.ok(isReady(plan, g.state(), bake), "un four qui chauffe n'empêche pas de commencer : il suffit de le clore");
  const a = mainAction(plan, g.state(), bake, T0 + 6 * 60000);
  assert.equal(a.label, "Le four est chaud ? Arrêter le préchauffage et enfourner");
  assert.deepEqual(a.closes, [oven.id]);
  g.act(bake, 6);
  let s = g.state();
  assert.equal(stepStatus(s, oven.id), "done");
  assert.ok(s.early.has(oven.id), "clos d'avance");
  assert.equal(stepStatus(s, bake.id), "active");
  assert.equal([...s.timers.values()].filter((t) => t.doneAt == null).length, 0, "le minuteur du four est arrêté");
  // Le retour : l'étape redevient à commencer, le préchauffage rouvre et son minuteur repart (4 min restaient).
  const u = undoFor(plan, s, g.events, bake.person ?? null, T0 + 6.5 * 60000)!;
  assert.match(u.detail, /le préchauffage reprend/);
  g.write(u.events, 6.5);
  s = g.state();
  assert.equal(stepStatus(s, bake.id), "todo");
  assert.equal(stepStatus(s, oven.id), "active");
  assert.ok(!s.early.has(oven.id));
  const t = [...s.timers.values()].find((x) => x.stepId === oven.id && x.doneAt == null)!;
  assert.equal(t.endsAt, T0 + 10 * 60000, "il finit à la même heure qu'avant");
});

test("commencer l'étape suivante clôt son prérequis ouvert ; sa durée ne s'apprend pas", () => {
  const plan = planOf("solo");
  const bake = stepOf(plan, "poulet-paprika-fume-patates-douces#2");
  const cool = stepOf(plan, "poulet-paprika-fume-patates-douces#4");
  const g = play(plan);
  const ids = cool.needs!;
  assert.ok(ids.includes(bake.id));
  // Tout le reste de la recette est fait ; le four tourne encore sur sa dernière attente.
  for (const id of ids.filter((x) => x !== bake.id)) g.write([{ kind: "step_start", ref: id }, { kind: "step_done", ref: id }], 0);
  g.act(bake, 0);
  for (let i = 0; i < 3; i++) g.write(mainEvents(plan, g.state(), bake, T0 + 60000, g.o(), true), 1); // trois sous-étapes faites sans minuteur
  g.act(bake, 2); // lance « Ça rôtit »
  assert.equal(needsLeft(plan, g.state(), cool).length, 1);
  assert.ok(needsLeft(plan, g.state(), cool)[0].closable);
  const a = mainAction(plan, g.state(), cool, T0 + 10 * 60000);
  assert.equal(a.label, `C’est cuit ? Finir l’étape ${bake.no} (sors du four) et commencer`);
  g.act(cool, 10);
  const s = g.state();
  assert.equal(stepStatus(s, bake.id), "done");
  assert.ok(s.early.has(bake.id));
  g.write([{ kind: "step_done", ref: cool.id }, { kind: "note", payload: { status: "done" } }], 20);
  assert.ok(!measureSession(plan, g.events, null).some((x) => x.ref === bake.id), "pas de mesure pour une étape close d'avance");
});

test("une étape dont le produit n'existe pas encore n'est pas proposée ; forcée, le bouton le dit", () => {
  const plan = planOf("solo");
  const finish = stepOf(plan, "butter-chicken-express#4");
  const g = play(plan);
  const s = g.state();
  assert.ok(!isReady(plan, s, finish));
  const a = mainAction(plan, s, finish, T0);
  assert.match(a.label, /^Commencer quand même/);
  assert.match(a.hint, /n’est pas finie|ne sont pas finies/);
  assert.deepEqual(startEvents(plan, s, finish, g.o()).map((e) => e.kind), ["step_start"], "rien n'est clos de ce qui n'a pas commencé");
});

test("la suite annoncée est la vraie suite : celle que l'écran montre une fois l'étape finie, jamais une étape qui attend", () => {
  for (const mode of ["solo", "veille", "duo"] as SessionMode[]) {
    const plan = planOf(mode);
    const g = play(plan);
    let min = 0;
    const seen = new Set<string>();
    for (let k = 0; k < 400; k++) {
      const s = g.state();
      if (plan.steps.every((x) => stepStatus(s, x.id) === "done")) break;
      const now = T0 + min * 60000;
      const f = focusStep(plan, s, now)!;
      // Ce qui sonne s'arrête (la sonnerie), sinon le bouton principal, sans minuteur (rien n'attend).
      const a = mainAction(plan, s, f, now);
      const finishing = a.kind === "finish" || (a.kind === "phase" && currentLast(f, s));
      if (finishing) {
        const told = upNext(plan, s, f);
        g.act(f, min, Boolean(a.alt));
        const after = g.state();
        if (told) {
          assert.ok(isReady(plan, after, told) || plan.steps.filter((x) => (mode !== "duo" || (x.person ?? "A") === (f.person ?? "A")) && stepStatus(after, x.id) === "todo").every((x) => !isReady(plan, after, x)), `${mode} : ${told.id} annoncée alors qu'elle attend`);
          if (/Ensuite, à commencer/.test(a.hint)) assert.ok(a.hint.includes(stepTitleOf(told, 50)), a.hint);
          // Seul : une fois l'étape finie, l'écran montre bien l'étape annoncée (sauf une étape lancée qui revient).
          if (mode !== "duo" && ![...after.started.keys()].some((id) => stepStatus(after, id) === "active")) assert.equal(focusStep(plan, after, now)?.id, told.id, `${mode} : annoncée ${told.id}`);
        }
        seen.add(f.id);
      } else g.act(f, min, Boolean(a.alt));
      min += 0.5;
    }
    assert.equal(plan.steps.filter((x) => stepStatus(g.state(), x.id) !== "done").length, 0, `${mode} : la session va au bout`);
  }
  function currentLast(f: PlanStep, s: ReturnType<typeof reduce>) {
    return Boolean(f.phases?.length) && s.phasesDone.size >= 0 && f.phases!.every((_, i) => i === f.phases!.length - 1 || s.phasesDone.has(`${i}:${f.id}`));
  }
});

test("terminer maintenant : le minuteur d'une sous-étape la finit, celui d'une attente finit l'étape ; arrêter ne marque rien", () => {
  const plan = planOf("duo");
  const oven = plan.steps.find((s) => s.kind === "preheat")!;
  const g = play(plan);
  g.act(oven, 0);
  g.act(oven, 0);
  const t = [...g.state().timers.values()].find((x) => x.stepId === oven.id)!;
  g.write(finishNowEvents(plan, g.state(), t, g.o()), 4);
  assert.equal(stepStatus(g.state(), oven.id), "done");
  // Une sous-étape chronométrée : « L'eau chauffe » finie d'un geste, la suivante attend le sien.
  const beans = stepOf(plan, "poulet-teriyaki-riz#3");
  const h = play(plan);
  h.act(beans, 0);
  h.act(beans, 0); // « Eau salée, couvercle » : un geste d’une minute, fait
  h.act(beans, 1); // lance « L'eau chauffe »
  const w = [...h.state().timers.values()].find((x) => x.stepId === beans.id && x.doneAt == null)!;
  assert.equal(w.phase, 1);
  h.write(finishNowEvents(plan, h.state(), w, h.o()), 5);
  const s = h.state();
  assert.ok(s.phasesDone.has(`1:${beans.id}`));
  assert.equal(stepStatus(s, beans.id), "active");
  assert.equal([...s.timers.values()].filter((x) => x.doneAt == null).length, 0);
  // Arrêter (sans terminer) : le minuteur s'arrête, la sous-étape reste à faire.
  h.act(beans, 5); // « Haricots verts (bol J) » : fait
  h.act(beans, 5); // lance « Ils cuisent »
  const c = [...h.state().timers.values()].find((x) => x.stepId === beans.id && x.doneAt == null)!;
  h.write([{ kind: "timer_done", ref: c.id }], 6);
  assert.ok(!h.state().phasesDone.has(`${c.phase}:${beans.id}`));
  assert.equal(stepStatus(h.state(), beans.id), "active");
});

// ─── La fenêtre d'une recette ───

test("fenêtre : tous les ingrédients de la session (bols, au moment, hors bol, part du riz commun), toutes les étapes adaptées", () => {
  const plan = planOf("duo");
  const g = play(plan);
  const sauce = stepOf(plan, "butter-chicken-express#2");
  g.act(sauce, 0);
  const s = g.state();
  const sh = recipeSheet(plan, s, "butter-chicken-express", sauce.id)!;
  assert.equal(sh.name, plan.recipes.find((r) => r.slug === "butter-chicken-express")!.name);
  // Les bols de la recette, quantités de la session.
  const letters = plan.bowls.filter((b) => b.recipeSlug === "butter-chicken-express").map((b) => b.letter);
  assert.deepEqual(sh.groups.filter((x) => x.letter).map((x) => x.letter), letters);
  const onions = sh.groups.flatMap((x) => x.items).find((i) => /^Oignons/.test(i.item))!;
  assert.equal(onions.qty, plan.bowls.flatMap((b) => b.items).find((i) => /^Oignons/.test(i.item) && plan.bowls.find((b) => b.items.includes(i))!.recipeSlug === "butter-chicken-express")!.qty);
  assert.ok(sh.groups.some((x) => x.holder === "placard" && x.items.some((i) => /huile/i.test(i.item))), "l'huile pour saisir, hors bol");
  // Le riz cuit avec le poulet au paprika : sa part.
  assert.equal(sh.shares.length, 1);
  assert.match(sh.shares[0].mine, /cru, .* cuit$/);
  assert.ok(sh.shares[0].with.some((n) => /paprika/i.test(n)));
  // Les étapes : texte du moteur (récipient choisi, foyer), l'étape en cours repérée.
  const row = sh.steps.find((x) => x.id === sauce.id)!;
  assert.ok(row.current);
  assert.equal(row.status, "active");
  assert.ok(row.where.some((w) => w === sauce.equipmentName));
  assert.ok(row.where.some((w) => /foyer/.test(w) && /niveau 5/.test(w)), row.where.join(" · "));
  assert.equal(row.phases[0].status, "active");
  const last = sh.steps.find((x) => x.id === "butter-chicken-express#4")!;
  assert.equal(last.uses.length, 2);
  assert.deepEqual(sh.steps.map((x) => x.no), [...sh.steps.map((x) => x.no)].sort((a, b) => a - b), "dans l'ordre de la session");
  // Le poulet au paprika : le préchauffage qu'il attend fait partie de sa fenêtre.
  const pap = recipeSheet(plan, s, "poulet-paprika-fume-patates-douces")!;
  assert.ok(pap.steps.some((x) => x.id.startsWith("four#") && x.n == null));
});

test("pastilles : le mot d'un produit repris devient une pastille, une fois, à côté des bols", () => {
  const plan = planOf("solo");
  const finish = stepOf(plan, "butter-chicken-express#4");
  const parts = richParts(finish.title!, plan.bowls.map((b) => b.letter), finish.uses);
  assert.deepEqual(parts.filter((p) => p.t === "product").map((p) => p.v), ["poulet", "sauce"]);
  assert.equal(parts.map((p) => p.v).join(""), finish.title);
  const withBowl = richParts(finish.detail!, plan.bowls.map((b) => b.letter), finish.uses);
  assert.ok(withBowl.some((p) => p.t === "bowl"));
});
