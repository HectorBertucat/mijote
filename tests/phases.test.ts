import { test } from "node:test";
import fs from "fs";
import path from "path";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { recipes, recipeSteps } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import { planSession } from "@/lib/session/planner";
import { currentPhase, focusStep, passiveMin, phaseIds, phaseTimer, reduce, stepTimer, type SessionEvent } from "@/lib/session/state";
import { buildPlan } from "@/lib/session/store";
import { load, RES } from "./helpers";

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");

let n = 0;
const ev = (kind: SessionEvent["kind"], ref: string | null, payload: Record<string, unknown> | null = null, at = "2026-10-21T18:00:00Z"): SessionEvent => ({ id: `e${++n}`, at, kind, ref, payload });

test("sous-étapes : la fiche les porte jusqu'au plan, et l'attente est ce qui reste après elles", () => {
  const plan = planSession([chasseur, forno], RES);
  const cocotte = plan.steps.find((s) => s.recipeSlug === chasseur.slug && s.phases?.[0]?.text.startsWith("Cocotte vide"))!;
  assert.deepEqual(
    cocotte.phases!.map((p) => [p.min, p.hobLevel]),
    [
      [3, 7],
      [5, 5],
      [1, 5],
    ]
  );
  assert.equal(passiveMin(cocotte), Math.max(0, cocotte.durationMin - 9));
  const vin = plan.steps.find((s) => s.phases?.[0]?.text.startsWith("Vin blanc"))!;
  assert.ok(passiveMin(vin) >= 55, "le braisage garde son minuteur long après les sous-étapes");
  // Une étape sans sous-étapes garde l'ancien calcul.
  const repos = plan.steps.find((s) => s.kind === "cool" && s.recipeSlug === forno.slug)!;
  assert.equal(repos.phases, undefined);
  assert.equal(passiveMin(repos), repos.durationMin - repos.activeMin);
  // Le riz s'écrit de bout en bout avec ses attentes (l'eau chauffe, 11 min de cuisson, 5 de repos) : plus de long minuteur à la fin.
  const riz = plan.steps.find((s) => s.text.startsWith("Riz"))!;
  assert.deepEqual(riz.phases!.filter((p) => p.wait).map((p) => p.min), [2.5, 11, 5]);
  assert.ok(passiveMin(riz) < 3);
});

test("sous-étapes : le journal dit laquelle est en cours ; leurs minuteurs ne volent pas le focus", () => {
  const plan = planSession([chasseur, forno], RES);
  const st = plan.steps.find((s) => s.phases?.[0]?.text.startsWith("Cocotte vide"))!;
  const ids = phaseIds("session-1234", st.id, 0);
  const evs = [
    ev("note", null, { status: "cooking" }),
    ev("step_start", st.id),
    ev("timer_start", ids.timer, { label: st.phases![0].text, minutes: 3, stepId: st.id, phase: 0, endsAt: "2026-10-21T18:03:00Z" }),
  ];
  let s = reduce("prep", evs);
  assert.equal(currentPhase(s, st), 0);
  assert.equal(phaseTimer(s, st.id, 0)?.phase, 0);
  assert.equal(stepTimer(s, st.id), undefined, "le minuteur de la sous-étape n'est pas celui de l'étape");
  // Pendant le minuteur de la sous-étape, l'étape reste celle montrée en grand.
  assert.equal(focusStep(plan, s, Date.parse("2026-10-21T18:01:00Z"))?.id, st.id);
  s = reduce("prep", [...evs, ev("timer_done", ids.timer), ev("step_done", `phase:0:${st.id}`)]);
  assert.equal(currentPhase(s, st), 1);
  s = reduce("prep", [...evs, ev("step_done", `phase:0:${st.id}`), ev("step_done", `phase:1:${st.id}`), ev("step_done", `phase:2:${st.id}`)]);
  assert.equal(currentPhase(s, st), null, "toutes faites");
  s = reduce("prep", [...evs, ev("step_done", `phase:0:${st.id}`), ev("step_done", `phase:0:${st.id}`, { undo: true })]);
  assert.equal(currentPhase(s, st), 0, "annuler rouvre la sous-étape");
  // Ids stables, différents d'une sous-étape à l'autre et d'une session à l'autre.
  assert.notEqual(phaseIds("session-1234", st.id, 1).start, ids.start);
  assert.notEqual(phaseIds("autre-5678", st.id, 0).timer, ids.timer);
  assert.ok(ids.start.length <= 80 && ids.timer.length <= 200);
});

