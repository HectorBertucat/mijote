// Vue simple d'une session : les trois temps (Prépare, Cuisine, Range), leur avancement, ce qui sonne
// bientôt, le rangement (une boîte par repas), et le rendu de l'étape montrée à chaque instant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { planSession, type SessionPlan } from "@/lib/session/planner";
import { currentPhase, phaseIds, reduce, type SessionEvent, type TimerState } from "@/lib/session/state";
import { mealsOf, prepBowls, prepExtras, soonTimers, stageOf, storageLine, tempsProgress } from "@/lib/session/flow";
import { Ringing, StepNow } from "@/components/session/Simple";
import type { Controls } from "@/components/session/SessionApp";
import { load, RES } from "./helpers";

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");

let n = 0;
const ev = (kind: SessionEvent["kind"], ref: string | null, payload: Record<string, unknown> | null = null, at = "2026-10-21T18:00:00Z"): SessionEvent => ({ id: `e${++n}`, at, kind, ref, payload });
const cookAll = (plan: SessionPlan) => plan.steps.map((s) => ev("step_done", s.id));

test("trois temps : la prep, puis la cuisine, puis le rangement quand tout est cuit, puis la fin", () => {
  const plan = planSession([chasseur, forno], RES);
  assert.equal(stageOf(plan, reduce("prep", [])), "prep");
  const cooking = [ev("note", null, { status: "cooking" })];
  assert.equal(stageOf(plan, reduce("prep", cooking)), "cook");
  assert.equal(stageOf(plan, reduce("prep", [...cooking, ...cookAll(plan)])), "store");
  assert.equal(stageOf(plan, reduce("prep", [...cooking, ...cookAll(plan), ev("note", null, { status: "done" })])), "done");
  // Prep la veille : le soir, seulement les bols qui se gardent ; puis l'écran « au frigo ».
  const veille = planSession([chasseur, forno], RES, { mode: "veille" });
  const eve = reduce("prep", []);
  assert.ok(prepBowls(veille, eve).every((b) => b.fridge));
  assert.equal(stageOf(veille, reduce("prep", [ev("note", null, { status: "fridge" })])), "fridge");
  // À deux : un seul temps (chacun son fil) jusqu'au rangement, qui attend aussi les gestes de prep.
  const duo = planSession([chasseur, forno], RES, { mode: "duo" });
  assert.equal(stageOf(duo, reduce("prep", [])), "cook");
  assert.equal(stageOf(duo, reduce("prep", cookAll(duo))), duo.prep.tasks.length ? "cook" : "store");
  assert.equal(stageOf(duo, reduce("prep", [...cookAll(duo), ...duo.prep.tasks.map((t) => ev("step_done", `prep:${t.id}`))])), "store");
});

test("avancement : chaque temps de 0 à 1, les bols, la cuisson au prorata, les boîtes", () => {
  const plan = planSession([chasseur, forno], RES);
  const bowls = prepBowls(plan, reduce("prep", []));
  assert.deepEqual(tempsProgress(plan, reduce("prep", [])), { prep: 0, cook: 0, store: 0 });
  const half = bowls.slice(0, Math.floor(bowls.length / 2)).map((b) => ev("bowl_ready", b.letter, { ready: true }));
  const p1 = tempsProgress(plan, reduce("prep", half));
  assert.ok(p1.prep > 0 && p1.prep < 1);
  const started = [ev("note", null, { status: "cooking" }), ev("step_start", plan.steps[0].id)];
  const p2 = tempsProgress(plan, reduce("prep", started));
  assert.equal(p2.prep, 1, "la cuisson lancée, la prep est derrière");
  assert.ok(p2.cook > 0 && p2.cook < 0.5);
  const boxed = [ev("note", null, { boxed: plan.recipes[0].slug })];
  const p3 = tempsProgress(plan, reduce("prep", [...started, ...cookAll(plan), ...boxed]));
  assert.equal(p3.cook, 1);
  assert.equal(p3.store, 1 / plan.recipes.length);
  // Décocher une recette rangée.
  const undone = reduce("prep", [...boxed, ev("note", null, { boxed: plan.recipes[0].slug, undo: true })]);
  assert.equal(undone.boxed.size, 0);
  assert.deepEqual(tempsProgress(plan, reduce("prep", [ev("note", null, { status: "done" })])), { prep: 1, cook: 1, store: 1 });
});

test("prep : ce qui va sur le plateau sans bol et les gestes à part", () => {
  const plan = planSession([chasseur, forno], RES);
  const { plate, tasks } = prepExtras(plan, reduce("prep", []));
  assert.ok(plate.every((i) => i.bowl == null));
  assert.ok(tasks.every((t) => t.kind === "other"));
  const all = plan.prep.tasks.flatMap((t) => (t.kind === "cut" ? t.items : []));
  assert.equal(plate.length, all.filter((i) => !i.bowl).length);
});

