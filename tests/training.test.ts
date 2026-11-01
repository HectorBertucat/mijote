// Entraînement : tempo exact des figures, squelette (membres de longueur fixe, rien sous le sol),
// déroulé des séances et carnet (src/lib/training/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOTIONS } from "@/lib/training/figures";
import { cycleDuration, sample } from "@/lib/training/motion";
import { BONES, dist } from "@/lib/training/skeleton";
import { buildSteps, EXERCISES, KB_TEMPLATE, lastFor, nextType, ORDER, ready, withBonus, type Workout } from "@/lib/training/program";
import { assignProgram, exerciseLookup, programById, programFor, TEMPLATES } from "@/lib/training/programs";
import { generateProgram, sessionMinutes } from "@/lib/training/generate";
import { available, LIBRARY, META } from "@/lib/training/library";
import { checkMotion } from "@/lib/training/motion-check";
import { fromAiMotion, replaceBad, verifyAiProgram } from "@/lib/training/ai";

const P = { ...KB_TEMPLATE, id: "kb12", people: ["alex"] };
import { openDb } from "@/lib/db/open";
import { seedTest } from "./helpers";
import { listWorkouts, saveWorkout } from "@/lib/training/store";
import { sessionMap } from "@/components/sante/training/LiveSession";
import { act, DEFAULT_OPTS, entriesOf, guideAt, leadFor, normOpts, startLive } from "@/lib/training/live";
import { musclesFromText, musclesOf, ranked } from "@/lib/training/muscles";
import { drawFigure } from "@/lib/training/draw";

import { activeLive, createDuo, createLive, endLive, getLive, guideOpts, writeLive } from "@/lib/training/live-store";

test("chaque exercice du programme a sa figure animée", () => {
  for (const id of ORDER) assert.ok(MOTIONS[id], id);
});

test("le tempo affiché est celui que joue la figure", () => {
  const durs = (id: string) => MOTIONS[id].steps.map((s) => s.dur);
  assert.deepEqual(durs("goblet"), [3, 1, 1, 0.4]); // 3 s en bas · 1 s pause
  assert.deepEqual(durs("row").slice(0, 3), [1, 1, 2]); // pause 1 s en haut
  assert.deepEqual(durs("rowPause").slice(0, 3), [1, 2, 3]); // pause 2 s + descente 3 s
  assert.equal(durs("rdl")[0], 3); // descente 3 s
  for (const id of ["pushup", "bulgare"]) assert.equal(durs(id)[0], 2, id);
  for (const id of ["curl", "triceps", "press"]) assert.ok(MOTIONS[id].steps.some((s) => s.dur === 2 && /descend/i.test(s.label)), id);
  assert.equal(durs("floorpress")[0], 1); // pause 1 s coude au sol
  assert.ok(cycleDuration(MOTIONS.swing) * 10 < 15, "10 swings tiennent dans la moitié d'un tour de 30 s");
});

test("sample : phase, décompte et répétitions suivent la même horloge", () => {
  const m = MOTIONS.goblet;
  assert.equal(sample(m, 0.5).label, "Descends");
  assert.equal(Math.ceil(sample(m, 0.5).remaining), 3);
  assert.equal(sample(m, 3.5).label, "Tiens en bas");
  assert.equal(sample(m, 4.5).label, "Remonte fort");
  assert.equal(sample(m, 5.39).rep, 0);
  assert.equal(sample(m, 5.41).rep, 1);
  assert.equal(sample(m, 5.4 * 12 + 0.01).rep, 12);
});

