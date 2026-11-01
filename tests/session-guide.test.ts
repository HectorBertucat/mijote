// Ce que dit l'écran de session : un bouton fait une seule chose et la nomme, aucun minuteur ne part
// tout seul, le retour défait la dernière action (par personne à deux), un minuteur qui sonne dit quoi
// faire, le fil range l'étape en cours, ce qui tourne en fond et la suite, les titres ne coupent rien.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSession, type PlanStep, type SessionPlan } from "@/lib/session/planner";
import { reduce, stepStatus, type SessionEvent } from "@/lib/session/state";
import { attentionOf, lanesOf, mainAction, mainEvents, recipeStep, reminderAt, remindersOf, ringInfo, stopEvents, undoFor, weighItems, type Ev } from "@/lib/session/guide";
import { bowlParts, clip, splitStep, stepTitleOf } from "@/lib/session/text";
import { load, RES } from "./helpers";
import { typo } from "@/lib/typo";

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");
const T0 = Date.parse("2026-10-21T18:00:00Z");
const at = (min: number) => new Date(T0 + min * 60000).toISOString();

/** Un journal qu'on rejoue : chaque action écrit ses événements à l'heure donnée, comme l'appli. */
function journal(plan: SessionPlan) {
  const events: SessionEvent[] = [];
  let n = 0;
  const opts = (person: "A" | "B" | null = null) => ({ sessionId: "session-1234", person, id: () => `e${++n}` });
  const write = (evs: Ev[], min: number) => {
    for (const e of evs) events.push({ id: e.id ?? `e${++n}`, at: at(min), kind: e.kind, ref: e.ref ?? null, payload: e.payload ?? null });
  };
  return {
    events,
    state: () => reduce("cooking", events),
    act: (step: PlanStep, min: number, person: "A" | "B" | null = null, alt = false) => write(mainEvents(plan, reduce("cooking", events), step, T0 + min * 60000, opts(person), alt), min),
    write,
    opts,
  };
}

const withPhases = (plan: SessionPlan, pred: (s: PlanStep) => boolean = () => true) => plan.steps.find((s) => (s.phases?.length ?? 0) >= 2 && pred(s))!;

test("textes : la consigne de tête ne coupe jamais une parenthèse, le titre court non plus", () => {
  const preheat = "Règle le four à 220 °C chaleur tournante (préchauffage 10 min, pour : Poulet au paprika fumé, patates douces rôties et riz).";
  const { head, rest } = splitStep(preheat);
  assert.equal(head, typo("Règle le four à 220 °C chaleur tournante"));
  assert.ok(rest.startsWith(typo("Préchauffage 10 min, pour : Poulet au paprika fumé")), rest);
  assert.equal(stepTitleOf({ kind: "preheat", text: preheat }), typo("Préchauffe le four à 220 °C"));
  for (const t of [preheat, "Patates douces (bol A) étalées dans les deux grands plats, niveaux 2 et 4 : 15 min. Ajoute le poulet (bol B).", "Huile + un tiers du poulet (bol F), ne touche pas pendant 3 min, retourne ensuite et laisse dorer encore"]) {
    const c = clip(t, 40);
    assert.ok(c.length <= 41, c);
    assert.equal((c.match(/\(/g) ?? []).length, (c.match(/\)/g) ?? []).length, `parenthèses équilibrées : ${c}`);
  }
  assert.equal(clip("Beurre + bol E, remue de temps en temps", 64), "Beurre + bol E, remue de temps en temps");
});

test("textes : les bols cités deviennent des pastilles, seulement ceux du plan", () => {
  const parts = bowlParts("Riz (bol M) dans la casserole, puis bols K et L ; le bolet reste, bol Z inconnu.", ["K", "L", "M"]);
  assert.deepEqual(parts.filter((p) => p.t === "bowl").map((p) => p.v), ["M", "K", "L"]);
  assert.equal(parts.map((p) => p.v).join(""), "Riz (bol M) dans la casserole, puis bols K et L ; le bolet reste, bol Z inconnu.");
  assert.deepEqual(bowlParts("Bol G, à demi couvert", ["G"]).map((p) => p.t), ["text", "bowl", "text"]);
});

test("bouton principal : « Commencer » commence l’étape et rien d’autre (ni minuteur, ni étape suivante)", () => {
  const plan = planSession([chasseur, forno], RES);
  const j = journal(plan);
  const step = withPhases(plan);
  const a = mainAction(plan, j.state(), step);
  assert.equal(a.kind, "start");
  assert.match(a.label, /^Commencer : /);
  j.act(step, 0);
  assert.deepEqual(j.events.map((e) => e.kind), ["step_start"]);
  assert.equal(j.state().timers.size, 0, "aucun minuteur ne part tout seul");
});