test("ce qui sonne bientôt : du plus proche au plus lointain, sans l'étape montrée ni ce qui est fini", () => {
  const t = (id: string, endsAt: number, stepId: string | null = null, doneAt: number | null = null): TimerState => ({ id, label: id, stepId, endsAt, minutes: 5, doneAt, phase: null, startedAt: 0, refMinutes: 5 });
  const list = [t("c", 3000), t("a", 1000, "focus"), t("b", 2000), t("fini", 2500, null, 10), t("passe", 100)];
  assert.deepEqual(soonTimers(list, 500, "focus").map((x) => x.id), ["b", "c"]);
  assert.deepEqual(soonTimers(list, 500).map((x) => x.id), ["a", "b", "c"]);
});

test("rangement : une boîte par repas du foyer, et la conservation de la fiche", () => {
  assert.equal(mealsOf(12, 3), 4);
  assert.equal(mealsOf(2, 3), 1, "au moins une boîte");
  assert.equal(mealsOf(10, 0), 10);
  assert.equal(storageLine({ slug: "x", units: 12, meals: 4, fridgeDays: 4, freezerOk: true }), "4 boîtes · 4 jours au frigo · se congèle");
  assert.equal(storageLine({ slug: "x", units: 3, meals: 1, fridgeDays: null, freezerOk: false }), "1 boîte");
});

const escaped = (text: string) => renderToStaticMarkup(createElement("b", null, text)).slice(3, -4);

/** Les commandes d'un écran, sans réseau : seulement ce que lisent les blocs rendus. */
function controls(plan: SessionPlan, events: SessionEvent[], now: number): Controls {
  const state = reduce("prep", events);
  const noop = () => {};
  return { state, now, cookingStart: Date.parse("2026-10-21T18:00:00Z"), timers: [...state.timers.values()].filter((t) => t.doneAt == null), focus: null, mode: "solo", startPhase: noop, addMinutes: noop, stopTimer: noop, toggleStep: noop } as unknown as Controls;
}

test("rendu : chaque étape, à lancer puis à chaque sous-étape, en grand et sans NaN ; ce qui sonne aussi", () => {
  const plan = planSession([chasseur, forno], RES);
  const at = (min: number) => new Date(Date.parse("2026-10-21T18:00:00Z") + min * 60000).toISOString();
  for (const step of plan.steps) {
    const todo = renderToStaticMarkup(createElement(StepNow, { plan, c: controls(plan, [], Date.parse(at(0))), step }));
    assert.match(todo, /À lancer · étape/, step.id);
    assert.match(todo, /<h1/, step.id);
    assert.ok(!/NaN|undefined/.test(todo), `${step.id} : ${todo.match(/.{40}(NaN|undefined).{40}/)?.[0]}`);
    const events = [ev("step_start", step.id, null, at(0))];
    (step.phases ?? []).forEach((ph, i) => {
      const ids = phaseIds("session-1234", step.id, i);
      events.push(ev("timer_start", ids.timer, { label: ph.text, minutes: ph.min, stepId: step.id, phase: i, endsAt: at(i + ph.min) }, at(i)));
      const html = renderToStaticMarkup(createElement(StepNow, { plan, c: controls(plan, events, Date.parse(at(i)) + 1000), step }));
      assert.equal(currentPhase(reduce("prep", events), step), i);
      assert.ok(html.includes(escaped(ph.text)), `${step.id} : sous-étape ${i} en titre`);
      assert.match(html, /role="timer"/, `${step.id} : pastille du minuteur`);
      assert.ok(!/NaN/.test(html), `${step.id} : pas de NaN`);
      events.push(ev("step_done", `phase:${i}:${step.id}`, null, at(i + ph.min)));
    });
  }
  // Une attente qui sonne : le geste qui suit en titre.
  const st = plan.steps.find((s) => s.phases?.some((p, i) => p.wait && s.phases![i + 1]))!;
  const w = st.phases!.findIndex((p, i) => p.wait && st.phases![i + 1]);
  const timer: TimerState = { id: "t", label: st.phases![w].text, stepId: st.id, endsAt: 1000, minutes: 5, doneAt: null, phase: w, startedAt: 0, refMinutes: 5 };
  const ring = renderToStaticMarkup(createElement(Ringing, { plan, c: controls(plan, [], 5000), timers: [timer] }));
  assert.match(ring, /role="alert"/);
  assert.ok(ring.includes(`Fini : `), "fin d'une attente");
});