test("squelette : membres de longueur fixe, appuis posés, rien sous le sol", () => {
  const pairs: [string, string, number][] = [
    ["hip", "shoulder", BONES.torso],
    ["hip", "kneeN", BONES.thigh],
    ["kneeN", "ankleN", BONES.shin],
    ["hip", "kneeF", BONES.thigh],
    ["kneeF", "ankleF", BONES.shin],
    ["shoulder", "elbowN", BONES.upper],
    ["elbowN", "handN", BONES.fore],
    ["shoulder", "elbowF", BONES.upper],
    ["elbowF", "handF", BONES.fore],
  ];
  for (const [id, m] of Object.entries(MOTIONS)) {
    const T = cycleDuration(m);
    for (let i = 0; i <= 60; i++) {
      const { skel } = sample(m, (T * i) / 60);
      for (const [a, b, l] of pairs) {
        const d = dist(skel[a as keyof typeof skel], skel[b as keyof typeof skel]);
        assert.ok(Math.abs(d - l) < 1.5, `${id} t=${i}/60 ${a}-${b} = ${d.toFixed(1)} au lieu de ${l}`);
      }
      for (const [j, p] of Object.entries(skel)) assert.ok(p[1] <= 188, `${id} t=${i}/60 : ${j} sous le sol (${p[1].toFixed(1)})`);
      assert.ok(skel.head[1] >= -22 + 11, `${id} : tête hors cadre`);
      for (const [j, p] of Object.entries(skel)) assert.ok(p[1] >= -22 && p[0] >= 0 && p[0] <= 200, `${id} : ${j} hors cadre`);
    }
  }
});

test("séance A : supersets, repos de 60 s puis 90 s entre blocs, gainage proposé", () => {
  const s = buildSteps(P, "A");
  assert.equal(s[0].k, "warm");
  assert.equal(s.filter((x) => x.k === "ex").length, 3 * 2 + 3 * 2 + 2 * 2);
  const rests = s.filter((x) => x.k === "rest").map((x) => (x.k === "rest" ? x.sec : 0));
  assert.deepEqual(rests, [60, 60, 90, 60, 60, 90, 45]);
  assert.equal(s.at(-2)?.k, "bonus");
  const b = withBonus(P, s, s.length - 2);
  assert.equal(b.filter((x) => x.k === "ex" && (x.ex === "deadbug" || x.ex === "plank")).length, 4);
  assert.equal(b.at(-1)?.k, "end");
});

test("séance B : finisher swings 8 × 10 toutes les 30 s", () => {
  const e = buildSteps(P, "B").find((x) => x.k === "emom");
  assert.deepEqual(e && e.k === "emom" ? [e.rounds, e.every, e.reps] : null, [8, 30, 10]);
});

test("carnet : dernière fois, prêt à monter, A/B alternées", () => {
  const w = (date: string, type: string, entries: Workout["entries"]): Workout => ({ id: date, date, ts: Date.parse(date), type, minutes: 30, note: null, entries });
  const list = [w("2026-10-19", "A", [{ ex: "goblet", sets: [20, 20, 20], level: 0 }, { ex: "row", sets: [15, 14, 15], level: 0 }]), w("2026-10-07", "A", [{ ex: "row", sets: [15, 15, 15], level: 0 }])];
  assert.deepEqual(lastFor(list, "row")?.sets, [15, 14, 15]);
  assert.equal(ready(P, list, "goblet"), true);
  assert.equal(ready(P, list, "row"), false);
  assert.equal(nextType(P, list), "B");
  assert.equal(nextType(P, []), "A");
});

test("carnet en base : les 5 séances de l'artifact sont reprises, une séance s'enregistre", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  seedTest(db);
  const before = listWorkouts(db, "alex");
  assert.equal(before.length, 5);
  assert.equal(before[0].date, "2026-10-19");
  assert.equal(nextType(P, before), "B");
  const id = saveWorkout(db, "alex", { type: "B", minutes: 33, note: " ", entries: [{ ex: "press", sets: [7, 7, 6], level: 0 }, { ex: "inconnu", sets: [1], level: 0 }, { ex: "swing", sets: [], level: 0 }] });
  assert.ok(id);
  const after = listWorkouts(db, "alex");
  assert.equal(after.length, 6);
  assert.deepEqual(after[0].entries, [{ ex: "press", sets: [7, 7, 6], level: 0 }]);
  assert.equal(after[0].note, null);
  assert.equal(saveWorkout(db, "alex", { type: "A", minutes: 1, note: "", entries: [] }), null);
  assert.equal(EXERCISES.plank.unit, "s");
});