test("en base : les sous-étapes sont importées avec la fiche et reviennent dans le plan", () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const r = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, forno.slug)).get()!;
  const steps = db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, r.id)).all();
  assert.ok(steps.some((s) => s.phases?.length === 4));
  assert.ok(steps.some((s) => s.phases == null));
  const plan = buildPlan(db, { slugs: [forno.slug], durations: false });
  assert.ok(plan.steps.some((s) => s.phases?.some((p) => p.text.includes("galette"))));
});

test("fournées : « fournée 2 sur 3 » suit la sous-étape en cours", async () => {
  const { batchOf } = await import("@/lib/session/state");
  const plan = planSession([chasseur], RES);
  const st = plan.steps.find((s) => s.phases?.some((p) => p.batch === 3))!;
  const evs = [ev("note", null, { status: "cooking" }), ev("step_start", st.id)];
  assert.deepEqual(batchOf(reduce("prep", evs), st), { at: 1, of: 3 });
  const done = [0, 1, 2, 3].map((i) => ev("step_done", `phase:${i}:${st.id}`));
  assert.deepEqual(batchOf(reduce("prep", [...evs, ...done]), st), { at: 2, of: 3 });
  const champi = plan.steps.find((s) => s.phases?.[0]?.text.startsWith("500 g de champignons"))!;
  const all = champi.phases!.map((_, i) => ev("step_done", `phase:${i}:${champi.id}`));
  // La dernière sous-étape (« Sel ») n'a pas de fournée : on reste sur la dernière.
  assert.deepEqual(batchOf(reduce("prep", [ev("step_start", champi.id), ...all.slice(0, 2)]), champi), { at: 2, of: 2 });
  // Une étape sans fournées n'en affiche pas.
  assert.equal(batchOf(reduce("prep", evs), plan.steps.find((s) => s.phases?.[0]?.text.startsWith("Cocotte vide"))!), null);
});

test("minuteur réglé : le lancement et la durée d'origine sont gardés pour « ↺ »", () => {
  const start = ev("timer_start", "t1", { label: "Riz", minutes: 11, stepId: null, endsAt: "2026-10-21T18:11:00Z" }, "2026-10-21T18:00:00Z");
  const adj = ev("timer_start", "t1", { label: "Riz", minutes: 6, stepId: null, adjust: true, endsAt: "2026-10-21T18:06:00Z" }, "2026-10-21T18:01:00Z");
  let t = reduce("cooking", [start, adj]).timers.get("t1")!;
  assert.equal(t.endsAt, Date.parse("2026-10-21T18:06:00Z"));
  assert.equal(t.startedAt, Date.parse("2026-10-21T18:00:00Z"));
  assert.equal(t.refMinutes, 11);
  // Un nouveau lancement (pas un réglage) repart de zéro.
  const again = ev("timer_start", "t1", { label: "Riz", minutes: 3, stepId: null, endsAt: "2026-10-21T18:05:00Z" }, "2026-10-21T18:02:00Z");
  t = reduce("cooking", [start, adj, again]).timers.get("t1")!;
  assert.equal(t.refMinutes, 3);
  assert.equal(t.startedAt, Date.parse("2026-10-21T18:02:00Z"));
});

test("sous-étapes : les lettres de bols sont renommées comme dans le texte de l'étape", () => {
  const plan = planSession([chasseur, forno], RES);
  const sauce = plan.steps.find((s) => s.recipeSlug === forno.slug && s.phases?.[1]?.text.startsWith("Courgettes"))!;
  // Le texte de l'étape et ses bols portent les lettres de la session ; les sous-étapes aussi.
  const letters = (t: string) => [...t.matchAll(/[Bb]ol ([A-Z])\b/g)].map((m) => m[1]);
  const phaseLetters = sauce.phases!.flatMap((p) => letters(p.text));
  assert.ok(phaseLetters.length >= 3);
  for (const l of phaseLetters) assert.ok(sauce.bowls.includes(l), `bol ${l} de la sous-étape absent des bols de l'étape (${sauce.bowls.join(", ")})`);
});

// ─── Sous-étapes obligatoires (toutes les fiches, l'IA, la base) ───

test("toutes les fiches : chaque étape de cuisson a ses sous-étapes, et elles tiennent dans l'étape", async () => {
  const { phaseIssues } = await import("@/lib/recipes/phases");
  const { RecipeInput } = await import("@/lib/recipes/format");
  const dir = path.join("src/seed/recipes");
  const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 6);
  const problems = files.flatMap((f) =>
    phaseIssues(RecipeInput.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))).map((i) => `${f}, étape ${i.step} (« ${i.text}… ») : ${i.issue}`)
  );
  assert.deepEqual(problems, [], `Écris les sous-étapes (phases) de ces étapes :\n${problems.join("\n")}`);
});

