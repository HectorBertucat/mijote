// API de l'app iPhone : la clé désigne la personne, chaque route répond, une séance se pilote par gestes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { appApi, type AppRequest } from "@/lib/app-api/core";
import { JOINT_ORDER } from "@/lib/app-api/figures";
import { ensureLink } from "@/lib/health/link";
import { seedTest } from "./helpers";

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const alex = ensureLink(db, "alex").key;
  const sam = ensureLink(db, "sam").key;
  const call = (key: string | null, method: AppRequest["method"], path: string, body: unknown = null, now = Date.parse("2026-10-20T08:00:00Z")) => {
    const [p, q] = path.split("?");
    const headers = new Headers(key ? { "x-mijote-key": key } : {});
    return appApi(db, { method, path: p.split("/"), query: new URLSearchParams(q ?? ""), body, headers, now });
  };
  return { db, alex, sam, call };
}

test("api app : sans clé ou avec une mauvaise clé, rien", () => {
  const { call } = setup();
  assert.equal(call(null, "GET", "moi").status, 401);
  assert.equal(call("faux", "GET", "sante").status, 401);
});

test("api app : moi, santé, journal, course, chemin inconnu", () => {
  const { alex, call } = setup();
  const moi = call(alex, "GET", "moi").body as { person: { id: string }; features: string[] };
  assert.equal(moi.person.id, "alex");
  assert.ok(moi.features.includes("seance"));
  const s = call(alex, "GET", "sante?periode=3m");
  assert.equal(s.status, 200);
  assert.ok("overview" in s.body && "goals" in s.body);
  // JSON de bout en bout : ce que l'app reçoit vraiment.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s.body)));
  const j = call(alex, "GET", "jour?date=2026-10-20").body as { date: string; totals: { kcal: number } };
  assert.equal(j.date, "2026-10-20");
  assert.equal(call(alex, "GET", "course").status, 200);
  assert.deepEqual((call(alex, "GET", "course/sorties?limit=5").body as { runs: unknown[] }).runs, []);
  assert.equal(call(alex, "GET", "rien").status, 404);
});

test("api app : journal et pesée s'écrivent, une entrée d'une autre personne ne se touche pas", () => {
  const { alex, sam, call } = setup();
  const r = call(alex, "POST", "jour", { action: "libre", date: "2026-10-20", meal: "snack", label: "Pomme", kcal: 80, proteinG: 0.4 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const jour = (r.body as { jour: { entries: { id: string; label: string }[]; totals: { kcal: number } } }).jour;
  assert.equal(jour.totals.kcal, 80);
  const id = jour.entries[0].id;
  assert.equal(call(sam, "POST", "jour", { action: "retirer", date: "2026-10-20", id }).status, 404);
  assert.equal(call(alex, "POST", "jour", { action: "libre", date: "2026-10-21", meal: "snack", label: "Futur", kcal: 1, proteinG: 0 }).status, 400);
  assert.equal(call(alex, "POST", "jour", { action: "retirer", date: "2026-10-20", id }).status, 200);
  assert.equal(call(alex, "POST", "pesee", { kg: 12 }).status, 400);
  assert.equal(call(alex, "POST", "pesee", { kg: 78.4 }).status, 200);
});

test("api app : sport, figures échantillonnées, muscles, réglages du rythme", () => {
  const { alex, call } = setup();
  const s = call(alex, "GET", "sport").body as { program: { id: string; exercises: { id: string; muscles: { load: number }[] }[] }; guide: { auto: boolean } };
  assert.equal(s.program.id, "kb12");
  assert.ok(s.program.exercises.every((e) => e.muscles.some((m) => m.load === 3)));
  // La durée d'une répétition, la même que celle du site (figure de l'exercice).
  const ex = s.program.exercises as unknown as { id: string; cycle: number }[];
  assert.equal(ex.find((e) => e.id === "goblet")!.cycle, 5.4);
  const f = call(alex, "GET", "sport/figures?ex=goblet,swing").body as { figures: Record<string, { cycle: number; fps: number; frames: { j: number[]; bell?: unknown }[] }>; drawing: { body: { front: object } } };
  assert.deepEqual(Object.keys(f.figures), ["goblet", "swing"]);
  const g = f.figures.goblet;
  assert.equal(g.frames.length, Math.ceil(g.cycle * g.fps));
  assert.equal(g.frames[0].j.length, JOINT_ORDER.length * 2);
  assert.ok(g.frames[0].bell);
  assert.ok(Object.keys(f.drawing.body.front).length > 5);
  const r = call(alex, "POST", "sport/reglages", { auto: true, lead: 8 }).body as { guide: { auto: boolean; lead: number; change: number } };
  assert.deepEqual(r.guide, { auto: true, lead: 8, change: 10 });
});

test("api app : une séance se lance, se pilote par gestes à l'heure du serveur, se termine", () => {
  const { alex, sam, call } = setup();
  const t0 = Date.parse("2026-10-20T08:00:00Z");
  const start = call(alex, "POST", "sport/seance", { type: "A" }, t0).body as { live: { id: string; live: { i: number } } };
  const id = start.live.id;
  assert.equal(call(sam, "GET", `sport/seance/${id}`).status, 404, "la séance d'Alex n'est pas à Sam");
  const go = call(alex, "POST", `sport/seance/${id}/geste`, { k: "go", at: 0, n: 1 }, t0 + 1000).body as { live: { live: { i: number }; view: { exercise: { id: string }; reps: number } } };
  assert.equal(go.live.live.i, 1);
  assert.equal(go.live.view.exercise.id, "goblet");
  assert.ok(go.live.view.reps >= 12);
  // Le même geste rejoué (autre écran plus lent) ne fait rien.
  const again = call(alex, "POST", `sport/seance/${id}/geste`, { k: "go", at: 0, n: 1 }, t0 + 1100).body as { live: { live: { i: number } } };
  assert.equal(again.live.live.i, 1);
  const g = call(alex, "POST", `sport/seance/${id}/geste`, { k: "guide", at: 1, on: true }, t0 + 2000).body as { live: { live: { cur: { guide: number } } } };
  assert.equal(g.live.live.cur.guide, t0 + 2000 + 5000);
  assert.equal(call(alex, "POST", `sport/seance/${id}/geste`, { k: "inventé" }).status, 400);
  call(alex, "POST", `sport/seance/${id}/geste`, { k: "record", at: 1, ex: "goblet", set: 1, value: 15 }, t0 + 60_000);
  const cur = call(alex, "GET", "sport/seance", null, t0 + 61_000).body as { live: { id: string } };
  assert.equal(cur.live.id, id);
  const end = call(alex, "POST", `sport/seance/${id}/fin`, { note: "" }, t0 + 120_000);
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.ok((end.body as { workoutId: string }).workoutId);
});

test("api app : l'import annonce app_v1, chaque réponse a generatedAt et pas de null", () => {
  const { alex, call } = setup();
  const r = call(alex, "GET", "sport/seance");
  assert.equal(typeof r.body.generatedAt, "string");
  assert.ok(!("live" in r.body), "pas de séance : clé absente, pas null");
  const noNull = (x: unknown): boolean => (Array.isArray(x) ? true : x && typeof x === "object" ? Object.values(x).every((v) => v !== null && noNull(v)) : true);
  assert.ok(noNull(call(alex, "GET", "sport").body));
  assert.ok(noNull(call(alex, "GET", "sante?periode=tout").body));
});

test("api app : séries à plat pour les graphiques", () => {
  const { alex, call } = setup();
  const s = call(alex, "GET", "sante?periode=tout").body as { series: Record<string, { unit: string; points: { date: string; value: number }[] }> };
  for (const [k, v] of Object.entries(s.series)) {
    assert.ok(v.unit, k);
    for (const p of v.points) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value), k);
  }
});

