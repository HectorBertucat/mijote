// Durées réelles : mesures tirées de journaux simulés, corrections prudentes, et plan
// corrigé (src/lib/session/durations.ts, store.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { cookEvents, cookSessions, durationSamples } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import { planSession, type SessionPlan } from "@/lib/session/planner";
import type { SessionEvent } from "@/lib/session/state";
import { cookedEnough, durationsOrigin, implausible, learn, measureSession, plannerInput, sessionReport, type StoredSample } from "@/lib/session/durations";
import { addEvent, buildPlan, createSession, getSession, learnedDurations } from "@/lib/session/store";
import { load, RES } from "./helpers";

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");

/** Un journal qu'on écrit minute par minute. */
function journal(t0: string) {
  let t = Date.parse(t0);
  let n = 0;
  const evs: SessionEvent[] = [];
  const add = (afterMin: number, kind: SessionEvent["kind"], ref: string | null, payload: Record<string, unknown> | null = null) => {
    t += afterMin * 60000;
    evs.push({ id: `e${++n}`, seq: n, at: new Date(t).toISOString(), kind, ref, payload });
  };
  return { evs, add, now: () => t };
}

const ref = (plan: SessionPlan, id: string) => plan.prep.tasks.find((t) => t.id === id)!.minutes;

/** Seul, chasseur : gestes cochés, bols cochés sans leurs gestes, étapes et minuteur. */
function soloJournal(plan: SessionPlan, t0 = "2026-10-18T08:00:00Z", k = 1.5) {
  const j = journal(t0);
  j.add(2, "step_done", "prep:cut-champignon"); // premier geste : on ne sait pas quand il a commencé
  j.add(9, "bowl_ready", "B", { ready: true }); // échalotes, oignon, ail jamais cochés : au prorata
  j.add(ref(plan, "cut-persil") * k, "step_done", "prep:cut-persil");
  j.add(3, "bowl_ready", "E", { ready: true }); // 4 pesées (2 min prévues)
  j.add(4 * k, "step_done", `prep:other-${chasseur.slug}-2`);
  j.add(1, "note", null, { status: "cooking" });
  const step = (order: number) => plan.steps.find((s) => s.id === `${chasseur.slug}#${order}`)!;
  j.add(0, "step_start", step(3).id);
  j.add(step(3).durationMin * 1.2, "step_done", step(3).id);
  j.add(0, "step_start", step(4).id);
  j.add(step(4).durationMin * 1.2, "step_done", step(4).id);
  // Braisage : minuteur de 50 min, arrêté 15 min après la sonnerie.
  j.add(0, "step_start", step(7).id);
  j.add(4, "timer_start", "t7", { label: "Cocotte", minutes: 50, stepId: step(7).id, auto: true, endsAt: new Date(j.now() + 54 * 60000).toISOString() });
  j.add(65, "timer_done", "t7");
  j.add(0, "step_done", step(7).id);
  j.add(1, "step_done", step(12).id); // jamais lancée : pas mesurée
  j.add(1, "note", null, { status: "done" });
  return j.evs;
}

