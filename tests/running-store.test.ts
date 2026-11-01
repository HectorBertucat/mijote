// Module Course côté base : détail des séances reçu de l'app (v2.1), réglages, plan rangé dans run_sessions
// (ids stables, versions, statuts), API de la montre (séances à programmer, accusés), propositions de l'IA
// vérifiées. Sur une base en mémoire, foyer fictif Alex et Sam.
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { setAiClient, type AiClient, type AiFinalMessage } from "@/lib/ai";
import { toolDefinitions } from "@/lib/assistant/core";
import { applyAssistantAction, askAssistant, loadSnapshot, toView } from "@/lib/assistant/store";
import { openDb } from "@/lib/db/open";
import { healthSamples, runProfiles, runSessions, workoutDetails } from "@/lib/db/schema";
import { importGet, importPost } from "@/lib/health/import-api";
import { ensureLink } from "@/lib/health/link";
import { checkRunningAction, RUN_ACTIONS } from "@/lib/running/actions";
import { addDays } from "@/lib/running/dates";
import { decodeHr, encodeHr, MAX_HR_POINTS, parseDetails } from "@/lib/running/details";
import { editSession, getRunProfile, noteFeedback, resumePlan, runContext, saveRunSettings, sessionIdOf, setWeekOverride, syncPlan } from "@/lib/running/store";
import { plansGet, plansPost } from "@/lib/running/watch-api";
import { seedTest } from "./helpers";

const NOW = new Date("2026-11-04T07:00:00Z"); // mercredi
const TODAY = "2026-11-04";
const MON = "2026-11-02";

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const key = ensureLink(db, "alex").key;
  const h = (k = key) => new Headers({ "X-Mijote-Key": k, "Content-Type": "application/json" });
  const post = (body: unknown, now = NOW) => importPost(db, h(), JSON.stringify(body), now);
  return { db, key, h, post };
}

/** Une course de l'app avec son détail : FC toutes les 5 s, temps au kilomètre. */
function runWorkout(uuid: string, start: string, minutes: number, extra: Record<string, unknown> = {}, details: Record<string, unknown> | null = {}) {
  const km = Math.floor(minutes / 6.5);
  const hr = Array.from({ length: Math.floor((minutes * 60) / 5) }, (_, i) => [i * 5, Math.round(Math.min(142, 100 + i * 0.6))]);
  const splits = Array.from({ length: km }, (_, i) => ({ km: i + 1, sec: 390, hrAvg: 138, elevGainM: 3, elevLossM: 3 }));
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  return {
    uuid,
    activity: "running",
    start,
    end,
    durationMin: minutes,
    kcal: minutes * 10,
    distanceM: km * 1000,
    hrAvg: 138,
    hrMax: 150,
    sourceName: "Apple Watch",
    ...extra,
    ...(details ? { details: { hr, splits, cadenceAvg: 162, strideM: 1.02, elevGainM: km * 3, elevLossM: km * 3, indoor: false, pausesSec: 0, source: { name: "Apple Watch", model: "Watch7,1" }, effort: 4, weather: { tempC: 14.2, humidityPct: 61 }, ...details } } : {}),
  };
}

const enable = (db: ReturnType<typeof setup>["db"], today = TODAY, extra: Record<string, unknown> = {}) =>
  saveRunSettings(db, "alex", { enabled: true, days: [1, 3, 5, 6].map((weekday) => ({ weekday, time: weekday >= 5 ? "09:00" : "18:30" })), perWeek: 3, goal: "plus_longtemps", ...extra }, today);