test("api app : une figure seule, versionnée, avec ses repères, son matériel et le rôle des muscles", () => {
  const { alex, call } = setup();
  const f = call(alex, "GET", "sport/figures/goblet").body as { id: string; version: string; loop: boolean; cues: { t: number; label: string }[]; accessories: { type: string }[]; muscles: { role: string }[] };
  assert.equal(f.id, "goblet");
  assert.match(f.version, /^[0-9a-f]{12}$/);
  assert.equal(f.version, (call(alex, "GET", "sport/figures/goblet").body as { version: string }).version, "même figure, même version");
  assert.deepEqual(f.cues[0], { t: 0, label: "Descends" });
  assert.ok(f.accessories.some((a) => a.type === "kettlebell"));
  assert.ok(f.muscles.some((m) => m.role === "primary"));
  assert.equal(call(alex, "GET", "sport/figures/inconnu").status, 404);
  const s = call(alex, "GET", "sport").body as { program: { figureIds: Record<string, string[]> } };
  assert.ok(s.program.figureIds.A.includes("goblet"));
});

test("api app : gestes nommés, phase et fin de phase, révision périmée, renvoi sans effet", () => {
  const { alex, call } = setup();
  const t0 = Date.parse("2026-10-20T08:00:00Z");
  type L = { live: { version: number; state: { revision: number; phase: string; phaseEndsAt?: number; pausedPhase?: string }; live: { i: number }; figureIds: string[] } };
  const id = (call(alex, "POST", "sport/seance", { type: "A" }, t0).body as { live: { id: string } }).live.id;
  let r = call(alex, "POST", `sport/seance/${id}/action`, { action: "next" }, t0).body as L;
  assert.equal(r.live.live.i, 1);
  assert.ok(r.live.figureIds.includes("goblet"));
  assert.equal(r.live.state.phase, "work", "série sans rythme : elle attend « Série faite »");
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "start", revision: r.live.state.revision, actionId: "a1" }, t0 + 1000).body as L;
  assert.equal(r.live.state.phase, "setup");
  assert.equal(r.live.state.phaseEndsAt, t0 + 6000);
  // Le même actionId renvoyé ne refait rien.
  const again = call(alex, "POST", `sport/seance/${id}/action`, { action: "start", actionId: "a1" }, t0 + 2000).body as L;
  assert.equal(again.live.version, r.live.version);
  const stale = call(alex, "POST", `sport/seance/${id}/action`, { action: "pause", revision: 1 }, t0 + 3000);
  assert.equal(stale.status, 409);
  assert.ok("live" in stale.body);
  r = (call(alex, "GET", `sport/seance/${id}`, null, t0 + 7000).body as L);
  assert.equal(r.live.state.phase, "work");
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "pause" }, t0 + 8000).body as L;
  assert.equal(r.live.state.phase, "paused");
  assert.equal(r.live.state.pausedPhase, "work");
  assert.ok(!("phaseEndsAt" in r.live.state));
  r = call(alex, "POST", `sport/seance/${id}/action`, { action: "log", reps: 14 }, t0 + 9000).body as L;
  assert.equal(r.live.live.i, 2);
  assert.equal(call(alex, "POST", `sport/seance/${id}/action`, { action: "voler" }).status, 400);
});