test("mesure seul : geste coché, bol au prorata, pesées, étapes, minuteur arrêté en retard", () => {
  const plan = planSession([chasseur], RES, { interleave: false });
  const s = measureSession(plan, soloJournal(plan), "2026-10-18T08:00:00Z");
  const by = (r: string) => s.filter((x) => x.ref === r);
  assert.equal(by("cut-champignon").length, 0, "le premier geste n'est pas mesuré");
  // Bol B coché sans ses gestes : 9 min partagées entre échalotes, oignon et ail, au prorata des estimations.
  const b = s.filter((x) => x.via === "bol B");
  assert.deepEqual(b.map((x) => x.ref).sort(), ["cut-ail", "cut-echalote", "cut-oignon"]);
  assert.ok(Math.abs(b.reduce((x, y) => x + y.realMin, 0) - 9) < 1e-9);
  assert.ok(Math.abs(b.reduce((x, y) => x + y.weight, 0) - 1) < 1e-9);
  const ratio = 9 / b.reduce((x, y) => x + y.estMin, 0);
  for (const x of b) assert.ok(Math.abs(x.realMin / x.estMin - ratio) < 1e-9);
  // Persil coché : 1,5 fois la référence, mesure nette.
  const persil = by("cut-persil")[0];
  assert.equal(persil.key, "cut:persil");
  assert.equal(persil.weight, 1);
  assert.ok(Math.abs(persil.realMin / persil.estMin - 1.5) < 1e-9);
  assert.ok(persil.grams! > 0);
  // Bol E : quatre pesées en 3 min.
  const weigh = s.find((x) => x.kind === "weigh")!;
  assert.equal(weigh.key, "weigh");
  assert.equal(weigh.units, 4);
  assert.equal(weigh.estMin, 2);
  assert.equal(weigh.realMin, 3);
  // Le sauté tamponné.
  assert.equal(by(`other-${chasseur.slug}-2`)[0].key, `other:${chasseur.slug}-2`);
  // Étapes : 1,2 fois la fiche ; le braisage s'arrête quand le minuteur sonne (4 + 50 min), pas 15 min plus tard.
  const st = (o: number) => s.find((x) => x.ref === `${chasseur.slug}#${o}`);
  assert.ok(Math.abs(st(3)!.realMin / st(3)!.estMin - 1.2) < 1e-9);
  assert.equal(st(4)!.key, `step:${chasseur.slug}#4`);
  assert.equal(st(7)!.realMin, 54);
  assert.equal(st(12), undefined, "étape jamais lancée");
  // Le bilan : prévu / réel par geste et par étape.
  const rep = sessionReport(plan, s);
  const row = rep.gestures.find((r) => r.ref === "cut-oignon")!;
  assert.equal(row.shared, true);
  assert.ok(row.realMin! > 0 && row.perKg! > 0);
  assert.equal(rep.gestures.find((r) => r.ref === "cut-champignon")!.realMin, null);
  assert.ok(rep.gestures.some((r) => r.ref === "weigh" && r.realMin === 3 && r.plannedMin === 2));
  assert.equal(rep.steps.find((r) => r.ref === `${chasseur.slug}#7`)!.realMin, 54);
});

test("mesure seul : les gestes glissés dans la cuisson se mesurent un par sous-étape", () => {
  const plan = planSession([chasseur, load("dahl-pois-casses-poulet.json")], RES);
  const g = plan.steps.find((s) => s.tasks && s.tasks.length >= 2)!;
  assert.ok(g, "un moment de plusieurs gestes dans le fil");
  const j = journal("2026-10-18T08:00:00Z");
  j.add(1, "note", null, { status: "cooking" });
  j.add(0, "step_start", g.id);
  g.tasks!.forEach((t, n) => j.add(t.minutes * 1.5, "step_done", `phase:${n}:${g.id}`));
  j.add(0, "step_done", g.id);
  const s = measureSession(plan, j.evs, "2026-10-18T08:00:00Z");
  for (const t of g.tasks!) {
    const m = s.find((x) => x.ref === t.id)!;
    assert.ok(m, t.id);
    assert.equal(m.kind, t.kind === "weigh" ? "weigh" : "gesture");
    assert.ok(Math.abs(m.realMin / m.plannedMin - 1.5) < 1e-9);
  }
  // Le bilan les range avec les gestes, pas avec les étapes.
  const rep = sessionReport(plan, s);
  const cut = g.tasks!.find((t) => t.kind === "cut");
  if (cut) assert.ok(rep.gestures.some((r) => r.ref === cut.id && r.realMin != null));
  assert.ok(!rep.steps.some((r) => r.ref === g.id));
});