test("registre : chaque personne trouve son programme, chaque exercice de séance existe et a sa figure", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  assert.equal(programFor(db, "alex")?.id, "kb12");
  assert.equal(programFor(db, "personne"), null);
  const findExercise = exerciseLookup(db);
  assert.equal(findExercise("plank")?.unit, "s");
  assert.equal(findExercise("inconnu"), null);
  // Un nouveau programme archive l'ancien, le carnet reste.
  const next = assignProgram(db, "alex", TEMPLATES[0], "modele");
  assert.equal(programFor(db, "alex")?.id, next.id);
  assert.equal(listWorkouts(db, "alex").length, 5);
  assert.equal(ready(P, [{ id: "x", date: "2026-10-19", ts: 0, type: "B", minutes: 30, note: null, entries: [{ ex: "swing", sets: [80, 80], level: 0 }] }], "swing"), false);
  for (const s of Object.values(P.sessions)) for (const b of s.blocks) for (const ex of b.items) {
    assert.ok(P.exercises[ex], ex);
    assert.ok(MOTIONS[ex], ex);
  }
});

test("carte de la séance : blocs dans l'ordre, séries faites, tour et bloc en cours", () => {
  const steps = buildSteps(P, "A");
  const atStart = sessionMap(steps, 0);
  assert.deepEqual(atStart.map((b) => b.label), ["Bloc 1", "Bloc 2", "Finisher bras"]);
  assert.deepEqual(atStart.map((b) => b.total), [6, 6, 4]);
  assert.equal(atStart[0].current, true);
  // Après le premier superset et son repos : 2 séries faites, tour 2 du bloc 1.
  const i = steps.findIndex((s, j) => j > 0 && s.k === "ex" && s.set === 2);
  const m = sessionMap(steps, i);
  assert.equal(m[0].done, 2);
  assert.equal(m[0].set, 2);
  assert.equal(m[1].current, false);
});

test("programme de Sam : ses deux séances, ses figures, ses consignes pas à pas, rien de partagé avec Alex", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const J = programFor(db, "sam");
  assert.equal(J?.id, "sam-renfo");
  const findExercise = exerciseLookup(db);
  assert.deepEqual(Object.keys(J!.sessions), ["A", "B"]);
  assert.equal(nextType(J!, []), "A");
  for (const id of J!.order) {
    const e = J!.exercises[id];
    assert.ok(e, id);
    assert.ok(MOTIONS[id], `${id} : figure`);
    assert.ok(e.guide?.position && e.guide.movement && e.guide.feel && e.guide.easier, `${id} : consignes`);
    assert.ok(!Object.hasOwn(EXERCISES, id), `${id} : même id qu'un exercice d'Alex`);
  }
  for (const s of Object.values(J!.sessions)) for (const b of s.blocks) for (const ex of b.items) assert.ok(J!.order.includes(ex), ex);
  const a = buildSteps(J!, "A");
  assert.equal(a.filter((x) => x.k === "ex").length, 3 * 2 + 3 * 2 + 2 * 2);
  assert.ok(!a.some((x) => x.k === "bonus"), "pas de gainage proposé en plus : la fin de séance en est déjà");
  assert.equal(findExercise("jPlank")?.unit, "s");
});