test("sous-étapes obligatoires : une cuisson sans elles, trop longues, ou un bol absent est signalé", async () => {
  const { needsPhases, phaseIssues } = await import("@/lib/recipes/phases");
  assert.equal(needsPhases({ kind: "prep", text: "Bol A", durationMin: 20, activeMin: 20 }), false);
  assert.equal(needsPhases({ kind: "sear", text: "Déglace", durationMin: 1, activeMin: 1 }), false);
  assert.equal(needsPhases({ kind: "bake", text: "Au four", durationMin: 25, activeMin: 1 }), false);
  assert.equal(needsPhases({ kind: "sear", text: "Préchauffe", durationMin: 3, activeMin: 1 }), true);
  assert.equal(needsPhases({ kind: "boil", text: "Riz", durationMin: 20, activeMin: 3 }), true);
  const issues = phaseIssues({
    steps: [
      { kind: "braise", text: "Oignons", durationMin: 10, activeMin: 4 },
      { kind: "sear", text: "Saisie", durationMin: 4, activeMin: 4, bowls: ["A"], phases: [{ text: "Bol B", min: 3 }, { text: "Retourne", min: 2 }] },
      { kind: "sear", text: "Fournées", durationMin: 12, activeMin: 12, phases: [{ text: "500 g", min: 5, batch: 2 }, { text: "500 g", min: 5, batch: 1 }] },
    ],
  }).map((i) => `${i.step}:${i.issue}`);
  assert.ok(issues.some((i) => i.startsWith("1:étape de cuisson sans")));
  assert.ok(issues.some((i) => i.startsWith("2:") && i.includes("plus longues")));
  assert.ok(issues.some((i) => i.startsWith("2:bol B")));
  assert.ok(issues.some((i) => i.startsWith("3:") && i.includes("commencent à 1")));
});

test("filet de sécurité : les sous-étapes découpées dans le texte tiennent dans l'étape", async () => {
  const { fallbackPhases, phaseIssues, withPhases } = await import("@/lib/recipes/phases");
  const step = {
    kind: "braise",
    text: "Cocotte préchauffée vide 3 min à 6, 1 c. à s. d'huile, oignons (bol A) 10 à 12 min au niveau 5. Ail (bol A) 1 min. Sel.",
    durationMin: 16,
    activeMin: 5,
    hobLevel: 5,
    bowls: ["A"],
  };
  const ph = fallbackPhases(step);
  assert.ok(ph.length >= 2);
  assert.ok(ph.reduce((x, p) => x + p.min, 0) <= step.durationMin);
  assert.ok(ph.every((p) => p.min >= 0.5 && p.text.length > 0));
  assert.deepEqual(phaseIssues({ steps: [{ ...step, phases: ph }] }), []);
  // Une étape d'un seul long texte sans durée : deux sous-étapes quand même.
  const one = fallbackPhases({ kind: "sear", text: "Saisis la viande", durationMin: 6, activeMin: 6, hobLevel: 7 });
  assert.equal(one.length, 2);
  assert.ok(one.every((p) => p.hobLevel === 7));
  // withPhases ne touche ni une prep, ni une étape qui a déjà les siennes.
  const { steps, filled } = withPhases<typeof step & { phases?: { text: string; min: number }[] }>([{ kind: "prep", text: "Bol A", durationMin: 10, activeMin: 10, hobLevel: 0, bowls: [] }, step, { ...step, phases: [{ text: "x", min: 1 }, { text: "y", min: 1 }] }]);
  assert.deepEqual(filled, [2]);
  assert.equal(steps[0].phases, undefined);
  assert.equal(steps[2].phases!.length, 2);
});

test("IA : les sous-étapes passent dans le prompt et reviennent normalisées ; oubliées, le code les écrit", async () => {
  const { normalizeRecipe, toAiRecipe } = await import("@/lib/atelier/schema");
  const { RecipeInput } = await import("@/lib/recipes/format");
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync("src/seed/recipes/chasseur-porc.json", "utf8")));
  const ai = toAiRecipe(r);
  const saisie = ai.steps.find((s) => s.phases.some((p) => p.batch === 3))!;
  assert.equal(saisie.phases.length, 9);
  // Durée arrondie à la demi-minute, niveau hors bornes retiré, sous-étape vide écartée.
  saisie.phases[0] = { ...saisie.phases[0], min: 1.2, hobLevel: 12 };
  saisie.phases.push({ text: " ", min: 1, hobLevel: null, batch: null, wait: false });
  const back = normalizeRecipe(ai);
  const s2 = back.steps.find((s) => s.phases?.some((p) => p.batch === 3))!;
  assert.equal(s2.phases!.length, 9);
  assert.deepEqual([s2.phases![0].min, s2.phases![0].hobLevel], [1, null]);
  // L'IA oublie tout : en base, chaque cuisson a quand même ses sous-étapes.
  const bare = normalizeRecipe({ ...ai, slug: "chasseur-sans-phases", steps: ai.steps.map((s) => ({ ...s, phases: [] })) });
  assert.ok(bare.steps.every((s) => s.phases == null));
  const { db } = openDb(":memory:");
  bootstrap(db);
  const { upsertRecipe } = await import("@/lib/recipes/store");
  const { id } = upsertRecipe(db, bare);
  const steps = db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, id)).all();
  const { needsPhases } = await import("@/lib/recipes/phases");
  for (const s of steps) if (needsPhases({ ...s, bowls: s.bowlRefs })) assert.ok(s.phases?.length, `étape ${s.order} sans sous-étapes`);
});