test("mesure à deux : chaque personne a sa marque, le temps actif d'une étape n'est pas compté au geste", () => {
  const plan = planSession([chasseur, forno], RES, { mode: "duo" });
  const [a1, a2] = plan.prep.tasks.filter((t) => t.person === "A");
  const b1 = plan.prep.tasks.find((t) => t.person === "B")!;
  const sear = plan.steps.find((s) => s.activeMin > 2)!;
  const j = journal("2026-10-18T08:00:00Z");
  j.add(0, "note", null, { status: "cooking" }); // « On démarre » : un vrai départ pour A et B
  j.add(a1.minutes * 2, "step_done", `prep:${a1.id}`, { person: "A" });
  j.add(1, "step_done", `prep:${b1.id}`, { person: "B" });
  j.add(0, "step_start", sear.id, { person: "A" }); // A part sur une étape active…
  j.add(sear.activeMin, "step_done", sear.id, { person: "A" }); // … puis revient à la prep
  j.add(a2.minutes, "step_done", `prep:${a2.id}`, { person: "A" });
  const s = measureSession(plan, j.evs, "2026-10-18T07:00:00Z");
  const of = (id: string) => s.find((x) => x.ref === id)!;
  assert.ok(Math.abs(of(a1.id).realMin - a1.minutes * 2) < 1e-9);
  assert.ok(Math.abs(of(b1.id).realMin - (a1.minutes * 2 + 1)) < 1e-9, "B depuis le démarrage");
  assert.ok(Math.abs(of(a2.id).realMin - a2.minutes) < 1e-9, "depuis la fin de l'étape, pas depuis le geste d'avant");
  // Les bols cochés automatiquement à deux ne font pas de mesure.
  assert.ok(s.every((x) => x.via == null));
});

const sample = (sessionId: string, key: string, est: number, real: number, weight = 1, kind: StoredSample["kind"] = "gesture"): StoredSample => ({
  sessionId,
  kind,
  key,
  ref: key,
  label: key,
  grams: 450,
  units: 3,
  estMin: est,
  plannedMin: est,
  realMin: real,
  weight,
  via: null,
  at: `2026-10-${10 + Number(sessionId.slice(1))}T10:00:00Z`,
});

test("corrections prudentes : une mesure aberrante ne change rien, deux mesures d'accord comptent à moitié", () => {
  // Une seule mesure, trois fois la référence : rien ne change.
  let c = learn([sample("s1", "cut:oignon", 6, 18)]).get("cut:oignon")!;
  assert.equal(c.factor, 1);
  assert.equal(c.ignored[0].why, "mesure seule, trop loin de la référence");
  // Hors bornes (pause, oubli de toucher) : écartée.
  c = learn([sample("s1", "cut:oignon", 6, 40), sample("s2", "cut:oignon", 6, 7.8)]).get("cut:oignon")!;
  assert.equal(c.ignored.length, 1);
  assert.match(c.ignored[0].why, /hors bornes/);
  assert.equal(c.n, 1);
  assert.equal(c.factor, Math.round(1.3 ** (1 / 3) * 100) / 100); // la référence compte pour 2
  // Deux mesures à 1,3 : la moitié de l'écart (en log), soit ×1,14.
  c = learn([sample("s1", "cut:oignon", 6, 7.8), sample("s2", "cut:oignon", 6, 7.8)]).get("cut:oignon")!;
  assert.equal(c.factor, 1.14);
  assert.deepEqual(c.sessions.sort(), ["s1", "s2"]);
  // Deux mesures à ×2,5 qui se confirment : plafonné à ×1,6 pour un geste, ×1,35 pour une étape.
  c = learn([sample("s1", "cut:ail", 3, 7.5), sample("s2", "cut:ail", 3, 7.5), sample("s3", "cut:ail", 3, 7.5)]).get("cut:ail")!;
  assert.equal(c.factor, 1.6);
  const st = learn([1, 2, 3, 4].map((i) => sample(`s${i}`, "step:x#4", 20, 40, 1, "step"))).get("step:x#4")!;
  assert.equal(st.factor, 1.35);
  // À partir de 3 mesures, celle qui s'écarte de la médiane est écartée.
  c = learn([sample("s1", "cut:persil", 4, 4.8), sample("s2", "cut:persil", 4, 5), sample("s3", "cut:persil", 4, 14)]).get("cut:persil")!;
  assert.equal(c.n, 2);
  assert.equal(c.ignored[0].why, "loin des autres mesures");
  // Une mesure partagée (part d'un bol) pèse sa part ; écart sous 3 % : aucune correction.
  c = learn([sample("s1", "cut:echalote", 4, 4.08, 0.4)]).get("cut:echalote")!;
  assert.equal(c.factor, 1);
  // Même session, même aliment (veille et jour J) : une seule mesure.
  c = learn([sample("s1", "cut:oignon", 3, 3.9), sample("s1", "cut:oignon", 3, 3.9)]).get("cut:oignon")!;
  assert.equal(c.n, 1);
});