test("bouton principal : une sous-étape chronométrée propose « Lance N min », qui ne lance que son minuteur", () => {
  const plan = planSession([chasseur, forno], RES);
  const step = withPhases(plan, (s) => s.phases!.some((p) => p.wait || p.min >= 2));
  const j = journal(plan);
  j.act(step, 0);
  // Jusqu'à la première sous-étape chronométrée, chaque « Fait » ne fait qu'une sous-étape.
  let n = 0;
  while (!(step.phases![n].wait || step.phases![n].min >= 2)) {
    const a = mainAction(plan, j.state(), step);
    assert.equal(a.kind, "phase");
    assert.match(a.label, /^Fait : /);
    j.act(step, n + 1);
    n++;
  }
  const a = mainAction(plan, j.state(), step);
  assert.equal(a.kind, "phase-timer");
  assert.match(a.label, /^Lance .+ min : /);
  assert.equal(a.alt?.label, "Fait, sans minuteur");
  const before = j.events.length;
  j.act(step, 10);
  const added = j.events.slice(before);
  assert.deepEqual(added.map((e) => e.kind), ["timer_start"]);
  assert.equal(added[0].payload?.phase, n);
  assert.equal(j.state().timers.size, 1);
  // Sa fin sonne ; l'arrêter fait la sous-étape, la suivante attend son geste (pas de minuteur lancé).
  const t = [...j.state().timers.values()][0];
  const stop = stopEvents(plan, j.state(), t, Date.parse(at(10)) + step.phases![n].min * 60000 + 1000, { ...j.opts(), auto: false });
  assert.ok(stop.some((e) => e.kind === "timer_done"));
  assert.ok(stop.some((e) => e.kind === "step_done" && e.ref === `phase:${n}:${step.id}`));
  assert.ok(!stop.some((e) => e.kind === "timer_start"), "la sous-étape suivante ne démarre pas toute seule");
});

test("bouton principal : finir une étape ne commence jamais la suivante ; une attente se lance d’un geste nommé", () => {
  const plan = planSession([chasseur, forno], RES);
  const step = plan.steps.find((s) => !s.phases?.length && s.durationMin - s.activeMin >= 3 && s.kind !== "preheat") ?? plan.steps.find((s) => s.kind === "preheat")!;
  const j = journal(plan);
  j.act(step, 0);
  const a = mainAction(plan, j.state(), step);
  assert.equal(a.kind, "passive");
  assert.match(a.label, /^Lance \d+ min : /);
  j.act(step, 1);
  const t = [...j.state().timers.values()].find((x) => x.stepId === step.id)!;
  assert.ok(t, "le minuteur d’attente, nommé");
  assert.equal(mainAction(plan, j.state(), step).kind, "finish");
  j.act(step, 2);
  assert.equal(stepStatus(j.state(), step.id), "done");
  assert.ok(plan.steps.every((s) => s.id === step.id || stepStatus(j.state(), s.id) === "todo"), "aucune autre étape commencée");
});

test("retour : défait la dernière action encore visible, et le dit", () => {
  const plan = planSession([chasseur, forno], RES);
  const step = withPhases(plan);
  const j = journal(plan);
  assert.equal(undoFor(plan, j.state(), j.events, null), null, "rien à défaire");
  j.act(step, 0);
  const u1 = undoFor(plan, j.state(), j.events, null)!;
  assert.match(u1.label, /^Pas encore commencé : /);
  j.act(step, 1, null, mainAction(plan, j.state(), step).kind === "phase-timer");
  const u2 = undoFor(plan, j.state(), j.events, null)!;
  assert.match(u2.label, /^Revenir à : /);
  j.write(u2.events, 2);
  assert.equal(j.state().phasesDone.size, 0, "la sous-étape redevient en cours");
  // Le retour suivant défait le « Commencer » (la sous-étape défaite ne compte plus).
  const u3 = undoFor(plan, j.state(), j.events, null)!;
  assert.match(u3.label, /^Pas encore commencé : /);
  j.write(u3.events, 3);
  assert.equal(stepStatus(j.state(), step.id), "todo");
});

test("retour à deux : chacun défait sa propre dernière action, pas celle de l’autre", () => {
  const plan = planSession([chasseur, forno], RES, { mode: "duo" });
  const stepA = plan.steps.find((s) => (s.person ?? "A") === "A")!;
  const stepB = plan.steps.find((s) => s.person === "B")!;
  assert.ok(stepA && stepB);
  const j = journal(plan);
  j.act(stepA, 0, "A");
  j.act(stepB, 1, "B");
  const uA = undoFor(plan, j.state(), j.events, "A")!;
  const uB = undoFor(plan, j.state(), j.events, "B")!;
  assert.ok(uA.events.some((e) => e.ref === stepA.id), "A défait son étape");
  assert.ok(uB.events.some((e) => e.ref === stepB.id), "B défait la sienne");
  j.write(uA.events, 2);
  assert.equal(stepStatus(j.state(), stepA.id), "todo");
  assert.equal(stepStatus(j.state(), stepB.id), "active", "l’étape de B ne bouge pas");
  assert.equal(undoFor(plan, j.state(), j.events, "A"), null, "A n’a plus rien à défaire");
});