test("séance partagée : gestes, étape gardée, repos qui démarre seul, rythme guidé déduit de l'heure", () => {
  const t0 = 1_000_000;
  let l = startLive(P, "A", t0);
  assert.equal(l.steps[l.i].k, "warm");
  l = act(P, l, { k: "go", at: 0, n: 1 }, t0 + 1000);
  assert.equal(l.i, 1);
  // Un geste fait sur une étape déjà passée (autre écran plus lent) ne fait rien.
  assert.equal(act(P, l, { k: "go", at: 0, n: 1 }, t0 + 1100), l);
  l = act(P, l, { k: "record", at: 1, ex: "goblet", set: 1, value: 15 }, t0 + 60_000);
  l = act(P, l, { k: "record", at: 2, ex: "row", set: 1, value: 12 }, t0 + 120_000);
  assert.equal(l.steps[l.i].k, "rest");
  assert.equal(l.cur.restEnd, t0 + 120_000 + 60_000);
  l = act(P, l, { k: "rest+", at: l.i, sec: 15 }, t0 + 121_000);
  assert.equal(l.cur.restEnd, t0 + 195_000);
  l = act(P, l, { k: "correct", ex: "goblet", set: 1, value: 16 }, t0 + 122_000);
  assert.deepEqual(l.log.goblet, [16]);
  l = act(P, l, { k: "go", at: l.i, n: 1 }, t0 + 130_000);
  assert.deepEqual(l.cur, {});
  l = act(P, l, { k: "guide", at: l.i, on: true, reps: 12 }, t0 + 131_000);
  assert.equal(l.cur.guide, t0 + 131_000 + DEFAULT_OPTS.lead * 1000, "le rythme part après la mise en place");
  assert.equal(l.cur.reps, 12);
  assert.deepEqual(entriesOf(l).map((e) => [e.ex, e.sets]), [["goblet", [16]], ["row", [12]]]);
});

test("rythme guidé : mise en place, pause qui fige tout, reprise décalée", () => {
  const t0 = 2_000_000;
  let l = startLive(P, "A", t0, { auto: false, lead: 5, change: 12 });
  l = act(P, l, { k: "go", at: 0, n: 1 }, t0);
  l = act(P, l, { k: "guide", at: 1, on: true, reps: 10 }, t0 + 1000);
  assert.equal(l.cur.guide, t0 + 6000);
  assert.equal(guideAt((t0 + 3000 - l.cur.guide!) / 1000, 30, false).phase, "ready");
  // 5 s de plus pendant la mise en place, puis « Go » : part tout de suite, jamais dans le passé.
  l = act(P, l, { k: "lead+", at: 1, sec: 5 }, t0 + 2000);
  assert.equal(l.cur.guide, t0 + 11_000);
  l = act(P, l, { k: "lead+", at: 1, sec: -3600 }, t0 + 4000);
  assert.equal(l.cur.guide, t0 + 4000);
  assert.equal(act(P, l, { k: "lead+", at: 1, sec: 5 }, t0 + 5000), l, "rien une fois la série lancée");
  // Pause de 20 s : le départ du rythme recule d'autant.
  l = act(P, l, { k: "pause", at: 1 }, t0 + 10_000);
  assert.equal(l.cur.paused, t0 + 10_000);
  assert.equal(act(P, l, { k: "pause", at: 1 }, t0 + 12_000), l);
  l = act(P, l, { k: "resume", at: 1 }, t0 + 30_000);
  assert.equal(l.cur.paused, undefined);
  assert.equal(l.cur.guide, t0 + 24_000);
  // Repos en pause : la fin du repos recule aussi.
  l = act(P, l, { k: "record", at: 1, ex: "goblet", set: 1, value: 10 }, t0 + 60_000);
  l = act(P, l, { k: "record", at: 2, ex: "row", set: 1, value: 10 }, t0 + 90_000);
  const end = l.cur.restEnd!;
  l = act(P, l, { k: "pause", at: l.i }, t0 + 100_000);
  l = act(P, l, { k: "resume", at: l.i }, t0 + 107_000);
  assert.equal(l.cur.restEnd, end + 7000);
});