test("plan corrigé : minutes du geste et de l'étape, référence gardée, origine affichée", () => {
  const corr = learn([
    sample("s1", "cut:oignon", 3, 3.9),
    sample("s2", "cut:oignon", 3, 3.9),
    sample("s1", `step:${chasseur.slug}#4`, 24, 30, 1, "step"),
    sample("s2", `step:${chasseur.slug}#4`, 24, 30, 1, "step"),
  ]);
  const input = plannerInput(corr, 2);
  const base = planSession([chasseur, forno], RES, { interleave: false });
  const plan = planSession([chasseur, forno], RES, { durations: input, interleave: false });
  const o0 = base.prep.tasks.find((t) => t.id === "cut-oignon")!;
  const o1 = plan.prep.tasks.find((t) => t.id === "cut-oignon")!;
  assert.equal(o1.refMinutes, o0.minutes);
  assert.equal(o1.minutes, Math.round(o0.minutes * 1.14 * 2) / 2);
  const s0 = base.steps.find((s) => s.id === `${chasseur.slug}#4`)!;
  const s1 = plan.steps.find((s) => s.id === `${chasseur.slug}#4`)!;
  assert.equal(s1.refDurationMin, s0.durationMin);
  assert.equal(s1.durationMin, Math.round(18 * 1.12));
  assert.equal(s1.activeMin, s1.durationMin, "saisie tout en action : le temps actif suit");
  assert.ok(plan.prep.minutes >= base.prep.minutes);
  assert.equal(plan.durations!.sessions, 2);
  assert.equal(plan.durations!.window, 2);
  assert.deepEqual(plan.durations!.applied.map((a) => a.key).sort(), ["cut:oignon", `step:${chasseur.slug}#4`].sort());
  const origin = durationsOrigin(plan);
  assert.equal(origin.text, "Durées corrigées d'après tes 2 dernières sessions");
  assert.ok(origin.detail.some((d) => d.startsWith("Oignon")));
  // Les mesures d'une session corrigée se font contre la référence, pas contre l'estimation corrigée.
  const m = measureSession(plan, soloJournal(plan), "2026-10-18T08:00:00Z").find((x) => x.ref === "cut-oignon")!;
  assert.equal(m.estMin, o0.minutes);
  // Sans session terminée : durées de référence.
  assert.match(durationsOrigin(planSession([chasseur], RES, { durations: { factors: {}, sessions: 0 } })).text, /pas encore de session terminée/);
  // Prep la veille : la correction suit les deux moitiés d'un geste partagé.
  const v = planSession([chasseur, forno], RES, { mode: "veille", durations: input });
  assert.ok(v.prep.tasks.filter((t) => t.id.startsWith("cut-oignon")).every((t) => t.refMinutes != null));
});