test("détail v2.1 : lu champ par champ, bornes, série en binaire (3 octets par point)", () => {
  const pts: [number, number][] = [[0, 98], [5, 104], [10, 109], [7000, 120]];
  assert.deepEqual(decodeHr(encodeHr(pts)), pts);
  assert.equal(encodeHr(pts).length, 12);
  const d = parseDetails({ hr: [[0, 98], [5, 300], [10, "x"], [5, 104]], effort: 11, weather: { tempC: 24.46, humidityPct: 140 }, splits: [{ km: 1, sec: 400 }, { km: 0.5, sec: 100 }], cadenceAvg: 162, plannedId: " p1 ", events: [{ type: "pause", t: 1200, durSec: 30 }] }, 3000)!;
  assert.deepEqual(d.hr, [[0, 98], [5, 104]]);
  assert.equal(d.effort, null); // hors de 1–10 : ignoré
  assert.deepEqual(d.weather, { tempC: 24.5 }); // humidité absurde ignorée
  assert.equal(d.splits, null); // pas croissants
  assert.equal(d.plannedId, "p1");
  assert.equal(d.cadenceAvg, 162);
  assert.equal(parseDetails({ hr: Array.from({ length: MAX_HR_POINTS + 1 }, (_, i) => [i * 5, 120]) }, 20_000)!.hr, null); // trop de points
  assert.equal(parseDetails("non", 60), null);
});

test("import v2.1 : GET annonce les fonctions, détail rangé, complété par uuid, gardé si renvoyé sans, supprimé avec la séance", () => {
  const { db, h, post } = setup();
  assert.deepEqual(importGet(db, h(), NOW).body.features, ["workout_details", "plans", "app_v1"]);

  // Une course d'abord reçue sans détail, puis renvoyée avec : complétée.
  let r = post({ version: 2, workouts: [runWorkout("w1", "2026-11-02T17:30:00Z", 40, {}, null)] });
  assert.deepEqual((r.body.accepted as Record<string, number>).details, 0);
  r = post({ version: 2, workouts: [runWorkout("w1", "2026-11-02T17:30:00Z", 40)] });
  assert.equal((r.body.accepted as Record<string, number>).details, 1);
  const sample = db.select().from(healthSamples).where(and(eq(healthSamples.personId, "alex"), eq(healthSamples.kind, "workout"))).all();
  assert.equal(sample.length, 1);
  const det = db.select().from(workoutDetails).where(eq(workoutDetails.sampleId, sample[0].id)).get()!;
  assert.equal(det.hrPoints, 480);
  assert.equal(det.hr!.length, 480 * 3);
  assert.equal(det.effort, 4);
  assert.equal(det.tempC, 14.2);
  assert.equal(det.humidityPct, 61);
  assert.equal(det.date, "2026-11-02");
  assert.ok(det.peak != null && det.peak >= 140 && det.peak <= 142, `pic ${det.peak}`);
  assert.deepEqual((det.data as { splits: unknown[] }).splits.length, 6);

  // Renvoyée sans détail (le renvoi unique de l'app) : le détail reste.
  post({ version: 2, workouts: [runWorkout("w1", "2026-11-02T17:30:00Z", 40, {}, null)] });
  assert.equal(db.select().from(workoutDetails).all().length, 1);
  // Supprimée dans Santé : le détail part avec.
  post({ version: 2, deleted: [{ uuid: "w1", type: "workout" }] });
  assert.equal(db.select().from(workoutDetails).all().length, 0);
  // Un détail illisible ne fait pas refuser la séance.
  r = post({ version: 2, workouts: [{ ...runWorkout("w2", "2026-11-03T17:30:00Z", 30, {}, null), details: "?" }] });
  assert.deepEqual([(r.body.accepted as Record<string, number>).workouts, (r.body.accepted as Record<string, number>).details, r.body.skipped], [1, 0, 0]);
});

test("réglages : bornes, mise en route à la première activation", () => {
  const { db } = setup();
  assert.throws(() => saveRunSettings(db, "alex", { enabled: true, days: [], perWeek: 3, goal: "plus_longtemps" }, TODAY));
  assert.throws(() => saveRunSettings(db, "alex", { enabled: true, days: [{ weekday: 1 }], perWeek: 6, goal: "plus_longtemps" }, TODAY));
  assert.throws(() => saveRunSettings(db, "alex", { enabled: true, days: [{ weekday: 1 }], perWeek: 3, goal: "plus_longtemps", hrMax: 180, hrRest: 60, hrThreshold: 190 }, TODAY));
  assert.throws(() => saveRunSettings(db, "alex", { enabled: true, days: [{ weekday: 1, time: "25:00" }], perWeek: 3, goal: "plus_longtemps" }, TODAY));
  const p = enable(db);
  assert.equal(p.startedOn, TODAY);
  assert.deepEqual(p.days.map((d) => d.weekday), [1, 3, 5, 6]);
  assert.equal(enable(db, "2026-11-20").startedOn, TODAY); // la mise en route ne bouge plus
  assert.equal(syncPlan(db, "sam", NOW), null); // pas activé pour Sam
});