test("mode automatique : chaque série démarre seule, plus de temps pour changer d'exercice", () => {
  const t0 = 3_000_000;
  let l = startLive(P, "A", t0, { auto: true, lead: 4, change: 15 });
  l = act(P, l, { k: "go", at: 0, n: 1 }, t0);
  assert.equal(l.steps[1].k, "ex");
  assert.equal(l.cur.guide, t0 + 4000, "première série : la mise en place");
  l = act(P, l, { k: "record", at: 1, ex: "goblet", set: 1, value: 12 }, t0 + 60_000);
  assert.equal(leadFor(l, 2), 15);
  assert.equal(l.cur.guide, t0 + 75_000, "superset : le temps de changer d'exercice");
  l = act(P, l, { k: "record", at: 2, ex: "row", set: 1, value: 12 }, t0 + 120_000);
  assert.equal(l.steps[l.i].k, "rest");
  l = act(P, l, { k: "go", at: l.i, n: 1 }, t0 + 180_000);
  assert.equal(l.cur.guide, t0 + 184_000, "après un repos : la mise en place seulement");
  // Passer en manuel puis en automatique sur une série pas lancée la lance.
  let m = startLive(P, "A", t0);
  m = act(P, m, { k: "go", at: 0, n: 1 }, t0);
  assert.equal(m.cur.guide, undefined);
  m = act(P, m, { k: "opts", opts: { auto: true } }, t0 + 1000);
  assert.equal(m.cur.guide, t0 + 1000 + DEFAULT_OPTS.lead * 1000);
  assert.deepEqual(normOpts({ auto: "oui", lead: 99, change: -3 }), { auto: false, lead: 30, change: 0 });
});

test("rythme guidé : côté 1, pause de 5 s, côté 2, fini", () => {
  assert.equal(guideAt(-2, 10, false).phase, "ready");
  assert.deepEqual(guideAt(3, 10, false), { phase: "run", side: 1, t: 3 });
  assert.equal(guideAt(10, 10, false).phase, "done");
  assert.equal(guideAt(12, 10, true).phase, "switch");
  assert.deepEqual(guideAt(17, 10, true), { phase: "run", side: 2, t: 2 });
  assert.equal(guideAt(25, 10, true).phase, "done");
});

test("séance partagée en base : un seul écran gagne une version, fin enregistrée une fois", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const row = createLive(db, "alex", "kb12", "B", 1000)!;
  assert.ok(row);
  assert.equal(activeLive(db, "alex", 2000)?.id, row.id);
  assert.equal(createLive(db, "alex", "kb12", "Z"), null);
  const next = act(P, row.live, { k: "go", at: 0, n: 1 }, 1500);
  assert.equal(writeLive(db, row.id, 1, next, 1500).ok, true);
  const late = writeLive(db, row.id, 1, next, 1600);
  assert.equal(late.ok, false);
  assert.equal(late.row?.version, 2);
  const done = act(P, next, { k: "record", at: 1, ex: "bulgare", set: 1, value: 9 }, 2000);
  writeLive(db, row.id, 2, done, 2000);
  const before = listWorkouts(db, "alex").length;
  assert.equal(endLive(db, row.id, { note: "" }, 3000).ok, true);
  assert.equal(endLive(db, row.id, { note: "" }, 3100).ok, true); // deuxième écran : pas de doublon
  assert.equal(listWorkouts(db, "alex").length, before + 1);
  assert.equal(activeLive(db, "alex", 4000), null);
  // Une séance oubliée depuis plus de 6 h ne reprend pas.
  const old = createLive(db, "alex", "kb12", "A", 10_000)!;
  assert.ok(old);
  assert.equal(activeLive(db, "alex", 10_000 + 7 * 3600_000), null);
});