test("en base : une session terminée enregistre ses mesures, la suivante est corrigée ; rouvrir les retire", () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const simulate = (t0: string) => {
    const id = createSession(db, { slugs: [chasseur.slug], mode: "solo", durations: false, interleave: false });
    db.update(cookSessions).set({ startedAt: t0 }).where(eq(cookSessions.id, id)).run();
    const plan = getSession(db, id)!.plan;
    const evs = soloJournal(plan, t0).slice(0, -1); // sans la note « terminée »
    for (const e of evs) db.insert(cookEvents).values({ id: `${id}-${e.id}`, sessionId: id, at: e.at, kind: e.kind, ref: e.ref, payloadJson: e.payload }).run();
    addEvent(db, id, { kind: "note", payload: { status: "done" } });
    return id;
  };
  const s1 = simulate("2026-10-11T08:00:00Z");
  const n1 = db.select().from(durationSamples).where(eq(durationSamples.sessionId, s1)).all();
  assert.ok(n1.length >= 8, `${n1.length} mesures`);
  assert.ok(n1.some((r) => r.key === "cut:persil" && r.weight === 1));
  // Une session : le persil (×1,5) change d'un tiers de l'écart ; les étapes ×1,2 aussi.
  let learned = learnedDurations(db);
  assert.equal(learned.sessions.length, 1);
  assert.equal(learned.input.factors["cut:persil"].factor, Math.round(1.5 ** (1 / 3) * 100) / 100);
  simulate("2026-10-18T08:00:00Z");
  learned = learnedDurations(db);
  assert.equal(learned.input.sessions, 2);
  assert.equal(learned.input.factors["cut:persil"].factor, Math.round(1.5 ** 0.5 * 100) / 100);
  const plan = buildPlan(db, { slugs: [chasseur.slug, forno.slug], mode: "duo" });
  assert.equal(durationsOrigin(plan).text, "Durées corrigées d'après tes 2 dernières sessions");
  const persil = plan.prep.tasks.find((t) => t.id === "cut-persil")!;
  assert.ok(persil.minutes > persil.refMinutes!);
  // Rouvrir la session : ses mesures sortent des corrections.
  addEvent(db, s1, { kind: "note", payload: { status: "cooking" } });
  assert.equal(db.select().from(durationSamples).where(eq(durationSamples.sessionId, s1)).all().length, 0);
  assert.equal(learnedDurations(db).sessions.length, 1);
});

/** Terminée dès la prep : des gestes cochés à la file pour passer, puis « Terminer ». */
function earlyJournal(plan: SessionPlan, t0 = "2026-10-20T08:00:00Z") {
  const j = journal(t0);
  j.add(0, "note", null, { status: "prep" });
  j.add(1, "step_done", "prep:cut-champignon");
  j.add(0.6, "step_done", "prep:cut-persil"); // dans les bornes, mais rien ne dit que c'est une durée
  j.add(0.1, "bowl_ready", "B", { ready: true });
  j.add(0.05, "bowl_ready", "E", { ready: true });
  j.add(0.5, "note", null, { status: "done" });
  return j.evs;
}

test("fin anticipée : terminée dès la prep, la session n'apprend rien ; réouverte ou abandonnée non plus", () => {
  const plan = planSession([chasseur], RES, { interleave: false });
  assert.equal(cookedEnough(plan, soloJournal(plan)), true);
  assert.equal(cookedEnough(plan, earlyJournal(plan)), false);
  // Une étape « faite » sans avoir été lancée (cochée pour finir) ne compte pas comme cuisinée.
  const j = journal("2026-10-20T08:00:00Z");
  j.add(0, "note", null, { status: "cooking" });
  j.add(1, "step_done", `${chasseur.slug}#3`);
  j.add(1, "note", null, { status: "done" });
  assert.equal(cookedEnough(plan, j.evs), false);
  // Réouverte après « terminée » : pas encore finie.
  const reopened = [...soloJournal(plan), { id: "x1", seq: 999, at: "2026-10-18T12:00:00Z", kind: "note" as const, ref: null, payload: { status: "cooking" } }];
  assert.equal(cookedEnough(plan, reopened), false);
  const abandoned = soloJournal(plan).map((e) => (e.payload?.status === "done" ? { ...e, payload: { status: "abandoned" } } : e));
  assert.equal(cookedEnough(plan, abandoned), false);
});

test("mesures invraisemblables : cochée en passant, trop longue, part d'un bol jugée sur le bol entier", () => {
  assert.equal(implausible({ estMin: 0.5, realMin: 0.2, weight: 1 }), "coché en passant");
  assert.equal(implausible({ estMin: 0.5, realMin: 0.3, weight: 1 }), null);
  // Part d'un bol coché en 1 min : 0,2 min pour cette part, mais l'intervalle (1 min) est une vraie mesure.
  assert.equal(implausible({ estMin: 0.6, realMin: 0.2, weight: 0.2 }), null);
  assert.equal(implausible({ estMin: 0.04, realMin: 0.02, weight: 0.2 }), "coché en passant");
  assert.equal(implausible({ estMin: 90, realMin: 300, weight: 1 }), "trop long (oubli de toucher ?)");
  assert.match(implausible({ estMin: 6, realMin: 30, weight: 1 })!, /hors bornes/);
  assert.equal(implausible({ estMin: 0, realMin: 3, weight: 1 }), "mesure invalide");
  // Des pesées cochées à la file (session après session) ne font plus baisser la référence.
  const c = learn([1, 2, 3].map((i) => sample(`s${i}`, "weigh", 0.5, 0.2, 1, "weigh"))).get("weigh")!;
  assert.equal(c.factor, 1);
  assert.equal(c.n, 0);
  assert.ok(c.ignored.every((x) => x.why === "coché en passant"));
});