test("base : les étapes de cuisson d'avant (variantes) reçoivent leurs sous-étapes au démarrage", async () => {
  const { backfillPhases } = await import("@/lib/recipes/store");
  const { db } = openDb(":memory:");
  bootstrap(db);
  const r = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, chasseur.slug)).get()!;
  db.update(recipeSteps).set({ phases: null }).where(eq(recipeSteps.recipeId, r.id)).run();
  const n = backfillPhases(db);
  assert.ok(n >= 8, `${n} étapes complétées`);
  assert.equal(backfillPhases(db), 0, "idempotent");
  const steps = db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, r.id)).all();
  assert.ok(steps.filter((s) => s.kind === "prep").every((s) => s.phases == null));
});

test("attente : elle libère l'écran pour la suite, sa fin sonne, puis l'étape repasse devant", async () => {
  const { focusStep, isWaitTimer, waiting } = await import("@/lib/session/state");
  const plan = planSession([chasseur, forno], RES);
  const riz = plan.steps.find((s) => s.text.startsWith("Riz"))!;
  const other = plan.steps.find((s) => s.id !== riz.id && s.kind !== "preheat")!;
  const at = (min: number) => new Date(Date.parse("2026-10-21T18:00:00Z") + min * 60000).toISOString();
  const ids = (n: number) => phaseIds("session-1234", riz.id, n);
  const timer = (n: number, from: number) =>
    ev("timer_start", ids(n).timer, { label: riz.phases![n].text, minutes: riz.phases![n].min, stepId: riz.id, phase: n, endsAt: at(from + riz.phases![n].min) }, at(from));
  const base = [ev("note", null, { status: "cooking" }, at(0)), ev("step_start", riz.id, null, at(0)), timer(0, 0), ev("step_done", `phase:0:${riz.id}`, null, at(0.5)), timer(1, 0.5)];
  let s = reduce("prep", base);
  // Pendant que l'eau chauffe, le riz n'occupe pas l'écran : la suite du plan passe devant.
  assert.ok(waiting(s, riz, Date.parse(at(1))));
  assert.notEqual(focusStep(plan, s, Date.parse(at(1)))?.id, riz.id);
  // On lance une autre étape ; à la fin de l'attente, le minuteur sonne (c'est une attente).
  const withOther = [...base, ev("step_start", other.id, null, at(1))];
  s = reduce("prep", withOther);
  assert.equal(focusStep(plan, s, Date.parse(at(2)))?.id, other.id);
  const t = phaseTimer(s, riz.id, 1)!;
  assert.ok(isWaitTimer(plan, t));
  assert.equal(isWaitTimer(plan, { ...t, phase: 0 }), false, "un geste ne sonne pas");
  // Sonnerie arrêtée : la sous-étape suivante (« Dès que ça bout ») démarre et le riz repasse devant.
  s = reduce("prep", [...withOther, ev("timer_done", ids(1).timer, null, at(5)), ev("step_done", `phase:1:${riz.id}`, null, at(5)), timer(2, 5)]);
  assert.equal(currentPhase(s, riz), 2);
  assert.equal(focusStep(plan, s, Date.parse(at(5.1)))?.id, riz.id);
});

test("attente : une fiche peut en avoir, l'IA les garde", async () => {
  const { normalizeRecipe, toAiRecipe } = await import("@/lib/atelier/schema");
  const { RecipeInput } = await import("@/lib/recipes/format");
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync("src/seed/recipes/pasta-al-forno.json", "utf8")));
  const back = normalizeRecipe(toAiRecipe(r));
  const four = back.steps.find((s) => s.phases?.some((p) => p.text === "Inverse les plats"))!;
  assert.deepEqual(four.phases!.map((p) => p.wait === true), [false, true, false, true, false]);
});