test("séance à deux : deux séances liées, chacune son programme et sa fin", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  assert.equal(createDuo(db, { personId: "alex", programId: "kb12", type: "A" }, { personId: "alex", programId: "kb12", type: "B" }), null);
  assert.equal(createDuo(db, { personId: "alex", programId: "kb12", type: "A" }, { personId: "sam", programId: "kb12", type: "A" }), null);
  const [h, j] = createDuo(db, { personId: "alex", programId: "kb12", type: "B" }, { personId: "sam", programId: "sam-renfo", type: "A" }, 1000)!;
  assert.equal(h.live.pair, j.id);
  assert.equal(getLive(db, j.id)?.live.pair, h.id);
  assert.equal(activeLive(db, "sam", 2000)?.live.program, "sam-renfo");
  // Le lien ne se perd pas en route : un écran ne peut pas l'effacer.
  assert.equal(writeLive(db, h.id, 1, { ...h.live, pair: undefined }, 1500).ok, false);
  assert.equal(writeLive(db, h.id, 1, act(P, h.live, { k: "go", at: 0, n: 1 }, 1500), 1500).ok, true);
  // L'une finit, l'autre continue.
  endLive(db, j.id, null, 3000);
  assert.equal(getLive(db, j.id)?.ended, true);
  assert.equal(activeLive(db, "alex", 3000)?.id, h.id);
});

// ─── Bibliothèque, générateur, figures inventées ───

test("bibliothèque : chaque exercice a sa fiche, son matériel et une figure que le vérificateur accepte", () => {
  for (const id of Object.keys(META)) {
    assert.ok(LIBRARY[id], `${id} : fiche`);
    assert.ok(MOTIONS[id], `${id} : figure`);
    assert.deepEqual(checkMotion(MOTIONS[id]), [], `${id} : ${checkMotion(MOTIONS[id]).join(" ; ")}`);
  }
  assert.ok(available([]).every((id) => META[id].gear.length === 0));
  assert.ok(available(["kettlebell", "canape"]).includes("bulgare"));
});

test("générateur : deux séances faisables avec le matériel, qui tiennent dans le temps demandé", () => {
  for (const gear of [[], ["kettlebell"], ["halteres", "chaise", "bande", "miniBande"]] as const) {
    for (const level of [1, 2, 3] as const) {
      const p = generateProgram({ gear: [...gear], perWeek: 3, minutes: 30, level, focus: "equilibre" }, "g");
      const ok = new Set(available([...gear]));
      assert.deepEqual(Object.keys(p.sessions), ["A", "B"]);
      for (const s of Object.values(p.sessions)) {
        assert.ok(s.blocks.length >= 2, `${gear.join("+")} niveau ${level} : ${s.blocks.length} blocs`);
        for (const b of s.blocks) for (const ex of b.items) assert.ok(ok.has(ex), `${ex} sans le matériel`);
        assert.ok(sessionMinutes(p, s) <= 40, `${sessionMinutes(p, s)} min`);
        const items = s.blocks.flatMap((b) => b.items);
        assert.equal(new Set(items).size, items.length, "pas deux fois le même exercice dans une séance");
      }
      for (const ex of p.order) assert.ok(p.exercises[ex] && MOTIONS[ex], ex);
      assert.equal(p.weekPlan[0].length, 7);
      assert.ok(buildSteps(p, "A").some((x) => x.k === "ex"));
    }
  }
});