test("fil : l’étape en cours, ce qui tourne en fond avec son attention, la suite, les mains libres", () => {
  const plan = planSession([chasseur, forno], RES);
  const j = journal(plan);
  const slow = plan.steps.find((s) => !s.phases?.length && s.durationMin - s.activeMin >= 3)!;
  j.act(slow, 0);
  j.act(slow, 1); // lance son attente
  const other = plan.steps.find((s) => s.id !== slow.id)!;
  j.act(other, 2);
  const l = lanesOf(plan, j.state(), T0 + 3 * 60000, other);
  assert.equal(l.now?.step.id, other.id);
  assert.deepEqual(l.background.map((b) => b.step.id), [slow.id]);
  assert.ok(l.background[0].timer, "son minuteur");
  assert.notEqual(l.background[0].attention, "mains", "une attente laisse les mains libres");
  assert.ok(l.next.length > 0 && l.next.every((s) => stepStatus(j.state(), s.id) === "todo"));
});

test("attention et rappels : le champ du plan d’abord, sinon déduits ; un rappel par période, pas à la fin", () => {
  const plan = planSession([chasseur, forno], RES);
  const step = withPhases(plan);
  const wait = { ...step, hobId: "h1", kind: "braise" as const, phases: [{ text: "La sauce mijote", min: 14, wait: true }, { text: "Mixe", min: 3 }] };
  assert.equal(attentionOf(wait, 0), "surveille");
  assert.equal(attentionOf(wait, 1), "mains");
  assert.equal(attentionOf({ ...wait, kind: "bake", hobId: null }, 0), "libre");
  assert.equal(attentionOf({ ...wait, phases: [{ text: "La sauce mijote", min: 14, wait: true, attention: "libre" } as never] }, 0), "libre", "le plan décide");
  assert.deepEqual(remindersOf({ ...wait, phases: [{ text: "Beurre + bol E, remue de temps en temps", min: 8 }] }, 0), [{ text: "Remue", everyMin: 4 }]);
  assert.deepEqual(remindersOf({ ...wait, phases: [{ text: "Couvert, à 2, ça cuit sans ouvrir", min: 12, wait: true }] }, 0, 12), [], "on ne remue pas un riz couvert");
  assert.deepEqual(remindersOf({ ...wait, phases: [{ text: "Ça mijote", min: 30, wait: true, reminders: [{ everyMin: 10, text: "Ajoute un peu d’eau" }] } as never] }, 0), [{ text: "Ajoute un peu d’eau", everyMin: 10 }]);
  const rems = [{ text: "Remue", everyMin: 4 }];
  assert.equal(reminderAt(rems, T0, T0 + 2 * 60000).due, null);
  assert.equal(reminderAt(rems, T0, T0 + 2 * 60000).next?.at, T0 + 4 * 60000);
  assert.equal(reminderAt(rems, T0, T0 + 4 * 60000 + 20000).due?.text, "Remue");
  assert.equal(reminderAt(rems, T0, T0 + 4 * 60000 + 20000, T0 + 4 * 60000 + 10000).due, null, "pas de rappel quand ça sonne");
});

test("ça sonne : la recette, ce que ça touche, l’action maintenant, puis la suite", () => {
  const plan = planSession([chasseur, forno], RES);
  const step = withPhases(plan, (s) => Boolean(s.equipmentName));
  const j = journal(plan);
  j.act(step, 0);
  j.write([{ kind: "timer_start", ref: "t1", payload: { label: step.phases![0].text, minutes: 2, stepId: step.id, phase: 0, endsAt: at(2) } }], 0);
  const info = ringInfo(plan, j.state(), j.state().timers.get("t1")!);
  assert.equal(info.recipe?.slug, step.recipeSlug);
  assert.equal(info.finished, step.phases![0].text);
  assert.equal(info.action, step.phases![1].text, "l’action à faire : la sous-étape suivante");
  assert.ok(info.where.includes(step.equipmentName!), "le récipient");
  if (step.phases![1].wait || step.phases![1].min >= 2) {
    assert.match(info.chain!.label, /^Arrêter · lancer .+ : /, "la suite chronométrée se lance d’un geste nommé");
    const t = j.state().timers.get("t1")!;
    const plain = stopEvents(plan, j.state(), t, T0 + 3 * 60000, { ...j.opts(), auto: false });
    const chained = stopEvents(plan, j.state(), t, T0 + 3 * 60000, { ...j.opts(), auto: false, chain: true });
    assert.ok(!plain.some((e) => e.kind === "timer_start"));
    assert.equal(chained.filter((e) => e.kind === "timer_start").length, 1);
    assert.equal(chained.find((e) => e.kind === "timer_start")!.payload?.phase, 1);
  } else assert.match(info.stop, /^Arrêter · passer à : /);
});

test("repères : l’étape dans sa recette, les quantités d’une pesée", () => {
  const plan = planSession([chasseur, forno], RES, { mode: "duo" });
  const steps = plan.steps.filter((s) => s.recipeSlug === chasseur.slug).sort((a, b) => a.order - b.order);
  assert.deepEqual(recipeStep(plan, steps[1]), { n: 2, of: steps.length });
  const weigh = plan.prep.tasks.find((t) => t.kind === "weigh");
  if (weigh) {
    const items = weighItems(plan, weigh);
    assert.ok(items.length > 0);
    assert.ok(items.some((i) => i.qty), "chaque pesée a ses grammes");
  }
});