test("plan rangé : ids stables, version qui ne monte que si la séance change, annulée si elle disparaît", () => {
  const { db } = setup();
  enable(db);
  const a = syncPlan(db, "alex", NOW)!;
  assert.equal(a.plan.phase, 0); // jamais couru : marche-course
  const future = a.sessions.filter((s) => s.date >= TODAY);
  assert.ok(future.length >= 3, JSON.stringify(future.map((s) => s.date)));
  assert.ok(future.every((s) => s.status === "prevue" && s.version === 1 && s.kind === "marche_course"));
  assert.equal(future[0].id, sessionIdOf("alex", future[0].weekStart, future[0].role));
  assert.match(future[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Rien ne change : rien ne bouge.
  const b = syncPlan(db, "alex", NOW)!;
  assert.deepEqual(b.sessions.map((s) => [s.id, s.version, s.status]), a.sessions.map((s) => [s.id, s.version, s.status]));
  // Un réglage change l'heure des séances : nouvelle version, même id.
  enable(db, TODAY, { time: null, days: [1, 3, 5, 6].map((weekday) => ({ weekday, time: "07:15" })) });
  const c = syncPlan(db, "alex", NOW)!;
  const s0 = c.sessions.find((s) => s.id === future[0].id)!;
  assert.equal(s0.version, 2);
  assert.equal(s0.time, "07:15");
  // Deux jours seulement : une séance de la semaine en cours disparaît → annulée.
  enable(db, TODAY, { perWeek: 2, days: [{ weekday: 5 }, { weekday: 6 }] });
  const d = syncPlan(db, "alex", NOW)!;
  assert.ok(d.sessions.some((s) => s.status === "annulee"));
});

test("montre : GET des séances J à J+7 en WorkoutSpec, accusé (programmée, échec, retrait, autorisation), 401, 400, 404 en démo", () => {
  const { db, h } = setup();
  // Sans module : rien à programmer.
  assert.deepEqual(plansGet(db, h(), NOW).body, { ok: true, plans: [], removed: [] });
  enable(db);
  const g = plansGet(db, h(), NOW);
  assert.equal(g.status, 200);
  const plans = g.body.plans as { id: string; version: number; date: string; time?: string; title: string; workout: { activity: string; blocks: { steps: { alert?: { type: string; range_min: number; range_max: number; unit: string } }[] }[] }; notes: string }[];
  assert.ok(plans.length >= 2);
  assert.ok(plans.every((p) => p.date >= TODAY && p.date <= addDays(TODAY, 7)));
  assert.equal(plans[0].workout.activity, "running");
  const alert = plans[0].workout.blocks[0].steps[0].alert!;
  assert.deepEqual([alert.type, alert.unit], ["heartRate", "bpm"]);
  assert.ok(alert.range_max - alert.range_min >= 8);
  assert.ok(plans[0].notes.length > 0);

  // Accusé.
  const [p1, p2] = plans;
  const ack = plansPost(db, h(), JSON.stringify({ scheduled: [{ id: p1.id, version: p1.version, at: `${p1.date}T18:30:00+01:00` }, { id: "inconnu", version: 1 }], failed: [{ id: p2.id, version: p2.version, error: "En attente de ton autorisation" }], removed: [], scheduler: { supported: true, authorized: true } }), NOW);
  assert.deepEqual(ack, { status: 200, body: { ok: true } });
  const row = (id: string) => db.select().from(runSessions).where(eq(runSessions.id, id)).get()!;
  assert.deepEqual([row(p1.id).status, row(p1.id).watchVersion], ["programmee", p1.version]);
  assert.equal(row(p2.id).watchError, "En attente de ton autorisation");
  assert.deepEqual(getRunProfile(db, "alex")!.watch?.authorized, true);
  // La séance change : de nouveau « prévue » avec une nouvelle version, renvoyée à la montre.
  enable(db, TODAY, { time: null, days: [1, 3, 5, 6].map((weekday) => ({ weekday, time: "06:45" })) });
  const again = (plansGet(db, h(), NOW).body.plans as { id: string; version: number; time?: string }[]).find((p) => p.id === p1.id)!;
  assert.deepEqual([again.version, again.time, row(p1.id).status], [p1.version + 1, "06:45", "prevue"]);

  assert.equal(plansGet(db, h("mauvaise"), NOW).status, 401);
  assert.equal(plansPost(db, h(), "{", NOW).status, 400);
  assert.equal(plansPost(db, h(), JSON.stringify({ scheduled: "x" }), NOW).status, 400);
  process.env.MIJOTE_DEMO = "1";
  try {
    assert.equal(plansGet(db, h(), NOW).status, 404);
    assert.equal(plansPost(db, h(), "{}", NOW).status, 404);
  } finally {
    delete process.env.MIJOTE_DEMO;
  }
});

test("course faite : rapprochée par plannedId (sinon le jour), séance passée sans course : manquée", () => {
  const { db, post } = setup();
  enable(db, "2026-11-02");
  const first = syncPlan(db, "alex", new Date("2026-11-02T06:00:00Z"))!;
  const [s1, s2] = first.sessions.filter((s) => s.status === "prevue");
  // La première faite depuis la montre (plannedId), la deuxième sautée.
  post({ version: 2, workouts: [runWorkout("w-a", `${s1.date}T17:00:00Z`, 30, {}, { plannedId: s1.id, effort: 3 })] }, new Date(`${s1.date}T18:00:00Z`));
  const later = new Date(`${addDays(s2.date, 1)}T07:00:00Z`);
  const st = syncPlan(db, "alex", later)!;
  const row = (id: string) => db.select().from(runSessions).where(eq(runSessions.id, id)).get()!;
  assert.equal(row(s1.id).status, "faite");
  assert.ok(row(s1.id).sampleId);
  assert.equal(row(s2.id).status, "manquee");
  assert.equal(st.data.runs[0].plannedId, s1.id);
  // Sans plannedId, le même jour suffit.
  const next = st.sessions.find((s) => s.status === "prevue")!;
  post({ version: 2, workouts: [runWorkout("w-b", `${next.date}T17:00:00Z`, 32, {}, {})] }, new Date(`${next.date}T18:00:00Z`));
  syncPlan(db, "alex", new Date(`${next.date}T19:00:00Z`));
  assert.equal(row(next.id).status, "faite");
});

test("douleur ≥ 5 : suspension enregistrée, séances retirées de la montre ; la personne seule rouvre", () => {
  const { db, h } = setup();
  enable(db, "2026-11-02");
  syncPlan(db, "alex", new Date("2026-11-02T06:00:00Z"));
  noteFeedback(db, "alex", { date: "2026-11-03", pain: 6, painWhere: "tibia" });
  const st = syncPlan(db, "alex", NOW)!;
  assert.ok(st.plan.paused);
  assert.equal(getRunProfile(db, "alex")!.pauses.length, 1);
  const g = plansGet(db, h(), NOW).body as { plans: unknown[]; removed: string[] };
  assert.equal(g.plans.length, 0);
  assert.ok(g.removed.length >= 1);
  assert.ok(/professionnel de santé/.test(st.plan.messages[0]));
  // Une action de l'IA ne passe pas pendant la suspension.
  const ctx = runContext(db, "alex", NOW)!;
  assert.equal(checkRunningAction({ kind: "course_decharge", weekStart: "2026-11-09", why: "" }, ctx).ok, false);
  // Rouverte par la personne trois semaines plus tard : de nouvelles séances.
  resumePlan(db, "alex", "2026-11-24");
  const back = syncPlan(db, "alex", new Date("2026-11-24T07:00:00Z"))!;
  assert.equal(back.plan.paused, null);
  assert.ok(back.sessions.some((s) => s.status === "prevue" && s.date >= "2026-11-24"));
});

test("propositions de l'IA : schémas stricts, et chaque invariant du § 6 vérifié par le code", () => {
  const { db } = setup();
  // Alex court depuis des semaines : phase 1 directe.
  const { post } = { post: (b: unknown) => importPost(db, new Headers({ "X-Mijote-Key": ensureLink(db, "alex").key }), JSON.stringify(b), NOW) };
  post({ version: 2, workouts: Array.from({ length: 12 }, (_, i) => runWorkout(`h${i}`, `${addDays("2026-10-06", i * 2)}T17:00:00Z`, i % 3 === 2 ? 50 : 40)) });
  enable(db, MON);
  const ctx = runContext(db, "alex", NOW)!;
  assert.equal(ctx.phase, 1);
  const next = ctx.sessions.filter((s) => s.date > TODAY && s.status === "prevue");
  const easy = next.find((s) => s.kind === "footing" || s.kind === "footing_lignes")!;
  const long = next.find((s) => s.kind === "sortie_longue")!;
  assert.ok(easy && long, JSON.stringify(next.map((s) => [s.date, s.kind])));

  // Schémas : un outil mal rempli ne passe pas.
  assert.equal(RUN_ACTIONS.course_raccourcir.schema.safeParse({ sessionId: easy.id }).success, false);

  // Déplacer : jour non disponible, jour déjà pris, jour passé, deux jours de suite en phase 1.
  assert.match((checkRunningAction({ kind: "course_decaler", sessionId: easy.id, date: "2026-11-11", why: "" }, ctx) as { reason: string }).reason, /mercredi/);
  assert.equal(checkRunningAction({ kind: "course_decaler", sessionId: easy.id, date: "2026-11-02", why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_decaler", sessionId: easy.id, date: "2026-12-20", why: "" }, ctx).ok, false);
  const free = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(MON, 7 + d)).find((d) => ctx.days.includes((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) && !ctx.sessions.some((s) => s.date === d));
  if (free) {
    const r = checkRunningAction({ kind: "course_decaler", sessionId: easy.id, date: free, why: "" }, ctx);
    assert.ok(r.ok || /suite|48 h|record|renforcement/.test(r.reason), JSON.stringify(r));
  }

  // Raccourcir : toujours permis, pas en dessous de 15 min, et vraiment plus court.
  const short = checkRunningAction({ kind: "course_raccourcir", sessionId: easy.id, minutes: easy.minutes - 10, why: "" }, ctx);
  assert.equal(short.ok, true);
  assert.equal(checkRunningAction({ kind: "course_raccourcir", sessionId: easy.id, minutes: 10, why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_raccourcir", sessionId: easy.id, minutes: easy.minutes + 5, why: "" }, ctx).ok, false);

  // Remplacer : jamais plus dur, jamais hors phase.
  assert.equal(checkRunningAction({ kind: "course_remplacer", sessionId: easy.id, type: "fartlek", minutes: 30, why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_remplacer", sessionId: long.id, type: "footing", minutes: long.minutes - 10, why: "" }, ctx).ok, true);
  assert.equal(checkRunningAction({ kind: "course_remplacer", sessionId: long.id, type: "footing", minutes: long.minutes + 20, why: "" }, ctx).ok, false);

  // Nombre de sorties : bornes, et pas d'augmentation après une douleur.
  assert.equal(checkRunningAction({ kind: "course_sorties", perWeek: 5, why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_sorties", perWeek: 4, why: "" }, ctx).ok, true);
  assert.equal(checkRunningAction({ kind: "course_sorties", perWeek: 4, why: "" }, { ...ctx, painRecent: true }).ok, false);
  assert.equal(checkRunningAction({ kind: "course_sorties", perWeek: 2, why: "" }, { ...ctx, painRecent: true }).ok, true);

  // Décharge : semaine en cours ou suivante seulement.
  assert.equal(checkRunningAction({ kind: "course_decharge", weekStart: addDays(MON, 7), why: "" }, ctx).ok, true);
  assert.equal(checkRunningAction({ kind: "course_decharge", weekStart: addDays(MON, 21), why: "" }, ctx).ok, false);

  // FC : bornes, seuil entre repos + 20 et max, écart aux observations à confirmer.
  assert.equal(checkRunningAction({ kind: "course_fc", hrMax: 250, why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_fc", hrRest: 20, why: "" }, ctx).ok, false);
  assert.equal(checkRunningAction({ kind: "course_fc", hrThreshold: ctx.zones.rest + 10, why: "" }, ctx).ok, false);
  const fc = checkRunningAction({ kind: "course_fc", hrMax: 199, why: "" }, { ...ctx, observed: { max: 180, rest: null } });
  assert.ok(fc.ok && fc.notes.some((n) => /confirme/.test(n)));
  assert.equal(checkRunningAction({ kind: "course_fc", hrMax: 190, why: "" }, null).ok, false);

  // Une action confirmée passe par les mêmes fonctions que la page : la séance raccourcie le reste.
  editSession(db, "alex", easy.id, { minutes: easy.minutes - 10 }, NOW);
  setWeekOverride(db, "alex", { weekStart: addDays(MON, 7), deload: true });
  const after = syncPlan(db, "alex", NOW)!;
  const e2 = after.sessions.find((s) => s.id === easy.id)!;
  assert.ok(e2.minutes <= easy.minutes - 10 + 1, `${easy.minutes} → ${e2.minutes}`);
  assert.equal(e2.version, 2);
  assert.equal(after.plan.weeks[after.plan.weeks.length - 1].deload, true);
  assert.ok(db.select().from(runProfiles).get()!.overrides.length === 1);
});

/** Un modèle simulé : un texte et des appels d'outils. */
function fakeClient(text: string, tools: { name: string; input: unknown }[], seen: Record<string, unknown>[]): AiClient {
  return {
    messages: {
      parse: async () => {
        throw new Error("non utilisé");
      },
      stream: (params) => {
        seen.push(params);
        const final: AiFinalMessage = { usage: { input_tokens: 2000, output_tokens: 150 }, stop_reason: "tool_use", content: [{ type: "text", text }, ...tools.map((t) => ({ type: "tool_use", name: t.name, input: t.input }))] };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text } };
          },
          finalMessage: async () => final,
        };
      },
    },
  };
}

test("assistant : outils de course seulement si le module est activé, contexte Course compact, action vérifiée puis appliquée", async () => {
  const { db } = setup();
  const names = (on: boolean) => toolDefinitions(on).map((t) => t.name);
  assert.ok(!names(false).some((n) => n.startsWith("course_")));
  assert.ok(names(true).includes("course_raccourcir"));
  assert.equal(loadSnapshot(db, "alex", MON, NOW).running, null);

  enable(db, MON);
  const snap = loadSnapshot(db, "alex", MON, NOW);
  assert.ok(snap.running);
  const s = snap.running!.sessions.find((x) => x.date > TODAY && x.status === "prevue")!;
  const seen: Record<string, unknown>[] = [];
  setAiClient(
    fakeClient("Je raccourcis la prochaine séance.", [
      { name: "course_raccourcir", input: { sessionId: s.id, minutes: s.minutes - 10, why: "fatigue" } },
      { name: "course_sorties", input: { perWeek: 9, why: "plus" } },
    ], seen)
  );
  try {
    const row = await askAssistant(db, "alex", "Je suis fatigué, on allège ?", { path: "/sante/course" }, undefined, NOW);
    const v = toView(row);
    assert.deepEqual(v.actions.map((a) => a.status), ["proposed", "refused"]);
    const p = seen[0] as { system: { text: string }[]; tools: { name: string }[]; messages: { content: string }[] };
    assert.match(p.system[1].text, /## Course : Alex \(personId alex\)/);
    assert.match(p.system[1].text, new RegExp(s.id));
    assert.ok(p.tools.some((t) => t.name === "course_decaler"));
    assert.match(p.messages.at(-1)!.content, /sa page Course/);
    const r = applyAssistantAction(db, "alex", row.id, 0, NOW);
    assert.ok(r.ok, r.message);
    const after = db.select().from(runSessions).where(eq(runSessions.id, s.id)).get()!;
    assert.ok(after.minutes < s.minutes, `${s.minutes} → ${after.minutes}`);
  } finally {
    setAiClient(null);
  }
});