test("figure inventée : le vérificateur refuse ce qui passe sous le sol, flotte ou ne bouge pas", () => {
  const good = MOTIONS.goblet;
  assert.deepEqual(checkMotion(good), []);
  const sunk = { ...good, keys: good.keys.map((k) => ({ ...k, c: { ...k.c, at: [k.c.at[0], k.c.at[1] + 40] as [number, number] } })) };
  assert.ok(checkMotion(sunk).some((e) => /sous le sol/.test(e)));
  const floating = { ...good, keys: good.keys.map((k) => ({ ...k, c: { ...k.c, at: [k.c.at[0], 100] as [number, number] } })) };
  assert.ok(checkMotion(floating).some((e) => /flotte/.test(e)));
  const still = { ...good, steps: [{ to: 0, dur: 1, label: "Tiens" }, { to: 0, dur: 1, label: "Tiens" }] };
  assert.ok(checkMotion(still).some((e) => /ne quitte jamais/.test(e)));
  const far = { ...MOTIONS.pushup, keys: MOTIONS.pushup.keys.map((k) => ({ ...k, c: { ...k.c, ik: { handN: { at: [199, 183] as [number, number], bend: -1 as const } } } })) };
  assert.ok(checkMotion(far).some((e) => /n'atteint pas/.test(e)));
});

test("programme de l'IA : ids vérifiés, matériel respecté, figure fausse remplacée par la bibliothèque", () => {
  const req = { gear: [] as never[], perWeek: 3, minutes: 30, level: 1 as const, focus: "equilibre" as const };
  const motion = { keys: [], steps: [] };
  const toAi = (m: typeof MOTIONS.jBridge) => ({
    keys: m.keys.map((k) => ({ angles: { neck: 0, footN: 0, footF: 0, ...k.a }, anchor: k.c.anchor, anchorX: k.c.at[0], anchorY: k.c.at[1], ik: Object.entries(k.c.ik ?? {}).map(([end, t]) => ({ end: end as "handN", x: t.at[0], y: t.at[1], bend: t.bend === 1 ? ("avant" as const) : ("arriere" as const) })), bell: null })),
    steps: m.steps.map((s) => ({ to: s.to, dur: s.dur, label: s.label, count: !!s.count })),
  });
  const ex = (id: string, m: ReturnType<typeof toAi>, gear: ("aucun" | "kettlebell")[] = []) => ({
    id, name: id, short: id, muscles: "Fessiers", repsMin: 10, repsMax: 15, uni: false, seconds: false, tempo: "lent", cues: ["a"], errors: [], ladder: ["a", "b"],
    position: "p", movement: "m", feel: "f", breathing: "b", easier: "e", gear, pattern: "fessiers" as const, motion: m,
  });
  const out = {
    name: "Test",
    explanation: "x",
    sessions: [
      { name: "A", sub: "", blocks: [{ label: "Bloc 1", sets: 9, rest: 5, items: ["jBridge", "pont-ia", "goblet"], emom: null }] },
      { name: "B", sub: "", blocks: [{ label: "Bloc 1", sets: 3, rest: 60, items: ["pushup", "faux", "lourd"], emom: null }] },
    ],
    warmup: [],
    principles: [],
    weekNote: "",
    newExercises: [ex("pont-ia", toAi(MOTIONS.jBridge)), ex("faux", { ...toAi(MOTIONS.jBridge), steps: [] }), ex("lourd", toAi(MOTIONS.jBridge), ["kettlebell"])],
  };
  void motion;
  const r = verifyAiProgram(out, req, "p1");
  const A = r.program.sessions.A.blocks[0];
  assert.deepEqual(A.items, ["jBridge", "ia-pont-ia"], "goblet demande une kettlebell : retiré");
  assert.equal(A.sets, 5, "séries bornées");
  assert.equal(A.rest, 15, "repos borné");
  assert.ok(r.program.motions?.["ia-pont-ia"], "la figure inventée est gardée");
  assert.ok(r.warnings.some((w) => /lourd/.test(w)), "matériel absent signalé");
  assert.deepEqual(r.badMotions.map((b) => b.id), ["ia-faux"]);
  const fixed = replaceBad(r.program, "ia-faux", req, "fessiers");
  assert.ok(fixed.with && LIBRARY[fixed.with]);
  assert.ok(!JSON.stringify(fixed.program.sessions).includes("ia-faux"));
  assert.deepEqual(checkMotion(fromAiMotion(toAi(MOTIONS.goblet))), [], "aller-retour du format IA");
});

// ─── Guide visuel du rythme ───
import { heightAt, keyLevel, marksBetween, rhythmPath } from "@/lib/training/rhythm";

test("rythme : la bille est en haut ou en bas à chaque début de phase, au même instant que la figure", () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    let at = 0;
    let from = 0;
    for (const s of m.steps) {
      // Début de phase : la bille est sur la pose d'où l'on part ; fin de phase : sur la pose visée.
      if (at > 0) assert.ok(Math.abs(heightAt(m, at) - keyLevel(m, from)) < 1e-6, `${id} début ${at}`);
      assert.ok(Math.abs(heightAt(m, at + s.dur - 1e-6) - keyLevel(m, s.to)) < 1e-3, `${id} fin ${at + s.dur}`);
      // Même phase que la figure au milieu de l'étape.
      if (s.dur > 0.05) assert.equal(sample(m, at + s.dur / 2).label, s.label, id);
      at += s.dur;
      from = s.to;
    }
  }
});

