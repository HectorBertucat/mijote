// Pause des minuteurs : rejouée depuis le journal (le même code sur chaque écran), fin prévue
// repoussée du temps passé en pause, minuteur figé et silencieux pendant la pause.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSession } from "@/lib/session/planner";
import { focusStep, liveTimer, originalEnd, pausedTimers, reduce, runningTimers, storedEnd, timerEnd, type SessionEvent } from "@/lib/session/state";
import { load, RES } from "./helpers";

const T0 = Date.parse("2026-10-21T18:00:00Z");
const min = (m: number) => T0 + m * 60000;
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const ev = (kind: SessionEvent["kind"], ref: string | null, at: number, payload: Record<string, unknown> | null = null): SessionEvent => ({ id: `e${++n}`, at: iso(at), kind, ref, payload });
const start = (ref: string, at: number, minutes: number, extra: Record<string, unknown> = {}) => ev("timer_start", ref, at, { label: ref, minutes, endsAt: iso(at + minutes * 60000), ...extra });

test("pause puis reprise : la fin prévue recule du temps passé en pause", () => {
  // Riz : 10 min lancées à 0, pause à 4, reprise à 7 → fin à 13.
  const paused = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4))]);
  const t = paused.timers.get("riz")!;
  assert.equal(t.pausedAt, min(4));
  // Pendant la pause, le reste ne bouge pas : 6 min à 5 comme à 6.
  assert.equal(timerEnd(t, min(5)) - min(5), 6 * 60000);
  assert.equal(timerEnd(t, min(6)) - min(6), 6 * 60000);
  assert.equal(liveTimer(t, min(6)).endsAt, min(12));
  const resumed = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4)), ev("timer_resume", "riz", min(7))]).timers.get("riz")!;
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.endsAt, min(13));
  assert.equal(resumed.pausedMs, 3 * 60000);
  assert.equal(timerEnd(resumed, min(8)), min(13));
});

test("deux écrans en même temps : seule la première pause et la première reprise comptent", () => {
  const s = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4)), ev("timer_pause", "riz", min(5)), ev("timer_resume", "riz", min(7)), ev("timer_resume", "riz", min(8))]);
  assert.equal(s.timers.get("riz")!.endsAt, min(13));
});

test("pause ignorée sur un minuteur arrêté, fini ou inconnu ; reprise sans pause sans effet", () => {
  const s = reduce("cooking", [
    start("a", min(0), 5),
    ev("timer_done", "a", min(2)),
    ev("timer_pause", "a", min(3)),
    start("b", min(0), 5),
    ev("timer_pause", "b", min(6)), // déjà sonné
    ev("timer_pause", "inconnu", min(1)),
    start("c", min(0), 5),
    ev("timer_resume", "c", min(2)),
  ]);
  assert.equal(s.timers.get("a")!.pausedAt, null);
  assert.equal(s.timers.get("b")!.pausedAt, null);
  assert.equal(s.timers.get("c")!.endsAt, min(5));
});

test("plusieurs pauses s’additionnent ; « ↺ » revient à la durée d’origine plus les pauses", () => {
  const s = reduce("cooking", [start("x", min(0), 10), ev("timer_pause", "x", min(1)), ev("timer_resume", "x", min(3)), ev("timer_pause", "x", min(5)), ev("timer_resume", "x", min(6))]);
  const t = s.timers.get("x")!;
  assert.equal(t.endsAt, min(13));
  assert.equal(t.pausedMs, 3 * 60000);
  assert.equal(originalEnd(t, min(7)), min(13));
  // En pause depuis 8 : la fin d'origine glisse avec l'heure.
  const p = reduce("cooking", [start("x", min(0), 10), ev("timer_pause", "x", min(1)), ev("timer_resume", "x", min(3)), ev("timer_pause", "x", min(8))]).timers.get("x")!;
  assert.equal(originalEnd(p, min(9)), min(13));
});

test("réglé pendant la pause (+1 min) : il reste en pause, son reste grandit d’une minute", () => {
  const before = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4))]).timers.get("riz")!;
  const now = min(6);
  // L'écran voit 6 min restantes ; +1 → fin voulue à now + 7 min, écrite depuis l'instant de la pause.
  const wanted = liveTimer(before, now).endsAt + 60000;
  const stored = storedEnd(before, wanted, now);
  assert.equal(stored, min(11));
  const s = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4)), start("riz", min(6), 0, { adjust: true, endsAt: iso(stored) })]);
  const t = s.timers.get("riz")!;
  assert.equal(t.pausedAt, min(4));
  assert.equal(timerEnd(t, min(9)) - min(9), 7 * 60000);
  assert.equal(t.startedAt, min(0));
  // Relancé (pas un réglage) : la pause est oubliée.
  const r = reduce("cooking", [start("riz", min(0), 10), ev("timer_pause", "riz", min(4)), start("riz", min(6), 2)]).timers.get("riz")!;
  assert.equal(r.pausedAt, null);
  assert.equal(r.endsAt, min(8));
});

test("tout mettre en pause : les minuteurs qui tournent, pas ceux qui ont sonné", () => {
  const evs = [start("a", min(0), 5), start("b", min(0), 20), start("c", min(0), 30), ev("timer_pause", "c", min(2))];
  const s = reduce("cooking", evs);
  assert.deepEqual(runningTimers(s, min(10)).map((t) => t.id), ["b"]);
  assert.deepEqual(pausedTimers(s).map((t) => t.id), ["c"]);
});

test("une étape dont le minuteur est en pause attend toujours : l'écran montre l'autre", () => {
  const plan = planSession([load("chasseur-porc.json")], RES);
  const [other, step] = plan.steps.filter((s) => !s.phases?.length);
  // `other` lancée d'abord, sans minuteur ; `step` ensuite, avec 5 min.
  const evs: SessionEvent[] = [ev("note", null, min(0), { status: "cooking" }), ev("step_start", other.id, min(0)), ev("step_start", step.id, min(1)), start("t", min(1), 5, { stepId: step.id })];
  assert.equal(focusStep(plan, reduce("cooking", evs), min(2))?.id, other.id);
  // Sans pause, à 30 min, le minuteur a sonné : l'étape revient devant.
  assert.equal(focusStep(plan, reduce("cooking", evs), min(30))?.id, step.id);
  // En pause : toujours en fond, même bien après la fin d'origine.
  assert.equal(focusStep(plan, reduce("cooking", [...evs, ev("timer_pause", "t", min(2))]), min(30))?.id, other.id);
});