test("en base : une session terminée dès la prep n'enregistre rien, et d'anciennes mesures faussées sont ignorées", () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const insert = (id: string, evs: SessionEvent[]) => {
    for (const e of evs) db.insert(cookEvents).values({ id: `${id}-${e.id}`, sessionId: id, at: e.at, kind: e.kind, ref: e.ref, payloadJson: e.payload }).run();
  };
  // Une vraie session, il y a une semaine.
  const real = createSession(db, { slugs: [chasseur.slug], mode: "solo", durations: false, interleave: false });
  db.update(cookSessions).set({ startedAt: "2026-10-11T08:00:00Z" }).where(eq(cookSessions.id, real)).run();
  insert(real, soloJournal(getSession(db, real)!.plan, "2026-10-11T08:00:00Z").slice(0, -1));
  addEvent(db, real, { kind: "note", payload: { status: "done" } });
  const before = learnedDurations(db).input;
  // Terminée dès la prep : rien d'enregistré, elle ne prend pas de place dans la fenêtre.
  const early = createSession(db, { slugs: [chasseur.slug], mode: "solo", durations: false, interleave: false });
  insert(early, earlyJournal(getSession(db, early)!.plan).slice(0, -1));
  addEvent(db, early, { kind: "note", payload: { status: "done" } });
  assert.equal(db.select().from(durationSamples).where(eq(durationSamples.sessionId, early)).all().length, 0);
  let learned = learnedDurations(db);
  assert.deepEqual(learned.sessions, [real]);
  assert.deepEqual(learned.input, before);
  // Des mesures faussées enregistrées avant la règle (pesées et persil à toute vitesse) : en base, mais ignorées.
  for (const [key, kind, est, realMin] of [["weigh", "weigh", 2, 0.6], ["cut:persil", "gesture", 2, 0.6]] as const)
    db.insert(durationSamples)
      .values({ id: `${early}-${key}`, sessionId: early, at: new Date().toISOString(), kind, key, ref: key, label: key, grams: null, units: null, estMin: est, plannedMin: est, realMin, weight: 1, via: null })
      .run();
  learned = learnedDurations(db);
  assert.deepEqual(learned.sessions, [real]);
  assert.deepEqual(learned.input, before);
  assert.equal(db.select().from(durationSamples).where(eq(durationSamples.sessionId, early)).all().length, 2, "les données ne sont pas modifiées");
});

test("fiche réimportée en pleine session : le plan est refait, le journal gardé", async () => {
  const { replanSessionsFor } = await import("@/lib/session/store");
  const { upsertRecipe } = await import("@/lib/recipes/store");
  const { db } = openDb(":memory:");
  bootstrap(db);
  const id = createSession(db, { slugs: [chasseur.slug, forno.slug], durations: false });
  addEvent(db, id, { kind: "note", payload: { status: "cooking" } });
  const before = getSession(db, id)!.plan;
  const fs = await import("fs");
  const raw = JSON.parse(fs.readFileSync("src/seed/recipes/pasta-al-forno.json", "utf8"));
  upsertRecipe(db, { ...raw, name: "Forno corrigé" });
  assert.deepEqual(replanSessionsFor(db, ["autre-recette"]), []);
  assert.deepEqual(replanSessionsFor(db, [forno.slug]), [id]);
  const after = getSession(db, id)!.plan;
  assert.equal(after.recipes.find((r) => r.slug === forno.slug)!.name, "Forno corrigé");
  assert.deepEqual(after.recipes.map((r) => r.scale), before.recipes.map((r) => r.scale));
  assert.ok(db.select().from(cookEvents).where(eq(cookEvents.sessionId, id)).all().length >= 2);
});