test("rythme : les marques tombent sur les débuts de phase, les répétitions sont signalées, rien après la série", () => {
  const m = MOTIONS.goblet; // 3 s descente, 1 s en bas, 1 s montée, 0,4 s en haut
  const total = cycleDuration(m);
  const marks = marksBetween(m, 0, 2 * total);
  assert.equal(marks.length, 2 * m.steps.length);
  assert.deepEqual(marks.slice(0, 4).map((x) => [x.at, x.label, x.rep]), [
    [0, "Descends", true],
    [3, "Tiens en bas", false],
    [4, "Remonte fort", false],
    [5, "Respire", false],
  ]);
  assert.ok(marks.filter((x) => x.rep).every((x) => Math.abs(x.at % total) < 1e-9));
  // Série de 2 répétitions : plus de marque ensuite, la bille attend en haut.
  const end = 2 * total;
  assert.equal(marksBetween(m, 0, 5 * total, end).length, 2 * m.steps.length);
  assert.equal(heightAt(m, end + 1, end), 1);
  assert.equal(heightAt(m, -1), 1);
  // La courbe du goblet descend jusqu'en bas et garde un palier pendant la pause.
  assert.ok(Math.abs(heightAt(m, 3.5)) < 1e-9);
  const path = rhythmPath(m, 2, 1, 4);
  assert.ok(path.length > 90 && path[0].x === -1);
  assert.ok(path.every((p) => p.h >= -1e-9 && p.h <= 1 + 1e-9));
});

test("réglages du rythme gardés par personne, repris à la séance suivante", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  assert.deepEqual(guideOpts(db, "alex"), DEFAULT_OPTS);
  const row = createLive(db, "alex", "kb12", "A", 1000)!;
  const next = act(programById(db, "kb12")!, row.live, { k: "opts", opts: { auto: true, change: 20 } }, 2000);
  assert.ok(writeLive(db, row.id, row.version, next, 2000).ok);
  assert.deepEqual(guideOpts(db, "alex"), { auto: true, lead: DEFAULT_OPTS.lead, change: 20 });
  assert.equal(createLive(db, "alex", "kb12", "B", 3000)!.live.opts?.auto, true);
  assert.deepEqual(guideOpts(db, "sam"), DEFAULT_OPTS, "l'autre personne garde les siens");
});

test("muscles : chaque exercice de la bibliothèque a sa carte, les inventés la tirent de leur texte", () => {
  for (const id of Object.keys(LIBRARY)) assert.ok(ranked(musclesOf(id)).some((x) => x.w === 3), id);
  assert.deepEqual(musclesFromText("Fessiers, ischios et gainage"), { fessiers: 3, ischios: 2, abdos: 2, obliques: 2 });
  assert.equal(musclesOf("ia-inconnu", { muscles: "Pectoraux, triceps" }).pectoraux, 3);
});

test("dessin : chaque figure a son corps, son matériel tenu et posé", () => {
  for (const [id, m] of Object.entries(MOTIONS)) {
    const prims = drawFigure(sample(m, 0.3), m);
    assert.ok(prims.filter((p) => p.paint === "near").length >= 8, id);
    assert.ok(prims.every((p) => !p.d.includes("NaN")), id);
    if (m.keys.some((k) => k.bell) || m.gear?.length) assert.ok(prims.some((p) => p.paint === "tool"), `${id} : matériel tenu`);
    if (m.props?.length) assert.ok(prims.some((p) => p.paint === "prop"), `${id} : matériel posé`);
  }
});
